/**
 * Invariant companion for the domain-only conversation projection.
 *
 * @module @dsh-blue/blue-conversation/invariant
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable invariant plugin name. */
export const name = 'blue-conversation-invariant'

/** The projection relies on the official registry's own invariant checks. */
export function apply(_ctx: Context): void {}
