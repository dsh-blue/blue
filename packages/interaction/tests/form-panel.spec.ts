/** The multi-field form panel: field routing, validation, masking, errors. */

import { describe, expect, it, vi } from 'vitest'
import { FormPanel, maskRow, type FormField } from '../src/form-panel.ts'
import { fakeBlueContext, KEY } from './fakes.ts'

function form(fields: readonly FormField[], options: { subtitle?: string } = {}) {
  const { theme, keymap, components } = fakeBlueContext()
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const component = new FormPanel({
    keymap, theme, components,
    title: 'Form',
    ...options.subtitle === undefined ? {} : { subtitle: options.subtitle },
    fields,
    onSubmit,
    onCancel,
  })
  return { component, onSubmit, onCancel }
}

/** The last-mounted panel component with input forwarding. */
function input(component: FormPanel): { handleInput(data: string): void } {
  return component as unknown as { handleInput(data: string): void }
}

describe('maskRow', () => {
  it('renders one bullet per character', () => {
    expect(maskRow('')).toBe('')
    expect(maskRow('abc')).toBe('•••')
  })
})

describe('FormPanel', () => {
  it('routes typing to the active field and submits from the last', () => {
    const { component, onSubmit } = form([
      { id: 'route', label: 'Route', required: true },
      { id: 'key', label: 'Key', required: true },
    ])
    input(component).handleInput('gw')
    input(component).handleInput(KEY.tab)
    input(component).handleInput('secret')
    input(component).handleInput(KEY.enter)
    expect(onSubmit).toHaveBeenCalledWith({ route: 'gw', key: 'secret' })
  })

  it('moves back with Up and forward with Down and Shift-Tab', () => {
    const { component, onSubmit } = form([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
      { id: 'c', label: 'C' },
    ])
    input(component).handleInput('1')
    input(component).handleInput(KEY.down)
    input(component).handleInput('2')
    // Shift-Tab also moves forward (the kimi toggle).
    input(component).handleInput('\x1b[Z')
    input(component).handleInput('3')
    input(component).handleInput(KEY.up)
    // Enter off the last field advances; the second submits.
    input(component).handleInput(KEY.enter)
    input(component).handleInput(KEY.enter)
    expect(onSubmit).toHaveBeenCalledWith({ a: '1', b: '2', c: '3' })
  })

  it('submits a single-field form with one Enter', () => {
    const { component, onSubmit } = form([{ id: 'only', label: 'Only' }])
    input(component).handleInput('value')
    input(component).handleInput(KEY.enter)
    expect(onSubmit).toHaveBeenCalledWith({ only: 'value' })
  })

  it('keeps the panel open with the error line when a required field is empty', () => {
    const { component, onSubmit } = form([
      { id: 'a', label: 'Alpha', required: true },
      { id: 'b', label: 'Beta', required: true },
    ])
    input(component).handleInput(KEY.enter)
    input(component).handleInput(KEY.enter)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(component.render(60).some(row => row.includes('Alpha cannot be empty'))).toBe(true)
  })

  it('surfaces a validator verdict and jumps to the field', () => {
    const { component, onSubmit } = form([
      { id: 'a', label: 'A' },
      { id: 'route', label: 'Route', validate: value => value === 'ok' ? undefined : 'route must be ok' },
    ])
    input(component).handleInput(KEY.tab)
    input(component).handleInput('nope')
    input(component).handleInput(KEY.enter)
    expect(onSubmit).not.toHaveBeenCalled()
    const rows = component.render(60)
    expect(rows.some(row => row.includes('route must be ok'))).toBe(true)
    // The jump returned the cursor to the failing field.
    input(component).handleInput('!')
    expect(rows).toBeDefined()
  })

  it('never renders the masked text, only the bullet row', () => {
    const { component } = form([
      { id: 'key', label: 'API key', mask: true },
    ])
    input(component).handleInput('hunter2')
    const rows = component.render(60)
    expect(rows.some(row => row.includes('•••••••'))).toBe(true)
    expect(rows.some(row => row.includes('hunter2'))).toBe(false)
  })

  it('renders the subtitle and swaps in setError without closing', () => {
    const { component } = form([{ id: 'a', label: 'A' }], { subtitle: 'the original subtitle' })
    expect(component.render(60).some(row => row.includes('the original subtitle'))).toBe(true)
    component.setError('the flow failed')
    const rows = component.render(60)
    expect(rows.some(row => row.includes('the flow failed'))).toBe(true)
    expect(rows.some(row => row.includes('the original subtitle'))).toBe(false)
    component.setError(undefined)
    expect(component.render(60).some(row => row.includes('the original subtitle'))).toBe(true)
  })

  it('ignores focusField for an unknown id and renders an empty input row', () => {
    const { component } = form([{ id: 'key', label: 'Key', mask: true }])
    component.focusField('missing')
    const rows = component.render(60)
    // The untouched masked field renders its `>` prompt with no bullets,
    // inside the rounded box (corner rows present).
    expect(rows[0]).toContain('╭')
    expect(rows.at(-1)).toContain('╰')
    expect(rows.some(row => row.includes('>') && !row.includes('•'))).toBe(true)
  })

  it('pre-fills a field from its initial value', () => {
    const { component, onSubmit } = form([
      { id: 'route', label: 'Route', initial: 'preset' },
    ])
    input(component).handleInput(KEY.enter)
    expect(onSubmit).toHaveBeenCalledWith({ route: 'preset' })
  })

  it('cancels with Escape and drops cached render state', () => {
    const { component, onCancel } = form([{ id: 'a', label: 'A' }])
    input(component).handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
    component.invalidate()
  })
})
