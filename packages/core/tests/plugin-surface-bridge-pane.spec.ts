/**
 * Pane-owner bridge lifecycle, event ordering, viewport, and navigation tests.
 *
 * @module @dsh-blue/blue-core/tests/plugin-surface-bridge-pane
 */

import { Context } from '@deepseek-ai/cordis'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BluePluginHostService, createBluePluginControl } from '../../api/src/host.ts'
import type {
  BluePaneRegistration,
  BluePluginApi,
  BlueResult,
  BlueUiEvent,
  BlueUiEventContext,
  BlueUiNode,
} from '../../api/src/contracts.ts'
import type { BluePluginManifest } from '../../api/src/manifest.ts'
import { ui } from '../../ui/src/index.ts'
import { mountPluginSurfaceBridge } from '../src/plugin-surface-bridge.ts'
import { SurfaceManager, type SurfaceLaneEntry, type SurfaceLayout } from '../src/surface-manager.ts'
import type { BlueComponent, BlueComponents, BlueFocusable, BlueKeyAction, BlueSemanticColors } from '../src/types.ts'
import type { BlueTerminalRuntime } from '../src/terminal.ts'
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { createFakeEditor } from './fake-editor.ts'

const identity = (value: string): string => value
const colors = new Proxy({ logoGradient: [identity] }, {
  get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity,
}) as unknown as BlueSemanticColors
const components = { visibleWidth, wrapText: wrapTextWithAnsi, truncateToWidth, createEditor: createFakeEditor } as BlueComponents
const placements = ['header', 'left', 'right', 'bottom'] as const

class Scope {
  private readonly cleanups: (() => void)[] = []

  effect(callback: () => void | (() => void)): void {
    const cleanup = callback()
    if (typeof cleanup === 'function') this.cleanups.push(cleanup)
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
  }
}

class KeymapHarness {
  readonly actions = new Map<string, BlueKeyAction>()

  register(actions: BlueKeyAction[]): () => void {
    for (const action of actions) this.actions.set(action.id, action)
    return () => { for (const action of actions) this.actions.delete(action.id) }
  }

  invoke(id: string): void {
    const handler = this.actions.get(id)?.handler
    if (handler === undefined) throw new Error(`missing key handler: ${id}`)
    handler()
  }
}

interface RuntimeHarness {
  readonly runtime: BlueTerminalRuntime
  readonly surfaces: SurfaceManager
  readonly editor: BlueFocusable
  readonly focused: () => BlueComponent | null
  readonly rendered: () => number
  setCapturing(value: boolean): void
  resize(columns: number, rows: number): void
}

function createRuntime(mode: 'main' | 'alternate' = 'alternate', initialColumns = 120, initialRows = 20): RuntimeHarness {
  const editor: BlueFocusable = { focused: true, render: () => ['editor'], invalidate: () => {} }
  let focused: BlueComponent | null = editor
  let columns = initialColumns
  let rows = initialRows
  let capturing = false
  let renders = 0
  const assignFocus = (component: BlueComponent | null): void => {
    if (focused !== null && 'focused' in focused) (focused as BlueFocusable).focused = false
    focused = component
    if (component !== null && 'focused' in component) (component as BlueFocusable).focused = true
  }
  const surfaces = new SurfaceManager({
    onSurfaceFocusTransition: (previous, next) => {
      if (focused === previous) assignFocus(next ?? editor)
    },
  })
  const layout = (): SurfaceLayout => mode === 'main'
    ? surfaces.linearLayout(columns, rows)
    : surfaces.layout(columns, rows)
  const runtime = {
    mode,
    get columns() { return columns },
    get rows() { return rows },
    background: undefined,
    kittyKeyboard: false,
    tui: {},
    surfaces,
    surfaceViewport(id: string) {
      const current = layout()
      const lane = placements.map(placement => current[placement])
        .find(candidate => candidate?.entries.some(entry => entry.id === id))
      const paneColumns = lane?.placement === 'left' || lane?.placement === 'right'
        ? lane.width ?? columns
        : columns
      return { columns: Math.max(1, paneColumns), rows: Math.max(1, rows) }
    },
    releaseSurfaceFocus(id: string) {
      if (surfaces.focusedId !== undefined && surfaces.focusedId !== id) return
      surfaces.setFocused(undefined)
      assignFocus(editor)
    },
    hasCapturingOverlay: () => capturing,
    setFocus(component: BlueComponent | null) {
      surfaces.setFocusedComponent(component)
      assignFocus(component)
    },
    showOverlay() { throw new Error('pane test opened an overlay') },
    requestRender() { renders += 1 },
  } as unknown as BlueTerminalRuntime
  return {
    runtime,
    surfaces,
    editor,
    focused: () => focused,
    rendered: () => renders,
    setCapturing: value => { capturing = value },
    resize: (nextColumns, nextRows) => { columns = nextColumns; rows = nextRows },
  }
}

function mount(host: BluePluginHostService, runtime: BlueTerminalRuntime, compilerComponents: BlueComponents = components): { readonly scope: Scope, readonly keymap: KeymapHarness } {
  const scope = new Scope()
  const keymap = new KeymapHarness()
  Object.assign(scope, {
    bluePluginControl: createBluePluginControl(host),
    blueComponents: compilerComponents,
    blueTheme: { colors },
    blueKeymap: keymap,
  })
  mountPluginSurfaceBridge(scope as never, runtime)
  return { scope, keymap }
}

let manifestSequence = 0
function openPanes(host: BluePluginHostService): { readonly scope: Scope, readonly api: BluePluginApi } {
  const scope = new Scope()
  const manifest: BluePluginManifest = {
    id: `@tests/pane-${String(manifestSequence++)}`,
    api: '^1.0.0-beta.1',
    capabilities: ['panes'],
  }
  const opened = host.open(scope, manifest)
  if (!opened.ok) throw new Error(opened.message)
  return { scope, api: opened.value }
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

function entries(surfaces: SurfaceManager, columns = 120, rows = 20): SurfaceLaneEntry[] {
  const layout = surfaces.linearLayout(columns, rows)
  return placements.flatMap(placement => layout[placement]?.entries ?? [])
}

function entry(surfaces: SurfaceManager, id: string): SurfaceLaneEntry {
  const found = entries(surfaces).find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`missing surface: ${id}`)
  return found
}

function registerPane(api: BluePluginApi, contribution: {
  readonly id: string
  readonly title?: string
  readonly placement?: 'header' | 'left' | 'right' | 'bottom'
  readonly priority?: number
  readonly size?: { readonly min?: number, readonly preferred?: number | 'auto', readonly max?: number }
  readonly narrow?: 'bottom' | 'overlay' | 'hidden'
  readonly render: () => BlueUiNode | null
  readonly onEvent?: (event: BlueUiEvent, context: BlueUiEventContext) => BlueResult | Promise<BlueResult>
}): BluePaneRegistration {
  const registered = api.panes!.register({
    id: contribution.id,
    ...(contribution.title === undefined ? {} : { title: contribution.title }),
    placement: contribution.placement ?? 'right',
    ...(contribution.priority === undefined ? {} : { priority: contribution.priority }),
    ...(contribution.size === undefined ? {} : { size: contribution.size }),
    ...(contribution.narrow === undefined ? {} : { narrow: contribution.narrow }),
    render: contribution.render,
    ...(contribution.onEvent === undefined ? {} : { onEvent: contribution.onEvent }),
  })
  if (!registered.ok) throw new Error(registered.message)
  return registered.value
}

function deferred<T>(): { readonly promise: Promise<T>, resolve(value: T): void, reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function success(): BlueResult {
  return { ok: true, value: undefined }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('plugin surface bridge panes', () => {
  it('replays retained panes across owner reload and removes them on consumer unload', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const firstOwner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let renders = 0
    let eventCount = 0
    registerPane(consumer.api, {
      id: 'replay',
      render: () => { renders += 1; return ui.actions({ id: 'replay-actions', items: [{ id: 'go', label: 'Go' }] }) },
      onEvent: () => { eventCount += 1; return success() },
    })
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['replay'])
    expect(renders).toBe(1)

    firstOwner.scope.dispose()
    expect(runtime.surfaces.empty).toBe(true)
    expect(consumer.api.panes!.list().map(item => item.id)).toEqual(['replay'])

    const secondOwner = mount(host, runtime.runtime)
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['replay'])
    expect(renders).toBe(2)

    const staleComponent = entry(runtime.surfaces, 'replay').component
    consumer.scope.dispose()
    staleComponent.handleInput?.('\r')
    await flushMicrotasks()
    expect(runtime.surfaces.empty).toBe(true)
    expect(eventCount).toBe(0)
    secondOwner.scope.dispose()
  })

  it('cancels scheduled admission and mounted resources when the owner unloads', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let renders = 0
    registerPane(consumer.api, { id: 'pending', render: () => { renders += 1; return ui.text('pending') } })
    owner.scope.dispose()
    await flushMicrotasks()
    expect(renders).toBe(0)
    expect(runtime.surfaces.empty).toBe(true)
    expect(owner.keymap.actions.size).toBe(0)
    consumer.scope.dispose()
  })

  it('cancels an admitted render when its consumer unloads before the render microtask', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let renders = 0
    registerPane(consumer.api, { id: 'consumer-pending', render: () => { renders += 1; return ui.text('pending') } })
    await Promise.resolve()
    consumer.scope.dispose()
    await flushMicrotasks()
    expect(renders).toBe(0)
    expect(runtime.surfaces.empty).toBe(true)
    owner.scope.dispose()
  })

  it('replaces a rapidly reused id without retaining the old render, handler, or placement', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const first = openPanes(host)
    let oldRenders = 0
    let oldEvents = 0
    registerPane(first.api, {
      id: 'reused',
      placement: 'right',
      render: () => { oldRenders += 1; return ui.actions({ id: 'old', items: [{ id: 'old-go', label: 'Old' }] }) },
      onEvent: () => { oldEvents += 1; return success() },
    })
    await Promise.resolve()

    first.scope.dispose()
    const second = openPanes(host)
    let newRenders = 0
    let newEvents = 0
    registerPane(second.api, {
      id: 'reused',
      title: 'Replacement',
      placement: 'bottom',
      render: () => { newRenders += 1; return ui.actions({ id: 'new', items: [{ id: 'new-go', label: 'New' }] }) },
      onEvent: () => { newEvents += 1; return success() },
    })
    await flushMicrotasks()

    expect(oldRenders).toBe(0)
    expect(newRenders).toBe(1)
    expect(entry(runtime.surfaces, 'reused')).toMatchObject({ placement: 'bottom', title: 'Replacement' })
    entry(runtime.surfaces, 'reused').focusTarget?.handleInput?.('\r')
    await flushMicrotasks()
    expect([oldEvents, newEvents]).toEqual([0, 1])

    second.scope.dispose()
    owner.scope.dispose()
  })

  it('mounts and unmounts null transitions while isolating refresh revisions and hidden state', async () => {
    let now = 0
    const host = new BluePluginHostService(new Context(), { now: () => now })
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let nullable: BlueUiNode | null = null
    let nullableRenders = 0
    let peerRenders = 0
    const nullableHandle = registerPane(consumer.api, {
      id: 'nullable',
      render: () => { nullableRenders += 1; return nullable },
    })
    const peerHandle = registerPane(consumer.api, {
      id: 'peer',
      render: () => { peerRenders += 1; return ui.text('peer') },
    })
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['peer'])
    expect([nullableRenders, peerRenders]).toEqual([1, 1])

    nullable = ui.text('mounted')
    for (let count = 0; count < 20; count += 1) expect(nullableHandle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['nullable', 'peer'])
    expect([nullableRenders, peerRenders]).toEqual([2, 1])
    expect(entry(runtime.surfaces, 'nullable').component.render(80)).toEqual(['mounted'])
    const nullableComponent = entry(runtime.surfaces, 'nullable').component
    nullableComponent.invalidate()
    expect((nullableComponent as BlueFocusable).focused).toBe(false)

    expect(nullableHandle.setHidden(true)).toEqual(success())
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['peer'])
    expect(nullableRenders).toBe(2)
    expect(nullableHandle.setHidden(true)).toEqual(success())
    expect(nullableHandle.setHidden(false)).toEqual(success())
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['nullable', 'peer'])
    expect(nullableRenders).toBe(2)

    expect(peerHandle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect([nullableRenders, peerRenders]).toEqual([2, 2])
    nullable = null
    now = 1_001
    expect(nullableHandle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).toEqual(['peer'])
    expect(nullableRenders).toBe(3)
    expect(nullableComponent.render(80)).toEqual([])
    nullableComponent.invalidate()
    ;(nullableComponent as BlueFocusable).focused = true
    expect((nullableComponent as BlueFocusable).focused).toBe(true)
    expect(renderLayoutFrame(nullableComponent, 80, 3, () => {}).root.children).toEqual([])

    nullable = ui.text('mounted again')
    now = 2_002
    expect(nullableHandle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(entry(runtime.surfaces, 'nullable').component).toBe(nullableComponent)
    expect(entry(runtime.surfaces, 'nullable').component.render(80)).toEqual(['mounted again'])

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('contains render failures and uses the live lane viewport through narrow fallback', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime('alternate', 120, 12)
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    registerPane(consumer.api, {
      id: 'responsive',
      placement: 'right',
      render: () => ui.stack.column([
        ui.child(ui.text('side'), { when: { maxWidth: 39 } }),
        ui.child(ui.text('bottom'), { when: { minWidth: 40 } }),
      ]),
    })
    registerPane(consumer.api, { id: 'thrown', placement: 'header', render: () => { throw new Error('pane exploded') } })
    registerPane(consumer.api, { id: 'unknown-failure', placement: 'left', render: () => { throw undefined } })
    registerPane(consumer.api, { id: 'invalid', placement: 'bottom', render: () => ({ kind: 'unknown' }) as never })
    await flushMicrotasks()

    const wide = runtime.surfaces.layout(120, 12)
    expect(wide.right?.entries.map(item => item.id)).toEqual(['responsive'])
    expect(entry(runtime.surfaces, 'responsive').component.render(80)).toEqual(['side'])
    expect(entry(runtime.surfaces, 'thrown').component.render(80).join('\n')).toContain('pane exploded')
    expect(entry(runtime.surfaces, 'unknown-failure').component.render(80).join('\n')).toContain('render failed')
    expect(entry(runtime.surfaces, 'invalid').component.render(80).join('\n')).toContain('unknown Blue UI kind')
    expect(renderLayoutFrame(entry(runtime.surfaces, 'invalid').component, 80, 4, () => {}).lines.join('\n')).toContain('unknown Blue UI kind')

    runtime.resize(40, 12)
    const narrow = runtime.surfaces.layout(40, 12)
    expect(narrow.right).toBeUndefined()
    expect(narrow.bottom?.entries.map(item => item.id)).toContain('responsive')
    expect(entry(runtime.surfaces, 'responsive').component.render(40)).toEqual(['bottom'])

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('deactivates old pane input across render and validation fallback gaps, then restores its editor', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const editors: BlueFocusable[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createFakeEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const owner = mount(host, runtime.runtime, localComponents)
    const consumer = openPanes(host)
    const events: BlueUiEvent[] = []
    let value = 'AB'
    let mode: 'valid' | 'passive' | 'throw' | 'invalid' = 'valid'
    const handle = registerPane(consumer.api, {
      id: 'recoverable-form',
      render: () => {
        if (mode === 'throw') throw new Error('temporary render failure')
        if (mode === 'invalid') return { kind: 'unknown' } as never
        if (mode === 'passive') return ui.text('temporarily passive')
        return ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value }] })
      },
      onEvent: event => {
        events.push(event)
        if (event.kind === 'value-change' && event.controlId === 'name') value = String(event.value)
        return success()
      },
    })
    await flushMicrotasks()
    const component = entry(runtime.surfaces, 'recoverable-form').component
    const target = entry(runtime.surfaces, 'recoverable-form').focusTarget!
    runtime.runtime.setFocus(target)
    component.render(80)
    target.handleInput?.('X')
    await flushMicrotasks()
    expect(events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'ABX' })
    expect(editors).toHaveLength(1)

    mode = 'throw'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(component.render(80).join('\n')).toContain('temporary render failure')
    expect(editors[0]!.focused).toBe(false)
    expect((editors[0] as ReturnType<typeof createFakeEditor>).onChange).toBeUndefined()
    target.handleInput?.('ignored')
    expect(events).toHaveLength(1)

    mode = 'valid'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(entry(runtime.surfaces, 'recoverable-form').component).toBe(component)
    component.render(80)
    expect(editors).toHaveLength(1)
    runtime.runtime.setFocus(target)
    component.render(80)
    expect(editors[0]!.focused).toBe(true)
    target.handleInput?.('Y')
    await flushMicrotasks()
    expect(events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'ABXY' })

    mode = 'passive'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(component.render(80)).toEqual(['temporarily passive'])
    expect(editors[0]!.focused).toBe(false)
    expect(runtime.focused()).toBe(runtime.editor)
    target.handleInput?.('ignored')
    expect(events).toHaveLength(2)

    mode = 'valid'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(editors).toHaveLength(1)

    mode = 'invalid'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(component.render(80).join('\n')).toContain('unknown Blue UI kind')
    target.handleInput?.('ignored')
    expect(events).toHaveLength(2)

    mode = 'valid'
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(component.render(80).join('\n')).toContain('Name: ABXY')

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('runs latest-wins independently per control and ignores late superseded completion', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const pending: { event: BlueUiEvent, context: BlueUiEventContext, result: ReturnType<typeof deferred<BlueResult>> }[] = []
    let renders = 0
    const handle = registerPane(consumer.api, {
      id: 'latest',
      render: () => {
        renders += 1
        return ui.form({ id: 'fields', fields: [
          { kind: 'input', id: 'first', label: 'First', value: '' },
          { kind: 'input', id: 'second', label: 'Second', value: '' },
        ] })
      },
      onEvent: (event, context) => {
        const result = deferred<BlueResult>()
        pending.push({ event, context, result })
        return result.promise
      },
    })
    await flushMicrotasks()
    let target = entry(runtime.surfaces, 'latest').focusTarget!
    runtime.runtime.setFocus(target)
    target.handleInput?.('a')
    await flushMicrotasks()
    target.handleInput?.('\t')
    target.handleInput?.('\x1b[B')
    target.handleInput?.('b')
    await flushMicrotasks()
    expect(pending).toHaveLength(2)
    expect(pending.map(call => 'controlId' in call.event ? call.event.controlId : 'dismiss')).toEqual(['first', 'second'])
    expect(pending[0]!.context.signal.aborted).toBe(false)
    expect(pending[1]!.context.signal.aborted).toBe(false)

    target.handleInput?.('\x1b[Z')
    target.handleInput?.('\x1b[A')
    target.handleInput?.('c')
    await flushMicrotasks()
    expect(pending).toHaveLength(3)
    expect(pending[0]!.context.signal.aborted).toBe(true)
    expect(pending[1]!.context.signal.aborted).toBe(false)

    pending[1]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(2)
    expect(pending[2]!.context.signal.aborted).toBe(false)
    pending[2]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(3)
    pending[0]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(3)

    target = entry(runtime.surfaces, 'latest').focusTarget!
    target.handleInput?.('d')
    await flushMicrotasks()
    expect(pending).toHaveLength(4)
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(pending[3]!.context.signal.aborted).toBe(true)
    expect(renders).toBe(4)
    expect(entry(runtime.surfaces, 'latest').component.render(80).join('\n')).not.toContain('First: d')
    pending[3]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(4)

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('keeps one semantic field and editor draft across successful pane recompilation', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let value = 'A'
    let reordered = false
    let renders = 0
    registerPane(consumer.api, {
      id: 'continuous-form',
      render: () => {
        renders += 1
        const form = ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value }] })
        return reordered
          ? ui.stack.column([ui.actions({ id: 'leading', items: [{ id: 'other', label: 'Other' }] }), form])
          : ui.stack.column([form, ui.text('tail')])
      },
      onEvent: event => {
        if (event.kind === 'value-change' && event.controlId === 'name') value = String(event.value)
        reordered = true
        return success()
      },
    })
    await flushMicrotasks()
    const target = entry(runtime.surfaces, 'continuous-form').focusTarget!
    const component = entry(runtime.surfaces, 'continuous-form').component
    const repaintBaseline = runtime.rendered()
    runtime.runtime.setFocus(target)
    target.handleInput?.('B')
    await flushMicrotasks()
    expect(value).toBe('AB')
    expect(renders).toBe(2)
    expect(runtime.rendered()).toBe(repaintBaseline + 1)
    expect(entry(runtime.surfaces, 'continuous-form').component).toBe(component)
    expect(entry(runtime.surfaces, 'continuous-form').focusTarget).toBe(target)

    target.handleInput?.('C')
    await flushMicrotasks()
    expect(value).toBe('ABC')
    expect(entry(runtime.surfaces, 'continuous-form').component.render(80).join('\n')).toContain('Name: ABC')
    expect(runtime.rendered()).toBe(repaintBaseline + 2)

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('keeps a form draft dormant across pane hide and show without stealing focus', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const events: BlueUiEvent[] = []
    let renders = 0
    const handle = registerPane(consumer.api, {
      id: 'dormant-form',
      render: () => {
        renders += 1
        return ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'A' }] })
      },
      onEvent: event => { events.push(event); return success() },
    })
    await flushMicrotasks()
    const component = entry(runtime.surfaces, 'dormant-form').component
    const target = entry(runtime.surfaces, 'dormant-form').focusTarget!
    runtime.runtime.setFocus(target)
    target.handleInput?.('B')
    await flushMicrotasks()
    expect(events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'AB' })
    expect(component.render(80).join('\n')).toContain('Name: AB')
    expect(renders).toBe(2)

    expect(handle.setHidden(true)).toEqual(success())
    await flushMicrotasks()
    expect(entries(runtime.surfaces).map(item => item.id)).not.toContain('dormant-form')
    expect(runtime.focused()).toBe(runtime.editor)
    expect(renders).toBe(2)

    expect(handle.setHidden(false)).toEqual(success())
    await flushMicrotasks()
    const restored = entry(runtime.surfaces, 'dormant-form')
    expect(restored.component).toBe(component)
    expect(restored.focusTarget).toBe(target)
    expect(runtime.focused()).toBe(runtime.editor)
    expect(component.render(80).join('\n')).toContain('Name: AB')
    expect(renders).toBe(2)

    runtime.runtime.setFocus(target)
    target.handleInput?.('C')
    await flushMicrotasks()
    expect(events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'ABC' })
    expect(component.render(80).join('\n')).toContain('Name: ABC')

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('preserves FIFO events across success refreshes and contains handler failures', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const pending: { context: BlueUiEventContext, result: ReturnType<typeof deferred<BlueResult>> }[] = []
    let renders = 0
    const handle = registerPane(consumer.api, {
      id: 'fifo',
      render: () => { renders += 1; return ui.actions({ id: 'actions', items: [{ id: 'go', label: 'Go' }] }) },
      onEvent: (_event, context) => {
        const result = deferred<BlueResult>()
        pending.push({ context, result })
        return result.promise
      },
    })
    await flushMicrotasks()
    const target = entry(runtime.surfaces, 'fifo').focusTarget!
    runtime.runtime.setFocus(target)
    target.handleInput?.('\r')
    target.handleInput?.('\r')
    await flushMicrotasks()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.context.revision).toBe(1)

    pending[0]!.result.resolve(success())
    await flushMicrotasks()
    expect(pending).toHaveLength(2)
    expect(pending[1]!.context.revision).toBe(2)
    expect(pending[1]!.context.signal.aborted).toBe(false)
    expect(renders).toBe(2)
    pending[1]!.result.reject(new Error('handler failed'))
    await flushMicrotasks()
    expect(renders).toBe(2)
    expect(entries(runtime.surfaces).map(item => item.id)).toContain('fifo')
    target.handleInput?.('\r')
    await flushMicrotasks()
    expect(pending).toHaveLength(3)
    pending[2]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(3)

    target.handleInput?.('\r')
    target.handleInput?.('\r')
    await flushMicrotasks()
    expect(pending).toHaveLength(4)
    expect(handle.refresh()).toEqual(success())
    await flushMicrotasks()
    expect(pending[3]!.context.signal.aborted).toBe(true)
    pending[3]!.result.resolve(success())
    await flushMicrotasks()
    expect(pending).toHaveLength(4)
    expect(renders).toBe(4)

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('aborts timed out and unloaded pane events without accepting late completion', async () => {
    vi.useFakeTimers()
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const calls: { context: BlueUiEventContext, result: ReturnType<typeof deferred<BlueResult>> }[] = []
    let renders = 0
    registerPane(consumer.api, {
      id: 'abort',
      render: () => { renders += 1; return ui.actions({ id: 'actions', items: [{ id: 'go', label: 'Go' }] }) },
      onEvent: (_event, context) => {
        const result = deferred<BlueResult>()
        calls.push({ context, result })
        return result.promise
      },
    })
    await flushMicrotasks()
    let target = entry(runtime.surfaces, 'abort').focusTarget!
    target.handleInput?.('\r')
    target.handleInput?.('\r')
    await flushMicrotasks()
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000)
    await flushMicrotasks()
    expect(calls[0]!.context.signal.aborted).toBe(true)
    expect(renders).toBe(1)
    expect(entries(runtime.surfaces).map(item => item.id)).toContain('abort')
    expect(calls).toHaveLength(2)
    target = entry(runtime.surfaces, 'abort').focusTarget!
    target.handleInput?.('\r')
    await flushMicrotasks()
    expect(calls).toHaveLength(2)
    consumer.scope.dispose()
    await flushMicrotasks()
    expect(calls[1]!.context.signal.aborted).toBe(true)
    expect(runtime.surfaces.empty).toBe(true)
    calls[0]!.result.resolve(success())
    calls[1]!.result.resolve(success())
    await flushMicrotasks()
    expect(renders).toBe(1)
    expect(runtime.surfaces.empty).toBe(true)
    owner.scope.dispose()
  })

  it('coalesces default event refreshes and ignores events from a disposed component', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    let renders = 0
    registerPane(consumer.api, {
      id: 'defaults',
      title: 'Defaults',
      placement: 'left',
      priority: 10,
      size: { min: 20, preferred: 'auto', max: 40 },
      narrow: 'hidden',
      render: () => {
        renders += 1
        return ui.form({ id: 'fields', fields: [
          { kind: 'input', id: 'first', label: 'First', value: '' },
          { kind: 'input', id: 'second', label: 'Second', value: '' },
        ] })
      },
    })
    await flushMicrotasks()
    const component = entry(runtime.surfaces, 'defaults').component
    const target = entry(runtime.surfaces, 'defaults').focusTarget!
    target.handleInput?.('a')
    target.handleInput?.('\t')
    target.handleInput?.('\x1b[B')
    target.handleInput?.('b')
    await flushMicrotasks()
    expect(renders).toBe(2)
    expect(entry(runtime.surfaces, 'defaults')).toMatchObject({
      title: 'Defaults',
      priority: 10,
      size: { min: 20, preferred: 'auto', max: 40 },
      narrow: 'hidden',
    })

    consumer.scope.dispose()
    await flushMicrotasks()
    target.handleInput?.('c')
    component.invalidate()
    ;(component as BlueFocusable).focused = true
    await flushMicrotasks()
    expect(renders).toBe(2)
    expect(component.render(80)).toEqual([])
    expect((component as BlueFocusable).focused).toBe(false)
    expect(renderLayoutFrame(component, 80, 3, () => {}).root.children).toEqual([])
    owner.scope.dispose()
  })

  it('navigates core-managed implicit focus targets in main-screen order', () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime('main')
    const owner = mount(host, runtime.runtime)
    const implicit: BlueFocusable = { focused: false, render: () => ['implicit'], invalidate: () => {} }
    const focused = runtime.surfaces.register({ id: 'implicit', placement: 'header', component: implicit })
    const passive = runtime.surfaces.register({ id: 'passive', placement: 'bottom', component: { render: () => ['passive'], invalidate: () => {} } })

    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('implicit')
    expect(runtime.focused()).toBe(implicit)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.linearLayout(120, 20).bottom?.active.id).toBe('passive')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)

    focused.dispose()
    passive.dispose()
    owner.scope.dispose()
  })

  it('cycles same-lane and cross-lane panes, restores passive focus, and obeys modal blocking', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const handles = [
      registerPane(consumer.api, { id: 'header-a', placement: 'header', render: () => ui.actions({ id: 'a', items: [{ id: 'go-a', label: 'A' }] }) }),
      registerPane(consumer.api, { id: 'header-b', placement: 'header', render: () => ui.actions({ id: 'b', items: [{ id: 'go-b', label: 'B' }] }) }),
      registerPane(consumer.api, { id: 'left-passive', placement: 'left', render: () => ui.text('passive') }),
      registerPane(consumer.api, { id: 'bottom-c', placement: 'bottom', render: () => ui.actions({ id: 'c', items: [{ id: 'go-c', label: 'C' }] }) }),
    ]
    await flushMicrotasks()

    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('header-a')
    expect(runtime.focused()).toBe(entry(runtime.surfaces, 'header-a').focusTarget)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('header-b')
    expect(runtime.surfaces.linearLayout(120, 20).header?.active.id).toBe('header-b')
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.linearLayout(120, 20).left?.active.id).toBe('left-passive')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('bottom-c')
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)

    owner.keymap.invoke('blue.surface.previous')
    expect(runtime.surfaces.focusedId).toBe('bottom-c')
    expect(entry(runtime.surfaces, 'bottom-c').component.render(80).at(-1)).toBe('  Enter run · Esc leave')
    entry(runtime.surfaces, 'bottom-c').focusTarget?.handleInput?.('\x1b')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)

    runtime.setCapturing(true)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    runtime.setCapturing(false)

    for (const handle of handles) handle.dispose()
    await flushMicrotasks()
    expect(runtime.surfaces.empty).toBe(true)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.focused()).toBe(runtime.editor)
    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('continues after a passive same-lane successor when the focused pane unloads', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const first = registerPane(consumer.api, { id: 'header-a', placement: 'header', render: () => ui.actions({ id: 'a', items: [{ id: 'go-a', label: 'A' }] }) })
    registerPane(consumer.api, { id: 'header-b', placement: 'header', render: () => ui.text('passive successor') })
    registerPane(consumer.api, { id: 'left-c', placement: 'left', render: () => ui.actions({ id: 'c', items: [{ id: 'go-c', label: 'C' }] }) })
    await flushMicrotasks()

    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('header-a')
    first.dispose()
    await flushMicrotasks()
    expect(runtime.surfaces.linearLayout(120, 20).header?.active.id).toBe('header-b')
    expect(runtime.surfaces.focusedId).toBeUndefined()
    expect(runtime.focused()).toBe(runtime.editor)
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('left-c')

    consumer.scope.dispose()
    owner.scope.dispose()
  })

  it('falls back to an externally focused successor when the navigation pane unloads', async () => {
    const host = new BluePluginHostService(new Context())
    const runtime = createRuntime()
    const owner = mount(host, runtime.runtime)
    const consumer = openPanes(host)
    const first = registerPane(consumer.api, { id: 'header-a', placement: 'header', render: () => ui.actions({ id: 'a', items: [{ id: 'go-a', label: 'A' }] }) })
    registerPane(consumer.api, { id: 'header-b', placement: 'header', render: () => ui.actions({ id: 'b', items: [{ id: 'go-b', label: 'B' }] }) })
    registerPane(consumer.api, { id: 'left-c', placement: 'left', render: () => ui.actions({ id: 'c', items: [{ id: 'go-c', label: 'C' }] }) })
    await flushMicrotasks()

    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('header-a')
    expect(runtime.surfaces.activate('header', 'header-b')).toBe(true)
    expect(runtime.surfaces.focusedId).toBe('header-b')
    first.dispose()
    await flushMicrotasks()
    expect(runtime.surfaces.focusedId).toBe('header-b')
    owner.keymap.invoke('blue.surface.next')
    expect(runtime.surfaces.focusedId).toBe('left-c')

    consumer.scope.dispose()
    owner.scope.dispose()
  })
})
