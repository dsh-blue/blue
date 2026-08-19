/**
 * Read the agent currently attached to the Blue UI through the app-owned
 * `blueSession` service.
 *
 * @module @dsh-blue/blue-interaction/session
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Empty type import carries the app-owned `blueSession` Context merge.
import type {} from '@dsh-blue/blue-app'

/**
 * Resolve the UI's current agent. Uses `ctx.get` (never `inject`) because
 * the app plugin may activate after this package; `undefined` means no
 * session is attached yet.
 * @param ctx - any context in the tree.
 * @returns the current agent, or `undefined` when none is attached.
 */
export function currentBlueAgent(ctx: Context): Agent | undefined {
  return ctx.get('blueSession')?.current ?? undefined
}
