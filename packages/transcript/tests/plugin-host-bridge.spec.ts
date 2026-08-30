/**
 * Owner bridge tests for additive status projection and lifecycle.
 *
 * @module @dsh-blue/blue-transcript/tests/plugin-host-bridge
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BluePluginHostService, createBluePluginControl } from '../../api/src/host.ts'
import type { BluePluginManifest } from '../../api/src/manifest.ts'
import type { BlueScreen } from '@dsh-blue/blue-core'
import { apply } from '../src/plugin-host-bridge.ts'
import { BlueStatusEntryService } from '../src/status-model.ts'

function consumer() {
  const cleanups: (() => void)[] = []
  return {
    effect(callback: () => void | (() => void)): void {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    dispose(): void { for (const cleanup of cleanups.splice(0)) cleanup() },
  }
}

describe('plugin host view bridge', () => {
  it('mounts, refreshes, restores, and unloads additive status contributions', async () => {
    const host = new BluePluginHostService(new Context())
    let redraws = 0
    const screen = {
      requestRender(): void { redraws += 1 },
    } as BlueScreen
    const statusModels = new BlueStatusEntryService(new Context(), screen)
    const effects: (() => void)[] = []
    const ctx = {
      bluePluginControl: createBluePluginControl(host),
      blueStatusEntries: statusModels,
      effect(callback: () => void | (() => void)): void {
        const cleanup = callback()
        if (typeof cleanup === 'function') effects.push(cleanup)
      },
    } as unknown as Context
    apply(ctx)

    const owner = consumer()
    const manifest: BluePluginManifest = { id: '@acme/view', api: '^1.0.0-beta.1', capabilities: ['status'] }
    const opened = host.open(owner, manifest)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    let health = 'healthy'
    const status = opened.value.status!.register({ id: 'health', render: () => ({ kind: 'text', content: health, tone: 'success' }) })
    const emptyStatus = opened.value.status!.register({ id: 'quiet', render: () => null })
    const codeStatus = opened.value.status!.register({ id: 'code', render: () => ({ kind: 'code', code: 'const x = 1', language: 'ts' }) })
    const plainStatus = opened.value.status!.register({ id: 'plain', render: () => ({ kind: 'text', content: 'plain' }) })
    const codePlainStatus = opened.value.status!.register({ id: 'code-plain', render: () => ({ kind: 'code', code: 'plain' }) })
    const diffStatus = opened.value.status!.register({ id: 'diff', render: () => ({ kind: 'diff', before: 'old', after: 'new' }) })
    const fieldsStatus = opened.value.status!.register({ id: 'fields', render: () => ({ kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok', tone: 'success' }] }] }) })
    const sectionsStatus = opened.value.status!.register({ id: 'sections', render: () => ({ kind: 'sections', sections: [{ body: { kind: 'text', content: 'body' } }, { title: 'collapsed', body: { kind: 'code', code: 'x' }, collapsed: true }] }) })
    const failedStatus = opened.value.status!.register({ id: 'failed', render: () => { throw new Error('status exploded') } })
    expect(status.ok && emptyStatus.ok && codeStatus.ok && plainStatus.ok && codePlainStatus.ok && diffStatus.ok && fieldsStatus.ok && sectionsStatus.ok && failedStatus.ok).toBe(true)
    expect(statusModels.list().find(model => model.id === 'plugin.status.health')?.node).toEqual({ kind: 'text', content: 'healthy', tone: 'success' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.quiet')?.visible).toBe(false)
    expect(statusModels.list().find(model => model.id === 'plugin.status.code')?.node).toEqual({ kind: 'code', code: 'const x = 1', language: 'ts' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.plain')?.node).toEqual({ kind: 'text', content: 'plain' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.code-plain')?.node).toEqual({ kind: 'code', code: 'plain' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.diff')?.node).toEqual({ kind: 'diff', before: 'old', after: 'new' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.fields')?.node).toEqual({ kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok', tone: 'success' }] }] })
    expect(statusModels.list().find(model => model.id === 'plugin.status.sections')?.node).toEqual({ kind: 'sections', sections: [{ body: { kind: 'text', content: 'body' } }, { title: 'collapsed', body: { kind: 'code', code: 'x' }, collapsed: true }] })
    expect(statusModels.list().find(model => model.id === 'plugin.status.failed')?.node).toEqual({ kind: 'text', content: 'Status plugin.status.failed failed', tone: 'danger' })
    expect(redraws).toBeGreaterThan(0)
    if (!status.ok) return
    const beforeRefresh = redraws
    health = 'refreshed'
    expect(status.value.refresh()).toMatchObject({ ok: true })
    await Promise.resolve()
    expect(redraws).toBeGreaterThan(beforeRefresh)
    expect(statusModels.list().find(model => model.id === 'plugin.status.health')?.node).toEqual({ kind: 'text', content: 'refreshed', tone: 'success' })

    for (const cleanup of effects.splice(0)) cleanup()
    expect(statusModels.list()).toHaveLength(0)
    expect(opened.value.status!.register({ id: 'absent', render: () => ({ kind: 'text', content: 'absent' }) })).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })

    apply(ctx)
    expect(statusModels.list().find(model => model.id === 'plugin.status.health')?.visible).toBe(true)
    for (const cleanup of effects.splice(0)) cleanup()
    owner.dispose()
  })
})
