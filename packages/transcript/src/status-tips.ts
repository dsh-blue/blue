/**
 * The smooth weighted round-robin tip spread — the pure half of the retired
 * `blue-status-tips` footer plugin. The rotating footer entry retired with
 * the S30 footer swap (the session title took its first-band right slot);
 * the teaching tips live on the activity pane's spinner rows, which draw
 * their sequence from this module. Deterministic, so it is built once per
 * consumer and can be asserted directly.
 *
 * @module @dsh-blue/blue-transcript/status-tips
 */

import type { StatusTip } from './tips-content.ts'

/**
 * Expand tips into a rotation sequence with smooth weighted round-robin
 * (the nginx algorithm, as kimi-code): each tip's `priority` (clamped to at
 * least 1) is its weight, and one pass of `total` picks spreads the weight
 * while keeping neighbours apart. All-equal weights degenerate to the
 * identity sequence.
 * @param tips - the rotation pool.
 * @returns the expanded rotation, one tip per slot.
 */
export function buildTipRotation(tips: readonly StatusTip[]): readonly StatusTip[] {
  const items = tips.map(tip => ({
    tip,
    weight: Math.max(1, Math.trunc(tip.priority ?? 1)),
    current: 0,
  }))
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  const sequence: StatusTip[] = []
  for (let pick = 0; pick < total; pick += 1) {
    let best = items[0]!
    for (const item of items) {
      item.current += item.weight
      if (item.current > best.current) best = item
    }
    best.current -= total
    sequence.push(best.tip)
  }
  return sequence
}
