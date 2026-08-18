/**
 * `blue-status-context` plugin: enhancement footer entry showing the context
 * occupancy of the latest model step (muted, priority 20). Occupancy is the
 * `assistant/message` usage's disjoint input side — `inputTokens +
 * cacheReadTokens + cacheWriteTokens` (output and reasoning tokens are new
 * generation, not occupied context) — rendered as `ctx N` below 1000 tokens
 * and `ctx N.Nk` at or above it (always exactly one decimal, so 1000 →
 * `ctx 1.0k`). A session with no usage data yet renders ''. Attach follows
 * the transcript plugin's own discipline: the durable `agent.session.events`
 * snapshot is scanned first, then the live `session/event` feed carries the
 * increments.
 *
 * @module @deepseek-ai/dsh-blue-transcript/status-context
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@deepseek-ai/dsh-blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-context'

/** Services required before the context entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme']

/**
 * The context occupancy of one step: the disjoint input-side token counts.
 * @param usage - the step's token accounting.
 * @returns occupied context tokens.
 */
export function contextTokens(usage: TokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * Compact token formatting: the plain integer below 1000, one-decimal `k`
 * at or above it.
 * @param tokens - the token count.
 * @returns the formatted count.
 */
export function formatTokens(tokens: number): string {
  return tokens < 1000 ? String(tokens) : `${(tokens / 1000).toFixed(1)}k`
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
 * Register the context entry. Attaches to `blueSession.current` when present
 * and re-attaches on every `'blue/session-changed'`; each attach scans the
 * snapshot and subscribes the live feed. Redraws are requested only when the
 * rendered occupancy changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const screen = ctx.blueScreen
  let tokens = 0
  let detach: (() => void) | undefined

  const attach = (agent: Agent): void => {
    // Drop the previous session's subscription first: its session filter
    // matches the old session, not the new one, so without an explicit
    // detach a stale subscription would keep tracking the detached session.
    detach?.()
    const before = tokens
    tokens = snapshotTokens(agent.session.events)
    detach = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return
      if (event.type !== 'assistant/message' || event.data.usage === undefined) return
      const next = contextTokens(event.data.usage)
      if (next === tokens) return
      tokens = next
      screen.requestRender()
    })
    if (tokens !== before) screen.requestRender()
  }

  const current = ctx.get('blueSession')?.current
  if (current) attach(current)
  ctx.on('blue/session-changed', attach)

  const entry: BlueStatusEntry = {
    id: 'blue.status.context',
    priority: 20,
    render(width: number): string {
      if (tokens <= 0) return ''
      // ASCII-only output, so the string length is the visible width.
      const text = `ctx ${formatTokens(tokens)}`
      if (text.length > width) return ''
      return colors.muted(text)
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
