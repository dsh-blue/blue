/**
 * Transcript item model produced by the fold (`src/fold.ts`) plus the pure
 * `blueStatus` contracts behind the footer shell (`src/status.ts`). The
 * `blueSession` service and the `'blue/session-changed'` event this package
 * consumes are owned and declared by `@deepseek-ai/dsh-blue-app`; the merge
 * arrives through the type import in `src/index.ts`.
 *
 * @module @deepseek-ai/dsh-blue-transcript/types
 */

// Pulls in Cordis `Context` for the `blueStatus` declaration merge below; the
// merge lives in the contract layer so the registry implementation and the
// contributing subpath plugins share one declaration site.
import type {} from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueStatus: BlueStatus
  }
}

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
  /**
   * The unsummarized display text the summary was ellipsized from, kept so
   * the Ctrl-O expansion toggle can render the full tool output. Absent only
   * for results constructed outside the fold.
   */
  readonly fullText?: string
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

/**
 * One footer status contribution. `render` returns a single styled line
 * (ANSI allowed) whose visible width never exceeds the offered budget; an
 * empty string hides the entry for the frame — it then occupies nothing, not
 * even a separator slot.
 */
export interface BlueStatusEntry {
  /** Stable, unique entry id (dotted, plugin-owned). */
  readonly id: string
  /**
   * Layout order: entries fill the footer in ascending priority, and ties
   * keep registration order. The baseline entry (`blue-status-basic`) is 0,
   * the bundled enhancements 10 and 20, leaving room between and after.
   */
  readonly priority: number
  /**
   * Render the entry within the offered width budget.
   * @param width - remaining row width in columns.
   * @returns one styled line, or '' to hide the entry this frame.
   */
  render(width: number): string
}

/** `ctx.blueStatus` — the status-entry registry feeding the footer shell. */
export interface BlueStatus {
  /**
   * Register one entry. A duplicate id throws (same conflict discipline as
   * the keymap): every live id is claimed by at most one entry.
   * @param entry - the entry to add.
   * @returns a disposer unregistering the entry; safe to call twice.
   */
  register(entry: BlueStatusEntry): () => void
}

/** Re-exported so consumers of the fold model need no second import site. */
export type { SessionEvent }
