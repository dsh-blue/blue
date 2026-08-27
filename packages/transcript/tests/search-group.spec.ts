/**
 * The search-group card: header states and chips, pattern rows with match
 * and path counts, capped-search honesty, the collapsed row cap, the expanded
 * file tree with bounded match previews, and width truncation — measured
 * with pi-tui's own counters (D48 real-semantics).
 */

import { describe, expect, it } from 'vitest'
import type { BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import type { SearchCallModel, TranscriptSearchGroupModel } from '@dsh-blue/blue-frontend'
import {
  SEARCH_GROUP_EXPANDED_ROW_LIMIT,
  SEARCH_GROUP_ROW_LIMIT,
  SearchGroupComponent,
} from '../src/search-group.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors: assertions see structure, not escape codes. */
const id = (text: string): string => text
const IDENTITY: BlueSemanticColors = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id, success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id, mdCodeBlockBorder: id,
  mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id, diffGutter: id, diffMeta: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Tagged colors for role assertions. */
function tagged(): BlueSemanticColors {
  const tag = (letter: string) => (text: string): string => `[${letter}]${text}[/${letter}]`
  return { ...IDENTITY, muted: tag('M'), textMuted: tag('T'), primary: tag('P'), success: tag('S'), error: tag('E'), warning: tag('W') }
}

const COMPONENTS: BlueComponents = fakeBlueComponents()

function search(partial: Partial<SearchCallModel> & { callId: string }): SearchCallModel {
  return { seq: 1, turn: 1, step: 0, state: 'ok', ...partial }
}

function group(searches: readonly SearchCallModel[]): TranscriptSearchGroupModel {
  const first = searches[0]!
  return { kind: 'transcript-search-group', id: `search-group:${String(first.callId)}`, seq: first.seq, turn: first.turn, step: first.step, searches }
}

describe('SearchGroupComponent', () => {
  it('renders the settled header with counts and the mixed pattern tree', () => {
    const model = group([
      search({
        callId: 'g1', pattern: 'export const', shape: 'matches',
        files: [
          { path: 'src/core/a.ts', count: 12, previews: [{ lineNumber: 3, line: 'export const one = 1' }] },
          { path: 'src/core/b.ts', count: 6, previews: [] },
        ],
        truncated: true, total: 34,
      }),
      search({ callId: 'p1', pattern: 'src/**/*.ts', shape: 'paths', paths: ['src/a.ts', 'src/b.ts'], pathsTotal: 12, truncated: true, total: 12 }),
      search({ callId: 'g2', pattern: 'TODO', shape: 'matches', files: [] }),
      search({ callId: 'g3', pattern: 'gone', state: 'error', error: 'invalid pattern' }),
    ])
    const lines = new SearchGroupComponent(model, tagged(), COMPONENTS).render(140)
    expect(lines).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]Searched 4 patterns[/P]\x1b[22m[M] · 2 files, 34 matches, 12 paths[/M][E] · 1 failed[/E]',
      '  ├─ "export const" · 2 files, 18 of 34 matches [S]✓[/S]',
      '  ├─ src/**/*.ts · 12 paths [S]✓[/S]',
      '  ├─ "TODO" · 0 matches [S]✓[/S]',
      '  └─ gone [E]✗[/E] [E]invalid pattern[/E]',
    ])
  })

  it('renders pending and all-failed headers', () => {
    const pending = new SearchGroupComponent(group([
      search({ callId: 'a', pattern: 'one', state: 'pending' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(pending[1]).toBe('● \x1b[1m[P]Searching 1 pattern…[/P]\x1b[22m')
    expect(pending[2]).toBe('  └─ one [T]…[/T]')

    const failed = new SearchGroupComponent(group([
      search({ callId: 'a', pattern: 'one', state: 'error', error: 'nope' }),
      search({ callId: 'b', pattern: 'two', state: 'error', error: 'nope' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(failed[1]).toBe('[E]✗ [/E]\x1b[1m[E]Searched 2 patterns · failed[/E]\x1b[22m')

    // Single-path glob rows singularize; a paths view without totals counts
    // the retained page; a settled search without a result view still rows.
    const solo = new SearchGroupComponent(group([
      search({ callId: 'p', pattern: '*.ts', shape: 'paths', paths: ['only.ts'], pathsTotal: 1, total: 1 }),
      search({ callId: 'q', pattern: '*.md', shape: 'paths', paths: ['a.md', 'b.md'] }),
      search({ callId: 'r', pattern: 'meta-less' }),
    ]), IDENTITY, COMPONENTS).render(80)
    expect(solo[2]).toBe('  ├─ *.ts · 1 path ✓')
    expect(solo[3]).toBe('  ├─ *.md · 2 paths ✓')
    expect(solo[4]).toBe('  └─ meta-less ✓')
  })

  it('expands file rows with bounded match previews and capped path pages', () => {
    const model = group([
      search({
        callId: 'g1', pattern: 'const', shape: 'matches',
        files: [
          { path: 'a.ts', count: 2, previews: [{ lineNumber: 1, line: 'const x' }, { lineNumber: 5, line: 'const y' }] },
          { path: 'b.ts', count: 1, previews: [{ lineNumber: 9, line: 'const z' }] },
        ],
      }),
      search({ callId: 'p1', pattern: '*.ts', shape: 'paths', paths: ['a.ts'], pathsTotal: 3, total: 3 }),
    ])
    const component = new SearchGroupComponent(model, IDENTITY, COMPONENTS)
    const collapsed = component.render(80)
    expect(collapsed.some(line => line.includes('const x'))).toBe(false)
    component.setExpanded(true)
    expect(component.render(80)).toEqual([
      '',
      '✓ \x1b[1mSearched 2 patterns\x1b[22m · 2 files, 3 matches, 3 paths',
      '  ├─ "const" · 2 files, 3 matches ✓',
      '  │  ├─ a.ts · 2',
      '  │  │  1: const x',
      '  │  │  5: const y',
      '  │  └─ b.ts · 1',
      '  │     9: const z',
      '  └─ *.ts · 3 paths ✓',
      '     └─ a.ts',
      '     … 2 more paths',
    ])
    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
    component.invalidate()
    expect(component.render(80)).toEqual(collapsed)
  })

  it('covers the degraded corners: caches, singular chips, missing facts', () => {
    // A grep-only group: one file, one match — singular chips, expanded
    // previews, and the render cache returning the same rows.
    const grepOnly = new SearchGroupComponent(group([
      search({ callId: 'a', pattern: 'solo', shape: 'matches', files: [{ path: 'a.ts', count: 1, previews: [{ lineNumber: 2, line: 'hit' }] }] }),
    ]), IDENTITY, COMPONENTS)
    const grepRows = grepOnly.render(80)
    expect(grepRows[1]).toBe('✓ \x1b[1mSearched 1 pattern\x1b[22m · 1 file, 1 match')
    expect(grepOnly.render(80)).toBe(grepRows)
    grepOnly.setExpanded(true)
    expect(grepOnly.render(80)).toEqual([
      '',
      '✓ \x1b[1mSearched 1 pattern\x1b[22m · 1 file, 1 match',
      '  └─ "solo" · 1 file, 1 match ✓',
      '     └─ a.ts · 1',
      '        2: hit',
    ])

    // A glob-only group: one path, no totals; expanded shows the page.
    const globOnly = new SearchGroupComponent(group([
      search({ callId: 'b', pattern: '*.only', shape: 'paths', paths: ['only.ts'] }),
    ]), IDENTITY, COMPONENTS)
    expect(globOnly.render(80)[1]).toBe('✓ \x1b[1mSearched 1 pattern\x1b[22m · 1 path')
    globOnly.setExpanded(true)
    expect(globOnly.render(80)).toEqual([
      '',
      '✓ \x1b[1mSearched 1 pattern\x1b[22m · 1 path',
      '  └─ *.only · 1 path ✓',
      '     └─ only.ts',
    ])

    // Degraded members: a patternless pending row, a silent failure, a
    // paths call with no page, and an expanded shape-less call's empty tail.
    const degraded = new SearchGroupComponent(group([
      search({ callId: 'c', state: 'pending' }),
      search({ callId: 'd', pattern: 'boom', state: 'error' }),
      search({ callId: 'e', pattern: 'thin', shape: 'paths' }),
      search({ callId: 'f', pattern: 'bare' }),
      search({ callId: 'g', pattern: 'files-less', shape: 'matches' }),
    ]), IDENTITY, COMPONENTS)
    expect(degraded.render(80)).toEqual([
      '',
      '● \x1b[1mSearching 5 patterns…\x1b[22m · 1 failed',
      '  ├─ search …',
      '  ├─ boom ✗',
      '  ├─ thin · 0 paths ✓',
      '  ├─ bare ✓',
      '  └─ "files-less" · 0 matches ✓',
    ])
    degraded.setExpanded(true)
    expect(degraded.render(80)).toEqual([
      '',
      '● \x1b[1mSearching 5 patterns…\x1b[22m · 1 failed',
      '  ├─ search …',
      '  ├─ boom ✗',
      '  ├─ thin · 0 paths ✓',
      '  ├─ bare ✓',
      '  └─ "files-less" · 0 matches ✓',
    ])

    // A lone failure reads singular; a multi-path glob expands with inner
    // branch glyphs.
    const lone = new SearchGroupComponent(group([
      search({ callId: 'h', pattern: 'only', state: 'error', error: 'x' }),
    ]), IDENTITY, COMPONENTS).render(80)
    expect(lone[1]).toBe('✗ \x1b[1mSearched 1 pattern · failed\x1b[22m')
    const multi = new SearchGroupComponent(group([
      search({ callId: 'i', pattern: '*.ts', shape: 'paths', paths: ['a.ts', 'b.ts', 'c.ts'], pathsTotal: 3, total: 3 }),
    ]), IDENTITY, COMPONENTS)
    multi.setExpanded(true)
    expect(multi.render(80)).toEqual([
      '',
      '✓ \x1b[1mSearched 1 pattern\x1b[22m · 3 paths',
      '  └─ *.ts · 3 paths ✓',
      '     ├─ a.ts',
      '     ├─ b.ts',
      '     └─ c.ts',
    ])
  })

  it('caps the collapsed tree, bounds the expanded tree, and fits every row', () => {
    const many = Array.from({ length: 12 }, (_, index) => search({
      callId: `g${String(index)}`, pattern: `pattern${String(index)}`, shape: 'matches',
      files: [{ path: `f${String(index)}.ts`, count: 1, previews: [{ lineNumber: 1, line: 'hit' }] }],
    }))
    const component = new SearchGroupComponent(group(many), IDENTITY, COMPONENTS)
    const collapsed = component.render(80)
    expect(collapsed).toHaveLength(2 + SEARCH_GROUP_ROW_LIMIT)
    expect(collapsed.at(-1)).toContain('more, ctrl+o to expand')

    const huge = Array.from({ length: 90 }, (_, index) => search({
      callId: `h${String(index)}`, pattern: `p${String(index)}`, shape: 'matches',
      files: Array.from({ length: 3 }, (_, file) => ({ path: `f${String(file)}.ts`, count: 1, previews: [{ lineNumber: 1, line: 'hit' }] })),
    }))
    const big = new SearchGroupComponent(group(huge), IDENTITY, COMPONENTS)
    big.setExpanded(true)
    const expanded = big.render(60)
    expect(expanded).toHaveLength(2 + SEARCH_GROUP_EXPANDED_ROW_LIMIT)
    expect(expanded.at(-1)).toContain('more lines')
    for (const row of expanded) expect(COMPONENTS.visibleWidth(row)).toBeLessThanOrEqual(60)
    const narrow = new SearchGroupComponent(group([search({ callId: 'w', pattern: 'x'.repeat(60), shape: 'paths', paths: ['y'.repeat(60)], total: 1 })]), IDENTITY, COMPONENTS).render(24)
    for (const row of narrow) expect(COMPONENTS.visibleWidth(row)).toBeLessThanOrEqual(24)
  })
})
