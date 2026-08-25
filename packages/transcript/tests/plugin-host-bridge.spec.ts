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
import type { BlueStatusEntry } from '../src/types.ts'
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
    const statuses = new Map<string, BlueStatusEntry>()
    const effects: (() => void)[] = []
    const ctx = {
      bluePluginHost: host,
      blueScreen: screen,
      blueStatus: {
        register(entry: BlueStatusEntry): () => void {
          if (statuses.has(entry.id)) throw new Error(`duplicate ${entry.id}`)
          statuses.set(entry.id, entry)
          return () => { statuses.delete(entry.id) }
        },
      },
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
    const status = opened.value.status!.register({ id: 'health', render: () => ({ kind: 'text', content: 'healthy', tone: 'success' }) })
    const emptyStatus = opened.value.status!.register({ id: 'quiet', render: () => null })
    expect(later.ok && first.ok && status.ok && emptyStatus.ok).toBe(true)
    expect(mounted).toHaveLength(2)
    expect(mounted.map(component => component.render(80)[0])).toEqual([' first', ' later'])
    expect([...statuses.values()][0]!.render(80)).toBe('healthy')
    expect(statuses.get('plugin.status.quiet')!.render(80)).toBe('')
    expect(redraws).toBeGreaterThan(0)

    if (first.ok) first.value.dispose()
    expect(mounted).toHaveLength(1)
    expect(mounted[0]!.render(80)).toEqual([' later'])
    for (const cleanup of effects.splice(0)) cleanup()
    expect(mounted).toEqual([])
    expect(statuses.size).toBe(0)
    owner.dispose()
  })
})
