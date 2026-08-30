/**
 * Canonical status-node registry and fixed-footer consumer.
 *
 * @module @dsh-blue/blue-transcript/status-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueSessionSnapshot, BlueStatusNode, BlueStatusProvider, BlueStatusSnapshot } from '@dsh-blue/blue-api'
import { compileBlueStatusNode, validateBlueStatusNode, type BlueComponent, type BlueComponents, type BlueScreen, type BlueSemanticColors, type BlueStatusComponent } from '@dsh-blue/blue-core'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueStatusEntries: BlueStatusEntryService
    blueStatusComposition: BlueStatusCompositionService
  }
}

/** Stable id selecting the built-in additive footer. */
export const BLUE_DEFAULT_STATUS_PROVIDER = 'blue.default'
/** Provider failures needed to open the runtime circuit breaker. */
export const STATUS_PROVIDER_FAILURE_LIMIT = 3
/** Rolling failure window; no timer is retained for expiry. */
export const STATUS_PROVIDER_FAILURE_WINDOW_MS = 60_000

/** Canonical status node plus fixed-footer layout metadata. */
export interface BlueStatusEntry {
  readonly id: string
  readonly node: BlueStatusNode
  readonly priority?: number
  readonly band?: 'left' | 'center' | 'right'
  readonly row?: 1 | 2
  readonly overflow?: 'truncate' | 'hide'
  readonly visible: boolean
}

/** Live source for one canonical status entry. */
export type BlueStatusEntrySource = BlueStatusEntry | (() => BlueStatusEntry | null)

interface StatusEntryRecord {
  readonly source: BlueStatusEntrySource
  readonly fallback: BlueStatusEntry
}

function sourceValue(source: BlueStatusEntrySource): BlueStatusEntry | null {
  return typeof source === 'function' ? source() : source
}

function failedEntry(entry: BlueStatusEntry): BlueStatusEntry {
  return {
    ...entry,
    visible: true,
    node: { kind: 'text', content: `Status ${entry.id} failed`, tone: 'danger' },
  }
}

function providerFailure(error: unknown): string {
  try {
    if (typeof error !== 'object' || error === null) return 'status provider render failed'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
    return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string'
      ? descriptor.value
      : 'status provider render failed'
  } catch { return 'status provider render failed' }
}

/** Canonical status-node registry with explicit footer invalidation. */
export class BlueStatusEntryService extends Service {
  private readonly entries = new Map<string, StatusEntryRecord>()
  private readonly listeners = new Set<() => void>()
  private footer: BlueComponent | undefined

  constructor(ctx: Context, private screen?: BlueScreen) {
    super(ctx, 'blueStatusEntries')
  }

  attachFooter(footer: BlueComponent): void { this.footer = footer }

  private redraw(): void {
    try { this.footer?.invalidate() } catch { /* renderer invalidation cannot escape the registry */ }
    try { this.screen?.requestRender() } catch { /* renderer repaint cannot escape the registry */ }
    for (const listener of this.listeners) try { listener() } catch { /* owner listeners cannot escape the registry */ }
  }

  /** Observe additive entry invalidation within this frontend tree. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  attach(screen: BlueScreen): void {
    this.screen = screen
    this.redraw()
  }

  register(source: BlueStatusEntrySource): () => void {
    const initial = sourceValue(source)
    if (initial === null) return () => undefined
    if (this.entries.has(initial.id)) throw new Error(`status node "${initial.id}" is already registered`)
    this.entries.set(initial.id, { source, fallback: initial })
    this.redraw()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.entries.delete(initial.id)
      this.redraw()
    }
  }

  refresh(id: string): void { if (this.entries.has(id)) this.redraw() }

  list(): readonly BlueStatusEntry[] {
    return [...this.entries.entries()]
      .flatMap(([, record]) => {
        try {
          const value = sourceValue(record.source)
          return value === null ? [] : [value]
        } catch {
          return [failedEntry(record.fallback)]
        }
      })
      .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id))
  }

  dispose(): void {
    this.entries.clear()
    this.redraw()
    this.listeners.clear()
    this.footer = undefined
    this.screen = undefined
  }
}

/** Readonly selection and failure state exposed for owner diagnostics/tests. */
export interface BlueStatusCompositionSnapshot {
  readonly desiredId: string
  readonly activeId: string
  readonly breakerOpen: boolean
  readonly runtimeFailure?: string
}

interface ActiveStatusProvider {
  readonly id: string
  readonly provider: BlueStatusProvider
  readonly component: BlueStatusComponent
  lastKnownGood: Readonly<{ width: number, rows: readonly string[] }>
}

/** Dependencies kept at the renderer-owned status composition boundary. */
export interface BlueStatusCompositionOptions {
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly viewport: () => { readonly columns: number, readonly rows: number }
  readonly requestRender: () => void
  readonly now?: () => number
}

function copySession(snapshot: BlueSessionSnapshot | null): BlueSessionSnapshot | null {
  if (snapshot === null) return null
  const model = snapshot.model === undefined ? undefined : Object.freeze({
    id: snapshot.model.id,
    ...(snapshot.model.provider === undefined ? {} : { provider: snapshot.model.provider }),
    ...(snapshot.model.effort === undefined ? {} : { effort: snapshot.model.effort }),
  })
  return Object.freeze({
    revision: snapshot.revision,
    id: snapshot.id,
    cwd: snapshot.cwd,
    status: snapshot.status,
    mode: snapshot.mode,
    ...(model === undefined ? {} : { model }),
  })
}

/**
 * Frontend-tree status composition. Candidate callbacks stay inert until the
 * persisted desired id selects them; a complete validated dry render commits
 * the replacement atomically.
 */
export class BlueStatusCompositionService extends Service implements BlueComponent {
  private desiredId = BLUE_DEFAULT_STATUS_PROVIDER
  private active: ActiveStatusProvider | undefined
  private candidates = new Map<string, BlueStatusProvider>()
  private providerRevision = -1
  private providerOwner: object | undefined
  private session: BlueSessionSnapshot | null = null
  private runtimeFailure: string | undefined
  private breakerId: string | undefined
  private failureId: string | undefined
  private readonly failureTimes: number[] = []
  private measuredWidth: number | undefined
  private epoch = 0
  private disposed = false
  private readonly unsubscribeEntries: () => void

  constructor(
    ctx: Context,
    private readonly entries: BlueStatusEntryService,
    private readonly defaultFooter: StatusFooterComponent,
    private readonly options: BlueStatusCompositionOptions,
  ) {
    super(ctx, 'blueStatusComposition')
    this.unsubscribeEntries = entries.subscribe(() => {
      const width = this.measuredWidth
      if (this.desiredId !== BLUE_DEFAULT_STATUS_PROVIDER && width !== undefined) this.attemptDesired(width)
    })
  }

  /** Current desired/active/breaker diagnostics, frozen for observers. */
  get snapshot(): BlueStatusCompositionSnapshot {
    return Object.freeze({
      desiredId: this.desiredId,
      activeId: this.active?.id ?? BLUE_DEFAULT_STATUS_PROVIDER,
      breakerOpen: this.breakerId === this.desiredId,
      ...(this.runtimeFailure === undefined ? {} : { runtimeFailure: this.runtimeFailure }),
    })
  }

  /** Update the persisted selection without rewriting it on fallback. */
  select(id: string): void {
    const desired = id.trim() === '' ? BLUE_DEFAULT_STATUS_PROVIDER : id
    if (desired === this.desiredId) return
    this.desiredId = desired
    this.breakerId = undefined
    this.failureId = undefined
    this.failureTimes.length = 0
    this.runtimeFailure = undefined
    this.epoch += 1
    if (desired === BLUE_DEFAULT_STATUS_PROVIDER) this.activateDefault()
    else if (this.measuredWidth !== undefined) this.attemptDesired(this.measuredWidth)
  }

  /** Claim the candidate slot for one frontend owner generation. */
  attachProviderOwner(owner: object): void {
    this.providerOwner = owner
    this.providerRevision = -1
  }

  /** Replace the candidate snapshot; installation/order never selects one. */
  updateCandidates(providers: readonly BlueStatusProvider[], revision: number, owner?: object): void {
    if (owner !== undefined && owner !== this.providerOwner) return
    if (revision === this.providerRevision) return
    const previous = this.candidates
    const next = new Map(providers.map(provider => [provider.id, provider]))
    this.candidates = next
    this.providerRevision = revision
    this.epoch += 1
    if (this.active !== undefined && !next.has(this.active.id)) this.activateDefault()
    if (this.desiredId === BLUE_DEFAULT_STATUS_PROVIDER) return
    const before = previous.get(this.desiredId)
    const desired = next.get(this.desiredId)
    const structureChanged = previous.size !== next.size || [...previous].some(([id, provider]) => next.get(id) !== provider)
    const generationChanged = desired !== undefined && desired !== before
    const shouldAttempt = generationChanged || !structureChanged
    if (generationChanged && this.breakerId === this.desiredId) {
      this.breakerId = undefined
      this.failureId = undefined
      this.failureTimes.length = 0
    }
    if (desired === undefined) {
      this.runtimeFailure = `status provider "${this.desiredId}" is unavailable`
      return
    }
    if (this.breakerId === this.desiredId) return
    if (this.measuredWidth !== undefined && shouldAttempt) this.attemptDesired(this.measuredWidth)
  }

  /** Drop one unloaded owner generation while preserving the persisted desired id. */
  detachProviders(owner?: object): void {
    if (owner !== undefined && owner !== this.providerOwner) return
    if (owner !== undefined) this.providerOwner = undefined
    this.candidates.clear()
    this.providerRevision = -1
    this.breakerId = undefined
    this.failureId = undefined
    this.epoch += 1
    this.activateDefault()
  }

  /** Refresh the readonly session part of the provider snapshot. */
  updateSession(snapshot: BlueSessionSnapshot | null): void {
    const switched = this.session?.id !== snapshot?.id
    this.session = snapshot
    this.epoch += 1
    if (switched) this.activateDefault(this.breakerId === undefined, false)
    if (this.desiredId !== BLUE_DEFAULT_STATUS_PROVIDER && this.breakerId !== this.desiredId && this.measuredWidth !== undefined) this.attemptDesired(this.measuredWidth)
  }

  private providerSnapshot(): BlueStatusSnapshot {
    const safeEntries = this.entries.list().filter(entry => entry.visible).map(entry => {
      const admitted = validateBlueStatusNode(entry.node)
      return Object.freeze({
        id: String(entry.id),
        node: admitted.ok
          ? admitted.value
          : Object.freeze({ kind: 'text', content: `Status ${String(entry.id)} rejected`, tone: 'danger' as const }),
      })
    })
    return Object.freeze({
      session: copySession(this.session),
      entries: Object.freeze(safeEntries),
      busy: this.session?.status === 'running',
    })
  }

  private candidate(provider: BlueStatusProvider, width: number): { readonly component: BlueStatusComponent, readonly rows: readonly string[], readonly width: number } | { readonly failure: string } {
    let node: BlueStatusNode
    try { node = provider.render(this.providerSnapshot()) }
    catch (error) { return { failure: providerFailure(error) } }
    const compiled = compileBlueStatusNode(node, {
      components: this.options.components,
      colors: this.options.colors,
      getViewport: this.options.viewport,
      screenMode: 'main',
      maxRows: 3,
    })
    if (!compiled.ok) return { failure: compiled.message }
    const dry = compiled.value.component.renderStatus(width)
    if (dry.runtimeFailure !== undefined) return { failure: dry.runtimeFailure }
    if (dry.overflowed) return { failure: 'status provider exceeds its 1-3 row viewport' }
    if (dry.rows.length === 0) return { failure: 'status provider must render at least one row' }
    return { component: compiled.value.component, rows: dry.rows, width }
  }

  private attemptDesired(width: number): void {
    if (this.disposed || this.breakerId === this.desiredId) return
    const provider = this.candidates.get(this.desiredId)
    if (provider === undefined) {
      this.runtimeFailure = `status provider "${this.desiredId}" is unavailable`
      return
    }
    const fence = ++this.epoch
    const candidate = this.candidate(provider, width)
    if (this.disposed || fence !== this.epoch || this.desiredId !== provider.id) return
    if ('failure' in candidate) {
      this.runtimeFailure = candidate.failure
      this.recordFailure(candidate.failure, provider.id)
      return
    }
    this.active = {
      id: provider.id,
      provider,
      component: candidate.component,
      lastKnownGood: Object.freeze({ width: candidate.width, rows: Object.freeze([...candidate.rows]) }),
    }
    this.runtimeFailure = undefined
    this.failureId = undefined
    this.failureTimes.length = 0
    this.invalidate()
  }

  private recordFailure(message: string, providerId: string): void {
    const now = this.options.now?.() ?? Date.now()
    if (this.failureId !== providerId) {
      this.failureId = providerId
      this.failureTimes.length = 0
    }
    while (this.failureTimes.length > 0 && this.failureTimes[0]! <= now - STATUS_PROVIDER_FAILURE_WINDOW_MS) this.failureTimes.shift()
    this.failureTimes.push(now)
    this.runtimeFailure = message
    if (this.failureTimes.length < STATUS_PROVIDER_FAILURE_LIMIT) return
    this.breakerId = providerId
    this.activateDefault(false)
  }

  private activateDefault(clearFailure = true, resetFailures = true): void {
    this.active = undefined
    if (clearFailure) this.runtimeFailure = undefined
    if (resetFailures) {
      this.failureId = undefined
      this.failureTimes.length = 0
    }
    this.invalidate()
  }

  private rememberRows(active: ActiveStatusProvider, width: number, rows: readonly string[]): void {
    active.lastKnownGood = Object.freeze({ width, rows: Object.freeze([...rows]) })
  }

  private fallbackRows(active: ActiveStatusProvider, width: number): string[] | undefined {
    const cached = active.lastKnownGood
    if (cached.width === width) return [...cached.rows]
    try { return cached.rows.map(row => this.options.components.truncateToWidth(row, width, '')) }
    catch { return undefined }
  }

  private defaultRows(width: number): string[] {
    try { return this.defaultFooter.render(width) }
    catch { return [] }
  }

  /** Render either the atomic provider component or the built-in footer. */
  render(width: number): string[] {
    const renderWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    this.measuredWidth = renderWidth
    if (this.active === undefined && this.desiredId !== BLUE_DEFAULT_STATUS_PROVIDER && this.breakerId !== this.desiredId) this.attemptDesired(renderWidth)
    const active = this.active
    if (active === undefined) return this.defaultRows(renderWidth)
    const rendered = active.component.renderStatus(renderWidth)
    const failure = rendered.runtimeFailure
      ?? (rendered.overflowed ? 'status provider exceeds its 1-3 row viewport' : rendered.rows.length === 0 ? 'status provider must render at least one row' : undefined)
    if (failure === undefined) {
      this.rememberRows(active, renderWidth, rendered.rows)
      return rendered.rows
    }
    const fallback = this.fallbackRows(active, renderWidth)
    this.recordFailure(failure, this.desiredId)
    return this.active === undefined ? this.defaultRows(renderWidth) : fallback ?? this.defaultRows(renderWidth)
  }

  invalidate(): void {
    try { this.defaultFooter.invalidate() } catch { /* renderer invalidation is contained */ }
    try { this.active?.component.invalidate() } catch { /* provider invalidation is contained */ }
    try { this.options.requestRender() } catch { /* repaint failure is contained */ }
  }

  /** Fence late/reentrant work and release all tree-owned state. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.epoch += 1
    this.unsubscribeEntries()
    this.candidates.clear()
    this.active = undefined
    this.failureId = undefined
    this.failureTimes.length = 0
  }
}

/** Renderer-owned fixed footer over canonical status nodes. */
export class StatusFooterComponent implements BlueComponent {
  private cache: { key: string, lines: string[] } | null = null

  constructor(
    private readonly models: BlueStatusEntryService,
    private readonly components: BlueComponents,
    private readonly colors: BlueSemanticColors,
    private readonly viewport: () => { readonly columns: number, readonly rows: number } = () => ({ columns: 1, rows: 1 }),
  ) {
    models.attachFooter(this)
  }

  invalidate(): void { this.cache = null }

  render(width: number): string[] {
    const visible = this.models.list().filter(model => model.visible)
    const bands: { left: BlueStatusEntry[], right: BlueStatusEntry[] }[] = [{ left: [], right: [] }, { left: [], right: [] }]
    for (const model of visible) {
      const band = Math.min(2, Math.max(1, model.row ?? 1)) - 1
      bands[band]![model.band === 'right' ? 'right' : 'left'].push(model)
    }
    const lines: string[] = []
    const keys: string[] = []
    for (const band of bands) {
      const leftText = this.renderCluster(band.left, width)
      const leftWidth = this.components.visibleWidth(leftText)
      const rightBudget = band.right.length === 0 ? 0 : Math.max(0, width - leftWidth - (leftText === '' ? 0 : 2))
      const rightText = rightBudget > 0 ? this.renderCluster(band.right, rightBudget) : ''
      if (leftText === '' && rightText === '') continue
      const rightWidth = this.components.visibleWidth(rightText)
      const line = leftText === ''
        ? ' '.repeat(Math.max(0, width - rightWidth)) + rightText
        : rightText === ''
          ? leftText + ' '.repeat(Math.max(0, width - leftWidth))
          : leftText + ' '.repeat(Math.max(0, width - leftWidth - rightWidth)) + rightText
      lines.push(line)
      keys.push(`${leftText}\x00${rightText}`)
    }
    const key = `${width}:${keys.join('\x01')}`
    if (this.cache?.key === key) return this.cache.lines
    this.cache = { key, lines }
    return lines
  }

  private renderCluster(entries: readonly BlueStatusEntry[], width: number): string {
    if (width <= 0) return ''
    const parts: string[] = []
    let used = 0
    for (const entry of entries) {
      const remaining = width - used - (parts.length > 0 ? 2 : 0)
      if (remaining <= 0) break
      const result = compileBlueStatusNode(entry.node, {
        components: this.components,
        colors: this.colors,
        getViewport: this.viewport,
        screenMode: 'main',
        maxRows: 1,
      })
      const component = result.ok ? result.value.component : result.errorComponent
      // Footer text is a single-line slot, not a wrapped document. Compile at
      // its natural bound so core still owns validation, sanitization, paint,
      // and width truth, then apply the slot's truncate/hide policy below.
      const renderWidth = result.ok && result.value.node.kind === 'text'
        ? Math.max(remaining, result.value.node.content.length * 2 + 1)
        : remaining
      const rendered = component.renderStatus(renderWidth)
      const fullPart = (rendered.rows[0] ?? '').replace(/ +$/, '')
      const fullWidth = this.components.visibleWidth(fullPart)
      if (entry.overflow === 'hide' && (rendered.overflowed || fullWidth > remaining)) continue
      const part = this.components.truncateToWidth(fullPart, remaining).replace(/ +$/, '')
      if (part === '') continue
      const partWidth = this.components.visibleWidth(part)
      parts.push(part)
      used += (parts.length > 1 ? 2 : 0) + partWidth
    }
    return parts.join('  ')
  }
}
