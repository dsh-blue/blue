/**
 * Public host, capability, composition, and Fiber lifecycle tests for all
 * publish-shaped ecosystem examples.
 *
 * @module @dsh-blue-example/user-kit/tests/ecosystem
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  BluePluginHostService,
  type BlueCapability,
} from '../../../packages/api/src/index.ts'
import { apply as applyBundle } from '../../blue-ecosystem/src/index.ts'
import { apply as applyBottomLog } from '../../bottom-log/src/index.ts'
import { apply as applyEditorProvider, editorProvider } from '../../editor-provider/src/index.ts'
import { apply as applyHeader } from '../../header/src/index.ts'
import { apply as applyOverlay } from '../../overlay/src/index.ts'
import { apply as applyInspector } from '../../right-inspector/src/index.ts'
import { apply as applyStatusProvider, statusProvider } from '../../status-provider/src/index.ts'
import { summaryMetric } from '../src/index.ts'

class Scope {
  readonly bluePluginHost: BluePluginHostService
  private readonly cleanups: (() => void)[] = []

  constructor(host: BluePluginHostService) {
    this.bluePluginHost = host
  }

  effect(callback: () => () => void): void {
    this.cleanups.push(callback())
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
  }
}

const allCapabilities: readonly BlueCapability[] = [
  'commands', 'panes', 'overlays', 'status.provider', 'editor.provider',
]

type OwnerLease = ReturnType<Context['bluePluginControl']['attachCapabilities']>

function snapshot(lease: OwnerLease) {
  const result = lease.snapshot()
  if (!result.ok) throw new Error(result.message)
  return result.value
}

function world(capabilities: readonly BlueCapability[] = allCapabilities): {
  readonly host: BluePluginHostService
  readonly lease: OwnerLease
  readonly owner: Scope
  readonly consumer: Scope
} {
  const ctx = new Context()
  const host = new BluePluginHostService(ctx)
  const control = ctx.get('bluePluginControl')!
  const owner = new Scope(host)
  const consumer = new Scope(host)
  const lease = control.attachCapabilities(owner, capabilities)
  return { host, lease, owner, consumer }
}

function applyAll(scope: Scope): void {
  const ctx = scope as unknown as Context
  applyHeader(ctx)
  applyInspector(ctx)
  applyBottomLog(ctx)
  applyOverlay(ctx)
  applyStatusProvider(ctx)
  applyEditorProvider(ctx)
}

describe('shared user kit', () => {
  it('builds deeply frozen standard nodes without a plugin manifest or host capability', () => {
    const node = summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k' })
    expect(node).toMatchObject({ kind: 'surface', child: { kind: 'stack', direction: 'row' } })
    expect(Object.isFrozen(node)).toBe(true)
    expect(Object.isFrozen(node.child)).toBe(true)
    const packageRoot = join(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.blue).toBeUndefined()
    expect(manifest.dsh).toBeUndefined()
  })
})

describe('plugin capabilities and lifecycle', () => {
  it('leaves no contribution when the owning host capability is absent', () => {
    const { lease, consumer } = world(['notifications.publish'])
    applyAll(consumer)
    expect(snapshot(lease)).toMatchObject({
      commands: [], panes: [], overlays: [], statusProviders: [], editorProviders: [],
    })
    consumer.dispose()
  })

  it('registers six opt-in examples and removes every contribution on Fiber unload', () => {
    const { lease, consumer } = world()
    applyAll(consumer)
    const current = snapshot(lease)
    expect(current.panes.map(entry => [entry.id, entry.contribution.placement])).toEqual([
      ['example.header.summary', 'header'],
      ['example.inspector.context', 'right'],
      ['example.log.recent', 'bottom'],
    ])
    expect(current.commands.map(entry => entry.id)).toEqual(['example-overlay'])
    expect(current.statusProviders.map(entry => entry.id)).toEqual(['example.status.compact'])
    expect(current.editorProviders.map(entry => entry.id)).toEqual(['example.editor.focused'])
    for (const pane of current.panes) expect(pane.contribution.render()).not.toBeNull()

    consumer.dispose()
    expect(snapshot(lease)).toMatchObject({
      commands: [], panes: [], overlays: [], statusProviders: [], editorProviders: [],
    })
  })

  it('opens the capturing overlay only inside an owner-minted gesture and rejects late use', async () => {
    const { lease, consumer } = world()
    applyOverlay(consumer as unknown as Context)
    const command = snapshot(lease).commands[0]!
    await expect(command.execute([], {})).resolves.toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    expect(snapshot(lease).overlays).toEqual([])

    let retained: Parameters<typeof command.execute>[1] extends { userGesture?: infer Gesture } ? Gesture : never
    await lease.runUserGesture('commands', async userGesture => {
      retained = userGesture
      await expect(command.execute([], { userGesture })).resolves.toMatchObject({ ok: true })
    })
    expect(snapshot(lease).overlays.map(entry => entry.id)).toEqual(['example.overlay.details'])
    expect(snapshot(lease).overlays[0]!.request.render()).toMatchObject({ kind: 'stack' })
    await expect(command.execute([], { userGesture: retained })).resolves.toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })

    consumer.dispose()
    expect(snapshot(lease).overlays).toEqual([])
    await lease.runUserGesture('commands', async userGesture => {
      await expect(command.execute([], { userGesture })).resolves.toMatchObject({ ok: false })
    })
  })

  it('keeps provider candidates inert and exposes valid trees without writing selection state', () => {
    const { lease, consumer } = world()
    applyStatusProvider(consumer as unknown as Context)
    applyEditorProvider(consumer as unknown as Context)
    expect(snapshot(lease).statusProviders).toEqual([statusProvider])
    expect(snapshot(lease).editorProviders).toEqual([editorProvider])

    expect(statusProvider.render({ session: null, entries: [], busy: false })).toMatchObject({ kind: 'stack' })
    expect(statusProvider.render({
      session: { id: 's', cwd: '/tmp', status: 'running', mode: 'plan', model: { id: 'deepseek-chat' } },
      entries: [],
      busy: true,
    })).toMatchObject({ children: [{ node: { content: 'Working' } }, { node: { content: 'deepseek-chat' } }, { node: { content: 'plan' } }] })

    const normal = editorProvider.render({ mode: 'normal', busy: false, attachments: [], extensions: [] })
    const plan = editorProvider.render({
      mode: 'plan', busy: true,
      attachments: [{ id: 'a', label: 'image.png' }],
      extensions: [{ id: 'ext' }],
    })
    expect(normal).toMatchObject({ title: 'Message', badges: [{ text: 'ready' }] })
    expect(plan).toMatchObject({ title: 'plan message', badges: [{ text: 'working' }] })
    expect(JSON.stringify(plan).match(/editor-control/gu)).toHaveLength(1)
  })

  it('ships a six-row opt-in composition and keeps its empty module Fiber-owned', () => {
    const patch = readFileSync(join(import.meta.dirname, '..', '..', 'blue-ecosystem', 'cordis.patch.yml'), 'utf8')
    expect(patch.match(/^\s+- id: '@dsh-blue-example\//gmu)).toHaveLength(6)
    const { consumer } = world()
    applyBundle(consumer as unknown as Context)
    consumer.dispose()
  })
})
