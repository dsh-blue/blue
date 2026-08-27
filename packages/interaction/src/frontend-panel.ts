/**
 * TUI consumer for a renderer-neutral frontend PanelModel. Domain plugins
 * publish readonly views and structured actions; this adapter owns terminal
 * framing, scrolling, key routing, and width enforcement.
 *
 * @module @dsh-blue/blue-interaction/frontend-panel
 */

import { renderFrontendView, type BlueComponents, type BlueFocusable, type BlueKeymap, type BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import type { Action, ListView, ListViewItem, PanelModel } from '@dsh-blue/blue-frontend'
import {
  ACTION_CANCEL,
  ACTION_SEGMENT_LEFT,
  ACTION_SEGMENT_RIGHT,
  ACTION_SESSION_ONLY,
  ACTION_SUBMIT,
} from './keys.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const PAGE_SCROLL = 10
const DEFAULT_MAX_VISIBLE = 20

/** Construction options for the generic frontend panel consumer. */
export interface FrontendPanelOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly model: () => PanelModel
  readonly onAction: (action: Action) => void | Promise<void>
  readonly onClose: () => void
  readonly onUnhandledInput?: (data: string, selectedId: string | undefined) => Action | undefined
  readonly maxVisible?: number
  /** Optional extra affordances appended to the default footer hint. */
  readonly hint?: string
}

/** Framed, scrollable consumer for renderer-neutral info/loading/error panels. */
export class FrontendPanel implements BlueFocusable {
  focused = false
  private scrollTop = 0
  private selectedId: string | undefined
  private query = ''
  private group = 0
  private readonly selectedVariants = new Map<string, string>()

  constructor(private readonly options: FrontendPanelOptions) {}

  handleInput(data: string): void {
    const { keymap } = this.options
    const model = this.options.model()
    const view = this.selectView(model)
    const filterable = view?.filterable === true
    if (keymap.matches(data, ACTION_CANCEL) || (!filterable && (data === 'q' || data === 'Q'))) {
      if (this.query !== '') {
        this.query = ''
        this.reseedSelection(model)
        return
      }
      if (model.dismissible === false) return
      const action = model.cancel
      if (action !== undefined) void this.options.onAction(action)
      this.options.onClose()
      return
    }
    const unhandled = this.options.onUnhandledInput?.(data, this.resolveSelectedId(model))
    if (unhandled !== undefined) {
      void this.options.onAction(unhandled)
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      if (model.mode === 'loading') return
      const action = this.selectedAction(model) ?? model.submit
      if (action === undefined) this.options.onClose()
      else void this.options.onAction(action)
      return
    }
    if (keymap.matches(data, ACTION_SESSION_ONLY)) {
      const action = this.selectedSecondaryAction(model)
      if (action !== undefined) void this.options.onAction(action)
      return
    }
    if (keymap.matches(data, ACTION_SEGMENT_LEFT) || keymap.matches(data, ACTION_SEGMENT_RIGHT)) {
      const delta = keymap.matches(data, ACTION_SEGMENT_LEFT) ? -1 : 1
      const grouped = view?.grouped === true && this.groups(view).length > 1
      const item = this.selectedItem(model)
      if (grouped && (item?.variants === undefined || item.variants.length === 0)) this.moveGroup(model, delta)
      else this.moveVariant(model, delta)
      return
    }
    if (data === KEY_UP) {
      if (this.moveSelection(-1)) return
      this.scrollTop = Math.max(0, this.scrollTop - 1)
      return
    }
    if (data === KEY_DOWN) {
      if (this.moveSelection(1)) return
      this.scrollTop += 1
      return
    }
    if (data === KEY_PAGE_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - PAGE_SCROLL)
      return
    }
    if (data === KEY_PAGE_DOWN) {
      this.scrollTop += PAGE_SCROLL
      return
    }
    if (data === 'g') {
      this.scrollTop = 0
      return
    }
    if (data === 'G') {
      this.scrollTop = Number.MAX_SAFE_INTEGER
      return
    }
    if (view?.grouped === true && (data === '\t' || data === '\x1b[Z')) {
      const delta = data === '\x1b[Z' ? -1 : 1
      this.group = (this.group + delta + this.groups(view).length) % this.groups(view).length
      this.reseedSelection(model)
      return
    }
    if (filterable && data === '\x7f') {
      this.query = this.query.slice(0, -1)
      this.reseedSelection(model)
      return
    }
    if (filterable && data.length === 1 && data >= ' ') {
      this.query += data
      this.reseedSelection(model)
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const { components, theme } = this.options
    const model = this.options.model()
    const budget = Math.max(1, Math.floor(width) - 4)
    const selected = model.mode === 'select' && model.view?.kind === 'list' ? this.resolveSelectedId(model) : undefined
    const view = model.mode === 'select' && model.view?.kind === 'list' && selected !== undefined
      ? { ...model.view, items: this.renderItems(model.view), selectedId: selected }
      : model.view
    const fallback = model.mode === 'loading' ? 'loading...' : model.mode === 'error' ? 'unavailable' : undefined
    const groupRows = model.mode === 'select' && model.view?.kind === 'list'
      ? this.renderFilterRows(model.view)
      : []
    const headerRows = model.header === undefined ? [] : [...renderFrontendView(model.header, budget, { colors: theme.colors })]
    const renderedView = view?.kind === 'list'
      ? this.renderListView(view, selected, budget)
      : view === undefined ? [] : [...renderFrontendView(view, budget, { colors: theme.colors })]
    const content = view === undefined
      ? fallback === undefined ? [] : [`  ${fallback}`]
      : [...headerRows, ...groupRows, ...renderedView].map(row => `  ${components.truncateToWidth(row, budget)}`)
    const maxVisible = Math.max(5, this.options.maxVisible ?? DEFAULT_MAX_VISIBLE)
    const body: string[] = []
    if (content.length > maxVisible) {
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, content.length - maxVisible))
      const slice = content.slice(this.scrollTop, this.scrollTop + maxVisible)
      body.push(...slice)
      body.push(theme.colors.textMuted(components.truncateToWidth(
        ` showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + slice.length)} of ${String(content.length)}`,
        Math.max(1, width),
      )))
    } else {
      this.scrollTop = 0
      body.push(...content)
    }
    const hasSelectAction = this.selectedAction(model) !== undefined
    const submit = model.dismissible === false
      ? 'updating - do not close'
      : model.mode === 'loading'
        ? 'Esc / q to cancel'
      : model.submit === undefined && !hasSelectAction ? 'Esc / q to close' : 'Enter to choose · Esc / q to close'
    const affordance = this.options.hint === undefined ? submit : `${submit} · ${this.options.hint}`
    return framePanel(body, width, {
      title: model.title,
      titlePaint: model.mode === 'error' ? theme.colors.error : theme.colors.primary,
      titleHint: `· ${affordance} · ↑↓ scroll`,
      hintPaint: theme.colors.textMuted,
      rulePaint: model.mode === 'error' ? theme.colors.error : theme.colors.primary,
    })
  }

  private selectable(model: PanelModel): readonly ListViewItem[] {
    const view = this.selectView(model)
    return view === undefined ? [] : this.filteredItems(view).filter(item => item.disabled !== true)
  }

  private resolveSelectedId(model: PanelModel): string | undefined {
    const view = this.selectView(model)
    const items = view === undefined ? [] : this.filteredItems(view).filter(item => item.disabled !== true)
    if (items.length === 0) { this.selectedId = undefined; return undefined }
    if (this.selectedId !== undefined && items.some(item => item.id === this.selectedId)) return this.selectedId
    const preferred = view!.selectedId
    this.selectedId = preferred !== undefined && items.some(item => item.id === preferred) ? preferred : items[0]!.id
    return this.selectedId
  }

  private selectView(model: PanelModel): ListView | undefined {
    return model.mode === 'select' && model.view?.kind === 'list' ? model.view : undefined
  }

  private groups(view: ListView): readonly string[] {
    const groups = view.groups === undefined
      ? [...new Set(view.items.flatMap(item => item.group === undefined ? [] : [item.group]))]
      : [...view.groups]
    if (view.includeAllGroup === false) return groups.length > 0 ? groups : ['All']
    return groups.length > 1 ? ['All', ...groups] : ['All']
  }

  private filteredItems(view: ListView): readonly ListViewItem[] {
    const groups = this.groups(view)
    if (this.group >= groups.length) this.group = 0
    const activeGroup = groups[this.group]
    return view.items.filter(item => {
      if (activeGroup !== 'All' && item.group !== activeGroup) return false
      if (this.query === '') return true
      return this.options.components.fuzzyMatch(this.query, `${item.label} ${item.detail ?? ''}`).matches
    })
  }

  private renderItems(view: ListView): readonly ListViewItem[] {
    return this.filteredItems(view).map(item => {
      const variant = this.selectedVariant(item)
      return variant === undefined
        ? item
        : {
            ...item,
            detail: [item.detail, item.variants!.map(entry => {
              const label = `[${entry.label}]`
              return entry.id === variant.id
                ? this.options.theme.colors.primary(label)
                : this.options.theme.colors.textMuted(label)
            }).join(' ')].filter(value => value !== undefined && value !== '').join(' '),
          }
    })
  }

  private renderListView(view: ListView, selectedId: string | undefined, width: number): readonly string[] {
    const colors = this.options.theme.colors
    return this.filteredItems(view).map(item => {
      const selected = item.id === selectedId
      // Keep the pointer plain so the selected label remains easy to scan;
      // this mirrors SelectListPanel's `❯ ` marker + primary label treatment.
      const marker = selected ? '> ' : '  '
      const label = selected ? colors.primary(item.label) : colors.text(item.label)
      const detail = item.detail === undefined ? '' : colors.muted(` - ${item.detail}`)
      return this.options.components.truncateToWidth(`${marker}${label}${detail}`, width)
    })
  }

  private renderFilterRows(view: ListView): string[] {
    const rows: string[] = []
    const groups = this.groups(view)
    if (view.grouped === true && groups.length > 1) rows.push(`groups: ${groups.map((group, index) => index === this.group ? `[${group}]` : group).join('  ')}`)
    if (view.filterable === true && this.query !== '') rows.push(`search: ${this.query}`)
    return rows
  }

  private reseedSelection(model: PanelModel): void {
    this.selectedId = undefined
    this.resolveSelectedId(model)
    this.scrollTop = 0
  }

  private moveSelection(delta: -1 | 1): boolean {
    const model = this.options.model()
    const items = this.selectable(model)
    if (items.length === 0) return false
    const selected = this.resolveSelectedId(model)
    const current = Math.max(0, items.findIndex(item => item.id === selected))
    this.selectedId = items[(current + delta + items.length) % items.length]!.id
    return true
  }

  private selectedAction(model: PanelModel): Action | undefined {
    const item = this.selectedItem(model)
    return this.selectedVariant(item)?.action ?? item?.action
  }

  private selectedSecondaryAction(model: PanelModel): Action | undefined {
    const item = this.selectedItem(model)
    return this.selectedVariant(item)?.secondaryAction ?? item?.secondaryAction
  }

  private selectedItem(model: PanelModel): ListViewItem | undefined {
    const selected = this.resolveSelectedId(model)
    return this.selectable(model).find(item => item.id === selected)
  }

  private selectedVariant(item: ListViewItem | undefined): NonNullable<ListViewItem['variants']>[number] | undefined {
    const variants = item?.variants
    if (item === undefined || variants === undefined || variants.length === 0) return undefined
    const selected = this.selectedVariants.get(item.id) ?? item.selectedVariantId
    const variant = variants.find(entry => entry.id === selected) ?? variants[0]
    this.selectedVariants.set(item.id, variant!.id)
    return variant
  }

  private moveVariant(model: PanelModel, delta: -1 | 1): boolean {
    const item = this.selectedItem(model)
    const variants = item?.variants
    if (item === undefined || variants === undefined || variants.length === 0) return false
    const current = this.selectedVariant(item)
    const index = Math.max(0, variants.findIndex(variant => variant.id === current?.id))
    this.selectedVariants.set(item.id, variants[(index + delta + variants.length) % variants.length]!.id)
    return true
  }

  private moveGroup(model: PanelModel, delta: -1 | 1): void {
    const view = this.selectView(model)
    /* c8 ignore next -- segment input is only routed for list views. */
    if (view === undefined) return
    const groups = this.groups(view)
    /* c8 ignore next -- grouped navigation requires at least two groups. */
    if (groups.length <= 1) return
    this.group = (this.group + delta + groups.length) % groups.length
    this.reseedSelection(model)
  }
}
