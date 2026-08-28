/** Canonical multi-select and panel adapter behavior. */

import { describe, expect, it, vi } from 'vitest'
import { CanonicalMultiSelectController, CanonicalOverlayContainer, type BlueSelectItem } from '../src/select.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function items(count: number): BlueSelectItem[] {
  return Array.from({ length: count }, (_, index) => ({ value: `v${index}`, label: `Item ${String(index)}` }))
}

function mount(entries: readonly BlueSelectItem[] = items(3)) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const select = new CanonicalMultiSelectController({ keymap: new FakeKeymap(), theme: new FakeTheme(), components: new FakeBlueComponents(), items: entries, onConfirm, onCancel })
  return { select, onConfirm, onCancel }
}

describe('CanonicalMultiSelectController', () => {
  it('wraps, toggles, confirms, and falls back to the focused row', () => {
    const value = mount()
    value.select.handleInput(KEY.up)
    value.select.handleInput(KEY.space)
    value.select.handleInput(KEY.down)
    value.select.handleInput(KEY.space)
    expect(value.select.currentNode()).toMatchObject({ child: { mode: 'multiple', selectedIds: ['v2', 'v0'] } })
    value.select.handleInput(KEY.enter)
    expect(value.onConfirm).toHaveBeenCalledWith([expect.objectContaining({ value: 'v0' }), expect.objectContaining({ value: 'v2' })])

    const fallback = mount()
    fallback.select.handleInput(KEY.down)
    fallback.select.handleInput(KEY.enter)
    expect(fallback.onConfirm).toHaveBeenCalledWith([expect.objectContaining({ value: 'v1' })])
  })

  it('untoggles, ignores unrelated input, cancels, and tolerates empty data', () => {
    const value = mount()
    value.select.handleInput(KEY.space)
    value.select.handleInput(KEY.space)
    value.select.handleInput('x')
    value.select.handleInput(KEY.escape)
    expect(value.select.currentNode()).toMatchObject({ child: { selectedIds: [] } })
    expect(value.onCancel).toHaveBeenCalledOnce()

    const empty = mount([])
    empty.select.handleInput(KEY.space)
    empty.select.handleInput(KEY.up)
    empty.select.handleInput(KEY.down)
    empty.select.handleInput(KEY.enter)
    expect(empty.onConfirm).toHaveBeenCalledWith([])
  })

  it('emits a canonical bounded list, descriptions, counter, and key hints', () => {
    const entries = items(12).map((item, index) => index === 0 ? { ...item, description: 'first\nchoice' } : item)
    const value = mount(entries)
    const node = value.select.currentNode()
    expect(node).toMatchObject({ kind: 'surface', chrome: 'overlay', child: { kind: 'list', mode: 'multiple' } })
    if (node.kind !== 'surface' || node.child.kind !== 'list') throw new Error('expected canonical select')
    expect(node.child.items).toHaveLength(8)
    expect(node.child.items[0]).toMatchObject({ detail: 'first choice' })
    expect(node.footer).toMatchObject({ content: expect.stringContaining('(1/12)') })
    expect(value.select.render(14).every(row => new FakeBlueComponents().visibleWidth(row) <= 14)).toBe(true)
    value.select.invalidate()
  })

  it('falls back to action ids when the keymap has no labels', () => {
    const select = new CanonicalMultiSelectController({ keymap: new FakeKeymap(false), theme: new FakeTheme(), components: new FakeBlueComponents(), items: items(1), onConfirm: () => {}, onCancel: () => {} })
    expect(select.render(200).join('\n')).toContain('blue.interaction.submit confirm')
  })

  it('maps compiler selection events, filters non-string ids, and bridges focus', () => {
    const value = mount()
    value.select.focused = true
    expect(value.select.focused).toBe(true)
    ;(value.select as unknown as { adapter: { handleInput(data: string): void } }).adapter.handleInput(KEY.enter)
    expect(value.select.currentNode()).toMatchObject({ child: { selectedIds: ['v0'] } })
    ;(value.select as unknown as { onEvent(event: { kind: 'selection-change', controlId: string, value: unknown }): void })
      .onEvent({ kind: 'selection-change', controlId: 'blue-select', value: ['v1', 2] })
    expect(value.select.currentNode()).toMatchObject({ child: { selectedIds: ['v1'] } })
    ;(value.select as unknown as { onEvent(event: { kind: 'activate', controlId: string }): void })
      .onEvent({ kind: 'activate', controlId: 'other' })
  })
})

describe('CanonicalOverlayContainer', () => {
  it('compiles a canonical node and forwards focus, input, and passive Escape', () => {
    const onEvent = vi.fn()
    const onEscape = vi.fn()
    const panel = new CanonicalOverlayContainer({
      components: new FakeBlueComponents(), theme: new FakeTheme(),
      node: () => ({ kind: 'actions', id: 'actions', items: [{ id: 'run', label: 'Run', intent: 'primary' }] }),
      onEvent, onUnhandledEscape: onEscape,
    })
    panel.focused = true
    expect(panel.focused).toBe(true)
    panel.handleInput(KEY.enter)
    expect(onEvent).toHaveBeenCalledWith({ kind: 'activate', controlId: 'run' })
    panel.invalidate()
    expect(panel.render(40).join('\n')).toContain('Run')

    const passive = new CanonicalOverlayContainer({ components: new FakeBlueComponents(), theme: new FakeTheme(), node: () => ({ kind: 'text', content: 'passive' }), onEvent, onUnhandledEscape: onEscape })
    passive.handleInput(KEY.escape)
    expect(onEscape).toHaveBeenCalledOnce()
    passive.handleInput('x')

    const invalid = new CanonicalOverlayContainer({
      components: new FakeBlueComponents(), theme: new FakeTheme(),
      node: () => ({ kind: 'invalid' }) as never,
      onEvent,
    })
    invalid.focused = true
    invalid.handleInput('x')
    expect(invalid.render(Number.NaN)).toEqual(['!', '!', '!'])
    invalid.invalidate()
  })
})
