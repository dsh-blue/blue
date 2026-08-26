/**
 * Invariant companion for the stateless OpenPencil presentation adapter.
 *
 * @module @dsh-blue/blue-openpencil/invariant
 */
import type { Context } from '@deepseek-ai/cordis'

/** Stable invariant companion name. */
export const name = 'blue-openpencil-invariant'

/** The adapter owns no durable events; lifecycle is covered by package tests. */
export function apply(_ctx: Context): void {}
