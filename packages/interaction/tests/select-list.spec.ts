/**
 * Unit tests for the shared single-select `SelectListPanel` and the list
 * geometry helpers, over the fake keymap, theme, and components.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  MAX_LIST_VISIBLE,
  SelectListPanel,
  counterRow,
  cycle,
  oneLine,
  windowedRange,
} from '../src/select-list.ts'
import type { SelectRow } from '../src/select-list.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

describe('cycle', () => {
  it('wraps at both ends and steps within', () => {
    expect(cycle(0, 3, -1)).toBe(2)
    expect(cycle(2, 3, 1)).toBe(0)
    expect(cycle(1, 3, 1)).toBe(2)
    expect(cycle(2, 3, -1)).toBe(1)
  })

  it('pins empty and single-entry lists', () => {
    expect(cycle(0, 0, 1)).toBe(0)
    expect(cycle(0, 1, -1)).toBe(0)
    expect(cycle(0, 1, 1)).toBe(0)
  })
})

describe('windowedRange', () => {
  it('centers the cursor while the list overflows', () => {
    expect(windowedRange(0, 12, 8)).toEqual({ start: 0, end: 8 })
    expect(windowedRange(5, 12, 8)).toEqual({ start: 1, end: 9 })
    expect(windowedRange(11, 12, 8)).toEqual({ start: 4, end: 12 })
  })

  it('shows everything once the list fits', () => {
    expect(windowedRange(2, 3, 8)).toEqual({ start: 0, end: 3 })
  })
})

describe('counterRow', () => {
  it('appears only beyond the window', () => {
    expect(counterRow(0, 8, 8)).toBeUndefined()
    expect(counterRow(0, 9, 8)).toBe('  (1/9)')
    expect(counterRow(4, 9, 8)).toBe('  (5/9)')
  })
})

describe('oneLine', () => {
  it('collapses line breaks and trims', () => {
    expect(oneLine('a\nb\r\nc ')).toBe('a b c')
  })
})

function rows(count: number): SelectRow[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Item ${index}`,
  }))
}

function mount(options: {
  rows?: readonly SelectRow[]
  title?: string
  titleHint?: string
  initialValue?: string
  onSelect?: (row: SelectRow) => void
  onBlockedSelect?: (row: SelectRow) => void
  onCancel?: () => void
} = {}): {
  panel: SelectListPanel
  onSelect: ReturnType<typeof vi.fn>
  onBlockedSelect: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onSelect = vi.fn()
  const onBlockedSelect = vi.fn()
  const onCancel = vi.fn()
  const panel = new SelectListPanel({
    keymap: new FakeKeymap(),
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    rows: options.rows ?? rows(3),
    title: options.title,
    titleHint: options.titleHint,
    initialValue: options.initialValue,
    onSelect: options.onSelect ?? onSelect,
    onBlockedSelect: options.onBlockedSelect ?? onBlockedSelect,
    onCancel: options.onCancel ?? onCancel,
  })
  return { panel, onSelect, onBlockedSelect, onCancel }
}

describe('SelectListPanel navigation', () => {
  it('wraps the cursor at both ends', () => {
    const { panel, onSelect } = mount()
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'v2' }))
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'v0' }))
    // Non-wrap moves in both directions.
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: 'v0' }))
  })

  it('seeds the cursor on the initial value and falls back to the head', () => {
    const seeded = mount({ initialValue: 'v1' })
    seeded.panel.handleInput(KEY.enter)
    expect(seeded.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'v1' }))
    const unknown = mount({ initialValue: 'nope' })
    unknown.panel.handleInput(KEY.enter)
    expect(unknown.onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'v0' }))
  })

  it('blocks Enter on a disabled row', () => {
    const disabled: SelectRow[] = [
      { value: 'ok', label: 'Pickable' },
      { value: 'custom', label: 'Custom', disabled: true },
    ]
    const { panel, onSelect, onBlockedSelect } = mount({ rows: disabled })
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.enter)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onBlockedSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'custom' }))
  })

  it('ignores Enter on a disabled row when no blocked handler is set', () => {
    const panel = new SelectListPanel({
      keymap: new FakeKeymap(),
      theme: new FakeTheme(),
      components: new FakeBlueComponents(),
      rows: [{ value: 'custom', label: 'Custom', disabled: true }],
      onSelect: () => {},
      onCancel: () => {},
    })
    panel.handleInput(KEY.enter)
    // No throw and no selection: the press is swallowed.
  })

  it('ignores submit and unbound keys on an empty list', () => {
    const { panel, onSelect, onCancel } = mount({ rows: [] })
    panel.handleInput(KEY.enter)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.down)
    panel.handleInput('x')
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    panel.invalidate()
  })

  it('calls onCancel on Escape', () => {
    const { panel, onSelect, onCancel } = mount()
    panel.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('SelectListPanel rendering', () => {
  it('frames the dialog with the title hint, badge, and muted description', () => {
    const { panel } = mount({
      rows: [
        { value: 'a', label: 'Alpha', description: 'first\nchoice', badge: '← current' },
        { value: 'b', label: 'Beta' },
      ],
      titleHint: '· esc cancel · ↵ switch',
    })
    const lines = panel.render(60)
    const bar = '^' + '─'.repeat(60) + '^'
    expect(lines[0]).toBe(bar)
    expect(lines[1]).toBe('^  Select^ _· esc cancel · ↵ switch_')
    expect(lines[2]).toBe('^❯ Alpha  ← current^~ — first choice~')
    expect(lines[3]).toBe('  Beta~~')
    expect(lines[4]).toBe('')
    expect(lines[5]).toBe(bar)
  })

  it('defaults the title and omits the hint row', () => {
    const { panel } = mount({ title: 'Sessions' })
    expect(panel.render(40)[1]).toBe('^  Sessions^')
  })

  it('drops the description when the row is too narrow', () => {
    const { panel } = mount({ rows: [{ value: 'a', label: 'Alpha', description: 'first' }] })
    expect(panel.render(10)[2]).toBe('^❯ Alpha^~~')
  })

  it('truncates long labels to the row width', () => {
    const { panel } = mount({ rows: [{ value: 'a', label: 'A very long label indeed' }] })
    expect(panel.render(14)[2]).toBe('^❯ A very \x1b[0m...\x1b[0m^~~')
  })

  it('windows a long list behind a scroll position row', () => {
    const { panel } = mount({ rows: rows(12) })
    const lines = panel.render(40)
    expect(lines.some(line => line.includes('(1/12)'))).toBe(true)
    expect(lines.some(line => line.includes('Item 8'))).toBe(false)
    for (let i = 0; i < 10; i += 1) panel.handleInput(KEY.down)
    const scrolled = panel.render(40)
    expect(scrolled.some(line => line.includes('(11/12)'))).toBe(true)
    expect(scrolled.some(line => line.includes('Item 0'))).toBe(false)
  })

  it('renders the visible window size the migration preserved', () => {
    expect(MAX_LIST_VISIBLE).toBe(8)
  })
})
