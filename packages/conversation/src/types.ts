/**
 * Renderer-independent conversation projection facts and projection-table
 * declaration merges.
 *
 * @module @dsh-blue/blue-conversation/types
 */

import type {} from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** Readiness capability published only after `blueConversation` is registered. */
export interface BlueConversationProjectionCapability {
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
  readonly toolEntryIds: Readonly<Record<string, string>>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    blueConversation: ConversationProjection
  }

  interface SessionProjectionStateMap {
    blueConversation: ConversationProjectionState
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueConversationProjection: BlueConversationProjectionCapability
  }
}
