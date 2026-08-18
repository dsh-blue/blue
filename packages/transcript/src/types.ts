/**
 * Transcript item model produced by the fold (`src/fold.ts`). The
 * `blueSession` service and the `'blue/session-changed'` event this package
 * consumes are owned and declared by `@deepseek-ai/dsh-blue-app`; the merge
 * arrives through the type import in `src/index.ts`.
 *
 * @module @deepseek-ai/dsh-blue-transcript/types
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** A user prompt rendered in the transcript. */
export interface TranscriptUserItem {
  readonly kind: 'user'
  /** Seq of the `user/message` event this item renders. */
  readonly seq: number
  /** Visible text joined from the message's text blocks, `\n`-separated. */
  readonly text: string
}

/**
 * One assistant step rendered in the transcript. Fields mutate while the
 * step streams: `assistant/chunk` deltas append, and the closing
 * `assistant/message` rewrites them from the authoritative assembled message.
 */
export interface TranscriptAssistantItem {
  readonly kind: 'assistant'
  /** Seq of the first event that opened this item. */
  readonly seq: number
  /** Accumulated visible Markdown text. */
  text: string
  /** Accumulated reasoning text, rendered muted above the answer. */
  reasoning: string
  /** True until the step's `assistant/message` finalizes the item. */
  streaming: boolean
}

/** The folded outcome of one tool invocation. */
export interface TranscriptToolResult {
  /** One-line display summary (result text or a string `meta` payload). */
  readonly text: string
  /** Whether the tool reported failure. */
  readonly isError: boolean
}

/** A tool call, paired with its result when one has arrived. */
export interface TranscriptToolItem {
  readonly kind: 'tool'
  /** Seq of the `tool/call` event (or of an unpaired `tool/result`). */
  readonly seq: number
  /** Provider-issued call id pairing `tool/call` with `tool/result`. */
  readonly callId: string
  /** Tool name exactly as the model requested it. */
  readonly name: string
  /** Raw JSON arguments string as produced by the model. */
  readonly arguments: string
  /** Present once the paired `tool/result` event has folded in. */
  result?: TranscriptToolResult
}

/** One rendered row group of the transcript, in session order. */
export type TranscriptItem = TranscriptUserItem | TranscriptAssistantItem | TranscriptToolItem

/** Re-exported so consumers of the fold model need no second import site. */
export type { SessionEvent }
