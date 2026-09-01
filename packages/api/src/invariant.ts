/**
 * Invariant companion for the Blue API package.
 *
 * @module @dsh-blue/blue-api/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'blue-api-invariant'

/** Inert companion entry for the API package's lifecycle-only invariants. */
export function apply(_ctx: Context): void {
  // The direct registries are covered by lifecycle tests and own no data
  // relation requiring a runtime invariant.
}
