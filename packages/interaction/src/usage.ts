/**
 * The `/usage` and `/status` read layer (S25): pure token formatting plus
 * the thin projection-backed reads the two panels paint from. No
 * accumulator lives here — the session-projection seam
 * (`ctx.sessionProjections`, fed by `dsh-token-meter` and
 * `dsh-session-stats` in the base composition) owns the durable folds; the
 * local `foldTokenBuckets` is only the degraded host's fallback over the
 * same `assistant/*` usage records, mirroring the upstream unit's
 * replace-per-step semantics so a re-reported step never double counts.
 *
 * @module @dsh-blue/blue-interaction/usage
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports carry the `sessionProjections` Context merge
// (dsh-session-projection) and the app-owned `blueSession` merge.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@dsh-blue/blue-app'

/** The four disjoint provider-usage buckets both panels list. */
export interface TokenBuckets {
  /** Uncached prompt tokens (the provider's `inputTokens`). */
  readonly input: number
  /** Cache-read prompt tokens. */
  readonly cacheRead: number
  /** Cache-write prompt tokens (cache creation). */
  readonly cacheWrite: number
  /** Completion tokens — reasoning included, per the provider contract. */
  readonly output: number
}

/**
 * The context-occupancy pair the panels render: the numerator is the
 * projection's next-request estimate when the provider has reported usage
 * (`projectedTokens`, else `pressureTokens`), the denominator the newest
 * advertised window. Both absent until a request reports or advertises.
 */
export interface ContextFacts {
  /** Estimated tokens of the next request, when known. */
  readonly used?: number
  /** The newest advertised context window, when known. */
  readonly window?: number
}

/** Everything the `/usage` panel paints. */
export interface UsageFacts {
  /** Cumulative provider usage over the whole durable log. */
  readonly buckets: TokenBuckets
  /** Context occupancy; fields absent until known. */
  readonly context: ContextFacts
}

/** Structural shape of the `tokenUsage` projection value. */
interface TokenUsageValue {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Structural shape of the `contextPressure` projection value. */
interface ContextPressureValue {
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly contextWindow?: number
}

/** Structural shape of the `contextBreakdown` projection value. */
interface ContextBreakdownValue {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

/** The heuristic composition of the next request (the CC `/context` rows). */
export interface CompositionFacts {
  /** Heuristic tokens of the newest request envelope's system prompt. */
  readonly system: number
  /** Heuristic tokens of the newest request envelope's tool schemas. */
  readonly tools: number
  /** Heuristic tokens of the current model-visible conversation surface. */
  readonly messages: number
}

/** Structural shape of the `sessionStats` projection value. */
export interface SessionStatsValue {
  readonly turns: number
  readonly steps: number
  readonly llmMs: number
  readonly toolMs: number
  readonly ttftMs: number
  readonly ttftSteps: number
  readonly decodeMs: number
  readonly decodeTokens: number
}

/** Structural read surface of `ctx.sessionProjections` this module uses. */
interface ProjectionsService {
  snapshot(session: Agent['session']): { values: Record<string, unknown> }
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

/** The usage record one `assistant/*` event may carry, if any. */
function usageOf(event: SessionEvent):
  | { turn: number, step: number, usage: { inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number } }
  | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/** The zero buckets. */
const NO_USAGE: TokenBuckets = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

/**
 * The degraded host's cumulative usage: fold the `assistant/*` usage
 * records with the upstream unit's replace-per-step semantics — a later
 * sample for the same turn/step replaces the earlier one instead of adding
 * to it, so a usage chunk followed by its finalized message counts once.
 * @param events - the session's durable event log.
 * @returns the cumulative buckets.
 */
export function foldTokenBuckets(events: readonly SessionEvent[]): TokenBuckets {
  const last = new Map<string, TokenBuckets>()
  for (const event of events) {
    const record = usageOf(event)
    if (record === undefined) continue
    last.set(`${String(record.turn)}/${String(record.step)}`, {
      input: record.usage.inputTokens,
      cacheRead: record.usage.cacheReadTokens ?? 0,
      cacheWrite: record.usage.cacheWriteTokens ?? 0,
      output: record.usage.outputTokens,
    })
  }
  let input = 0
  let cacheRead = 0
  let cacheWrite = 0
  let output = 0
  for (const buckets of last.values()) {
    input += buckets.input
    cacheRead += buckets.cacheRead
    cacheWrite += buckets.cacheWrite
    output += buckets.output
  }
  return { input, cacheRead, cacheWrite, output }
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
 * Read the `/usage` facts for one agent: the projection snapshot when the
 * seam is composed (the base composition's `dsh-token-meter`), otherwise
 * the local fallback fold plus the durable `requestContext()` window.
 * Replay-correct by construction — both sources fold the whole durable
 * log, so a resumed session reports its full history.
 * @param ctx - plugin context (`sessionProjections` resolved lazily).
 * @param agent - the agent whose session is read.
 * @returns the usage facts.
 */
export function readUsageFacts(ctx: Context, agent: Agent): UsageFacts {
  const projections = ctx.get('sessionProjections') as ProjectionsService | undefined
  if (projections !== undefined) {
    const values = projections.snapshot(agent.session).values
    const usage = values.tokenUsage as TokenUsageValue | undefined
    const pressure = values.contextPressure as ContextPressureValue | undefined
    const buckets: TokenBuckets = usage === undefined
      ? NO_USAGE
      : {
          input: usage.uncachedInputTokens,
          cacheRead: usage.cacheReadTokens,
          cacheWrite: usage.cacheWriteTokens,
          output: usage.outputTokens,
        }
    const window = pressure?.contextWindow
    const used = pressure === undefined ? undefined : pressure.projectedTokens ?? pressure.pressureTokens
    return {
      buckets,
      context: {
        ...(used !== undefined ? { used } : {}),
        ...(window !== undefined ? { window } : {}),
      },
    }
  }
  return {
    buckets: foldTokenBuckets(agent.session.events),
    context: (() => {
      const window = agent.session.requestContext()?.contextWindow
      let used: number | undefined
      for (const event of agent.session.events) {
        const record = usageOf(event)
        if (record !== undefined) {
          used = record.usage.inputTokens + (record.usage.cacheReadTokens ?? 0) + (record.usage.cacheWriteTokens ?? 0)
        }
      }
      return {
        ...(used !== undefined ? { used } : {}),
        ...(window !== undefined ? { window } : {}),
      }
    })(),
  }
}

/**
 * Read the whole-log turn/step counts for `/status`: the `sessionStats`
 * projection when composed, otherwise counting the durable boundary
 * events (the projection counts closed steps, so the fallback counts
 * `step/end` to stay comparable; `turn/start` counting is exact in both).
 * @param ctx - plugin context (`sessionProjections` resolved lazily).
 * @param agent - the agent whose session is read.
 * @returns turns and steps over the whole durable log.
 */
export function readTurnCounts(ctx: Context, agent: Agent): { turns: number, steps: number } {
  const projections = ctx.get('sessionProjections') as ProjectionsService | undefined
  if (projections !== undefined) {
    const stats = projections.snapshot(agent.session).values.sessionStats as SessionStatsValue | undefined
    if (stats !== undefined) return { turns: stats.turns, steps: stats.steps }
  }
  let turns = 0
  let steps = 0
  for (const event of agent.session.events) {
    if (event.type === 'turn/start') turns += 1
    else if (event.type === 'step/end') steps += 1
  }
  return { turns, steps }
}

/**
 * Read the heuristic context composition for `/context`'s CC-style rows:
 * the `contextBreakdown` projection (heuristic system/tools/message
 * tokens). Projection-only by design — the estimator is the meter's own,
 * so a host without the seam gets no composition section rather than a
 * Blue-side re-implementation. The three figures are approximations of
 * composition, deliberately not a provider-anchored total (the upstream
 * unit underprices CJK text and JSON schemas; the occupancy bar in
 * `buildContextSection` carries the anchored number).
 * @param ctx - plugin context (`sessionProjections` resolved lazily).
 * @param agent - the agent whose session is read.
 * @returns the composition, or `undefined` when the projection answers none.
 */
export function readCompositionFacts(ctx: Context, agent: Agent): CompositionFacts | undefined {
  const projections = ctx.get('sessionProjections') as ProjectionsService | undefined
  if (projections === undefined) return undefined
  const breakdown = projections.snapshot(agent.session).values.contextBreakdown as ContextBreakdownValue | undefined
  if (breakdown === undefined) return undefined
  return {
    system: breakdown.systemTokens,
    tools: breakdown.toolsTokens,
    messages: breakdown.messageTokens,
  }
}
