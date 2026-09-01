/** Direct Fiber-owned Blue UI registries.
 * @module @dsh-blue/blue-api/services
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  BlueEditorExtensionContribution,
  BlueEditorExtensionRegistry,
  BlueOverlayEntry,
  BlueOverlayHandle,
  BlueOverlayRegistry,
  BlueOverlayRequest,
  BluePaneContribution,
  BluePaneEntry,
  BluePaneRegistration,
  BluePaneRegistry,
  BlueRefreshRegistration,
  BlueStatusEntry,
  BlueStatusRegistry,
  BlueStatusSource,
} from './contracts.ts'

const ID = /^[a-z0-9][a-z0-9._/-]*$/u

function assertId(id: string, kind: string): void {
  if (!ID.test(id)) throw new TypeError(`${kind} id "${id}" is invalid`)
}

class RefreshHandle implements BlueRefreshRegistration {
  private live = true
  constructor(private readonly cleanup: () => void, private readonly onRefresh: () => void) {}
  get disposed(): boolean { return !this.live }
  refresh(): void { if (this.live) this.onRefresh() }
  dispose(): void {
    if (!this.live) return
    this.live = false
    this.cleanup()
  }
}

class OverlayHandle extends RefreshHandle implements BlueOverlayHandle {
  get closed(): boolean { return this.disposed }
  close(): void { this.dispose() }
}

abstract class ObservableRegistry<T> extends Service {
  protected readonly listeners = new Set<(entries: readonly T[]) => void>()
  abstract list(): readonly T[]
  subscribe(listener: (entries: readonly T[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.list())
    return this.ctx.effect(() => () => { this.listeners.delete(listener) })
  }
  protected emit(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}

export class BluePaneService extends ObservableRegistry<BluePaneEntry> implements BluePaneRegistry {
  private readonly entries = new Map<string, BluePaneEntry>()
  constructor(ctx: Context) { super(ctx, 'bluePanes') }
  register(contribution: BluePaneContribution): BluePaneRegistration {
    assertId(contribution.id, 'pane')
    if (typeof contribution.render !== 'function') throw new TypeError(`pane "${contribution.id}" needs a render function`)
    if (this.entries.has(contribution.id)) throw new Error(`pane "${contribution.id}" is already registered`)
    let revision = 0
    let hidden = false
    const frozen = Object.freeze({ ...contribution })
    const publish = (): void => {
      this.entries.set(contribution.id, Object.freeze({ id: contribution.id, contribution: frozen, hidden, revision }))
      this.emit()
    }
    publish()
    const cleanup = this.ctx.effect(() => () => {
      /* v8 ignore else -- Cordis runs and unregisters each effect disposer once. */
      if (this.entries.delete(contribution.id)) this.emit()
    })
    const base = new RefreshHandle(cleanup, () => { revision += 1; publish() })
    return Object.assign(base, {
      setHidden: (value: boolean): void => {
        if (base.disposed || hidden === value) return
        hidden = value
        revision += 1
        publish()
      },
    })
  }
  list(): readonly BluePaneEntry[] { return Object.freeze([...this.entries.values()]) }
}

export class BlueOverlayService extends ObservableRegistry<BlueOverlayEntry> implements BlueOverlayRegistry {
  private readonly entries = new Map<string, BlueOverlayEntry>()
  private readonly handles = new Map<string, RefreshHandle>()
  private nextOrder = 0
  constructor(ctx: Context) { super(ctx, 'blueOverlays') }
  open(request: BlueOverlayRequest): BlueOverlayHandle {
    assertId(request.id, 'overlay')
    if (typeof request.render !== 'function') throw new TypeError(`overlay "${request.id}" needs a render function`)
    if (this.entries.has(request.id)) throw new Error(`overlay "${request.id}" is already open`)
    let revision = 0
    const order = this.nextOrder++
    const frozen = Object.freeze({ ...request })
    const publish = (): void => {
      this.entries.set(request.id, Object.freeze({ id: request.id, request: frozen, revision, order }))
      this.emit()
    }
    publish()
    const cleanup = this.ctx.effect(() => () => {
      this.handles.delete(request.id)
      /* v8 ignore else -- Cordis runs and unregisters each effect disposer once. */
      if (this.entries.delete(request.id)) this.emit()
    })
    const handle = new OverlayHandle(cleanup, () => { revision += 1; publish() })
    this.handles.set(request.id, handle)
    return handle
  }
  close(id: string): boolean {
    const handle = this.handles.get(id)
    if (handle === undefined) return false
    handle.dispose()
    return true
  }
  list(): readonly BlueOverlayEntry[] { return Object.freeze([...this.entries.values()].sort((left, right) => left.order - right.order)) }
}

interface StatusRecord { readonly source: BlueStatusSource, readonly fallback: BlueStatusEntry }
function statusValue(source: BlueStatusSource): BlueStatusEntry | null { return typeof source === 'function' ? source() : source }

export class BlueStatusService extends Service implements BlueStatusRegistry {
  private readonly entries = new Map<string, StatusRecord>()
  private readonly listeners = new Set<() => void>()
  constructor(ctx: Context) { super(ctx, 'blueStatus') }
  register(source: BlueStatusSource): BlueRefreshRegistration {
    const initial = statusValue(source)
    if (initial === null) throw new TypeError('a status source must return an initial entry')
    assertId(initial.id, 'status')
    if (this.entries.has(initial.id)) throw new Error(`status "${initial.id}" is already registered`)
    this.entries.set(initial.id, { source, fallback: initial })
    this.emit()
    const cleanup = this.ctx.effect(() => () => {
      /* v8 ignore else -- Cordis runs and unregisters each effect disposer once. */
      if (this.entries.delete(initial.id)) this.emit()
    })
    return new RefreshHandle(cleanup, () => this.refresh(initial.id))
  }
  refresh(id: string): void { if (this.entries.has(id)) this.emit() }
  list(): readonly BlueStatusEntry[] {
    return Object.freeze([...this.entries.values()].flatMap(record => {
      try {
        const value = statusValue(record.source)
        return value === null ? [] : [value]
      } catch {
        return [{ ...record.fallback, visible: true, node: { kind: 'text' as const, content: `Status ${record.fallback.id} failed`, tone: 'danger' as const } }]
      }
    }).sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id)))
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    listener()
    return this.ctx.effect(() => () => { this.listeners.delete(listener) })
  }
  private emit(): void { for (const listener of this.listeners) listener() }
}

export class BlueEditorExtensionService extends Service implements BlueEditorExtensionRegistry {
  private readonly entries = new Map<string, BlueEditorExtensionContribution>()
  private readonly listeners = new Set<(entries: readonly BlueEditorExtensionContribution[], revision: number) => void>()
  private revision = 0
  constructor(ctx: Context) { super(ctx, 'blueEditorExtensions') }
  register(contribution: BlueEditorExtensionContribution): BlueRefreshRegistration {
    assertId(contribution.id, 'editor extension')
    if (this.entries.has(contribution.id)) throw new Error(`editor extension "${contribution.id}" is already registered`)
    this.entries.set(contribution.id, Object.freeze({ ...contribution }))
    this.emit()
    const cleanup = this.ctx.effect(() => () => {
      /* v8 ignore else -- Cordis runs and unregisters each effect disposer once. */
      if (this.entries.delete(contribution.id)) this.emit()
    })
    return new RefreshHandle(cleanup, () => this.emit())
  }
  list(): readonly BlueEditorExtensionContribution[] {
    return Object.freeze([...this.entries.values()].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id)))
  }
  subscribe(listener: (entries: readonly BlueEditorExtensionContribution[], revision: number) => void): () => void {
    this.listeners.add(listener)
    listener(this.list(), this.revision)
    return this.ctx.effect(() => () => { this.listeners.delete(listener) })
  }
  private emit(): void {
    this.revision += 1
    const entries = this.list()
    for (const listener of this.listeners) listener(entries, this.revision)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    bluePanes: BluePaneService
    blueOverlays: BlueOverlayService
    blueStatus: BlueStatusService
    blueEditorExtensions: BlueEditorExtensionService
  }
}
