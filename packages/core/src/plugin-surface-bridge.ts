/** Blue-owned runtime bridge from public pane/overlay models to core surfaces. */
import { symbols, type Context } from '@deepseek-ai/cordis'
import {
  attachBluePluginHostCapabilities,
  closeBluePluginHostOverlay,
  runBlueUserGesture,
  subscribeBluePluginHost,
  type BluePluginHostOverlayEntry,
  type BluePluginHostPaneEntry,
  type BluePluginHostService,
  type BluePluginHostSnapshot,
  type BlueResult,
  type BlueUiEvent,
  type BlueUiEventHandler,
  type BlueUiNode,
} from '@dsh-blue/blue-api'
import type { BlueTerminalRuntime } from './terminal.ts'
import type { SurfaceLaneEntry, SurfaceRegistration } from './surface-manager.ts'
import { compileBlueUiNode, type BlueCompiledUi, type BlueUiViewport } from './ui-compiler.ts'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueOverlayHandle, BlueSemanticColors } from './types.ts'

const EVENT_TIMEOUT_MS = 30_000
const OVERLAY_DEFAULT_WIDTH = '70%'
const OVERLAY_DEFAULT_MAX_HEIGHT = '80%'

function ownerRevision(value: number | undefined): number {
  /* v8 ignore next -- real BluePluginHostService entries and snapshots always carry revisions; undefined only preserves external mock compatibility. */
  return value ?? 0
}

type OwnerContext = Context & {
  readonly bluePluginHost: BluePluginHostService
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
    private readonly host: BluePluginHostService,
    private readonly owner: Context,
    private readonly surfaceId: string,
    private readonly handler: BlueUiEventHandler | undefined,
    private readonly refresh: () => void,
    private readonly close: (() => void) | undefined,
  ) {}

  replaceExternally(): void {
    for (const controller of this.active) controller.abort()
    for (const task of this.fifo) task.controller.abort()
    this.fifo.length = 0
    this.latest.clear()
    this.renderGeneration += 1
  }

  emit(event: BlueUiEvent): void {
    if (!this.live) return
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
    if (!this.live || task.controller.signal.aborted) return
    this.active.add(task.controller)
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    try {
      const result = await runBlueUserGesture(this.host, this.owner, async userGesture => {
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
      if (!this.live || task.controller.signal.aborted || task.renderGeneration !== this.renderGeneration || !succeeded(result)) return
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
    if (this.close === undefined) return
    this.dispose()
    this.close()
  }
}

function safeFailureNode(kind: 'pane' | 'overlay', error: unknown): BlueUiNode {
  const reason = typeof error === 'string' && error.trim().length > 0
    ? error
    : error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'render failed'
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
    readonly onEscape: () => void
    readonly interactive: boolean
    readonly title?: string
  },
): BlueCompiledUi | null {
  let node: BlueUiNode | null
  try { node = render() } catch (error) { node = safeFailureNode(kind, error) }
  if (node === null) {
    if (kind === 'pane') return null
    node = safeFailureNode(kind, 'overlay render returned no node')
  }
  const compileNode = (value: BlueUiNode) => compileBlueUiNode(options.title === undefined ? value : {
    kind: 'surface',
    chrome: 'overlay',
    title: options.title,
    child: value,
  }, {
    components: options.components,
    colors: options.colors,
    getViewport: options.viewport,
    screenMode: options.mode,
    emit: options.emit,
    onUnhandledEscape: options.onEscape,
  })
  let result = compileNode(node)
  if (!result.ok) result = compileNode(safeFailureNode(kind, result.message))
  if (!result.ok) return { node: safeFailureNode(kind, result.message), component: result.errorComponent, focusTarget: null }
  if (!options.interactive && result.value.focusTarget !== null) {
    result = compileNode(safeFailureNode(kind, 'non-capturing overlays cannot contain interactive controls'))
    /* v8 ignore next -- the admitted constant fallback text cannot fail compilation. */
    if (!result.ok) return { node: safeFailureNode(kind, result.message), component: result.errorComponent, focusTarget: null }
  }
  return result.value
}

class OverlayComponent implements BlueFocusable {
  private targetValue: BlueCompiledUi
  private focusedValue = false
  constructor(compiled: BlueCompiledUi) { this.targetValue = compiled }
  get focused(): boolean { return this.focusedValue }
  set focused(value: boolean) {
    this.focusedValue = value
    if (this.targetValue.focusTarget !== null) this.targetValue.focusTarget.focused = value
  }
  replace(compiled: BlueCompiledUi): void {
    if (this.targetValue.focusTarget !== null) this.targetValue.focusTarget.focused = false
    this.targetValue = compiled
    if (compiled.focusTarget !== null) compiled.focusTarget.focused = this.focusedValue
  }
  render(width: number): string[] { return this.targetValue.component.render(width) }
  invalidate(): void { this.targetValue.component.invalidate() }
  handleInput(data: string): void { this.targetValue.component.handleInput?.(data) }
}

interface PaneRecord {
  entry: BluePluginHostPaneEntry
  readonly events: SurfaceEventOwner
  registration: SurfaceRegistration | undefined
  renderScheduled?: boolean
}

interface OverlayRecord {
  entry: BluePluginHostOverlayEntry
  readonly events: SurfaceEventOwner
  readonly component: OverlayComponent
  readonly handle: BlueOverlayHandle
  renderScheduled?: boolean
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
export function mountPluginSurfaceBridge(ctx: OwnerContext, runtime: BlueTerminalRuntime): void {
  const host = (ctx.bluePluginHost as unknown as Record<symbol, BluePluginHostService | undefined>)[symbols.original] ?? ctx.bluePluginHost
  attachBluePluginHostCapabilities(host, ctx, ['panes', 'overlays'])
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

  const renderPane = (record: PaneRecord): void => {
    const entry = record.entry
    const compiled = compile(entry.contribution.render, 'pane', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => paneViewport(entry.id),
      mode: runtime.mode,
      emit: event => record.events.emit(event),
      onEscape: () => runtime.releaseSurfaceFocus(entry.id),
      interactive: true,
    })
    if (compiled === null) {
      record.registration?.dispose()
      record.registration = undefined
      return
    }
    if (record.registration === undefined) {
      record.registration = runtime.surfaces.register({
        id: entry.id,
        ...(entry.contribution.title === undefined ? {} : { title: entry.contribution.title }),
        placement: entry.contribution.placement,
        ...(entry.contribution.priority === undefined ? {} : { priority: entry.contribution.priority }),
        ...(entry.contribution.size === undefined ? {} : { size: entry.contribution.size }),
        ...(entry.contribution.narrow === undefined ? {} : { narrow: entry.contribution.narrow }),
        component: compiled.component,
        focusTarget: compiled.focusTarget,
      })
      record.registration.setHidden(entry.hidden)
    } else record.registration.replace(compiled.component, compiled.focusTarget)
  }

  const schedulePane = (record: PaneRecord, external: boolean): void => {
    if (external) record.events.replaceExternally()
    if (record.renderScheduled === true) return
    record.renderScheduled = true
    queueMicrotask(() => {
      record.renderScheduled = false
      const retained = pending === undefined || pending.panes.includes(record.entry)
      if (!disposed && retained && panes.get(record.entry.id) === record) renderPane(record)
    })
  }

  const addPane = (entry: BluePluginHostPaneEntry): void => {
    let record!: PaneRecord
    const events = new SurfaceEventOwner(host, ctx, entry.id, entry.contribution.onEvent, () => schedulePane(record, false), undefined)
    record = { entry, events, registration: undefined }
    panes.set(entry.id, record)
    schedulePane(record, true)
  }

  const addOverlay = (entry: BluePluginHostOverlayEntry): void => {
    let record!: OverlayRecord
    const events = new SurfaceEventOwner(host, ctx, entry.id, entry.request.onEvent, () => scheduleOverlay(record, false), () => {
      closeBluePluginHostOverlay(host, ctx, record.entry)
    })
    const compiled = compile(entry.request.render, 'overlay', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => overlayViewport(entry),
      mode: runtime.mode,
      emit: event => events.emit(event),
      onEscape: () => { if (entry.request.capturing && entry.request.dismissible) events.emit({ kind: 'dismiss' }) },
      interactive: entry.request.capturing,
      ...(entry.request.title === undefined ? {} : { title: entry.request.title }),
    })!
    const component = new OverlayComponent(compiled)
    const handle = runtime.showOverlay(component, {
      width: entry.request.width ?? OVERLAY_DEFAULT_WIDTH,
      ...(entry.request.minWidth === undefined ? {} : { minWidth: entry.request.minWidth }),
      maxWidth: 100,
      maxHeight: entry.request.maxHeight ?? OVERLAY_DEFAULT_MAX_HEIGHT,
      anchor: overlayAnchor(entry.request.anchor),
      nonCapturing: !entry.request.capturing,
    })
    record = { entry, events, component, handle }
    overlays.set(entry.id, record)
  }

  const renderOverlay = (record: OverlayRecord): void => {
    const entry = record.entry
    const compiled = compile(entry.request.render, 'overlay', {
      components: ctx.blueComponents,
      colors: ctx.blueTheme.colors,
      viewport: () => overlayViewport(entry),
      mode: runtime.mode,
      emit: event => record.events.emit(event),
      onEscape: () => { if (entry.request.capturing && entry.request.dismissible) record.events.emit({ kind: 'dismiss' }) },
      interactive: entry.request.capturing,
      ...(entry.request.title === undefined ? {} : { title: entry.request.title }),
    })!
    record.component.replace(compiled)
    runtime.requestRender()
  }

  const scheduleOverlay = (record: OverlayRecord, external: boolean): void => {
    if (external) record.events.replaceExternally()
    if (record.renderScheduled === true) return
    record.renderScheduled = true
    queueMicrotask(() => {
      record.renderScheduled = false
      const retained = pending === undefined || pending.overlays.includes(record.entry)
      if (!disposed && retained && overlays.get(record.entry.id) === record) renderOverlay(record)
    })
  }

  const reconcile = (snapshot: BluePluginHostSnapshot): void => {
    const paneIds = new Set(snapshot.panes.map(entry => entry.id))
    for (const [id, record] of panes) if (!paneIds.has(id)) {
      const layout = navigationId === id ? currentLayout() : undefined
      const navigationPlacement = layout === undefined
        ? undefined
        : [layout.header, layout.left, layout.right, layout.bottom].find(lane => lane?.active.id === id)?.placement
      record.events.dispose(); record.registration?.dispose(); panes.delete(id)
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
        record.events.dispose(); record.registration?.dispose(); panes.delete(entry.id); addPane(entry); continue
      }
      const renderChanged = ownerRevision(record.entry.revision) !== ownerRevision(entry.revision)
      record.entry = entry
      record.registration?.setHidden(entry.hidden)
      if (renderChanged) schedulePane(record, true)
    }

    const overlayIds = new Set(snapshot.overlays.map(entry => entry.id))
    for (const [id, record] of [...overlays].reverse()) if (!overlayIds.has(id)) {
      record.events.dispose(); record.handle.hide(); overlays.delete(id)
    }
    for (const entry of [...snapshot.overlays].sort((left, right) => left.order - right.order)) {
      const record = overlays.get(entry.id)
      if (record === undefined) { addOverlay(entry); continue }
      if (record.entry.request !== entry.request) {
        record.events.dispose(); record.handle.hide(); overlays.delete(entry.id); addOverlay(entry); continue
      }
      const renderChanged = ownerRevision(record.entry.revision) !== ownerRevision(entry.revision)
      record.entry = entry
      if (renderChanged) scheduleOverlay(record, true)
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
  const subscription = subscribeBluePluginHost(host, schedule)
  ctx.effect(() => () => {
    disposed = true
    subscription.dispose()
    for (const record of [...overlays.values()].reverse()) { record.events.dispose(); record.handle.hide() }
    for (const record of panes.values()) { record.events.dispose(); record.registration?.dispose() }
    overlays.clear(); panes.clear(); pending = undefined
  })
}
