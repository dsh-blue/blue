import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StatusModel } from '@dsh-blue/blue-frontend'
import { BlueStatusModelService, plainView } from '../src/status-model.ts'
import * as basicModel from '../src/status-basic-model.ts'
import { asAgent, COLORS, fakeAgent, FakeStatusRegistry, StatusFakeScreen } from './status-fakes.ts'

const screen = () => new StatusFakeScreen()
const model = (id: string, view: StatusModel['view'], extra: Partial<StatusModel> = {}): StatusModel => ({ kind: 'status', id, view, visible: true, ...extra })

describe('BlueStatusModelService', () => {
  it('converts every renderer-neutral view to plain text', () => {
    expect(plainView({ kind: 'text', text: 'text' })).toBe('text')
    expect(plainView({ kind: 'rich-text', spans: [{ text: 'a' }, { text: 'b' }] })).toBe('ab')
    expect(plainView({ kind: 'fields', fields: [{ label: 'a', value: '1' }] })).toBe('a: 1')
    expect(plainView({ kind: 'sections', sections: [{ title: 's', body: { kind: 'text', text: 'b' } }] })).toBe('s: b')
    expect(plainView({ kind: 'list', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }] })).toBe('A')
    expect(plainView({ kind: 'code', code: 'const x = 1' })).toBe('const x = 1')
    expect(plainView({ kind: 'diff', before: 'old', after: 'new' })).toBe('new')
  })

  it('registers, renders, refreshes, lists, and unloads model contributions', () => {
    const ctx = new Context(); const target = new FakeStatusRegistry(); const service = new BlueStatusModelService(ctx); const current = { value: model('dynamic', { kind: 'text', text: 'first', tone: 'muted' }) }; service.attach(target, screen(), COLORS)
    const dispose = service.register(() => current.value); service.register(model('listed', { kind: 'text', text: 'listed' })); expect(target.entries.find(entry => entry.id === 'dynamic')!.render(20)).toBe('first'); current.value = model('dynamic', { kind: 'text', text: 'second', tone: 'accent' }); service.refresh('dynamic'); expect(target.entries.find(entry => entry.id === 'dynamic')!.render(20)).toBe('second'); expect(service.list()).toHaveLength(2); dispose(); dispose(); expect(target.entries).toHaveLength(1)
    const absent = service.register(() => null); absent(); const hidden = service.register(model('hidden', { kind: 'text', text: 'hidden' }, { visible: false })); expect(target.entries).toHaveLength(1); service.refresh('hidden'); service.refresh('missing'); hidden(); let show = true; const toggled = service.register(() => show ? model('toggled', { kind: 'rich-text', spans: [{ text: 'rich' }] }) : null); expect(target.entries.some(entry => entry.id === 'toggled')).toBe(true); show = false; service.refresh('toggled'); toggled(); service.register(model('right', { kind: 'text', text: 'right', tone: 'success' }, { band: 'right', priority: 2 })); expect(target.entries.find(entry => entry.id === 'right')!.align).toBe('right'); service.register(model('error', { kind: 'text', text: 'error', tone: 'danger' })); service.register(model('warning', { kind: 'text', text: 'warning', tone: 'warning' })); service.register(model('default', { kind: 'text', text: 'default' })); service.dispose(); expect(target.entries).toHaveLength(0)
  })

  it('rejects duplicate ids and can attach after registration', () => {
    const ctx = new Context(); const target = new FakeStatusRegistry(); const service = new BlueStatusModelService(ctx); const registration = service.register(model('late', { kind: 'text', text: 'late' })); expect(target.entries).toHaveLength(0); service.attach(target, screen(), COLORS); expect(target.entries).toHaveLength(1); expect(() => service.register(model('late', { kind: 'text', text: 'again' }))).toThrow(/already registered/); registration(); expect(service.list()).toEqual([])
  })
})

describe('blue-status-basic-model', () => {
  it('publishes a model and refreshes on session/model events', async () => {
    const ctx = new Context(); const target = new FakeStatusRegistry(); const service = new BlueStatusModelService(ctx); service.attach(target, screen(), COLORS); const first = fakeAgent([], { model: 'first' }); ctx.reflect.provide('blueSession', { current: asAgent(first) }); const fiber = await ctx.plugin(basicModel); expect(target.entries[0]!.render(80)).toBe('first'); const second = fakeAgent([], { provider: 'second-provider' }); ctx.emit('blue/session-changed', asAgent(second)); expect(target.entries[0]!.render(80)).toBe('second-provider'); ctx.emit('blue/model-changed'); ctx.emit('session/event', second.session); await fiber.dispose(); expect(target.entries).toHaveLength(0)
  })

  it('handles absent sessions, header fallback, and foreign events', async () => {
    const ctx = new Context(); const target = new FakeStatusRegistry(); const service = new BlueStatusModelService(ctx); service.attach(target, screen(), COLORS); ctx.reflect.provide('blueSession', { current: null }); const fiber = await ctx.plugin(basicModel); expect(target.entries).toHaveLength(0); const agent = fakeAgent([], { headerModel: 'header' }); ctx.emit('blue/session-changed', asAgent(agent)); expect(target.entries[0]!.render(80)).toBe('header'); const foreign = fakeAgent([], { model: 'foreign' }); ctx.emit('session/event', foreign.session); expect(target.entries[0]!.render(80)).toBe('header'); await fiber.dispose()
  })

  it('uses the live model selection and lower-priority fallbacks', async () => {
    const ctx = new Context(); const target = new FakeStatusRegistry(); const service = new BlueStatusModelService(ctx); service.attach(target, screen(), COLORS); const agent = fakeAgent([], { model: 'option-model', provider: 'provider' }); ctx.reflect.provide('blueSession', { current: asAgent(agent), modelRef: { current: { model: 'selected' } } }); const fiber = await ctx.plugin(basicModel); expect(target.entries[0]!.render(80)).toBe('selected'); await fiber.dispose()
    const fallbackCtx = new Context(); const fallbackTarget = new FakeStatusRegistry(); const fallbackService = new BlueStatusModelService(fallbackCtx); fallbackService.attach(fallbackTarget, screen(), COLORS); const providerAgent = fakeAgent([], { provider: 'provider' }); fallbackCtx.reflect.provide('blueSession', { current: asAgent(providerAgent) }); const fallbackFiber = await fallbackCtx.plugin(basicModel); expect(fallbackTarget.entries[0]!.render(80)).toBe('provider'); await fallbackFiber.dispose()
    const emptyCtx = new Context(); const emptyTarget = new FakeStatusRegistry(); const emptyService = new BlueStatusModelService(emptyCtx); emptyService.attach(emptyTarget, screen(), COLORS); const emptyAgent = fakeAgent([]); emptyCtx.reflect.provide('blueSession', { current: asAgent(emptyAgent) }); const emptyFiber = await emptyCtx.plugin(basicModel); expect(emptyTarget.entries[0]!.render(80)).toBe('no model'); await emptyFiber.dispose()
  })
})
