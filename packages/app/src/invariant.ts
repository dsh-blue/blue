/**
 * Package-owned invariant companion for `@dsh-blue/blue-app`.
 * @module @dsh-blue/blue-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './types.ts'

const PACKAGE_NAME = '@dsh-blue/blue-app'

/** Cordis companion plugin name. */
export const name = 'blue-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * The session-changed broadcast is the commit point of a create/resume
 * switch: when it fires, the blueSession reference must already point at the
 * broadcast Agent with its model-selection handle published, so a consumer
 * re-reading the reference can never observe the previous (already disposed)
 * one or a selection belonging to it.
 */
const install: InvariantInstaller = (ctx, fail) => {
  ctx.on('blue/session-changed', (agent) => {
    const session = ctx.get('blueSession')
    if (session === undefined) {
      fail('blue/session-changed fired without the blueSession service')
    } else if (session.current !== agent) {
      fail('blue/session-changed fired before blueSession.current pointed at the broadcast Agent')
    } else if (session.modelRef === undefined) {
      fail('blue/session-changed fired before blueSession.modelRef was published')
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
