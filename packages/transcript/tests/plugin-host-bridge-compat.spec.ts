/**
 * Compatibility coverage for additive status host snapshot revisions.
 *
 * @module @dsh-blue/blue-transcript/tests/plugin-host-bridge-compat
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueComponents, BlueScreen, BlueSemanticColors } from '@dsh-blue/blue-core'
import { BlueStatusEntryService } from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'

interface HostSnapshot {
  readonly status: readonly StatusContribution[]
  readonly statusRevision?: number
  readonly revision?: number
}

interface StatusContribution {
  readonly id: string
  readonly render: () => { readonly kind: 'text', readonly content: string }
}

const host = vi.hoisted(() => ({
  attach: vi.fn(),
  listeners: new Set<(snapshot: HostSnapshot) => void>(),
  disposed: 0,
}))

function control() {
  return {
    attachCapabilities: host.attach,
    subscribe(listener: (snapshot: HostSnapshot) => void) {
    host.listeners.add(listener)
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

import * as bridgePlugin from '../src/plugin-host-bridge.ts'

const colors = new Proxy({}, { get: () => (text: string) => text }) as BlueSemanticColors
const roots: Context[] = []

beforeEach(() => {
  host.attach.mockReset()
  host.listeners.clear()
  host.disposed = 0
})

afterEach(async () => {
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

function provide(ctx: Context, name: string, value: unknown): void {
  ctx.reflect.provide(name, value)
}

function emit(snapshot: HostSnapshot): void {
  for (const listener of host.listeners) listener(snapshot)
}

describe('plugin host bridge revision compatibility', () => {
  it('prefers the status revision, falls back to the aggregate revision, then zero', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const screen = { requestRender: vi.fn() } as unknown as BlueScreen
    const registry = new BlueStatusEntryService(ctx, screen)
    const contribution: StatusContribution = {
      id: 'health',
      render: () => ({ kind: 'text', content: 'healthy' }),
    }
    let refreshes = 0
    registry.subscribe(() => { refreshes += 1 })

    provide(ctx, 'bluePluginControl', control())
    provide(ctx, 'blueScreen', screen)
    provide(ctx, 'blueTheme', { colors })
    provide(ctx, 'blueComponents', fakeBlueComponents() as BlueComponents)
    const fiber = await ctx.plugin(bridgePlugin)

    emit({ status: [contribution], statusRevision: 7, revision: 70 })
    expect(registry.list()).toEqual([{
      id: 'plugin.status.health',
      priority: 50,
      row: 2,
      node: { kind: 'text', content: 'healthy' },
      visible: true,
      overflow: 'truncate',
    }])
    refreshes = 0

    emit({ status: [contribution], statusRevision: 7, revision: 71 })
    expect(refreshes).toBe(0)
    emit({ status: [contribution], statusRevision: 8, revision: 71 })
    expect(refreshes).toBe(1)

    emit({ status: [contribution], revision: 72 })
    expect(refreshes).toBe(2)
    emit({ status: [contribution], revision: 72 })
    expect(refreshes).toBe(2)

    emit({ status: [contribution] })
    expect(refreshes).toBe(3)
    emit({ status: [contribution] })
    expect(refreshes).toBe(3)

    emit({ status: [] })
    expect(registry.list()).toEqual([])
    expect(refreshes).toBe(4)
    emit({ status: [contribution] })
    expect(registry.list()).toHaveLength(1)
    expect(refreshes).toBe(6)

    expect(host.attach).toHaveBeenCalledWith(expect.anything(), ['status'])
    await fiber.dispose()
    expect(host.disposed).toBe(1)
    expect(host.listeners).toHaveLength(0)
    expect(registry.list()).toEqual([])

    emit({ status: [contribution], statusRevision: 9, revision: 90 })
    expect(refreshes).toBe(7)
  })
})
