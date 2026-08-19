/**
 * Pure fold from `SessionEvent[]` to `TranscriptItem[]`: no UI, no Cordis,
 * no imports beyond the session/LLM/tools types and the window policy. The
 * mounter (`src/index.ts`) uses the stateful {@link TranscriptFolder} for
 * both the resume snapshot and the live `session/event` feed;
 * {@link foldSessionEvents} is the one-shot form.
 *
 * Folded: `user/message` → user item (image blocks kept as
 * `ImageAttachmentRef`s alongside the `[image]` text placeholder);
 * `assistant/chunk` text deltas accumulate into one streaming assistant
 * item per step while reasoning deltas open a sibling streaming thinking
 * item (the S17 kimi split — thinking mounts as its own block above the
 * answer, created only once its accumulated text holds something visible,
 * the kimi whitespace guard); `assistant/message` finalizes both from the
 * authoritative assembled message; `tool/call` + `tool/result` pair by
 * `callId` into one tool item carrying the parsed arguments, the
 * reconstructed `ToolResult`, and the render intent resolved through the
 * optional `present` hooks — except `todo_write`, whose calls and results
 * render nothing because the todo pane owns that presentation.
 * `turn/start`/`step/start`/`turn/end` drive the
 * turn/step tagging, the completed-turn list the window policy evicts on,
 * and in-turn step folding with the S20 kimi retention: the most recent
 * `recentStepsRetention()` steps of a turn keep their cards expanded, and a
 * new `step/start` folds only the step sliding out of the window into one
 * `step-summary` item (the S18 kimi wording counts both). All other event
 * types (request records, log-only markers, and merge-extended unknowns)
 * render nothing.
 *
 * @module @dsh-blue/blue-transcript/fold
 */

import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { parseToolArguments } from './present.ts'
import type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptStepSummaryItem,
  TranscriptThinkingItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from './types.ts'
import { isStepFoldingEnabled, recentStepsRetention } from './window.ts'

/** Maximum length of the one-line tool-result summary. */
export const RESULT_SUMMARY_MAX_CHARS = 160

/**
 * The harness todo tool's model-facing name (`tool-todo` registers it; the
 * `todo/write` whole-list snapshots carry the same writes). The todo pane
 * owns the visible presentation, so the tool call itself renders nothing in
 * the stream — the user's S13 dogfood ruling (kimi keeps the call headline
 * and drops only the body; Blue hides both).
 */
const TODO_TOOL_NAME = 'todo_write'

/**
 * Collapse a multi-line string to one ellipsized line.
 * @param text - the text to flatten.
 * @param maxChars - the maximum string length (not terminal columns) kept.
 * @returns whitespace-collapsed text, ellipsized beyond `maxChars`.
 */
export function ellipsize(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`
}

/** The fold's answer to one event: the item the event created or mutated. */
export interface FoldItemUpdate {
  /** The created or mutated item (object identity is stable per item). */
  item: TranscriptItem
  /** Whether the item was just appended to {@link TranscriptFolder.items}. */
  isNew: boolean
}

/**
 * The fold's answer to in-turn step folding: the step's tool and thinking
 * items were replaced in place (at the first folded item's position) by one
 * `step-summary` item. The mounter disposes the replaced items' components
 * and mounts the summary.
 */
export interface FoldReplacement {
  /** The folded tool items, in session order. */
  replaced: TranscriptItem[]
  /** The summary item that took their place. */
  item: TranscriptStepSummaryItem
}

/**
 * The fold's answer to one event: either an item creation/mutation or an
 * in-place step-summary replacement; `null` renders nothing.
 */
export type FoldUpdate = FoldItemUpdate | FoldReplacement

/**
 * Tool-presentation hooks the folder resolves views through — typically the
 * `src/present.ts` resolvers closing over the host tool registry.
 */
export interface FoldPresent {
  /**
   * Resolve the pending-call view.
   * @param name - the tool name exactly as the model requested it.
   * @param args - the parsed arguments (`undefined` when parsing failed).
   * @returns the call view, or `undefined` to stay generic.
   */
  call(name: string, args: unknown): ToolCallView | undefined
  /**
   * Resolve the completed-call view.
   * @param name - the tool name exactly as the model requested it.
   * @param args - the parsed arguments (`undefined` when parsing failed).
   * @param result - the reconstructed tool result.
   * @returns the result view, or `undefined` to keep the call view.
   */
  result(name: string, args: unknown, result: ToolResult): ToolResultView | undefined
}

/** Optional folder hooks. */
export interface FoldHooks {
  /** Tool-presentation hooks; absent hooks leave every item view-less. */
  present?: FoldPresent
}

/** Join the visible text of content blocks; images fold to a placeholder. */
function contentText(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) parts.push(block.text)
        break
      case 'image':
        parts.push('[image]')
        break
      default:
        // reasoning / tool-call / tool-result and merge-extended blocks
        // carry no user-visible text here.
        break
    }
  }
  return parts.join('\n')
}

/** Join the reasoning text of content blocks, or '' when there is none. */
function reasoningText(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('\n\n')
}

/** The image attachments of content blocks, in block order. */
function contentImages(content: readonly ContentBlock[]): ImageBlock['attachment'][] {
  return content
    .filter((block): block is ImageBlock => block.type === 'image')
    .map(block => block.attachment)
}

/**
 * Untruncated display text for a `tool/result` payload. A string `meta` is
 * the tool's own presentation payload and wins over the model-facing result
 * text; structured meta stays opaque to us.
 */
function fullResultText(data: SessionEvent<'tool/result'>['data']): string {
  if (typeof data.meta === 'string' && data.meta.trim()) {
    return data.meta
  }
  return contentText(data.message.content[0].content)
}

/** One-line display summary for a `tool/result` payload. */
function summarizeResult(data: SessionEvent<'tool/result'>['data']): string {
  return ellipsize(fullResultText(data), RESULT_SUMMARY_MAX_CHARS)
}

/**
 * Stateful folder over one session's event stream. Applied events must be in
 * ascending seq order; the mounter enforces that (snapshot first, then the
 * live feed deduped by seq).
 */
export class TranscriptFolder {
  /** The folded transcript in session order. */
  readonly items: TranscriptItem[] = []

  private readonly present: FoldPresent | undefined
  private currentTurn = 0
  private lastStep: { turn: number, step: number } | null = null
  private readonly completed: number[] = []
  private streamingStep: string | null = null
  private streamingItem: TranscriptAssistantItem | null = null
  private streamingThinking: TranscriptThinkingItem | null = null
  /** Reasoning accumulated before the streaming thinking item holds anything visible. */
  private pendingReasoning = ''
  private readonly finalizedSteps = new Set<string>()
  private readonly toolsByCallId = new Map<string, TranscriptToolItem>()
  /** Call ids of suppressed `todo_write` calls, so their results render nothing either. */
  private readonly suppressedCalls = new Set<string>()

  /**
   * @param hooks - optional tool-presentation hooks resolved per call/result.
   */
  constructor(hooks: FoldHooks = {}) {
    this.present = hooks.present
  }

  /** Completed turn numbers in ascending order; the window policy reads this. */
  get completedTurns(): readonly number[] {
    return this.completed
  }

  /**
   * Fold one event into the transcript.
   * @param event - the next session event, in ascending seq order.
   * @returns the updates the event produced, in mount order, or null when
   *   the event renders nothing (log-only records, unknown types).
   */
  apply(event: SessionEvent): readonly FoldUpdate[] | null {
    switch (event.type) {
      case 'turn/start': {
        this.currentTurn = event.data.turn
        this.lastStep = null
        return null
      }

      case 'step/start': {
        const { turn, step } = event.data
        this.currentTurn = turn
        const previous = this.lastStep
        this.lastStep = { turn, step }
        // In-turn step folding with the S20 kimi retention: the most recent
        // `recentStepsRetention()` steps keep their cards expanded, so a new
        // step/start folds only the step sliding out of the window. The S7
        // policy folded the previous step outright — the S20 dogfood found
        // kimi keeps its last 30 steps visible, so Blue aligns. The turn's
        // last steps never fold — no later step/start arrives for them.
        if (isStepFoldingEnabled() && previous !== null && previous.turn === turn) {
          const outgoing = previous.step - recentStepsRetention()
          if (outgoing > 0) {
            const replacement = this.foldStep(turn, outgoing)
            return replacement === null ? null : [replacement]
          }
        }
        return null
      }

      case 'turn/end': {
        this.completed.push(event.data.turn)
        this.lastStep = null
        return null
      }

      case 'user/message': {
        // D28 (user ruling, landed with the S17 dogfood pull-forward):
        // synthetic messages — plugin/model/tool sources, the harness's
        // ContextFormed injections like the runtime-context snapshot —
        // render nothing, not even a placeholder row. Only `kind: 'user'`
        // human input folds; the snapshot replay shares the rule (D16).
        if (event.data.source.kind !== 'user') return null
        const text = contentText(event.data.content)
        if (!text.trim()) return null
        const item: TranscriptUserItem = {
          kind: 'user',
          seq: event.seq,
          turn: this.currentTurn,
          text,
          images: contentImages(event.data.content),
        }
        this.items.push(item)
        return [{ item, isNew: true }]
      }

      case 'assistant/chunk': {
        const { turn, step, chunk } = event.data
        if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return null
        const stepKey = `${turn}:${step}`
        if (this.finalizedSteps.has(stepKey)) return null
        if (this.streamingStep !== stepKey) {
          // A new step's first delta opens a fresh streaming window; items
          // left streaming by a step that never closed stay frozen as-is.
          this.streamingStep = stepKey
          this.streamingItem = null
          this.streamingThinking = null
          this.pendingReasoning = ''
        }
        if (chunk.type === 'reasoning-delta') {
          // The kimi whitespace guard: reasoning that has shown nothing
          // visible (encrypted or whitespace-only deltas) mounts no block —
          // an empty thinking component would render a bare spinner row.
          if (this.streamingThinking === null) {
            this.pendingReasoning += chunk.text
            if (this.pendingReasoning.trim() === '') return null
            const item: TranscriptThinkingItem = {
              kind: 'thinking',
              seq: event.seq,
              turn,
              step,
              text: this.pendingReasoning,
              streaming: true,
            }
            this.pendingReasoning = ''
            this.streamingThinking = item
            this.items.push(item)
            return [{ item, isNew: true }]
          }
          this.streamingThinking.text += chunk.text
          return [{ item: this.streamingThinking, isNew: false }]
        }
        let isNew = false
        if (this.streamingItem === null) {
          this.streamingItem = {
            kind: 'assistant', seq: event.seq, turn, step, text: '',
          }
          this.items.push(this.streamingItem)
          isNew = true
        }
        this.streamingItem.text += chunk.text
        return [{ item: this.streamingItem, isNew }]
      }

      case 'assistant/message': {
        const { turn, step, message } = event.data
        const stepKey = `${turn}:${step}`
        const text = contentText(message.content).trim()
        const reasoning = reasoningText(message.content)
        this.finalizedSteps.add(stepKey)
        const updates: FoldItemUpdate[] = []
        // The thinking block finalizes from the authoritative reasoning. A
        // step that streamed no visible reasoning of its own (a derived
        // history, a snapshot replay, an encrypted stream) gets its block
        // created here — finalized, ahead of the assistant item, so replay
        // converges with the live mount order (D16).
        if (this.streamingThinking !== null && this.streamingStep === stepKey) {
          this.streamingThinking.text = reasoning
          this.streamingThinking.streaming = false
          this.streamingThinking = null
        } else if (reasoning.trim() !== '') {
          const thinking: TranscriptThinkingItem = {
            kind: 'thinking', seq: event.seq, turn, step, text: reasoning, streaming: false,
          }
          this.items.push(thinking)
          updates.push({ item: thinking, isNew: true })
        }
        if (this.streamingItem !== null && this.streamingStep === stepKey) {
          // The assembled message is authoritative: replace the accumulated
          // chunk text so replay/assembly differences correct themselves.
          this.streamingItem.text = text
          this.streamingStep = null
          const item = this.streamingItem
          this.streamingItem = null
          updates.push({ item, isNew: false })
          return updates
        }
        const item: TranscriptAssistantItem = {
          kind: 'assistant', seq: event.seq, turn, step, text,
        }
        this.items.push(item)
        updates.push({ item, isNew: true })
        return updates
      }

      case 'tool/call': {
        // The todo pane renders the list; the call itself would only echo it
        // into the stream. Track the id so the paired result stays hidden too.
        if (event.data.name === TODO_TOOL_NAME) {
          this.suppressedCalls.add(event.data.callId)
          return null
        }
        const item: TranscriptToolItem = {
          kind: 'tool',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments,
        }
        const parsed = parseToolArguments(item.arguments)
        if (parsed !== undefined) item.parsedArguments = parsed
        if (this.present) {
          const view = this.present.call(item.name, parsed)
          if (view !== undefined) item.view = view
        }
        this.toolsByCallId.set(event.data.callId, item)
        this.items.push(item)
        return [{ item, isNew: true }]
      }

      case 'tool/result': {
        const block = event.data.message.content[0]
        const callId = String(block.toolCallId)
        if (this.suppressedCalls.has(callId)) return null
        const isError = block.isError === true || event.data.error !== undefined
        const result = {
          text: summarizeResult(event.data),
          fullText: fullResultText(event.data),
          isError,
        }
        const rawResult: ToolResult = { content: block.content, isError }
        if (event.data.meta !== undefined) rawResult.meta = event.data.meta
        const paired = this.toolsByCallId.get(callId)
        if (paired) {
          paired.result = result
          paired.rawResult = rawResult
          if (this.present) {
            const view = this.present.result(paired.name, paired.parsedArguments, rawResult)
            // A defined result view replaces the call view; undefined keeps it.
            if (view !== undefined) paired.view = view
          }
          return [{ item: paired, isNew: false }]
        }
        // A result without a visible call (e.g. the call predates a folded
        // window) still renders, named by its result alone.
        const item: TranscriptToolItem = {
          kind: 'tool',
          seq: event.seq,
          turn: event.data.turn,
          step: event.data.step,
          callId,
          name: 'tool',
          arguments: '',
          result,
          rawResult,
        }
        if (this.present) {
          const view = this.present.result(item.name, undefined, rawResult)
          if (view !== undefined) item.view = view
        }
        this.toolsByCallId.set(callId, item)
        this.items.push(item)
        return [{ item, isNew: true }]
      }

      default:
        // step/end, request/*, todo/write, session/*, and merge-extended
        // types unknown to this build render nothing.
        return null
    }
  }

  /**
   * Evict every item at or below a turn (the window policy's frontier).
   * Internal references to evicted items are pruned, so a late event
   * targeting evicted state (a `tool/result` for an evicted call, chunks for
   * an evicted streaming step) hits the ordinary fallback paths instead of
   * mutating items nothing renders. The suppressed-call id set is kept:
   * call ids are unique and never re-targeted, and pruning it would let a
   * late `todo_write` result render unpaired.
   * @param turn - the highest turn number to remove.
   * @returns the evicted items, in session order.
   */
  evictThrough(turn: number): TranscriptItem[] {
    const evicted: TranscriptItem[] = []
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index]!
      if (item.turn <= turn) {
        evicted.unshift(item)
        this.items.splice(index, 1)
      }
    }
    if (evicted.length === 0) return evicted
    const dead = new Set<TranscriptItem>(evicted)
    for (const [callId, item] of this.toolsByCallId) {
      if (dead.has(item)) this.toolsByCallId.delete(callId)
    }
    if (this.streamingItem !== null && dead.has(this.streamingItem)) {
      this.streamingItem = null
      this.streamingStep = null
    }
    if (this.streamingThinking !== null && dead.has(this.streamingThinking)) {
      this.streamingThinking = null
      this.pendingReasoning = ''
    }
    return evicted
  }

  /**
   * Fold one step's tool and thinking items into a single `step-summary`
   * item at the first folded item's position (the S18 kimi wording counts
   * both). The folded tools leave `toolsByCallId`, so a late result renders
   * as an unpaired fallback instead of mutating an item nothing renders; a
   * folded still-streaming thinking item prunes the streaming slot, so a
   * late finalize mounts a fresh finalized block (the `evictThrough`
   * symmetry — unreachable in the live stream, where the step's
   * `assistant/message` always precedes the next `step/start`).
   * @param turn - the turn owning the step.
   * @param step - the step whose items fold.
   * @returns the replacement update, or null when the step produced no tool
   *   or thinking items (assistant/user items are never folded).
   */
  private foldStep(turn: number, step: number): FoldReplacement | null {
    const indices: number[] = []
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      if ((item.kind === 'tool' || item.kind === 'thinking') && item.turn === turn && item.step === step) {
        indices.push(index)
      }
    }
    const first = indices[0]
    if (first === undefined) return null
    const folded = indices.map(index => this.items[index]!)
    const tools = folded.filter((item): item is TranscriptToolItem => item.kind === 'tool')
    const summary: TranscriptStepSummaryItem = {
      kind: 'step-summary',
      seq: folded[0]!.seq,
      turn,
      step,
      toolNames: tools.map(item => item.name),
      thinking: folded.length - tools.length,
    }
    for (const item of tools) {
      if (this.toolsByCallId.get(item.callId) === item) {
        this.toolsByCallId.delete(item.callId)
      }
    }
    for (const item of folded) {
      if (this.streamingThinking === item) {
        this.streamingThinking = null
        this.pendingReasoning = ''
      }
    }
    // Descending splices keep the earlier indices valid; the summary takes
    // the first folded item's slot.
    for (let index = indices.length - 1; index > 0; index -= 1) {
      this.items.splice(indices[index]!, 1)
    }
    this.items[first] = summary
    return { replaced: folded, item: summary }
  }
}

/**
 * Fold a complete event snapshot into transcript items.
 * @param events - the session events, in ascending seq order.
 * @returns the folded transcript items.
 */
export function foldSessionEvents(events: readonly SessionEvent[]): TranscriptItem[] {
  const folder = new TranscriptFolder()
  for (const event of events) folder.apply(event)
  return folder.items
}
