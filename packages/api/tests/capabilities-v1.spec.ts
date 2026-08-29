/**
 * Canonical v1 capability admission and host projection tests.
 *
 * @module @dsh-blue/blue-api/tests/capabilities-v1
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  BLUE_CAPABILITY_CATALOG_V1,
  getBlueCapabilityDefinition,
  negotiateBlueCapabilities,
} from '../src/capabilities-v1.ts'
import {
  BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
  type BluePluginManifestV1,
} from '../src/protocol-v1.ts'
import {
  BluePluginHostService,
  apply,
  attachBluePluginHostCapabilities,
  attachBluePluginHostSessionReader,
  createBluePluginControl,
  snapshotBluePluginHost,
  type BluePluginHost,
} from '../src/host.ts'

function manifest(
  required: BluePluginManifestV1['capabilities']['required'] = [],
  optional: BluePluginManifestV1['capabilities']['optional'] = [],
  id = '@acme/canonical',
): BluePluginManifestV1 {
  return {
    $schema: BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
    schemaVersion: 1,
    id,
    entry: '.',
    api: '^1.0.0-beta.1',
    compatibility: { blue: '^0.1.1-rc.2', harness: '^0.1.1-rc.2', node: '>=22' },
    capabilities: { required, optional },
  }
}

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

const commands = (names: readonly string[]) => ({ name: 'commands' as const, version: '^1.0.0', resources: { names } })
const panes = (placements: readonly ('header' | 'left' | 'right' | 'bottom')[]) => ({ name: 'panes' as const, version: '^1.0.0', resources: { placements } })
const status = { name: 'status' as const, version: '^1.0.0' }
const projections = (keys: readonly string[]) => ({ name: 'session.projections.read' as const, version: '^1.0.0', resources: { keys } })
const notifications = { name: 'notifications.publish' as const, version: '^1.0.0' }

describe('canonical v1 capability admission', () => {
  it('publishes a frozen catalog and grants wildcard command names', () => {
    expect(Object.isFrozen(BLUE_CAPABILITY_CATALOG_V1)).toBe(true)
    for (const definition of BLUE_CAPABILITY_CATALOG_V1) {
      expect(Object.isFrozen(definition)).toBe(true)
      expect(Object.isFrozen(definition.limits)).toBe(true)
      expect(Object.isFrozen(definition.quotas)).toBe(true)
      if (definition.resources !== undefined) expect(Object.isFrozen(definition.resources)).toBe(true)
    }
    const result = negotiateBlueCapabilities(manifest([commands(['run', 'inspect'])]), {
      generation: () => 7,
    })
    expect(result).toMatchObject({ ok: true, grants: [{ name: 'commands', version: '1.0.0', generation: 7, availability: 'ready', resources: { names: ['run', 'inspect'] } }] })
    if (result.ok) {
      expect(Object.isFrozen(result.grants)).toBe(true)
      expect(Object.isFrozen(result.grants[0])).toBe(true)
      expect(Object.isFrozen(result.grants[0]?.resources)).toBe(true)
    }
    expect(Object.isFrozen(getBlueCapabilityDefinition('commands'))).toBe(true)
  })

  it('fails required resources atomically and reports optional partial grants', () => {
    const required = negotiateBlueCapabilities(manifest([panes(['left', 'bogus' as never])]))
    expect(required).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED', capability: 'panes' })

    const optional = negotiateBlueCapabilities(manifest([], [panes(['left', 'bogus' as never])]))
    expect(optional).toMatchObject({
      ok: true,
      grants: [{ name: 'panes', resources: { placements: ['left'] }, availability: 'ready' }],
      unavailableOptional: [{ name: 'panes', reason: 'resource' }],
    })
  })

  it('classifies API, capability version, policy, owner, and unsupported failures', () => {
    expect(negotiateBlueCapabilities(manifest([], [], '@acme/api'), { apiVersion: '^2.0.0' })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(negotiateBlueCapabilities(manifest([{ ...status, version: '^2.0.0' }]))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_VERSION_UNSUPPORTED', capability: 'status' })
    expect(negotiateBlueCapabilities(manifest([status]), { policy: () => false })).toMatchObject({ ok: false, code: 'BLUE_POLICY_DENIED', capability: 'status' })
    expect(negotiateBlueCapabilities(manifest([status]), { ownerReady: () => false })).toMatchObject({ ok: true, grants: [{ name: 'status', availability: 'unavailable' }], unavailableOptional: [] })
    expect(negotiateBlueCapabilities(manifest([], [status]), { ownerReady: () => false })).toMatchObject({ ok: true, grants: [{ availability: 'unavailable' }], unavailableOptional: [{ reason: 'owner-gap' }] })
    expect(negotiateBlueCapabilities(manifest([], [projections(['costUsage'])]))).toMatchObject({ ok: true, grants: [], unavailableOptional: [{ name: 'session.projections.read', reason: 'unsupported' }] })
  })

  it('rejects an empty resource intersection and honours custom catalog definitions', () => {
    const empty = negotiateBlueCapabilities(manifest([], [panes(['bogus' as never])]))
    expect(empty).toMatchObject({ ok: true, grants: [], unavailableOptional: [{ reason: 'resource' }] })
    const custom = BLUE_CAPABILITY_CATALOG_V1.map(definition => definition.name === 'status'
      ? { ...definition, supported: false }
      : definition)
    expect(negotiateBlueCapabilities(manifest([status]), { catalog: custom })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_UNSUPPORTED' })
  })

  it('negotiates every resource shape and defensive error branch', () => {
    const session = negotiateBlueCapabilities(manifest([
      { name: 'session.read', version: '^1.0.0', resources: { fields: ['identity', 'cwd'] } },
      notifications,
    ]), { generation: () => 3 })
    expect(session).toMatchObject({ ok: true, grants: [
      { name: 'session.read', resources: { fields: ['identity', 'cwd'] }, generation: 3 },
      { name: 'notifications.publish', generation: 3 },
    ] })

    const projectionCatalog = BLUE_CAPABILITY_CATALOG_V1.map(definition => definition.name === 'session.projections.read'
      ? { ...definition, supported: true, resources: ['costUsage'] }
      : definition)
    const projection = negotiateBlueCapabilities(manifest([projections(['costUsage'])]), { catalog: projectionCatalog })
    expect(projection).toMatchObject({ ok: true, grants: [{ name: 'session.projections.read', resources: { keys: ['costUsage'] } }] })

    const limited = BLUE_CAPABILITY_CATALOG_V1.map(definition => definition.name === 'commands'
      ? { ...definition, limits: { maxNames: 1 } }
      : definition)
    expect(negotiateBlueCapabilities(manifest([commands(['one', 'two'])]), { catalog: limited })).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })

    const mismatched = BLUE_CAPABILITY_CATALOG_V1.map(definition => definition.name === 'commands'
      ? { ...definition, resourceKind: 'fields' as const }
      : definition)
    expect(negotiateBlueCapabilities(manifest([commands(['one'])]), { catalog: mismatched })).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })
    expect(getBlueCapabilityDefinition('commands')?.name).toBe('commands')
    expect(getBlueCapabilityDefinition('status')?.resourceKind).toBeUndefined()
    expect(negotiateBlueCapabilities(manifest([status]), { apiVersion: 'not-semver' })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(negotiateBlueCapabilities(manifest([{ ...status, version: 'not-semver' as never }] as never))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_VERSION_UNSUPPORTED' })
    expect(negotiateBlueCapabilities(manifest([], [{ ...status, version: '^2.0.0' }]))).toMatchObject({ ok: true, grants: [], unavailableOptional: [{ name: 'status', reason: 'version' }] })
    expect(negotiateBlueCapabilities(manifest([], [status]), { policy: () => false })).toMatchObject({ ok: true, grants: [], unavailableOptional: [{ name: 'status', reason: 'policy' }] })
  })
})

describe('canonical host projection', () => {
  it('keeps legacy shape while exposing grants only for canonical manifests', () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    attachBluePluginHostCapabilities(host, owner, ['commands'])
    const legacy = host.open(consumer(), { id: '@acme/legacy', api: '^1.0.0-beta.1', capabilities: ['commands'] })
    expect(legacy.ok).toBe(true)
    if (legacy.ok) expect(Object.keys(legacy.value)).toEqual(['manifest', 'commands'])

    const canonical = host.open(consumer(), manifest([commands(['run'])], [], '@acme/canonical-shape'))
    expect(canonical.ok).toBe(true)
    if (!canonical.ok) return
    expect(canonical.value.api).toBeDefined()
    expect(canonical.value.grants).toHaveLength(1)
    expect(canonical.value.grants[0]).toMatchObject({ name: 'commands', availability: 'ready', generation: 1 })
    expect(canonical.value.api.commands).toBe(canonical.value.commands)
    expect(Object.isFrozen(canonical.value)).toBe(true)
  })

  it('fences command ids and pane placements to exact grants', () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    attachBluePluginHostCapabilities(host, owner, ['commands', 'panes'])
    const opened = host.open(consumer(), manifest([commands(['run']), panes(['right'])], [], '@acme/resources'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.commands?.register({ id: 'run', label: 'run', execute: async () => ({ ok: true as const, value: undefined }) })).toMatchObject({ ok: true })
    expect(opened.value.commands?.register({ id: 'inspect', label: 'inspect', execute: async () => ({ ok: true as const, value: undefined }) })).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })
    expect(opened.value.panes?.register({ id: 'right', placement: 'right', render: () => null })).toMatchObject({ ok: true })
    expect(opened.value.panes?.register({ id: 'left', placement: 'left', render: () => null })).toMatchObject({ ok: false, code: 'BLUE_RESOURCE_DENIED' })
  })

  it('projects every implemented canonical facet and cleans up on consumer unload', () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    attachBluePluginHostCapabilities(host, owner, ['commands', 'status', 'notifications.publish', 'panes', 'overlays'])
    attachBluePluginHostSessionReader(host, owner, {
      current: () => ({ revision: 1, id: 's', cwd: '/', status: 'idle', mode: 'normal' }),
      subscribe: listener => {
        listener({ revision: 1, id: 's', cwd: '/', status: 'idle', mode: 'normal' })
        return { disposed: false, dispose: () => {} }
      },
    })
    const c = consumer()
    const opened = host.open(c, manifest([
      commands(['all']),
      status,
      { name: 'notifications.publish', version: '^1.0.0' },
      panes(['right']),
      { name: 'overlays', version: '^1.0.0' },
      { name: 'session.read', version: '^1.0.0', resources: { fields: ['identity'] } },
    ], [], '@acme/all-facets'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.api).toBeDefined()
    expect(opened.value.commands).toBeDefined()
    expect(opened.value.status).toBeDefined()
    expect(opened.value.notifications).toBeDefined()
    expect(opened.value.panes).toBeDefined()
    expect(opened.value.overlays).toBeDefined()
    expect(opened.value.session?.current()).toMatchObject({ id: 's' })
    expect(opened.value.notifications?.publish({ id: 'notice', view: { kind: 'text', content: 'notice' } })).toMatchObject({ ok: true })
    const sessionSubscription = opened.value.session?.subscribe(() => {})
    sessionSubscription?.dispose()
    c.dispose()
    expect(opened.value.commands?.list()).toEqual([])
    expect(opened.value.session?.current()).toBeNull()
  })

  it('rolls back canonical consumer admission when effect registration throws', () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    attachBluePluginHostCapabilities(host, owner, ['commands'])
    const throwing = { effect: () => { throw new Error('effect failed') } }
    expect(host.open(throwing, manifest([commands(['run'])], [], '@acme/throwing'))).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'effect failed' })
    const retry = host.open(consumer(), manifest([commands(['run'])], [], '@acme/throwing'))
    expect(retry.ok).toBe(true)
  })

  it('exercises the private control facade and legacy semver guard', async () => {
    const host = new BluePluginHostService(new Context())
    const owner = consumer()
    attachBluePluginHostCapabilities(host, owner, ['commands', 'overlays'])
    const control = createBluePluginControl(host)
    const helperHost = new BluePluginHostService(new Context())
    const helperControl = createBluePluginControl(helperHost)
    const controlOwner = consumer()
    const controlCapabilities = helperControl.attachCapabilities(controlOwner, ['commands'])
    const controlCapabilitiesSecond = helperControl.attachCapabilities(controlOwner, ['commands'])
    controlCapabilities.dispose()
    controlCapabilitiesSecond.dispose()
    const controlSession = helperControl.attachSessionReader(controlOwner, {
      current: () => null,
      subscribe: () => ({ disposed: false, dispose: () => {} }),
    })
    controlSession.dispose()
    expect(helperControl.generation('status')).toBe(0)
    expect(control.generation('commands')).toBe(1)
    expect(control.snapshot()).toEqual(snapshotBluePluginHost(host))
    const snapshotRegistration = control.subscribe(() => {})
    const notificationRegistration = control.observeNotifications(() => {})
    expect(snapshotRegistration.disposed).toBe(false)
    expect(notificationRegistration.disposed).toBe(false)
    snapshotRegistration.dispose()
    notificationRegistration.dispose()
    const gestureResult = await control.runUserGesture(owner, async gesture => gesture)
    expect(gestureResult).toBeDefined()
    const opened = host.open(consumer(), manifest([{ name: 'overlays', version: '^1.0.0' }], [], '@acme/control-overlay'))
    expect(opened.ok).toBe(true)
    if (opened.ok) {
      const overlay = opened.value.overlays!.open({ id: 'control-overlay', render: () => null })
      expect(overlay.ok).toBe(true)
      if (overlay.ok) {
        const entry = control.snapshot().overlays.find(candidate => candidate.id === 'control-overlay')
        expect(entry).toBeDefined()
        if (entry !== undefined) expect(control.closeOverlay(owner, entry)).toMatchObject({ ok: true })
      }
    }
    Object.defineProperty(host, 'version', { value: 'not-semver' })
    expect(host.open(consumer(), { id: '@acme/legacy-semver', api: '^1.0.0-beta.1', capabilities: [] })).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    expect(host.open(consumer(), { $schema: BLUE_PLUGIN_MANIFEST_SCHEMA_URL } as never)).toMatchObject({ ok: false, code: 'BLUE_API_INCOMPATIBLE' })
    owner.dispose()
  })

  it('admits optional capabilities during an owner gap and rejects duplicate identity', () => {
    const ctx = new Context()
    apply(ctx)
    const host = ctx.bluePluginHost as unknown as BluePluginHost
    const opened = host.open(consumer(), manifest([], [commands(['run']), projections(['costUsage'])], '@acme/gap'))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.value.unavailableOptional).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'commands', reason: 'owner-gap' }),
      expect.objectContaining({ name: 'session.projections.read', reason: 'unsupported' }),
    ]))
    expect(opened.value.grants).toMatchObject([{ name: 'commands', availability: 'unavailable' }])
    const duplicate = host.open(consumer(), manifest([], [], '@acme/gap'))
    expect(duplicate).toMatchObject({ ok: false, code: 'BLUE_DUPLICATE_ID' })
    ctx.fiber.dispose()
  })

  it('fails required canonical capabilities when no composition owner exists', () => {
    const host = new BluePluginHostService(new Context())
    expect(host.open(consumer(), manifest([commands(['run'])], [], '@acme/no-owner'))).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_UNSUPPORTED' })
  })
})
