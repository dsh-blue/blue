/**
 * Owner bridge tests for additive dock/status projection and lifecycle.
 *
 * @module @dsh-blue/blue-transcript/tests/plugin-host-bridge
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { BluePluginHostService } from '../../api/src/host.ts'
import type { BluePluginManifest } from '../../api/src/manifest.ts'
import type { BlueComponent, BlueScreen, BlueSemanticColors } from '@dsh-blue/blue-core'
import { apply } from '../src/plugin-host-bridge.ts'
import { BlueStatusModelService } from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'

const colors = new Proxy({}, { get: () => (text: string) => text }) as BlueSemanticColors

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
  it('mounts, orders, hot-replaces, and unloads bounded dock/status contributions', () => {
    const host = new BluePluginHostService(new Context())
    const mounted: BlueComponent[] = []
    let redraws = 0
    const screen = {
      addBottomChild(component: BlueComponent): () => void {
        mounted.push(component)
        return () => { const index = mounted.indexOf(component); if (index >= 0) mounted.splice(index, 1) }
      },
      requestRender(): void { redraws += 1 },
    } as BlueScreen
    const statusModels = new BlueStatusModelService(new Context(), screen)
    const effects: (() => void)[] = []
    const ctx = {
      bluePluginHost: host,
      blueScreen: screen,
      blueStatusModels: statusModels,
      blueTheme: { colors },
      blueComponents: fakeBlueComponents(),
      effect(callback: () => void | (() => void)): void {
        const cleanup = callback()
        if (typeof cleanup === 'function') effects.push(cleanup)
      },
    } as unknown as Context
    apply(ctx)

    const owner = consumer()
    const manifest: BluePluginManifest = { id: '@acme/view', api: '^1.0.0', capabilities: ['dock', 'status'] }
    const opened = host.open(owner, manifest)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const later = opened.value.dock!.register({ id: 'later', priority: 20, preferredRows: 1, view: { kind: 'text', content: 'later\ncut' } })
    const first = opened.value.dock!.register({ id: 'first', priority: 1, view: () => ({ kind: 'text', content: 'first' }) })
    const zeroRows = opened.value.dock!.register({ id: 'zero', preferredRows: 0, view: { kind: 'text', content: 'zero' } })
    const hugeRows = opened.value.dock!.register({ id: 'huge', preferredRows: 20, view: { kind: 'text', content: 'huge' } })
    const status = opened.value.status!.register({ id: 'health', render: () => ({ kind: 'text', content: 'healthy', tone: 'success' }) })
    const emptyStatus = opened.value.status!.register({ id: 'quiet', render: () => null })
    const codeStatus = opened.value.status!.register({ id: 'code', render: () => ({ kind: 'code', code: 'const x = 1', language: 'ts' }) })
    const plainStatus = opened.value.status!.register({ id: 'plain', render: () => ({ kind: 'text', content: 'plain' }) })
    const codePlainStatus = opened.value.status!.register({ id: 'code-plain', render: () => ({ kind: 'code', code: 'plain' }) })
    const diffStatus = opened.value.status!.register({ id: 'diff', render: () => ({ kind: 'diff', before: 'old', after: 'new' }) })
    const fieldsStatus = opened.value.status!.register({ id: 'fields', render: () => ({ kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok', tone: 'success' }] }] }) })
    const sectionsStatus = opened.value.status!.register({ id: 'sections', render: () => ({ kind: 'sections', sections: [{ body: { kind: 'text', content: 'body' } }, { title: 'collapsed', body: { kind: 'code', code: 'x' }, collapsed: true }] }) })
    expect(later.ok && first.ok && zeroRows.ok && hugeRows.ok && status.ok && emptyStatus.ok && codeStatus.ok && plainStatus.ok && codePlainStatus.ok && diffStatus.ok && fieldsStatus.ok && sectionsStatus.ok).toBe(true)
    expect(mounted).toHaveLength(4)
    expect(mounted.map(component => component.render(80)[0])).toEqual([' first', ' later', undefined, ' huge'])
    expect(statusModels.list().find(model => model.id === 'plugin.status.health')?.view).toEqual({ kind: 'text', text: 'healthy', tone: 'success' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.quiet')?.visible).toBe(false)
    expect(statusModels.list().find(model => model.id === 'plugin.status.code')?.view).toEqual({ kind: 'code', code: 'const x = 1', language: 'ts' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.plain')?.view).toEqual({ kind: 'text', text: 'plain' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.code-plain')?.view).toEqual({ kind: 'code', code: 'plain' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.diff')?.view).toEqual({ kind: 'diff', before: 'old', after: 'new' })
    expect(statusModels.list().find(model => model.id === 'plugin.status.fields')?.view).toEqual({ kind: 'fields', fields: [{ label: 'state', value: 'ok' }] })
    expect(statusModels.list().find(model => model.id === 'plugin.status.sections')?.view).toEqual({ kind: 'sections', sections: [{ title: '', body: { kind: 'text', text: 'body' } }, { title: 'collapsed', body: { kind: 'code', code: 'x' }, collapsed: true }] })
    expect(redraws).toBeGreaterThan(0)

    if (first.ok) first.value.dispose()
    expect(mounted).toHaveLength(3)
    expect(mounted[0]!.render(80)).toEqual([' later'])
    for (const cleanup of effects.splice(0)) cleanup()
    expect(mounted).toEqual([])
    expect(statusModels.list()).toHaveLength(0)
    owner.dispose()
  })
})
