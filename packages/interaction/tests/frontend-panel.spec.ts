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
    expect(rows.some(row => row.includes('failure'))).toBe(true)
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
    expect(fixture.panel.render(40).some(row => row.includes('> A'))).toBe(true)
    fixture.panel.handleInput('\x1b[B'); expect(fixture.panel.render(40).some(row => row.includes('> C'))).toBe(true); fixture.panel.handleInput('\r')
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
    expect(fixture.panel.render(40).some(row => row.includes('> First'))).toBe(true)
    fixture.panel.handleInput('\r')
    expect(fixture.onAction).toHaveBeenCalledWith({ kind: 'fixture.first' })
  })
})
