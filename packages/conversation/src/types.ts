/**
 * Renderer-independent conversation projection facts and projection-table
 * declaration merges.
 *
 * @module @dsh-blue/blue-conversation/types
 */

import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo'

/** Load-order signal published only after `blueConversation` is registered. */
export interface BlueConversationReady {
  readonly key: 'blueConversation'
}

/** Lossless JSON accepted by the Harness session log and projection cache. */
export type ConversationJson = null | boolean | number | string | ConversationJson[] | { [key: string]: ConversationJson }

/** Durable image reference copied from a user message without loading bytes. */
export interface ConversationImage {
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string | undefined
  readonly originalDimensions?: Readonly<{ width: number, height: number }> | undefined
}

interface ConversationEntryBase {
  readonly id: string
  readonly seq: number
  readonly turn: number
}

/** One direct human message. Synthetic context injections are excluded. */
export interface ConversationUserEntry extends ConversationEntryBase {
  readonly kind: 'user'
  readonly text: string
  readonly images: readonly ConversationImage[]
}

/** One assistant answer, updated in place while chunks arrive. */
export interface ConversationAssistantEntry extends ConversationEntryBase {
  readonly kind: 'assistant'
  readonly step: number
  readonly text: string
  readonly streaming: boolean
}

/** One assistant reasoning block, separate from its visible answer. */
export interface ConversationThinkingEntry extends ConversationEntryBase {
  readonly kind: 'thinking'
  readonly step: number
  readonly text: string
  readonly streaming: boolean
}

/** Canonical result facts preserved for an official tool presenter. */
export interface ConversationToolResult {
  readonly content: readonly ConversationJson[]
  readonly text: string
  readonly isError: boolean
  readonly endedAt: number
  readonly meta?: ConversationJson | undefined
}

/** One tool call, paired with its result when available. */
export interface ConversationToolEntry extends ConversationEntryBase {
  readonly kind: 'tool'
  readonly step: number
  readonly callId: string
  readonly name: string
  readonly arguments: string
  readonly startedAt: number
  readonly channel: 'transcript' | 'todo' | 'agents'
  readonly result?: ConversationToolResult | undefined
}

/** Structured turn failure. */
export interface ConversationErrorEntry extends ConversationEntryBase {
  readonly kind: 'error'
  readonly message: string
  readonly code?: string | undefined
}

/** Durable marker for a turn cut before normal completion. */
export interface ConversationInterruptedEntry extends ConversationEntryBase {
  readonly kind: 'interrupted'
}

/** Complete frontend-relevant entry vocabulary of the projection. */
export type ConversationEntry =
  | ConversationUserEntry
  | ConversationAssistantEntry
  | ConversationThinkingEntry
  | ConversationToolEntry
  | ConversationErrorEntry
  | ConversationInterruptedEntry

/** Client-visible whole value served by `sessionProjections`. */
export interface ConversationProjection {
  readonly entries: readonly ConversationEntry[]
  readonly streaming: boolean
}

/** Plain-JSON internal fold state checkpointed by the registry. */
export interface ConversationProjectionState {
  readonly entries: readonly ConversationEntry[]
  readonly currentTurn: number
  readonly active: boolean
  readonly streamingStep: string | null
  readonly streamingAssistantId: string | null
  readonly streamingThinkingId: string | null
  readonly pendingReasoning: string
  readonly finalizedSteps: readonly string[]
  readonly interruptedTurns: readonly number[]
  /** Turns durably erased by Blue's safe-retraction surface marker. */
  readonly retractedTurns: readonly number[]
  readonly toolEntryIds: Readonly<Record<string, string>>
}

/**
 * Renderer-independent facts shared by status and dock consumers. The
 * projection owns event reduction; consumers never need the Session object or
 * a second event fold. Every field is a whole current value so replay and live
 * drives converge identically.
 */
export interface ConversationFacts {
  readonly phase: 'idle' | 'waiting' | 'thinking' | 'composing' | 'tool'
  readonly active: boolean
  readonly turn: number
  readonly flowUp?: number | undefined
  readonly flowDownChars: number
  readonly todos: readonly TodoItem[]
  readonly contextTokens: number
  readonly contextWindow?: number | undefined
  readonly model?: string | undefined
  readonly provider?: string | undefined
  readonly reasoningEffort?: string | undefined
  /** Latest human prompt in the current run, used for fork-child correlation. */
  readonly promptText?: string | undefined
  /** Per-run dispatched tool count, reset by `turn/start`. */
  readonly epochToolCount?: number | undefined
  /** Per-run token total with replace-per-step usage semantics. */
  readonly epochTokens?: number | undefined
  /** Projection-private usage buckets retained as plain readonly data. */
  readonly usageByStep?: Readonly<Record<string, number>> | undefined
  /** Latest running activity marker. */
  readonly activity?: Readonly<{ readonly kind: 'reasoning' | 'text' | 'tool', readonly name?: string | undefined }> | undefined
  /** Terminal outcome of the latest run. */
  readonly runOutcome?: 'completed' | 'failed' | undefined
  /** Envelope timestamp of the latest terminal outcome. */
  readonly endedAt?: number | undefined
  readonly agentCalls: readonly ConversationAgentCall[]
}

/** Projection facts for one `subagent`/`subagent_fork` call. */
export interface ConversationAgentCall {
  readonly seq: number
  readonly turn: number
  readonly step: number
  readonly callId: string
  readonly name: 'subagent' | 'subagent_fork'
  readonly arguments: string
  readonly startedAt: number
  readonly result?: {
    readonly text: string
    readonly isError: boolean
    readonly endedAt: number
  } | undefined
}

/** Plain-JSON state checkpointed for {@link ConversationFacts}. */
export interface ConversationFactsState extends ConversationFacts {}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    blueConversation: ConversationProjection
    blueConversationFacts: ConversationFacts
  }

  interface SessionProjectionStateMap {
    blueConversation: ConversationProjectionState
    blueConversationFacts: ConversationFactsState
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueConversationReady: BlueConversationReady
  }
}
