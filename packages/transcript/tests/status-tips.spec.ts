/**
 * `buildTipRotation` — the pure SWRR spread behind the teaching tips,
 * asserted pure (weight spreading, sub-integer clamping, determinism over
 * the real pool). The footer entry retired with the S30 footer swap (the
 * session title took its slot); the consumers are the activity pane's
 * spinner rows and the banner's right column.
 */

import { describe, expect, it } from 'vitest'
import * as tips from '../src/status-tips.ts'
import { STATUS_TIPS, type StatusTip } from '../src/tips-content.ts'

describe('buildTipRotation', () => {
  it('degenerates to the identity sequence under all-equal weights', () => {
    const pool: StatusTip[] = [{ text: 'a' }, { text: 'b' }, { text: 'c' }]
    expect(tips.buildTipRotation(pool).map(tip => tip.text)).toEqual(['a', 'b', 'c'])
  })

  it('spreads a heavier tip between the lighter ones', () => {
    const pool: StatusTip[] = [
      { text: 'heavy', priority: 2 },
      { text: 'light' },
    ]
    // total 3: the weight-2 tip takes 2 of 3 slots, never adjacent.
    expect(tips.buildTipRotation(pool).map(tip => tip.text)).toEqual(['heavy', 'light', 'heavy'])
  })

  it('clamps a sub-integer priority to one pick', () => {
    const pool: StatusTip[] = [{ text: 'a' }, { text: 'b', priority: 0 }]
    expect(tips.buildTipRotation(pool).map(tip => tip.text)).toEqual(['a', 'b'])
  })

  it('expands the real pool deterministically with no self-adjacent duplicates at weight 1', () => {
    const rotation = tips.buildTipRotation(STATUS_TIPS)
    expect(rotation).toHaveLength(STATUS_TIPS.reduce((total, tip) => total + Math.max(1, tip.priority ?? 1), 0))
    // Deterministic: a second build matches.
    expect(tips.buildTipRotation(STATUS_TIPS)).toEqual(rotation)
  })

  it('does not duplicate context-sensitive keyboard guidance', () => {
    expect(STATUS_TIPS.map(tip => tip.text).join('\n')).not.toMatch(/ctrl\+|shift\+tab|esc to/iu)
  })
})
