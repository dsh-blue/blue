/**
 * Cordis-scoped host tests: public capability surfaces, registry ownership,
 * notification fan-out, and Fiber-style cleanup.
 *
 * @module @dsh-blue/blue-api/tests/host
 */

import { Context, symbols } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  BluePluginHostService,
  attachBluePluginHostCapabilities,
  attachBluePluginHostSessionReader,
  apply,
  closeBluePluginHostOverlay,
  createBlueUserGesture,
  runBlueUserGesture,
  name,
  snapshotBluePluginHost,
  subscribeBluePluginHost,
  subscribeBluePluginNotifications,
  type BluePluginHostSnapshot,
} from '../src/host.ts'
import type { BlueEditorProvider, BluePaneRegistration, BluePluginApi, BluePluginManifest, BluePublicOverlayHandle, BlueResult, BlueSessionSnapshot, BlueUserGesture, BlueView } from '../src/contracts.ts'
import { BLUE_PLUGIN_MANIFEST_SCHEMA_URL, type BluePluginManifestV1 } from '../src/protocol-v1.ts'

const view: BlueView = { kind: 'text', content: 'hello' }

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

function manifest(capabilities: BluePluginManifest['capabilities'] = ['commands', 'status', 'notifications.publish']): BluePluginManifest {
  return { id: '@acme/plugin', api: '^1.0.0-beta.1', capabilities }
}

function canonicalManifest(id: string, required: BluePluginManifestV1['capabilities']['required'] = []): BluePluginManifestV1 {
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

function command(id: string) {
  return { id, label: id, execute: async () => ({ ok: true as const, value: undefined }) }
}

function attach(host: BluePluginHostService, capabilities: BluePluginManifest['capabilities'] = ['commands', 'status', 'notifications.publish']) {
  const owner = consumer()
  attachBluePluginHostCapabilities(host, owner, capabilities)
  return owner
}

function sessionValue(revision = 1, id = 'session-one'): BlueSessionSnapshot {
  return { revision, sessionEpoch: 1, id, cwd: '/workspace', status: 'idle', mode: 'normal', model: { id: 'model', provider: 'provider', effort: 'high' } }
}

function sessionSource(initial: BlueSessionSnapshot | null = sessionValue()) {
  let current = initial
  const listeners = new Set<(snapshot: BlueSessionSnapshot | null) => void>()
  const reader = {
    current: () => current,
    subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void) {
      listeners.add(listener)
      listener(current)
      let disposed = false
      return { get disposed() { return disposed }, dispose() { disposed = true; listeners.delete(listener) } }
    },
  }
  return {
    reader,
    publish(snapshot: BlueSessionSnapshot | null) { current = snapshot; for (const listener of listeners) listener(snapshot) },
    listeners,
  }
}

describe('BluePluginHostService', () => {
  it('rejects malformed and incompatible manifests at the API boundary', () => {
    const host = new BluePluginHostService(new Context())
    const c = consumer()
    expect(host.open(c, { id: 'bad id', api: '^1.0.0-beta.1', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, { id: '@acme/plugin', api: 'not a range', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(c, { id: '@acme/plugin', api: '^2.0.0', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(null as never, manifest([]))).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(c, { ...manifest([]), capabilities: ['dock'] } as never)).toEqual({
      ok: false,
      code: 'BLUE_API_INCOMPATIBLE',
      message: 'capability "dock" was removed; use "panes"',
    })
    expect(host.open(c, manifest(['session.read']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
  })

  it('exposes only declared capabilities and freezes the public projection', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const apiResult = host.open(consumer(), manifest(['status']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    expect(api.manifest).toEqual({ id: '@acme/plugin', api: '^1.0.0-beta.1', capabilities: ['status'] })
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.manifest)).toBe(true)
    expect(api.commands).toBeUndefined()
    expect(api.panes).toBeUndefined()
    expect(api.notifications).toBeUndefined()
    const status = api.status!
    const registered = status.register({ id: 'status', render: () => view })
    expect(registered).toMatchObject({ ok: true })
    expect(status.list()).toEqual([{ id: 'status', render: expect.any(Function) }])
    expect(Object.isFrozen(status.list())).toBe(true)
  })

  it('enforces registry capability, contribution shape, and duplicate ids', () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['commands'])
    const apiResult = host.open(consumer(), manifest(['commands']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const commands = apiResult.value.commands!
    expect(commands.register(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(commands.register({ id: '', label: '', execute: async () => ({ ok: true as const, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(commands.register(command('run'))).toMatchObject({ ok: true })
    expect(commands.register(command('run'))).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(commands.register({ ...command('minimum'), priority: 0 })).toMatchObject({ ok: true })
    expect(commands.register({ ...command('maximum'), priority: 100 })).toMatchObject({ ok: true })
    expect(commands.register({ ...command('same-priority-first'), priority: 50 })).toMatchObject({ ok: true })
    expect(commands.register({ ...command('same-priority-second'), priority: 50 })).toMatchObject({ ok: true })
    expect(snapshotBluePluginHost(host).commands.map(entry => entry.id)).toEqual(['minimum', 'run', 'same-priority-first', 'same-priority-second', 'maximum'])
    expect(commands.register({ ...command('negative'), priority: -1 })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    owner.dispose()
    expect(commands.register(command('absent'))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    const denied = host.open(consumer(), { ...manifest([]), id: '@acme/empty' })
    expect(denied.ok).toBe(true)
    if (denied.ok) {
      const hidden = (denied.value as BluePluginApi & { status: NonNullable<BluePluginApi['status']> }).status
      expect(hidden).toBeUndefined()
    }

  })

  it('disposes registrations when the consumer effect unloads', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands', 'status'])
    const c = consumer()
    const apiResult = host.open(c, manifest(['commands', 'status']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    const commandRegistration = api.commands!.register(command('run'))
    const statusRegistration = api.status!.register({ id: 'status', render: () => view })
    expect(api.commands!.list()).toHaveLength(1)
    expect(api.status!.list()).toHaveLength(1)
    c.dispose()
    expect(api.commands!.list()).toEqual([])
    expect(api.status!.list()).toEqual([])
    expect(commandRegistration.ok && commandRegistration.value.disposed).toBe(true)
    expect(statusRegistration.ok && statusRegistration.value.disposed).toBe(true)
  })

  it('fences every retained capability facade after consumer unload without consuming gestures', () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['commands', 'status', 'notifications.publish', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'])
    const c = consumer()
    const opened = host.open(c, manifest(['commands', 'status', 'notifications.publish', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider']))
    const live = host.open(consumer(), { ...manifest(['notifications.publish', 'overlays']), id: '@acme/live' })
    expect(opened.ok && live.ok).toBe(true)
    if (!opened.ok || !live.ok) return

    const registrations = [
      opened.value.commands!.register(command('before-unload')),
      opened.value.status!.register({ id: 'before-unload', render: () => null }),
      opened.value.panes!.register({ id: 'before-unload', placement: 'right', render: () => null }),
      opened.value.overlays!.open({ id: 'before-unload', render: () => view }),
      opened.value.editorExtensions!.register({ id: 'before-unload' }),
      opened.value.statusProviders!.register({ id: 'before-unload', render: () => ({ kind: 'text', content: 'status' }) }),
      opened.value.editorProviders!.register({ id: 'before-unload', render: () => ({ kind: 'editor-control' }) }),
    ]
    const gesture = createBlueUserGesture(host, owner)
    expect(registrations.every(result => result.ok)).toBe(true)
    expect(gesture.ok).toBe(true)
    if (!gesture.ok) return

    c.dispose()
    c.dispose()
    expect(registrations.every(result => result.ok && result.value.disposed)).toBe(true)

    const rejected = [
      opened.value.commands!.register(command('after-unload')),
      opened.value.status!.register({ id: 'after-unload', render: () => null }),
      opened.value.panes!.register({ id: 'after-unload', placement: 'bottom', render: () => null }),
      opened.value.overlays!.open({ id: 'after-unload', capturing: true, render: () => view }, { userGesture: gesture.value }),
      opened.value.editorExtensions!.register({ id: 'after-unload' }),
      opened.value.statusProviders!.register({ id: 'after-unload', render: () => ({ kind: 'text', content: 'status' }) }),
      opened.value.editorProviders!.register({ id: 'after-unload', render: () => ({ kind: 'editor-control' }) }),
      opened.value.notifications!.publish({ id: 'after-unload', view }),
    ]
    for (const result of rejected) expect(result).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'plugin consumer is disposed' })

    const lists = [opened.value.commands!.list(), opened.value.status!.list(), opened.value.panes!.list(), opened.value.editorExtensions!.list(), opened.value.statusProviders!.list(), opened.value.editorProviders!.list()]
    for (const list of lists) { expect(list).toEqual([]); expect(Object.isFrozen(list)).toBe(true) }
    const snapshot = snapshotBluePluginHost(host)
    expect([snapshot.commands, snapshot.status, snapshot.panes, snapshot.overlays, snapshot.editorExtensions, snapshot.statusProviders, snapshot.editorProviders].every(entries => entries.length === 0)).toBe(true)

    expect(live.value.notifications!.publish({ id: 'live', view })).toEqual({ ok: true, value: undefined })

    const liveOverlay = live.value.overlays!.open({ id: 'live-after-dead', capturing: true, render: () => view }, { userGesture: gesture.value })
    expect(liveOverlay).toMatchObject({ ok: true })
    if (liveOverlay.ok) { liveOverlay.value.dispose(); liveOverlay.value.dispose() }
    owner.dispose()
  })

  it('rolls back registrations when owner admission synchronously unloads the consumer', () => {
    const scenarios: readonly {
      capability: 'commands' | 'status' | 'panes' | 'overlays'
      entries(snapshot: BluePluginHostSnapshot): readonly unknown[]
      mutate(api: BluePluginApi): BlueResult<unknown>
      list(api: BluePluginApi): readonly unknown[] | undefined
    }[] = [
      { capability: 'commands', entries: snapshot => snapshot.commands, mutate: api => api.commands!.register(command('reentrant')), list: api => api.commands!.list() },
      { capability: 'status', entries: snapshot => snapshot.status, mutate: api => api.status!.register({ id: 'reentrant', render: () => null }), list: api => api.status!.list() },
      { capability: 'panes', entries: snapshot => snapshot.panes, mutate: api => api.panes!.register({ id: 'reentrant', placement: 'left', render: () => null }), list: api => api.panes!.list() },
      { capability: 'overlays', entries: snapshot => snapshot.overlays, mutate: api => api.overlays!.open({ id: 'reentrant', render: () => view }), list: () => undefined },
    ]
    for (const scenario of scenarios) {
      const host = new BluePluginHostService(new Context())
      const owner = attach(host, [scenario.capability])
      const c = consumer()
      const opened = host.open(c, manifest([scenario.capability]))
      expect(opened.ok).toBe(true)
      if (!opened.ok) continue
      const observed = subscribeBluePluginHost(host, snapshot => { if (scenario.entries(snapshot).length > 0) c.dispose() })
      expect(scenario.mutate(opened.value)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      expect(scenario.entries(snapshotBluePluginHost(host))).toEqual([])
      const list = scenario.list(opened.value)
      if (list !== undefined) { expect(list).toEqual([]); expect(Object.isFrozen(list)).toBe(true) }
      observed.dispose()
      owner.dispose()
    }
  })

  it('prioritizes consumer unload when a synchronous admission observer also rejects', () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['commands'])
    const c = consumer()
    const opened = host.open(c, manifest(['commands']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const observed = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.commands.length > 0) { c.dispose(); throw new Error('owner rejected after unload') }
    })
    expect(opened.value.commands!.register(command('combined-rejection'))).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(snapshotBluePluginHost(host).commands).toEqual([])
    observed.dispose()
    owner.dispose()
  })

  it('keeps notification observation owner-only and exposes publish alone', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['notifications.publish'])
    const opened = host.open(consumer(), manifest(['notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const seen: BlueView[] = []
    const subscription = subscribeBluePluginNotifications(host, notification => seen.push(notification.view))
    expect(Object.keys(opened.value.notifications!)).toEqual(['publish'])
    expect(typeof opened.value.notifications!.publish).toBe('function')
    expect('subscribe' in opened.value.notifications!).toBe(false)
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: true, value: undefined })
    expect(seen).toEqual([view])
    expect(Object.isFrozen(seen[0])).toBe(true)
    subscription.dispose()
    expect(subscription.disposed).toBe(true)
  })

  it('enforces contribution and notification budgets at the host boundary', () => {
    let now = 0
    const host = new BluePluginHostService(new Context(), { now: () => now })
    attach(host, ['commands', 'status', 'notifications.publish'])
    const opened = host.open(consumer(), manifest(['commands', 'status', 'notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    for (let index = 0; index < 64; index += 1) {
      expect(opened.value.commands!.register(command(`command-${String(index)}`))).toMatchObject({ ok: true })
      expect(opened.value.status!.register({ id: `status-${String(index)}`, render: () => view })).toMatchObject({ ok: true })
    }
    expect(opened.value.commands!.register(command('command-overflow'))).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(opened.value.status!.register({ id: 'status-overflow', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    const tooLarge = { kind: 'text' as const, content: 'x'.repeat(32_769) }
    expect(opened.value.notifications!.publish({ id: 'too-large', view: tooLarge })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    for (let index = 0; index < 20; index += 1) {
      expect(opened.value.notifications!.publish({ id: `notice-${String(index)}`, view })).toMatchObject({ ok: true })
    }
    expect(opened.value.notifications!.publish({ id: 'notice-overflow', view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    now = 1_000
    expect(opened.value.notifications!.publish({ id: 'notice-after-window', view })).toMatchObject({ ok: true })
  })

  it('reserves notification quota before observer fan-out under reentrant publication', () => {
    const host = new BluePluginHostService(new Context(), { now: () => 0 })
    attach(host, ['notifications.publish'])
    const opened = host.open(consumer(), manifest(['notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const nested: BlueResult[] = []
    let delivered = 0
    const observer = subscribeBluePluginNotifications(host, () => {
      delivered += 1
      if (delivered <= 20) nested.push(opened.value.notifications!.publish({ id: `nested-${String(delivered)}`, view }))
    })

    expect(opened.value.notifications!.publish({ id: 'outer', view })).toEqual({ ok: true, value: undefined })
    expect(delivered).toBe(20)
    expect(nested).toHaveLength(20)
    expect(nested.filter(result => result.ok)).toHaveLength(19)
    expect(nested.some(result => !result.ok && result.code === 'BLUE_LIMIT_EXCEEDED')).toBe(true)
    expect(opened.value.notifications!.publish({ id: 'after-reentry', view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    observer.dispose()
  })

  it('bounds notification cloning before exact serialized-byte enforcement', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['notifications.publish'])
    const opened = host.open(consumer(), manifest(['notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const primitiveView: Record<PropertyKey, unknown> = { kind: 'text', content: 'ok', enabled: true, disabled: false, empty: null, count: 1 }
    primitiveView[Symbol('ignored')] = 'not cloned'
    expect(opened.value.notifications!.publish({
      id: 'primitive-shapes',
      view: primitiveView as never,
    })).toEqual({ ok: true, value: undefined })
    const disappearing = new Proxy({}, {
      ownKeys: () => ['kind'],
      getOwnPropertyDescriptor: () => undefined,
    })
    expect(opened.value.notifications!.publish({ id: 'disappearing-property', view: disappearing as never })).toEqual({ ok: true, value: undefined })

    const deep: unknown[] = []
    let cursor = deep
    for (let depth = 0; depth < 16_000; depth += 1) {
      const child: unknown[] = []
      cursor.push(child)
      cursor = child
    }
    const nodeHeavy = Array.from({ length: 4_095 }, () => [])
    const propertyHeavy: Record<string, unknown> = { kind: 'text' }
    for (let index = 0; index < 8_192; index += 1) propertyHeavy[String.fromCodePoint(0x1000 + index)] = ''
    const giantKey = { kind: 'text', ['k'.repeat(1_000_000)]: '' }
    const structural = [
      { id: 'too-deep', view: { kind: 'fields', rows: deep } },
      { id: 'too-many-nodes', view: { kind: 'fields', rows: nodeHeavy } },
      { id: 'too-many-properties', view: propertyHeavy },
      { id: 'too-long-array', view: { kind: 'fields', rows: Array.from({ length: 8_191 }, () => '') } },
      { id: 'too-many-number-bytes', view: { kind: 'fields', rows: Array.from({ length: 1_500 }, () => Number.MAX_VALUE) } },
      { id: 'too-many-boolean-bytes', view: { kind: 'fields', rows: Array.from({ length: 7_000 }, () => false) } },
      { id: 'too-many-ascii-bytes', view: { kind: 'text', content: 'x'.repeat(1_000_000) } },
      { id: 'too-many-cjk-bytes', view: { kind: 'text', content: '界'.repeat(11_000) } },
      { id: 'too-many-key-bytes', view: giantKey },
    ]
    for (const notification of structural) {
      expect(opened.value.notifications!.publish(notification as never)).toMatchObject({
        ok: false,
        code: 'BLUE_LIMIT_EXCEEDED',
        message: expect.stringContaining('structural limits'),
      })
    }

    expect(opened.value.notifications!.publish({ id: 'exact-json-bytes', view: { kind: 'text', content: '"'.repeat(20_000) } })).toEqual({
      ok: false,
      code: 'BLUE_LIMIT_EXCEEDED',
      message: 'notification view exceeds 32768 bytes',
    })
  })

  it('reserves pane quota before synchronous owner admission and rolls it back exactly', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['panes'])
    const opened = host.open(consumer(), manifest(['panes']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const nested: BlueResult<BluePaneRegistration>[] = []
    let next = 0
    const observer = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.panes.length === 0 || next >= 8) return
      const index = next++
      nested.push(opened.value.panes!.register({ id: `nested-${String(index)}`, placement: 'bottom', render: () => null }))
    })

    const outer = opened.value.panes!.register({ id: 'outer', placement: 'bottom', render: () => null })
    expect(outer).toMatchObject({ ok: true })
    expect(snapshotBluePluginHost(host).panes).toHaveLength(8)
    expect(nested.filter(result => result.ok)).toHaveLength(7)
    expect(nested.some(result => !result.ok && result.code === 'BLUE_LIMIT_EXCEEDED')).toBe(true)

    observer.dispose()
    if (outer.ok) outer.value.dispose()
    for (const result of nested) if (result.ok) result.value.dispose()
    expect(snapshotBluePluginHost(host).panes).toEqual([])

    const rejecting = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.panes.some(entry => entry.id === 'rejected')) throw new Error('pane rejected')
    })
    expect(opened.value.panes!.register({ id: 'rejected', placement: 'bottom', render: () => null })).toEqual({ ok: false, code: 'BLUE_DUPLICATE_ID', message: 'pane rejected' })
    rejecting.dispose()
    const retry = opened.value.panes!.register({ id: 'after-rejection', placement: 'bottom', render: () => null })
    expect(retry).toMatchObject({ ok: true })
    if (retry.ok) retry.value.dispose()
  })

  it('shares the rolling notification quota across legacy and canonical facades for one consumer', () => {
    const host = new BluePluginHostService(new Context(), { now: () => 0 })
    attach(host, ['notifications.publish'])
    const sharedConsumer = consumer()
    const legacy = host.open(sharedConsumer, { ...manifest(['notifications.publish']), id: '@acme/notice-legacy' })
    const canonical = host.open(sharedConsumer, canonicalManifest('@acme/notice-canonical', [{ name: 'notifications.publish', version: '^1.0.0' }]))
    expect(legacy.ok && canonical.ok).toBe(true)
    if (!legacy.ok || !canonical.ok) return
    for (let index = 0; index < 20; index += 1) {
      const api = index % 2 === 0 ? legacy.value : canonical.value
      expect(api.notifications!.publish({ id: `shared-${String(index)}`, view })).toMatchObject({ ok: true })
    }
    expect(legacy.value.notifications!.publish({ id: 'legacy-overflow', view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(canonical.value.notifications!.publish({ id: 'canonical-overflow', view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    sharedConsumer.dispose()
    const reopened = host.open(sharedConsumer, { ...manifest(['notifications.publish']), id: '@acme/notice-reopened' })
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.value.notifications!.publish({ id: 'after-cleanup', view })).toMatchObject({ ok: true })
  })

  it('silences stale owner subscriptions and never duplicates notifications after replacement attach', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['status', 'notifications.publish'])
    const publisher = host.open(consumer(), { ...manifest(['status', 'notifications.publish']), id: '@acme/stale-observer' })
    expect(publisher.ok).toBe(true)
    if (!publisher.ok) return
    const firstNotices: string[] = []
    let firstSnapshots = 0
    firstLease.observeNotifications(notification => firstNotices.push(notification.id))
    firstLease.subscribe(() => { firstSnapshots += 1 })
    expect(publisher.value.notifications!.publish({ id: 'before-replacement', view })).toMatchObject({ ok: true })

    const secondOwner = consumer()
    const secondLease = attachBluePluginHostCapabilities(host, secondOwner, ['status', 'notifications.publish'])
    const secondNotices: string[] = []
    let secondSnapshots = 0
    secondLease.observeNotifications(notification => secondNotices.push(notification.id))
    secondLease.subscribe(() => { secondSnapshots += 1 })
    const firstSnapshotsAfterReplacement = firstSnapshots
    expect(publisher.value.status!.register({ id: 'replacement-status', render: () => view })).toMatchObject({ ok: true })
    expect(publisher.value.notifications!.publish({ id: 'after-replacement', view })).toMatchObject({ ok: true })

    expect(firstLease.current('status')).toBe(false)
    expect(firstNotices).toEqual(['before-replacement'])
    expect(firstSnapshots).toBe(firstSnapshotsAfterReplacement)
    expect(secondNotices).toEqual(['after-replacement'])
    expect(secondSnapshots).toBe(2)
    firstOwner.dispose()
    secondOwner.dispose()
  })

  it('keeps the healthy owner when replacement effect registration fails or cleans up synchronously', async () => {
    const host = new BluePluginHostService(new Context())
    const currentOwner = consumer()
    const currentLease = attachBluePluginHostCapabilities(host, currentOwner, ['status', 'notifications.publish', 'overlays'])
    const plugin = consumer()
    const opened = host.open(plugin, { ...manifest(['status', 'notifications.publish', 'overlays']), id: '@acme/owner-transaction' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let snapshots = 0
    const notices: string[] = []
    currentLease.subscribe(() => { snapshots += 1 })
    currentLease.observeNotifications(notification => notices.push(notification.id))

    const failedOwner = {
      effect(callback: () => () => void): void {
        callback()
        throw new Error('replacement effect rejected')
      },
    }
    expect(() => attachBluePluginHostCapabilities(host, failedOwner, ['status'])).toThrow('replacement effect rejected')

    const cleanedOwner = {
      effect(callback: () => () => void): void { callback()() },
    }
    const inert = attachBluePluginHostCapabilities(host, cleanedOwner, ['status'])
    expect(inert.disposed).toBe(true)

    let nestedError: string | undefined
    const nestedOwner = consumer()
    const reentrantOwner = {
      effect(callback: () => () => void): void {
        try { attachBluePluginHostCapabilities(host, nestedOwner, ['status']) } catch (error) { nestedError = error instanceof Error ? error.message : undefined }
        callback()()
      },
    }
    expect(attachBluePluginHostCapabilities(host, reentrantOwner, ['status']).disposed).toBe(true)
    expect(nestedError).toBe('Blue owner capability attachment cannot be reentrant')
    expect(() => attachBluePluginHostCapabilities(host, consumer(), [])).toThrow('requires at least one capability')

    expect(currentLease.current('status')).toBe(true)
    expect(currentLease.current('notifications.publish')).toBe(true)
    expect(currentLease.current('overlays')).toBe(true)
    expect(opened.value.status!.register({ id: 'after-failed-handoff', render: () => view })).toMatchObject({ ok: true })
    expect(snapshots).toBe(2)
    expect(opened.value.notifications!.publish({ id: 'after-failed-handoff', view })).toEqual({ ok: true, value: undefined })
    expect(notices).toEqual(['after-failed-handoff'])
    const overlay = await currentLease.runUserGesture('overlays', gesture => opened.value.overlays!.open({ id: 'after-failed-handoff', capturing: true, render: () => view }, { userGesture: gesture }))
    expect(overlay).toMatchObject({ ok: true })
    currentOwner.dispose()
    plugin.dispose()
  })

  it('replaces an overlapping owner lease atomically and emits one final overlay removal snapshot', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['status', 'panes', 'overlays'])
    const plugin = consumer()
    const opened = host.open(plugin, { ...manifest(['status', 'panes', 'overlays']), id: '@acme/atomic-owner' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const overlayCounts: number[] = []
    let closeReentered = false
    let reopenedDuringDrain: BlueResult<BluePublicOverlayHandle> | undefined
    const firstSubscription = firstLease.subscribe(snapshot => {
      overlayCounts.push(snapshot.overlays.length)
      if (snapshot.overlays.length === 0 && overlayCounts.includes(1) && !closeReentered) {
        closeReentered = true
        reopenedDuringDrain = opened.value.overlays!.open({ id: 'late-transient', render: () => view })
        firstOwner.dispose()
      }
    })
    const overlay = opened.value.overlays!.open({ id: 'transient', render: () => view })
    expect(overlay).toMatchObject({ ok: true })

    const replacementOwner = consumer()
    const replacementLease = attachBluePluginHostCapabilities(host, replacementOwner, ['overlays'])
    expect(closeReentered).toBe(true)
    expect(reopenedDuringDrain).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(overlayCounts).toEqual([0, 1, 0])
    expect(firstSubscription.disposed).toBe(true)
    expect(firstLease.current('status')).toBe(false)
    expect(firstLease.current('panes')).toBe(false)
    expect(firstLease.current('overlays')).toBe(false)
    expect(firstLease.snapshot()).toMatchObject({ ok: false, code: 'BLUE_STALE' })
    expect(firstLease.subscribe(() => {}).disposed).toBe(true)
    expect(overlay.ok && overlay.value.closed).toBe(true)
    expect(replacementLease.current('overlays')).toBe(true)
    expect(replacementLease.snapshot()).toMatchObject({ ok: true, value: { overlays: [] } })
    expect(opened.value.status!.register({ id: 'owner-gap', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(opened.value.panes!.register({ id: 'owner-gap', placement: 'bottom', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    const statusPaneOwner = consumer()
    const statusPaneLease = attachBluePluginHostCapabilities(host, statusPaneOwner, ['status', 'panes'])
    let replacementSnapshots = 0
    statusPaneLease.subscribe(() => { replacementSnapshots += 1 })
    expect(opened.value.status!.register({ id: 'restored-status', render: () => view })).toMatchObject({ ok: true })
    expect(opened.value.panes!.register({ id: 'restored-pane', placement: 'bottom', render: () => null })).toMatchObject({ ok: true })
    expect(replacementSnapshots).toBe(3)
    expect(overlayCounts).toEqual([0, 1, 0])
    statusPaneOwner.dispose()
    replacementOwner.dispose()
    plugin.dispose()
  })

  it('uses stable listener snapshots for reentrant aggregate and ordered subscriptions', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['status'])
    const plugin = consumer()
    const opened = host.open(plugin, { ...manifest(['status']), id: '@acme/stable-fanout' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const replacementOwner = consumer()
    let replacementLease: ReturnType<typeof attachBluePluginHostCapabilities> | undefined
    let replacementSnapshots = 0
    firstLease.subscribe(snapshot => {
      if (replacementLease !== undefined || !snapshot.status.some(entry => entry.id === 'trigger')) return
      replacementLease = attachBluePluginHostCapabilities(host, replacementOwner, ['status'])
      replacementLease.subscribe(() => { replacementSnapshots += 1 })
    })
    expect(opened.value.status!.register({ id: 'trigger', render: () => view })).toMatchObject({ ok: true })
    expect(replacementSnapshots).toBe(1)
    expect(opened.value.status!.register({ id: 'after-trigger', render: () => view })).toMatchObject({ ok: true })
    expect(replacementSnapshots).toBe(2)

    const overlayOwner = consumer()
    attachBluePluginHostCapabilities(host, overlayOwner, ['overlays'])
    const overlayPlugin = consumer()
    const overlays = host.open(overlayPlugin, { ...manifest(['overlays']), id: '@acme/stable-ordered' })
    expect(overlays.ok).toBe(true)
    if (!overlays.ok) return
    let nested: ReturnType<typeof subscribeBluePluginHost> | undefined
    let orderedSnapshots = 0
    const outer = subscribeBluePluginHost(host, snapshot => {
      if (nested === undefined && snapshot.overlays.some(entry => entry.id === 'ordered-trigger')) {
        nested = subscribeBluePluginHost(host, () => { orderedSnapshots += 1 })
      }
    })
    expect(overlays.value.overlays!.open({ id: 'ordered-trigger', render: () => view })).toMatchObject({ ok: true })
    expect(orderedSnapshots).toBe(1)
    expect(overlays.value.overlays!.open({ id: 'ordered-next', render: () => view })).toMatchObject({ ok: true })
    expect(orderedSnapshots).toBe(2)
    nested?.dispose()
    outer.dispose()
    overlayOwner.dispose()
    replacementOwner.dispose()
    overlayPlugin.dispose()
    plugin.dispose()
  })

  it('does not deliver one notification to an observer attached during reentrant owner replacement', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['notifications.publish'])
    const plugin = consumer()
    const opened = host.open(plugin, { ...manifest(['notifications.publish']), id: '@acme/notice-handoff' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const firstNotices: string[] = []
    const replacementNotices: string[] = []
    const replacementOwner = consumer()
    let replacementLease: ReturnType<typeof attachBluePluginHostCapabilities> | undefined
    firstLease.observeNotifications(notification => {
      firstNotices.push(notification.id)
      if (replacementLease !== undefined) return
      replacementLease = attachBluePluginHostCapabilities(host, replacementOwner, ['notifications.publish'])
      replacementLease.observeNotifications(next => replacementNotices.push(next.id))
    })

    expect(opened.value.notifications!.publish({ id: 'handoff', view })).toEqual({ ok: true, value: undefined })
    expect(firstNotices).toEqual(['handoff'])
    expect(replacementNotices).toEqual([])
    expect(opened.value.notifications!.publish({ id: 'after-handoff', view })).toEqual({ ok: true, value: undefined })
    expect(firstNotices).toEqual(['handoff'])
    expect(replacementNotices).toEqual(['after-handoff'])
    replacementOwner.dispose()
    firstOwner.dispose()
    plugin.dispose()
  })

  it('fences subscriptions across replay and notification fan-out owner replacement', () => {
    const host = new BluePluginHostService(new Context())
    const plugin = consumer()
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['status', 'notifications.publish'])
    const opened = host.open(plugin, { ...manifest(['status', 'notifications.publish']), id: '@acme/subscription-races' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    const secondOwner = consumer()
    let secondLease: ReturnType<typeof attachBluePluginHostCapabilities> | undefined
    const racedSubscription = firstLease.subscribe(() => {
      secondLease ??= attachBluePluginHostCapabilities(host, secondOwner, ['status', 'notifications.publish'])
    })
    expect(racedSubscription.disposed).toBe(true)
    expect(firstLease.observeNotifications(() => {}).disposed).toBe(true)
    expect(secondLease?.current('notifications.publish')).toBe(true)

    const thirdOwner = consumer()
    let thirdLease: ReturnType<typeof attachBluePluginHostCapabilities> | undefined
    const aggregateHandoff = subscribeBluePluginHost(host, snapshot => {
      if (thirdLease === undefined && snapshot.status.some(entry => entry.id === 'replace-before-stale-snapshot')) {
        thirdLease = attachBluePluginHostCapabilities(host, thirdOwner, ['status', 'notifications.publish'])
      }
    })
    const staleSnapshots: BluePluginHostSnapshot[] = []
    secondLease!.subscribe(snapshot => staleSnapshots.push(snapshot))
    expect(opened.value.status!.register({ id: 'replace-before-stale-snapshot', render: () => view })).toMatchObject({ ok: true })
    expect(staleSnapshots).toHaveLength(1)
    expect(thirdLease?.current('notifications.publish')).toBe(true)
    aggregateHandoff.dispose()

    const fourthOwner = consumer()
    let fourthLease: ReturnType<typeof attachBluePluginHostCapabilities> | undefined
    const notificationHandoff = subscribeBluePluginNotifications(host, () => {
      fourthLease ??= attachBluePluginHostCapabilities(host, fourthOwner, ['status', 'notifications.publish'])
    })
    const staleNotices: string[] = []
    thirdLease!.observeNotifications(notification => staleNotices.push(notification.id))
    expect(opened.value.notifications!.publish({ id: 'replace-before-stale-observer', view })).toEqual({ ok: true, value: undefined })
    expect(staleNotices).toEqual([])
    expect(fourthLease?.current('notifications.publish')).toBe(true)

    notificationHandoff.dispose()
    fourthOwner.dispose()
    thirdOwner.dispose()
    secondOwner.dispose()
    firstOwner.dispose()
    plugin.dispose()
  })

  it('returns an inert replacement lease disposed during displaced-overlay drain', () => {
    const host = new BluePluginHostService(new Context())
    const plugin = consumer()
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['overlays'])
    const opened = host.open(plugin, { ...manifest(['overlays']), id: '@acme/replacement-drain' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let armed = false
    const replacementOwner = consumer()
    firstLease.subscribe(snapshot => {
      if (armed && snapshot.overlays.length === 0) replacementOwner.dispose()
    })
    expect(opened.value.overlays!.open({ id: 'drained-before-replacement', render: () => view })).toMatchObject({ ok: true })

    armed = true
    const inert = attachBluePluginHostCapabilities(host, replacementOwner, ['overlays'])
    expect(inert.disposed).toBe(true)
    expect(opened.value.overlays!.open({ id: 'owner-gap-after-drain', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    firstOwner.dispose()
    plugin.dispose()
  })

  it('rejects duplicate plugin identity across canonical and legacy lanes in both orders', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const canonicalOwner = consumer()
    expect(host.open(canonicalOwner, canonicalManifest('@acme/cross-lane'))).toMatchObject({ ok: true })
    expect(host.open(consumer(), { ...manifest(['notifications.publish']), id: '@acme/cross-lane' })).toEqual({
      ok: false,
      code: 'BLUE_DUPLICATE_ID',
      message: 'plugin identity "@acme/cross-lane" is already open',
    })
    canonicalOwner.dispose()

    const legacyOwner = consumer()
    expect(host.open(legacyOwner, { ...manifest([]), id: '@acme/cross-lane' })).toMatchObject({ ok: true })
    expect(host.open(consumer(), canonicalManifest('@acme/cross-lane', [{ name: 'notifications.publish', version: '^1.0.0' }]))).toEqual({
      ok: false,
      code: 'BLUE_DUPLICATE_ID',
      message: 'plugin identity "@acme/cross-lane" is already open',
    })
    legacyOwner.dispose()
  })

  it('shares command and status quotas across repeated opens by one consumer', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands', 'status'])
    const sharedConsumer = consumer()
    const first = host.open(sharedConsumer, manifest(['commands', 'status']))
    const second = host.open(sharedConsumer, { ...manifest(['commands', 'status']), id: '@acme/shared-second' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    for (let index = 0; index < 32; index += 1) {
      expect(first.value.commands!.register(command(`first-command-${String(index)}`))).toMatchObject({ ok: true })
      expect(first.value.status!.register({ id: `first-status-${String(index)}`, render: () => view })).toMatchObject({ ok: true })
      expect(second.value.commands!.register(command(`second-command-${String(index)}`))).toMatchObject({ ok: true })
      expect(second.value.status!.register({ id: `second-status-${String(index)}`, render: () => view })).toMatchObject({ ok: true })
    }
    for (const api of [first.value, second.value]) {
      expect(api.commands!.register(command('command-overflow'))).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
      expect(api.status!.register({ id: 'status-overflow', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    }

    const independentConsumer = consumer()
    const independent = host.open(independentConsumer, { ...manifest(['commands', 'status']), id: '@acme/independent' })
    expect(independent.ok).toBe(true)
    if (!independent.ok) return
    expect(independent.value.commands!.register(command('independent-command'))).toMatchObject({ ok: true })
    expect(independent.value.status!.register({ id: 'independent-status', render: () => view })).toMatchObject({ ok: true })

    sharedConsumer.dispose()
    expect(snapshotBluePluginHost(host).commands.map(entry => entry.id)).toEqual(['independent-command'])
    expect(snapshotBluePluginHost(host).status.map(entry => entry.id)).toEqual(['independent-status'])

    const reopened = host.open(sharedConsumer, manifest(['commands', 'status']))
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) return
    expect(reopened.value.commands!.register(command('reopened-command'))).toMatchObject({ ok: true })
    expect(reopened.value.status!.register({ id: 'reopened-status', render: () => view })).toMatchObject({ ok: true })
  })

  it('aggregates contributions globally, sorts them, and rejects cross-plugin duplicates', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const snapshots: string[][] = []
    const observed = subscribeBluePluginHost(host, snapshot => snapshots.push(snapshot.status.map(entry => entry.id)))
    const first = host.open(consumer(), manifest(['status']))
    const second = host.open(consumer(), { ...manifest(['status']), id: '@acme/other' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.value.status!.register({ id: 'later', priority: 20, render: () => view })).toMatchObject({ ok: true })
    expect(second.value.status!.register({ id: 'first', priority: 1, render: () => view })).toMatchObject({ ok: true })
    expect(second.value.status!.register({ id: 'later', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(snapshotBluePluginHost(host).status.map(entry => entry.id)).toEqual(['first', 'later'])
    expect(snapshots.at(-1)).toEqual(['first', 'later'])
    observed.dispose()
    expect(observed.disposed).toBe(true)
  })

  it('subscribes before initial replay and preserves reentrant snapshot revisions', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const opened = host.open(consumer(), manifest(['status']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const snapshots: { revision: number, ids: readonly string[] }[] = []
    let admitted = false
    const subscription = subscribeBluePluginHost(host, snapshot => {
      snapshots.push({ revision: snapshot.revision ?? 0, ids: snapshot.status.map(entry => entry.id) })
      if (!admitted) {
        admitted = true
        expect(opened.value.status!.register({ id: 'during-replay', render: () => view })).toMatchObject({ ok: true })
      }
    })

    expect(snapshots).toEqual([
      { revision: 0, ids: [] },
      { revision: 1, ids: ['during-replay'] },
    ])
    subscription.dispose()

    const replayError = new Error('initial replay failed')
    expect(() => subscribeBluePluginHost(host, () => { throw replayError })).toThrow(replayError)
    expect(opened.value.status!.register({ id: 'after-failed-replay', render: () => view })).toMatchObject({ ok: true })
  })

  it('rejects owner ids, malformed capability payloads, and adapter admission failures', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands', 'status'])
    const opened = host.open(consumer(), manifest(['commands', 'status']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.status!.register({ id: 'Blue Bad' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.status!.register({ id: 'blue.status.mode', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.status!.register({ id: 'status', priority: Number.NaN, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.status!.register({ id: 'status-high', priority: 101, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(opened.value.status!.register({ id: 'status' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.commands!.register({ id: 'Bad', label: '', execute: async () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.commands!.register({ id: 'run', label: ' ' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })

    const rejecting = subscribeBluePluginHost(host, (snapshot) => {
      if (snapshot.commands.some(entry => entry.id === 'taken')) throw new Error('command "taken" is already registered')
    })
    expect(opened.value.commands!.register(command('taken'))).toEqual({ ok: false, code: 'BLUE_DUPLICATE_ID', message: 'command "taken" is already registered' })
    expect(snapshotBluePluginHost(host).commands).toEqual([])
    rejecting.dispose()

    const rejectingValue = subscribeBluePluginHost(host, (snapshot) => {
      if (snapshot.commands.some(entry => entry.id === 'odd')) throw 'non-error rejection'
    })
    expect(opened.value.commands!.register(command('odd'))).toEqual({ ok: false, code: 'BLUE_DUPLICATE_ID', message: 'contribution "odd" was rejected' })
    rejectingValue.dispose()
  })

  it('validates owner notifications and contains notification adapter failures', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['notifications.publish'])
    const opened = host.open(consumer(), manifest(['notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.notifications!.publish({ id: 'Bad Notice', view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.notifications!.publish({ id: 'notice', view: null as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    const observed: string[] = []
    const observer = subscribeBluePluginNotifications(host, () => { throw new Error('notice observer failed') })
    const healthyObserver = subscribeBluePluginNotifications(host, notification => observed.push(notification.id))
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: true, value: undefined })
    expect(observed).toEqual(['notice'])
    observer.dispose()
    const valueObserver = subscribeBluePluginNotifications(host, () => { throw 'non-error rejection' })
    expect(opened.value.notifications!.publish({ id: 'notice-value', view })).toEqual({ ok: true, value: undefined })
    expect(observed).toEqual(['notice', 'notice-value'])
    valueObserver.dispose()
    healthyObserver.dispose()
    expect(opened.value.notifications!.publish({ id: 'notice-final', view })).toEqual({ ok: true, value: undefined })
  })

  it('clears all registries and listeners when the host service unloads', async () => {
    const ctx = new Context()
    const host = new BluePluginHostService(ctx)
    const bridge = attach(host)
    const sessionOwner = consumer()
    const sessionRegistration = attachBluePluginHostSessionReader(host, sessionOwner, sessionSource().reader)
    const c = consumer()
    const apiResult = host.open(c, manifest())
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    api.commands!.register(command('run'))
    api.status!.register({ id: 'status', render: () => view })
    await ctx.fiber.dispose()
    expect(api.commands!.list()).toEqual([])
    expect(api.status!.list()).toEqual([])
    expect(api.commands!.register(command('after-dispose'))).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(api.notifications!.publish({ id: 'after-dispose', view })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(() => snapshotBluePluginHost(host)).toThrow('requires the active host service itself')
    expect(host.open(consumer(), manifest([]))).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue plugin host is not active' })
    bridge.dispose()
    sessionOwner.dispose()
    expect(sessionRegistration.disposed).toBe(true)
  })

  it('tracks owner adapter readiness across unload and reload without dropping contributions', () => {
    const host = new BluePluginHostService(new Context())
    expect(host.open(consumer(), manifest(['status']))).toEqual({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
      message: 'capability "status" has no active Blue owner adapter',
    })
    expect(() => attachBluePluginHostCapabilities(host, consumer(), ['tools'] as never)).toThrow('unsupported capability "tools"')
    expect(host.open(consumer(), manifest(['status']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    const firstOwner = attach(host, ['status', 'notifications.publish'])
    const opened = host.open(consumer(), manifest(['status', 'notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.manifest.capabilities).toEqual(['status', 'notifications.publish'])
    expect(opened.value.status).toBeDefined()
    expect(opened.value.status!.register({ id: 'persistent', render: () => view })).toMatchObject({ ok: true })

    const secondOwner = attach(host, ['status'])
    firstOwner.dispose()
    expect(opened.value.status!.register({ id: 'while-second-owner-lives', render: () => view })).toMatchObject({ ok: true })
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    secondOwner.dispose()
    expect(opened.value.status!.register({ id: 'while-absent', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(snapshotBluePluginHost(host).status.map(entry => entry.id)).toEqual(['persistent', 'while-second-owner-lives'])

    attach(host, ['status'])
    expect(host.open(consumer(), { ...manifest(['status']), id: '@acme/reloaded-status' })).toMatchObject({ ok: true })
    expect(snapshotBluePluginHost(host).status.map(entry => entry.id)).toEqual(['persistent', 'while-second-owner-lives'])
  })

  it('projects every additive public capability exactly and keeps ownerless sessions absent', () => {
    const host = new BluePluginHostService(new Context())
    const capabilities = ['commands', 'status', 'notifications.publish', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'] as const
    attach(host, capabilities)
    const opened = host.open(consumer(), manifest(capabilities))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(Object.keys(opened.value).sort()).toEqual(['commands', 'editorExtensions', 'editorProviders', 'manifest', 'notifications', 'overlays', 'panes', 'status', 'statusProviders'])
    expect(opened.value.session).toBeUndefined()
    expect(host.open(consumer(), { ...manifest(['session.read']), id: '@acme/ownerless-session' })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(host.open(consumer(), { ...manifest([]), capabilities: ['session.act'] as never })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
  })

  it('exposes only the readonly session facade with frozen revisioned snapshots', () => {
    const host = new BluePluginHostService(new Context())
    const sourceValue = sessionValue()
    const source = sessionSource(sourceValue)
    const owner = consumer()
    const ownerRegistration = attachBluePluginHostSessionReader(host, owner, source.reader)
    const read = host.open(consumer(), manifest(['session.read']))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.value.session).toBeDefined()
    expect('request' in read.value.session!).toBe(false)

    const initial = read.value.session!.current()!
    expect(initial).toEqual(sourceValue)
    expect(initial).not.toBe(sourceValue)
    expect(Object.isFrozen(initial)).toBe(true)
    expect(Object.isFrozen(initial.model)).toBe(true)
    sourceValue.cwd = '/mutated'
    sourceValue.model!.id = 'mutated'
    expect(read.value.session!.current()).toMatchObject({ cwd: '/workspace', model: { id: 'model' } })

    const seen: Array<BlueSessionSnapshot | null> = []
    const subscription = read.value.session!.subscribe(snapshot => { seen.push(snapshot) })
    expect(seen.map(snapshot => snapshot?.revision ?? null)).toEqual([1])
    source.publish({ revision: 2, sessionEpoch: 1, id: 'session-one', cwd: '/next', status: 'running', mode: 'plan' })
    source.publish({ revision: 3, sessionEpoch: 1, id: 'session-one', cwd: '/next', status: 'running', mode: 'plan', model: { id: 'minimal' } })
    source.publish({ revision: 1, sessionEpoch: 1, id: 'session-one', cwd: '/stale', status: 'failed', mode: 'yolo' })
    source.publish({ revision: -1, sessionEpoch: 1, id: 'invalid', cwd: '/', status: 'idle', mode: 'normal' } as never)
    expect(seen.map(snapshot => snapshot?.revision ?? null)).toEqual([1, 2, 3])
    expect(seen[2]?.model).toEqual({ id: 'minimal' })
    expect(Object.isFrozen(seen[1])).toBe(true)
    expect(() => read.value.session!.subscribe(() => { throw new Error('initial replay failed') })).toThrow('initial replay failed')
    source.publish(null)
    source.publish(null)
    expect(seen.at(-1)).toBeNull()
    subscription.dispose()
    subscription.dispose()
    ownerRegistration.dispose()
    ownerRegistration.dispose()
  })

  it('keeps retained readonly session facades recoverable across an owner gap', () => {
    const host = new BluePluginHostService(new Context())
    const firstSource = sessionSource(sessionValue())
    const firstOwner = consumer()
    const firstRegistration = attachBluePluginHostSessionReader(host, firstOwner, firstSource.reader)
    const plugin = consumer()
    const opened = host.open(plugin, manifest(['session.read']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const seen: Array<string | null> = []
    opened.value.session!.subscribe(snapshot => seen.push(snapshot === null ? null : `${snapshot.id}:${snapshot.revision}`))
    const late = [...firstSource.listeners][0]!
    firstRegistration.dispose()
    late(sessionValue(2, 'late-session'))
    expect(opened.value.session!.current()).toBeNull()

    const secondSource = sessionSource(sessionValue(1, 'session-two'))
    const replayingReader = {
      current: secondSource.reader.current,
      subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void) {
        listener(sessionValue(2, 'session-two'))
        return secondSource.reader.subscribe(() => {})
      },
    }
    attachBluePluginHostSessionReader(host, consumer(), replayingReader)
    expect(opened.value.session!.current()?.id).toBe('session-two')
    expect(opened.value.session!.current()?.revision).toBe(2)
    expect(seen).toEqual(['session-one:1', null, 'session-two:2'])

    plugin.dispose()
    expect(opened.value.session!.current()).toBeNull()
    const inert = opened.value.session!.subscribe(() => { throw new Error('inert subscription ran') })
    expect(inert.disposed).toBe(true)
  })

  it('validates the unique session owner and its initial snapshot boundary', () => {
    const host = new BluePluginHostService(new Context())
    const valid = sessionSource()
    expect(() => attachBluePluginHostCapabilities(host, consumer(), ['session.read'])).toThrow('requires attachBluePluginHostSessionReader')
    expect(() => attachBluePluginHostSessionReader(host, consumer(), null as never)).toThrow('requires a reader')

    const invalidSnapshots = [
      { ...sessionValue(), revision: -1 },
      { ...sessionValue(), revision: 1.5 },
      { ...sessionValue(), id: '' },
      { ...sessionValue(), cwd: 1 },
      { ...sessionValue(), status: 'unknown' },
      { ...sessionValue(), mode: 'unknown' },
      { ...sessionValue(), model: null },
      { ...sessionValue(), model: { id: '' } },
      { ...sessionValue(), model: { id: 'm', provider: 1 } },
      { ...sessionValue(), model: { id: 'm', effort: 1 } },
    ]
    for (const snapshot of invalidSnapshots) {
      const source = sessionSource(snapshot as never)
      expect(() => attachBluePluginHostSessionReader(host, consumer(), source.reader)).toThrow()
    }
    const accessorSnapshot = Object.defineProperty({}, 'revision', { enumerable: true, get() { return 1 } })
    const accessorSource = sessionSource(accessorSnapshot as never)
    expect(() => attachBluePluginHostSessionReader(host, consumer(), accessorSource.reader)).toThrow('own data property')

    const activeOwner = consumer()
    const active = attachBluePluginHostSessionReader(host, activeOwner, valid.reader)
    expect(() => attachBluePluginHostSessionReader(host, consumer(), valid.reader)).toThrow('already has an active session owner')
    activeOwner.dispose()
    expect(active.disposed).toBe(true)

    const nullSource = sessionSource(null)
    const nullOwner = attachBluePluginHostSessionReader(host, consumer(), nullSource.reader)
    const opened = host.open(consumer(), manifest(['session.read']))
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.value.session!.current()).toBeNull()
      expect(opened.value.session!.subscribe(() => {}).disposed).toBe(false)
    }
    nullOwner.dispose()

    const throwingEffect = { effect(): never { throw new Error('effect failed') } }
    expect(() => attachBluePluginHostSessionReader(host, throwingEffect, valid.reader)).toThrow('effect failed')
    const throwingSubscribe = { current: () => sessionValue(), subscribe(): never { throw new Error('subscribe failed') } }
    expect(() => attachBluePluginHostSessionReader(host, consumer(), throwingSubscribe)).toThrow('subscribe failed')
  })

  it('admits panes with canonical state, limits, ordering, and lifecycle controls', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['panes'])
    const firstConsumer = consumer()
    const first = host.open(firstConsumer, manifest(['panes']))
    const second = host.open(consumer(), { ...manifest(['panes']), id: '@acme/other' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    const size = { min: 2, preferred: 4, max: 8 }
    const registered = first.value.panes!.register({ id: 'pane-b', priority: 20, title: 'Pane', placement: 'left', size, narrow: 'bottom', render: () => null, onEvent: async () => ({ ok: true, value: undefined }) })
    expect(registered.ok).toBe(true)
    if (!registered.ok) return
    size.min = 7
    expect(first.value.panes!.list()[0]!.size).toEqual({ min: 2, preferred: 4, max: 8 })
    expect(second.value.panes!.register({ id: 'pane-a', priority: 20, placement: 'right', render: () => null })).toMatchObject({ ok: true })
    expect(second.value.panes!.register({ id: 'pane-b', placement: 'right', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(snapshotBluePluginHost(host).panes.map(entry => entry.id)).toEqual(['pane-a', 'pane-b'])
    expect(snapshotBluePluginHost(host).panes.find(entry => entry.id === 'pane-b')?.revision).toBe(0)
    expect(registered.value.setHidden(true)).toEqual({ ok: true, value: undefined })
    expect(snapshotBluePluginHost(host).panes.find(entry => entry.id === 'pane-b')).toMatchObject({ hidden: true })
    expect(registered.value.setHidden(true)).toEqual({ ok: true, value: undefined })
    expect(registered.value.refresh()).toEqual({ ok: true, value: undefined })
    await Promise.resolve()
    expect(snapshotBluePluginHost(host).panes.find(entry => entry.id === 'pane-b')?.revision).toBe(1)
    expect(snapshotBluePluginHost(host).panes.find(entry => entry.id === 'pane-a')?.revision).toBe(0)

    expect(first.value.panes!.register({ id: 'bad-placement', placement: 'middle' as never, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(first.value.panes!.register({ id: 'bad-priority', priority: 101, placement: 'left', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(first.value.panes!.register({ id: 'bad-size', placement: 'left', size: { min: 5, preferred: 4, max: 8 }, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(first.value.panes!.register({ id: 'bad-narrow', placement: 'left', narrow: 'wide' as never, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(first.value.panes!.register({ id: 'bad-event', placement: 'left', render: () => null, onEvent: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    for (let index = 0; index < 7; index += 1) expect(first.value.panes!.register({ id: `extra-${index}`, placement: 'bottom', render: () => null })).toMatchObject({ ok: true })
    expect(first.value.panes!.register({ id: 'extra-limit', placement: 'bottom', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    const reopened = host.open(firstConsumer, { ...manifest(['panes']), id: '@acme/reopened-panes' })
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.value.panes!.register({ id: 'reopen-limit', placement: 'bottom', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    owner.dispose()
    expect(registered.value.refresh()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(registered.value.setHidden(false)).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    attach(host, ['panes'])
    expect(registered.value.setHidden(false)).toEqual({ ok: true, value: undefined })
    firstConsumer.dispose()
    expect(registered.value.disposed).toBe(true)
    expect(registered.value.setHidden(true)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(registered.value.refresh()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
  })

  it('reserves capturing-overlay quota before synchronous owner admission and rolls it back exactly', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    const lease = attachBluePluginHostCapabilities(host, owner, ['overlays'])
    const plugin = consumer()
    const opened = host.open(plugin, manifest(['overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let attempted = false
    let nested: BlueResult<BluePublicOverlayHandle> | undefined
    let nestedRun: Promise<void> | undefined
    const observer = lease.subscribe(snapshot => {
      if (snapshot.overlays.length === 0 || attempted) return
      attempted = true
      nestedRun = lease.runUserGesture('overlays', gesture => {
        nested = opened.value.overlays!.open({ id: 'nested', capturing: true, render: () => view }, { userGesture: gesture })
      })
    })

    const outer = await lease.runUserGesture('overlays', gesture => opened.value.overlays!.open({ id: 'outer', capturing: true, render: () => view }, { userGesture: gesture }))
    await nestedRun
    expect(outer).toMatchObject({ ok: true })
    expect(nested).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(snapshotBluePluginHost(host).overlays.map(entry => entry.id)).toEqual(['outer'])
    observer.dispose()
    if (outer.ok) outer.value.close()

    const rejecting = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.overlays.some(entry => entry.id === 'rejected')) throw new Error('overlay rejected')
    })
    const rejected = await lease.runUserGesture('overlays', gesture => opened.value.overlays!.open({ id: 'rejected', capturing: true, render: () => view }, { userGesture: gesture }))
    expect(rejected).toEqual({ ok: false, code: 'BLUE_DUPLICATE_ID', message: 'overlay rejected' })
    rejecting.dispose()
    const retry = await lease.runUserGesture('overlays', gesture => opened.value.overlays!.open({ id: 'after-rejection', capturing: true, render: () => view }, { userGesture: gesture }))
    expect(retry).toMatchObject({ ok: true })
    if (retry.ok) retry.value.close()

    const unloadingConsumer = consumer()
    const unloadManifest = { ...manifest(['overlays']), id: '@acme/unload-capturing' }
    const unloading = host.open(unloadingConsumer, unloadManifest)
    expect(unloading.ok).toBe(true)
    if (!unloading.ok) return
    const unloadObserver = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.overlays.some(entry => entry.id === 'unloading')) unloadingConsumer.dispose()
    })
    const unloaded = await lease.runUserGesture('overlays', gesture => unloading.value.overlays!.open({ id: 'unloading', capturing: true, render: () => view }, { userGesture: gesture }))
    expect(unloaded).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    unloadObserver.dispose()
    expect(snapshotBluePluginHost(host).overlays).toEqual([])

    const reopened = host.open(unloadingConsumer, unloadManifest)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      const afterUnload = await lease.runUserGesture('overlays', gesture => reopened.value.overlays!.open({ id: 'after-unload', capturing: true, render: () => view }, { userGesture: gesture }))
      expect(afterUnload).toMatchObject({ ok: true })
      if (afterUnload.ok) afterUnload.value.close()
    }
    owner.dispose()
    plugin.dispose()
    unloadingConsumer.dispose()
  })

  it('normalizes overlay requests and enforces gesture, stack, and close semantics', () => {
    const host = new BluePluginHostService(new Context())
    const overlayOwner = attach(host, ['overlays'])
    const firstConsumer = consumer()
    const first = host.open(firstConsumer, manifest(['overlays']))
    const second = host.open(consumer(), { ...manifest(['overlays']), id: '@acme/other' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    const plain = first.value.overlays!.open({ id: 'plain', width: '50%', minWidth: 1, maxHeight: '90%', anchor: 'bottom', render: () => view })
    expect(plain.ok).toBe(true)
    expect(snapshotBluePluginHost(host).overlays[0]).toMatchObject({ id: 'plain', order: 0, request: { capturing: false, dismissible: true } })
    expect(first.value.overlays!.open({ id: 'forged', capturing: true, render: () => view }, { userGesture: {} as BlueUserGesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    const gesture = createBlueUserGesture(host, overlayOwner)
    expect(gesture.ok).toBe(true)
    if (!gesture.ok) return
    const capturing = first.value.overlays!.open({ id: 'modal', capturing: true, dismissible: false, render: () => view }, { userGesture: gesture.value })
    expect(capturing.ok).toBe(true)
    if (!capturing.ok) return
    const secondGesture = createBlueUserGesture(host, overlayOwner)
    expect(secondGesture.ok).toBe(true)
    const reopened = host.open(firstConsumer, { ...manifest(['overlays']), id: '@acme/reopened-overlays' })
    expect(reopened.ok).toBe(true)
    expect(reopened.ok && reopened.value.overlays!.open({ id: 'modal-2', capturing: true, render: () => view }, { userGesture: secondGesture.ok ? secondGesture.value : undefined })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    const otherGesture = createBlueUserGesture(host, overlayOwner)
    expect(otherGesture.ok).toBe(true)
    const otherCapturing = second.value.overlays!.open({ id: 'other-modal', capturing: true, render: () => view }, { userGesture: otherGesture.ok ? otherGesture.value : undefined })
    expect(otherCapturing).toMatchObject({ ok: true })
    if (otherCapturing.ok) otherCapturing.value.close()
    expect(second.value.overlays!.open({ id: 'plain', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(second.value.overlays!.open({ id: 'third', render: () => view })).toMatchObject({ ok: true })
    expect(second.value.overlays!.open({ id: 'fourth', render: () => view })).toMatchObject({ ok: true })
    expect(second.value.overlays!.open({ id: 'fifth', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(snapshotBluePluginHost(host).overlays.map(entry => entry.id)).toEqual(['plain', 'modal', 'third', 'fourth'])

    capturing.value.close()
    capturing.value.close()
    expect(capturing.value.closed).toBe(true)
    expect(capturing.value.disposed).toBe(true)
    expect(capturing.value.refresh()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(first.value.overlays!.open({ id: 'replay', capturing: true, render: () => view }, { userGesture: gesture.value })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(first.value.overlays!.open({ id: 'failed-replay', capturing: true, render: () => view }, { userGesture: secondGesture.ok ? secondGesture.value : undefined })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(first.value.overlays!.open({ id: 'bad-anchor', anchor: 'corner' as never, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(first.value.overlays!.open({ id: 'bad-width', width: '0%', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })

    const pending = plain.ok ? plain.value : undefined
    overlayOwner.dispose()
    // A facade crossing the live owner gap reports capability absence. The
    // pre-existing transient handle was actively closed by owner revocation,
    // so operations on that disposed identity are rejected instead.
    expect(first.value.overlays!.open({ id: 'owner-gap', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(pending?.refresh()).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    pending?.close()
    expect(snapshotBluePluginHost(host).overlays.map(entry => entry.id)).not.toContain('plain')
    expect(createBlueUserGesture(host, overlayOwner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    firstConsumer.dispose()
  })

  it('fences semantic close by owner generation and entry identity', () => {
    const host = new BluePluginHostService(new Context())
    const firstOwner = consumer()
    const firstLease = attachBluePluginHostCapabilities(host, firstOwner, ['overlays'])
    const opened = host.open(consumer(), { ...manifest(['overlays']), id: '@acme/semantic-close' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const first = opened.value.overlays!.open({ id: 'same-id', render: () => view })
    expect(first.ok).toBe(true)
    const firstEntry = snapshotBluePluginHost(host).overlays[0]
    expect(firstEntry).toBeDefined()
    if (firstEntry === undefined) return

    const secondOwner = consumer()
    const secondLease = attachBluePluginHostCapabilities(host, secondOwner, ['overlays'])
    expect(first.ok && first.value.closed).toBe(true)
    expect(snapshotBluePluginHost(host).overlays).toEqual([])
    const second = opened.value.overlays!.open({ id: 'same-id', render: () => view })
    expect(second.ok).toBe(true)
    const secondEntry = snapshotBluePluginHost(host).overlays[0]
    expect(secondEntry).toBeDefined()
    if (secondEntry === undefined) return

    expect(firstLease.closeOverlay(secondEntry)).toMatchObject({ ok: false, code: 'BLUE_STALE' })
    expect(secondLease.closeOverlay(firstEntry)).toMatchObject({ ok: false, code: 'BLUE_STALE' })
    expect(second.ok && second.value.closed).toBe(false)
    expect(snapshotBluePluginHost(host).overlays).toEqual([secondEntry])
    expect(secondLease.closeOverlay(secondEntry)).toEqual({ ok: true, value: undefined })
    firstOwner.dispose()
    secondOwner.dispose()
  })

  it('isolates coalesced overlay refresh revisions', async () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['overlays'])
    const opened = host.open(consumer(), manifest(['overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const first = opened.value.overlays!.open({ id: 'first', render: () => view })
    const second = opened.value.overlays!.open({ id: 'second', render: () => view })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(snapshotBluePluginHost(host).overlays.map(entry => [entry.id, entry.revision])).toEqual([
      ['first', 0],
      ['second', 0],
    ])

    expect(first.value.refresh()).toEqual({ ok: true, value: undefined })
    expect(first.value.refresh()).toEqual({ ok: true, value: undefined })
    await Promise.resolve()
    expect(snapshotBluePluginHost(host).overlays.map(entry => [entry.id, entry.revision])).toEqual([
      ['first', 1],
      ['second', 0],
    ])
  })

  it('scopes user gestures across async dispatch, abort, and host teardown', async () => {
    const root = new Context()
    const host = new BluePluginHostService(root)
    const commandOwner = attach(host, ['commands'])
    const overlayOwner = attach(host, ['overlays'])
    const opened = host.open(consumer(), manifest(['overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    await expect(runBlueUserGesture(host, consumer(), () => undefined)).rejects.toThrow('only an active user-dispatch owner may mint user gestures')
    const statusOnlyOwner = attach(host, ['status'])
    await expect(runBlueUserGesture(host, statusOnlyOwner, () => undefined)).rejects.toThrow('only an active user-dispatch owner may mint user gestures')

    let retained: BlueUserGesture | undefined
    await runBlueUserGesture(host, commandOwner, async gesture => {
      retained = gesture
      await Promise.resolve()
      expect(opened.value.overlays!.open({ id: 'async', capturing: true, render: () => view }, { userGesture: gesture })).toMatchObject({ ok: true })
    })
    expect(opened.value.overlays!.open({ id: 'late', capturing: true, render: () => view }, { userGesture: retained })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    const abort = new AbortController()
    let abortedGesture: BlueUserGesture | undefined
    let release!: () => void
    const pending = runBlueUserGesture(host, commandOwner, async gesture => {
      abortedGesture = gesture
      await new Promise<void>(resolve => { release = resolve })
      return 'settled'
    }, abort.signal)
    await Promise.resolve()
    abort.abort()
    expect(opened.value.overlays!.open({ id: 'aborted', capturing: true, render: () => view }, { userGesture: abortedGesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    release()
    await expect(pending).resolves.toBe('settled')

    const preAborted = new AbortController()
    preAborted.abort()
    let preAbortedCalled = false
    await expect(runBlueUserGesture(host, commandOwner, () => {
      preAbortedCalled = true
    }, preAborted.signal)).rejects.toThrow('Blue user dispatch was aborted')
    expect(preAbortedCalled).toBe(false)

    const unloadOwner = attach(host, ['commands'])
    let finish!: () => void
    const duringOwnerUnload = runBlueUserGesture(host, unloadOwner, async gesture => {
      retained = gesture
      return new Promise<void>(resolve => { finish = resolve })
    })
    await Promise.resolve()
    unloadOwner.dispose()
    expect(opened.value.overlays!.open({ id: 'owner-unloaded', capturing: true, render: () => view }, { userGesture: retained })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    finish()
    await expect(duringOwnerUnload).resolves.toBeUndefined()

    const rejectingOwner = attach(host, ['commands'])
    let reject!: (error: Error) => void
    const original = new Error('original rejection')
    const duringOwnerReject = runBlueUserGesture(host, rejectingOwner, async () => new Promise<void>((_resolve, reject_) => { reject = reject_ }))
    await Promise.resolve()
    rejectingOwner.dispose()
    reject(original)
    await expect(duringOwnerReject).rejects.toBe(original)

    const hostTeardownOwner = attach(host, ['commands'])
    let finishHost!: () => void
    const duringDispose = runBlueUserGesture(host, hostTeardownOwner, async () => new Promise<void>(resolve => { finishHost = resolve }))
    await Promise.resolve()
    await root.fiber.dispose()
    finishHost()
    await expect(duringDispose).resolves.toBeUndefined()
    overlayOwner.dispose()
  })

  it('honors only active owner close requests during and after overlay admission', () => {
    const root = new Context()
    const host = new BluePluginHostService(root)
    const owner = attach(host, ['overlays'])
    const opened = host.open(consumer(), manifest(['overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const closeResults: BlueResult[] = []
    const subscription = subscribeBluePluginHost(host, snapshot => {
      const entry = snapshot.overlays.at(-1)
      if (entry !== undefined) closeResults.push(closeBluePluginHostOverlay(host, owner, entry))
    })
    const result = opened.value.overlays!.open({ id: 'close-during-open', render: () => view })
    expect(result).toMatchObject({ ok: true, value: { closed: true } })
    expect(closeResults).toEqual([{ ok: true, value: undefined }])
    expect(snapshotBluePluginHost(host).overlays).toEqual([])
    subscription.dispose()

    const afterAdmission = opened.value.overlays!.open({ id: 'close-after-open', render: () => view })
    expect(afterAdmission).toMatchObject({ ok: true, value: { closed: false } })
    const entry = snapshotBluePluginHost(host).overlays[0]!
    expect('close' in entry).toBe(false)
    expect(closeBluePluginHostOverlay(host, consumer(), entry)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(closeBluePluginHostOverlay(root.bluePluginHost, owner, entry)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(closeBluePluginHostOverlay(host, owner, entry)).toEqual({ ok: true, value: undefined })
    expect(afterAdmission).toMatchObject({ ok: true, value: { closed: true } })
    expect(snapshotBluePluginHost(host).overlays).toEqual([])
    expect(closeBluePluginHostOverlay(host, owner, entry)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    const duringOwnerGap = opened.value.overlays!.open({ id: 'owner-gap', render: () => view })
    expect(duringOwnerGap).toMatchObject({ ok: true })
    const ownerGapEntry = snapshotBluePluginHost(host).overlays[0]!
    owner.dispose()
    expect(closeBluePluginHostOverlay(host, owner, ownerGapEntry)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    if (duringOwnerGap.ok) duringOwnerGap.value.close()
  })

  it('keeps editor and provider candidates inert and globally unique', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['editor.extensions', 'status.provider', 'editor.provider'])
    const first = host.open(consumer(), manifest(['editor.extensions', 'status.provider', 'editor.provider']))
    const second = host.open(consumer(), { ...manifest(['editor.extensions', 'status.provider', 'editor.provider']), id: '@acme/other' })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    let invoked = 0
    const before = { kind: 'text' as const, content: 'before' }
    const diagnostics = [{ id: 'd', message: 'message' }]
    const actions = [{ id: 'act', label: 'Act' }]
    const onEvent = () => { invoked += 1; return { ok: true as const, value: undefined } }
    const complete = () => { invoked += 1; return { ok: true as const, value: [] } }
    const completeV2 = () => { invoked += 1; return { ok: true as const, value: [] } }
    const transformSubmit = (request: { readonly text: string }) => { invoked += 1; return { ok: true as const, value: { text: request.text } } }
    const extension = first.value.editorExtensions!.register({ id: 'extension', before, diagnostics, actions, onEvent, complete, completeV2, transformSubmit })
    const statusCandidate = first.value.statusProviders!.register({ id: 'status-provider', render: () => { invoked += 1; return { kind: 'text', content: 'status' } } })
    const editor: BlueEditorProvider = { id: 'editor-provider', render: () => { invoked += 1; return { kind: 'editor-control' } }, onEvent: () => { invoked += 1; return { ok: true, value: undefined } } }
    const editorCandidate = first.value.editorProviders!.register(editor)
    expect(extension.ok && statusCandidate.ok && editorCandidate.ok).toBe(true)
    expect(invoked).toBe(0)
    before.content = 'changed'
    diagnostics[0]!.message = 'changed'
    actions[0]!.label = 'Changed'
    const storedExtension = first.value.editorExtensions!.list()[0]!
    expect(storedExtension.before).toEqual({ kind: 'text', content: 'before' })
    expect(storedExtension.diagnostics).toEqual([{ id: 'd', message: 'message' }])
    expect(storedExtension.actions).toEqual([{ id: 'act', label: 'Act' }])
    expect(Object.isFrozen(storedExtension)).toBe(true)
    expect(Object.isFrozen(storedExtension.before)).toBe(true)
    expect(Object.isFrozen(storedExtension.diagnostics)).toBe(true)
    expect(Object.isFrozen(storedExtension.diagnostics![0])).toBe(true)
    expect(Object.isFrozen(storedExtension.actions)).toBe(true)
    expect(Object.isFrozen(storedExtension.actions![0])).toBe(true)
    expect(storedExtension.onEvent).toBe(onEvent)
    expect(storedExtension.complete).toBe(complete)
    expect(storedExtension.completeV2).toBe(completeV2)
    expect(storedExtension.transformSubmit).toBe(transformSubmit)
    expect(snapshotBluePluginHost(host)).toMatchObject({ editorExtensions: [{ id: 'extension' }], statusProviders: [{ id: 'status-provider' }], editorProviders: [{ id: 'editor-provider' }] })
    expect(second.value.editorProviders!.register(editor)).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(second.value.statusProviders!.register({ id: 'blue.status', render: () => ({ kind: 'text', content: '' }) })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(second.value.editorProviders!.register({ id: 'bad', render: 1 } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(second.value.editorExtensions!.register({ id: 'bad-extension', diagnostics: {} as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(second.value.editorExtensions!.register({ id: 'bad-event', onEvent: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(second.value.editorExtensions!.register({ id: 'bad-complete-v2', completeV2: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
  })

  it('admits only recursively passive editor extension nodes', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['editor.extensions'])
    const opened = host.open(consumer(), manifest(['editor.extensions']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const registry = opened.value.editorExtensions!
    const leaves: readonly BlueView[] = [
      { kind: 'text', content: 'text' },
      { kind: 'fields', rows: [] },
      { kind: 'code', code: 'code' },
      { kind: 'diff', before: 'before', after: 'after' },
      { kind: 'sections', sections: [{ body: { kind: 'text', content: 'body' } }] },
    ]
    for (const [index, node] of leaves.entries()) expect(registry.register({ id: `passive-view-${index}`, before: node })).toMatchObject({ ok: true })
    for (const [index, node] of ([
      { kind: 'rich-text', spans: [] },
      { kind: 'progress', value: 1, max: 1 },
      { kind: 'spacer' },
      { kind: 'divider' },
    ] as const).entries()) expect(registry.register({ id: `passive-node-${index}`, before: node })).toMatchObject({ ok: true })
    expect(registry.register({ id: 'passive-stack', before: { kind: 'stack', direction: 'column', children: [{ node: { kind: 'text', content: 'child' } }] } })).toMatchObject({ ok: true })
    expect(registry.register({ id: 'passive-surface', before: { kind: 'surface', child: { kind: 'text', content: 'child' }, footer: { kind: 'divider' } } })).toMatchObject({ ok: true })
    expect(registry.register({ id: 'interactive-root', before: { kind: 'actions', id: 'action', items: [] } })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'editor extension before must be a passive UI node' })
    expect(registry.register({ id: 'interactive-nested', after: { kind: 'stack', direction: 'column', children: [{ node: { kind: 'list', id: 'list', selectedIds: [], items: [] } }] } })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'editor extension after must be a passive UI node' })
    for (const [index, node] of ([
      { kind: 'stack' },
      { kind: 'stack', children: [null] },
      { kind: 'stack', children: [{}] },
      { kind: 'surface' },
      { kind: 'surface', child: { kind: 'text', content: '' }, footer: { kind: 'form' } },
      { kind: 'sections' },
      { kind: 'sections', sections: [null] },
      { kind: 'sections', sections: [{}] },
    ] as const).entries()) expect(registry.register({ id: `malformed-passive-${index}`, before: node as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
  })

  it('fences editor extensions independently and grants their dispatch owner gestures', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['editor.extensions'])
    const overlayOwner = attach(host, ['overlays'])
    attach(host, ['commands', 'status', 'status.provider', 'editor.provider'])
    const opened = host.open(consumer(), manifest(['editor.extensions', 'overlays', 'commands', 'status', 'status.provider', 'editor.provider']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const initial = snapshotBluePluginHost(host)
    let consumedGesture: BlueUserGesture | undefined
    await runBlueUserGesture(host, owner, gesture => {
      consumedGesture = gesture
      expect(opened.value.overlays!.open({ id: 'extension-action', capturing: true, render: () => view }, { userGesture: gesture })).toMatchObject({ ok: true })
    })
    expect(opened.value.overlays!.open({ id: 'extension-action-reuse', capturing: true, render: () => view }, { userGesture: consumedGesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    const commandRegistration = opened.value.commands!.register(command('unrelated-command'))
    const statusRegistration = opened.value.status!.register({ id: 'unrelated-status', render: () => ({ kind: 'text', content: 'status' }) })
    const statusProviderRegistration = opened.value.statusProviders!.register({ id: 'unrelated-status-provider', render: () => ({ kind: 'text', content: 'provider' }) })
    const editorProviderRegistration = opened.value.editorProviders!.register({ id: 'unrelated-editor-provider', render: () => ({ kind: 'editor-control' }) })
    expect(commandRegistration.ok && statusRegistration.ok && statusProviderRegistration.ok && editorProviderRegistration.ok).toBe(true)
    expect(snapshotBluePluginHost(host).editorExtensionsRevision).toBe(initial.editorExtensionsRevision)

    const rejecting = subscribeBluePluginHost(host, snapshot => {
      if (snapshot.editorExtensions.some(entry => entry.id === 'rejected-extension')) throw new Error('reject extension')
    })
    expect(opened.value.editorExtensions!.register({ id: 'rejected-extension' })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    rejecting.dispose()
    const afterRollback = snapshotBluePluginHost(host)
    expect(afterRollback.editorExtensions).toEqual([])
    expect(afterRollback.editorExtensionsRevision).toBe((initial.editorExtensionsRevision ?? 0) + 2)

    const extension = opened.value.editorExtensions!.register({ id: 'extension' })
    expect(extension.ok).toBe(true)
    expect(snapshotBluePluginHost(host).editorExtensionsRevision).toBe((afterRollback.editorExtensionsRevision ?? 0) + 1)
    if (!extension.ok) return
    expect(extension.value.refresh()).toMatchObject({ ok: true })
    await Promise.resolve()
    const refreshed = snapshotBluePluginHost(host)
    expect(refreshed.editorExtensionsRevision).toBe((afterRollback.editorExtensionsRevision ?? 0) + 2)
    extension.value.dispose()
    expect(snapshotBluePluginHost(host).editorExtensionsRevision).toBe((refreshed.editorExtensionsRevision ?? 0) + 1)

    const pendingGesture = createBlueUserGesture(host, owner)
    expect(pendingGesture).toMatchObject({ ok: true })
    owner.dispose()
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    if (pendingGesture.ok) expect(opened.value.overlays!.open({ id: 'extension-action-after-unload', capturing: true, render: () => view }, { userGesture: pendingGesture.value })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    overlayOwner.dispose()
  })

  it('fences status entries and provider candidates independently', async () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status', 'status.provider', 'commands'])
    const opened = host.open(consumer(), manifest(['status', 'status.provider', 'commands']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const initial = snapshotBluePluginHost(host)
    const commandRegistration = opened.value.commands!.register(command('command'))
    expect(commandRegistration.ok).toBe(true)
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: initial.statusRevision, statusProvidersRevision: initial.statusProvidersRevision })
    const status = opened.value.status!.register({ id: 'entry', render: () => ({ kind: 'text', content: 'entry' }) })
    expect(status.ok).toBe(true)
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: (initial.statusRevision ?? 0) + 1, statusProvidersRevision: initial.statusProvidersRevision })
    const provider = opened.value.statusProviders!.register({ id: 'provider', render: () => ({ kind: 'text', content: 'provider' }) })
    expect(provider.ok).toBe(true)
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: (initial.statusRevision ?? 0) + 1, statusProvidersRevision: (initial.statusProvidersRevision ?? 0) + 1 })
    if (!status.ok || !provider.ok || !commandRegistration.ok) return
    expect(status.value.refresh()).toMatchObject({ ok: true })
    expect(provider.value.refresh()).toMatchObject({ ok: true })
    await Promise.resolve()
    const refreshed = snapshotBluePluginHost(host)
    expect(refreshed).toMatchObject({ statusRevision: (initial.statusRevision ?? 0) + 2, statusProvidersRevision: (initial.statusProvidersRevision ?? 0) + 2 })
    commandRegistration.value.dispose()
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: refreshed.statusRevision, statusProvidersRevision: refreshed.statusProvidersRevision })
    status.value.dispose()
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: (refreshed.statusRevision ?? 0) + 1, statusProvidersRevision: refreshed.statusProvidersRevision })
    provider.value.dispose()
    expect(snapshotBluePluginHost(host)).toMatchObject({ statusRevision: (refreshed.statusRevision ?? 0) + 1, statusProvidersRevision: (refreshed.statusProvidersRevision ?? 0) + 1 })
  })

  it('fences editor providers independently and grants their event owner gestures', async () => {
    const host = new BluePluginHostService(new Context())
    const providerOwner = attach(host, ['editor.provider'])
    const overlayOwner = attach(host, ['overlays'])
    attach(host, ['commands', 'status.provider', 'editor.extensions'])
    const opened = host.open(consumer(), manifest(['editor.provider', 'overlays', 'commands', 'status.provider', 'editor.extensions']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const initial = snapshotBluePluginHost(host)
    const commandRegistration = opened.value.commands!.register(command('unrelated-command'))
    const statusProviderRegistration = opened.value.statusProviders!.register({ id: 'unrelated-status-provider', render: () => ({ kind: 'text', content: 'status' }) })
    const extensionRegistration = opened.value.editorExtensions!.register({ id: 'unrelated-extension' })
    expect(commandRegistration.ok && statusProviderRegistration.ok && extensionRegistration.ok).toBe(true)
    expect(snapshotBluePluginHost(host).editorProvidersRevision).toBe(initial.editorProvidersRevision)

    const render = () => ({ kind: 'editor-control' as const })
    const onEvent = () => ({ ok: true as const, value: undefined })
    const provider = opened.value.editorProviders!.register({ id: 'provider', render, onEvent })
    expect(provider.ok).toBe(true)
    const admitted = opened.value.editorProviders!.list()[0]!
    expect(admitted).toMatchObject({ id: 'provider', render, onEvent })
    expect(Object.isFrozen(admitted)).toBe(true)
    expect(snapshotBluePluginHost(host).editorProvidersRevision).toBe((initial.editorProvidersRevision ?? 0) + 1)
    if (!provider.ok) return
    expect(provider.value.refresh()).toMatchObject({ ok: true })
    await Promise.resolve()
    const refreshed = snapshotBluePluginHost(host)
    expect(refreshed.editorProvidersRevision).toBe((initial.editorProvidersRevision ?? 0) + 2)

    let gesture: BlueUserGesture | undefined
    await runBlueUserGesture(host, providerOwner, value => {
      gesture = value
      expect(opened.value.overlays!.open({ id: 'provider-action', capturing: true, render: () => view }, { userGesture: value })).toMatchObject({ ok: true })
    })
    expect(opened.value.overlays!.open({ id: 'provider-action-reuse', capturing: true, render: () => view }, { userGesture: gesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    provider.value.dispose()
    const afterDispose = snapshotBluePluginHost(host).editorProvidersRevision
    expect(afterDispose).toBe((refreshed.editorProvidersRevision ?? 0) + 1)
    const accessor = Object.defineProperty({ id: 'accessor-provider' }, 'render', { enumerable: true, get: () => render })
    expect(opened.value.editorProviders!.register(accessor as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'render must be an own data property' })
    expect(snapshotBluePluginHost(host).editorProvidersRevision).toBe(afterDispose)
    const pending = createBlueUserGesture(host, providerOwner)
    expect(pending).toMatchObject({ ok: true })
    providerOwner.dispose()
    expect(createBlueUserGesture(host, providerOwner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    if (pending.ok) expect(opened.value.overlays!.open({ id: 'provider-action-after-unload', capturing: true, render: () => view }, { userGesture: pending.value })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    overlayOwner.dispose()
  })

  it('coalesces refreshes, enforces rolling quota, and cancels pending ticks', async () => {
    let now = 10
    const host = new BluePluginHostService(new Context(), { now: () => now })
    const owner = attach(host, ['status'])
    let notifications = 0
    subscribeBluePluginHost(host, () => { notifications += 1 })
    const opened = host.open(consumer(), manifest(['status']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const registered = opened.value.status!.register({ id: 'quota', render: () => null })
    expect(registered.ok).toBe(true)
    if (!registered.ok) return
    const afterAdmission = notifications
    for (let count = 0; count < 20; count += 1) expect(registered.value.refresh()).toEqual({ ok: true, value: undefined })
    expect(registered.value.refresh()).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(notifications).toBe(afterAdmission)
    await Promise.resolve()
    expect(notifications).toBe(afterAdmission + 1)
    now += 1_000
    expect(registered.value.refresh()).toEqual({ ok: true, value: undefined })
    owner.dispose()
    expect(registered.value.refresh()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    attach(host, ['status'])
    registered.value.dispose()
    registered.value.dispose()
    const afterDispose = notifications
    await Promise.resolve()
    expect(notifications).toBe(afterDispose)
  })

  it('rejects accessors and hostile proxies without touching unknown getters', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands', 'panes', 'notifications.publish'])
    const opened = host.open(consumer(), manifest(['commands', 'panes', 'notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const accessor = { label: 'run', execute: async () => ({ ok: true as const, value: undefined }) }
    Object.defineProperty(accessor, 'id', { enumerable: true, get: () => 'run' })
    expect(opened.value.commands!.register(accessor as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'id must be an own data property' })
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('hostile descriptor') } })
    expect(opened.value.commands!.register(proxy as never)).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'hostile descriptor' })
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const throwingRevoked = new Proxy({}, { getOwnPropertyDescriptor: () => { throw revoked.proxy } })
    expect(opened.value.commands!.register(throwingRevoked as never)).toEqual({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: 'plugin input could not be inspected',
    })
    const accessorMessage = Object.defineProperty({}, 'message', { get: () => { throw new Error('message getter ran') } })
    const throwingAccessor = new Proxy({}, { getOwnPropertyDescriptor: () => { throw accessorMessage } })
    expect(opened.value.commands!.register(throwingAccessor as never)).toEqual({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: 'plugin input could not be inspected',
    })
    expect((opened.value as BluePluginApi & { status: NonNullable<BluePluginApi['status']> }).status).toBeUndefined()
    const badSize = { id: 'getter-size', placement: 'left', render: () => null, size: {} }
    Object.defineProperty(badSize.size, 'min', { enumerable: true, get: () => 1 })
    expect(opened.value.panes!.register(badSize as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'min must be an own data property' })
    let unknownRead = false
    const valid = command('safe') as ReturnType<typeof command> & { unknown?: string }
    Object.defineProperty(valid, 'unknown', { get: () => { unknownRead = true; return 'bad' } })
    expect(opened.value.commands!.register(valid)).toMatchObject({ ok: true })
    expect(unknownRead).toBe(false)
    const badManifest = { id: '@acme/getter', api: '^1.0.0-beta.1', capabilities: [] as string[] }
    Object.defineProperty(badManifest, 'api', { enumerable: true, get: () => '^1.0.0-beta.1' })
    expect(host.open(consumer(), badManifest as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'api must be an own data property' })
    expect(opened.value.notifications!.publish({ id: 'notice', view: Object.defineProperty({}, 'kind', { enumerable: true, get: () => 'text' }) as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'kind must be an own data property' })
    expect(host.open({ effect: () => { throw new Error('effect rejected') } }, { ...manifest([]), id: '@acme/effect-rejected' })).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'effect rejected' })
  })

  it('covers canonical optional fields and the remaining admission failures', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['status', 'panes', 'overlays', 'notifications.publish', 'editor.extensions', 'status.provider', 'editor.provider'])
    const scopedConsumer = consumer()
    const opened = host.open(scopedConsumer, manifest(['status', 'panes', 'overlays', 'notifications.publish', 'editor.extensions', 'status.provider', 'editor.provider']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.panes!.register({ id: 'auto-pane', placement: 'header', size: { preferred: 'auto' }, render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.panes!.register({ id: 'bounded-pane', placement: 'bottom', size: { min: 1, max: 2 }, render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.panes!.register({ id: 'negative-pane', placement: 'header', size: { min: -1 }, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    const richOverlay = opened.value.overlays!.open({ id: 'rich-overlay', title: 'Title', capturing: false, dismissible: false, onEvent: () => ({ ok: true, value: undefined }), render: () => view })
    expect(richOverlay).toMatchObject({ ok: true })
    if (richOverlay.ok) expect(richOverlay.value.refresh()).toEqual({ ok: true, value: undefined })
    expect(opened.value.overlays!.open({ id: 'bad-title', title: 1 as never, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'bad-overlay-event', render: () => view, onEvent: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'bad-min-width', minWidth: 0, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'overlay minWidth must be a positive number' })
    expect(opened.value.overlays!.open(new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('overlay proxy') } }) as never)).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'overlay proxy' })
    expect(opened.value.notifications!.publish({ id: 'toned', tone: 'warning', view })).toEqual({ ok: true, value: undefined })
    expect(opened.value.notifications!.publish({ id: 'bad-tone', tone: 'loud' as never, view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorExtensions!.register({ id: 'full-extension', after: view, hint: 'hint', actions: [{ id: 'act', label: 'Act' }], onEvent: () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: true })
    expect(opened.value.editorExtensions!.register({ id: 'minimal-extension' })).toMatchObject({ ok: true })
    expect(opened.value.editorExtensions!.register({ id: 'extension-priority', priority: -1 })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(opened.value.editorExtensions!.register(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorExtensions!.register({ id: 'bad-node', before: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorExtensions!.register({ id: 'bad-hint', hint: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorExtensions!.register({ id: 'bad-complete', complete: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorExtensions!.register(new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('extension proxy') } }) as never)).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'extension proxy' })
    expect(opened.value.statusProviders!.register({ id: 'bad-status-provider', render: 1 } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorProviders!.register({ id: 'minimal-editor', render: () => ({ kind: 'editor-control' }) })).toMatchObject({ ok: true })
    expect(opened.value.editorProviders!.register(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.editorProviders!.register({ id: 'bad-editor-event', render: () => ({ kind: 'editor-control' }), onEvent: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    await Promise.resolve()
    owner.dispose()
    scopedConsumer.dispose()

    expect(host.open(consumer(), { id: '@acme/full', api: '^1.0.0-beta.1', capabilities: [], schemaVersion: 1, entry: './index.js', blue: '^1', harness: '^1', node: '>=22', integrity: 'sha256-YQ==' })).toMatchObject({ ok: true, value: { manifest: { schemaVersion: 1, entry: './index.js', blue: '^1', harness: '^1', node: '>=22', integrity: 'sha256-YQ==' } } })
    expect(host.open(consumer(), { id: '@acme/missing', api: '^1.0.0-beta.1' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(consumer(), { id: '@acme/null-caps', api: '^1.0.0-beta.1', capabilities: null } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
  })

  it('keeps owner seams off guarded hosts and reports minting after host disposal', async () => {
    const ctx = new Context()
    const host = new BluePluginHostService(ctx)
    const owner = consumer()
    expect(() => attachBluePluginHostCapabilities(ctx.bluePluginHost, owner, ['overlays'])).toThrow('requires the active host service itself')
    expect(() => snapshotBluePluginHost(ctx.bluePluginHost)).toThrow('requires the active host service itself')
    expect(() => subscribeBluePluginHost(ctx.bluePluginHost, () => {})).toThrow('requires the active host service itself')
    expect(() => subscribeBluePluginNotifications(ctx.bluePluginHost, () => {})).toThrow('requires the active host service itself')
    expect(createBlueUserGesture(ctx.bluePluginHost, owner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    const lease = attachBluePluginHostCapabilities(host, owner, ['overlays'])
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: true })
    expect(createBlueUserGesture(host, owner, 'overlays')).toMatchObject({ ok: true })
    const replacementOwner = consumer()
    attachBluePluginHostCapabilities(host, replacementOwner, ['overlays'])
    await expect(lease.runUserGesture('overlays', () => undefined)).rejects.toThrow('only the current user-dispatch owner generation may mint user gestures')
    await ctx.fiber.dispose()
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    replacementOwner.dispose()
  })

  it('keeps owner snapshot revisions optional for source-compatible mocks', () => {
    const legacy: BluePluginHostSnapshot = {
      commands: [],
      status: [],
      panes: [{
        id: 'legacy-pane',
        contribution: { id: 'legacy-pane', placement: 'bottom', render: () => null },
        hidden: false,
      }],
      overlays: [{
        id: 'legacy-overlay',
        request: { id: 'legacy-overlay', capturing: false, dismissible: true, render: () => ({ kind: 'text', content: 'legacy' }) },
        order: 0,
      }],
      editorExtensions: [],
      statusProviders: [],
      editorProviders: [],
    }
    expect(legacy.revision).toBeUndefined()
    expect(legacy.editorExtensionsRevision).toBeUndefined()
    expect(legacy.editorProvidersRevision).toBeUndefined()
    expect(legacy.panes[0]?.revision).toBeUndefined()
    expect(legacy.overlays[0]?.revision).toBeUndefined()
  })

  it('contains invalid nested numbers and clock failures', () => {
    const host = new BluePluginHostService(new Context(), { now: () => { throw new Error('clock failed') } })
    attach(host, ['status', 'notifications.publish'])
    const opened = host.open(consumer(), manifest(['status', 'notifications.publish']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const registered = opened.value.status!.register({ id: 'clock', render: () => null })
    expect(registered.ok).toBe(true)
    if (registered.ok) expect(registered.value.refresh()).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'clock failed' })
    expect(opened.value.notifications!.publish({ id: 'infinite', view: { kind: 'progress', value: Number.POSITIVE_INFINITY, max: 10 } })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'nested contribution numbers must be finite' })
    expect(opened.value.notifications!.publish({ id: 'finite', view: { kind: 'progress', value: 2, max: 10 } })).toEqual({ ok: true, value: undefined })
    expect(opened.value.notifications!.publish({ id: 'function', view: { kind: 'text', content: (() => 'bad') as never } })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'nested contribution data must be finite, acyclic JSON-shaped data' })
    const sparseRows: unknown[] = []
    sparseRows.length = 1
    expect(opened.value.notifications!.publish({ id: 'sparse', view: { kind: 'fields', rows: sparseRows } })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'array entries must be own data properties' })
    const nonEnumerable = { kind: 'text', content: 'visible' }
    Object.defineProperty(nonEnumerable, 'ignored', { value: 'hidden', enumerable: false })
    expect(opened.value.notifications!.publish({ id: 'non-enumerable', view: nonEnumerable })).toEqual({ ok: true, value: undefined })
    let inheritedRead = false
    const protoPayload = { kind: 'text', content: 'safe' }
    Object.defineProperty(protoPayload, '__proto__', { enumerable: true, value: Object.defineProperty({}, 'inherited', { get: () => { inheritedRead = true; return 'bad' } }) })
    let canonical: BlueView | undefined
    subscribeBluePluginNotifications(host, notification => { if (notification.id === 'proto') canonical = notification.view })
    expect(opened.value.notifications!.publish({ id: 'proto', view: protoPayload })).toEqual({ ok: true, value: undefined })
    expect(Object.getPrototypeOf(canonical)).toBe(Object.prototype)
    expect(inheritedRead).toBe(false)
  })

  it('preserves final rich status nodes through the temporary owner snapshot seam', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const opened = host.open(consumer(), manifest(['status']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const node = { kind: 'stack' as const, direction: 'row' as const, children: [{ node: { kind: 'rich-text' as const, spans: [{ text: 'rich', tone: 'accent' as const }] } }] }
    expect(opened.value.status!.register({ id: 'rich', render: () => node })).toMatchObject({ ok: true })
    const entry = snapshotBluePluginHost(host).status.find(candidate => candidate.id === 'rich')
    expect(entry?.render()).toBe(node)
  })

  it('covers detailed registry rejection and owner reference-count paths', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    const firstOwner = attachBluePluginHostCapabilities(host, owner, ['status', 'panes'])
    const secondOwner = attachBluePluginHostCapabilities(host, owner, ['overlays'])
    const c = consumer()
    const opened = host.open(c, manifest(['status', 'panes', 'overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(opened.value.status!.register({ id: 'same', render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.status!.register({ id: 'same', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(opened.value.commands?.register(command('absent'))).toBeUndefined()
    expect(opened.value.panes!.register({ id: 'pane-title', title: 1 as never, placement: 'left', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.panes!.register({ id: 'pane-render', placement: 'left', render: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.panes!.register({ id: 'pane-size-object', placement: 'left', size: 1 as never, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.panes!.register({ id: 'pane-preferred', placement: 'left', size: { preferred: 'large' as never }, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.panes!.register({ id: 'pane-order', placement: 'left', size: { min: 3, max: 2 }, render: () => null })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    const paneHandle = opened.value.panes!.register({ id: 'pane', placement: 'left', render: () => null })
    expect(paneHandle.ok).toBe(true)
    if (paneHandle.ok) expect(paneHandle.value.setHidden(1 as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.panes!.register({ id: 'pane', placement: 'left', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })

    expect(opened.value.overlays!.open(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'capture-type', capturing: 1 as never, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'dismiss-type', dismissible: 1 as never, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'render-type', render: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.overlays!.open({ id: 'no-gesture', capturing: true, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    firstOwner.dispose()
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: true })
    secondOwner.dispose()
    expect(opened.value.status!.register({ id: 'absent', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(opened.value.panes!.register({ id: 'absent-pane', placement: 'left', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(opened.value.overlays!.open({ id: 'absent-overlay', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    c.dispose()

    expect(() => attachBluePluginHostCapabilities(host, { effect: () => { throw new Error('owner effect failed') } }, ['overlays'])).toThrow('owner effect failed')
    await Promise.resolve()
  })

  it('rolls back ordered overlay admission and contains refresh listener failures', async () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['overlays'])
    const opened = host.open(consumer(), manifest(['overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let reject = true
    const listener = subscribeBluePluginHost(host, snapshot => {
      if (reject && snapshot.overlays.some(entry => entry.id === 'rejected-overlay')) throw new Error('overlay rejected')
    })
    expect(opened.value.overlays!.open({ id: 'rejected-overlay', render: () => view })).toEqual({ ok: false, code: 'BLUE_DUPLICATE_ID', message: 'overlay rejected' })
    reject = false
    const accepted = opened.value.overlays!.open({ id: 'accepted-overlay', render: () => view })
    expect(accepted.ok).toBe(true)
    reject = true
    expect(accepted.ok && accepted.value.refresh()).toBeTruthy()
    await Promise.resolve()
    listener.dispose()
  })

  it('mounts as a Cordis plugin entry', async () => {
    expect(name).toBe('blue-api-host')
    const ctx = new Context()
    apply(ctx)
    expect(ctx.bluePluginHost).toBeInstanceOf(BluePluginHostService)
    expect('snapshot' in ctx.bluePluginHost).toBe(false)
    expect('subscribe' in ctx.bluePluginHost).toBe(false)
    expect('dispose' in ctx.bluePluginHost).toBe(false)
    await ctx.fiber.dispose()
  })

  it('buffers registrations without granting renderer or dispatch authority', async () => {
    const ctx = new Context()
    apply(ctx)
    const host = (ctx.bluePluginHost as unknown as Record<symbol, BluePluginHostService | undefined>)[symbols.original] ?? ctx.bluePluginHost
    const opened = ctx.bluePluginHost.open(ctx, {
      id: '@acme/buffered',
      api: '^1.0.0-beta.1',
      capabilities: ['commands', 'status', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'],
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(opened.value.commands!.register(command('buffered-command'))).toMatchObject({ ok: true })
    expect(opened.value.status!.register({ id: 'buffered-status', render: () => view })).toMatchObject({ ok: true })
    expect(opened.value.panes!.register({ id: 'buffered-pane', placement: 'bottom', render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.editorExtensions!.register({ id: 'buffered-extension' })).toMatchObject({ ok: true })
    expect(opened.value.statusProviders!.register({ id: 'buffered-status-provider', render: () => ({ kind: 'text', content: 'status' }) })).toMatchObject({ ok: true })
    expect(opened.value.editorProviders!.register({ id: 'buffered-editor-provider', render: () => ({ kind: 'editor-control' }) })).toMatchObject({ ok: true })
    expect(opened.value.overlays!.open({ id: 'buffered-passive', render: () => view })).toMatchObject({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
    })
    expect(snapshotBluePluginHost(host)).toMatchObject({
      commands: [{ id: 'buffered-command' }],
      status: [{ id: 'buffered-status' }],
      panes: [{ id: 'buffered-pane' }],
      editorExtensions: [{ id: 'buffered-extension' }],
      statusProviders: [{ id: 'buffered-status-provider' }],
      editorProviders: [{ id: 'buffered-editor-provider' }],
    })
    expect(ctx.bluePluginHost.open(ctx, { id: '@acme/unbuffered-notifications', api: '^1.0.0-beta.1', capabilities: ['notifications.publish'] })).toMatchObject({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
    })
    expect(ctx.bluePluginHost.open(ctx, { id: '@acme/unbuffered-session', api: '^1.0.0-beta.1', capabilities: ['session.read'] })).toMatchObject({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
    })
    expect(createBlueUserGesture(host, ctx)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.overlays!.open({ id: 'buffered-capturing', capturing: true, render: () => view }, { userGesture: {} as BlueUserGesture })).toMatchObject({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
    })
    expect(snapshotBluePluginHost(host).overlays).toEqual([])
    const overlappingOwner = attach(host, ['commands', 'status', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'])
    await ctx.fiber.dispose()
    overlappingOwner.dispose()
  })
})
