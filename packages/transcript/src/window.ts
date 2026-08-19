/**
 * Long-session window policy: how many completed turns stay mounted and
 * whether mid-turn steps fold into one summary line. The tunables are
 * module-level with test setters (the `setActivityTimers` precedent); the
 * decision helpers are pure so both the fold (in-turn step folding) and the
 * mounter (eviction) share one definition of the rules.
 *
 * Eviction keeps the newest `windowTurns` completed turns; the active turn
 * is never evicted (it is not in the completed list until its `turn/end`).
 * Step folding collapses a step's tool items into one
 * `TranscriptStepSummaryItem` when the NEXT `step/start` of the same turn
 * arrives — so a turn's final step stays expanded and keeps its tool cards.
 *
 * @module @dsh-blue/blue-transcript/window
 */

/** Default count of newest completed turns kept mounted. */
export const DEFAULT_WINDOW_TURNS = 15

let windowTurns = DEFAULT_WINDOW_TURNS
let stepFolding = true

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
