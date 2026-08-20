/**
 * Unit tests for the multi-select `BlueSelect` option list and the
 * `BluePanel` overlay container over the fake keymap, theme, and components.
 */

import { describe, expect, it, vi } from 'vitest'
import type { BlueComponent, BlueFocusable } from '@dsh-blue/blue-core'
import { BluePanel, BlueSelect, SessionList } from '../src/select.ts'
import type { BlueSelectItem, SessionListItem } from '../src/select.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function items(count: number): BlueSelectItem[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Item ${index}`,
  }))
}

function mount(options: {
  items?: BlueSelectItem[]
  onConfirm?: (items: BlueSelectItem[]) => void
  onCancel?: () => void
} = {}): { select: BlueSelect; onConfirm: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const select = new BlueSelect({
    keymap: new FakeKeymap(),
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    items: options.items ?? items(3),
    onConfirm: options.onConfirm ?? onConfirm,
    onCancel: options.onCancel ?? onCancel,
  })
  return { select, onConfirm, onCancel }
}

describe('BlueSelect navigation', () => {
  it('wraps the cursor at both ends', () => {
    const { select, onConfirm } = mount()
    select.handleInput(KEY.up)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ value: 'v2' })])
    select.handleInput(KEY.down)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenLastCalledWith([expect.objectContaining({ value: 'v0' })])
    // Non-wrap moves in both directions.
    select.handleInput(KEY.down)
    select.handleInput(KEY.up)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenLastCalledWith([expect.objectContaining({ value: 'v0' })])
  })

  it('toggles entries and confirms the toggled set', () => {
    const { select, onConfirm } = mount()
    select.handleInput(KEY.space)
    select.handleInput(KEY.down)
    select.handleInput(KEY.down)
    select.handleInput(KEY.space)
    // Toggling the same entry twice clears it.
    select.handleInput(KEY.space)
    select.handleInput(KEY.space)
    // Toggled rows render with a checked mark.
    expect(select.render(40).some(line => line.includes('[x] Item 0'))).toBe(true)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ value: 'v0' }),
      expect.objectContaining({ value: 'v2' }),
    ])
  })

  it('confirms the focused entry when nothing was toggled', () => {
    const { select, onConfirm } = mount()
    select.handleInput(KEY.down)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ value: 'v1' })])
  })

  it('calls onCancel on Escape', () => {
    const { select, onCancel, onConfirm } = mount()
    select.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ignores keys bound to no list action', () => {
    const { select, onConfirm, onCancel } = mount()
    select.handleInput('x')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('tolerates an empty item list', () => {
    const { select, onConfirm } = mount({ items: [] })
    select.handleInput(KEY.space)
    select.handleInput(KEY.up)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('falls back to action ids in the footer when no keys are bound', () => {
    const select = new BlueSelect({
      keymap: new FakeKeymap(false),
      theme: new FakeTheme(),
      components: new FakeBlueComponents(),
      items: items(1),
      onConfirm: () => {},
      onCancel: () => {},
    })
    // The key row sits above the closing rule.
    expect(select.render(200).at(-2)).toContain('blue.interaction.submit confirm')
  })

  it('invalidate() is a no-op', () => {
    const { select } = mount()
    select.invalidate()
    expect(select.render(40).length).toBeGreaterThan(0)
  })
})

describe('BlueSelect rendering', () => {
  it('frames the dialog and paints the cursor row full-width with selectedBg', () => {
    const { select } = mount({
      items: [{ value: 'a', label: 'Alpha', description: 'first\nchoice' }, { value: 'b', label: 'Beta' }],
    })
    const lines = select.render(60)
    const bar = '^' + '─'.repeat(60) + '^'
    expect(lines[0]).toBe(bar)
    expect(lines[1]).toBe('^  Select^')
    // The selectedBg row pads to the full width so the background never
    // breaks mid-line; the description rides muted inside the row.
    expect(lines[2]).toBe('{' + '❯ [ ] Alpha~ — first choice~'.padEnd(60) + '}')
    expect(lines[3]).toBe('  [ ] Beta~~')
    expect(lines[4]).toBe('')
    expect(lines[5]).toBe('_  up/down move · space toggle · enter confirm · escape c\u001b[0m...\u001b[0m')
    expect(lines[6]).toBe(bar)
  })

  it('drops the description when the row is too narrow', () => {
    const { select } = mount({ items: [{ value: 'a', label: 'Alpha', description: 'first' }] })
    const lines = select.render(10)
    expect(lines[2]).toBe('{❯ [ ] A...}')
  })

  it('truncates long labels to the row width', () => {
    const { select } = mount({ items: [{ value: 'a', label: 'A very long label indeed' }] })
    const lines = select.render(14)
    expect(lines[2]).toBe('{❯ [ ] A ver...}')
  })

  it('shows scroll info beyond the visible window and a toggle hint in the footer', () => {
    const { select } = mount({ items: items(12) })
    const lines = select.render(40)
    expect(lines.some(line => line.includes('(1/12)'))).toBe(true)
    expect(lines.at(-2)).toContain('space toggle')
    // Scroll the window forward.
    for (let i = 0; i < 10; i += 1) select.handleInput(KEY.down)
    const scrolled = select.render(40)
    expect(scrolled.some(line => line.includes('(11/12)'))).toBe(true)
  })
})

describe('SessionList', () => {
  function sessions(): SessionListItem[] {
    return [
      { value: 's1', label: 's1 · 2026-08-19 09:00 · /work', current: true },
      { value: 's2', label: 's2 · 2026-08-18 09:00 · /other' },
    ]
  }

  function mountList(options: {
    items?: readonly SessionListItem[]
    title?: string
    titleHint?: string
    onSelect?: (item: SessionListItem) => void
    onCancel?: () => void
  } = {}): { list: SessionList; onSelect: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const list = new SessionList({
      keymap: new FakeKeymap(),
      theme: new FakeTheme(),
      components: new FakeBlueComponents(),
      items: options.items ?? sessions(),
      title: options.title,
      titleHint: options.titleHint,
      onSelect: options.onSelect ?? onSelect,
      onCancel: options.onCancel ?? onCancel,
    })
    return { list, onSelect, onCancel }
  }

  it('frames the dialog with the title hint and the current-session badge', () => {
    const { list } = mountList({ title: 'Sessions', titleHint: '· esc cancel · ↵ resume' })
    const lines = list.render(60)
    const bar = '^' + '─'.repeat(60) + '^'
    expect(lines[0]).toBe(bar)
    expect(lines[1]).toBe('^  Sessions^ _· esc cancel · ↵ resume_')
    expect(lines[2]).toBe('^❯ s1 · 2026-08-19 09:00 · /work  ← current^')
    expect(lines[3]).toBe('  s2 · 2026-08-18 09:00 · /other')
    expect(lines[4]).toBe('')
    expect(lines[5]).toBe(bar)
  })

  it('navigates with the keymap and selects or cancels', () => {
    const { list, onSelect, onCancel } = mountList()
    list.handleInput(KEY.down)
    list.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 's2' }))
    // Up from the top wraps to the last row; down from the last wraps back.
    list.handleInput(KEY.up)
    list.handleInput(KEY.up)
    list.handleInput(KEY.down)
    list.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ value: 's1' }))
    list.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('ignores submit and unbound keys on an empty list', () => {
    const { list, onSelect } = mountList({ items: [] })
    list.handleInput(KEY.enter)
    expect(onSelect).not.toHaveBeenCalled()
    // A key bound to no list action falls through every branch.
    list.handleInput('x')
    list.invalidate()
  })

  it('defaults the title and omits the hint row', () => {
    const { list } = mountList()
    const lines = list.render(40)
    expect(lines[1]).toBe('^  Sessions^')
  })

  it('shows scroll info beyond the visible window', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      value: `s${index}`,
      label: `s${index}`,
    }))
    const { list } = mountList({ items: many })
    const lines = list.render(40)
    expect(lines.some(line => line.includes('(1/10)'))).toBe(true)
  })
})

describe('BluePanel', () => {
  function child(): {
    inner: BlueFocusable & BlueComponent
    handleInput: ReturnType<typeof vi.fn>
    invalidate: ReturnType<typeof vi.fn>
  } {
    const handleInput = vi.fn()
    const invalidate = vi.fn()
    const inner: BlueFocusable & BlueComponent = {
      focused: false,
      render: () => ['child row'],
      invalidate,
      handleInput,
    }
    return { inner, handleInput, invalidate }
  }

  it('renders header rows above the child', () => {
    const panel = new BluePanel(['*header*'], child().inner)
    expect(panel.render(40)).toEqual(['*header*', 'child row'])
  })

  it('forwards focus, input, and invalidation to a focusable child', () => {
    const { inner, handleInput, invalidate } = child()
    const panel = new BluePanel([], inner)
    panel.focused = true
    expect(inner.focused).toBe(true)
    expect(panel.focused).toBe(true)
    panel.handleInput('x')
    expect(handleInput).toHaveBeenCalledWith('x')
    panel.invalidate()
    expect(invalidate).toHaveBeenCalled()
  })

  it('tolerates a child without focus state or input handling', () => {
    const bare: BlueComponent = {
      render: () => [],
      invalidate: () => {},
    }
    const panel = new BluePanel([], bare)
    panel.focused = true
    expect(panel.focused).toBe(true)
    panel.handleInput('x')
    expect(panel.render(40)).toEqual([])
  })
})
