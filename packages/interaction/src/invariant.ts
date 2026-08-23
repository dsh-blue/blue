/**
 * Package-owned invariant companion for `@dsh-blue/blue-interaction`.
 * @module @dsh-blue/blue-interaction/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@dsh-blue/blue-interaction'

/** Cordis companion plugin name. */
export const name = 'blue-interaction-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package's durable relationships are owned and
 * audited by the seam packages it consumes — command lifecycle pairing by
 * `@deepseek-ai/dsh-commands`, approval audit pairing by
 * `@deepseek-ai/dsh-user-approval`. Its own state (overlay handles, the
 * input buffer) is transient UI state with no cross-plugin event or data
 * relation to assert; provider registration/disposal is pinned by the
 * package's HMR-safety tests instead.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
