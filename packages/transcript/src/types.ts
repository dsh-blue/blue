/**
 * Transcript item model produced by the fold (`src/fold.ts`) plus the pure
 * `blueStatus` and `blueIntents` contracts behind the footer shell
 * (`src/status.ts`) and the render-intent registry (`src/intents.ts`). The
 * `blueSession` service and the `'blue/session-changed'` event this package
 * consumes are owned and declared by `@dsh-blue/blue-app`; the merge
 * arrives through the type import in `src/index.ts`.
 *
 * @module @dsh-blue/blue-transcript/types
 */

// Pulls in Cordis `Context` for the `blueStatus`/`blueIntents` declaration
// merges below; the merges live in the contract layer so the registry
// implementations and the contributing subpath plugins share one declaration
// site.
import type {} from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  BlueComponent,
  BlueComponents,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueStatus: BlueStatus
    blueIntents: BlueIntents
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
  /** `JSON.parse` of {@link arguments}; absent when the raw string is invalid. */
  parsedArguments?: unknown
  /** Present once the paired `tool/result` event has folded in. */
  result?: TranscriptToolResult
  /**
   * The reconstructed `ToolResult` (`content`, `isError`, optional `meta`)
   * handed to the `presentResult` hook; set alongside {@link result}.
   */
  rawResult?: ToolResult
  /**
   * The resolved render intent: the call view once `tool/call` folds, replaced
   * by the result view when `presentResult` returns one. Absent without a
   * `present` hook or when the presenters decline.
   */
  view?: ToolCallView | ToolResultView
}

/**
 * One folded-away mid-turn step: replaces the step's tool items in place when
 * the next `step/start` arrives (in-turn step folding). `toolNames` keeps
 * duplicates in call order; rendering does the ×N counting.
 */
export interface TranscriptStepSummaryItem {
  readonly kind: 'step-summary'
  /** Seq of the first folded tool item. */
  readonly seq: number
  /** Turn and step the folded tools belonged to. */
  readonly turn: number
  readonly step: number
  /** Tool names in call order, duplicates kept. */
  readonly toolNames: string[]
}

/** One rendered row group of the transcript, in session order. */
export type TranscriptItem =
  | TranscriptUserItem
  | TranscriptAssistantItem
  | TranscriptThinkingItem
  | TranscriptToolItem
  | TranscriptStepSummaryItem

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
   * the bundled enhancements 5/10/20/30, leaving room between and after.
   */
  readonly priority: number
  /**
   * Which footer band the entry lays out in — 1 (above) or 2 (below). The
   * default is 1. Values outside the shell's band budget are clamped into
   * it, never dropped.
   */
  readonly row?: 1 | 2
  /**
   * The horizontal cluster the entry joins within its band. The default is
   * `'left'`. A `'right'` entry is right-aligned after a minimum gap and
   * yields before the left cluster under width pressure; any other value is
   * treated as `'left'`.
   */
  readonly align?: 'left' | 'right'
  /**
   * Render the entry within the offered width budget. Called exactly once
   * per frame the shell lays out: a left-cluster entry's budget is the width
   * remaining in its band's left cluster, a right-cluster entry's is what
   * remains after the left cluster and the inter-cluster gap.
   * @param width - remaining cluster width in columns.
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

/** The props handed to a {@link BlueIntentEntry} factory. */
export interface BlueIntentProps {
  /** The tool item to render (carries the resolved `view`). */
  readonly item: TranscriptToolItem
  /** The semantic color table. */
  readonly colors: BlueSemanticColors
  /** The component factory providing width helpers and Markdown/image parts. */
  readonly components: BlueComponents
  /** The current Ctrl-O expansion state to assume at creation. */
  readonly expanded: boolean
}

/**
 * A component created through an intent entry. `setExpanded` is optional:
 * entries without it are skipped by the Ctrl-O expansion toggle.
 */
export interface BlueIntentComponent extends BlueComponent {
  /**
   * Switch between the collapsed and expanded presentation, if supported.
   * @param expanded - true renders the full detail, false the summary.
   */
  setExpanded?(expanded: boolean): void
}

/**
 * One render-intent contribution: `create` builds the component for a tool
 * item whose resolved view selects this intent. The built-in `'generic'`
 * entry is the fallback for every unknown intent.
 */
export interface BlueIntentEntry {
  /** The intent name, matched against a view's `card` tag. */
  readonly intent: string
  /**
   * Create the component rendering one tool item.
   * @param props - the item, colors, factory, and expansion state.
   * @returns the component to mount.
   */
  create(props: BlueIntentProps): BlueIntentComponent
}

/** `ctx.blueIntents` — the render-intent registry behind tool-card creation. */
export interface BlueIntents {
  /**
   * Register one entry. A duplicate intent throws (same conflict discipline
   * as the status registry): every live intent is claimed by at most one
   * entry.
   * @param entry - the entry to add.
   * @returns a disposer unregistering the entry; safe to call twice.
   */
  register(entry: BlueIntentEntry): () => void
  /**
   * Resolve the entry for one intent: exact match, else the `'generic'`
   * entry, else the first registered entry. Never throws for an unknown
   * intent — only for a registry with no entries at all.
   * @param intent - the intent name (a view's `card` tag).
   * @returns the entry to create the component with.
   */
  resolve(intent: string): BlueIntentEntry
}

/** Re-exported so consumers of the fold model need no second import site. */
export type { SessionEvent }
