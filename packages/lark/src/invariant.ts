/**
 * Invariant companion for the non-durable Lark compatibility adapter.
 *
 * @module @dsh-blue/blue-lark/invariant
 */
import type { Context } from '@deepseek-ai/cordis'

/** Stable invariant companion name. */
export const name = 'blue-lark-invariant'

/** The adapter emits no domain events; package tests own lifecycle invariants. */
export function apply(_ctx: Context): void {}
