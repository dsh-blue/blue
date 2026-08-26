/** Renderer-neutral status registry and footer layout coverage. */

import { Context } from '@deepseek-ai/cordis'
import type { StatusModel, View } from '@dsh-blue/blue-frontend'
import { describe, expect, it, vi } from 'vitest'
import { BlueStatusModelService, plainView, StatusModelFooterComponent } from '../src/status-model.ts'
import { COLORS, StatusFakeScreen } from './status-fakes.ts'
import { fakeBlueComponents } from './helpers.ts'

function model(id: string, view: View, options: Partial<StatusModel> = {}): StatusModel {
  return { kind: 'status', id, view, visible: true, ...options }
}

describe('BlueStatusModelService', () => {
  it('registers dynamic models, refreshes, rejects duplicates, and disposes idempotently', () => {
    const screen = new StatusFakeScreen()
    const service = new BlueStatusModelService(new Context(), screen)
    let current: StatusModel | null = model('dynamic', { kind: 'text', text: 'first' })
    const dispose = service.register(() => current)
    expect(service.list()[0]?.view).toEqual({ kind: 'text', text: 'first' })
    expect(() => service.register(model('dynamic', { kind: 'text', text: 'duplicate' }))).toThrow(/already registered/)
    current = model('dynamic', { kind: 'text', text: 'second' })
    service.refresh('dynamic')
    service.refresh('missing')
    expect(screen.renderRequests.length).toBe(2)
    dispose()
    dispose()
    expect(service.list()).toEqual([])
    const absent = service.register(() => null)
    absent()
    service.dispose()
    expect(service.list()).toEqual([])
  })

  it('can attach a renderer after producers register', () => {
    const service = new BlueStatusModelService(new Context())
    service.register(model('late', { kind: 'text', text: 'late' }))
    const screen = new StatusFakeScreen()
    service.attach(screen)
    expect(screen.renderRequests).toHaveLength(1)
  })
})

describe('StatusModelFooterComponent', () => {
  it('lays out two bands, priorities, right alignment, tones, and overflow', () => {
    const components = fakeBlueComponents()
    const service = new BlueStatusModelService(new Context())
    service.register(model('left', { kind: 'text', text: 'left', tone: 'accent' }, { priority: 0 }))
    service.register(model('hidden', { kind: 'text', text: 'hidden' }, { visible: false }))
    service.register(model('right', { kind: 'text', text: 'right', tone: 'success' }, { band: 'right', row: 1, priority: 1 }))
    service.register(model('second', { kind: 'text', text: 'second', tone: 'warning' }, { row: 2 }))
    service.register(model('too-wide', { kind: 'text', text: '0123456789' }, { row: 2, overflow: 'hide', priority: 2 }))
    const footer = new StatusModelFooterComponent(service, components, COLORS)
    expect(footer.render(14)).toEqual(['left     right', 'second        '])
    expect(footer.render(14)).toBe(footer.render(14))
    footer.invalidate()
    expect(footer.render(4)).toEqual(['left', 's\x1b[0m...\x1b[0m'])
  })

  it('flattens every renderer-neutral view kind', () => {
    expect(plainView({ kind: 'rich-text', spans: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(plainView({ kind: 'fields', fields: [{ label: 'state', value: 'ok' }] })).toBe('state: ok')
    expect(plainView({ kind: 'sections', sections: [{ title: 'one', body: { kind: 'text', text: 'body' } }] })).toBe('one: body')
    expect(plainView({ kind: 'list', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }] })).toBe('A')
    expect(plainView({ kind: 'code', code: 'const x = 1' })).toBe('const x = 1')
    expect(plainView({ kind: 'diff', before: 'old', after: 'new' })).toBe('new')
  })

  it('handles zero width, danger tone, and non-text footer views', () => {
    const error = vi.fn((text: string) => `!${text}!`)
    const service = new BlueStatusModelService(new Context())
    service.register(model('danger', { kind: 'text', text: 'boom', tone: 'danger' }))
    service.register(model('fields', { kind: 'fields', fields: [{ label: 'state', value: 'ok' }] }, { row: 2 }))
    const footer = new StatusModelFooterComponent(service, fakeBlueComponents(), { ...COLORS, error })
    expect(footer.render(0)).toEqual([])
    expect(footer.render(20)).toEqual(['!boom!              ', 'state: ok           '])
    expect(error).toHaveBeenCalledWith('boom')
  })
})
