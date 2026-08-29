/**
 * Transcript-owned canonical bottom-pane registry.
 *
 * This is an internal composition service, not a plugin pane API. Public
 * panes continue through `BluePaneContribution` and core's surface bridge.
 *
 * @module @dsh-blue/blue-transcript/dock-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import { compileBlueUiNode, GutterComponent, mountDockChild, type BlueComponent, type BlueComponents, type BlueScreen, type BlueSemanticColors } from '@dsh-blue/blue-core'

declare module '@deepseek-ai/cordis' {
  interface Context { blueBottomPanes: BlueBottomPaneService }
}

/** Internal canonical payload for one Blue-owned bottom pane. */
export interface BlueBottomPaneNode {
  readonly id: string
  readonly node: BlueUiNode
  readonly priority?: number
  readonly preferredRows?: number
  readonly collapsed?: boolean
}

export type BlueBottomPaneSource = BlueBottomPaneNode | (() => BlueBottomPaneNode | null)

interface BottomPaneCompilerOptions {
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly viewport: () => { readonly columns: number, readonly rows: number }
}

/** Internal exception for accepted semantics absent from the W1 vocabulary. */
export type BlueBottomPaneAdapter = (node: BlueBottomPaneNode, width: number) => string[]

interface PaneRecord {
  readonly id: string
  readonly source: () => BlueBottomPaneNode | null
  readonly component: BlueComponent
  readonly fallback: BlueBottomPaneNode
  readonly deactivate: () => void
}

const PASSIVE_EVENT_SINK = Function.prototype as (event: BlueUiEvent) => void

function sourceValue(source: BlueBottomPaneSource): BlueBottomPaneNode | null {
  return typeof source === 'function' ? source() : source
}

function failedNode(model: Pick<BlueBottomPaneNode, 'id' | 'priority' | 'preferredRows'>): BlueBottomPaneNode {
  return { ...model, node: { kind: 'text', content: `Bottom pane ${model.id} failed`, tone: 'danger' } }
}

/** Width-bounded canonical compiler consumer for one bottom pane. */
class BottomPaneComponent implements BlueComponent {
  private compiled: { readonly node: BlueUiNode, readonly component: BlueComponent } | undefined

  constructor(
    private readonly source: () => BlueBottomPaneNode | null,
    private readonly options: BottomPaneCompilerOptions,
    private readonly fallback: BlueBottomPaneNode,
    private readonly adapter?: BlueBottomPaneAdapter,
  ) {}

  render(width: number): string[] {
    let model: BlueBottomPaneNode | null
    try {
      model = this.source()
    } catch {
      model = failedNode(this.fallback)
    }
    if (model === null || model.collapsed) return []
    if (this.adapter !== undefined) {
      try {
        const rows = this.adapter(model, width)
          .map(row => this.options.components.truncateToWidth(row, width))
        return this.limitRows(rows, model.preferredRows)
      } catch {
        model = failedNode(model)
      }
    }
    let compiled = this.compiled
    if (compiled?.node !== model.node) {
      const result = compileBlueUiNode(model.node, {
        components: this.options.components,
        colors: this.options.colors,
        getViewport: this.options.viewport,
        screenMode: 'main',
        emit: PASSIVE_EVENT_SINK,
      })
      compiled = { node: model.node, component: result.ok ? result.value.component : result.errorComponent }
      this.compiled = compiled
    }
    return this.limitRows(compiled.component.render(width), model.preferredRows)
  }

  invalidate(): void {
    this.compiled?.component.invalidate()
    this.compiled = undefined
  }

  private limitRows(rows: string[], preferredRows: number | undefined): string[] {
    return preferredRows === undefined ? rows : rows.slice(0, Math.max(0, preferredRows))
  }
}

/** Internal registry for Blue-owned bottom panes only. */
export class BlueBottomPaneService extends Service {
  private readonly records = new Map<string, PaneRecord>()
  private readonly mounted = new Map<string, () => void>()
  private signature = ''
  private screen: BlueScreen | undefined

  constructor(ctx: Context, private readonly compiler: BottomPaneCompilerOptions, screen?: BlueScreen) {
    super(ctx, 'blueBottomPanes')
    if (screen !== undefined) this.attach(screen)
  }

  attach(screen: BlueScreen): void {
    this.unmountAll()
    this.screen = screen
    this.syncMounts()
    screen.requestRender()
  }

  register(source: BlueBottomPaneSource, adapter?: BlueBottomPaneAdapter): () => void {
    const initial = sourceValue(source)
    if (initial === null) return () => undefined
    if (this.records.has(initial.id)) throw new Error(`bottom pane "${initial.id}" is already registered`)
    let active = true
    const resolve = (): BlueBottomPaneNode | null => active ? sourceValue(source) : null
    const component = new BottomPaneComponent(resolve, this.compiler, initial, adapter)
    const record: PaneRecord = {
      id: initial.id,
      source: resolve,
      component: new GutterComponent(component),
      fallback: initial,
      deactivate: () => { active = false },
    }
    this.records.set(initial.id, record)
    this.syncMounts()
    this.screen?.requestRender()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      record.deactivate()
      this.records.delete(initial.id)
      this.syncMounts()
      this.screen?.requestRender()
    }
  }

  refresh(id: string, force?: boolean): void {
    const record = this.records.get(id)
    if (record === undefined) return
    this.syncMounts()
    record.component.invalidate()
    this.screen?.requestRender(force)
  }

  list(): readonly BlueBottomPaneNode[] {
    return [...this.records.values()].flatMap(record => {
      try {
        const value = record.source()
        return value === null ? [] : [value]
      } catch {
        return [failedNode(record.fallback)]
      }
    })
  }

  dispose(): void {
    for (const record of this.records.values()) record.deactivate()
    this.unmountAll()
    this.records.clear()
    this.screen = undefined
  }

  private unmountAll(): void {
    for (const dispose of this.mounted.values()) dispose()
    this.mounted.clear()
    this.signature = ''
  }

  private syncMounts(): void {
    const screen = this.screen
    if (screen === undefined) return
    const rows = this.orderedRows()
    const signature = JSON.stringify(rows.map(row => [row.id, row.model.priority ?? 0]))
    if (signature === this.signature) return
    for (const dispose of this.mounted.values()) dispose()
    this.mounted.clear()
    for (const row of rows) {
      this.mounted.set(row.id, mountDockChild(screen, row.component, { priority: row.model.priority ?? 0 }))
    }
    this.signature = signature
  }

  private orderedRows(): readonly (PaneRecord & { readonly model: BlueBottomPaneNode })[] {
    return [...this.records.values()].map(record => {
      try {
        return { ...record, model: record.source() }
      } catch {
        return { ...record, model: failedNode(record.fallback) }
      }
    })
      .filter((row): row is PaneRecord & { model: BlueBottomPaneNode } => row.model !== null)
      .sort((left, right) => (left.model.priority ?? 0) - (right.model.priority ?? 0) || left.id.localeCompare(right.id))
  }
}
