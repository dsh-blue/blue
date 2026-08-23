/**
 * `blue-status-context` plugin: enhancement footer entry showing the context
 * occupancy of the latest model step — right-aligned on band 2 in the full
 * `text` foreground (priority 20), the kimi footer's readout. Occupancy is
 * the `assistant/message` usage's disjoint input side — `inputTokens +
 * cacheReadTokens + cacheWriteTokens` (output and reasoning tokens are new
 * generation, not occupied context). When the session's request context
 * advertises a context window — `session.requestContext()?.contextWindow`,
 * the durable `'request/context'` fold fed by the adapter's `resolveModel`
 * — the entry renders `context: N% (K/M)`: N is the occupancy share rounded
 * up (a non-zero share always at least 1, clamped to 100), K and M the
 * 1024-base-abbreviated counts (`x.yk` from 1024, `x.yM` from 1 MiB,
 * rounded at 100k — context windows are powers of two, so 262144 renders as
 * `256k`). The share is a lower bound: the window covers request and
 * response combined while K counts the input side only. Without a window
 * the entry degrades to `ctx N` (the pre-S15 form); a session with no usage
 * data yet renders ''. Attach follows the transcript plugin's own
 * discipline: the durable `agent.session.events` snapshot is scanned first,
 * then the live `session/event` feed carries the increments.
 *
 * @module @dsh-blue/blue-transcript/status-context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { RequestContext, SessionEvent } from '@deepseek-ai/dsh-session'
import type { StatusModel } from '@dsh-blue/blue-frontend'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-status-context'

/** Services required before the context entry can register. */
export const inject = ['blueStatusModels']

/**
 * The context occupancy of one step: the disjoint input-side token counts.
 * @param usage - the step's token accounting.
 * @returns occupied context tokens.
 */
export function contextTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * One decimal, trailing `.0` trimmed: 1 → `1`, 1.5 → `1.5`, 2.04 → `2`.
 * @param value - the value to format.
 * @returns the trimmed one-decimal representation.
 */
function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

/**
 * Compact 1024-base token formatting: the plain integer below 1024, `x.yk`
 * (rounded at 100k) at or above it, `x.yM` at or above 1 MiB. Context
 * windows are powers of two, so the binary base keeps the abbreviations
 * exact — 262144 → `256k`, 1048576 → `1M`. Non-finite or negative input
 * formats as `0`.
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
 * The occupancy share of a context window, in whole percents: rounded up so
 * partial use never reads as empty, clamped to [0, 100], and a non-zero
 * share always at least 1. A non-finite or non-positive window — or a
 * non-positive occupancy — yields 0.
 * @param used - the occupied tokens.
 * @param max - the context window.
 * @returns the share in percent.
 */
export function contextPercent(used: number, max: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(max) || used <= 0 || max <= 0) return 0
  return Math.min(100, Math.max(1, Math.ceil((used / max) * 100)))
}

/**
 * Normalize an advertised context window: only a positive finite number is
 * a window, anything else (undefined included) means "not advertised" and
 * the entry degrades.
 * @param contextWindow - the advertised window, if any.
 * @returns the usable window, or undefined when not advertised.
 */
function normalizeWindow(contextWindow: number | undefined): number | undefined {
  return contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : undefined
}

/**
 * The latest step's occupancy in an event snapshot.
 * @param events - the session events, in ascending seq order.
 * @returns the newest usage's context tokens, or 0 when none exists.
 */
function snapshotTokens(events: readonly SessionEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      return contextTokens(event.data.usage)
    }
  }
  return 0
}

/**
 * The advertised window in a request-context snapshot, if any.
 * @param context - the session's request context, when it has one.
 * @returns the usable window, or undefined when not advertised.
 */
function snapshotWindow(context: RequestContext | undefined): number | undefined {
  return normalizeWindow(context?.contextWindow)
}

/**
 * Register the context entry. Attaches to `blueSession.current` when present
 * and re-attaches on every `'blue/session-changed'`; each attach scans the
 * snapshot (usage and request context) and subscribes the live feed —
 * `assistant/message` usage updates the occupancy, `request/context` updates
 * the advertised window (a model switch can drop it, degrading the entry
 * back to `ctx N`). Redraws are requested only when the rendered values
 * changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let tokens = 0
  let max: number | undefined
  let detach: (() => void) | undefined

  const attach = (agent: Agent): void => {
    // Drop the previous session's subscription first: its session filter
    // matches the old session, not the new one, so without an explicit
    // detach a stale subscription would keep tracking the detached session.
    detach?.()
    const beforeTokens = tokens
    const beforeMax = max
    tokens = snapshotTokens(agent.session.events)
    max = snapshotWindow(agent.session.requestContext())
    detach = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type === 'request/context') {
        const next = normalizeWindow(event.data.contextWindow)
        if (next === max) return
        max = next
        ctx.blueStatusModels.refresh('blue.status.context')
        return
      }
      if (event.type !== 'assistant/message' || event.data.usage === undefined) return
      const next = contextTokens(event.data.usage)
      if (next === tokens) return
      tokens = next
      ctx.blueStatusModels.refresh('blue.status.context')
    })
    if (tokens !== beforeTokens || max !== beforeMax) ctx.blueStatusModels.refresh('blue.status.context')
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)

  const model = (): StatusModel => {
    const text = tokens <= 0
      ? ''
      : max === undefined
        ? `ctx ${formatTokens(tokens)}`
        : `context: ${String(contextPercent(tokens, max))}% (${formatTokens(tokens)}/${formatTokens(max)})`
    return { kind: 'status', id: 'blue.status.context', priority: 20, band: 'right', row: 2, overflow: 'hide', view: { kind: 'text', text }, visible: text !== '' }
  }
  ctx.effect(() => ctx.blueStatusModels.register(model))
}
