/**
 * Cordis domain plugin registering the append-origin conversation projection
 * with the official Harness session-projection registry.
 *
 * @module @dsh-blue/blue-conversation
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { conversationFactsProjectionDefinition } from './facts.ts'
import { conversationProjectionDefinition } from './projection.ts'
import type { BlueConversationProjectionCapability } from './types.ts'

export * from './types.ts'
export * from './projection.ts'
export * from './facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-conversation'

/** Official domain service required by this projection unit. */
export const inject = ['sessionProjections']

/** Register the state-versioned projection in the caller's Fiber. */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(conversationProjectionDefinition)
  ctx.sessionProjections.register(conversationFactsProjectionDefinition)
  const capability: BlueConversationProjectionCapability = { key: 'blueConversation' }
  ctx.provide('blueConversationProjection', capability)
}
