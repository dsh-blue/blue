/**
 * Status-provider owner ordering, persisted-selection, and lifecycle tests.
 *
 * @module @dsh-blue/blue-transcript/tests/status-provider-owner
 */

import { Context, symbols } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueSessionSnapshot, BlueStatusProvider } from '../../api/src/contracts.ts'

const host = vi.hoisted(() => ({
  attach: vi.fn(),
  initial: { statusProviders: [] as readonly BlueStatusProvider[], statusProvidersRevision: 1 } as Record<string, unknown>,
  listeners: new Set<(snapshot: Record<string, unknown>) => void>(),
  disposed: 0,
}))

vi.mock('@dsh-blue/blue-api', () => ({
  attachBluePluginHostCapabilities: host.attach,
  subscribeBluePluginHost(_service: unknown, listener: (snapshot: Record<string, unknown>) => void) {
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
}))

import * as ownerPlugin from '../src/status-provider-owner.ts'

interface CompositionProbe {
  readonly selections: string[]
  readonly candidateUpdates: { readonly providers: readonly BlueStatusProvider[], readonly revision: number }[]
  readonly sessions: (BlueSessionSnapshot | null)[]
  detaches: number
  select(id: string): void
  updateCandidates(providers: readonly BlueStatusProvider[], revision: number): void
  updateSession(snapshot: BlueSessionSnapshot | null): void
  detachProviders(): void
}

interface ReaderProbe {
  readonly disposed: boolean
  publish(snapshot: BlueSessionSnapshot | null): void
  subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): { dispose(): void }
}

const roots: Context[] = []

afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

beforeEach(() => {
  host.attach.mockReset()
  host.initial = { statusProviders: [], statusProvidersRevision: 1 }
  host.listeners.clear()
  host.disposed = 0
})

function compositionProbe(): CompositionProbe {
  return {
    selections: [],
    candidateUpdates: [],
    sessions: [],
    detaches: 0,
    select(id) { this.selections.push(id) },
    updateCandidates(providers, revision) { this.candidateUpdates.push({ providers, revision }) },
    updateSession(snapshot) { this.sessions.push(snapshot) },
    detachProviders() { this.detaches += 1 },
  }
}

function readerProbe(initial: BlueSessionSnapshot | null = null): ReaderProbe {
  const listeners = new Set<(snapshot: BlueSessionSnapshot | null) => void>()
  let disposed = false
  return {
    get disposed() { return disposed },
    publish(snapshot) { for (const listener of listeners) listener(snapshot) },
    subscribe(listener) {
      listeners.add(listener)
      listener(initial)
      return {
        dispose() {
          disposed = true
          listeners.delete(listener)
        },
      }
    },
  }
}

function session(id: string): BlueSessionSnapshot {
  return { id, cwd: '/work', status: 'idle', mode: 'normal' }
}

function provide(ctx: Context, name: string, value: unknown): void {
  ctx.reflect.provide(name, value)
}

async function mount(options: {
  readonly settings?: unknown
  readonly wrappedHost?: boolean
  readonly current?: BlueSessionSnapshot | null
} = {}): Promise<{ readonly ctx: Context, readonly composition: CompositionProbe, readonly reader: ReaderProbe, readonly fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  roots.push(ctx)
  const composition = compositionProbe()
  const reader = readerProbe(options.current)
  const originalHost = { id: 'original-host' }
  provide(ctx, 'bluePluginHost', options.wrappedHost === true ? { [symbols.original]: originalHost } : originalHost)
  provide(ctx, 'blueStatusComposition', composition)
  provide(ctx, 'blueSessionReader', reader)
  if (options.settings !== undefined) provide(ctx, 'settings', { get: (namespace: string) => namespace === 'blue' ? options.settings : undefined })
  const fiber = await ctx.plugin(ownerPlugin)
  return { ctx, composition, reader, fiber }
}

function emitHost(snapshot: Record<string, unknown>): void {
  for (const listener of host.listeners) listener(snapshot)
}

describe('status provider owner', () => {
  it('declares the independent composition plugin surface', () => {
    expect(ownerPlugin.name).toBe('blue-status-provider-owner')
    expect(ownerPlugin.inject).toEqual(['bluePluginHost', 'blueStatusComposition', 'blueSessionReader'])
  })

  it('replays settings-before-owner selection and follows host and session snapshots', async () => {
    const candidate = { id: 'acme.persisted', render: () => ({ kind: 'text' as const, content: 'persisted' }) }
    host.initial = { statusProviders: [candidate], statusProvidersRevision: 7 }
    const current = session('session-a')
    const { composition, reader } = await mount({ settings: { statusProvider: 'acme.persisted' }, current })

    expect(composition.selections).toEqual(['acme.persisted'])
    expect(composition.candidateUpdates).toEqual([{ providers: [candidate], revision: 7 }])
    expect(composition.sessions).toEqual([current])
    reader.publish(session('session-b'))
    expect(composition.sessions.at(-1)?.id).toBe('session-b')
    expect(host.attach).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['status.provider'])
  })

  it('replays owner-before-settings handoff and ignores unrelated settings commits', async () => {
    const { ctx, composition } = await mount()
    expect(composition.selections).toEqual(['blue.default'])

    ctx.emit('settings/updated', 'shell' as never, { statusProvider: 'acme.wrong' }, {}, 'test')
    expect(composition.selections).toEqual(['blue.default'])
    ctx.emit('blue/settings-source-ready', { statusProvider: 'acme.ready' })
    ctx.emit('settings/updated', 'blue' as never, { statusProvider: 'acme.updated' }, {}, 'test')
    expect(composition.selections).toEqual(['blue.default', 'acme.ready', 'acme.updated'])
  })

  it('falls back for missing, accessor, non-string, and blank selections without invoking accessors', async () => {
    const inherited = Object.create({ statusProvider: 'acme.inherited' }) as Record<string, unknown>
    let getterCalls = 0
    const accessor = Object.defineProperty({}, 'statusProvider', {
      enumerable: true,
      get() { getterCalls += 1; return 'acme.accessor' },
    })
    const { ctx, composition } = await mount({ settings: inherited })

    for (const value of [null, {}, accessor, { statusProvider: 42 }, { statusProvider: '   ' }]) {
      ctx.emit('blue/settings-source-ready', value)
    }
    ctx.emit('blue/settings-source-ready', { statusProvider: 'acme.valid' })

    expect(composition.selections).toEqual([
      'blue.default',
      'blue.default',
      'blue.default',
      'blue.default',
      'blue.default',
      'blue.default',
      'acme.valid',
    ])
    expect(getterCalls).toBe(0)
  })

  it('supports current and legacy host revision snapshots', async () => {
    const first = { id: 'acme.first', render: () => ({ kind: 'text' as const, content: 'first' }) }
    const second = { id: 'acme.second', render: () => ({ kind: 'text' as const, content: 'second' }) }
    const { composition } = await mount()

    emitHost({ statusProviders: [first], revision: 11 })
    emitHost({ statusProviders: [second] })

    expect(composition.candidateUpdates.slice(-2)).toEqual([
      { providers: [first], revision: 11 },
      { providers: [second], revision: 0 },
    ])
  })

  it('unwraps an owner service and replays selection across theme and owner reloads', async () => {
    const settings = { statusProvider: 'acme.persisted', theme: 'dark' }
    const first = await mount({ settings, wrappedHost: true })
    const original = (first.ctx.get('bluePluginHost') as Record<symbol, unknown>)[symbols.original]
    expect(host.attach.mock.calls[0]?.[0]).toBe(original)

    first.ctx.emit('settings/updated', 'blue' as never, { ...settings, theme: 'paper' }, settings, 'theme')
    expect(first.composition.selections).toEqual(['acme.persisted', 'acme.persisted'])
    await first.fiber.dispose()
    expect(first.composition.detaches).toBe(1)

    const replacement = await first.ctx.plugin(ownerPlugin)
    expect(first.composition.selections).toEqual(['acme.persisted', 'acme.persisted', 'acme.persisted'])
    await replacement.dispose()
    expect(first.composition.detaches).toBe(2)
  })

  it('disposes host/session subscriptions, detaches providers, and rejects late events', async () => {
    const mounted = await mount({ settings: { statusProvider: 'acme.live' } })
    const before = [...mounted.composition.selections]
    await mounted.fiber.dispose()

    expect(host.disposed).toBe(1)
    expect(mounted.reader.disposed).toBe(true)
    expect(mounted.composition.detaches).toBe(1)
    mounted.ctx.emit('blue/settings-source-ready', { statusProvider: 'acme.late' })
    mounted.ctx.emit('settings/updated', 'blue' as never, { statusProvider: 'acme.late' }, {}, 'late')
    mounted.reader.publish(session('late'))
    emitHost({ statusProviders: [], statusProvidersRevision: 99 })
    expect(mounted.composition.selections).toEqual(before)
    expect(mounted.composition.sessions).toEqual([null])
    expect(mounted.composition.candidateUpdates).toHaveLength(1)
  })
})
