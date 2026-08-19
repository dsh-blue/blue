/**
 * The `blueStatus` registry and footer shell: registration discipline
 * (duplicate ids, disposers, priority ordering with stable ties), the
 * registry→shell nudge, and the two-band layout — first-fit left clusters
 * joined by the two-space slot gap, right clusters right-aligned after a
 * minimum gap and yielding under width pressure. Rendered against the fake
 * `BlueComponents` factory so assertions see structure, not escape codes.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueOverlayHandle,
  BlueScreen,
} from '@deepseek-ai/dsh-blue-core'
import { BlueStatusError, BlueStatusService, FooterShellComponent } from '../src/status.ts'
import type { BlueStatusEntry } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Records render requests; every other screen method is out of scope. */
class FakeScreen implements BlueScreen {
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  readonly rows = 24

  addChild(): () => void {
    throw new Error('fake addChild is out of scope for status tests')
  }

  addBottomChild(_component: BlueComponent): () => void {
    return () => {}
  }

  removeChild(): void {}

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('fake showOverlay is out of scope for status tests')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }
}

interface Harness {
  status: BlueStatusService
  footer: FooterShellComponent
  screen: FakeScreen
}

/** A real registry + shell pair over a fresh Cordis root and fake screen. */
function setup(): Harness {
  const screen = new FakeScreen()
  const status = new BlueStatusService(new Context(), screen)
  const footer = new FooterShellComponent(status, fakeBlueComponents())
  status.attach(footer)
  return { status, footer, screen }
}

/**
 * An honest fixed-text entry: renders `text` when it fits the offered
 * budget, '' otherwise — the contract every bundled entry follows.
 */
function fixedEntry(id: string, priority: number, text: string): BlueStatusEntry {
  return { id, priority, render: width => (text.length <= width ? text : '') }
}

describe('BlueStatusService', () => {
  it('orders entries by priority, stable on ties', () => {
    const { status } = setup()
    status.register(fixedEntry('c', 20, 'c'))
    status.register(fixedEntry('a', 0, 'a'))
    status.register(fixedEntry('b1', 10, 'b1'))
    status.register(fixedEntry('b2', 10, 'b2'))
    expect(status.sortedEntries.map(entry => entry.id)).toEqual(['a', 'b1', 'b2', 'c'])
  })

  it('throws on a duplicate id and leaves the registry untouched', () => {
    const { status } = setup()
    status.register(fixedEntry('a', 0, 'a'))
    expect(() => status.register(fixedEntry('a', 5, 'again')))
      .toThrowError(BlueStatusError)
    expect(() => status.register(fixedEntry('a', 5, 'again')))
      .toThrowError(/already registered/)
    expect(status.sortedEntries.map(entry => entry.id)).toEqual(['a'])
    try {
      status.register(fixedEntry('a', 5, 'again'))
    } catch (error) {
      expect((error as BlueStatusError).code).toBe('DUPLICATE_ENTRY')
    }
  })

  it('disposes once and lets the id be claimed again', () => {
    const { status } = setup()
    const dispose = status.register(fixedEntry('a', 0, 'a'))
    dispose()
    dispose()
    expect(status.sortedEntries).toEqual([])
    status.register(fixedEntry('a', 0, 'b'))
    expect(status.sortedEntries[0]?.render(80)).toBe('b')
  })

  it('nudges the shell on register and dispose without an explicit invalidate', () => {
    const { status, footer, screen } = setup()
    const baseline = screen.renderRequests.length
    const dispose = status.register(fixedEntry('a', 0, 'alpha'))
    expect(screen.renderRequests.length).toBe(baseline + 1)
    expect(footer.render(80)[0]).toContain('alpha')
    dispose()
    expect(screen.renderRequests.length).toBe(baseline + 2)
    expect(footer.render(80)).toEqual([])
  })

  it('tolerates registrations before the shell is attached', () => {
    const screen = new FakeScreen()
    const status = new BlueStatusService(new Context(), screen)
    status.register(fixedEntry('a', 0, 'a'))
    expect(screen.renderRequests).toHaveLength(1)
  })
})

describe('FooterShellComponent', () => {
  it('renders zero rows for an empty registry or all-hidden entries', () => {
    const { status, footer } = setup()
    expect(footer.render(80)).toEqual([])
    status.register(fixedEntry('hidden', 0, 'x'.repeat(200)))
    status.register({ id: 'blank', priority: 1, render: () => '' })
    expect(footer.render(80)).toEqual([])
  })

  it('joins entries with the two-space slot gap and pads to the width', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register(fixedEntry('b', 10, 'bbb'))
    expect(footer.render(12)[0]).toBe('aa  bbb     ')
  })

  it('skips hidden entries without leaving gap residue', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register({ id: 'off', priority: 5, render: () => '' })
    status.register(fixedEntry('b', 10, 'bb'))
    expect(footer.render(80)[0]).toBe(`aa  bb${' '.repeat(74)}`)
  })

  it('drops overflow within the band instead of spilling into another band', () => {
    const { status, footer } = setup()
    // Band 1 left: 'aaaa'(4) + 2 + 'bbbb'(4) + 2 + 'cccc'(4) = 16 of 20
    // columns; 'dddd' would need 2 more — it and everything after it yield.
    status.register(fixedEntry('a', 0, 'aaaa'))
    status.register(fixedEntry('b', 1, 'bbbb'))
    status.register(fixedEntry('c', 2, 'cccc'))
    status.register(fixedEntry('d', 3, 'dddd'))
    status.register(fixedEntry('e', 4, 'eeee'))
    expect(footer.render(20)).toEqual([`aaaa  bbbb  cccc    `])
  })

  it('stops offering renders once the cluster budget is spent', () => {
    const { status, footer } = setup()
    // 'aaaa' + gap + 'bbbb' consumes the 10 columns exactly; 'cccc' is not
    // even offered a render — there is nothing left to negotiate with.
    status.register(fixedEntry('a', 0, 'aaaa'))
    status.register(fixedEntry('b', 1, 'bbbb'))
    let offered = false
    status.register({
      id: 'c',
      priority: 2,
      render: (width) => {
        offered = true
        return 'c'.repeat(width)
      },
    })
    expect(footer.render(10)).toEqual(['aaaa  bbbb'])
    expect(offered).toBe(false)
  })

  it('lays row-2 entries on their own band below row 1', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register({ id: 'b', priority: 20, row: 2, render: () => 'bbbb' })
    expect(footer.render(10)).toEqual(['aa        ', 'bbbb      '])
  })

  it('right-aligns the right cluster after a minimum gap', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register({ id: 'tip', priority: 30, align: 'right', render: () => 'tip' })
    // 'aa'(2) + at least 2 gap columns + 'tip'(3): 13 trailing-pad columns.
    expect(footer.render(20)[0]).toBe(`aa${' '.repeat(15)}tip`)
  })

  it('right-aligns a lone right cluster to the width', () => {
    const { status, footer } = setup()
    status.register({ id: 'ctx', priority: 20, align: 'right', row: 2, render: () => 'ctx' })
    expect(footer.render(10)).toEqual([`       ctx`])
  })

  it('starves the right cluster out of the frame before the left yields', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'a'.repeat(17)))
    status.register({ id: 'tip', priority: 30, align: 'right', render: () => 'tip' })
    // 17 used, 3 remaining — below the 2-column gap plus any tip width the
    // budget is positive but the tip (3) does not fit: dropped for the frame.
    expect(footer.render(20)[0]).toBe(`${'a'.repeat(17)}   `)
  })

  it('clamps dishonest row and align values into the budget', () => {
    const { status, footer } = setup()
    status.register({ id: 'band9', priority: 0, row: 9 as 2, align: undefined, render: () => 'b9' })
    status.register({ id: 'weird', priority: 1, align: 'center' as 'left', render: () => 'wd' })
    // row 9 clamps into band 2; align 'center' is treated as left.
    expect(footer.render(10)).toEqual(['wd        ', 'b9        '])
  })

  it('drops an entry wider than a whole row', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    // A contract-violating entry (returns text wider than the budget it was
    // offered) is measured and skipped just the same.
    status.register({ id: 'dishonest', priority: 2, render: () => 'x'.repeat(25) })
    expect(footer.render(20)).toEqual([`aa${' '.repeat(18)}`])
  })

  it('offers each entry the width remaining on its cluster', () => {
    const { status, footer } = setup()
    const budgets: number[] = []
    status.register(fixedEntry('a', 0, 'aaaa'))
    status.register({
      id: 'b',
      priority: 1,
      render: (width) => {
        budgets.push(width)
        return 'b'.repeat(Math.min(4, width))
      },
    })
    footer.render(20)
    expect(budgets).toEqual([14])
  })

  it('offers a right-cluster entry the budget left of the gap', () => {
    const { status, footer } = setup()
    const budgets: number[] = []
    status.register(fixedEntry('a', 0, 'aaaa'))
    status.register({
      id: 'r',
      priority: 1,
      align: 'right',
      render: (width) => {
        budgets.push(width)
        return 'r'.repeat(Math.min(2, width))
      },
    })
    footer.render(20)
    expect(budgets).toEqual([14])
  })

  it('re-lays-out when an entry changes its text, and invalidate clears the cache', () => {
    const { status, footer } = setup()
    let text = 'one'
    status.register({ id: 'a', priority: 0, render: () => text })
    const first = footer.render(80)
    expect(first).toBe(footer.render(80))
    text = 'two'
    const second = footer.render(80)
    expect(second[0]).toContain('two')
    footer.invalidate()
    expect(footer.render(80)).toEqual(second)
    expect(footer.render(80)).not.toBe(second)
  })
})
