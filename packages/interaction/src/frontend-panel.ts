/**
 * Canonical consumer for interaction-owned panel documents. The controller
 * owns filtering, grouping, variants, and action mapping; core alone compiles
 * the resulting public Blue UI node.
 *
 * @module @dsh-blue/blue-interaction/frontend-panel
 */

import type { BlueInlineSpan, BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { Action, BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter, type CanonicalContextHint } from './canonical-panel.ts'
import { ACTION_CANCEL } from './keys.ts'

const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_LEFT = '\x1b[D'
const KEY_RIGHT = '\x1b[C'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'
const PAGE_SCROLL = 10
const DEFAULT_MAX_VISIBLE = 20

/** One action-bearing variant of a canonical panel row. */
export interface FrontendPanelVariant { readonly id: string, readonly label: string, readonly disabled?: boolean, readonly action?: Action, readonly actionLabel?: string, readonly secondaryAction?: Action, readonly secondaryActionLabel?: string }
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
  readonly actionLabel?: string
  readonly secondaryAction?: Action
  readonly secondaryActionLabel?: string
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
  readonly variantNavigation?: 'tabs' | 'inline'
  readonly emphasizePrimaryAction?: boolean
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
  readonly t?: BlueTranslate
  readonly contextHints?: () => readonly CanonicalContextHint[]
  readonly showSelectedVariantInFooter?: boolean
}

/** Canonical panel controller preserving the former panel interaction set. */
export class CanonicalDocumentController implements BlueFocusable {
  private readonly adapter: CanonicalPanelAdapter
  private scrollTop = 0
  private selectedId: string | undefined
  private query = ''
  private filterEditing = false
  private group = 0
  private groupId: string | undefined
  private focusedControlId: string | undefined
  private readonly selectedVariants = new Map<string, string>()

  constructor(private readonly options: FrontendPanelOptions) {
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onFocusChange: identity => this.onFocusChange(identity.controlId, identity.itemId),
      onUnhandledEscape: () => this.cancel(),
      maxLeafRows: Math.max(5, options.maxVisible ?? DEFAULT_MAX_VISIBLE),
      leafRowWindowPath: '$.child.0',
      leafRowOffset: () => this.scrollTop,
      onLeafRowOffset: offset => { this.scrollTop = offset },
      ...(options.t === undefined ? {} : { t: options.t }),
      focusWithoutControls: true,
      contextHints: () => this.contextHints(),
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  handleInput(data: string): void {
    const model = this.options.model()
    if (this.options.keymap.matches(data, ACTION_CANCEL) && this.filterEditing) {
      this.filterEditing = false
      this.adapter.invalidate()
      return
    }
    if (!model.filterable && (data === 'q' || data === 'Q')) { this.cancel(); return }
    const unhandled = this.options.onUnhandledInput?.(data, this.resolveSelectedId(model))
    if (unhandled !== undefined) { void this.options.onAction(unhandled); return }
    if (model.variantNavigation === 'inline' && (data === KEY_LEFT || data === KEY_RIGHT) && this.listIsActive(model)) {
      this.moveVariant(model, data === KEY_LEFT ? -1 : 1)
      return
    }
    if (model.items === undefined && (data === KEY_UP || data === KEY_DOWN || data === KEY_PAGE_UP || data === KEY_PAGE_DOWN || data === 'g' || data === 'G')) {
      const delta = data === KEY_UP ? -1 : data === KEY_DOWN ? 1 : data === KEY_PAGE_UP ? -PAGE_SCROLL : data === KEY_PAGE_DOWN ? PAGE_SCROLL : 0
      this.scrollTop = data === 'g' ? 0 : data === 'G' ? Number.MAX_SAFE_INTEGER : Math.max(0, this.scrollTop + delta)
      this.adapter.invalidate()
      return
    }
    if (model.filterable === true && data === '\x7f') { this.query = this.query.slice(0, -1); this.reseedSelection(model); this.adapter.invalidate(); return }
    if (model.filterable === true && data.length === 1 && data >= ' ') {
      this.filterEditing = true
      this.query += data
      this.reseedSelection(model)
      this.adapter.invalidate()
      return
    }
    this.adapter.handleInput(data)
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
      if (model.submit !== undefined) children.push({
        kind: 'actions', id: 'frontend-panel-actions',
        items: [{ id: 'frontend-panel-primary', label: 'Cancel', intent: 'primary' }],
      })
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
      const selected = this.resolveSelectedId(model)
      const selectedItem = this.selectedItem(model)
      const variants = selectedItem?.variants?.filter(variant => variant.disabled !== true) ?? []
      const selectedVariant = this.selectedVariant(selectedItem)
      if (model.variantNavigation !== 'inline' && variants.length > 1 && selectedVariant !== undefined) children.push({
        kind: 'tabs', id: 'frontend-panel-variants', activeId: selectedVariant.id,
        items: variants.map(variant => ({ id: variant.id, label: variant.label })),
      })
      children.push({
        kind: 'list', id: 'frontend-panel-list', selectedIds: selected === undefined ? [] : [selected],
        ...(this.query === '' ? {} : { filter: this.query }),
        items: items.map(item => ({
          id: item.id, label: item.label,
          ...(item.variants === undefined ? (item.detail === undefined ? {} : { detail: item.detail }) : { detailSpans: this.itemDetailSpans(item, item.variants) }),
          ...(item.badge === undefined ? {} : { badge: item.badge }),
          ...(item.group === undefined ? {} : { group: item.group }),
          ...(item.disabled === true ? { disabled: true } : {}),
        })),
        ...(items.length === 0 ? { empty: this.emptyNode(model, activeGroup) } : {}),
      })
      const primary = this.selectedAction(model, false) ?? model.submit
      const secondary = this.selectedAction(model, true)
      if (primary !== undefined || secondary !== undefined || this.query !== '') children.push({
        kind: 'actions', id: 'frontend-panel-actions', items: [
          ...(primary === undefined ? [] : [{
            id: 'frontend-panel-primary',
            label: selectedVariant?.actionLabel ?? selectedItem?.actionLabel ?? 'Choose',
            ...(model.emphasizePrimaryAction === false ? {} : { intent: 'primary' as const }),
          }]),
          ...(secondary === undefined ? [] : [{ id: 'frontend-panel-secondary', label: selectedVariant?.secondaryActionLabel ?? selectedItem?.secondaryActionLabel ?? 'Use for this session' }]),
          ...(this.query === '' ? [] : [{ id: 'frontend-panel-clear-filter', label: 'Clear filter' }]),
        ],
      })
    } else if (model.view !== undefined) {
      children.push(model.view)
      if (model.submit !== undefined) children.push({
        kind: 'actions', id: 'frontend-panel-actions',
        items: [{ id: 'frontend-panel-primary', label: 'Continue', intent: 'primary' }],
      })
    }
    else children.push({ kind: 'empty', title: model.mode === 'error' ? 'unavailable' : 'no content' })
    const selectedVariant = model.mode === 'select' && this.options.showSelectedVariantInFooter === true
      ? this.selectedVariant(this.selectedItem(model))
      : undefined
    const variantHint = selectedVariant === undefined ? undefined : `${selectedVariant.label} selected`
    const status = model.dismissible === false ? 'updating - do not close' : undefined
    const footer = [variantHint, status].filter(Boolean).join(' · ')
    return {
      kind: 'surface', chrome: 'overlay', title: model.title,
      child: { kind: 'stack', direction: 'column', gap: 1, children: children.map(node => ({ node })) },
      ...(footer === '' ? {} : { footer: { kind: 'text', content: footer, tone: model.mode === 'error' ? 'danger' as const : 'muted' as const } }),
    }
  }

  private contextHints(): readonly CanonicalContextHint[] {
    const model = this.options.model()
    if (model.dismissible === false) return this.options.contextHints?.() ?? []
    const hasRows = (model.items?.length ?? 0) > 0
    const activeItem = this.focusedListItem(model) ?? this.selectedItem(model)
    const inlineVariants = model.variantNavigation === 'inline'
      && this.listIsActive(model)
      && (activeItem?.variants?.filter(variant => variant.disabled !== true).length ?? 0) > 1
    return [
      ...(model.filterable === true && this.query === '' ? [{ id: 'filter', keys: 'Type', label: 'to search', priority: 85 }] : []),
      ...(inlineVariants ? [
        { id: 'navigate', keys: '↑↓', label: 'models', priority: 93 },
        { id: 'variant', keys: '←→', label: 'thinking', priority: 92 },
      ] : []),
      ...(!hasRows && model.view !== undefined ? [{ id: 'scroll', keys: '↑↓/PgUp/PgDn', label: 'scroll', compact: 'PgUp/PgDn', priority: 90 }] : []),
      ...(this.filterEditing ? [{ id: 'dismiss', keys: 'Esc', label: 'finish search', priority: 96 }] : []),
      ...(this.options.contextHints?.() ?? []),
    ]
  }

  private cancel(): void {
    const model = this.options.model()
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

  private selectedItem(model: FrontendPanelDocument): FrontendPanelItem | undefined {
    const selected = this.resolveSelectedId(model)
    return this.selectable(model).find(item => item.id === selected)
  }

  private focusedListItem(model: FrontendPanelDocument): FrontendPanelItem | undefined {
    const identity = this.adapter.currentFocusIdentity()
    if (identity?.controlId !== 'frontend-panel-list' || identity.itemId === undefined) return undefined
    return this.selectable(model).find(item => item.id === identity.itemId)
  }

  private selectedVariant(item: FrontendPanelItem | undefined): FrontendPanelVariant | undefined {
    const variants = item?.variants?.filter(variant => variant.disabled !== true)
    if (item === undefined || variants === undefined || variants.length === 0) return undefined
    const selected = this.selectedVariants.get(item.id) ?? item.selectedVariantId
    const variant = variants.find(entry => entry.id === selected) ?? variants[0]!
    this.selectedVariants.set(item.id, variant.id)
    return variant
  }

  private listIsActive(model: FrontendPanelDocument): boolean {
    const identity = this.adapter.currentFocusIdentity()
    if (identity !== undefined) return identity.controlId === 'frontend-panel-list'
    if (this.focusedControlId !== undefined) return this.focusedControlId === 'frontend-panel-list'
    return !(model.grouped === true && this.groups(model).length > 1)
  }

  private moveVariant(model: FrontendPanelDocument, delta: -1 | 1): void {
    const item = this.focusedListItem(model) ?? this.selectedItem(model)
    const variants = item?.variants?.filter(variant => variant.disabled !== true) ?? []
    if (item === undefined || variants.length < 2) return
    this.selectedId = item.id
    const selected = this.selectedVariant(item)
    const index = variants.findIndex(variant => variant.id === selected?.id)
    const next = variants[index + delta]
    if (next === undefined) return
    this.selectedVariants.set(item.id, next.id)
    this.adapter.invalidate()
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
    if (model.mode === 'loading') {
      /* v8 ignore next -- loading documents expose only their primary cancel action. */
      if (!secondary && model.submit !== undefined) void this.options.onAction(model.submit)
      return
    }
    /* v8 ignore next -- a secondary button is compiled only when its action exists. */
    const action = this.selectedAction(model, secondary) ?? (secondary ? undefined : model.submit)
    /* v8 ignore next -- action buttons are compiled only when this resolves; empty documents close with Escape. */
    if (action === undefined) { if (!secondary) this.options.onClose(); return }
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
    } else if (event.kind === 'tab-change' && event.controlId === 'frontend-panel-variants') {
      const item = this.selectedItem(model)
      if (item?.variants?.some(variant => variant.id === event.tabId && variant.disabled !== true) === true) {
        this.selectedVariants.set(item.id, event.tabId)
        this.adapter.invalidate()
      }
    } else if (event.kind === 'activate' && event.controlId === 'frontend-panel-clear-filter') {
      this.query = ''
      this.filterEditing = false
      this.reseedSelection(model)
      this.adapter.invalidate()
    } else if (event.kind === 'activate' && (event.controlId === 'frontend-panel-primary' || event.controlId === 'frontend-panel-secondary')) {
      this.activate(model, event.controlId === 'frontend-panel-secondary')
    }
  }

  private onFocusChange(controlId: string, itemId: string | undefined): void {
    this.focusedControlId = controlId
    if (controlId !== 'frontend-panel-list' || itemId === undefined || itemId === this.selectedId) return
    this.selectedId = itemId
    this.adapter.invalidate()
  }
}

function nodeText(node: BlueUiNode | undefined): string | undefined {
  return node?.kind === 'text' ? node.content : undefined
}
