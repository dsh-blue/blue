/**
 * Canonical session-data capability, lifecycle, and fencing fixtures.
 *
 * @module @dsh-blue/blue-api/tests/session-data-v1
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  BluePluginHostService,
  attachBluePluginHostCapabilities,
  attachBluePluginHostSessionProjections,
  attachBluePluginHostSessionReader,
  createBluePluginControl,
  type BlueSessionProjectionOwner,
} from '../src/host.ts'
import {
  BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
  type BluePluginManifestV1,
} from '../src/protocol-v1.ts'
import {
  scopeBlueProjectionCut,
  validateBlueSessionSnapshot,
} from '../src/session-data.ts'
import type {
  BlueResult,
  BlueSessionProjectionCut,
  BlueSessionReader,
  BlueSessionSnapshot,
} from '../src/contracts.ts'

function consumer() {
  const cleanups: (() => void)[] = []
  return {
    effect(callback: () => void | (() => void)): void {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    dispose(): void {
      for (const cleanup of cleanups.splice(0)) cleanup()
    },
  }
}

function manifest(
  required: BluePluginManifestV1['capabilities']['required'],
  id = '@acme/session-data',
): BluePluginManifestV1 {
  return {
    $schema: BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
    schemaVersion: 1,
    id,
    entry: '.',
    api: '^1.0.0-beta.1',
    compatibility: { blue: '^0.1.1-rc.2', harness: '^0.1.1-rc.2', node: '>=22' },
    capabilities: { required, optional: [] },
  }
}

function snapshot(
  sessionEpoch = 1,
  revision = 1,
  id = 'same-id',
): BlueSessionSnapshot {
  return {
    sessionEpoch,
    revision,
    id,
    cwd: '/secret/workspace',
    status: 'idle',
    mode: 'plan',
    model: { id: 'deepseek-chat', provider: 'deepseek', effort: 'high' },
  }
}

function sessionSource(initial: BlueSessionSnapshot | null = snapshot()) {
  let current = initial
  const listeners = new Set<(value: BlueSessionSnapshot | null) => void>()
  const reader: BlueSessionReader = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener)
      listener(current)
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          listeners.delete(listener)
        },
      }
    },
  }
  return {
    reader,
    listeners,
    publish(value: BlueSessionSnapshot | null) {
      current = value
      for (const listener of listeners) listener(value)
    },
  }
}

type RawCut = { readonly sessionEpoch: number, readonly asOfSeq: number, readonly values: Readonly<Record<string, unknown>> } | null | undefined

function projectionSource(initial: RawCut) {
  let current = initial
  const listeners = new Set<(key: string, value: unknown, seq: number, sessionEpoch: number) => void>()
  const source: BlueSessionProjectionOwner = {
    currentMany: () => current,
    subscribe(listener) {
      listeners.add(listener)
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          listeners.delete(listener)
        },
      }
    },
  }
  return {
    source,
    listeners,
    set(value: RawCut) { current = value },
    emit(key: string, value: unknown, seq: number, sessionEpoch: number) {
      for (const listener of listeners) listener(key, value, seq, sessionEpoch)
    },
  }
}

const sessionRead = (fields: readonly ('identity' | 'cwd' | 'status' | 'mode' | 'model')[]) => ({
  name: 'session.read' as const,
  version: '^1.0.0',
  resources: { fields },
})

const projectionRead = (keys: readonly string[]) => ({
  name: 'session.projections.read' as const,
  version: '^1.0.0',
  resources: { keys },
})

describe('canonical session.read data plane', () => {
  it('returns only granted fields plus mandatory epoch/revision fencing metadata', () => {
    const host = new BluePluginHostService(new Context())
    const source = sessionSource()
    attachBluePluginHostSessionReader(host, consumer(), source.reader)
    const opened = host.open(consumer(), manifest([sessionRead(['identity', 'status'])]))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const current = opened.value.session!.current()
    expect(current).toEqual({
      ok: true,
      value: { revision: 1, sessionEpoch: 1, id: 'same-id', status: 'idle' },
    })
    if (current.ok && current.value !== null) {
      expect(Object.keys(current.value)).toEqual(['revision', 'sessionEpoch', 'id', 'status'])
      expect(Object.isFrozen(current.value)).toBe(true)
    }
    const modelPresent = host.open(consumer(), manifest([sessionRead(['model'])], '@acme/session-with-model'))
    expect(modelPresent.ok).toBe(true)
    if (modelPresent.ok) {
      expect(modelPresent.value.session!.current()).toMatchObject({
        ok: true,
        value: { model: { id: 'deepseek-chat', provider: 'deepseek', effort: 'high' } },
      })
    }

    source.publish({
      revision: 2,
      sessionEpoch: 1,
      id: 'same-id',
      cwd: '/secret/workspace',
      status: 'idle',
      mode: 'plan',
    })
    const modelOnly = host.open(consumer(), manifest([sessionRead(['model'])], '@acme/session-without-model'))
    expect(modelOnly.ok).toBe(true)
    if (modelOnly.ok) {
      expect(modelOnly.value.session!.current()).toEqual({ ok: true, value: { revision: 2, sessionEpoch: 1 } })
    }
  })

  it('validates listeners and rolls subscriptions back when consumer effect registration fails', () => {
    const host = new BluePluginHostService(new Context())
    attachBluePluginHostSessionReader(host, consumer(), sessionSource().reader)
    const opened = host.open(consumer(), manifest([sessionRead(['identity'])], '@acme/session-listener'))
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.value.session!.subscribe(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    }

    let effects = 0
    const failingConsumer = {
      effect(callback: () => () => void): void {
        effects += 1
        if (effects > 1) throw new Error('session effect failed')
        callback()
      },
    }
    const failing = host.open(failingConsumer, manifest([sessionRead(['identity'])], '@acme/session-effect'))
    expect(failing.ok).toBe(true)
    if (failing.ok) {
      expect(failing.value.session!.subscribe(() => {})).toMatchObject({
        ok: false,
        code: 'BLUE_INVALID_CONTRIBUTION',
        message: 'session effect failed',
      })
    }
  })

  it('accepts a same-id new epoch, rejects old epoch/revision frames, and fences unload', () => {
    const host = new BluePluginHostService(new Context())
    const source = sessionSource(snapshot(1, 8))
    const owner = consumer()
    const ownerRegistration = attachBluePluginHostSessionReader(host, owner, source.reader)
    const plugin = consumer()
    const opened = host.open(plugin, manifest([sessionRead(['identity', 'cwd'])], '@acme/session-epoch'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const seen: BlueResult<unknown>[] = []
    const subscribed = opened.value.session!.subscribe(result => { seen.push(result) })
    expect(subscribed.ok).toBe(true)

    source.publish(snapshot(2, 1))
    source.publish(snapshot(1, 99, 'old-epoch'))
    source.publish(snapshot(2, 1, 'duplicate-revision'))
    expect(opened.value.session!.current()).toMatchObject({ ok: true, value: { id: 'same-id', sessionEpoch: 2, revision: 1 } })
    expect(seen).toHaveLength(2)

    const late = [...source.listeners][0]!
    ownerRegistration.dispose()
    late(snapshot(3, 1, 'late-owner'))
    expect(opened.value.session!.current()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(seen.at(-1)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    plugin.dispose()
    expect(opened.value.session!.current()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.session!.subscribe(() => {})).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
  })

  it('distinguishes an active owner with no session from an owner gap and replays on reload', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const first = attachBluePluginHostSessionReader(host, firstOwner, sessionSource(null).reader)
    const opened = host.open(consumer(), manifest([sessionRead(['mode'])], '@acme/session-null'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const seen: BlueResult<unknown>[] = []
    const registered = opened.value.session!.subscribe(result => { seen.push(result) })
    expect(registered).toMatchObject({ ok: true })
    expect(seen).toEqual([{ ok: true, value: null }])

    first.dispose()
    expect(seen.at(-1)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    attachBluePluginHostSessionReader(host, consumer(), sessionSource(snapshot(4, 2)).reader)
    expect(seen.at(-1)).toEqual({ ok: true, value: { revision: 2, sessionEpoch: 4, mode: 'plan' } })
  })
})

describe('canonical session.projections.read data plane', () => {
  it('enforces the exact key allowlist and returns detached consistent cuts', () => {
    const usage = { total: 3, rows: [1, true, null, 'x'] }
    const source = projectionSource({
      sessionEpoch: 1,
      asOfSeq: 7,
      values: { costUsage: usage, contextTimeline: { requests: 2 }, secret: 'hidden' },
    })
    const host = new BluePluginHostService(new Context())
    attachBluePluginHostSessionProjections(host, consumer(), source.source)
    const opened = host.open(consumer(), manifest([projectionRead(['costUsage', 'contextTimeline'])], '@acme/projection-cut'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const many = opened.value.projections!.currentMany(['contextTimeline', 'costUsage'])
    expect(many).toEqual({
      ok: true,
      value: {
        sessionEpoch: 1,
        asOfSeq: 7,
        values: { contextTimeline: { requests: 2 }, costUsage: usage },
      },
    })
    expect(opened.value.projections!.current('costUsage')).toMatchObject({ ok: true, value: { key: 'costUsage', sessionEpoch: 1, asOfSeq: 7 } })
    expect(opened.value.projections!.current('secret')).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })
    expect(opened.value.projections!.currentMany([])).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.projections!.currentMany(['costUsage', 'costUsage'])).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.projections!.currentMany(['bad key'])).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.projections!.subscribe(['secret'], () => {})).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })
    expect(opened.value.projections!.subscribe(['costUsage'], null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })

    usage.rows[0] = 99
    if (many.ok && many.value !== null) {
      expect(many.value.values.costUsage).toEqual({ total: 3, rows: [1, true, null, 'x'] })
      expect(Object.isFrozen(many.value)).toBe(true)
      expect(Object.isFrozen(many.value.values)).toBe(true)
      expect(Object.isFrozen(many.value.values.costUsage)).toBe(true)
    }
  })

  it('replays a consistent cut, reports key unload, and resumes without stale reuse', () => {
    const source = projectionSource({ sessionEpoch: 5, asOfSeq: 10, values: { costUsage: { total: 1 } } })
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    const ownerRegistration = attachBluePluginHostSessionProjections(host, owner, source.source)
    const opened = host.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-replay'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const seen: BlueResult<BlueSessionProjectionCut | null>[] = []
    const subscribed = opened.value.projections!.subscribe(['costUsage'], result => { seen.push(result) })
    expect(subscribed.ok).toBe(true)
    expect(seen).toEqual([{ ok: true, value: { sessionEpoch: 5, asOfSeq: 10, values: { costUsage: { total: 1 } } } }])

    source.set({ sessionEpoch: 5, asOfSeq: 9, values: { costUsage: { total: 0 } } })
    source.emit('costUsage', { total: 0 }, 10, 5)
    expect(seen).toHaveLength(1)
    source.set({ sessionEpoch: 5, asOfSeq: 10, values: { costUsage: { total: 1 } } })
    source.emit('costUsage', { total: 1 }, 10, 5)
    expect(seen).toHaveLength(1)

    source.set({ sessionEpoch: 5, asOfSeq: 11, values: {} })
    source.emit('costUsage', undefined, 11, 5)
    expect(seen.at(-1)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(opened.value.projections!.current('costUsage')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    const afterUnavailable = seen.length
    source.emit('costUsage', undefined, 11, 5)
    expect(seen).toHaveLength(afterUnavailable)

    source.set({ sessionEpoch: 5, asOfSeq: 12, values: { costUsage: { total: 2 } } })
    source.emit('costUsage', { total: 2 }, 12, 5)
    expect(seen.at(-1)).toEqual({ ok: true, value: { sessionEpoch: 5, asOfSeq: 12, values: { costUsage: { total: 2 } } } })

    const late = [...source.listeners][0]!
    ownerRegistration.dispose()
    late('costUsage', { total: 999 }, 99, 5)
    expect(seen.at(-1)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    const replacement = projectionSource({ sessionEpoch: 6, asOfSeq: 1, values: { costUsage: { total: 3 } } })
    attachBluePluginHostSessionProjections(host, consumer(), replacement.source)
    expect(seen.at(-1)).toEqual({ ok: true, value: { sessionEpoch: 6, asOfSeq: 1, values: { costUsage: { total: 3 } } } })
    replacement.set({ sessionEpoch: 5, asOfSeq: 100, values: { costUsage: { total: 4 } } })
    replacement.emit('costUsage', { total: 4 }, 100, 5)
    expect(seen.at(-1)).toMatchObject({ ok: true, value: { sessionEpoch: 6, values: { costUsage: { total: 3 } } } })
  })

  it('keeps subscription identity through an owner gap and admits new consumers in that gap', () => {
    const host = new BluePluginHostService(new Context())
    const source = projectionSource({ sessionEpoch: 1, asOfSeq: 1, values: { costUsage: 1 } })
    const ownerRegistration = attachBluePluginHostSessionProjections(host, consumer(), source.source)
    const first = host.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-first'))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const seen: BlueResult<BlueSessionProjectionCut | null>[] = []
    first.value.projections!.subscribe(['costUsage'], result => { seen.push(result) })
    ownerRegistration.dispose()

    const duringGap = host.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-gap'))
    expect(duringGap).toMatchObject({ ok: true, value: { grants: [{ name: 'session.projections.read', availability: 'unavailable' }] } })
    if (duringGap.ok) expect(duringGap.value.projections!.current('costUsage')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    attachBluePluginHostSessionProjections(host, consumer(), projectionSource({ sessionEpoch: 1, asOfSeq: 1, values: { costUsage: 2 } }).source)
    expect(seen.at(-1)).toEqual({ ok: true, value: { sessionEpoch: 1, asOfSeq: 1, values: { costUsage: 2 } } })
  })

  it('handles null cuts, validates source events, and fences disposed projection consumers', () => {
    const host = new BluePluginHostService(new Context())
    const source = projectionSource(null)
    attachBluePluginHostSessionProjections(host, consumer(), source.source)
    const plugin = consumer()
    const opened = host.open(plugin, manifest([projectionRead(['costUsage'])], '@acme/projection-null'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.projections!.current('costUsage')).toEqual({ ok: true, value: null })
    expect(opened.value.projections!.currentMany(['costUsage'])).toEqual({ ok: true, value: null })
    const seen: BlueResult<BlueSessionProjectionCut | null>[] = []
    const subscribed = opened.value.projections!.subscribe(['costUsage'], result => { seen.push(result) })
    expect(subscribed).toMatchObject({ ok: true, value: { disposed: false } })
    expect(seen).toEqual([{ ok: true, value: null }])

    source.emit('bad key', null, 1, 1)
    source.emit('costUsage', null, Number.NaN, 1)
    source.emit('costUsage', null, -2, 1)
    source.emit('costUsage', null, 1, Number.NaN)
    source.emit('costUsage', null, 1, -1)
    source.emit('unrelated', null, 1, 1)
    source.emit('costUsage', null, 1, 1)
    expect(seen).toEqual([{ ok: true, value: null }])

    if (subscribed.ok) {
      const internal = subscribed.value as unknown as { replay(): void, ownerUnavailable(): void }
      internal.ownerUnavailable()
      internal.ownerUnavailable()
      expect(seen.at(-1)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
      subscribed.value.dispose()
      expect(subscribed.value.disposed).toBe(true)
      subscribed.value.dispose()
      internal.replay()
      internal.ownerUnavailable()
    }
    const disposedByConsumer = opened.value.projections!.subscribe(['costUsage'], () => {})
    expect(disposedByConsumer).toMatchObject({ ok: true, value: { disposed: false } })
    plugin.dispose()
    if (disposedByConsumer.ok) expect(disposedByConsumer.value.disposed).toBe(true)
    expect(opened.value.projections!.currentMany(['costUsage'])).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.projections!.subscribe(['costUsage'], () => {})).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
  })

  it('rolls subscriptions back on effect failure and rejects an owner replaced during a read', () => {
    const host = new BluePluginHostService(new Context())
    const source = projectionSource({ sessionEpoch: 1, asOfSeq: 1, values: { costUsage: 1 } })
    attachBluePluginHostSessionProjections(host, consumer(), source.source)
    let effects = 0
    const failingConsumer = {
      effect(callback: () => () => void): void {
        effects += 1
        if (effects > 1) throw new Error('projection effect failed')
        callback()
      },
    }
    const failing = host.open(failingConsumer, manifest([projectionRead(['costUsage'])], '@acme/projection-effect'))
    expect(failing.ok).toBe(true)
    if (failing.ok) {
      expect(failing.value.projections!.subscribe(['costUsage'], () => {})).toMatchObject({
        ok: false,
        code: 'BLUE_INVALID_CONTRIBUTION',
        message: 'projection effect failed',
      })
    }

    const replacedHost = new BluePluginHostService(new Context())
    const replacement = projectionSource({ sessionEpoch: 2, asOfSeq: 1, values: { costUsage: 2 } })
    let ownerRegistration: { dispose(): void }
    const replacingSource: BlueSessionProjectionOwner = {
      currentMany() {
        ownerRegistration.dispose()
        attachBluePluginHostSessionProjections(replacedHost, consumer(), replacement.source)
        return { sessionEpoch: 1, asOfSeq: 1, values: { costUsage: 1 } }
      },
      subscribe: projectionSource(null).source.subscribe,
    }
    ownerRegistration = attachBluePluginHostSessionProjections(replacedHost, consumer(), replacingSource)
    const replaced = replacedHost.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-replaced'))
    expect(replaced.ok).toBe(true)
    if (replaced.ok) {
      expect(replaced.value.projections!.current('costUsage')).toMatchObject({ ok: false, code: 'BLUE_STALE' })
    }
  })

  it('maps owner read failures without exposing thrown values', () => {
    const host = new BluePluginHostService(new Context())
    attachBluePluginHostSessionProjections(host, consumer(), {
      currentMany() { throw 'hostile projection read' },
      subscribe: projectionSource(null).source.subscribe,
    })
    const opened = host.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-throw'))
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.value.projections!.current('costUsage')).toEqual({
        ok: false,
        code: 'BLUE_INTERNAL_FAILURE',
        message: 'session data could not be read',
      })
    }

    const errorHost = new BluePluginHostService(new Context())
    attachBluePluginHostSessionProjections(errorHost, consumer(), {
      currentMany() { throw new Error('credential at /private/path') },
      subscribe: projectionSource(null).source.subscribe,
    })
    const errorOpened = errorHost.open(consumer(), manifest([projectionRead(['costUsage'])], '@acme/projection-error'))
    expect(errorOpened.ok).toBe(true)
    if (errorOpened.ok) {
      expect(errorOpened.value.projections!.current('costUsage')).toEqual({
        ok: false,
        code: 'BLUE_INTERNAL_FAILURE',
        message: 'session data could not be read',
      })
    }
  })

  it('rejects stale cuts and bounds both individual values and aggregate cuts', () => {
    const source = projectionSource({ sessionEpoch: 3, asOfSeq: 9, values: { a: 'ok', b: 'ok', c: 'ok', d: 'ok', e: 'ok' } })
    const host = new BluePluginHostService(new Context())
    attachBluePluginHostSessionProjections(host, consumer(), source.source)
    const opened = host.open(consumer(), manifest([projectionRead(['a', 'b', 'c', 'd', 'e'])], '@acme/projection-limits'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.projections!.current('a')).toMatchObject({ ok: true })

    source.set({ sessionEpoch: 3, asOfSeq: 8, values: { a: 'old' } })
    expect(opened.value.projections!.current('a')).toMatchObject({ ok: false, code: 'BLUE_STALE' })

    source.set({ sessionEpoch: 4, asOfSeq: 1, values: { a: 'x'.repeat(262_145) } })
    expect(opened.value.projections!.current('a')).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    const chunk = 'x'.repeat(230_000)
    source.set({ sessionEpoch: 4, asOfSeq: 2, values: { a: chunk, b: chunk, c: chunk, d: chunk, e: chunk } })
    expect(opened.value.projections!.currentMany(['a', 'b', 'c', 'd', 'e'])).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    const exactCut = { sessionEpoch: 4, asOfSeq: 2, values: { a: 'ok' } }
    const exactCutBytes = new TextEncoder().encode(JSON.stringify(exactCut)).byteLength
    expect(scopeBlueProjectionCut(exactCut, ['a'], 4, exactCutBytes)).toEqual(exactCut)
    expect(() => scopeBlueProjectionCut(exactCut, ['a'], 4, exactCutBytes - 1)).toThrow('projection cut exceeds')
  })

  it('distinguishes null session, absent backing/key, and invalid owner payloads', () => {
    expect(scopeBlueProjectionCut(null, ['x'])).toBeNull()
    expect(() => scopeBlueProjectionCut(undefined, ['x'])).toThrow('backing data is unavailable')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: {} }, ['x'])).toThrow('key "x" is unavailable')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: Number.NaN } }, ['x'])).toThrow('finite')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: Symbol('bad') } }, ['x'])).toThrow('JSON data')
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: cycle } }, ['x'])).toThrow('acyclic')
    const sparse = Array.from({ length: 2 }, (_, index) => index)
    delete sparse[1]
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: sparse } }, ['x'])).toThrow('sparse')
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: () => 1 })
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: accessor } }, ['x'])).toThrow('data property')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: -1, asOfSeq: 1, values: { x: 1 } }, ['x'])).toThrow('projection session epoch')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: -2, values: { x: 1 } }, ['x'])).toThrow('projection sequence')
    expect(() => scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: [] }, ['x'])).toThrow('values must be an object')
    expect(() => scopeBlueProjectionCut(1, ['x'])).toThrow('cut must be an object or null')
    const withHidden = Object.defineProperty({ visible: 1 }, 'hidden', { enumerable: false, value: 'secret' })
    expect(scopeBlueProjectionCut({ sessionEpoch: 1, asOfSeq: 1, values: { x: withHidden } }, ['x'])).toEqual({
      sessionEpoch: 1,
      asOfSeq: 1,
      values: { x: { visible: 1 } },
    })
  })
})

describe('session-data owner authority', () => {
  it('requires dedicated owner seams and validates owner registration boundaries', () => {
    const host = new BluePluginHostService(new Context())
    expect(() => attachBluePluginHostCapabilities(host, consumer(), ['session.projections.read'] as never)).toThrow('attachBluePluginHostSessionProjections')
    expect(() => attachBluePluginHostSessionProjections(host, consumer(), null as never)).toThrow('requires currentMany and subscribe')

    const source = projectionSource({ sessionEpoch: 1, asOfSeq: 1, values: { x: 1 } })
    const owner = consumer()
    const registration = createBluePluginControl(host).attachSessionProjections(owner, source.source)
    expect(() => attachBluePluginHostSessionProjections(host, consumer(), source.source)).toThrow('already has an active session projection owner')
    owner.dispose()
    expect(registration.disposed).toBe(true)

    const effectFailure = { effect(): never { throw new Error('effect failed') } }
    expect(() => attachBluePluginHostSessionProjections(host, effectFailure, source.source)).toThrow('effect failed')
    const invalidSubscription = { currentMany: () => null, subscribe: () => null as never }
    expect(() => attachBluePluginHostSessionProjections(host, consumer(), invalidSubscription)).toThrow('must return a registration')
  })

  it('validates mandatory session epoch and hostile owner properties', () => {
    expect(() => validateBlueSessionSnapshot({ revision: 1, id: 's', cwd: '/', status: 'idle', mode: 'normal' })).toThrow('session epoch')
    expect(() => validateBlueSessionSnapshot(undefined)).toThrow('object or null')
    const accessor = Object.defineProperty({ revision: 1 }, 'sessionEpoch', { enumerable: true, get: () => 1 })
    expect(() => validateBlueSessionSnapshot(accessor)).toThrow('own data property')
  })

  it('disposes source subscriptions returned after reentrant owner cleanup', () => {
    const host = new BluePluginHostService(new Context())
    const sessionOwner = consumer()
    let sessionSourceDisposed = false
    const sessionRegistration = attachBluePluginHostSessionReader(host, sessionOwner, {
      current: () => snapshot(),
      subscribe() {
        sessionOwner.dispose()
        return {
          get disposed() { return sessionSourceDisposed },
          dispose() { sessionSourceDisposed = true },
        }
      },
    })
    expect(sessionRegistration.disposed).toBe(true)
    expect(sessionSourceDisposed).toBe(true)

    const projectionOwner = consumer()
    let projectionSourceDisposed = false
    const projectionRegistration = attachBluePluginHostSessionProjections(host, projectionOwner, {
      currentMany: () => null,
      subscribe() {
        projectionOwner.dispose()
        return {
          get disposed() { return projectionSourceDisposed },
          dispose() { projectionSourceDisposed = true },
        }
      },
    })
    expect(projectionRegistration.disposed).toBe(true)
    expect(projectionSourceDisposed).toBe(true)
  })
})
