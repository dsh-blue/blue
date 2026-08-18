/**
 * Unit tests for the `BlueSelect` option list and the `BluePanel` overlay
 * container over the fake keymap and theme.
 */

import { describe, expect, it, vi } from 'vitest'
import type { BlueComponent, BlueFocusable } from '@deepseek-ai/dsh-blue-core'
import { BluePanel, BlueSelect } from '../src/select.ts'
import type { BlueSelectItem } from '../src/select.ts'
import { FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function items(count: number): BlueSelectItem[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `v${index}`,
    label: `Item ${index}`,
  }))
}

function mount(options: {
  items?: BlueSelectItem[]
  multiSelect?: boolean
  onConfirm?: (items: BlueSelectItem[]) => void
  onCancel?: () => void
} = {}): { select: BlueSelect; onConfirm: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const select = new BlueSelect({
    keymap: new FakeKeymap(),
    theme: new FakeTheme(),
    items: options.items ?? items(3),
    ...options.multiSelect === undefined ? {} : { multiSelect: options.multiSelect },
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

  it('confirms the focused entry in single-select mode', () => {
    const { select, onConfirm } = mount()
    select.handleInput(KEY.down)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ value: 'v1' })])
  })

  it('toggles entries in multi-select mode and confirms the toggled set', () => {
    const { select, onConfirm } = mount({ multiSelect: true })
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
    const { select, onConfirm } = mount({ multiSelect: true })
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
    const { select, onConfirm } = mount({ items: [], multiSelect: true })
    select.handleInput(KEY.space)
    select.handleInput(KEY.up)
    select.handleInput(KEY.enter)
    expect(onConfirm).toHaveBeenCalledWith([])
  })

  it('falls back to action ids in the footer when no keys are bound', () => {
    const select = new BlueSelect({
      keymap: new FakeKeymap(false),
      theme: new FakeTheme(),
      items: items(1),
      onConfirm: () => {},
      onCancel: () => {},
    })
    expect(select.render(200).at(-1)).toContain('blue.interaction.submit confirm')
  })

  it('invalidate() is a no-op', () => {
    const { select } = mount()
    select.invalidate()
    expect(select.render(40).length).toBeGreaterThan(0)
  })
})

describe('BlueSelect rendering', () => {
  it('accents the cursor row and mutes descriptions', () => {
    const { select } = mount({
      items: [{ value: 'a', label: 'Alpha', description: 'first\nchoice' }, { value: 'b', label: 'Beta' }],
    })
    const lines = select.render(60)
    expect(lines[0]).toBe('*→ Alpha*~ — first choice~')
    expect(lines[1]).toBe('  Beta~~')
    expect(lines[2]).toContain('enter confirm')
  })

  it('drops the description when the row is too narrow', () => {
    const { select } = mount({ items: [{ value: 'a', label: 'Alpha', description: 'first' }] })
    const lines = select.render(6)
    expect(lines[0]).toBe('*→ Alp…*~~')
  })

  it('truncates long labels to the row width', () => {
    const { select } = mount({ items: [{ value: 'a', label: 'A very long label indeed' }] })
    const lines = select.render(10)
    expect(lines[0]).toBe('*→ A very …*~~')
  })

  it('shows scroll info beyond the visible window and a toggle hint in multi-select', () => {
    const { select } = mount({ items: items(12), multiSelect: true })
    const lines = select.render(40)
    expect(lines.some(line => line.includes('(1/12)'))).toBe(true)
    expect(lines.at(-1)).toContain('space toggle')
    // Scroll the window forward.
    for (let i = 0; i < 10; i += 1) select.handleInput(KEY.down)
    const scrolled = select.render(40)
    expect(scrolled.some(line => line.includes('(11/12)'))).toBe(true)
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

  it('forwards focus, input, and invalidation to the child', () => {
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

  it('tolerates a child without input handling', () => {
    const bare: BlueFocusable & BlueComponent = {
      focused: false,
      render: () => [],
      invalidate: () => {},
    }
    const panel = new BluePanel([], bare)
    panel.handleInput('x')
    expect(panel.render(40)).toEqual([])
  })
})
