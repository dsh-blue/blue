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
import type { BlueEditorProvider, BluePluginApi, BluePluginManifest, BlueResult, BlueUserGesture, BlueView } from '../src/contracts.ts'

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

function manifest(capabilities: BluePluginManifest['capabilities'] = ['commands', 'status', 'dock', 'notifications']): BluePluginManifest {
  return { id: '@acme/plugin', api: '^1.0.0', capabilities }
}

function command(id: string) {
  return { id, label: id, execute: async () => ({ ok: true as const, value: undefined }) }
}

function attach(host: BluePluginHostService, capabilities: BluePluginManifest['capabilities'] = ['commands', 'status', 'dock', 'notifications']) {
  const owner = consumer()
  attachBluePluginHostCapabilities(host, owner, capabilities)
  return owner
}

describe('BluePluginHostService', () => {
  it('rejects malformed and incompatible manifests at the API boundary', () => {
    const host = new BluePluginHostService(new Context())
    const c = consumer()
    expect(host.open(c, { id: 'bad id', api: '^1.0.0', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, { id: '@acme/plugin', api: 'not a range', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(c, { id: '@acme/plugin', api: '^2.0.0', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(null as never, manifest([]))).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(c, manifest(['dock', 'dock']))).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, manifest(['session.read']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
  })

  it('exposes only declared capabilities and freezes the public projection', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['status'])
    const apiResult = host.open(consumer(), manifest(['status']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    expect(api.manifest).toEqual({ id: '@acme/plugin', api: '^1.0.0', capabilities: ['status'] })
    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.manifest)).toBe(true)
    expect(api.commands).toBeUndefined()
    expect(api.dock).toBeUndefined()
    expect(api.notifications).toBeUndefined()
    const status = api.status!
    const registered = status.register({ id: 'status', render: () => view })
    expect(registered).toMatchObject({ ok: true })
    expect(status.list()).toEqual([{ id: 'status', render: expect.any(Function) }])
    expect(Object.isFrozen(status.list())).toBe(true)
  })

  it('enforces registry capability, contribution shape, and duplicate ids', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands'])
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
    expect(commands.register({ ...command('negative'), priority: -1 })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    const denied = host.open(consumer(), manifest([]))
    expect(denied.ok).toBe(true)
    if (denied.ok) {
      const hidden = (denied.value as BluePluginApi & { status: NonNullable<BluePluginApi['status']> }).status
      expect(hidden).toBeUndefined()
    }

  })

  it('disposes registrations when the consumer effect unloads', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['commands', 'status', 'dock'])
    const c = consumer()
    const apiResult = host.open(c, manifest(['commands', 'status', 'dock']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    const commandRegistration = api.commands!.register(command('run'))
    const statusRegistration = api.status!.register({ id: 'status', render: () => view })
    const dockRegistration = api.dock!.register({ id: 'dock', view })
    expect(api.commands!.list()).toHaveLength(1)
    expect(api.status!.list()).toHaveLength(1)
    expect(api.dock!.list()).toHaveLength(1)
    c.dispose()
    expect(api.commands!.list()).toEqual([])
    expect(api.status!.list()).toEqual([])
    expect(api.dock!.list()).toEqual([])
    expect(commandRegistration.ok && commandRegistration.value.disposed).toBe(true)
    expect(statusRegistration.ok && statusRegistration.value.disposed).toBe(true)
    expect(dockRegistration.ok && dockRegistration.value.disposed).toBe(true)
  })

  it('fans notifications to all consumers and removes listeners on dispose', () => {
    const host = new BluePluginHostService(new Context())
    attach(host, ['notifications'])
    const first = consumer()
    const second = consumer()
    const firstApi = host.open(first, manifest(['notifications']))
    const secondApi = host.open(second, { ...manifest(['notifications']), id: '@acme/other' })
    expect(firstApi.ok && secondApi.ok).toBe(true)
    if (!firstApi.ok || !secondApi.ok) return
    const seen: BlueView[] = []
    const subscription = secondApi.value.notifications!.subscribe(notification => seen.push(notification.view))
    secondApi.value.notifications!.subscribe(() => { throw new Error('contained observer') })
    expect(firstApi.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: true, value: undefined })
    expect(seen).toEqual([view])
    expect(Object.isFrozen(seen[0])).toBe(true)
    expect(subscription.disposed).toBe(false)
    first.dispose()
    second.dispose()
    expect(subscription.disposed).toBe(true)
    expect(secondApi.value.notifications!.publish({ id: '', view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
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
    attach(host, ['commands', 'status', 'dock'])
    const opened = host.open(consumer(), manifest(['commands', 'status', 'dock']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.status!.register({ id: 'Blue Bad' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.status!.register({ id: 'blue.status.mode', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.status!.register({ id: 'status', priority: Number.NaN, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.status!.register({ id: 'status-high', priority: 101, render: () => view })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(opened.value.status!.register({ id: 'status' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.commands!.register({ id: 'Bad', label: '', execute: async () => ({ ok: true, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.commands!.register({ id: 'run', label: ' ' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.dock!.register({ id: 'dock', view: null } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.dock!.register({ id: 'dock', view, preferredRows: 21 })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
    expect(opened.value.dock!.register({ id: 'dock', view, minRows: -1 })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

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
    attach(host, ['notifications'])
    const opened = host.open(consumer(), manifest(['notifications']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.notifications!.publish({ id: 'Bad Notice', view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.notifications!.publish({ id: 'notice', view: null as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    const observer = subscribeBluePluginNotifications(host, () => { throw new Error('notice view is invalid') })
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'notice view is invalid' })
    observer.dispose()
    const valueObserver = subscribeBluePluginNotifications(host, () => { throw 'non-error rejection' })
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'notification was rejected' })
    valueObserver.dispose()
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: true, value: undefined })
  })

  it('clears all registries and listeners when the host service unloads', async () => {
    const ctx = new Context()
    const host = new BluePluginHostService(ctx)
    const bridge = attach(host)
    const c = consumer()
    const apiResult = host.open(c, manifest())
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const api = apiResult.value
    api.commands!.register(command('run'))
    api.status!.register({ id: 'status', render: () => view })
    api.dock!.register({ id: 'dock', view })
    const received: BlueView[] = []
    api.notifications!.subscribe(notification => received.push(notification.view))
    await ctx.fiber.dispose()
    expect(api.commands!.list()).toEqual([])
    expect(api.status!.list()).toEqual([])
    expect(api.dock!.list()).toEqual([])
    expect(api.notifications!.publish({ id: 'after-dispose', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(received).toEqual([])
    expect(() => snapshotBluePluginHost(host)).toThrow('requires the active host service itself')
    expect(host.open(consumer(), manifest([]))).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue plugin host is not active' })
    bridge.dispose()
  })

  it('tracks owner adapter readiness across unload and reload without dropping contributions', () => {
    const host = new BluePluginHostService(new Context())
    expect(host.open(consumer(), manifest(['dock']))).toEqual({
      ok: false,
      code: 'BLUE_CAPABILITY_ABSENT',
      message: 'capability "dock" has no active Blue owner adapter',
    })
    expect(() => attachBluePluginHostCapabilities(host, consumer(), ['dock', 'tools'])).toThrow('unsupported capability "tools"')
    expect(host.open(consumer(), manifest(['dock']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    const firstOwner = attach(host, ['dock', 'notifications'])
    const secondOwner = attach(host, ['dock'])
    const opened = host.open(consumer(), manifest(['dock', 'notifications']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.manifest.capabilities).toEqual(['notifications'])
    expect(opened.value.dock).toBeDefined()
    expect(opened.value.dock!.register({ id: 'persistent', view })).toMatchObject({ ok: true })

    firstOwner.dispose()
    expect(opened.value.dock!.register({ id: 'while-second-owner-lives', view })).toMatchObject({ ok: true })
    expect(opened.value.notifications!.publish({ id: 'notice', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    secondOwner.dispose()
    expect(opened.value.dock!.register({ id: 'while-absent', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    expect(snapshotBluePluginHost(host).dock.map(entry => entry.id)).toEqual(['persistent', 'while-second-owner-lives'])

    attach(host, ['dock'])
    expect(host.open(consumer(), manifest(['dock']))).toMatchObject({ ok: true })
    expect(snapshotBluePluginHost(host).dock.map(entry => entry.id)).toEqual(['persistent', 'while-second-owner-lives'])
  })

  it('projects every implemented public capability exactly and keeps sessions denied', () => {
    const host = new BluePluginHostService(new Context())
    const capabilities = ['commands', 'status', 'notifications', 'panes', 'overlays', 'editor.extensions', 'status.provider', 'editor.provider'] as const
    attach(host, capabilities)
    const opened = host.open(consumer(), manifest(capabilities))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(Object.keys(opened.value).sort()).toEqual(['commands', 'editorExtensions', 'editorProviders', 'manifest', 'notifications', 'overlays', 'panes', 'status', 'statusProviders'])
    expect(opened.value.session).toBeUndefined()
    expect(host.open(consumer(), manifest(['session.read']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
    expect(host.open(consumer(), manifest(['session.act']))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
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
    const reopened = host.open(firstConsumer, manifest(['panes']))
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
    const reopened = host.open(firstConsumer, manifest(['overlays']))
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
    expect(pending?.refresh()).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    pending?.close()
    expect(snapshotBluePluginHost(host).overlays.map(entry => entry.id)).not.toContain('plain')
    expect(createBlueUserGesture(host, overlayOwner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    firstConsumer.dispose()
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
    const extension = first.value.editorExtensions!.register({ id: 'extension', before, diagnostics: [{ id: 'd', message: 'message' }], complete: () => { invoked += 1; return { ok: true, value: [] } }, transformSubmit: request => { invoked += 1; return { ok: true, value: request } } })
    const statusCandidate = first.value.statusProviders!.register({ id: 'status-provider', render: () => { invoked += 1; return { kind: 'text', content: 'status' } } })
    const editor: BlueEditorProvider = { id: 'editor-provider', render: () => { invoked += 1; return { kind: 'editor-control' } }, onEvent: () => { invoked += 1; return { ok: true, value: undefined } } }
    const editorCandidate = first.value.editorProviders!.register(editor)
    expect(extension.ok && statusCandidate.ok && editorCandidate.ok).toBe(true)
    expect(invoked).toBe(0)
    before.content = 'changed'
    expect(first.value.editorExtensions!.list()[0]!.before).toEqual({ kind: 'text', content: 'before' })
    expect(snapshotBluePluginHost(host)).toMatchObject({ editorExtensions: [{ id: 'extension' }], statusProviders: [{ id: 'status-provider' }], editorProviders: [{ id: 'editor-provider' }] })
    expect(second.value.editorProviders!.register(editor)).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(second.value.statusProviders!.register({ id: 'blue.status', render: () => ({ kind: 'text', content: '' }) })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(second.value.editorProviders!.register({ id: 'bad', render: 1 } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(second.value.editorExtensions!.register({ id: 'bad-extension', diagnostics: {} as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
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
    attach(host, ['commands', 'panes', 'notifications'])
    const opened = host.open(consumer(), manifest(['commands', 'panes', 'notifications']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const accessor = { label: 'run', execute: async () => ({ ok: true as const, value: undefined }) }
    Object.defineProperty(accessor, 'id', { enumerable: true, get: () => 'run' })
    expect(opened.value.commands!.register(accessor as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'id must be an own data property' })
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: () => { throw new Error('hostile descriptor') } })
    expect(opened.value.commands!.register(proxy as never)).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'hostile descriptor' })
    expect((opened.value as BluePluginApi & { status: NonNullable<BluePluginApi['status']> }).status).toBeUndefined()
    const badSize = { id: 'getter-size', placement: 'left', render: () => null, size: {} }
    Object.defineProperty(badSize.size, 'min', { enumerable: true, get: () => 1 })
    expect(opened.value.panes!.register(badSize as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'min must be an own data property' })
    let unknownRead = false
    const valid = command('safe') as ReturnType<typeof command> & { unknown?: string }
    Object.defineProperty(valid, 'unknown', { get: () => { unknownRead = true; return 'bad' } })
    expect(opened.value.commands!.register(valid)).toMatchObject({ ok: true })
    expect(unknownRead).toBe(false)
    const badManifest = { id: '@acme/getter', api: '^1.0.0', capabilities: [] as string[] }
    Object.defineProperty(badManifest, 'api', { enumerable: true, get: () => '^1.0.0' })
    expect(host.open(consumer(), badManifest as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'api must be an own data property' })
    expect(opened.value.notifications!.publish({ id: 'notice', view: Object.defineProperty({}, 'kind', { enumerable: true, get: () => 'text' }) as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'kind must be an own data property' })
    expect(host.open({ effect: () => { throw new Error('effect rejected') } }, manifest([]))).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'effect rejected' })
  })

  it('covers canonical optional fields and the remaining admission failures', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = attach(host, ['dock', 'status', 'panes', 'overlays', 'notifications', 'editor.extensions', 'status.provider', 'editor.provider'])
    const scopedConsumer = consumer()
    const opened = host.open(scopedConsumer, manifest(['dock', 'status', 'panes', 'overlays', 'notifications', 'editor.extensions', 'status.provider', 'editor.provider']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.dock!.register({ id: 'dock-function', view: () => view, preferredRows: 3, minRows: 1, collapsible: true })).toMatchObject({ ok: true })
    expect(opened.value.dock!.register(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(opened.value.dock!.register({ id: 'dock-bad-collapse', view, collapsible: 1 as never })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
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
    expect(opened.value.editorExtensions!.register({ id: 'full-extension', after: view, hint: 'hint', actions: [{ id: 'act', label: 'Act' }] })).toMatchObject({ ok: true })
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

    expect(host.open(consumer(), { id: '@acme/full', api: '^1.0.0', capabilities: [], schemaVersion: 1, entry: './index.js', blue: '^1', harness: '^1', node: '>=22', integrity: 'sha256-YQ==' })).toMatchObject({ ok: true, value: { manifest: { schemaVersion: 1, entry: './index.js', blue: '^1', harness: '^1', node: '>=22', integrity: 'sha256-YQ==' } } })
    expect(host.open(consumer(), { id: '@acme/missing', api: '^1.0.0' } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(consumer(), { id: '@acme/null-caps', api: '^1.0.0', capabilities: null } as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
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
    attachBluePluginHostCapabilities(host, owner, ['overlays'])
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: true })
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: true })
    await ctx.fiber.dispose()
    expect(createBlueUserGesture(host, owner)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
  })

  it('keeps owner snapshot revisions optional for source-compatible mocks', () => {
    const legacy: BluePluginHostSnapshot = {
      commands: [],
      status: [],
      dock: [],
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
    expect(legacy.panes[0]?.revision).toBeUndefined()
    expect(legacy.overlays[0]?.revision).toBeUndefined()
  })

  it('contains invalid nested numbers and clock failures', () => {
    const host = new BluePluginHostService(new Context(), { now: () => { throw new Error('clock failed') } })
    attach(host, ['status', 'notifications'])
    const opened = host.open(consumer(), manifest(['status', 'notifications']))
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
    opened.value.notifications!.subscribe(notification => { if (notification.id === 'proto') canonical = notification.view })
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
    const firstOwner = attachBluePluginHostCapabilities(host, owner, ['status', 'panes', 'overlays'])
    const secondOwner = attachBluePluginHostCapabilities(host, owner, ['overlays'])
    const c = consumer()
    const opened = host.open(c, manifest(['status', 'panes', 'overlays']))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(opened.value.status!.register({ id: 'same', render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.status!.register({ id: 'same', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    expect(opened.value.dock?.register(null as never)).toBeUndefined()
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

  it('mounts as a Cordis plugin entry', () => {
    expect(name).toBe('blue-api-host')
    const ctx = new Context()
    apply(ctx)
    expect(ctx.bluePluginHost).toBeInstanceOf(BluePluginHostService)
    expect('snapshot' in ctx.bluePluginHost).toBe(false)
    expect('subscribe' in ctx.bluePluginHost).toBe(false)
    expect('dispose' in ctx.bluePluginHost).toBe(false)
  })

  it('buffers passive surfaces without granting renderer authority', () => {
    const ctx = new Context()
    apply(ctx)
    const host = (ctx.bluePluginHost as unknown as Record<symbol, BluePluginHostService | undefined>)[symbols.original] ?? ctx.bluePluginHost
    const opened = ctx.bluePluginHost.open(ctx, { id: '@acme/buffered', api: '^1.0.0', capabilities: ['panes', 'overlays'] })
    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(opened.value.panes!.register({ id: 'buffered-pane', placement: 'bottom', render: () => null })).toMatchObject({ ok: true })
    const passive = opened.value.overlays!.open({ id: 'buffered-passive', render: () => view })
    expect(passive).toMatchObject({ ok: true })
    expect(createBlueUserGesture(host, ctx)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(opened.value.overlays!.open({ id: 'buffered-capturing', capturing: true, render: () => view }, { userGesture: {} as BlueUserGesture })).toMatchObject({
      ok: false,
      code: 'BLUE_ACTION_REJECTED',
      message: 'capturing overlays require an active renderer owner',
    })
    if (passive.ok) {
      const entry = snapshotBluePluginHost(host).overlays.find(candidate => candidate.id === 'buffered-passive')!
      expect(closeBluePluginHostOverlay(host, ctx, entry)).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      passive.value.close()
    }
  })
})
