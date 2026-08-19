/**
 * The S14 slash-command dropdown: `WrappingSelectList` renders item
 * descriptions wrapped onto at most two lines (selected rows carry the
 * highlight across both, descriptions keep their own paint), ellipsizes
 * whatever overflows, and clamps the primary column through the layout
 * options — plus the 0.84.2 privates pin: the render override reads
 * `filteredItems` / `selectedIndex` / `maxVisible` / `theme` / `layout` off a
 * stock `SelectList`, so a pi-tui rename has to redden this spec before it
 * can break the dropdown at runtime.
 */

import { SelectList, type SelectItem, type SelectListTheme } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { WrappingSelectList } from '../src/wrapping-select-list.ts'

/** Bracket paints keep every painted span visible in the assertion strings. */
const theme: SelectListTheme = {
  selectedPrefix: text => `{P:${text}}`,
  selectedText: text => `{S:${text}}`,
  description: text => `{D:${text}}`,
  scrollInfo: text => `{I:${text}}`,
  noMatch: text => `{N:${text}}`,
}

/** The slash-list layout the editor factory passes (min 12, max 32). */
const LAYOUT = { minPrimaryColumnWidth: 12, maxPrimaryColumnWidth: 32 }

const list = (items: SelectItem[], maxVisible = 5, layout: object = LAYOUT): WrappingSelectList =>
  new WrappingSelectList(items, maxVisible, theme, layout)

describe('WrappingSelectList', () => {
  it('renders the no-match row for an empty list', () => {
    expect(list([]).render(60)).toEqual(['{N:  No matching commands}'])
  })

  it('renders a selected and an unselected row with the description column', () => {
    const rows = list([
      { value: 'btw', label: '/btw', description: 'ask a side question' },
      { value: 'theme', label: '/theme', description: 'switch the color theme' },
    ]).render(60)
    // Primary column 12: `/btw` (4) gets 8 spaces, `/theme` (6) gets 6.
    expect(rows).toEqual([
      '{S:→ /btw        ask a side question}',
      '  /theme{D:      switch the color theme}',
    ])
  })

  it('wraps a description onto a second line with the column indent', () => {
    const select = list([
      { value: 'long', label: '/long', description: 'aaaa bbbb cccc dddd eeee ffff' },
      { value: 'other', label: '/other', description: 'short' },
    ])
    // Selected on the second item: the first row renders unselected (the
    // description paint applies per line), the second selected.
    select.setSelectedIndex(1)
    expect(select.render(42)).toEqual([
      '  /long{D:       aaaa bbbb cccc dddd eeee}',
      '{D:              ffff}',
      '{S:→ /other      short}',
    ])
  })

  it('carries the selected paint across both lines of a wrapped row', () => {
    const select = list([{ value: 'long', label: '/long', description: 'aaaa bbbb cccc dddd eeee ffff' }])
    expect(select.render(42)).toEqual([
      '{S:→ /long       aaaa bbbb cccc dddd eeee}',
      '{S:              ffff}',
    ])
  })

  it('ellipsizes a description that needs more than two lines', () => {
    const select = list([{ value: 'long', label: '/long', description: 'a'.repeat(60) }])
    // Wrap width 26 gives 26/26/8; the last line is rebuilt as the remaining
    // text clipped to 25 columns plus the ellipsis.
    expect(select.render(42)).toEqual([
      `{S:→ /long       ${'a'.repeat(26)}}`,
      `{S:${' '.repeat(14)}${'a'.repeat(25)}…}`,
    ])
  })

  it('collapses newlines in a description before wrapping', () => {
    const select = list([{ value: 'cmd', label: '/cmd', description: 'line one\nline two' }])
    expect(select.render(60)).toEqual(['{S:→ /cmd        line one line two}'])
  })

  it('falls back to the value when the label is empty', () => {
    const select = list([{ value: '/fallback', label: '', description: 'd' }])
    // Column 12 minus the 9-wide value leaves 3 spaces.
    expect(select.render(60)).toEqual(['{S:→ /fallback   d}'])
  })

  it('drops the description column entirely at width 40 or below', () => {
    const select = list([{ value: 'cmd', label: '/cmd', description: 'desc text' }])
    expect(select.render(40)).toEqual(['{S:→ /cmd}'])
  })

  it('falls back to a single line when the remaining description column is too narrow', () => {
    // Width 41 with a 30-wide label: the description column would start at
    // 34, leaving 5 columns — under MIN_DESCRIPTION_WIDTH.
    const select = list([{ value: 'l', label: `/${'l'.repeat(29)}`, description: 'd' }])
    expect(select.render(41)).toEqual([`{S:→ /${'l'.repeat(29)}}`])
  })

  it('treats a whitespace-only description as absent', () => {
    const select = list([{ value: 'cmd', label: '/cmd', description: '   ' }])
    expect(select.render(60)).toEqual(['{S:→ /cmd}'])
  })

  it('clamps the primary column to the layout max and truncates the label', () => {
    const select = list([
      { value: 'a', label: `/${'x'.repeat(39)}`, description: 'd' },
      { value: 'b', label: `/${'y'.repeat(39)}` },
    ])
    expect(select.render(80)).toEqual([
      // The widest label (42 with the gap) clamps to 32, leaving 30 for the
      // label itself; the description-less second row keeps its full label.
      `{S:→ /${'x'.repeat(29)}  d}`,
      `  /${'y'.repeat(39)}`,
    ])
  })

  it('honours the layout truncatePrimary hook before the plain truncation', () => {
    const upper = new WrappingSelectList(
      [{ value: 'mixed', label: '/mixed', description: 'd' }],
      5,
      theme,
      { ...LAYOUT, truncatePrimary: ctx => ctx.text.toUpperCase() },
    )
    expect(upper.render(60)).toEqual(['{S:→ /MIXED      d}'])

    const overflowing = new WrappingSelectList(
      [{ value: 'hook', label: '/hook', description: 'd' }],
      5,
      theme,
      { ...LAYOUT, truncatePrimary: () => 'z'.repeat(40) },
    )
    // Hook output longer than the column still truncates to 10 columns.
    expect(overflowing.render(60)).toEqual([`{S:→ ${'z'.repeat(10)}  d}`])
  })

  it('defaults the primary column to 32 without layout options', () => {
    const select = new WrappingSelectList(
      [{ value: 'btw', label: '/btw', description: 'ask a side question' }],
      5,
      theme,
    )
    expect(select.render(60)).toEqual([`{S:→ /btw${' '.repeat(28)}ask a side question}`])
  })

  it('derives the column bounds from a min-only or max-only layout', () => {
    const minOnly = new WrappingSelectList(
      [{ value: 'btw', label: '/btw', description: 'ask a side question' }],
      5,
      theme,
      { minPrimaryColumnWidth: 12 },
    )
    expect(minOnly.render(60)).toEqual(['{S:→ /btw        ask a side question}'])

    const maxOnly = new WrappingSelectList(
      [{ value: 'btw', label: '/btw', description: 'ask a side question' }],
      5,
      theme,
      { maxPrimaryColumnWidth: 16 },
    )
    expect(maxOnly.render(60)).toEqual(['{S:→ /btw            ask a side question}'])
  })

  it('renders the scroll indicator when the list overflows maxVisible', () => {
    const items: SelectItem[] = Array.from({ length: 7 }, (_, i) => ({
      value: `c${i}`,
      label: `/c${i}`,
    }))
    const select = list(items, 3)
    // Selection 0 of 7 with 3 visible: rows for the first three, then the
    // position indicator.
    expect(select.render(60)).toEqual([
      '{S:→ /c0}',
      '  /c1',
      '  /c2',
      '{I:  (1/7)}',
    ])

    select.setSelectedIndex(5)
    expect(select.render(60)).toEqual([
      '  /c4',
      '{S:→ /c5}',
      '  /c6',
      '{I:  (6/7)}',
    ])

    const fitted = list(items, 7)
    expect(fitted.render(60)).toEqual([
      '{S:→ /c0}',
      '  /c1',
      '  /c2',
      '  /c3',
      '  /c4',
      '  /c5',
      '  /c6',
    ])
  })
})

describe('pi-tui 0.84.2 SelectList privates pin', () => {
  it('still exposes the fields the render override reads', () => {
    // WrappingSelectList reaches pi-tui's private row state through a single
    // cast; if a pi-tui upgrade renames any of these fields the cast silently
    // yields `undefined` and the dropdown breaks at runtime — this spec is
    // the tripwire that reddens first.
    const layout = { ...LAYOUT }
    const stock = new SelectList([], 5, theme, layout)
    const internals = stock as unknown as Record<string, unknown>
    expect(internals.filteredItems).toEqual([])
    expect(internals.selectedIndex).toBe(0)
    expect(internals.maxVisible).toBe(5)
    expect(internals.theme).toBe(theme)
    expect(internals.layout).toBe(layout)

    const defaulted = new SelectList([], 5, theme) as unknown as Record<string, unknown>
    expect(defaulted.layout).toEqual({})
  })
})
