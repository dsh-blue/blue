/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-blue-transcript`.
 * @module @deepseek-ai/dsh-blue-transcript/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-blue-transcript'

/** Cordis companion plugin name. */
export const name = 'blue-transcript-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the transcript is a read-only presentation mirror of
 * the session log, and every event/data relation it relies on (seq
 * contiguity, tool call/result pairing, surface discipline) is asserted by
 * `@deepseek-ai/dsh-session`'s own invariant companion at the authoritative
 * source. The package holds no further owned relationship to audit.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
