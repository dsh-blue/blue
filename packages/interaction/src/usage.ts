/**
 * The `/usage` and `/status` read layer (S25): pure token formatting plus
 * the thin projection-backed reads the two panels paint from. No
 * accumulator or Harness event fold lives here — blue-app owns the current
 * session details snapshot and this module only formats its immutable facts.
 *
 * @module @dsh-blue/blue-interaction/usage
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
/** The four disjoint provider-usage buckets both panels list. */
export interface TokenBuckets {
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/**
 * The context-occupancy pair the panels render: the numerator is the
 * projection's next-request estimate when the provider has reported usage
 * (`projectedTokens`, else `pressureTokens`), the denominator the newest
 * advertised window. Both absent until a request reports or advertises.
 */
export interface ContextFacts {
  readonly used?: number
  readonly window?: number
}

/** Everything the `/usage` panel paints. */
export interface UsageFacts {
  /** Cumulative provider usage over the whole durable log. */
  readonly buckets: TokenBuckets
  /** Context occupancy; fields absent until known. */
  readonly context: ContextFacts
}

/** The heuristic composition of the next request (the CC `/context` rows). */
export interface CompositionFacts {
  readonly system: number
  readonly tools: number
  readonly messages: number
}

/**
 * One decimal, trailing `.0` trimmed: 1 → `1`, 1.5 → `1.5`.
 * @param value - the value to format.
 * @returns the trimmed one-decimal representation.
 */
function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/**
 * Compact 1024-base token formatting (the kimi `/usage` port; the footer's
 * `status-context` twin): the plain integer below 1024, `x.yk` at or above
 * it (rounded at 100k), `x.yM` at or above 1 MiB. Context windows are
 * powers of two, so the binary base keeps abbreviations exact — 262144
 * renders as `256k`. Non-finite or negative input formats as `0`.
 * @param tokens - the token count.
 * @returns the formatted count.
 */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '0'
  if (tokens >= 1024 * 1024) return `${trimDecimal(tokens / (1024 * 1024))}M`
  if (tokens >= 1024) {
    const k = tokens / 1024
    return `${k >= 100 ? String(Math.round(k)) : trimDecimal(k)}k`
  }
  return String(tokens)
}

/**
 * The usage share of a context window, in whole percents: rounded up so
 * partial use never reads as empty, clamped to [0, 100], a non-zero share
 * always at least 1. A non-finite or non-positive window reports 0.
 * @param used - the occupied tokens.
 * @param max - the context window.
 * @returns the share in percent.
 */
export function usagePercent(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || used <= 0 || max <= 0) return 0
  return Math.min(100, Math.max(1, Math.ceil((used / max) * 100)))
}

/**
 * A usage ratio clamped to [0, 1] (NaN-safe) for bar rendering.
 * @param used - the occupied tokens.
 * @param max - the context window.
 * @returns the clamped ratio.
 */
export function usageRatio(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || used <= 0 || max <= 0) return 0
  return Math.max(0, Math.min(1, used / max))
}

/**
 * Map a usage ratio to the severity color the bar paints (the kimi
 * thresholds): `danger` from 85%, `warn` from 50%, `ok` below.
 * @param ratio - the clamped usage ratio.
 * @returns the severity name.
 */
export function ratioSeverity(ratio: number): 'ok' | 'warn' | 'danger' {
  if (ratio >= 0.85) return 'danger'
  if (ratio >= 0.5) return 'warn'
  return 'ok'
}

/** The bar width every context row renders (the kimi value). */
export const CONTEXT_BAR_WIDTH = 20

/**
 * The plain `[███░░░]` bar (the kimi `renderProgressBar` port); coloring is
 * the caller's responsibility.
 * @param ratio - the usage ratio (clamped internally).
 * @param width - the bar width in columns.
 * @returns the bar string.
 */
export function renderBar(ratio: number, width: number = CONTEXT_BAR_WIDTH): string {
  const filled = Math.round(usageRatio(ratio, 1) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

/**
 * Sum the four buckets (the projection's disjoint-buckets total).
 * @param buckets - the buckets to sum.
 * @returns input + cacheRead + cacheWrite + output.
 */
export function totalTokens(buckets: TokenBuckets): number {
  return buckets.input + buckets.cacheRead + buckets.cacheWrite + buckets.output
}

/**
 * Read usage facts from the app-owned current-session snapshot.
 * @param ctx - plugin context carrying the app action boundary.
 * @returns usage facts, or zero/unknown facts with no active session.
 */
export function readUsageFacts(ctx: Context, _legacyOwner?: unknown): UsageFacts {
  const agent = ctx.blueCurrentAgent.current()
  if (agent === null) return { buckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, context: {} }
  const values = ctx.sessionProjections.snapshot(agent.session, ['tokenUsage', 'contextPressure']).values
  const usage = values.tokenUsage
  const pressure = values.contextPressure
  return {
    buckets: usage === undefined
      ? { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      : {
          input: usage.uncachedInputTokens,
          cacheRead: usage.cacheReadTokens,
          cacheWrite: usage.cacheWriteTokens,
          output: usage.outputTokens,
        },
    context: {
      ...(pressure?.projectedTokens === undefined && pressure?.pressureTokens === undefined
        ? {}
        : { used: pressure.projectedTokens ?? pressure.pressureTokens }),
      ...(pressure?.contextWindow === undefined ? {} : { window: pressure.contextWindow }),
    },
  }
}

/**
 * Read whole-log turn/step counts from the app-owned snapshot.
 * @param ctx - plugin context carrying the app action boundary.
 * @returns turns and steps, or zeros with no active session.
 */
export function readTurnCounts(ctx: Context, _legacyOwner?: unknown): { turns: number, steps: number } {
  const agent = ctx.blueCurrentAgent.current()
  if (agent === null) return { turns: 0, steps: 0 }
  const stats = ctx.sessionProjections.snapshot(agent.session, ['sessionStats']).values.sessionStats
  return stats === undefined ? { turns: 0, steps: 0 } : { turns: stats.turns, steps: stats.steps }
}

/**
 * Read the optional heuristic context composition from the app snapshot.
 * @param ctx - plugin context carrying the app action boundary.
 * @returns the composition, or `undefined` when the projection answers none.
 */
export function readCompositionFacts(ctx: Context, _legacyOwner?: unknown): CompositionFacts | undefined {
  const agent = ctx.blueCurrentAgent.current()
  if (agent === null) return undefined
  const breakdown = ctx.sessionProjections.snapshot(agent.session, ['contextBreakdown']).values.contextBreakdown
  return breakdown === undefined ? undefined : {
    system: breakdown.systemTokens,
    tools: breakdown.toolsTokens,
    messages: breakdown.messageTokens,
  }
}
