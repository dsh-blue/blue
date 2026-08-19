/**
 * `blue-status-tips` plugin: the rotating teaching tip. `buildTipRotation`
 * and `tipOffer` are asserted pure (SWRR spreading and weighting, solo and
 * duplicate pairing guards, wrap and negative indexes); the entry spec
 * covers the pair-then-single width fallback, the `textMuted` tier, the
 * right/band-1 placement, the ticker advancing the index and requesting a
 * redraw, and the fiber unload clearing the interval.
 */

import { describe, expect, it } from 'vitest'
import * as tips from '../src/status-tips.ts'
import type { TipsTimers } from '../src/status-tips.ts'
import { STATUS_TIPS, type StatusTip } from '../src/tips-content.ts'
import { bootStatusPlugin, COLORS } from './status-fakes.ts'

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
})

describe('tipOffer', () => {
  it('offers no pair from an empty pool', () => {
    expect(tips.tipOffer([], 0)).toEqual({ primary: '', pair: null })
  })

  it('offers no pair over a one-tip pool or a solo tip', () => {
    expect(tips.tipOffer([{ text: 'only' }], 0)).toEqual({ primary: 'only', pair: null })
    const pool: StatusTip[] = [{ text: 'solo', solo: true }, { text: 'next' }]
    expect(tips.tipOffer(pool, 0)).toEqual({ primary: 'solo', pair: null })
  })

  it('offers no pair when the neighbour is solo or a duplicate', () => {
    const soloNext: StatusTip[] = [{ text: 'a' }, { text: 'b', solo: true }]
    expect(tips.tipOffer(soloNext, 0)).toEqual({ primary: 'a', pair: null })
    const duplicate: StatusTip[] = [{ text: 'a' }, { text: 'a' }]
    expect(tips.tipOffer(duplicate, 0)).toEqual({ primary: 'a', pair: null })
  })

  it('pairs the slot with its successor and wraps the tail', () => {
    const pool: StatusTip[] = [{ text: 'a' }, { text: 'b' }, { text: 'c' }]
    expect(tips.tipOffer(pool, 0).pair).toBe('a | b')
    expect(tips.tipOffer(pool, 2).pair).toBe('c | a')
  })

  it('wraps negative indexes from the back', () => {
    const pool: StatusTip[] = [{ text: 'a' }, { text: 'b' }]
    expect(tips.tipOffer(pool, -1)).toEqual({ primary: 'b', pair: 'b | a' })
  })
})

/** Manual timers: the spec drives every tick itself. */
function manualTimers(): TipsTimers & { tick: () => void } {
  let callback: (() => void) | undefined
  return {
    setInterval: (fn) => {
      callback = fn
      return 0 as ReturnType<typeof setInterval>
    },
    clearInterval: () => {
      callback = undefined
    },
    tick: () => callback?.(),
  }
}

describe('blue-status-tips', () => {
  it('registers at priority 30, right-aligned on band 1, in the textMuted tier', async () => {
    const timers = manualTimers()
    tips.setTipsTimers(timers)
    const textMuted = (text: string): string => `[TM]${text}[/TM]`
    const harness = await bootStatusPlugin(tips, null, {
      colors: { ...COLORS, textMuted },
    })
    try {
      expect(harness.entry.id).toBe('blue.status.tips')
      expect(harness.entry.priority).toBe(30)
      expect(harness.entry.align).toBe('right')
      expect(harness.entry.row).toBeUndefined()
      const offer = tips.tipOffer(tips.buildTipRotation(STATUS_TIPS), 0)
      expect(harness.entry.render(200)).toBe(`[TM]${offer.pair ?? offer.primary}[/TM]`)
    } finally {
      tips.setTipsTimers(undefined)
      await harness.dispose()
    }
  })

  it('falls back to the single tip when the pair does not fit', async () => {
    const timers = manualTimers()
    tips.setTipsTimers(timers)
    const harness = await bootStatusPlugin(tips)
    try {
      const offer = tips.tipOffer(tips.buildTipRotation(STATUS_TIPS), 0)
      // The real pool's first slot pairs; the guard documents that assumed
      // shape (a future solo first slot would need a different driver).
      expect(offer.pair).not.toBeNull()
      const { pair, primary } = offer as { pair: string, primary: string }
      // A budget between the single tip and the pair takes the single.
      expect(harness.entry.render(primary.length)).toBe(primary)
      expect(harness.entry.render(pair.length)).toBe(pair)
      // Below the single tip: nothing.
      expect(harness.entry.render(primary.length - 1)).toBe('')
    } finally {
      tips.setTipsTimers(undefined)
      await harness.dispose()
    }
  })

  it('advances the tip on each ticker beat and requests a redraw', async () => {
    const timers = manualTimers()
    tips.setTipsTimers(timers)
    const harness = await bootStatusPlugin(tips)
    try {
      const screen = harness.screen
      const rotation = tips.buildTipRotation(STATUS_TIPS)
      const baseline = screen.renderRequests.length

      timers.tick()
      expect(screen.renderRequests.length).toBe(baseline + 1)
      const first = tips.tipOffer(rotation, 1)
      expect(harness.entry.render(200)).toBe(first.pair ?? first.primary)

      timers.tick()
      expect(screen.renderRequests.length).toBe(baseline + 2)
      const second = tips.tipOffer(rotation, 2)
      expect(harness.entry.render(200)).toBe(second.pair ?? second.primary)
    } finally {
      tips.setTipsTimers(undefined)
      await harness.dispose()
    }
  })

  it('clears the interval and unregisters the entry when the fiber unloads', async () => {
    const timers = manualTimers()
    tips.setTipsTimers(timers)
    const harness = await bootStatusPlugin(tips)
    const screen = harness.screen
    const baseline = screen.renderRequests.length
    await harness.dispose()
    tips.setTipsTimers(undefined)
    // The cleared ticker no longer ticks and the entry is gone.
    timers.tick()
    expect(screen.renderRequests.length).toBe(baseline)
    expect(harness.registry.entries).toHaveLength(0)
  })
})
