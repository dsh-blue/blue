/**
 * The thinking block: live tail-window rendering with the spinner timer,
 * in-place finalization with the folded preview and expansion hint, the
 * blank-reasoning zero-row settle, and dispose discipline. Width behavior
 * asserts against pi-tui's own width helpers (the D45 real-semantics swap).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  setThinkingTimers,
  ThinkingComponent,
  THINKING_PREVIEW_LINES,
  type ThinkingTimers,
} from '../src/thinking.ts'
import type { BlueSemanticColors } from '@dsh-blue/blue-core'
import type { TranscriptThinkingItem } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors: assertions see structure, not escape codes. */
const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Tagged colors for role assertions. */
function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return {
    ...COLORS,
    muted: tag('M'),
    textMuted: tag('T'),
    primary: tag('P'),
  }
}

/** Fake timers recording interval creation/clearing; ticks run manually. */
class FakeTimers implements ThinkingTimers {
  readonly ticks: (() => void)[] = []
  cleared = 0

  setInterval(callback: () => void, _ms: number): ReturnType<typeof setInterval> {
    this.ticks.push(callback)
    return this.ticks.length as unknown as ReturnType<typeof setInterval>
  }

  clearInterval(_handle: ReturnType<typeof setInterval>): void {
    this.cleared += 1
  }
}

afterEach(() => {
  setThinkingTimers(undefined)
})

function thinkingItem(partial: Partial<TranscriptThinkingItem> = {}): TranscriptThinkingItem {
  return { kind: 'thinking', seq: 1, turn: 1, step: 1, text: 'thought', streaming: false, ...partial }
}

/** Six wrap-separated words of reasoning; at width 6 each wraps alone. */
const SIX_WORDS = 'l0 l1 l2 l3 l4 l5'

describe('ThinkingComponent', () => {
  it('renders the live spinner row over the reasoning\'s tail window', () => {
    const timers = new FakeTimers()
    setThinkingTimers(timers)
    const component = new ThinkingComponent(
      thinkingItem({ text: SIX_WORDS, streaming: true }),
      tagged(),
      fakeBlueComponents(),
    )
    expect(timers.ticks).toHaveLength(1)
    // The tagged rows measure past twenty columns, so the spinner row's
    // structure asserts at a width it fits.
    const wide = component.render(40)
    expect(wide[0]).toBe('')
    expect(wide[1]).toBe('[M]⠋[/M] [M]thinking...[/M]')
    // The tail window folds at a narrow width: identity colors, the last
    // two wrapped words only, italic-indent styled and width-safe.
    const narrow = new ThinkingComponent(
      thinkingItem({ text: SIX_WORDS, streaming: true }),
      COLORS,
      fakeBlueComponents(),
    ).render(5)
    expect(narrow).toEqual([
      '',
      '⠋ \x1b[0m...\x1b[0m',
      '  \x1b[3ml4\x1b[23m',
      '  \x1b[3ml5\x1b[23m',
    ])
    // A tick advances the frame and nudges a redraw.
    const renders: number[] = []
    const animating = new ThinkingComponent(
      thinkingItem({ text: 'x', streaming: true }),
      COLORS,
      fakeBlueComponents(),
      () => { renders.push(1) },
    )
    timers.ticks[2]!()
    expect(animating.render(30)[1]).toBe('⠙ thinking...')
    expect(renders).toHaveLength(1)
  })

  it('finalizes in place: bullet, folded preview, and the expansion hint', () => {
    const component = new ThinkingComponent(
      thinkingItem({ text: SIX_WORDS }),
      tagged(),
      fakeBlueComponents(),
    )
    const wide = component.render(40)
    expect(wide[0]).toBe('')
    expect(wide[1]).toBe('[M]● [/M]\x1b[3m[M]l0 l1 l2 l3 l4 l5[/M]\x1b[23m')
    // Folding asserts at a narrow width with identity colors: two preview
    // rows then the expansion hint, every row within the given width.
    const narrow = new ThinkingComponent(
      thinkingItem({ text: SIX_WORDS }),
      COLORS,
      fakeBlueComponents(),
    ).render(5)
    expect(narrow).toEqual([
      '',
      '● \x1b[3ml0\x1b[23m',
      '  \x1b[3ml1\x1b[23m',
      '  ..\x1b[0m…\x1b[0m',
    ])
    // Expansion opens the full body; short bodies never fold.
    component.setExpanded(true)
    expect(component.render(40)).toEqual([
      '',
      '[M]● [/M]\x1b[3m[M]l0 l1 l2 l3 l4 l5[/M]\x1b[23m',
    ])
    const short = new ThinkingComponent(
      thinkingItem({ text: 'one line only' }),
      tagged(),
      fakeBlueComponents(),
    )
    expect(short.render(40)).toEqual(['', '[M]● [/M]\x1b[3m[M]one line only[/M]\x1b[23m'])
  })

  it('renders zero rows for a blank finalized block and a bare live one', () => {
    // The authoritative rewrite emptied the streamed reasoning.
    const blank = new ThinkingComponent(thinkingItem({ text: '' }), tagged(), fakeBlueComponents())
    expect(blank.render(40)).toEqual([])
    // An empty live item (only constructible directly) still shows the row.
    const empty = new ThinkingComponent(
      thinkingItem({ text: '', streaming: true }),
      tagged(),
      fakeBlueComponents(),
    )
    expect(empty.render(40)).toEqual(['', '[M]⠋[/M] [M]thinking...[/M]', '  \x1b[3m[M][/M]\x1b[23m'])
  })

  it('truncates the expansion hint to the available width', () => {
    const component = new ThinkingComponent(
      thinkingItem({ text: SIX_WORDS }),
      COLORS,
      fakeBlueComponents(),
    )
    // Width 6 leaves 4 for the hint: three kept characters plus the
    // ellipsis (reset-wrapped by pi-tui even inside the tag markers).
    expect(component.render(6).at(-1)).toBe('  ...\x1b[0m…\x1b[0m')
    // Width 3 leaves a single column: the bare ellipsis.
    expect(component.render(3).at(-1)).toBe('  \x1b[0m…\x1b[0m')
  })

  it('stands the spinner down once the item finalizes, and on dispose', () => {
    const timers = new FakeTimers()
    setThinkingTimers(timers)
    const item = thinkingItem({ text: 'x', streaming: true })
    const renders: number[] = []
    const component = new ThinkingComponent(item, COLORS, fakeBlueComponents(), () => { renders.push(1) })
    item.streaming = false
    // The first tick after the finalize notices and retires the timer
    // without animating or nudging a redraw.
    timers.ticks[0]!()
    expect(timers.cleared).toBe(1)
    expect(renders).toHaveLength(0)
    // dispose stops whatever remains (also idempotent on a stopped timer).
    component.dispose()
    expect(timers.cleared).toBe(1)

    const live = new ThinkingComponent(
      thinkingItem({ text: 'x', streaming: true }),
      COLORS,
      fakeBlueComponents(),
    )
    live.dispose()
    expect(timers.cleared).toBe(2)
  })

  it('caches by item state and rebuilds after invalidate', () => {
    const component = new ThinkingComponent(thinkingItem({ text: 'a' }), COLORS, fakeBlueComponents())
    expect(component.render(40)).toBe(component.render(40))
    component.setExpanded(true)
    expect(component.render(40)).toBe(component.render(40))
    component.invalidate()
    const rebuilt = component.render(40)
    expect(rebuilt).toEqual(component.render(40))
    expect(rebuilt.length).toBeGreaterThan(0)
  })

  it('starts no timer for a finalized item and animates with the default timers', async () => {
    const timers = new FakeTimers()
    setThinkingTimers(timers)
    new ThinkingComponent(thinkingItem({ text: 'done' }), COLORS, fakeBlueComponents())
    expect(timers.ticks).toHaveLength(0)

    setThinkingTimers(undefined)
    const renders: number[] = []
    new ThinkingComponent(
      thinkingItem({ text: 'live', streaming: true }),
      COLORS,
      fakeBlueComponents(),
      () => { renders.push(1) },
    )
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(renders.length).toBeGreaterThan(0)
  })
})

describe('THINKING_PREVIEW_LINES', () => {
  it('is the kimi constant: two', () => {
    expect(THINKING_PREVIEW_LINES).toBe(2)
  })
})
