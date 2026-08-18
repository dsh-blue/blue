/**
 * Pure fold from `SessionEvent[]` to `TranscriptItem[]`: no UI, no Cordis,
 * no imports beyond the session/LLM types. The mounter (`src/index.ts`) uses
 * the stateful {@link TranscriptFolder} for both the resume snapshot and the
 * live `session/event` feed; {@link foldSessionEvents} is the one-shot form.
 *
 * Folded: `user/message` → user item; `assistant/chunk` text/reasoning
 * deltas accumulate into one streaming assistant item per step;
 * `assistant/message` finalizes it from the authoritative assembled message;
 * `tool/call` + `tool/result` pair by `callId` into one tool item. All other
 * event types (turn/step boundaries, request records, log-only markers, and
 * merge-extended unknowns) render nothing.
 *
 * @module @deepseek-ai/dsh-blue-transcript/fold
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  TranscriptAssistantItem,
  TranscriptItem,
  TranscriptToolItem,
} from './types.ts'

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

/**
 * The fold's answer to one event: the item the event created or mutated.
 * `isNew` tells the mounter to mount a component; otherwise the existing
 * component for {@link FoldUpdate.item} re-renders.
 */
export interface FoldUpdate {
  /** The created or mutated item (object identity is stable per item). */
  item: TranscriptItem
  /** Whether the item was just appended to {@link TranscriptFolder.items}. */
  isNew: boolean
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

  private streamingStep: string | null = null
  private streamingItem: TranscriptAssistantItem | null = null
  private readonly finalizedSteps = new Set<string>()
  private readonly toolsByCallId = new Map<string, TranscriptToolItem>()

  /**
   * Fold one event into the transcript.
   * @param event - the next session event, in ascending seq order.
   * @returns the created or mutated item, or null when the event renders
   *   nothing (boundaries, log-only records, unknown types).
   */
  apply(event: SessionEvent): FoldUpdate | null {
    switch (event.type) {
      case 'user/message': {
        const text = contentText(event.data.content)
        if (!text.trim()) return null
        const item: TranscriptItem = { kind: 'user', seq: event.seq, text }
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
          this.streamingItem = { kind: 'assistant', seq: event.seq, text: '', reasoning: '', streaming: true }
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
        const item: TranscriptAssistantItem = { kind: 'assistant', seq: event.seq, text, reasoning, streaming: false }
        this.items.push(item)
        return { item, isNew: true }
      }

      case 'tool/call': {
        const item: TranscriptToolItem = {
          kind: 'tool',
          seq: event.seq,
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments,
        }
        this.toolsByCallId.set(event.data.callId, item)
        this.items.push(item)
        return { item, isNew: true }
      }

      case 'tool/result': {
        const block = event.data.message.content[0]
        const callId = String(block.toolCallId)
        const result = {
          text: summarizeResult(event.data),
          fullText: fullResultText(event.data),
          isError: block.isError === true || event.data.error !== undefined,
        }
        const paired = this.toolsByCallId.get(callId)
        if (paired) {
          paired.result = result
          return { item: paired, isNew: false }
        }
        // A result without a visible call (e.g. the call predates a folded
        // window) still renders, named by its result alone.
        const item: TranscriptToolItem = {
          kind: 'tool',
          seq: event.seq,
          callId,
          name: 'tool',
          arguments: '',
          result,
        }
        this.toolsByCallId.set(callId, item)
        this.items.push(item)
        return { item, isNew: true }
      }

      default:
        // turn/*, step/*, request/*, todo/write, session/*, and
        // merge-extended types unknown to this build render nothing.
        return null
    }
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
