/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-blue`.
 * @module @deepseek-ai/dsh-blue/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-blue'

/** Cordis companion plugin name. */
export const name = 'blue-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle module mounts no behavior of its own —
 * every Blue row it inserts through `cordis.patch.yml` belongs to a Blue
 * package that audits its own relations — so the bundle holds no event or
 * data relation to check inside the tree.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
