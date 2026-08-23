/**
 * Long-session window policy: how many completed turns stay mounted and
 * whether mid-turn steps fold into one summary line. The tunables are
 * module-level with test setters (the `setActivityTimers` precedent); the
 * decision helpers are pure so both the fold (in-turn step folding) and the
 * mounter (eviction) share one definition of the rules.
 *
 * Eviction keeps the newest `windowTurns` completed turns; the active turn
 * is never evicted (it is not in the completed list until its `turn/end`).
 * Step folding slides a retention window over a turn's steps: the most
 * recent {@link recentStepsRetention} steps keep their tool and thinking
 * cards expanded, and a new `step/start` folds only the step sliding out of
 * the window — the kimi `TRANSCRIPT_KEEP_RECENT_STEPS` semantics (30 in
 * kimi, the S20 dogfood alignment: the S7 fold-everything-but-the-last-step
 * policy hid every card in a normal multi-step turn, kimi keeps them). A
 * turn's last steps never fold — no later `step/start` arrives for them.
 *
 * @module @dsh-blue/blue-transcript/window
 */

/** Default count of newest completed turns kept mounted. */
export const DEFAULT_WINDOW_TURNS = 15

/** How many recent steps of a turn stay expanded (kimi's default of 30). */
export const DEFAULT_RECENT_STEPS_RETENTION = 30

let windowTurns = DEFAULT_WINDOW_TURNS
let stepFolding = true
let retention = DEFAULT_RECENT_STEPS_RETENTION

/**
 * Replace the window size (tests inject bounds here).
 * @param n - the replacement, or `undefined` to restore the default.
 */
export function setWindowTurns(n: number | undefined): void {
  windowTurns = n ?? DEFAULT_WINDOW_TURNS
}

/** The active window size: newest completed turns kept mounted. */
export function currentWindowTurns(): number {
  return windowTurns
}

/**
 * Toggle in-turn step folding (tests disable it here).
 * @param on - the replacement, or `undefined` to restore the default (on).
 */
export function setStepFoldingEnabled(on?: boolean): void {
  stepFolding = on ?? true
}

/** Whether in-turn step folding is active. */
export function isStepFoldingEnabled(): boolean {
  return stepFolding
}

/**
 * Replace the recent-steps retention (tests inject small bounds here).
 * @param n - the replacement, or `undefined` to restore the default.
 */
export function setRecentStepsRetention(n: number | undefined): void {
  retention = n ?? DEFAULT_RECENT_STEPS_RETENTION
}

/** How many recent steps of a turn keep their cards expanded. */
export function recentStepsRetention(): number {
  return retention
}

/**
 * Decide the eviction frontier for the current completed-turn list.
 * @param completedTurns - completed turn numbers in ascending order.
 * @param turns - how many newest completed turns to keep.
 * @returns the highest turn number to evict through (pass to
 *   `TranscriptFolder.evictThrough`), or `undefined` when nothing evicts.
 *   `turns` is clamped to ≥1 so the latest completed turn always survives.
 */
export function windowEvictTurn(completedTurns: readonly number[], turns: number): number | undefined {
  const keep = Math.max(1, turns)
  if (completedTurns.length <= keep) return undefined
  return completedTurns[completedTurns.length - keep - 1]
}
