/**
 * Invariant companion for the Blue API package.
 *
 * @module @dsh-blue/blue-api/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'blue-api-invariant'

/** Register API package invariants when the host exposes an invariants service. */
export function apply(_ctx: Context): void {
  // The API package has no runtime state; host-level invariant registration is
  // intentionally deferred until the plugin host exists.
}
