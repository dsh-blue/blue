/**
 * Canonical consumer for interaction-owned panel documents. The controller
 * owns filtering, grouping, variants, and action mapping; core alone compiles
 * the resulting public Blue UI node.
 *
 * @module @dsh-blue/blue-interaction/frontend-panel
 */

import type { BlueInlineSpan, BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { Action } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_SEGMENT_LEFT, ACTION_SEGMENT_RIGHT, ACTION_SESSION_ONLY, ACTION_SUBMIT } from './keys.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const PAGE_SCROLL = 10
const DEFAULT_MAX_VISIBLE = 20

/** One action-bearing variant of a canonical panel row. */
export interface FrontendPanelVariant { readonly id: string, readonly label: string, readonly disabled?: boolean, readonly action?: Action, readonly secondaryAction?: Action }
/** One empty state selected by the active document group. */
export interface FrontendPanelEmptyState { readonly title: string, readonly description?: string }
/** One action-bearing canonical panel row. */
export interface FrontendPanelItem {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly badge?: string
  readonly disabled?: boolean
  readonly action?: Action
  readonly secondaryAction?: Action
  readonly group?: string
  readonly variants?: readonly FrontendPanelVariant[]
  readonly variantsFirst?: boolean
  readonly selectedVariantId?: string
}
/** Renderer-neutral interaction document compiled to one canonical node. */
export interface FrontendPanelDocument {
  readonly mode: 'select' | 'info' | 'loading' | 'error'
  readonly title: string
  readonly header?: BlueUiNode
  readonly view?: BlueUiNode
  readonly items?: readonly FrontendPanelItem[]
  readonly selectedId?: string
  readonly filterable?: boolean
  readonly grouped?: boolean
  readonly includeAllGroup?: boolean
  readonly groups?: readonly string[]
  readonly groupLabels?: Readonly<Record<string, string>>
  readonly groupCounts?: Readonly<Record<string, number>>
  readonly empty?: FrontendPanelEmptyState
  readonly emptyByGroup?: Readonly<Record<string, FrontendPanelEmptyState>>
  readonly submit?: Action
  readonly cancel?: Action
  readonly dismissible?: boolean
}

/** Construction options for the canonical generic panel controller. */
export interface FrontendPanelOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly model: () => FrontendPanelDocument
  readonly onAction: (action: Action) => void | Promise<void>
  readonly onClose: () => void
  readonly onUnhandledInput?: (data: string, selectedId: string | undefined) => Action | undefined
  readonly maxVisible?: number
  readonly hint?: string
  readonly showSelectedVariantInFooter?: boolean
}

/** Canonical panel controller preserving the former panel interaction set. */
export class CanonicalDocumentController implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private scrollTop = 0
  private selectedId: string | undefined
  private query = ''
  private group = 0
  private groupId: string | undefined
  private readonly selectedVariants = new Map<string, string>()

  constructor(private readonly options: FrontendPanelOptions) {
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onUnhandledEscape: () => this.cancel(),
      maxLeafRows: Math.max(5, options.maxVisible ?? DEFAULT_MAX_VISIBLE),
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  handleInput(data: string): void {
    const model = this.options.model()
    if (this.options.keymap.matches(data, ACTION_CANCEL) || (!model.filterable && (data === 'q' || data === 'Q'))) { this.cancel(); return }
    const unhandled = this.options.onUnhandledInput?.(data, this.resolveSelectedId(model))
    if (unhandled !== undefined) { void this.options.onAction(unhandled); return }
    if (this.options.keymap.matches(data, ACTION_SUBMIT)) { this.activate(model, false); return }
    if (this.options.keymap.matches(data, ACTION_SESSION_ONLY)) { this.activate(model, true); return }
    if (this.options.keymap.matches(data, ACTION_SEGMENT_LEFT) || this.options.keymap.matches(data, ACTION_SEGMENT_RIGHT)) {
      const delta = this.options.keymap.matches(data, ACTION_SEGMENT_LEFT) ? -1 : 1
      const item = this.selectedItem(model)
      if (model.grouped === true && this.groups(model).length > 1 && (item?.variants?.length ?? 0) === 0) this.moveGroup(model, delta)
      else this.moveVariant(model, delta)
      this.adapter.invalidate()
      return
    }
    if (data === KEY_UP || data === KEY_DOWN) {
      const moved = this.moveSelection(model, data === KEY_UP ? -1 : 1)
      if (!moved) this.scrollTop = Math.max(0, this.scrollTop + (data === KEY_UP ? -1 : 1))
      this.adapter.invalidate()
      return
    }
    if (data === KEY_PAGE_UP || data === KEY_PAGE_DOWN) { this.scrollTop = Math.max(0, this.scrollTop + (data === KEY_PAGE_UP ? -PAGE_SCROLL : PAGE_SCROLL)); this.adapter.invalidate(); return }
    if (data === 'g' || data === 'G') { this.scrollTop = data === 'g' ? 0 : Number.MAX_SAFE_INTEGER; this.adapter.invalidate(); return }
    if (model.grouped === true && (data === '\t' || data === '\x1b[Z')) { this.moveGroup(model, data === '\x1b[Z' ? -1 : 1); this.adapter.invalidate(); return }
    if (model.filterable === true && data === '\x7f') { this.query = this.query.slice(0, -1); this.reseedSelection(model); this.adapter.invalidate(); return }
    if (model.filterable === true && data.length === 1 && data >= ' ') { this.query += data; this.reseedSelection(model); this.adapter.invalidate() }
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  /** Current canonical surface for this interaction document. */
  currentNode(): BlueUiNode {
    const model = this.options.model()
    const children: BlueUiNode[] = []
    if (model.header !== undefined) children.push(model.header)
    if (model.mode === 'loading') {
      children.push({ kind: 'loader', message: nodeText(model.view) ?? 'loading...' })
      if (model.view !== undefined && nodeText(model.view) === undefined) children.push(model.view)
    }
    else if (model.items !== undefined) {
      const groups = this.groups(model)
      const activeGroup = this.activeGroup(groups)
      if (model.grouped === true && groups.length > 1) children.push({
        kind: 'tabs', id: 'frontend-panel-groups', activeId: activeGroup,
        items: groups.map(group => ({
          id: group,
          label: model.groupLabels?.[group] ?? group,
          ...(model.groupCounts?.[group] === undefined ? {} : { count: model.groupCounts[group] }),
        })),
      })
      const items = this.filteredItems(model)
      const maxVisible = Math.max(5, this.options.maxVisible ?? DEFAULT_MAX_VISIBLE)
      const selected = this.resolveSelectedId(model)
      const selectedIndex = Math.max(0, items.findIndex(item => item.id === selected))
      const maxTop = Math.max(0, items.length - maxVisible)
      this.scrollTop = Math.min(this.scrollTop, maxTop)
      if (selectedIndex < this.scrollTop) this.scrollTop = selectedIndex
      if (selectedIndex >= this.scrollTop + maxVisible) this.scrollTop = selectedIndex - maxVisible + 1
      children.push({
        kind: 'list', id: 'frontend-panel-list', selectedIds: selected === undefined ? [] : [selected],
        ...(this.query === '' ? {} : { filter: this.query }),
        items: items.slice(this.scrollTop, this.scrollTop + maxVisible).map(item => ({
          id: item.id, label: item.label,
          ...(item.variants === undefined ? (item.detail === undefined ? {} : { detail: item.detail }) : { detailSpans: this.itemDetailSpans(item, item.variants) }),
          ...(item.badge === undefined ? {} : { badge: item.badge }),
          ...(item.group === undefined ? {} : { group: item.group }),
          ...(item.disabled === true ? { disabled: true } : {}),
        })),
        ...(items.length === 0 ? { empty: this.emptyNode(model, activeGroup) } : {}),
      })
    } else if (model.view !== undefined) children.push(model.view)
    else children.push({ kind: 'empty', title: model.mode === 'error' ? 'unavailable' : 'no content' })
    const hasAction = model.mode === 'select'
      ? this.selectedAction(model, false) !== undefined || model.submit !== undefined
      : model.submit !== undefined
    const selectedVariant = model.mode === 'select' && this.options.showSelectedVariantInFooter === true
      ? this.selectedVariant(this.selectedItem(model))
      : undefined
    const closeHint = model.filterable === true ? 'Esc close' : 'Esc / q close'
    const defaultHint = model.dismissible === false ? 'updating - do not close' : model.mode === 'loading' ? 'Esc / q to cancel' : hasAction ? `Enter choose · ${closeHint}` : closeHint
    const variantHint = selectedVariant === undefined ? undefined : `${selectedVariant.label} selected`
    return {
      kind: 'surface', chrome: 'overlay', title: model.title,
      child: { kind: 'stack', direction: 'column', gap: 1, children: children.map(node => ({ node })) },
      footer: { kind: 'text', content: [variantHint, defaultHint, this.options.hint].filter(Boolean).join(' · '), tone: model.mode === 'error' ? 'danger' : 'muted' },
    }
  }

  private cancel(): void {
    const model = this.options.model()
    if (this.query !== '') { this.query = ''; this.reseedSelection(model); this.adapter.invalidate(); return }
    if (model.dismissible === false) return
    if (model.cancel !== undefined) void this.options.onAction(model.cancel)
    this.options.onClose()
  }

  private groups(model: FrontendPanelDocument): readonly string[] {
    const source = model.groups ?? [...new Set((model.items ?? []).flatMap(item => item.group === undefined ? [] : [item.group]))]
    if (model.includeAllGroup === false) return source.length > 0 ? source : ['All']
    return source.length > 1 ? ['All', ...source] : ['All']
  }

  private filteredItems(model: FrontendPanelDocument): readonly FrontendPanelItem[] {
    const groups = this.groups(model)
    const activeGroup = this.activeGroup(groups)
    return (model.items ?? []).filter(item => (activeGroup === 'All' || item.group === activeGroup)
      && (this.query === '' || this.options.components.fuzzyMatch(this.query, `${item.label} ${item.detail ?? ''}`).matches))
  }

  private emptyNode(model: FrontendPanelDocument, group: string): BlueUiNode {
    if (this.query !== '') return { kind: 'empty', title: 'no matches', description: `/ ${this.query}` }
    const empty = model.emptyByGroup?.[group] ?? model.empty ?? { title: 'no matches' }
    return {
      kind: 'empty',
      title: empty.title,
      ...(empty.description === undefined ? {} : { description: empty.description }),
    }
  }

  private selectable(model: FrontendPanelDocument): readonly FrontendPanelItem[] { return this.filteredItems(model).filter(item => item.disabled !== true) }

  private resolveSelectedId(model: FrontendPanelDocument): string | undefined {
    const items = this.selectable(model)
    if (items.length === 0) { this.selectedId = undefined; return undefined }
    if (this.selectedId !== undefined && items.some(item => item.id === this.selectedId)) return this.selectedId
    this.selectedId = model.selectedId !== undefined && items.some(item => item.id === model.selectedId) ? model.selectedId : items[0]!.id
    return this.selectedId
  }

  private reseedSelection(model: FrontendPanelDocument): void { this.selectedId = undefined; this.resolveSelectedId(model); this.scrollTop = 0 }

  private moveSelection(model: FrontendPanelDocument, delta: -1 | 1): boolean {
    const items = this.selectable(model)
    if (items.length === 0) return false
    const current = Math.max(0, items.findIndex(item => item.id === this.resolveSelectedId(model)))
    this.selectedId = items[(current + delta + items.length) % items.length]!.id
    return true
  }

  private selectedItem(model: FrontendPanelDocument): FrontendPanelItem | undefined {
    const selected = this.resolveSelectedId(model)
    return this.selectable(model).find(item => item.id === selected)
  }

  private selectedVariant(item: FrontendPanelItem | undefined): FrontendPanelVariant | undefined {
    const variants = item?.variants?.filter(variant => variant.disabled !== true)
    if (item === undefined || variants === undefined || variants.length === 0) return undefined
    const selected = this.selectedVariants.get(item.id) ?? item.selectedVariantId
    const variant = variants.find(entry => entry.id === selected) ?? variants[0]!
    this.selectedVariants.set(item.id, variant.id)
    return variant
  }

  private moveVariant(model: FrontendPanelDocument, delta: -1 | 1): void {
    const item = this.selectedItem(model)
    const variants = item?.variants?.filter(variant => variant.disabled !== true)
    if (item === undefined || variants === undefined || variants.length === 0) return
    const current = this.selectedVariant(item)
    const index = Math.max(0, variants.findIndex(variant => variant.id === current?.id))
    this.selectedVariants.set(item.id, variants[(index + delta + variants.length) % variants.length]!.id)
  }

  private moveGroup(model: FrontendPanelDocument, delta: -1 | 1): void {
    const groups = this.groups(model)
    if (groups.length <= 1) return
    const current = groups.indexOf(this.activeGroup(groups))
    this.group = (current + delta + groups.length) % groups.length
    this.groupId = groups[this.group]
    this.reseedSelection(model)
  }

  private activeGroup(groups: readonly string[]): string {
    if (this.groupId !== undefined) {
      const index = groups.indexOf(this.groupId)
      if (index >= 0) {
        this.group = index
        return this.groupId
      }
      this.group = 0
    } else if (this.group >= groups.length) this.group = 0
    const active = groups[this.group]!
    this.groupId = active
    return active
  }

  private itemDetailSpans(item: FrontendPanelItem, variants: readonly FrontendPanelVariant[]): readonly BlueInlineSpan[] {
    const selected = this.selectedVariant(item)
    if (item.variantsFirst === true) {
      const spans: BlueInlineSpan[] = variants.map((variant, index) => {
        const active = variant.id === selected?.id
        return {
          text: `${index === 0 ? '' : ' '}[${variant.label}]`,
          tone: active ? 'accent' : 'muted',
          ...(active ? { emphasis: 'strong' as const } : {}),
        }
      })
      if (item.detail !== undefined) spans.push({ text: ` · ${item.detail}` })
      return spans
    }
    const spans: BlueInlineSpan[] = item.detail ? [{ text: item.detail }] : []
    for (const variant of variants) {
      const active = variant.id === selected?.id
      spans.push({
        text: `${spans.length === 0 ? '' : ' '}[${variant.label}]`,
        tone: active ? 'accent' : 'muted',
        ...(active ? { emphasis: 'strong' as const } : {}),
      })
    }
    return spans
  }

  private selectedAction(model: FrontendPanelDocument, secondary: boolean): Action | undefined {
    const item = this.selectedItem(model)
    const variant = this.selectedVariant(item)
    return secondary ? variant?.secondaryAction ?? item?.secondaryAction : variant?.action ?? item?.action
  }

  private activate(model: FrontendPanelDocument, secondary: boolean): void {
    if (model.mode === 'loading') return
    const action = this.selectedAction(model, secondary) ?? (secondary ? undefined : model.submit)
    if (action === undefined) { if (!secondary) this.options.onClose(); return }
    this.onEvent({ kind: 'activate', controlId: secondary ? 'frontend-panel-secondary' : 'frontend-panel-primary' })
    void this.options.onAction(action)
  }

  private onEvent(event: BlueUiEvent): void {
    const model = this.options.model()
    if (event.kind === 'selection-change' && event.controlId === 'frontend-panel-list' && typeof event.value === 'string') {
      this.selectedId = event.value
      const action = this.selectedAction(model, false)
      if (action !== undefined) void this.options.onAction(action)
    } else if (event.kind === 'tab-change' && event.controlId === 'frontend-panel-groups') {
      const index = this.groups(model).indexOf(event.tabId)
      if (index >= 0) { this.group = index; this.groupId = event.tabId; this.reseedSelection(model); this.adapter.invalidate() }
    }
  }
}

function nodeText(node: BlueUiNode | undefined): string | undefined {
  return node?.kind === 'text' ? node.content : undefined
}
