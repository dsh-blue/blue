/**
 * Package-owned invariant companion for `@dsh-blue/blue-core`.
 * @module @dsh-blue/blue-core/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-blue/blue-core'

/** Cordis companion plugin name. */
export const name = 'blue-core-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns a terminal lifecycle and three
 * delegating services whose mutable state lives entirely inside pi-tui
 * internals; it emits no events and holds no cross-plugin data relation to
 * audit. Terminal restore on unload and keymap conflict rejection are
 * behavior contracts pinned by the package's own tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
