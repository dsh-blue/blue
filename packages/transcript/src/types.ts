/**
 * Renderer-only transcript item shapes shared by semantic components.
 *
 * @module @dsh-blue/blue-transcript/types
 */

// Pulls in Cordis `Context` for the model-service declaration merges below.
import type {} from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueStatusEntries: import('./status-model.ts').BlueStatusEntryService
    blueBottomPanes: import('./dock-model.ts').BlueBottomPaneService
  }
}

/** A user prompt rendered in the transcript. */
export interface TranscriptUserItem {
  readonly kind: 'user'
  /** Seq of the `user/message` event this item renders. */
  readonly seq: number
  /** Turn the message opened (tracked from `turn/start`, 0 before any). */
  readonly turn: number
  /** Visible text joined from the message's text blocks, `\n`-separated. */
  readonly text: string
  /** The message's image attachments, in block order; empty when none. */
  readonly images: ImageAttachmentRef[]
}

/**
 * One assistant step's reasoning rendered as its own transcript block (the
 * S17 kimi split: thinking mounts separately from the answer, live with a
 * spinner and finalized in place). Fields mutate while the step streams:
 * `assistant/chunk` reasoning deltas append, and the closing
 * `assistant/message` rewrites the text from the authoritative assembled
 * message.
 */
export interface TranscriptThinkingItem {
  readonly kind: 'thinking'
  /** Seq of the first event that opened this item. */
  readonly seq: number
  /** Turn and step the reasoning belongs to. */
  readonly turn: number
  readonly step: number
  /** Accumulated reasoning text. */
  text: string
  /** True until the step's `assistant/message` finalizes the item. */
  streaming: boolean
}

/**
 * One assistant step rendered in the transcript. The text mutates while the
 * step streams: `assistant/chunk` text deltas append, and the closing
 * `assistant/message` rewrites it from the authoritative assembled message.
 * The step's reasoning streams into a sibling
 * {@link TranscriptThinkingItem} mounted above this block. No streaming
 * marker survives on this item: the retired cursor was its only consumer,
 * and kimi renders growing text with no cursor at all (the S17 third
 * dogfood ruling).
 */
export interface TranscriptAssistantItem {
  readonly kind: 'assistant'
  /** Seq of the first event that opened this item. */
  readonly seq: number
  /** Turn and step the item belongs to. */
  readonly turn: number
  readonly step: number
  /** Accumulated visible Markdown text. */
  text: string
}

/** The folded outcome of one tool invocation. */
export interface TranscriptToolResult {
  /** One-line display summary (result text or a string `meta` payload). */
  readonly text: string
  /**
   * The unsummarized display text the summary was ellipsized from, kept so
   * the Ctrl-O expansion toggle can render the full tool output. Absent only
   * for results constructed outside the fold.
   */
  readonly fullText?: string
  /** Whether the tool reported failure. */
  readonly isError: boolean
  /** Unix epoch ms of the `tool/result` event envelope (S33 elapsed). */
  readonly endedAt: number
}

/** A tool call, paired with its result when one has arrived. */
export interface TranscriptToolItem {
  readonly kind: 'tool'
  /** Seq of the `tool/call` event (or of an unpaired `tool/result`). */
  readonly seq: number
  /** Turn and step the call belongs to. */
  readonly turn: number
  readonly step: number
  /** Provider-issued call id pairing `tool/call` with `tool/result`. */
  readonly callId: string
  /** Tool name exactly as the model requested it. */
  readonly name: string
  /** Raw JSON arguments string as produced by the model. */
  readonly arguments: string
  /** Unix epoch ms of the `tool/call` event envelope (S33 elapsed). */
  readonly startedAt: number
  /** `JSON.parse` of {@link arguments}; absent when the raw string is invalid. */
  parsedArguments?: unknown
  /** Present once the paired `tool/result` event has folded in. */
  result?: TranscriptToolResult
}

/** A turn that failed: the `turn/end` error reason rendered as a row, so a
 * dead endpoint is never silent (the S23 dogfood ruling — a 404 completion
 * route left the transcript blank while the pane spinner idled). */
export interface TranscriptErrorItem {
  readonly kind: 'error'
  /** Seq of the `turn/end` event. */
  readonly seq: number
  /** Turn that failed. */
  readonly turn: number
  /** The structured failure's message (already human-readable). */
  readonly message: string
  /** The structured failure's machine code, when present. */
  readonly code?: string
}

/** A turn whose stream was cut before completing: the `turn/end` `aborted`
 * reason (an Esc interrupt, a parent or hook cancellation) or the
 * persistence backend's crash-recovery `interrupted` marker, rendered as
 * one muted row so the cut is visible instead of the stream just going
 * quiet (the S24a dogfood ruling). */
export interface TranscriptInterruptedItem {
  readonly kind: 'interrupted'
  /** Seq of the `turn/end` event. */
  readonly seq: number
  /** Turn that was cut. */
  readonly turn: number
}

/**
 * One folded-away mid-turn step: replaces the step's tool and thinking items
 * in place when the next `step/start` arrives (in-turn step folding).
 * `toolNames` keeps duplicates in call order; rendering counts them, and
 * `thinking` carries the step's folded reasoning blocks (0 or 1 — a step
 * owns at most one thinking item).
 */
export interface TranscriptStepSummaryItem {
  readonly kind: 'step-summary'
  /** Seq of the first folded tool item. */
  readonly seq: number
  /** Turn and step the folded items belonged to. */
  readonly turn: number
  readonly step: number
  /** Tool names in call order, duplicates kept. */
  readonly toolNames: string[]
  /** Number of folded thinking blocks from the step. */
  readonly thinking: number
}

/** One rendered row group of the transcript, in session order. */
export type TranscriptItem =
  | TranscriptUserItem
  | TranscriptAssistantItem
  | TranscriptThinkingItem
  | TranscriptToolItem
  | TranscriptStepSummaryItem
  | TranscriptErrorItem
  | TranscriptInterruptedItem

/** Re-exported so consumers of the fold model need no second import site. */
export type { SessionEvent }
