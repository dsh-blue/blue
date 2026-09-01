/** Direct overlay registry renderer, focus, and event lifecycle tests.
 * @module @dsh-blue/blue-core/tests/surface-renderer-overlay
 */

import { Context } from '@deepseek-ai/cordis'
import { stripTerminalSequences, type Component } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyApi } from '../../api/src/index.ts'
import type { BlueOverlayHandle, BlueOverlayRequest, BlueUiEventContext, BlueUiNode } from '../../api/src/contracts.ts'
import { ui } from '../../ui/src/index.ts'
import { mountBlueSurfaceRenderer } from '../src/surface-renderer.ts'
import { startBlueTerminal, type BlueTerminalRuntime } from '../src/terminal.ts'
import type { BlueComponents, BlueFocusable, BlueKeyAction, BlueSemanticColors } from '../src/types.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { createFakeEditor } from './fake-editor.ts'
import { FakeTerminal } from './fake-terminal.ts'

class Scope {
  private readonly cleanups: Array<() => void> = []

  effect(callback: () => void | (() => void)): () => void {
    const cleanup = callback()
    if (typeof cleanup !== 'function') return () => {}
    let live = true
    const dispose = (): void => {
      if (!live) return
      live = false
      cleanup()
    }
    this.cleanups.push(dispose)
    return dispose
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
  }
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

const colors = new Proxy({}, {
  get: () => (text: string) => text,
}) as BlueSemanticColors

const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
  createEditor: createFakeEditor,
} as BlueComponents

interface Fixture {
  readonly root: Context
  readonly owner: Scope
  readonly terminal: FakeTerminal
  readonly runtime: BlueTerminalRuntime
  readonly stack: () => OverlayStackEntry[]
  mount(): Scope
  open(request: BlueOverlayRequest): BlueOverlayHandle
  dispose(): Promise<void>
}

async function fixture(columns = 80, rows = 24, compilerComponents: BlueComponents = components, translateHint?: (key: string) => string): Promise<Fixture> {
  const root = new Context()
  await root.plugin({ name: 'test-blue-api', apply: applyApi })
  const terminal = new FakeTerminal(columns, rows)
  const runtime = await startBlueTerminal(terminal, () => Promise.resolve(undefined))
  const owners: Scope[] = []
  const mount = (): Scope => {
    const owner = new Scope()
    Object.assign(owner, {
      bluePanes: root.bluePanes,
      blueOverlays: root.blueOverlays,
      blueComponents: compilerComponents,
      blueTheme: { colors },
      blueKeymap: {
        register(_actions: BlueKeyAction[]) { return () => {} },
        matches: () => false,
        dispatch: () => false,
      },
    })
    mountBlueSurfaceRenderer(owner as never, runtime, translateHint)
    owners.push(owner)
    return owner
  }
  const owner = mount()
  const stack = () => (runtime.tui as unknown as TuiInternals).overlayStack
  return {
    root,
    owner,
    terminal,
    runtime,
    stack,
    mount,
    open: request => root.blueOverlays.open(request),
    async dispose() {
      for (const mounted of owners.splice(0).reverse()) mounted.dispose()
      await runtime.stop()
      await root.fiber.dispose()
    },
  }
}

async function flush(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('condition did not settle')
}

function deferred<T>(): { readonly promise: Promise<T>, resolve(value?: T): void, reject(error: unknown): void } {
  const result = Promise.withResolvers<T>()
  return { promise: result.promise, resolve: result.resolve as (value?: T) => void, reject: result.reject }
}

function actionNode(id = 'go', confirm?: string): BlueUiNode {
  return ui.actions({ id: 'actions', items: [{ id, label: id, ...(confirm === undefined ? {} : { confirm }) }] })
}

function inputNode(id = 'value', value = ''): BlueUiNode {
  return ui.form({ id: 'form', fields: [{ kind: 'input', id, label: id, value }] })
}

async function settleInput(component: Component, input: string): Promise<void> {
  component.handleInput?.(input)
  await flush()
}

afterEach(() => { vi.useRealTimers() })

describe('direct overlay surface renderer', () => {
  it('replays still-open overlays across renderer gaps', async () => {
    const f = await fixture()
    try {
      const handle = f.open({ id: 'renderer-gap', render: () => ui.text('persistent') })
      await flush()
      expect(f.stack()).toHaveLength(1)
      f.owner.dispose()
      expect(f.stack()).toHaveLength(0)
      expect(handle.closed).toBe(false)
      expect(f.root.blueOverlays.list().map(entry => entry.id)).toEqual(['renderer-gap'])
      f.mount()
      await flush()
      expect(f.stack()[0]!.component.render(40)).toEqual(['persistent'])
      handle.close()
      await flush()
      expect(f.stack()).toEqual([])
    } finally {
      await f.dispose()
    }
  })

  it('opens passive and capturing overlays directly without admission tokens', async () => {
    const f = await fixture()
    try {
      const passive = f.open({ id: 'passive', render: () => ui.text('passive') })
      const interactivePassive = f.open({ id: 'passive-controls', render: () => actionNode() })
      const modal = f.open({ id: 'modal', capturing: true, render: () => actionNode() })
      const nullPassive = f.open({ id: 'null-passive', render: () => null })
      const nullModal = f.open({ id: 'null-modal', capturing: true, render: () => null })
      const invalidPassive = f.open({ id: 'invalid-passive', render: () => ({ kind: 'unknown' }) as never })
      await flush()
      expect(f.stack()).toHaveLength(6)
      expect(f.stack()[0]!.options?.nonCapturing).toBe(true)
      expect(f.stack()[1]!.component.render(60).join(' ')).toContain('non-capturing overlays cannot contain interactive controls')
      expect(f.stack()[2]!.options?.nonCapturing).toBe(false)
      expect(f.stack()[3]!.component.render(60).join(' ')).toContain('overlay render returned no node')
      expect(f.stack()[4]!.component.render(60).join(' ')).toContain('overlay render returned no node')
      expect(f.stack()[5]!.component.render(60).join(' ')).toContain('Blue UI')
      expect(f.runtime.hasCapturingOverlay()).toBe(true)
      passive.close()
      interactivePassive.close()
      modal.close()
      nullPassive.close()
      nullModal.close()
      invalidPassive.close()
    } finally {
      await f.dispose()
    }
  })

  it('implements default dismissal, confirmation Escape, and fixed overlays', async () => {
    const f = await fixture()
    try {
      const plain = f.open({ id: 'plain', capturing: true, render: () => ui.text('message') })
      await flush()
      plain.refresh()
      await flush()
      await settleInput(f.stack()[0]!.component, '\x1b')
      expect(plain.closed).toBe(true)

      const confirmed = f.open({ id: 'confirmed', capturing: true, render: () => actionNode('delete', 'Confirm delete') })
      await flush()
      const component = f.stack()[0]!.component
      await settleInput(component, '\r')
      expect(component.render(80).at(-1)).toContain('Enter confirm')
      await settleInput(component, '\x1b')
      expect(confirmed.closed).toBe(false)
      await settleInput(component, '\x1b')
      expect(confirmed.closed).toBe(true)

      const fixed = f.open({ id: 'fixed', capturing: true, dismissible: false, render: () => actionNode() })
      await flush()
      expect(f.stack()[0]!.component.render(80).at(-1)).toBe('  Enter run')
      await settleInput(f.stack()[0]!.component, '\x1b')
      expect(fixed.closed).toBe(false)
      fixed.close()
    } finally {
      await f.dispose()
    }
  })

  it('maps anchors and computes responsive geometry from the live terminal', async () => {
    const f = await fixture(80, 24)
    try {
      const anchors = [
        ['top', 'top-center'],
        ['bottom', 'bottom-center'],
        ['left', 'left-center'],
        ['right', 'right-center'],
      ] as const
      for (const [anchor, expected] of anchors) {
        const handle = f.open({ id: `anchor-${anchor}`, anchor, render: () => ui.text(anchor) })
        await flush()
        expect(f.stack()[0]!.options?.anchor).toBe(expected)
        handle.close()
        await flush()
      }

      const numeric = f.open({
        id: 'numeric',
        width: 40,
        minWidth: 20,
        maxHeight: 10,
        render: () => ui.stack.column([
          ui.child(ui.text('numeric'), { when: { minWidth: 40, maxWidth: 40, minHeight: 10, maxHeight: 10 } }),
        ]),
      })
      await flush()
      expect(f.stack()[0]!.options).toMatchObject({ width: 40, minWidth: 20, maxHeight: 10, anchor: 'center' })
      expect(f.stack()[0]!.component.render(40)).toEqual(['numeric'])
      f.terminal.resize(120, 30)
      numeric.refresh()
      await flush()
      expect(f.stack()[0]!.component.render(40)).toEqual(['numeric'])
    } finally {
      await f.dispose()
    }
  })

  it('renders translated hints and bounded titled failure frames', async () => {
    const f = await fixture(80, 10, components, key => `translated:${key}`)
    try {
      const translated = f.open({ id: 'translated', capturing: true, title: 'Actions', render: () => actionNode() })
      await flush()
      translated.refresh()
      await flush()
      const translatedRows = f.stack()[0]!.component.render(60)
      expect(translatedRows[0]).toMatch(/^╭ Actions/u)
      expect(translatedRows.at(-2)).toContain('translated:run')
      translated.close()
      await flush()

      f.open({ id: 'failed', title: 'Failed result', render: () => { throw new Error('title render failed') } })
      await flush()
      const failedRows = f.stack()[0]!.component.render(30)
      expect(failedRows[0]).toMatch(/^╭ Failed result/u)
      expect(failedRows.join(' ')).toContain('title render failed')
      expect(failedRows.every(row => visibleWidth(row) <= 30)).toBe(true)
      f.root.blueOverlays.close('failed')
      await flush()

      f.open({
        id: 'bounded',
        title: 'Bounded',
        maxHeight: 5,
        render: () => ui.scroll(ui.stack.column(Array.from({ length: 10 }, (_, index) => ui.text(`line-${String(index)}`))), { scrollbar: true }),
      })
      await flush()
      const rows = f.stack()[0]!.component.render(20)
      expect(rows).toHaveLength(5)
      expect(rows[0]).toMatch(/^╭ Bounded/u)
      expect(rows.at(-1)).toBe('╰──────────────────╯')
      expect(rows.slice(1, -1).map(stripTerminalSequences).every(row => /^│.*│$/u.test(row))).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('keeps shell and focus identity while external refresh resets local drafts', async () => {
    const f = await fixture()
    try {
      const base: BlueFocusable = { focused: false, render: () => ['base'], invalidate: () => {} }
      f.runtime.addChild(base)
      f.runtime.setFocus(base)
      const handle = f.open({ id: 'form', title: 'Profile', capturing: true, render: () => inputNode('name', 'A') })
      await flush()
      const component = f.stack()[0]!.component
      component.invalidate()
      expect((f.runtime.tui as unknown as TuiInternals).getFocusedComponent()).toBe(component)
      await settleInput(component, 'B')
      expect(component.render(80).join('\n')).toContain('name: AB')
      handle.refresh()
      await flush()
      expect(f.stack()[0]!.component).toBe(component)
      expect((component as BlueFocusable).focused).toBe(true)
      expect(component.render(80).join('\n')).toContain('name: A')
      expect(component.render(80).join('\n')).not.toContain('name: AB')
      handle.close()
      await flush()
      expect(base.focused).toBe(true)
      expect(component.render(80)).toEqual([])
      component.invalidate()
      component.handleInput?.('\r')
    } finally {
      await f.dispose()
    }
  })

  it('preserves semantic form focus across successful internal recompilation', async () => {
    const f = await fixture()
    try {
      let value = 'A'
      let reordered = false
      let renders = 0
      f.open({
        id: 'continuous',
        capturing: true,
        render: () => {
          renders += 1
          const form = ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value }] })
          return reordered
            ? ui.stack.column([ui.actions({ id: 'leading', items: [{ id: 'other', label: 'Other' }] }), form])
            : ui.stack.column([form, ui.text('tail')])
        },
        onEvent: event => {
          if (event.kind === 'value-change') value = String(event.value)
          reordered = true
        },
      })
      await flush()
      const component = f.stack()[0]!.component
      await settleInput(component, 'B')
      expect(value).toBe('AB')
      expect(renders).toBe(2)
      await settleInput(component, 'C')
      expect(value).toBe('ABC')
      expect(component.render(80).join('\n')).toContain('Name: ABC')
    } finally {
      await f.dispose()
    }
  })

  it('closes on handler throw and timeout while restoring focus', async () => {
    vi.useFakeTimers()
    const f = await fixture()
    try {
      const base: BlueFocusable = { focused: false, render: () => ['base'], invalidate: () => {} }
      f.runtime.addChild(base)
      f.runtime.setFocus(base)
      const thrown = f.open({ id: 'throw', capturing: true, render: () => actionNode(), onEvent: () => { throw new Error('boom') } })
      await flush()
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      expect(thrown.closed).toBe(true)
      expect(base.focused).toBe(true)

      let signal: AbortSignal | undefined
      const timeout = f.open({
        id: 'timeout',
        capturing: true,
        render: () => actionNode(),
        onEvent: (_event, context) => {
          signal = context.signal
          return new Promise<void>(() => {})
        },
      })
      await flush()
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      await vi.advanceTimersByTimeAsync(30_000)
      await flush()
      expect(signal?.aborted).toBe(true)
      expect(timeout.closed).toBe(true)
      expect(base.focused).toBe(true)
    } finally {
      await f.dispose()
    }
  })

  it('serializes FIFO events and aborts latest-wins values by control', async () => {
    const f = await fixture()
    try {
      const order: string[] = []
      const fifoReleases: Array<ReturnType<typeof deferred<void>>> = []
      const fifo = f.open({
        id: 'fifo',
        capturing: true,
        render: () => ui.actions({ id: 'actions', items: [{ id: 'one', label: 'one' }, { id: 'two', label: 'two' }] }),
        onEvent: async event => {
          if (event.kind !== 'activate') return
          order.push(`start:${event.controlId}`)
          const release = deferred<void>()
          fifoReleases.push(release)
          await release.promise
          order.push(`end:${event.controlId}`)
        },
      })
      await flush()
      const fifoComponent = f.stack()[0]!.component
      fifoComponent.handleInput?.('\r')
      fifoComponent.handleInput?.('\x1b[C')
      fifoComponent.handleInput?.('\r')
      await flush()
      expect(order).toEqual(['start:one'])
      fifoReleases[0]!.resolve()
      await waitUntil(() => order.length === 3)
      expect(order).toEqual(['start:one', 'end:one', 'start:two'])
      fifoReleases[1]!.resolve()
      await waitUntil(() => order.length === 4)
      fifo.close()
      await flush()

      const contexts: BlueUiEventContext[] = []
      const releases: Array<ReturnType<typeof deferred<void>>> = []
      let renders = 0
      const latest = f.open({
        id: 'latest',
        capturing: true,
        render: () => { renders += 1; return inputNode() },
        onEvent: (_event, context) => {
          contexts.push(context)
          const result = deferred<void>()
          releases.push(result)
          return result.promise
        },
      })
      await flush()
      const latestComponent = f.stack()[0]!.component
      latestComponent.handleInput?.('a')
      await flush()
      latestComponent.handleInput?.('b')
      await flush()
      expect(contexts[0]!.signal.aborted).toBe(true)
      expect(contexts[1]!.signal.aborted).toBe(false)
      releases[0]!.resolve()
      releases[1]!.resolve()
      await flush()
      expect(renders).toBe(2)
      latest.close()
    } finally {
      await f.dispose()
    }
  })

  it('coalesces independent latest-wins overlay events into one internal render', async () => {
    const f = await fixture()
    try {
      let renders = 0
      const release = deferred<void>()
      f.open({
        id: 'coalesced',
        capturing: true,
        render: () => {
          renders += 1
          return ui.stack.column([
            ui.tabs({ id: 'views', activeId: 'summary', items: [
              { id: 'summary', label: 'Summary' },
              { id: 'details', label: 'Details' },
            ] }),
            ui.form({ id: 'profile', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled', value: false }] }),
          ])
        },
        onEvent: () => release.promise,
      })
      await flush()
      const component = f.stack()[0]!.component
      component.handleInput?.('\x1b[C')
      component.handleInput?.('\t')
      component.handleInput?.('\r')
      await flush()
      expect(renders).toBe(1)
      release.resolve()
      await flush()
      expect(renders).toBe(2)
    } finally {
      await f.dispose()
    }
  })

  it('keeps or drops a queued overlay render against the pending registry snapshot', async () => {
    const f = await fixture()
    try {
      let renders = 0
      const handle = f.open({
        id: 'pending',
        capturing: true,
        render: () => { renders += 1; return actionNode() },
      })
      await flush()
      const component = f.stack()[0]!.component

      const retainedTasks: VoidFunction[] = []
      const retainedQueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(task => { retainedTasks.push(task) })
      component.handleInput?.('\r')
      await flush()
      component.handleInput?.('\r')
      await flush()
      f.open({ id: 'sibling', render: () => ui.text('sibling') })
      expect(retainedTasks.length).toBeGreaterThanOrEqual(2)
      while (retainedTasks.length > 0) retainedTasks.shift()!()
      retainedQueue.mockRestore()
      await flush()
      expect(renders).toBe(2)

      const droppedTasks: VoidFunction[] = []
      const droppedQueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(task => { droppedTasks.push(task) })
      component.handleInput?.('\r')
      await flush()
      handle.close()
      expect(droppedTasks.length).toBeGreaterThanOrEqual(2)
      while (droppedTasks.length > 0) droppedTasks.shift()!()
      droppedQueue.mockRestore()
      await flush()
      expect(renders).toBe(2)
    } finally {
      vi.restoreAllMocks()
      await f.dispose()
    }
  })

  it('fences late settlement after close and same-id replacement', async () => {
    const f = await fixture()
    try {
      const pending = deferred<void>()
      let oldSignal: AbortSignal | undefined
      const old = f.open({
        id: 'replace',
        capturing: true,
        render: () => actionNode(),
        onEvent: (_event, context) => {
          oldSignal = context.signal
          return pending.promise
        },
      })
      await flush()
      f.stack()[0]!.component.handleInput?.('\r')
      await flush()
      old.close()
      const replacement = f.open({ id: 'replace', render: () => ui.text('replacement') })
      await flush()
      expect(oldSignal?.aborted).toBe(true)
      pending.reject(new Error('late failure'))
      await flush()
      expect(replacement.closed).toBe(false)
      expect(f.root.blueOverlays.list().map(entry => entry.id)).toEqual(['replace'])
      expect(f.stack()[0]!.component.render(40)).toEqual(['replacement'])
    } finally {
      await f.dispose()
    }
  })

  it('drains reentrant opens and preserves registry stack order', async () => {
    const f = await fixture()
    try {
      let nested: BlueOverlayHandle | undefined
      f.open({
        id: 'outer',
        render: () => {
          nested ??= f.open({ id: 'inner', render: () => ui.text('inner') })
          return ui.text('outer')
        },
      })
      await flush()
      expect(nested).toBeDefined()
      expect(f.root.blueOverlays.list().map(entry => entry.id)).toEqual(['outer', 'inner'])
      expect(f.stack().map(entry => entry.component.render(40))).toEqual([['outer'], ['inner']])
    } finally {
      await f.dispose()
    }
  })
})
