/**
 * Cordis-scoped host tests: public capability surfaces, registry ownership,
 * notification fan-out, and Fiber-style cleanup.
 *
 * @module @dsh-blue/blue-api/tests/host
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BluePluginHostService, apply, name } from '../src/host.ts'
import type { BluePluginApi, BluePluginManifest, BlueView } from '../src/contracts.ts'

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

describe('BluePluginHostService', () => {
  it('rejects malformed and incompatible manifests at the API boundary', () => {
    const host = new BluePluginHostService(new Context())
    const c = consumer()
    expect(host.open(c, { id: 'bad id', api: '^1.0.0', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, { id: '@acme/plugin', api: 'not a range', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(c, null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(host.open(c, { id: '@acme/plugin', api: '^2.0.0', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
  })

  it('exposes only declared capabilities and freezes the public projection', () => {
    const host = new BluePluginHostService(new Context())
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
    const apiResult = host.open(consumer(), manifest(['commands']))
    expect(apiResult.ok).toBe(true)
    if (!apiResult.ok) return
    const commands = apiResult.value.commands!
    expect(commands.register(null as never)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(commands.register({ id: '', label: '', execute: async () => ({ ok: true as const, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(commands.register(command('run'))).toMatchObject({ ok: true })
    expect(commands.register(command('run'))).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })

    const denied = host.open(consumer(), manifest([]))
    expect(denied.ok).toBe(true)
    if (denied.ok) {
      const hidden = (denied.value as BluePluginApi & { status: NonNullable<BluePluginApi['status']> }).status
      expect(hidden).toBeUndefined()
    }

    // The host keeps the defensive check even for registries that are not
    // projected into a capability-limited API. Exercise that internal guard.
    const deniedHost = new BluePluginHostService(new Context())
    expect(deniedHost.open(consumer(), manifest([])).ok).toBe(true)
    const internals = [...(deniedHost as unknown as { registries: Set<{ register(value: unknown): unknown }> }).registries]
    expect(internals[0]!.register(command('hidden'))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
    expect(internals[1]!.register({ id: 'hidden', render: () => view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
    expect(internals[2]!.register({ id: 'hidden', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
    const notificationInternals = [...(deniedHost as unknown as { notifications: Set<{ publish(value: unknown): unknown }> }).notifications]
    expect(notificationInternals[0]!.publish({ id: 'hidden', view })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_DENIED' })
  })

  it('disposes registrations when the consumer effect unloads', () => {
    const host = new BluePluginHostService(new Context())
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
    const first = consumer()
    const second = consumer()
    const firstApi = host.open(first, manifest(['notifications']))
    const secondApi = host.open(second, { ...manifest(['notifications']), id: '@acme/other' })
    expect(firstApi.ok && secondApi.ok).toBe(true)
    if (!firstApi.ok || !secondApi.ok) return
    const seen: BlueView[] = []
    const subscription = secondApi.value.notifications!.subscribe(notification => seen.push(notification.view))
    expect(firstApi.value.notifications!.publish({ id: 'notice', view })).toEqual({ ok: true, value: undefined })
    expect(seen).toEqual([view])
    expect(Object.isFrozen(seen[0])).toBe(false)
    expect(subscription.disposed).toBe(false)
    first.dispose()
    second.dispose()
    expect(subscription.disposed).toBe(true)
    expect(secondApi.value.notifications!.publish({ id: '', view })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
  })

  it('clears all registries and listeners when the host service unloads', () => {
    const host = new BluePluginHostService(new Context())
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
    host.dispose()
    expect(api.commands!.list()).toEqual([])
    expect(api.status!.list()).toEqual([])
    expect(api.dock!.list()).toEqual([])
    expect(api.notifications!.publish({ id: 'after-dispose', view })).toEqual({ ok: true, value: undefined })
    expect(received).toEqual([])
  })

  it('mounts as a Cordis plugin entry', () => {
    expect(name).toBe('blue-api-host')
    const ctx = new Context()
    apply(ctx)
    expect(ctx.bluePluginHost).toBeInstanceOf(BluePluginHostService)
  })
})
