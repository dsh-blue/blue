/**
 * Package-owned invariant companion for `@dsh-blue/blue-app`.
 * @module @dsh-blue/blue-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-blue/blue-app'

/** Cordis companion plugin name. */
export const name = 'blue-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** The app's renderer-neutral reader/action contracts are covered by lifecycle tests. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
