/**
 * The `blueStatus` registry and footer shell: registration discipline
 * (duplicate ids, disposers, priority ordering with stable ties), the
 * registry→shell nudge, and the two-row first-fit layout with its
 * lowest-priority drop policy. Rendered against identity colors and the fake
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

/** Identity colors except a tagged muted, so the separator is visible. */
const id = (text: string): string => text
const COLORS = {
  text: id, textStrong: id, muted: (text: string): string => `[M]${text}[/M]`,
  textMuted: id, accent: id, primary: id, border: id, borderFocus: id, success: id, error: id,
  warning: id,
  selectedBg: id, roleUser: id, shellMode: id, mdHeading: id, mdLink: id,
  mdLinkUrl: id, mdCode: id, mdCodeBlock: id, mdCodeBlockBorder: id, mdQuote: id,
  mdQuoteBorder: id, mdHr: id, mdListBullet: id, diffAdded: id, diffRemoved: id,
  diffAddedStrong: id, diffRemovedStrong: id, diffGutter: id, diffMeta: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Records render requests; every other screen method is out of scope. */
class FakeScreen implements BlueScreen {
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80

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
  const footer = new FooterShellComponent(status, COLORS, fakeBlueComponents())
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

  it('joins entries with a muted separator and pads to the width', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register(fixedEntry('b', 10, 'bbb'))
    const line = footer.render(12)[0]!
    // Tagged (non-SGR) markers, so exact equality is the width proof here.
    expect(line).toBe('aa[M] · [/M]bbb    ')
  })

  it('skips hidden entries without leaving separator residue', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register({ id: 'off', priority: 5, render: () => '' })
    status.register(fixedEntry('b', 10, 'bb'))
    expect(footer.render(80)[0]).toBe(`aa[M] · [/M]bb${' '.repeat(73)}`)
  })

  it('wraps overflow onto a second row and drops what fits neither', () => {
    const { status, footer } = setup()
    // Row 0: 'aaaa'(4) + 3 + 'bbbb'(4) + 3 + 'cccc'(4) = 18 of 20 columns;
    // 'dddd' wraps, then row 1 takes 'eeee' and 'ffffff' (exactly 20);
    // 'gggg' — the lowest priority — fits neither row and is dropped.
    status.register(fixedEntry('a', 0, 'aaaa'))
    status.register(fixedEntry('b', 1, 'bbbb'))
    status.register(fixedEntry('c', 2, 'cccc'))
    status.register(fixedEntry('d', 3, 'dddd'))
    status.register(fixedEntry('e', 4, 'eeee'))
    status.register(fixedEntry('f', 5, 'ffffff'))
    status.register(fixedEntry('g', 6, 'gggg'))
    const lines = footer.render(20)
    expect(lines).toEqual([
      'aaaa[M] · [/M]bbbb[M] · [/M]cccc  ',
      'dddd[M] · [/M]eeee[M] · [/M]ffffff',
    ])
  })

  it('lets a too-wide-for-row-0 entry claim the second row', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('wide', 0, 'w'.repeat(18)))
    status.register(fixedEntry('narrow', 1, 'nnnnn'))
    // 'ww…'(18) leaves 2 columns: too few for ' · nnnnn', which wraps whole.
    const lines = footer.render(20)
    expect(lines).toEqual([
      `${'w'.repeat(18)}  `,
      `nnnnn${' '.repeat(15)}`,
    ])
  })

  it('drops an entry wider than a whole row', () => {
    const { status, footer } = setup()
    status.register(fixedEntry('a', 0, 'aa'))
    status.register(fixedEntry('huge', 1, 'h'.repeat(30)))
    // A contract-violating entry (returns text wider than the budget it was
    // offered) is measured and skipped just the same.
    status.register({ id: 'dishonest', priority: 2, render: () => 'x'.repeat(25) })
    expect(footer.render(20)).toEqual([`aa${' '.repeat(18)}`])
  })

  it('offers each entry the width remaining on its row', () => {
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
    expect(budgets).toEqual([13])
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
