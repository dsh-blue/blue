/**
 * Pure fold from `SessionEvent[]` to `TranscriptItem[]`: no UI, no Cordis,
 * no imports beyond the session/LLM/tools types and the window policy. The
 * mounter (`src/index.ts`) uses the stateful {@link TranscriptFolder} for
 * both the resume snapshot and the live `session/event` feed;
 * {@link foldSessionEvents} is the one-shot form.
 *
 * Folded: `user/message` → user item (image blocks kept as
 * `ImageAttachmentRef`s alongside the `[image]` text placeholder);
 * `assistant/chunk` text/reasoning deltas accumulate into one streaming
 * assistant item per step; `assistant/message` finalizes it from the
 * authoritative assembled message; `tool/call` + `tool/result` pair by
 * `callId` into one tool item carrying the parsed arguments, the
 * reconstructed `ToolResult`, and the render intent resolved through the
 * optional `present` hooks. `turn/start`/`step/start`/`turn/end` drive the
 * turn/step tagging, the completed-turn list the window policy evicts on,
 * and in-turn step folding: the next `step/start` of a turn folds the
 * previous step's tool items into one `step-summary` item. All other event
 * types (request records, log-only markers, and merge-extended unknowns)
 * render nothing.
 *
 * @module @deepseek-ai/dsh-blue-transcript/fold
 */

import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
import { parseToolArguments } from './present.ts'
import type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from './types.ts'
import { isStepFoldingEnabled } from './window.ts'

/** Maximum length of the one-line tool-result summary. */
export const RESULT_SUMMARY_MAX_CHARS = 160

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
 * The fold's answer to in-turn step folding: the step's tool items were
 * replaced in place (at the first folded item's position) by one
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
  private readonly finalizedSteps = new Set<string>()
  private readonly toolsByCallId = new Map<string, TranscriptToolItem>()

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
   * @returns the created/mutated item, a step-summary replacement, or null
   *   when the event renders nothing (log-only records, unknown types).
   */
  apply(event: SessionEvent): FoldUpdate | null {
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
        // In-turn step folding: the previous step's tool cards collapse into
        // one summary line once the next step starts. The turn's final step
        // never folds this way — no later step/start arrives for it.
        if (isStepFoldingEnabled() && previous !== null && previous.turn === turn) {
          return this.foldStep(turn, previous.step)
        }
        return null
      }

      case 'turn/end': {
        this.completed.push(event.data.turn)
        this.lastStep = null
        return null
      }

      case 'user/message': {
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
        return { item, isNew: true }
      }

      case 'assistant/chunk': {
        const { turn, step, chunk } = event.data
        if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') return null
        const stepKey = `${turn}:${step}`
        if (this.finalizedSteps.has(stepKey)) return null
        let isNew = false
        if (this.streamingStep !== stepKey || this.streamingItem === null) {
          this.streamingItem = {
            kind: 'assistant', seq: event.seq, turn, step, text: '', reasoning: '', streaming: true,
          }
          this.streamingStep = stepKey
          this.items.push(this.streamingItem)
          isNew = true
        }
        if (chunk.type === 'text-delta') this.streamingItem.text += chunk.text
        else this.streamingItem.reasoning += chunk.text
        return { item: this.streamingItem, isNew }
      }

      case 'assistant/message': {
        const { turn, step, message } = event.data
        const stepKey = `${turn}:${step}`
        const text = contentText(message.content).trim()
        const reasoning = reasoningText(message.content)
        this.finalizedSteps.add(stepKey)
        if (this.streamingStep === stepKey && this.streamingItem !== null) {
          // The assembled message is authoritative: replace the accumulated
          // chunk text so replay/assembly differences correct themselves.
          this.streamingItem.text = text
          this.streamingItem.reasoning = reasoning
          this.streamingItem.streaming = false
          this.streamingStep = null
          const item = this.streamingItem
          this.streamingItem = null
          return { item, isNew: false }
        }
        const item: TranscriptAssistantItem = {
          kind: 'assistant', seq: event.seq, turn, step, text, reasoning, streaming: false,
        }
        this.items.push(item)
        return { item, isNew: true }
      }

      case 'tool/call': {
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
        return { item, isNew: true }
      }

      case 'tool/result': {
        const block = event.data.message.content[0]
        const callId = String(block.toolCallId)
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
          return { item: paired, isNew: false }
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
        return { item, isNew: true }
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
   * mutating items nothing renders.
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
    return evicted
  }

  /**
   * Fold one step's tool items into a single `step-summary` item at the
   * first folded item's position. The folded items leave `toolsByCallId`, so
   * a late result renders as an unpaired fallback instead of mutating an
   * item nothing renders.
   * @param turn - the turn owning the step.
   * @param step - the step whose tool items fold.
   * @returns the replacement update, or null when the step produced no tool
   *   items (assistant/user items are never folded).
   */
  private foldStep(turn: number, step: number): FoldReplacement | null {
    const indices: number[] = []
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      if (item.kind === 'tool' && item.turn === turn && item.step === step) {
        indices.push(index)
      }
    }
    const first = indices[0]
    if (first === undefined) return null
    const folded = indices.map(index => this.items[index] as TranscriptToolItem)
    const summary: TranscriptStepSummaryItem = {
      kind: 'step-summary',
      seq: folded[0]!.seq,
      turn,
      step,
      toolNames: folded.map(item => item.name),
    }
    for (const item of folded) {
      if (this.toolsByCallId.get(item.callId) === item) {
        this.toolsByCallId.delete(item.callId)
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
