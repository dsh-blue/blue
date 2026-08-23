/**
 * The mode-family command and the Shift+Tab cycle entry: `/yolo` (alias
 * `/yes`) toggles Blue-side auto-approval of tool calls — the answerer, not
 * the harness approval policy, is the surface (policy `'never'` resolves
 * asks as rejected before the waterfall even dispatches, so the policy
 * stays `'ask'` and `./approval-plugin.ts` allows through). Persistence
 * rides the `command/run` records the command runtime appends around every
 * dispatch — Blue owns no session-event vocabulary, and a bare `/yolo`
 * turning yolo OFF re-dispatches the explicit `/yolo off` so the log's
 * last record disambiguates the fold in `./mode-state.ts`. The cycle
 * (normal → plan → yolo) dispatches exactly one explicit command per
 * transition: `/plan` and `/plan off` belong upstream (dsh-plan-mode, its
 * own `plan/mode` events), so the log stays honest for both legs.
 * `setupModeTracking` restores yolo on session switches and enforces the
 * plan/yolo exclusivity when plan is entered any other way. This module
 * injects nothing but `commands` (via the calling plugin) and resolves
 * every service through `ctx.get` (the `/theme` fiber-dispose trap).
 *
 * @module @dsh-blue/blue-interaction/mode-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type imports carry the `planMode` Context merge (dsh-plan-mode),
// the `command/run`/`command/done` SessionEventMap members this module's
// persistence rides, and the app-owned `'blue/session-changed'` Events
// merge the tracking listeners use.
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { registerCommandAliases } from './command-meta.ts'
import { displayServices } from './display-services.ts'
import { getSharedEditor } from './editor-instance.ts'
import { currentMode, restoreYolo, setYolo, yoloActive, type BlueMode } from './mode-state.ts'
import { currentBlueAgent } from './session.ts'

/** The full three-state cycle order (D5). */
const CYCLE: Record<BlueMode, BlueMode> = { normal: 'plan', plan: 'yolo', yolo: 'normal' }
/**
 * The degraded order when dsh-plan-mode is not composed. The `plan` slot
 * is unreachable there (`currentMode` only reports plan through the
 * controller) but keeps the table total, so the lookup needs no dead
 * branch.
 */
const CYCLE_WITHOUT_PLAN: Record<BlueMode, BlueMode> = { normal: 'yolo', plan: 'normal', yolo: 'normal' }

/** Render one failure reason for a warn log. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Apply one yolo state directly (the explicit-argument write path).
 * Turning yolo on leaves plan first — a queued plan exit lands at the next
 * step boundary, and until then yolo is the operative stance.
 * @param ctx - plugin context (`planMode` probed, absent = no exit needed).
 * @param agent - the agent to switch.
 * @param active - whether approvals should auto-allow.
 * @returns the command outcome describing the new stance.
 */
function applyYolo(ctx: Context, agent: Agent, active: boolean): CommandResult {
  if (active) {
    ctx.get('planMode')?.set(agent, false)
    setYolo(agent, true)
    return { kind: 'success', text: 'yolo on — tool calls run without asking (questions still pop)' }
  }
  setYolo(agent, false)
  return { kind: 'success', text: 'yolo off — tool calls ask again' }
}

/**
 * The `/yolo [on|off]` handler. The argument semantic matches the fold in
 * `./mode-state.ts` exactly — `off` turns it off, any other non-empty
 * argument turns it on — because `command/run` records the raw argument
 * before this handler runs, and a stricter usage error would leave the log
 * claiming a state the session never reached. The bare form toggles:
 * turning ON needs no extra record (the bare record's empty args folds
 * on); turning OFF re-dispatches the explicit `/yolo off` so the last
 * record disambiguates.
 * @param ctx - plugin context.
 * @param agent - the dispatching invocation's agent.
 * @param rawInput - the verbatim argument text after the command name.
 * @param signal - the dispatching UI request's cancellation signal.
 * @returns the command outcome.
 */
async function toggleYolo(
  ctx: Context,
  agent: Agent,
  rawInput: string,
  signal: AbortSignal,
): Promise<CommandResult> {
  const arg = rawInput.trim()
  if (arg === 'off') return applyYolo(ctx, agent, false)
  if (arg.length > 0) return applyYolo(ctx, agent, true)
  if (!yoloActive(agent)) return applyYolo(ctx, agent, true)
  const execution = await ctx.commands.execute(agent, '/yolo off', [], signal)
  return execution?.result ?? { kind: 'error', text: 'failed to turn yolo off' }
}

/**
 * Cycle the session mode one step (the Shift+Tab entry): normal → plan →
 * yolo → normal, one explicit command per transition so the log records
 * the exact intent and the dispatched result is the single visible
 * notice.
 * @param ctx - plugin context.
 */
export async function cycleMode(ctx: Context): Promise<void> {
  const agent = currentBlueAgent(ctx)
  if (agent === undefined) {
    getSharedEditor()?.notice?.('no session is live yet')
    return
  }
  const current = currentMode(ctx, agent)
  const next = (ctx.get('planMode') === undefined ? CYCLE_WITHOUT_PLAN : CYCLE)[current]
  const line = next === 'plan' ? '/plan' : next === 'yolo' ? '/yolo on' : '/yolo off'
  try {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    if (execution === undefined) return
    const { result } = execution
    if (result.text !== undefined) {
      const paint = result.kind === 'error' ? displayServices(ctx)?.colors.error : undefined
      getSharedEditor()?.notice?.(paint === undefined ? result.text : paint(result.text))
    }
  } catch (error) {
    /* v8 ignore next -- execute() normalizes handler rejections; this
       catch guards only the append-failure loud path */
    ctx.logger.warn(`mode cycle dispatch failed: ${describe(error)}`)
  }
}

/**
 * Restore yolo on every session switch and enforce the plan/yolo
 * exclusivity when plan mode is entered through any path this module does
 * not own (a typed `/plan`). The watcher must defer its dispatch:
 * `'session/event'` observers run synchronously inside `session.append`,
 * which throws on re-entry, and `execute()` appends `command/run` in its
 * synchronous prefix.
 * @param ctx - plugin context.
 * @returns the disposer removing both listeners.
 */
export function setupModeTracking(ctx: Context): () => void {
  let unloaded = false
  const stopUnloaded = ctx.effect(() => () => {
    unloaded = true
  })
  const offSessionChanged = ctx.on('blue/session-changed', (agent) => {
    restoreYolo(agent)
  })
  // Late activation: the fiber may mount after a session already attached
  // (the status-basic discipline).
  const attached = currentBlueAgent(ctx)
  if (attached !== undefined) restoreYolo(attached)
  const offSessionEvent = ctx.on('session/event', (session, event) => {
    if (event.type !== 'plan/mode' || !event.data.active) return
    const agent = currentBlueAgent(ctx)
    if (agent === undefined || agent.session !== session || !yoloActive(agent)) return
    queueMicrotask(() => {
      /* v8 ignore next -- reachable only when the fiber unloads inside the
         append-to-microtask window; disposal removes the listener, so the
         flag is a belt-and-braces guard for exactly that race */
      if (unloaded) return
      void ctx.commands.execute(agent, '/yolo off', [], new AbortController().signal).then(
        (execution) => {
          const text = execution?.result.text
          if (!unloaded && text !== undefined) getSharedEditor()?.notice?.(text)
        },
        (error: unknown) => {
          /* v8 ignore next -- the append-failure loud path only */
          ctx.logger.warn(`yolo exclusivity dispatch failed: ${describe(error)}`)
        },
      )
    })
  })
  return () => {
    offSessionChanged()
    offSessionEvent()
    stopUnloaded()
  }
}

/**
 * Register the `/yolo` command and its `/yes` alias on `ctx.commands`.
 * @param ctx - plugin context.
 * @returns the disposer removing the registration and the alias relation.
 */
export function registerModeCommands(ctx: Context): () => void {
  const yolo = ctx.commands.register({
    name: 'yolo',
    description: 'Toggle auto-approval of tool calls (questions still pop)',
    input: { hint: '[on|off]' },
    handler: invocation => toggleYolo(ctx, invocation.agent, invocation.rawInput, invocation.signal),
  })
  // The kimi alias: `/yes` is not a separate registration — the input
  // layer rewrites it to `/yolo` before `ctx.commands.execute`.
  const yoloAliases = registerCommandAliases('yolo', ['yes'])
  return () => {
    yolo()
    yoloAliases()
  }
}
