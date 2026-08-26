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
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type imports carry the `planMode` Context merge (dsh-plan-mode),
// the `command/run`/`command/done` SessionEventMap members this module's
// persistence rides, and the app-owned renderer-neutral session services.
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { getSharedEditor } from './editor-instance.ts'
import type { BlueSessionModeState } from '@dsh-blue/blue-app'

/** The full three-state cycle order (D5). */
type BlueMode = BlueSessionModeState['mode']
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
 * @param active - whether approvals should auto-allow.
 * @returns the command outcome describing the new stance.
 */
function applyYolo(ctx: Context, active: boolean): CommandResult {
  const result = ctx.blueSessionActions.setYolo(active)
  if (!result.ok) return { kind: 'error', text: result.message }
  return active
    ? { kind: 'success', text: 'yolo on — tool calls run without asking (questions still pop)' }
    : { kind: 'success', text: 'yolo off — tool calls ask again' }
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
 * @param rawInput - the verbatim argument text after the command name.
 * @param signal - the dispatching UI request's cancellation signal.
 * @returns the command outcome.
 */
async function toggleYolo(
  ctx: Context,
  rawInput: string,
  signal: AbortSignal,
): Promise<CommandResult> {
  const arg = rawInput.trim()
  if (arg === 'off') return applyYolo(ctx, false)
  if (arg.length > 0) return applyYolo(ctx, true)
  if (ctx.blueSessionActions.modeState()?.mode !== 'yolo') return applyYolo(ctx, true)
  const execution = await ctx.blueSessionActions.executeCommand('/yolo off', signal)
  if (execution === undefined) return { kind: 'error', text: 'failed to turn yolo off' }
  if (execution.result.kind === 'error') return { kind: 'error', text: execution.result.text ?? 'failed to turn yolo off' }
  return execution.result.text === undefined
    ? { kind: 'success' }
    : { kind: 'success', text: execution.result.text }
}

/**
 * Cycle the session mode one step (the Shift+Tab entry): normal → plan →
 * yolo → normal, one explicit command per transition so the log records
 * the exact intent and the dispatched result is the single visible
 * notice.
 * @param ctx - plugin context.
 */
export async function cycleMode(ctx: Context): Promise<void> {
  if (ctx.blueSessionReader.current() === null) {
    getSharedEditor(ctx)?.notice?.('no session is live yet')
    return
  }
  const current = ctx.blueSessionActions.modeState()?.mode ?? 'normal'
  const next = (ctx.blueSessionActions.planModeAvailable() ? CYCLE : CYCLE_WITHOUT_PLAN)[current]
  const line = next === 'plan' ? '/plan' : next === 'yolo' ? '/yolo on' : '/yolo off'
  try {
    const execution = await ctx.blueSessionActions.executeCommand(line)
    if (execution === undefined) return
    const { result } = execution
    if (result.text !== undefined) {
      const paint = result.kind === 'error' ? displayServices(ctx)?.colors.error : undefined
      getSharedEditor(ctx)?.notice?.(paint === undefined ? result.text : paint(result.text))
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
    handler: invocation => toggleYolo(ctx, invocation.rawInput, invocation.signal),
  })
  // The kimi alias: `/yes` is not a separate registration — the input
  // layer rewrites it to `/yolo` before `ctx.commands.execute`.
  const yoloAliases = ctx.blueInteractionState.aliases.register('yolo', ['yes'])
  const offNotice = ctx.on('blue/mode-notice', text => {
    getSharedEditor(ctx)?.notice?.(text)
  })
  return () => {
    yolo()
    yoloAliases()
    offNotice()
  }
}
