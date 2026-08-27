import { describe, expect, it, vi } from 'vitest'
import type { PanelModel } from '@dsh-blue/blue-frontend'
import { FrontendPanel } from '../src/frontend-panel.ts'
import { fakeBlueContext } from './fakes.ts'

function panelFixture(initial?: PanelModel) {
  const { keymap, theme, components } = fakeBlueContext()
  let model: PanelModel = initial ?? {
    kind: 'panel',
    mode: 'info',
    title: 'Fixture',
    view: { kind: 'sections', sections: Array.from({ length: 8 }, (_, index) => ({ title: `section ${String(index)}`, body: { kind: 'text', text: `row ${String(index)}` } })) },
    submit: { kind: 'fixture.refresh' },
  }
  const onAction = vi.fn()
  const onClose = vi.fn()
  const panel = new FrontendPanel({ keymap, theme, components, model: () => model, onAction, onClose, maxVisible: 5 })
  return { panel, onAction, onClose, setModel(next: PanelModel) { model = next } }
}

describe('FrontendPanel', () => {
  it('renders, scrolls, and dispatches the structured submit action', () => {
    const fixture = panelFixture()
    expect(fixture.panel.render(40).some(row => row.includes('showing 1-5'))).toBe(true)
    fixture.panel.handleInput('\x1b[B')
    expect(fixture.panel.render(40).some(row => row.includes('showing 2-6'))).toBe(true)
    fixture.panel.handleInput('\x1b[6~')
    expect(fixture.panel.render(40).some(row => row.includes('showing 12-16'))).toBe(true)
    fixture.panel.handleInput('\x1b[5~')
    fixture.panel.handleInput('\x1b[A')
    fixture.panel.handleInput('\r')
    expect(fixture.onAction).toHaveBeenCalledWith({ kind: 'fixture.refresh' })
    expect(() => fixture.panel.invalidate()).not.toThrow()
  })

  it('closes on submit without an action and on every close key', () => {
    const fixture = panelFixture({ kind: 'panel', mode: 'loading', title: 'Loading' })
    expect(fixture.panel.render(30).some(row => row.includes('loading'))).toBe(true)
    fixture.panel.handleInput('\r')
    fixture.panel.handleInput('\x1b')
    fixture.panel.handleInput('q')
    fixture.panel.handleInput('Q')
    fixture.panel.handleInput('x')
    expect(fixture.onClose).toHaveBeenCalledTimes(3)
    expect(fixture.panel.render(30).some(row => row.includes('loading...'))).toBe(true)
  })

  it('uses the error frame and resets scrolling for a short replacement model', () => {
    const fixture = panelFixture()
    fixture.panel.handleInput('\x1b[6~')
    fixture.panel.render(40)
    fixture.setModel({ kind: 'panel', mode: 'error', title: 'Failure', view: { kind: 'text', text: 'down' } })
    const rows = fixture.panel.render(30.8)
    expect(rows.some(row => row.includes('Failure'))).toBe(true)
    expect(rows.some(row => row.includes('down'))).toBe(true)
  })

  it('selects enabled list actions and dispatches cancel', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Choose', cancel: { kind: 'fixture.cancel' },
      view: { kind: 'list', selectedId: 'a', items: [
        { id: 'a', label: 'A', action: { kind: 'fixture.a' } },
        { id: 'b', label: 'B', disabled: true, action: { kind: 'fixture.b' } },
        { id: 'c', label: 'C', action: { kind: 'fixture.c' } },
      ] },
    })
    expect(fixture.panel.render(40).some(row => row.includes('> ^A^'))).toBe(true)
    fixture.panel.handleInput('\x1b[B'); expect(fixture.panel.render(40).some(row => row.includes('> ^C^'))).toBe(true); fixture.panel.handleInput('\r')
    fixture.panel.handleInput('\x1b[A'); fixture.panel.handleInput('\r'); fixture.panel.handleInput('\x1b')
    expect(fixture.onAction.mock.calls.map(call => call[0])).toEqual([{ kind: 'fixture.c' }, { kind: 'fixture.a' }, { kind: 'fixture.cancel' }])
    expect(fixture.onClose).toHaveBeenCalledOnce()
  })

  it('renders form and empty error modes with submit behavior', () => {
    const form = panelFixture({ kind: 'panel', mode: 'form', title: 'Form', view: { kind: 'fields', fields: [{ label: 'name', value: 'blue' }] }, submit: { kind: 'fixture.save' } })
    expect(form.panel.render(30).some(row => row.includes('name: blue'))).toBe(true); form.panel.handleInput('\r'); expect(form.onAction).toHaveBeenCalledWith({ kind: 'fixture.save' })
    const error = panelFixture({ kind: 'panel', mode: 'error', title: 'Failure' }); expect(error.panel.render(30).some(row => row.includes('unavailable'))).toBe(true)
  })

  it('closes an actionless info panel and renders an empty body', () => {
    const fixture = panelFixture({ kind: 'panel', mode: 'info', title: 'Empty' })
    expect(fixture.panel.render(30).some(row => row.includes('unavailable'))).toBe(false)
    fixture.panel.handleInput('\r')
    expect(fixture.onClose).toHaveBeenCalledOnce()
  })

  it('selects the first enabled item when no valid preference exists', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Choose',
      view: { kind: 'list', selectedId: 'missing', items: [
        { id: 'disabled', label: 'Disabled', disabled: true },
        { id: 'first', label: 'First', action: { kind: 'fixture.first' } },
      ] },
    })
    expect(fixture.panel.render(40).some(row => row.includes('> ^First^'))).toBe(true)
    fixture.panel.handleInput('\r')
    expect(fixture.onAction).toHaveBeenCalledWith({ kind: 'fixture.first' })
  })

  it('filters grouped lists, cycles variants, and dispatches secondary actions', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Models',
      view: { kind: 'list', filterable: true, grouped: true, items: [
        { id: 'a', label: 'alpha', group: 'one', variants: [
          { id: 'low', label: 'Low', action: { kind: 'pick', id: 'low' }, secondaryAction: { kind: 'session', id: 'low' } },
          { id: 'high', label: 'High', action: { kind: 'pick', id: 'high' }, secondaryAction: { kind: 'session', id: 'high' } },
        ], selectedVariantId: 'low' },
        { id: 'b', label: 'beta', group: 'two', action: { kind: 'pick', id: 'b' } },
      ] },
    })
    expect(fixture.panel.render(50).join('\n')).toContain('[All]')
    expect(fixture.panel.render(50).join('\n')).toContain('[Low]')
    expect(fixture.panel.render(50).join('\n')).toContain('[High]')
    fixture.panel.handleInput('\t')
    expect(fixture.panel.render(50).join('\n')).toContain('[one]')
    fixture.panel.handleInput('\x1b[C')
    expect(fixture.panel.render(50).join('\n')).toContain('[High]')
    fixture.panel.handleInput('\x1bs')
    fixture.panel.handleInput('\r')
    expect(fixture.onAction.mock.calls.map(call => call[0])).toEqual([
      { kind: 'session', id: 'high' },
      { kind: 'pick', id: 'high' },
    ])
    fixture.panel.handleInput('a')
    expect(fixture.panel.render(50).join('\n')).toContain('search: a')
    fixture.panel.handleInput('\x7f')
    fixture.panel.handleInput('\x1b')
    expect(fixture.onClose).toHaveBeenCalledOnce()
  })

  it('switches explicit groups with Tab and arrow keys and renders custom affordances', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Plugins',
      view: { kind: 'list', grouped: true, includeAllGroup: false, groups: ['Installed', 'Available'], items: [
        { id: 'installed', label: 'Installed plugin', group: 'Installed', action: { kind: 'remove' } },
        { id: 'available', label: 'Available plugin', group: 'Available', action: { kind: 'add' } },
      ] },
    })
    const panel = new FrontendPanel({
      keymap: fakeBlueContext().keymap,
      theme: fakeBlueContext().theme,
      components: fakeBlueContext().components,
      model: () => ({ kind: 'panel', mode: 'select', title: 'Plugins', view: { kind: 'list', grouped: true, includeAllGroup: false, groups: ['Installed', 'Available'], items: [
        { id: 'installed', label: 'Installed plugin', group: 'Installed', action: { kind: 'remove' } },
        { id: 'available', label: 'Available plugin', group: 'Available', action: { kind: 'add' } },
      ] } }),
      onAction: fixture.onAction,
      onClose: fixture.onClose,
      hint: 'Tab switch · Alt+S uninstall',
    })
    expect(panel.render(120).join('\n')).toContain('[Installed]')
    expect(panel.render(120).join('\n')).toContain('^Installed plugin^')
    expect(panel.render(120).join('\n')).toContain('Tab switch')
    panel.handleInput('\x1b[C')
    expect(panel.render(120).join('\n')).toContain('[Available]')
    panel.handleInput('\x1b[D')
    expect(panel.render(120).join('\n')).toContain('[Installed]')
    panel.handleInput('\x1b[Z')
    expect(panel.render(120).join('\n')).toContain('[Available]')
  })

  it('supports model-level input actions, top/end scrolling, and locked loading panels', () => {
    const loading = panelFixture({ kind: 'panel', mode: 'loading', title: 'Busy', dismissible: false })
    loading.panel.handleInput('\x1b')
    expect(loading.onClose).not.toHaveBeenCalled()

    const fixture = panelFixture()
    const action = vi.fn(() => ({ kind: 'fixture.shortcut' }))
    const panel = new FrontendPanel({
      ...fakeBlueContext(),
      model: () => ({ kind: 'panel', mode: 'select', title: 'Keys', view: { kind: 'list', items: [{ id: 'a', label: 'A' }] } }),
      onAction: fixture.onAction,
      onClose: fixture.onClose,
      onUnhandledInput: (data, selectedId) => data === 'c' && selectedId === 'a' ? action() : undefined,
      maxVisible: 5,
    })
    panel.handleInput('c')
    panel.handleInput('G')
    panel.render(40)
    panel.handleInput('g')
    expect(fixture.onAction).toHaveBeenCalledWith({ kind: 'fixture.shortcut' })
  })

  it('clears filtering before close and safely resets stale list controls', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Grouped',
      view: { kind: 'list', filterable: true, grouped: true, items: [
        { id: 'a', label: 'alpha', group: 'one', action: { kind: 'fixture.a' }, secondaryAction: { kind: 'fixture.a.session' } },
        { id: 'b', label: 'beta', group: 'two', action: { kind: 'fixture.b' } },
      ] },
    })
    fixture.panel.handleInput('a')
    expect(fixture.panel.render(40).join('\n')).toContain('search: a')
    fixture.panel.handleInput('\x1b')
    expect(fixture.onClose).not.toHaveBeenCalled()
    expect(fixture.panel.render(40).join('\n')).not.toContain('search:')

    fixture.panel.handleInput('\x1bs')
    fixture.panel.handleInput('\x1b[C')
    fixture.panel.handleInput('\t')
    fixture.panel.handleInput('\t')
    fixture.panel.handleInput('\x1bs')
    expect(fixture.onAction).toHaveBeenCalledWith({ kind: 'fixture.a.session' })

    fixture.setModel({
      kind: 'panel', mode: 'select', title: 'Regrouped',
      view: { kind: 'list', grouped: true, items: [{ id: 'a', label: 'alpha', group: 'one' }] },
    })
    expect(fixture.panel.render(40).join('\n')).toContain('alpha')
  })

  it('handles empty groups, missing variants, and secondary-action misses', () => {
    const fixture = panelFixture({
      kind: 'panel', mode: 'select', title: 'Edges',
      view: { kind: 'list', grouped: true, includeAllGroup: false, groups: [], items: [
        { id: 'plain', label: 'plain', action: { kind: 'plain' } },
      ] },
    })
    expect(fixture.panel.render(40).join('\n')).toContain('plain')
    fixture.panel.handleInput('\x1b[C')
    fixture.panel.handleInput('\x1bs')
    expect(fixture.onAction).not.toHaveBeenCalled()

    fixture.setModel({
      kind: 'panel', mode: 'select', title: 'Single group',
      view: { kind: 'list', grouped: true, groups: ['one', 'two'], items: [
        { id: 'only', label: 'only', group: 'one' },
        { id: 'other', label: 'other', group: 'two' },
      ] },
    })
    fixture.panel.handleInput('\x1b[D')
    fixture.panel.handleInput('\x1b[C')
    fixture.panel.handleInput('\x1b')
    expect(fixture.onClose).toHaveBeenCalledOnce()

    fixture.setModel({ kind: 'panel', mode: 'info', title: 'No list' })
    fixture.panel.handleInput('\x1b[C')
  })
})
