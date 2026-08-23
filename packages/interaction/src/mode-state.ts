/**
 * The Blue session-mode state: the yolo auto-approval flag (a per-agent
 * WeakMap, the `sessionAllowances` precedent) plus the pure fold that
 * recovers it from the session log. Blue owns no session-event vocabulary —
 * `KNOWN_SESSION_EVENT_TYPES` is a closed upstream set and the read path
 * refuses unknown types — so yolo persists by riding the `command/run`
 * records the command runtime already appends around every `/yolo`
 * invocation, exactly the vocabulary the upstream `plan` projection folds
 * for its own cold recovery. Plan state is not stored here at all: it lives
 * upstream (`ctx.planMode`, folded from `plan/mode` by dsh-plan-mode), and
 * {@link currentMode} only reads it back.
 *
 * @module @dsh-blue/blue-interaction/mode-state
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Carries the `planMode` Context merge; the controller types are read-only
// consumers here, never instantiated by Blue.
import type {} from '@deepseek-ai/dsh-plan-mode'

/** The three Shift+Tab cycle positions (D5: mutually exclusive, normal = no badge). */
export type BlueMode = 'normal' | 'plan' | 'yolo'

/** Whether yolo auto-approval is on, per agent. */
const yoloByAgent = new WeakMap<Agent, boolean>()

/**
 * Fold the yolo state from a session log: the last `command/run` for
 * `yolo` carrying recorded args decides — `off` (after trim) turns it off,
 * anything else (including the empty args of a bare `/yolo`) turns it on;
 * runs without args (`recordInput: false`) are skipped, mirroring the plan
 * projection's skip. No such event folds to off.
 * @param events - the session events, in log order.
 * @returns whether yolo should be active for the session that logged them.
 */
export function foldYolo(events: readonly SessionEvent[]): boolean {
  let active = false
  for (const event of events) {
    if (event.type !== 'command/run') continue
    const { name, args } = event.data
    if (name !== 'yolo' || args === undefined) continue
    active = args.trim() !== 'off'
  }
  return active
}

/**
 * Read the live yolo flag for one agent.
 * @param agent - the agent to read.
 * @returns whether tool approvals auto-allow for the agent.
 */
export function yoloActive(agent: Agent): boolean {
  return yoloByAgent.get(agent) === true
}

/**
 * Set the live yolo flag. Persistence is owned by the dispatching command
 * (`command/run` records); this only moves the in-process state.
 * @param agent - the agent to switch.
 * @param active - whether approvals should auto-allow.
 */
export function setYolo(agent: Agent, active: boolean): void {
  yoloByAgent.set(agent, active)
}

/**
 * Restore the yolo flag from an agent's session log — the resume/fork
 * catch-up (a fresh `Agent` starts with no WeakMap entry, so `/new` lands
 * on off for free; resumed and forked agents replay their `command/run`
 * history here).
 * @param agent - the agent whose log decides.
 */
export function restoreYolo(agent: Agent): void {
  setYolo(agent, foldYolo(agent.session.events))
}

/**
 * The cycle's current position for one agent. Yolo wins over plan in the
 * one transient where both read true (a plan exit queued mid-turn, or the
 * watcher's deferred `/yolo off` not yet flushed): yolo is the operative
 * stance — approvals auto-allow now — and the exclusivity paths converge
 * by the next step boundary. Plan reads pending as active, matching the
 * badge's "applies from the next step" leg.
 * @param ctx - plugin context (`planMode` probed, not injected — a
 * composition without dsh-plan-mode degrades to the two-state cycle).
 * @param agent - the agent to read.
 * @returns the mode the Shift+Tab cycle treats as current.
 */
export function currentMode(ctx: Context, agent: Agent): BlueMode {
  if (yoloActive(agent)) return 'yolo'
  const planMode = ctx.get('planMode')
  if (planMode === undefined) return 'normal'
  const state = planMode.get(agent)
  return (state.pending ?? state.active) ? 'plan' : 'normal'
}
