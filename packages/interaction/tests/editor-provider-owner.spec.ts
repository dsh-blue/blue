/**
 * Editor-provider owner ordering, persisted-selection, gesture, and unload tests.
 *
 * @module @dsh-blue/blue-interaction/tests/editor-provider-owner
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueEditorProvider } from '../../api/src/contracts.ts'
import { EditorHostService } from '../src/editor-instance.ts'

const host = vi.hoisted(() => ({
  attach: vi.fn(),
  gesture: vi.fn(async (_owner: unknown, callback: (gesture: object) => unknown) => callback(Object.freeze({}))),
  initial: { editorProviders: [] as readonly BlueEditorProvider[], editorProvidersRevision: 1 } as Record<string, unknown>,
  listeners: new Set<(snapshot: Record<string, unknown>) => void>(),
  disposed: 0,
}))

function control() {
  return {
    attachCapabilities: host.attach,
    runUserGesture: host.gesture,
    subscribe(listener: (snapshot: Record<string, unknown>) => void) {
    host.listeners.add(listener)
    listener(host.initial)
    let disposed = false
    return {
      dispose() {
        if (disposed) return
        disposed = true
        host.disposed += 1
        host.listeners.delete(listener)
      },
    }
    },
  }
}

import * as ownerPlugin from '../src/editor-provider-owner.ts'

const roots: Context[] = []

afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

beforeEach(() => {
  host.attach.mockReset()
  host.gesture.mockClear()
  host.initial = { editorProviders: [], editorProvidersRevision: 1 }
  host.listeners.clear()
  host.disposed = 0
})

function provide(ctx: Context, name: string, value: unknown): void {
  ctx.reflect.provide(name, value)
}

async function mount(options: { readonly settings?: unknown } = {}) {
  const ctx = new Context()
  roots.push(ctx)
  const editorHost = new EditorHostService(ctx)
  provide(ctx, 'bluePluginControl', control())
  if (options.settings !== undefined) provide(ctx, 'settings', { get: (namespace: string) => namespace === 'blue' ? options.settings : undefined })
  const fiber = await ctx.plugin(ownerPlugin)
  return { ctx, editorHost, fiber }
}

function emitHost(snapshot: Record<string, unknown>): void {
  for (const listener of host.listeners) listener(snapshot)
}

describe('editor provider owner', () => {
  it('declares a standalone owner and replays settings and current provider revision', async () => {
    const provider: BlueEditorProvider = { id: 'acme.shell', render: () => ({ kind: 'editor-control' }) }
    host.initial = { editorProviders: [provider], editorProvidersRevision: 7 }
    const mounted = await mount({ settings: { editorProvider: 'acme.shell' } })

    expect(ownerPlugin.name).toBe('blue-editor-provider-owner')
    expect(ownerPlugin.inject).toEqual(['bluePluginControl', 'blueEditorHost'])
    expect(host.attach).toHaveBeenCalledWith(expect.anything(), ['editor.provider'])
    expect(mounted.editorHost.providers).toMatchObject({ desiredId: 'acme.shell', revision: 7, entries: [provider] })
  })

  it('follows only blue settings while preserving unknown non-empty ids', async () => {
    const mounted = await mount()
    expect(mounted.editorHost.providers?.desiredId).toBe('blue.default')

    mounted.ctx.emit('settings/updated', 'shell' as never, { editorProvider: 'wrong' }, {}, 'test')
    expect(mounted.editorHost.providers?.desiredId).toBe('blue.default')
    mounted.ctx.emit('blue/settings-source-ready', { editorProvider: 'acme.later' })
    expect(mounted.editorHost.providers?.desiredId).toBe('acme.later')
    mounted.ctx.emit('settings/updated', 'blue' as never, { editorProvider: 'acme.persisted' }, {}, 'test')
    expect(mounted.editorHost.providers?.desiredId).toBe('acme.persisted')
  })

  it('rejects inherited, accessor, non-string, and blank selections without invoking getters', async () => {
    const inherited = Object.create({ editorProvider: 'inherited' }) as Record<string, unknown>
    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'editorProvider', { get() { getterCalls += 1; return 'getter' } })
    const mounted = await mount({ settings: inherited })

    for (const value of [null, {}, accessor, { editorProvider: 1 }, { editorProvider: '  ' }]) {
      mounted.ctx.emit('blue/settings-source-ready', value)
      expect(mounted.editorHost.providers?.desiredId).toBe('blue.default')
    }
    expect(getterCalls).toBe(0)
  })

  it('uses editor-local and legacy revisions without rebuilding on the same fence', async () => {
    const first: BlueEditorProvider = { id: 'first', render: () => ({ kind: 'editor-control' }) }
    const second: BlueEditorProvider = { id: 'second', render: () => ({ kind: 'editor-control' }) }
    const mounted = await mount()
    const initial = mounted.editorHost.providers

    emitHost({ editorProviders: [first], editorProvidersRevision: 1, revision: 9 })
    expect(mounted.editorHost.providers).toBe(initial)
    emitHost({ editorProviders: [first], revision: 10 })
    expect(mounted.editorHost.providers).toMatchObject({ entries: [first], revision: 10 })
    emitHost({ editorProviders: [second] })
    expect(mounted.editorHost.providers).toMatchObject({ entries: [second], revision: 0 })
  })

  it('mints a scoped gesture, normalizes callback failures, and clears only its own generation', async () => {
    let retained: object | undefined
    const provider: BlueEditorProvider = {
      id: 'events',
      render: () => ({ kind: 'editor-control' }),
      onEvent: async (_event, context) => { retained = context.userGesture; return { ok: true, value: undefined } },
    }
    host.initial = { editorProviders: [provider], editorProvidersRevision: 2 }
    const mounted = await mount({ settings: { editorProvider: provider.id } })
    const binding = mounted.editorHost.providers!
    await expect(binding.dispatch(provider, { kind: 'activate', controlId: 'go' }, new AbortController().signal, 3)).resolves.toEqual({ ok: true, value: undefined })
    expect(retained).toEqual({})
    expect(host.gesture).toHaveBeenCalledOnce()

    const throwing: BlueEditorProvider = { ...provider, onEvent: async () => { throw new Error('boom') } }
    await expect(binding.dispatch(throwing, { kind: 'dismiss' }, new AbortController().signal, 4)).resolves.toEqual({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'boom' })
    const replacement = { ...binding, desiredId: 'replacement' }
    mounted.editorHost.setProviders(replacement)
    await mounted.fiber.dispose()
    expect(mounted.editorHost.providers).toBe(replacement)
    expect(host.disposed).toBe(1)
  })

  it('keeps missing callbacks inert and reads thrown messages without invoking accessors or proxies', async () => {
    const provider: BlueEditorProvider = {
      id: 'events',
      render: () => ({ kind: 'editor-control' }),
    }
    host.initial = { editorProviders: [provider], editorProvidersRevision: 2 }
    const mounted = await mount({ settings: { editorProvider: provider.id } })
    const binding = mounted.editorHost.providers!
    const signal = new AbortController().signal

    await expect(binding.dispatch(provider, { kind: 'dismiss' }, signal, 1)).resolves.toEqual({ ok: true, value: undefined })
    expect(host.gesture).not.toHaveBeenCalled()

    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'message', {
      get() { getterCalls += 1; return 'unsafe' },
    })
    const proxy = new Proxy({}, {
      getOwnPropertyDescriptor() { throw new Error('descriptor trap') },
    })
    for (const thrown of ['primitive', accessor, { message: 42 }, proxy]) {
      const throwing: BlueEditorProvider = {
        ...provider,
        onEvent: async () => { throw thrown },
      }
      await expect(binding.dispatch(throwing, { kind: 'dismiss' }, signal, 2)).resolves.toEqual({
        ok: false,
        code: 'BLUE_ACTION_REJECTED',
        message: 'editor provider callback failed',
      })
    }
    expect(getterCalls).toBe(0)
  })
})
