/** Blue-owned runtime bridge from public pane/overlay models to core surfaces. */
import type { Context } from '@deepseek-ai/cordis'
import {
  type BluePluginHostOverlayEntry,
  type BluePluginHostPaneEntry,
  type BluePluginHostSnapshot,
  type BlueResult,
  type BlueUiEvent,
  type BlueUiEventHandler,
  type BlueUiNode,
} from '@dsh-blue/blue-api'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { getLayoutNode, LAYOUT_NODE, type LayoutNode } from '@earendil-works/pi-tui/dist/layout-node.js'
import { ownDataErrorMessage } from './error-message.ts'
import type { BlueTerminalRuntime } from './terminal.ts'
import type { SurfaceLaneEntry, SurfaceRegistration } from './surface-manager.ts'
import { BlueUiSurfaceRuntime, compileBlueUiNode, compileBlueUiSurfaceNode, type BlueCompiledUi, type BlueUiViewport } from './ui-compiler.ts'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueOverlayHandle, BlueSemanticColors } from './types.ts'

const EVENT_TIMEOUT_MS = 30_000
const OVERLAY_DEFAULT_WIDTH = '70%'
const OVERLAY_DEFAULT_MAX_HEIGHT = '80%'

function ownerRevision(value: number | undefined): number {
  /* v8 ignore next -- real BluePluginHostService entries and snapshots always carry revisions; undefined only preserves external mock compatibility. */
  return value ?? 0
}

type OwnerContext = Context & {
  readonly blueComponents: BlueComponents
  readonly blueTheme: { readonly colors: BlueSemanticColors }
  readonly blueKeymap: BlueKeymap
}

interface DispatchTask {
  readonly event: BlueUiEvent
  readonly revision: number
  readonly renderGeneration: number
  readonly controller: AbortController
}

function succeeded(result: BlueResult): boolean { return result.ok }

class SurfaceEventOwner {
  private live = true
  private revision = 0
  private renderGeneration = 0
  private readonly latest = new Map<string, AbortController>()
  private readonly fifo: DispatchTask[] = []
  private fifoRunning = false
  private readonly active = new Set<AbortController>()

  constructor(
    private readonly lease: ReturnType<Context['bluePluginControl']['attachCapabilities']>,
    private readonly surfaceId: string,
    private readonly capability: 'panes' | 'overlays',
    private readonly handler: BlueUiEventHandler | undefined,
    private readonly refresh: () => void,
    private readonly close: (() => void) | undefined,
  ) {}

  private generationCurrent(): boolean {
    return this.lease.current(this.capability)
  }

  replaceExternally(): void {
    for (const controller of this.active) controller.abort()
    for (const task of this.fifo) task.controller.abort()
    this.fifo.length = 0
    this.latest.clear()
    this.renderGeneration += 1
  }

  emit(event: BlueUiEvent): void {
    if (!this.live || !this.generationCurrent()) return
    const revision = ++this.revision
    const task: DispatchTask = { event, revision, renderGeneration: this.renderGeneration, controller: new AbortController() }
    if (event.kind === 'value-change' || event.kind === 'selection-change' || event.kind === 'tab-change') {
      const key = event.controlId
      this.latest.get(key)?.abort()
      this.latest.set(key, task.controller)
      void this.execute(task).finally(() => { if (this.latest.get(key) === task.controller) this.latest.delete(key) })
      return
    }
    this.fifo.push(task)
    void this.drainFifo()
  }

  dispose(): void {
    if (!this.live) return
    this.live = false
    for (const controller of this.active) controller.abort()
    for (const task of this.fifo) task.controller.abort()
    this.fifo.length = 0
    this.latest.clear()
  }

  private async drainFifo(): Promise<void> {
    if (this.fifoRunning) return
    this.fifoRunning = true
    try {
      while (this.live && this.fifo.length > 0) await this.execute(this.fifo.shift()!)
    } finally {
      this.fifoRunning = false
    }
  }

  private async execute(task: DispatchTask): Promise<void> {
    /* v8 ignore next -- every abort path removes queued tasks before execution. */
    if (!this.live || task.controller.signal.aborted || !this.generationCurrent()) return
    this.active.add(task.controller)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const result = await this.lease.runUserGesture(this.capability, async userGesture => {
        if (this.handler === undefined) return { ok: true, value: undefined } as const
        const handled = Promise.resolve().then(() => this.handler!(task.event, {
          surfaceId: this.surfaceId,
          signal: task.controller.signal,
          revision: task.revision,
          userGesture,
        }))
        const timeoutResult = new Promise<BlueResult>(resolve => {
          timeout = setTimeout(() => {
            timedOut = true
            task.controller.abort()
            resolve({ ok: false, code: 'BLUE_ABORTED', message: 'plugin UI event timed out' })
          }, EVENT_TIMEOUT_MS)
        })
        const aborted = new Promise<BlueResult>(resolve => {
          const abort = () => resolve({ ok: false, code: 'BLUE_ABORTED', message: 'plugin UI event was aborted' })
          task.controller.signal.addEventListener('abort', abort, { once: true })
          void handled.then(
            () => task.controller.signal.removeEventListener('abort', abort),
            () => task.controller.signal.removeEventListener('abort', abort),
          )
        })
        return Promise.race([handled, timeoutResult, aborted])
      }, task.controller.signal)
      if (timedOut) { this.closeSurface(); return }
      if (!this.live || task.controller.signal.aborted || task.renderGeneration !== this.renderGeneration || !this.generationCurrent() || !succeeded(result)) return
      if (task.event.kind === 'dismiss') this.closeSurface()
      else this.refresh()
    } catch {
      /* v8 ignore next -- aborted/not-live dispatches settle through the raced abort result. */
      if (this.live && (timedOut || !task.controller.signal.aborted)) this.closeSurface()
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      this.active.delete(task.controller)
    }
  }

  private closeSurface(): void {
    if (this.close === undefined || !this.generationCurrent()) return
    this.dispose()
    this.close()
  }
}

function safeFailureNode(kind: 'pane' | 'overlay', error: unknown): BlueUiNode {
  const reason = typeof error === 'string' && error.trim().length > 0
    ? error
    : ownDataErrorMessage(error) ?? 'render failed'
  return { kind: 'text', tone: 'danger', content: `Plugin ${kind} failed: ${reason}` }
}

function compile(
  render: () => BlueUiNode | null,
  kind: 'pane' | 'overlay',
  options: {
    readonly components: BlueComponents
    readonly colors: BlueSemanticColors
    readonly viewport: () => BlueUiViewport
    readonly mode: 'main' | 'alternate'
    readonly emit: (event: BlueUiEvent) => void
    readonly onEscape?: () => void
    readonly escapeHint?: 'close' | 'leave'
    readonly translateHint?: (key: string) => string
    readonly interactive: boolean
    readonly runtime: BlueUiSurfaceRuntime
    readonly refreshMode: 'internal' | 'external'
    readonly title?: string
  },
): BlueCompiledUi | null {
  const framed = (value: BlueUiNode): BlueUiNode => options.title === undefined ? value : {
    kind: 'surface',
    chrome: 'overlay',
    title: options.title,
    padding: 1,
    child: value,
  }
  let node: BlueUiNode | null
  try { node = render() } catch (error) {
    options.runtime.deactivate()
    const fallbackNode = safeFailureNode(kind, error)
    const fallback = compileBlueUiNode(framed(fallbackNode), {
      components: options.components,
      colors: options.colors,
      getViewport: options.viewport,
      screenMode: options.mode,
      emit: options.emit,
      ...(options.onEscape === undefined ? {} : { onUnhandledEscape: options.onEscape }),
    })
    /* v8 ignore next -- the admitted constant fallback text cannot fail compilation. */
    return fallback.ok ? fallback.value : { node: fallbackNode, component: fallback.errorComponent, focusTarget: null }
  }
  if (node === null) {
    if (kind === 'pane') return null
    options.runtime.deactivate()
    const fallbackNode = safeFailureNode(kind, 'overlay render returned no node')
    const fallback = compileBlueUiNode(framed(fallbackNode), {
      components: options.components,
      colors: options.colors,
      getViewport: options.viewport,
      screenMode: options.mode,
      emit: options.emit,
      ...(options.onEscape === undefined ? {} : { onUnhandledEscape: options.onEscape }),
    })
    /* v8 ignore next -- the admitted constant fallback text cannot fail compilation. */
    return fallback.ok ? fallback.value : { node: fallbackNode, component: fallback.errorComponent, focusTarget: null }
  }
  const compilerOptions = {
    components: options.components,
    colors: options.colors,
    getViewport: options.viewport,
    screenMode: options.mode,
    emit: options.emit,
    contextHints: {
      focusWithoutControls: kind === 'overlay' && options.interactive && options.onEscape !== undefined,
      ...(options.translateHint === undefined ? {} : { translate: options.translateHint }),
    },
    ...(options.onEscape === undefined ? {} : { onUnhandledEscape: options.onEscape }),
  }
  if (!options.interactive) {
    const candidate = compileBlueUiNode(framed(node), compilerOptions)
    if (!candidate.ok || candidate.value.focusTarget !== null) {
      options.runtime.deactivate()
      const fallbackNode = safeFailureNode(kind, candidate.ok ? 'non-capturing overlays cannot contain interactive controls' : candidate.message)
      const fallback = compileBlueUiNode(framed(fallbackNode), compilerOptions)
      /* v8 ignore next -- the admitted constant fallback text cannot fail compilation. */
      return fallback.ok ? fallback.value : { node: fallbackNode, component: fallback.errorComponent, focusTarget: null }
    }
  }
  const result = compileBlueUiSurfaceNode(framed(node), {
    ...compilerOptions,
    surfaceRuntime: options.runtime,
    refreshMode: options.refreshMode,
    ...(options.escapeHint === undefined ? {} : { escapeHint: options.escapeHint }),
  })
  if (!result.ok) {
    options.runtime.deactivate()
    const fallbackNode = safeFailureNode(kind, result.message)
    const fallback = compileBlueUiNode(framed(fallbackNode), compilerOptions)
    /* v8 ignore next -- the admitted constant fallback text cannot fail compilation. */
    return fallback.ok ? fallback.value : { node: fallbackNode, component: fallback.errorComponent, focusTarget: null }
  }
  return result.value
}

function setCompiledFocus(compiled: BlueCompiledUi | null, focused: boolean): void {
  const component = compiled?.component as BlueFocusable | undefined
  const target = compiled?.focusTarget ?? (typeof component?.focused === 'boolean' ? component : null)
  if (target !== undefined && target !== null) target.focused = focused
}

class PaneComponent implements BlueFocusable {
  private targetValue: BlueCompiledUi | null = null
  private focusedValue = false
  private live = true

  get focused(): boolean { return this.live && this.focusedValue }
  set focused(value: boolean) {
    this.focusedValue = this.live && value
    setCompiledFocus(this.targetValue, this.focusedValue)
  }
  [LAYOUT_NODE](): LayoutNode {
    return !this.live || this.targetValue === null
      ? { type: 'vstack', entries: [], gap: 0, align: 'stretch' }
      : getLayoutNode(this.targetValue.component)!
  }
  replace(compiled: BlueCompiledUi | null): void {
    /* v8 ignore next -- record/map identity fences prevent replacement after one disposal. */
    if (!this.live) return
    setCompiledFocus(this.targetValue, false)
    this.targetValue = compiled
    setCompiledFocus(compiled, this.focusedValue)
  }
  dispose(): void {
    /* v8 ignore next -- every record is removed before another cleanup path can observe it. */
    if (!this.live) return
    this.live = false
    setCompiledFocus(this.targetValue, false)
    this.targetValue = null
    this.focusedValue = false
  }
  render(width: number): string[] { return this.live ? this.targetValue?.component.render(width) ?? [] : [] }
  invalidate(): void { if (this.live) this.targetValue?.component.invalidate() }
  handleInput(data: string): void { if (this.live) this.targetValue?.focusTarget?.handleInput?.(data) }
}

class OverlayComponent implements BlueFocusable {
  private targetValue: BlueCompiledUi | null
  private focusedValue = false
  private live = true
  constructor(
    compiled: BlueCompiledUi,
    private readonly viewport: () => BlueUiViewport,
    private readonly requestRender: () => void,
  ) { this.targetValue = compiled }
  get focused(): boolean { return this.live && this.focusedValue }
  set focused(value: boolean) {
    this.focusedValue = this.live && value
    setCompiledFocus(this.targetValue, this.focusedValue)
  }
  replace(compiled: BlueCompiledUi): void {
    /* v8 ignore next -- record/map identity fences prevent replacement after one disposal. */
    if (!this.live) return
    setCompiledFocus(this.targetValue, false)
    this.targetValue = compiled
    setCompiledFocus(compiled, this.focusedValue)
  }
  dispose(): void {
    /* v8 ignore next -- every record is removed before another cleanup path can observe it. */
    if (!this.live) return
    this.live = false
    setCompiledFocus(this.targetValue, false)
    this.targetValue = null
    this.focusedValue = false
  }
  render(width: number): string[] {
    if (!this.live || this.targetValue === null) return []
    const rows = this.targetValue.component.render(width)
    const height = this.viewport().rows
    if (rows.length < height) return rows
    return renderLayoutFrame(this.targetValue.component, width, height, this.requestRender).lines
  }
  invalidate(): void { if (this.live) this.targetValue?.component.invalidate() }
  handleInput(data: string): void { if (this.live) this.targetValue?.component.handleInput?.(data) }
}

interface PaneRecord {
  entry: BluePluginHostPaneEntry
  readonly events: SurfaceEventOwner
  readonly runtime: BlueUiSurfaceRuntime
  readonly component: PaneComponent
  registration: SurfaceRegistration | undefined
  renderScheduled?: boolean
  renderMode: 'internal' | 'external' | undefined
}

interface OverlayRecord {
  entry: BluePluginHostOverlayEntry
  readonly events: SurfaceEventOwner
  readonly runtime: BlueUiSurfaceRuntime
  readonly component: OverlayComponent
  readonly handle: BlueOverlayHandle
  renderScheduled?: boolean
  renderMode: 'internal' | 'external' | undefined
}

function overlayAnchor(anchor: BluePluginHostOverlayEntry['request']['anchor']) {
  switch (anchor) {
    case 'top': return 'top-center' as const
    case 'bottom': return 'bottom-center' as const
    case 'left': return 'left-center' as const
    case 'right': return 'right-center' as const
    default: return 'center' as const
  }
}

function focusTarget(entry: SurfaceLaneEntry): BlueFocusable | null {
  if (entry.focusTarget !== undefined) return entry.focusTarget
  return typeof (entry.component as BlueFocusable).focused === 'boolean' ? entry.component as BlueFocusable : null
}

/** Mount the core-private owner bridge after theme/components become available. */
export function mountPluginSurfaceBridge(ctx: OwnerContext, runtime: BlueTerminalRuntime, translateHint?: (key: string) => string): void {
  const control = ctx.bluePluginControl
  const lease = control.attachCapabilities(ctx, ['panes', 'overlays'])
  const panes = new Map<string, PaneRecord>()
  const overlays = new Map<string, OverlayRecord>()
  let disposed = false
  let pending: BluePluginHostSnapshot | undefined
  let scheduled = false
  let appliedRevision = -1
  let navigationId: string | undefined

  const currentLayout = () => runtime.mode === 'main'
    ? runtime.surfaces.linearLayout(runtime.columns, runtime.rows)
    : runtime.surfaces.layout(runtime.columns, runtime.rows)

  const paneViewport = (id: string): BlueUiViewport => runtime.surfaceViewport(id)
  const overlayViewport = (entry: BluePluginHostOverlayEntry): BlueUiViewport => {
    const percent = (value: string, total: number) => Math.max(1, Math.floor(total * Number.parseFloat(value) / 100))
    const width = entry.request.width ?? OVERLAY_DEFAULT_WIDTH
    const requestedWidth = typeof width === 'string' ? percent(width, runtime.columns) : Math.floor(width)
    const maximum = 100
    const columns = Math.min(runtime.columns, maximum, Math.max(Math.floor(entry.request.minWidth ?? 1), requestedWidth))
    const height = entry.request.maxHeight ?? OVERLAY_DEFAULT_MAX_HEIGHT
    return { columns: Math.max(1, columns), rows: Math.max(1, Math.min(runtime.rows, typeof height === 'string' ? percent(height, runtime.rows) : Math.floor(height))) }
  }

  const renderPane = (record: PaneRecord, refreshMode: 'internal' | 'external'): void => {
    const entry = record.entry
    const compiled = compile(entry.contribution.render, 'pane', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => paneViewport(entry.id),
      mode: runtime.mode,
      emit: event => record.events.emit(event),
      onEscape: () => runtime.releaseSurfaceFocus(entry.id),
      escapeHint: 'leave',
      ...(translateHint === undefined ? {} : { translateHint }),
      interactive: true,
      runtime: record.runtime,
      refreshMode,
    })
    if (compiled === null) {
      record.runtime.deactivate()
      record.component.replace(null)
      record.registration?.dispose()
      record.registration = undefined
      return
    }
    record.component.replace(compiled)
    if (record.registration === undefined) {
      record.registration = runtime.surfaces.register({
        id: entry.id,
        ...(entry.contribution.title === undefined ? {} : { title: entry.contribution.title }),
        placement: entry.contribution.placement,
        ...(entry.contribution.priority === undefined ? {} : { priority: entry.contribution.priority }),
        ...(entry.contribution.size === undefined ? {} : { size: entry.contribution.size }),
        ...(entry.contribution.narrow === undefined ? {} : { narrow: entry.contribution.narrow }),
        component: record.component,
        focusTarget: compiled.focusTarget === null ? null : record.component,
      })
      record.registration.setHidden(entry.hidden)
    } else record.registration.replace(record.component, compiled.focusTarget === null ? null : record.component)
    runtime.requestRender()
  }

  const schedulePane = (record: PaneRecord, mode: 'internal' | 'external'): void => {
    if (mode === 'external' || record.renderMode === undefined) record.renderMode = mode
    if (record.renderScheduled === true) return
    record.renderScheduled = true
    queueMicrotask(() => {
      record.renderScheduled = false
      const refreshMode = record.renderMode!
      record.renderMode = undefined
      const retained = pending === undefined || pending.panes.includes(record.entry)
      if (!disposed && retained && panes.get(record.entry.id) === record) renderPane(record, refreshMode)
    })
  }

  const addPane = (entry: BluePluginHostPaneEntry): void => {
    let record!: PaneRecord
    const events = new SurfaceEventOwner(lease, entry.id, 'panes', entry.contribution.onEvent, () => schedulePane(record, 'internal'), undefined)
    record = { entry, events, runtime: new BlueUiSurfaceRuntime(), component: new PaneComponent(), registration: undefined, renderMode: undefined }
    panes.set(entry.id, record)
    schedulePane(record, 'external')
  }

  const addOverlay = (entry: BluePluginHostOverlayEntry): void => {
    let record!: OverlayRecord
    const events = new SurfaceEventOwner(lease, entry.id, 'overlays', entry.request.onEvent, () => scheduleOverlay(record, 'internal'), () => {
      lease.closeOverlay(record.entry)
    })
    const surfaceRuntime = new BlueUiSurfaceRuntime()
    const compiled = compile(entry.request.render, 'overlay', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => overlayViewport(entry),
      mode: runtime.mode,
      emit: event => events.emit(event),
      ...(entry.request.capturing && entry.request.dismissible ? { onEscape: () => events.emit({ kind: 'dismiss' as const }), escapeHint: 'close' as const } : {}),
      ...(translateHint === undefined ? {} : { translateHint }),
      interactive: entry.request.capturing,
      runtime: surfaceRuntime,
      refreshMode: 'external',
      ...(entry.request.title === undefined ? {} : { title: entry.request.title }),
    })!
    const component = new OverlayComponent(compiled, () => overlayViewport(entry), runtime.requestRender)
    const handle = runtime.showOverlay(component, {
      width: entry.request.width ?? OVERLAY_DEFAULT_WIDTH,
      ...(entry.request.minWidth === undefined ? {} : { minWidth: entry.request.minWidth }),
      maxWidth: 100,
      maxHeight: entry.request.maxHeight ?? OVERLAY_DEFAULT_MAX_HEIGHT,
      anchor: overlayAnchor(entry.request.anchor),
      nonCapturing: !entry.request.capturing,
    })
    record = { entry, events, runtime: surfaceRuntime, component, handle, renderMode: undefined }
    overlays.set(entry.id, record)
  }

  const renderOverlay = (record: OverlayRecord, refreshMode: 'internal' | 'external'): void => {
    const entry = record.entry
    const compiled = compile(entry.request.render, 'overlay', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => overlayViewport(entry),
      mode: runtime.mode,
      emit: event => record.events.emit(event),
      ...(entry.request.capturing && entry.request.dismissible ? { onEscape: () => record.events.emit({ kind: 'dismiss' as const }), escapeHint: 'close' as const } : {}),
      ...(translateHint === undefined ? {} : { translateHint }),
      interactive: entry.request.capturing,
      runtime: record.runtime,
      refreshMode,
      ...(entry.request.title === undefined ? {} : { title: entry.request.title }),
    })!
    record.component.replace(compiled)
    runtime.requestRender()
  }

  const scheduleOverlay = (record: OverlayRecord, mode: 'internal' | 'external'): void => {
    if (mode === 'external' || record.renderMode === undefined) record.renderMode = mode
    if (record.renderScheduled === true) return
    record.renderScheduled = true
    queueMicrotask(() => {
      record.renderScheduled = false
      const refreshMode = record.renderMode!
      record.renderMode = undefined
      const retained = pending === undefined || pending.overlays.includes(record.entry)
      if (!disposed && retained && overlays.get(record.entry.id) === record) renderOverlay(record, refreshMode)
    })
  }

  const reconcile = (snapshot: BluePluginHostSnapshot): void => {
    const paneIds = new Set(snapshot.panes.map(entry => entry.id))
    for (const [id, record] of panes) if (!paneIds.has(id)) {
      const layout = navigationId === id ? currentLayout() : undefined
      const navigationPlacement = layout === undefined
        ? undefined
        : [layout.header, layout.left, layout.right, layout.bottom].find(lane => lane?.active.id === id)?.placement
      record.events.dispose()
      record.runtime.dispose()
      record.component.dispose()
      record.registration?.dispose()
      panes.delete(id)
      if (navigationId === id) {
        const layout = currentLayout()
        navigationId = navigationPlacement === undefined
          ? runtime.surfaces.focusedId
          : layout[navigationPlacement]?.active.id ?? runtime.surfaces.focusedId
      }
    }
    for (const entry of snapshot.panes) {
      const record = panes.get(entry.id)
      if (record === undefined) { addPane(entry); continue }
      if (record.entry.contribution !== entry.contribution) {
        record.events.dispose()
        record.runtime.dispose()
        record.component.dispose()
        record.registration?.dispose()
        panes.delete(entry.id)
        addPane(entry)
        continue
      }
      const renderChanged = ownerRevision(record.entry.revision) !== ownerRevision(entry.revision)
      record.entry = entry
      record.registration?.setHidden(entry.hidden)
      if (renderChanged) schedulePane(record, 'external')
    }

    const overlayIds = new Set(snapshot.overlays.map(entry => entry.id))
    for (const [id, record] of [...overlays].reverse()) if (!overlayIds.has(id)) {
      record.events.dispose()
      record.runtime.dispose()
      record.component.dispose()
      record.handle.hide()
      overlays.delete(id)
    }
    for (const entry of [...snapshot.overlays].sort((left, right) => left.order - right.order)) {
      const record = overlays.get(entry.id)
      if (record === undefined) { addOverlay(entry); continue }
      if (record.entry.request !== entry.request) {
        record.events.dispose()
        record.runtime.dispose()
        record.component.dispose()
        record.handle.hide()
        overlays.delete(entry.id)
        addOverlay(entry)
        continue
      }
      const renderChanged = ownerRevision(record.entry.revision) !== ownerRevision(entry.revision)
      record.entry = entry
      if (renderChanged) scheduleOverlay(record, 'external')
    }
    appliedRevision = Math.max(appliedRevision, ownerRevision(snapshot.revision))
  }

  const drain = (): void => {
    scheduled = false
    if (disposed) return
    const snapshot = pending!
    pending = undefined
    reconcile(snapshot)
  }
  const schedule = (snapshot: BluePluginHostSnapshot): void => {
    /* v8 ignore next -- host snapshots are monotonic and built at listener invocation. */
    if (ownerRevision(snapshot.revision) <= appliedRevision) return
    const paneEntries = new Map(snapshot.panes.map(entry => [entry.id, entry]))
    const overlayEntries = new Map(snapshot.overlays.map(entry => [entry.id, entry]))
    for (const [id, record] of panes) {
      const entry = paneEntries.get(id)
      if (entry === undefined || entry.contribution !== record.entry.contribution) record.events.dispose()
      else if (entry !== record.entry) record.events.replaceExternally()
    }
    for (const [id, record] of overlays) {
      const entry = overlayEntries.get(id)
      if (entry === undefined || entry.request !== record.entry.request) record.events.dispose()
      else if (entry !== record.entry) record.events.replaceExternally()
    }
    pending = snapshot
    if (!scheduled) { scheduled = true; queueMicrotask(drain) }
  }
  const navigate = (direction: -1 | 1): void => {
    if (runtime.hasCapturingOverlay()) return
    const layout = currentLayout()
    const seen = new Set<string>()
    const entries = [layout.header, layout.left, layout.right, layout.bottom].flatMap(lane =>
      lane === undefined ? [] : lane.entries.flatMap(entry => {
        /* v8 ignore next -- host admission and SurfaceManager both enforce global ids. */
        if (seen.has(entry.id)) return []
        seen.add(entry.id)
        return [{ lane, entry }]
      }),
    )
    if (entries.length === 0) return
    const currentId = runtime.surfaces.focusedId ?? navigationId
    const current = entries.findIndex(item => item.entry.id === currentId)
    const next = current < 0 ? (direction > 0 ? 0 : entries.length - 1) : current + direction
    if (next < 0 || next >= entries.length) {
      if (runtime.surfaces.focusedId !== undefined) runtime.releaseSurfaceFocus(runtime.surfaces.focusedId)
      navigationId = undefined
      return
    }
    const selected = entries[next]!
    const previousFocused = runtime.surfaces.focusedId
    const target = focusTarget(selected.entry)
    if (target === null && previousFocused !== undefined) runtime.releaseSurfaceFocus(previousFocused)
    runtime.surfaces.activate(selected.lane.placement, selected.entry.id)
    navigationId = selected.entry.id
    if (target !== null) runtime.setFocus(target)
  }
  ctx.effect(() => ctx.blueKeymap.register([
    { id: 'blue.surface.next', keys: 'f6', description: 'Focus the next Blue surface', handler: () => navigate(1) },
    { id: 'blue.surface.previous', keys: 'shift+f6', description: 'Focus the previous Blue surface', handler: () => navigate(-1) },
  ]))
  const subscription = lease.subscribe(schedule)
  ctx.effect(() => () => {
    disposed = true
    subscription.dispose()
    const closing = new Map<string, BluePluginHostOverlayEntry>()
    for (const record of overlays.values()) closing.set(record.entry.id, record.entry)
    for (const entry of pending?.overlays ?? []) closing.set(entry.id, entry)
    for (const entry of [...closing.values()].reverse()) {
      // Overlay opens are actions, not durable registrations. Closing the
      // host entry here prevents a replacement renderer from replaying a
      // stale overlay after this owner Fiber enters a gap.
      lease.closeOverlay(entry)
    }
    for (const record of [...overlays.values()].reverse()) {
      record.events.dispose()
      record.runtime.dispose()
      record.component.dispose()
      record.handle.hide()
    }
    for (const record of panes.values()) {
      record.events.dispose()
      record.runtime.dispose()
      record.component.dispose()
      record.registration?.dispose()
    }
    overlays.clear()
    panes.clear()
    pending = undefined
  })
}
