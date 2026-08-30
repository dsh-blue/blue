/**
 * End-to-end overlay/event/focus contract for the public plugin surface bridge.
 *
 * @module @dsh-blue/blue-core/tests/plugin-surface-bridge-overlay
 */

import { Context } from '@deepseek-ai/cordis'
import { stripTerminalSequences, type Component } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BluePluginHostService,
  type BluePluginApi,
  type BluePublicOverlayHandle,
  type BlueResult,
  type BlueUiEventContext,
  type BlueUiNode,
  type BlueUserGesture,
} from '../../api/src/index.ts'
import { attachBluePluginHostCapabilities, createBluePluginControl, runBlueUserGesture, snapshotBluePluginHost } from '../../api/src/host.ts'
import { ui } from '../../ui/src/index.ts'
import { mountPluginSurfaceBridge } from '../src/plugin-surface-bridge.ts'
import { startBlueTerminal, type BlueTerminalRuntime } from '../src/terminal.ts'
import type { BlueComponents, BlueFocusable, BlueKeyAction, BlueSemanticColors } from '../src/types.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { createFakeEditor } from './fake-editor.ts'
import { FakeTerminal } from './fake-terminal.ts'

interface EffectOwner {
  effect(callback: () => void | (() => void)): void
  dispose(): void
}

interface OverlayStackEntry {
  readonly component: Component
  readonly options?: {
    readonly nonCapturing?: boolean
    readonly width?: number | string
    readonly minWidth?: number
    readonly maxHeight?: number | string
    readonly anchor?: string
  }
  readonly preFocus: Component | null
}

interface TuiInternals {
  getFocusedComponent(): Component | null
  readonly overlayStack: OverlayStackEntry[]
}

interface Fixture {
  readonly host: BluePluginHostService
  readonly owner: EffectOwner
  readonly consumer: EffectOwner
  readonly api: BluePluginApi
  readonly terminal: FakeTerminal
  readonly runtime: BlueTerminalRuntime
  readonly stack: () => OverlayStackEntry[]
  openCapturing(request: Parameters<NonNullable<BluePluginApi['overlays']>['open']>[0]): Promise<BlueResult<BluePublicOverlayHandle>>
  openApi(id: string): { readonly api: BluePluginApi, readonly consumer: EffectOwner }
  dispose(): Promise<void>
}

function effectOwner(extra: Record<string, unknown> = {}): EffectOwner & Record<string, unknown> {
  const cleanups: Array<() => void> = []
  return {
    ...extra,
    effect(callback: () => void | (() => void)): void {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    dispose(): void {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup()
    },
  }
}

const colors = new Proxy({}, {
  get: () => (text: string) => text,
}) as BlueSemanticColors

const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
  createEditor: createFakeEditor,
} as BlueComponents

async function flush(turns = 6): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('condition did not settle')
}

async function fixture(columns = 80, rows = 24): Promise<Fixture> {
  const root = new Context()
  const host = new BluePluginHostService(root)
  const terminal = new FakeTerminal(columns, rows)
  const runtime = await startBlueTerminal(terminal, () => Promise.resolve(undefined))
  const keyActions: BlueKeyAction[] = []
  const owner = effectOwner({
    bluePluginControl: createBluePluginControl(host),
    blueComponents: components,
    blueTheme: { colors },
    blueKeymap: {
      register(actions: BlueKeyAction[]) {
        keyActions.push(...actions)
        return () => { for (const action of actions) keyActions.splice(keyActions.indexOf(action), 1) }
      },
      matches: () => false,
      dispatch: () => false,
    },
  })
  mountPluginSurfaceBridge(owner as never, runtime)

  const openApi = (id: string) => {
    const consumer = effectOwner()
    const opened = host.open(consumer, { id, api: '^1.0.0-beta.1', capabilities: ['overlays'] })
    if (!opened.ok) throw new Error(opened.message)
    return { api: opened.value, consumer }
  }
  const primary = openApi('@acme/overlay-tests')
  const stack = () => (runtime.tui as unknown as TuiInternals).overlayStack

  return {
    host,
    owner,
    consumer: primary.consumer,
    api: primary.api,
    terminal,
    runtime,
    stack,
    openCapturing: request => runBlueUserGesture(host, owner, gesture => primary.api.overlays!.open(request, { userGesture: gesture })),
    openApi,
    async dispose() {
      primary.consumer.dispose()
      owner.dispose()
      await runtime.stop()
      await root.fiber.dispose()
    },
  }
}

function actionNode(id = 'go', confirm?: string): BlueUiNode {
  return ui.actions({ id: 'actions', items: [{ id, label: id, ...(confirm === undefined ? {} : { confirm }) }] })
}

function inputNode(id = 'value'): BlueUiNode {
  return ui.form({ id: 'form', fields: [{ kind: 'input', id, label: id, value: '' }] })
}

async function settleInput(component: Component, input: string): Promise<void> {
  component.handleInput?.(input)
  await flush()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('plugin surface bridge overlays', () => {
  it('closes opened overlays when the renderer owner enters a gap', async () => {
    const f = await fixture()
    try {
      const opened = f.api.overlays!.open({ id: 'owner-gap-overlay', render: () => ui.text('gap') })
      expect(opened.ok).toBe(true)
      await flush()
      expect(f.stack()).toHaveLength(1)
      f.owner.dispose()
      expect(f.stack()).toHaveLength(0)
      expect(snapshotBluePluginHost(f.host).overlays).toEqual([])
      expect(opened.ok && opened.value.closed).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('closes an overlay still pending its first renderer reconciliation on owner unload', async () => {
    const f = await fixture()
    try {
      const opened = f.api.overlays!.open({ id: 'pending-owner-gap-overlay', render: () => ui.text('pending') })
      expect(opened.ok).toBe(true)
      expect(f.stack()).toHaveLength(0)
      f.owner.dispose()
      await flush()
      expect(f.stack()).toHaveLength(0)
      expect(snapshotBluePluginHost(f.host).overlays).toEqual([])
      expect(opened.ok && opened.value.closed).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('admits passive content, rejects all potential passive controls, and admits capturing controls only with a gesture', async () => {
    const f = await fixture()
    try {
      const passive = f.api.overlays!.open({ id: 'passive', render: () => ui.text('passive') })
      expect(passive).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()).toHaveLength(1)
      expect(f.stack()[0]!.options?.nonCapturing).toBe(true)

      const responsive = f.api.overlays!.open({
        id: 'hidden-control',
        render: () => ui.stack.column([
          ui.child(actionNode(), { when: { minWidth: 10_000 } }),
        ]),
      })
      expect(responsive).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()[1]!.component.render(56).join(' ')).toContain('non-capturing overlays cannot contain interactive controls')

      expect(f.api.overlays!.open({ id: 'forbidden-modal', capturing: true, render: () => actionNode() })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      await expect(f.openCapturing({ id: 'modal', capturing: true, render: () => actionNode() })).resolves.toMatchObject({ ok: true })
      await flush()
      expect(f.runtime.hasCapturingOverlay()).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('implements passive dismissal, two-step confirmation Escape, and non-dismissible Escape', async () => {
    const f = await fixture()
    try {
      const passive = await f.openCapturing({ id: 'passive-modal', capturing: true, render: () => ui.text('message') })
      expect(passive.ok).toBe(true)
      await flush()
      await settleInput(f.stack()[0]!.component, '\x1b')
      expect(passive.ok && passive.value.closed).toBe(true)

      const confirmed = await f.openCapturing({ id: 'confirmed', capturing: true, render: () => actionNode('delete', 'Confirm delete') })
      expect(confirmed.ok).toBe(true)
      await flush()
      const component = f.stack()[0]!.component
      await settleInput(component, '\r')
      await settleInput(component, '\x1b')
      expect(confirmed.ok && confirmed.value.closed).toBe(false)
      await settleInput(component, '\x1b')
      expect(confirmed.ok && confirmed.value.closed).toBe(true)

      const fixed = await f.openCapturing({ id: 'fixed', capturing: true, dismissible: false, render: () => ui.text('fixed') })
      expect(fixed.ok).toBe(true)
      await flush()
      await settleInput(f.stack()[0]!.component, '\x1b')
      expect(fixed.ok && fixed.value.closed).toBe(false)
      expect(fixed.ok && fixed.value.refresh()).toMatchObject({ ok: true })
      await flush()
      await settleInput(f.stack()[0]!.component, '\x1b')
      expect(fixed.ok && fixed.value.closed).toBe(false)
    } finally {
      await f.dispose()
    }
  })

  it('maps every public anchor and contains null renders with explicit numeric geometry', async () => {
    const f = await fixture(80, 24)
    try {
      const anchors = [
        ['top', 'top-center'],
        ['bottom', 'bottom-center'],
        ['left', 'left-center'],
        ['right', 'right-center'],
      ] as const
      for (const [anchor, expected] of anchors) {
        const opened = f.api.overlays!.open({ id: `anchor-${anchor}`, anchor, render: () => ui.text(anchor) })
        expect(opened.ok).toBe(true)
        await flush()
        expect(f.stack()[0]!.options?.anchor).toBe(expected)
        if (opened.ok) opened.value.close()
        await flush()
      }

      const nullRender = f.api.overlays!.open({ id: 'null-render', render: () => null as never })
      expect(nullRender.ok).toBe(true)
      await flush()
      expect(f.stack()[0]!.component.render(56).join(' ')).toContain('overlay render returned no node')
      if (nullRender.ok) nullRender.value.close()
      await flush()

      const hostileKind = 'x'.repeat(20_001)
      const doubleFailure = f.api.overlays!.open({ id: 'double-failure', render: () => ({ kind: hostileKind }) as never })
      expect(doubleFailure.ok).toBe(true)
      await flush()
      const errorRows = f.stack()[0]!.component.render(40)
      expect(errorRows.join(' ')).toContain('Blue UI rejected')
      expect(errorRows.every(row => visibleWidth(row) <= 40)).toBe(true)
      if (doubleFailure.ok) doubleFailure.value.close()
      await flush()

      const revoked = Proxy.revocable({}, {})
      const hostileRender = f.api.overlays!.open({ id: 'hostile-render', render: () => { throw revoked.proxy } })
      expect(hostileRender.ok).toBe(true)
      revoked.revoke()
      await flush()
      expect(f.stack()[0]!.component.render(40).join(' ')).toContain('Plugin overlay failed: render failed')
      if (hostileRender.ok) hostileRender.value.close()
      await flush()

      const numeric = f.api.overlays!.open({
        id: 'numeric-geometry',
        width: 40,
        minWidth: 20,
        maxHeight: 10,
        render: () => ui.stack.column([
          ui.child(ui.text('numeric'), { when: { minWidth: 40, maxWidth: 40, minHeight: 10, maxHeight: 10 } }),
        ]),
      })
      expect(numeric.ok).toBe(true)
      await flush()
      const entry = f.stack()[0]!
      expect(entry.options).toMatchObject({ width: 40, minWidth: 20, maxHeight: 10, anchor: 'center' })
      expect(entry.component.render(40)).toEqual(['numeric'])
      expect(numeric.ok && numeric.value.refresh()).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()[0]!.component).toBe(entry.component)

      expect(numeric.ok && numeric.value.refresh()).toMatchObject({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
      f.owner.dispose()
      await flush()
      expect(f.stack()).toHaveLength(0)
    } finally {
      await f.dispose()
    }
  })

  it('renders request titles through canonical overlay chrome across content failures', async () => {
    const f = await fixture()
    try {
      const titled = f.api.overlays!.open({ id: 'titled', title: 'Plugin details', render: () => ui.text('body') })
      expect(titled.ok).toBe(true)
      await flush()
      const wideRows = f.stack()[0]!.component.render(40)
      expect(wideRows[0]).toMatch(/^╭ Plugin details ─+╮$/u)
      expect(wideRows[1]).toMatch(/^│ body +│$/u)
      expect(wideRows[2]).toMatch(/^╰─+╯$/u)
      expect(wideRows.join('\n').match(/╭/gu)).toHaveLength(1)
      expect(f.stack()[0]!.component.render(8)).toEqual(['╭ Plu ─╮', '│ body │', '╰──────╯'])
      expect(titled.ok && titled.value.refresh()).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()[0]!.component.render(40).join('\n')).toContain('╭ Plugin details')
      if (titled.ok) titled.value.close()
      await flush()

      const empty = f.api.overlays!.open({ id: 'titled-empty', title: 'Empty result', render: () => null as never })
      expect(empty.ok).toBe(true)
      await flush()
      const emptyRows = f.stack()[0]!.component.render(80).join('\n')
      expect(emptyRows).toContain('╭ Empty result')
      expect(emptyRows).toContain('overlay render returned no node')
      if (empty.ok) empty.value.close()
      await flush()

      const failed = f.api.overlays!.open({ id: 'titled-failed', title: 'Failed result', render: () => { throw new Error('title render failed') } })
      expect(failed.ok).toBe(true)
      await flush()
      const failedRows = f.stack()[0]!.component.render(80).join('\n')
      expect(failedRows).toContain('╭ Failed result')
      expect(failedRows).toContain('title render failed')
    } finally {
      await f.dispose()
    }
  })

  it('keeps a closed frame when long plugin content reaches the overlay height budget', async () => {
    const f = await fixture(40, 10)
    try {
      const opened = f.api.overlays!.open({
        id: 'bounded-frame',
        title: 'Bounded',
        maxHeight: 5,
        render: () => ui.scroll(ui.stack.column(Array.from({ length: 10 }, (_, index) => ui.text(`line-${String(index)}`))), { scrollbar: true }),
      })
      expect(opened.ok).toBe(true)
      await flush()

      const rows = f.stack()[0]!.component.render(20)
      expect(rows).toHaveLength(5)
      expect(rows[0]).toMatch(/^╭ Bounded ─+╮$/u)
      expect(rows.at(-1)).toBe('╰──────────────────╯')
      expect(rows.slice(1, -1).map(stripTerminalSequences).every(row => /^│.*│$/u.test(row))).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('keeps a titled frame and focus stable through refresh, then restores focus on consumer unload', async () => {
    const f = await fixture()
    try {
      const base: BlueFocusable = { focused: false, render: () => ['base'], invalidate: () => {} }
      f.runtime.addChild(base)
      f.runtime.setFocus(base)
      const opened = await f.openCapturing({
        id: 'framed-lifecycle',
        title: 'Lifecycle',
        capturing: true,
        render: () => actionNode(),
      })
      expect(opened.ok).toBe(true)
      await flush()
      const component = f.stack()[0]!.component
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(component)
      expect((component as BlueFocusable).focused).toBe(true)
      expect(component.render(20)[0]).toMatch(/^╭ Lifecycle ─+╮$/u)

      expect(opened.ok && opened.value.refresh()).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()[0]!.component).toBe(component)
      expect((component as BlueFocusable).focused).toBe(true)

      f.consumer.dispose()
      await flush()
      expect(f.stack()).toHaveLength(0)
      expect(base.focused).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('drains a newer host snapshot opened reentrantly during initial render', async () => {
    const f = await fixture()
    try {
      let nested: BlueResult<BluePublicOverlayHandle> | undefined
      const outer = f.api.overlays!.open({
        id: 'reentrant-outer',
        render: () => {
          nested ??= f.api.overlays!.open({ id: 'reentrant-inner', render: () => ui.text('inner') })
          return ui.text('outer')
        },
      })
      expect(outer.ok).toBe(true)
      await flush()
      expect(nested).toMatchObject({ ok: true })
      expect(f.stack().map(entry => entry.component.render(56))).toEqual([['outer'], ['inner']])
    } finally {
      await f.dispose()
    }
  })

  it('keeps stack identity and focus stable across refresh and retains normal failures', async () => {
    const f = await fixture()
    try {
      let renders = 0
      let result: BlueResult = { ok: true, value: undefined }
      const opened = await f.openCapturing({
        id: 'stable',
        capturing: true,
        render: () => { renders += 1; return actionNode() },
        onEvent: () => result,
      })
      expect(opened.ok).toBe(true)
      await flush()
      const before = f.stack()[0]!.component
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(before)

      expect(opened.ok && opened.value.refresh()).toMatchObject({ ok: true })
      await flush()
      expect(f.stack()[0]!.component).toBe(before)
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(before)
      expect((before as BlueFocusable).focused).toBe(true)
      expect(() => before.invalidate()).not.toThrow()

      result = { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'no' }
      await settleInput(before, '\r')
      expect(opened.ok && opened.value.closed).toBe(false)
      expect(renders).toBe(2)
      result = { ok: true, value: undefined }
      await settleInput(before, '\x1b')
      expect(opened.ok && opened.value.closed).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('closes on a handler throw and on the 30-second timeout while restoring focus', async () => {
    vi.useFakeTimers()
    const f = await fixture()
    try {
      const base: BlueFocusable = { focused: false, render: () => ['base'], invalidate: () => {} }
      f.runtime.addChild(base)
      f.runtime.setFocus(base)
      const thrown = await f.openCapturing({ id: 'throw', capturing: true, render: () => actionNode(), onEvent: () => { throw new Error('boom') } })
      expect(thrown.ok).toBe(true)
      await flush()
      const thrownComponent = f.stack()[0]!.component
      thrownComponent.handleInput?.('\r')
      await flush()
      expect(thrown.ok && thrown.value.closed).toBe(true)
      expect(base.focused).toBe(true)
      thrownComponent.handleInput?.('\r')
      await flush()
      expect(f.stack()).toHaveLength(0)

      let retained: BlueUserGesture | undefined
      const timeout = await f.openCapturing({
        id: 'timeout',
        capturing: true,
        render: () => actionNode(),
        onEvent: (_event, context) => {
          retained = context.userGesture
          return new Promise<BlueResult>(() => {})
        },
      })
      expect(timeout.ok).toBe(true)
      await flush()
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      expect(retained).toBeDefined()
      await vi.advanceTimersByTimeAsync(30_000)
      await flush()
      expect(timeout.ok && timeout.value.closed).toBe(true)
      expect(base.focused).toBe(true)
      expect(f.api.overlays!.open({ id: 'late-token', capturing: true, render: () => ui.text('late') }, { userGesture: retained })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
    } finally {
      await f.dispose()
    }
  })

  it('does not replay overlays or let stale-generation settlement close a same-id replacement', async () => {
    vi.useFakeTimers()
    const timeoutFixture = await fixture()
    try {
      const timedOut = await timeoutFixture.openCapturing({
        id: 'stale-timeout',
        capturing: true,
        render: () => actionNode(),
        onEvent: () => new Promise<BlueResult>(() => {}),
      })
      expect(timedOut.ok).toBe(true)
      await flush()
      timeoutFixture.stack()[0]!.component.handleInput?.('\r')
      await flush()
      const nextOwner = effectOwner()
      attachBluePluginHostCapabilities(timeoutFixture.host, nextOwner, ['overlays'])
      expect(timedOut.ok && timedOut.value.closed).toBe(true)
      const timeoutReplacement = timeoutFixture.api.overlays!.open({ id: 'stale-timeout', render: () => ui.text('replacement') })
      expect(timeoutReplacement.ok).toBe(true)
      await vi.advanceTimersByTimeAsync(30_000)
      await flush()
      expect(timeoutReplacement.ok && timeoutReplacement.value.closed).toBe(false)
      expect(snapshotBluePluginHost(timeoutFixture.host).overlays.map(entry => entry.id)).toEqual(['stale-timeout'])
      if (timeoutReplacement.ok) timeoutReplacement.value.close()
      nextOwner.dispose()
    } finally {
      await timeoutFixture.dispose()
    }

    const rejectedFixture = await fixture()
    try {
      let reject!: (error: Error) => void
      const rejected = await rejectedFixture.openCapturing({
        id: 'stale-rejection',
        capturing: true,
        render: () => actionNode(),
        onEvent: () => new Promise<BlueResult>((_resolve, reject_) => { reject = reject_ }),
      })
      expect(rejected.ok).toBe(true)
      await flush()
      rejectedFixture.stack()[0]!.component.handleInput?.('\r')
      await flush()
      const nextOwner = effectOwner()
      attachBluePluginHostCapabilities(rejectedFixture.host, nextOwner, ['overlays'])
      expect(rejected.ok && rejected.value.closed).toBe(true)
      const rejectedReplacement = rejectedFixture.api.overlays!.open({ id: 'stale-rejection', render: () => ui.text('replacement') })
      expect(rejectedReplacement.ok).toBe(true)
      reject(new Error('late failure'))
      await flush()
      expect(rejectedReplacement.ok && rejectedReplacement.value.closed).toBe(false)
      expect(snapshotBluePluginHost(rejectedFixture.host).overlays.map(entry => entry.id)).toEqual(['stale-rejection'])
      if (rejectedReplacement.ok) rejectedReplacement.value.close()
      nextOwner.dispose()
    } finally {
      await rejectedFixture.dispose()
    }
  })

  it('keeps event gestures alive only during settlement and serializes FIFO events', async () => {
    const f = await fixture()
    try {
      const other = f.openApi('@acme/nested-events')
      const order: string[] = []
      const releases: Array<() => void> = []
      let retained: BlueUserGesture | undefined
      const opened = await f.openCapturing({
        id: 'fifo',
        capturing: true,
        render: () => ui.actions({ id: 'actions', items: [{ id: 'one', label: 'one' }, { id: 'two', label: 'two' }] }),
        onEvent: async (event, context) => {
          if (event.kind !== 'activate') return { ok: true, value: undefined }
          retained = context.userGesture
          order.push(`start:${event.controlId}`)
          if (event.controlId === 'one') {
            const nested = other.api.overlays!.open({ id: 'nested', capturing: true, render: () => ui.text('nested') }, { userGesture: context.userGesture })
            expect(nested).toMatchObject({ ok: true })
            if (nested.ok) nested.value.close()
          }
          await new Promise<void>(resolve => releases.push(resolve))
          order.push(`end:${event.controlId}`)
          return { ok: true, value: undefined }
        },
      })
      expect(opened.ok).toBe(true)
      await flush()
      const component = f.stack()[0]!.component
      component.handleInput?.('\r')
      component.handleInput?.('\x1b[C')
      component.handleInput?.('\r')
      await flush()
      expect(order).toEqual(['start:one'])
      releases.shift()!()
      await waitUntil(() => order.length === 3)
      expect(order).toEqual(['start:one', 'end:one', 'start:two'])
      releases.shift()!()
      await waitUntil(() => order.length === 4)
      expect(order).toEqual(['start:one', 'end:one', 'start:two', 'end:two'])
      await flush()
      expect(f.api.overlays!.open({ id: 'settled-token', capturing: true, render: () => ui.text('late') }, { userGesture: retained })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      other.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('aborts latest-wins events by control and coalesces successful refreshes', async () => {
    const f = await fixture()
    try {
      const signals: AbortSignal[] = []
      const releases: Array<(result: BlueResult) => void> = []
      let renders = 0
      const opened = await f.openCapturing({
        id: 'latest',
        capturing: true,
        render: () => { renders += 1; return inputNode() },
        onEvent: (_event, context) => new Promise<BlueResult>(resolve => {
          signals.push(context.signal)
          releases.push(resolve)
        }),
      })
      expect(opened.ok).toBe(true)
      await flush()
      const component = f.stack()[0]!.component
      component.handleInput?.('a')
      await flush()
      component.handleInput?.('b')
      await flush()
      expect(signals).toHaveLength(2)
      expect(signals[0]!.aborted).toBe(true)
      expect(signals[1]!.aborted).toBe(false)
      releases[0]!({ ok: true, value: undefined })
      releases[1]!({ ok: true, value: undefined })
      await flush()
      expect(renders).toBe(2)

      if (opened.ok) opened.value.close()
      await flush()

      let coalescedRenders = 0
      const secondApi = f.openApi('@acme/coalesce')
      const coalesced = await runBlueUserGesture(f.host, f.owner, gesture => secondApi.api.overlays!.open({
          id: 'coalesced',
          capturing: true,
          render: () => {
            coalescedRenders += 1
            return ui.form({ id: 'form', fields: [
              { kind: 'input', id: 'left', label: 'left', value: '' },
              { kind: 'input', id: 'right', label: 'right', value: '' },
            ] })
          },
          onEvent: () => ({ ok: true, value: undefined }),
        }, { userGesture: gesture }))
      expect(coalesced.ok).toBe(true)
      await flush()
      const coalescedComponent = f.stack().at(-1)!.component
      coalescedComponent.handleInput?.('x')
      coalescedComponent.handleInput?.('\t')
      coalescedComponent.handleInput?.('y')
      await flush()
      expect(coalescedRenders).toBe(2)
      secondApi.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('fences pending completion after external refresh and consumer unload', async () => {
    const f = await fixture()
    try {
      const observer = f.openApi('@acme/fence-observer')
      const contexts: BlueUiEventContext[] = []
      const releases: Array<(result: BlueResult) => void> = []
      let renders = 0
      const opened = await f.openCapturing({
        id: 'fenced',
        capturing: true,
        render: () => { renders += 1; return actionNode() },
        onEvent: (_event, context) => new Promise<BlueResult>(resolve => { contexts.push(context); releases.push(resolve) }),
      })
      expect(opened.ok).toBe(true)
      await flush()
      f.stack()[0]!.component.handleInput?.('\r')
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      expect(opened.ok && opened.value.refresh()).toMatchObject({ ok: true })
      await flush()
      expect(contexts[0]!.signal.aborted).toBe(true)
      expect(observer.api.overlays!.open({ id: 'external-token', capturing: true, render: () => ui.text('late') }, { userGesture: contexts[0]!.userGesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      expect(renders).toBe(2)
      releases[0]!({ ok: true, value: undefined })
      await flush()
      expect(renders).toBe(2)

      f.stack()[0]!.component.handleInput?.('\r')
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      f.consumer.dispose()
      await flush()
      expect(contexts[1]!.signal.aborted).toBe(true)
      expect(observer.api.overlays!.open({ id: 'unload-token', capturing: true, render: () => ui.text('late') }, { userGesture: contexts[1]!.userGesture })).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED' })
      releases[1]!({ ok: true, value: undefined })
      await flush()
      expect(f.stack()).toHaveLength(0)
      observer.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('cancels a queued overlay refresh when its consumer unloads before render', async () => {
    const f = await fixture()
    try {
      const survivorOwner = f.openApi('@acme/queued-survivor')
      let renders = 0
      const opened = f.api.overlays!.open({
        id: 'queued-unload',
        render: () => { renders += 1; return ui.text(`render-${String(renders)}`) },
      })
      expect(opened.ok).toBe(true)
      const survivor = survivorOwner.api.overlays!.open({ id: 'survivor', render: () => ui.text('survivor') })
      expect(survivor.ok).toBe(true)
      await flush()
      expect(renders).toBe(1)
      expect(f.stack()).toHaveLength(2)

      expect(opened.ok && opened.value.refresh()).toMatchObject({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
      f.consumer.dispose()
      await flush()

      expect(renders).toBe(1)
      expect(f.stack()).toHaveLength(1)
      expect(f.stack()[0]!.component.render(56)).toEqual(['survivor'])
      if (survivor.ok) survivor.value.close()
      await flush()
      expect(f.stack()).toHaveLength(0)
      survivorOwner.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('replaces a rapidly reused overlay id without retaining old work or geometry', async () => {
    const f = await fixture()
    try {
      const replacementOwner = f.openApi('@acme/overlay-replacement')
      let oldRenders = 0
      let newRenders = 0
      let oldEvents = 0
      let newEvents = 0
      const old = await f.openCapturing({
        id: 'reused',
        capturing: true,
        width: 30,
        anchor: 'left',
        render: () => { oldRenders += 1; return actionNode('old') },
        onEvent: () => { oldEvents += 1; return { ok: true, value: undefined } },
      })
      expect(old.ok).toBe(true)
      await flush()
      expect(oldRenders).toBe(1)
      const oldComponent = f.stack()[0]!.component

      expect(old.ok && old.value.refresh()).toMatchObject({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
      f.consumer.dispose()
      const replacement = await runBlueUserGesture(f.host, f.owner, gesture => replacementOwner.api.overlays!.open({
          id: 'reused',
          capturing: true,
          width: 60,
          anchor: 'right',
          render: () => { newRenders += 1; return actionNode('new') },
          onEvent: () => { newEvents += 1; return { ok: true, value: undefined } },
        }, { userGesture: gesture }))
      expect(replacement.ok).toBe(true)
      await flush()

      expect(oldRenders).toBe(1)
      expect(newRenders).toBe(1)
      expect(old.ok && old.value.closed).toBe(true)
      expect(f.stack()).toHaveLength(1)
      const entry = f.stack()[0]!
      expect(entry.component).not.toBe(oldComponent)
      expect(entry.options).toMatchObject({ width: 60, anchor: 'right-center' })
      await settleInput(entry.component, '\r')
      expect(oldEvents).toBe(0)
      expect(newEvents).toBe(1)
      expect(newRenders).toBe(2)
      replacementOwner.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('preserves mixed global stack order and restores valid focus across capturing close and unload', async () => {
    const f = await fixture()
    try {
      const base: BlueFocusable = { focused: false, render: () => ['base'], invalidate: () => {} }
      f.runtime.addChild(base)
      f.runtime.setFocus(base)
      const second = f.openApi('@acme/second-stack')
      const passiveBelow = f.api.overlays!.open({ id: 'passive-below', render: () => ui.text('below') })
      const first = await f.openCapturing({ id: 'outer', capturing: true, render: () => actionNode('outer') })
      const nested = await runBlueUserGesture(f.host, f.owner, gesture => second.api.overlays!.open({ id: 'inner', capturing: true, render: () => actionNode('inner') }, { userGesture: gesture }))
      const passiveAbove = second.api.overlays!.open({ id: 'passive-above', render: () => ui.text('above') })
      expect(passiveBelow.ok && first.ok && nested.ok && passiveAbove.ok).toBe(true)
      await flush()
      expect(f.stack()).toHaveLength(4)
      const [belowComponent, outerComponent, innerComponent, aboveComponent] = f.stack().map(entry => entry.component)
      expect(f.stack().map(entry => entry.options?.nonCapturing === true)).toEqual([true, false, false, true])
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(innerComponent)

      if (nested.ok) nested.value.close()
      await flush()
      expect(f.stack().map(entry => entry.component)).toEqual([belowComponent, outerComponent, aboveComponent])
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(outerComponent)

      f.consumer.dispose()
      await flush()
      expect(f.stack().map(entry => entry.component)).toEqual([aboveComponent])
      expect(base.focused).toBe(true)
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(base)
      expect(outerComponent).not.toBe(innerComponent)
      if (passiveAbove.ok) passiveAbove.value.close()
      await flush()
      expect(f.stack()).toHaveLength(0)
      second.consumer.dispose()
    } finally {
      await f.dispose()
    }
  })

  it('keeps default geometry and compiler viewport aligned across resize', async () => {
    const f = await fixture(80, 20)
    try {
      const opened = f.api.overlays!.open({
        id: 'viewport',
        render: () => ui.stack.column([
          ui.child(ui.text('narrow'), { when: { maxWidth: 56, maxHeight: 16 } }),
          ui.child(ui.text('wide'), { when: { minWidth: 57 } }),
          ui.child(ui.text('tall'), { when: { minHeight: 17 } }),
        ]),
      })
      expect(opened.ok).toBe(true)
      await flush()
      const stackEntry = f.stack()[0]!
      const component = stackEntry.component
      expect(stackEntry.options?.width).toBe(56)
      expect(stackEntry.options?.maxHeight).toBe('80%')
      expect(component.render(56)).toEqual(['narrow'])

      f.terminal.resize(200, 50)
      expect(stackEntry.options?.width).toBe(100)
      expect(component.render(100)).toEqual(['wide', 'tall'])
      f.terminal.resize(80, 20)
      expect(stackEntry.options?.width).toBe(56)
      expect(component.render(56)).toEqual(['narrow'])
    } finally {
      await f.dispose()
    }
  })

  it('recomputes explicit minimum width from live terminal columns', async () => {
    const f = await fixture(40, 20)
    try {
      const opened = f.api.overlays!.open({ id: 'live-minimum', width: '50%', minWidth: 80, render: () => ui.text('live') })
      expect(opened.ok).toBe(true)
      await flush()
      const options = f.stack()[0]!.options!
      expect(options.minWidth).toBe(40)
      expect(options.width).toBe(20)

      f.terminal.resize(200, 20)
      expect(options.minWidth).toBe(80)
      expect(options.width).toBe(100)
    } finally {
      await f.dispose()
    }
  })
})
