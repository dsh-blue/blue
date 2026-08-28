/**
 * Canonical status-node registry and fixed-footer consumer.
 *
 * @module @dsh-blue/blue-transcript/status-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueStatusNode } from '@dsh-blue/blue-api'
import { compileBlueStatusNode, type BlueComponent, type BlueComponents, type BlueScreen, type BlueSemanticColors } from '@dsh-blue/blue-core'

declare module '@deepseek-ai/cordis' {
  interface Context { blueStatusEntries: BlueStatusEntryService }
}

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

/** Canonical status-node registry with explicit footer invalidation. */
export class BlueStatusEntryService extends Service {
  private readonly entries = new Map<string, StatusEntryRecord>()
  private footer: BlueComponent | undefined

  constructor(ctx: Context, private screen?: BlueScreen) {
    super(ctx, 'blueStatusEntries')
  }

  attachFooter(footer: BlueComponent): void { this.footer = footer }

  private redraw(): void {
    this.footer?.invalidate()
    this.screen?.requestRender()
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
    this.footer = undefined
    this.screen = undefined
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
