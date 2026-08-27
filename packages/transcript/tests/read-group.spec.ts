/**
 * The read-group card: header states and chips, the by-file tree with
 * single-window inline rows and multi-window nesting, mixed-state parents,
 * the collapsed row cap, the expanded preview lines, and width truncation —
 * measured with pi-tui's own counters (D48 real-semantics).
 */

import { describe, expect, it } from 'vitest'
import type { BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import type { ReadCallModel, TranscriptReadGroupModel } from '@dsh-blue/blue-frontend'
import {
  groupReadsByFile,
  READ_GROUP_EXPANDED_ROW_LIMIT,
  READ_GROUP_ROW_LIMIT,
  ReadGroupComponent,
} from '../src/read-group.ts'
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

function read(partial: Partial<ReadCallModel> & { callId: string }): ReadCallModel {
  return { seq: 1, turn: 1, step: 0, state: 'ok', ...partial }
}

function group(reads: readonly ReadCallModel[], partial: Partial<TranscriptReadGroupModel> = {}): TranscriptReadGroupModel {
  const first = reads[0]!
  return { kind: 'transcript-read-group', id: `read-group:${String(first.callId)}`, seq: first.seq, turn: first.turn, step: first.step, reads, ...partial }
}

describe('groupReadsByFile', () => {
  it('keeps first-read order and drops pathless calls', () => {
    const groups = groupReadsByFile([
      read({ callId: 'a', path: 'one.ts' }),
      read({ callId: 'b', path: 'two.ts' }),
      read({ callId: 'c' }),
      read({ callId: 'd', path: 'one.ts' }),
    ])
    expect(groups).toEqual([
      { path: 'one.ts', reads: [expect.objectContaining({ callId: 'a' }), expect.objectContaining({ callId: 'd' })] },
      { path: 'two.ts', reads: [expect.objectContaining({ callId: 'b' })] },
    ])
    expect(groupReadsByFile([read({ callId: 'x' })])).toEqual([])
  })
})

describe('ReadGroupComponent', () => {
  it('renders the settled header with chips and the by-file tree', () => {
    const model = group([
      read({ callId: 'a', path: 'src/foo.ts', range: { first: 1, last: 100 } }),
      read({ callId: 'b', path: 'src/foo.ts', range: { first: 101, last: 120 }, totalLines: 342 }),
      read({ callId: 'c', path: 'src/bar.ts', range: { first: 1, last: 40 }, totalLines: 89 }),
      read({ callId: 'd', path: 'package.json', state: 'error', error: 'file not found' }),
    ])
    const lines = new ReadGroupComponent(model, tagged(), COMPONENTS).render(80)
    expect(lines).toEqual([
      '',
      '[S]✓ [/S]\x1b[1m[P]Read 3 files[/P]\x1b[22m[M] · 4 reads[/M][E] · 1 failed[/E]',
      '  ├─ src/foo.ts',
      '  │  ├─ 1-100 [S]✓[/S]',
      '  │  └─ 101-120 of 342 [S]✓[/S]',
      '  ├─ src/bar.ts · 1-40 of 89 [S]✓[/S]',
      '  └─ package.json [E]✗[/E] [E]file not found[/E]',
    ])
  })

  it('renders pending, all-failed, and mixed parents', () => {
    const pending = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', state: 'pending', requestedRange: { first: 1, last: 50 } }),
    ]), tagged(), COMPONENTS).render(80)
    expect(pending[1]).toBe('● \x1b[1m[P]Reading 1 file…[/P]\x1b[22m')
    expect(pending[2]).toBe('  └─ one.ts · 1-50 [T]…[/T]')

    const failed = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', state: 'error', error: 'nope' }),
      read({ callId: 'b', path: 'one.ts', state: 'error', error: 'still nope' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(failed[1]).toBe('[E]✗ [/E]\x1b[1m[E]Read 1 file · failed[/E]\x1b[22m[M] · 2 reads[/M]')
    expect(failed[2]).toBe('  └─ one.ts [E]✗[/E] [E]nope[/E]')

    const mixed = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', range: { first: 1, last: 10 } }),
      read({ callId: 'b', path: 'one.ts', state: 'error', error: 'gone' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(mixed[2]).toBe('  └─ one.ts [W]◐[/W] [E]gone[/E]')

    // A single-window failure without detail inlines the bare mark; an
    // all-failed multi-file run pluralizes the header.
    const silent = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', state: 'error' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(silent[2]).toBe('  └─ one.ts [E]✗[/E]')
    const plural = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', state: 'error', error: 'x' }),
      read({ callId: 'b', path: 'two.ts', state: 'error', error: 'y' }),
    ]), tagged(), COMPONENTS).render(80)
    expect(plural[1]).toBe('[E]✗ [/E]\x1b[1m[E]Read 2 files · failed[/E]\x1b[22m')

    const reading = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', range: { first: 1, last: 10 } }),
      read({ callId: 'b', path: 'one.ts', state: 'pending', requestedRange: { first: 11, last: 20 } }),
    ]), tagged(), COMPONENTS).render(80)
    expect(reading[2]).toBe('  └─ one.ts[T] · reading…[/T]')

    const pathless = new ReadGroupComponent(group([read({ callId: 'a', state: 'ok' })]), tagged(), COMPONENTS).render(80)
    expect(pathless).toEqual(['', '[S]✓ [/S]\x1b[1m[P]Read 0 files[/P]\x1b[22m[M] · 1 reads[/M]'])
  })

  it('renders degraded rows: absent ranges, blank errors, and the cache', () => {
    const component = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', state: 'error' }),
      read({ callId: 'b', path: 'one.ts', state: 'error' }),
    ]), tagged(), COMPONENTS)
    const lines = component.render(80)
    expect(lines[2]).toBe('  └─ one.ts [E]✗[/E]')
    expect(lines[3]).toBe('     ├─ read [E]✗[/E]')
    expect(lines[4]).toBe('     └─ read [E]✗[/E]')
    // The immutable model keeps the cache hot for the same width and state.
    expect(component.render(80)).toBe(lines)

    const bare = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts' }),
      read({ callId: 'b', path: 'one.ts' }),
    ]), IDENTITY, COMPONENTS)
    bare.setExpanded(true)
    expect(bare.render(80)).toEqual([
      '',
      '✓ \x1b[1mRead 1 file\x1b[22m · 2 reads',
      '  └─ one.ts',
      '     ├─ read ✓',
      '     └─ read ✓',
    ])
  })

  it('caps the collapsed tree and expands into preview lines', () => {
    // A multi-window file nests its previews under each window row.
    const nested = new ReadGroupComponent(group([
      read({ callId: 'a', path: 'one.ts', range: { first: 1, last: 2 }, previewLines: [{ number: 1, text: 'alpha' }] }),
      read({ callId: 'b', path: 'one.ts', range: { first: 3, last: 4 }, previewLines: [{ number: 3, text: 'beta' }] }),
    ]), IDENTITY, COMPONENTS)
    nested.setExpanded(true)
    expect(nested.render(80)).toEqual([
      '',
      '✓ \x1b[1mRead 1 file\x1b[22m · 2 reads',
      '  └─ one.ts',
      '     ├─ 1-2 ✓',
      '     │  1  alpha',
      '     └─ 3-4 ✓',
      '        3  beta',
    ])

    const reads = Array.from({ length: 12 }, (_, index) => read({
      callId: `r${String(index)}`,
      path: `file${String(index)}.ts`,
      range: { first: 1, last: 10 },
      previewLines: [{ number: 1, text: 'first' }, { number: 2, text: 'second' }],
    }))
    const component = new ReadGroupComponent(group(reads), IDENTITY, COMPONENTS)
    const collapsed = component.render(80)
    expect(collapsed).toHaveLength(1 + 1 + READ_GROUP_ROW_LIMIT)
    expect(collapsed.at(-1)).toContain('more, ctrl+o to expand')
    expect(collapsed.some(line => line.includes('first'))).toBe(false)

    component.setExpanded(true)
    const expanded = component.render(80)
    expect(expanded.some(line => line.includes('1  first'))).toBe(true)
    expect(expanded.some(line => line.includes('2  second'))).toBe(true)
    component.setExpanded(false)
    expect(component.render(80)).toEqual(collapsed)
    component.invalidate()
    expect(component.render(80)).toEqual(collapsed)
  })

  it('bounds the expanded tree and truncates every row to the viewport', () => {
    const reads = Array.from({ length: 90 }, (_, index) => read({
      callId: `r${String(index)}`,
      path: `file${String(index)}.ts`,
      range: { first: 1, last: 10 },
      previewLines: Array.from({ length: 5 }, (_, line) => ({ number: line + 1, text: `text ${String(line)}` })),
    }))
    const component = new ReadGroupComponent(group(reads), IDENTITY, COMPONENTS)
    component.setExpanded(true)
    const expanded = component.render(60)
    expect(expanded).toHaveLength(2 + READ_GROUP_EXPANDED_ROW_LIMIT)
    expect(expanded.at(-1)).toContain('more lines')
    for (const row of expanded) expect(COMPONENTS.visibleWidth(row)).toBeLessThanOrEqual(60)
    const narrow = new ReadGroupComponent(group([
      read({ callId: 'wide', path: 'a/very/deep/path/that/exceeds/the/columns.ts', range: { first: 1, last: 9 }, totalLines: 99, error: undefined }),
    ]), IDENTITY, COMPONENTS).render(24)
    for (const row of narrow) expect(COMPONENTS.visibleWidth(row)).toBeLessThanOrEqual(24)
  })
})
