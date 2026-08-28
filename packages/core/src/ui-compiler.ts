/**
 * The sole compiler from canonical public Blue UI nodes into pi-tui-backed
 * components. One outer focus target owns roving state, event dispatch,
 * responsive reconciliation, cursor-marker insertion, and render containment.
 *
 * @module @dsh-blue/blue-core/ui-compiler
 */

import type { BlueErrorCode, BlueFormField, BlueTone, BlueUiEvent, BlueUiNode, BlueViewportCondition, BlueView } from '@dsh-blue/blue-api'
import { CURSOR_MARKER, HStack, ScrollView, VStack, type Component } from '@earendil-works/pi-tui'
import { getLayoutNode, LAYOUT_NODE, type LayoutNode, type LayoutViewport } from '@earendil-works/pi-tui/dist/layout-node.js'
import { paintPluginTone, renderCanonicalView } from './plugin-view.ts'
import type { BlueComponent, BlueComponents, BlueFocusable, BlueSemanticColors } from './types.ts'
import {
  renderActions,
  renderDivider,
  renderEmpty,
  renderFormField,
  renderList,
  renderLoader,
  renderProgress,
  renderSurfaceHead,
  renderSurfaceTail,
  renderTabs,
  type PatternFocus,
} from './ui-patterns.ts'
import { sliceByColumn, visibleWidth } from './width.ts'
import { validateBlueUiNode } from './ui-validator.ts'

const FOCUS_SENTINEL = '\uf8ff'
const ERROR_MAX_ROWS = 3
const LAYOUT_VALUE_MAX = 1_000_000

/** Pane-relative dimensions used by responsive child conditions. */
export interface BlueUiViewport {
  readonly columns: number
  readonly rows: number
}

/** Narrow runtime dependencies accepted by the canonical compiler. */
export interface BlueUiCompilerOptions {
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly getViewport: () => BlueUiViewport
  readonly screenMode: 'main' | 'alternate'
  /** Internal compatibility budget; public plugin surfaces retain the 20-row default. */
  readonly maxLeafRows?: number
  readonly emit: (event: BlueUiEvent) => void
  /** Called only when Escape did not first cancel compiler-local state. */
  readonly onUnhandledEscape?: () => void
}

/** Successful canonical compilation result. */
export interface BlueCompiledUi {
  readonly node: BlueUiNode
  readonly component: BlueComponent
  readonly focusTarget: BlueFocusable | null
}

/** Compile failure with a safe renderer-owned error surface. */
export interface BlueUiCompileFailure {
  readonly ok: false
  readonly code: BlueErrorCode
  readonly message: string
  readonly errorComponent: BlueComponent
}

/** Result returned by the no-bypass UI compiler. */
export type BlueUiCompileResult = { readonly ok: true, readonly value: BlueCompiledUi } | BlueUiCompileFailure

interface ControlBase {
  readonly key: string
  readonly preferred: boolean
  readonly group: string
  readonly navigation: 'horizontal' | 'vertical' | 'none'
}

type TextField = Extract<BlueFormField, { readonly kind: 'input' | 'textarea' | 'secret' }>
type SelectField = Extract<BlueFormField, { readonly kind: 'select' }>
type ToggleField = Extract<BlueFormField, { readonly kind: 'toggle' }>
type FormNode = Extract<BlueUiNode, { readonly kind: 'form' }>

type ControlDescriptor =
  | (ControlBase & { readonly kind: 'event', readonly event: BlueUiEvent, readonly confirm?: string })
  | (ControlBase & { readonly kind: 'text', readonly field: TextField })
  | (ControlBase & { readonly kind: 'select', readonly field: SelectField })
  | (ControlBase & { readonly kind: 'toggle', readonly field: ToggleField })
  | (ControlBase & { readonly kind: 'submit', readonly form: FormNode, readonly formPath: string })

interface FocusState {
  activeKey: string | undefined
  lastIndex: number
  focused: boolean
  layoutPass: boolean
  pendingConfirmation: string | undefined
  controls(): readonly ControlDescriptor[]
  emit(event: BlueUiEvent): void
  field(field: BlueFormField, key: string): BlueFormField
  fieldValue(field: BlueFormField, key: string): string | boolean | null
  setTextValue(key: string, canonical: string, value: string): void
  setSelectValue(key: string, canonical: string | null, value: string | null): void
  setToggleValue(key: string, canonical: boolean, value: boolean): void
  setLayoutViewport(viewport: BlueUiViewport): void
}

function safeViewport(getViewport: () => BlueUiViewport): BlueUiViewport {
  try {
    const viewport = getViewport()
    const columns = Number.isFinite(viewport.columns) ? Math.max(1, Math.floor(viewport.columns)) : 1
    const rows = Number.isFinite(viewport.rows) ? Math.max(1, Math.floor(viewport.rows)) : 1
    return { columns, rows }
  } catch {
    return { columns: 1, rows: 1 }
  }
}

function conditionMatches(condition: BlueViewportCondition | undefined, viewport: BlueUiViewport): boolean {
  if (condition === undefined) return true
  return (condition.minWidth === undefined || viewport.columns >= condition.minWidth)
    && (condition.maxWidth === undefined || viewport.columns <= condition.maxWidth)
    && (condition.minHeight === undefined || viewport.rows >= condition.minHeight)
    && (condition.maxHeight === undefined || viewport.rows <= condition.maxHeight)
}

function errorRows(message: string, width: number, colors: BlueSemanticColors): string[] {
  const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
  const source = `Blue UI rejected: ${message}`.replace(/[\x00-\x1f\x7f-\x9f]/gu, ' ')
  const chunks: string[] = []
  let remaining = source
  while (remaining.length > 0 && chunks.length < ERROR_MAX_ROWS) {
    let consumed = 0
    let columns = 0
    for (const codePoint of remaining) {
      const codePointWidth = visibleWidth(codePoint)
      consumed += codePoint.length
      if (columns + codePointWidth > safeWidth) break
      columns += codePointWidth
      if (columns >= safeWidth) break
    }
    const row = sliceByColumn(remaining.slice(0, consumed), 0, safeWidth, true)
    chunks.push(row)
    remaining = remaining.slice(consumed)
  }
  return chunks.map(row => {
    try {
      const painted = colors.error(row)
      return visibleWidth(painted) <= safeWidth ? painted : sliceByColumn(painted, 0, safeWidth, true)
    } catch {
      return row
    }
  })
}

class ErrorComponent implements BlueComponent {
  constructor(private readonly message: string, private readonly colors: BlueSemanticColors) {}
  render(width: number): string[] { return errorRows(this.message, width, this.colors) }
  invalidate(): void {}
}

function staticComponent(render: (width: number) => string[], options: BlueUiCompilerOptions): BlueComponent {
  return {
    render: width => {
      try {
        return render(width)
      } catch (error) {
        return errorRows(error instanceof Error ? error.message : 'unknown render failure', width, options.colors)
      }
    },
    invalidate: () => {},
  }
}

function safePaint(colors: BlueSemanticColors, tone: BlueTone | undefined, value: string): string {
  return paintPluginTone(colors, tone)(value)
}

function patternFocus(state: FocusState, prefix: string): PatternFocus {
  return {
    key: state.activeKey?.startsWith(prefix) === true ? state.activeKey.slice(prefix.length) : '',
    focused: state.focused,
    marker: state.layoutPass ? `${CURSOR_MARKER} ` : FOCUS_SENTINEL,
    ...(state.pendingConfirmation?.startsWith(prefix) === true ? { pendingKey: state.pendingConfirmation.slice(prefix.length) } : {}),
  }
}

function joinSpans(node: { readonly spans: readonly { readonly text: string, readonly tone?: BlueTone, readonly emphasis?: 'normal' | 'strong' }[] }, colors: BlueSemanticColors): string {
  return node.spans.map(span => {
    const painted = safePaint(colors, span.tone, span.text)
    return span.emphasis === 'strong' ? `\x1b[1m${painted}\x1b[22m` : painted
  }).join('')
}

function pad(component: Component, amount: number, options: BlueUiCompilerOptions): Component {
  if (amount === 0) return component
  const padded = new HStack()
  const spacer = (): BlueComponent => staticComponent(() => [''], options)
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  padded.addChild(component, { basis: 0, grow: 1, shrink: 1, minSize: 1 })
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  return padded
}

function surfaceComponent(node: Extract<BlueUiNode, { readonly kind: 'surface' }>, child: Component, footer: Component | undefined, options: BlueUiCompilerOptions): BlueComponent {
  const component = new VStack()
  component.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors), options))
  component.addChild(child)
  if (footer !== undefined) component.addChild(footer)
  component.addChild(staticComponent(width => renderSurfaceTail(node, width, options.colors), options))
  return pad(component, node.padding ?? 0, options)
}

function controlsForNode(node: BlueUiNode, options: BlueUiCompilerOptions, path = '$', includeHidden = false): ControlDescriptor[] {
  const controls: ControlDescriptor[] = []
  const visit = (current: BlueUiNode, currentPath: string): void => {
    switch (current.kind) {
      case 'stack':
        for (const [index, child] of current.children.entries()) {
          if (includeHidden || conditionMatches(child.when, safeViewport(options.getViewport))) visit(child.node, `${currentPath}.${String(index)}`)
        }
        break
      case 'surface':
        visit(current.child, `${currentPath}.child`)
        if (current.footer !== undefined) visit(current.footer, `${currentPath}.footer`)
        break
      case 'scroll': visit(current.child, `${currentPath}.scroll`); break
      case 'tabs':
        for (const item of current.items) if (item.disabled !== true) controls.push({ kind: 'event', key: `${currentPath}:${item.id}`, preferred: item.id === current.activeId, group: currentPath, navigation: 'horizontal', event: { kind: 'tab-change', controlId: current.id, tabId: item.id } })
        break
      case 'list':
        for (const item of current.items) if (item.disabled !== true) {
          const value = current.mode === 'multiple'
            ? current.selectedIds.includes(item.id) ? current.selectedIds.filter(id => id !== item.id) : [...current.selectedIds, item.id]
            : item.id
          controls.push({ kind: 'event', key: `${currentPath}:${item.id}`, preferred: current.selectedIds.includes(item.id), group: currentPath, navigation: 'vertical', event: { kind: 'selection-change', controlId: current.id, value } })
        }
        if (current.items.length === 0 && current.empty !== undefined) visit(current.empty, `${currentPath}.empty`)
        break
      case 'form':
        for (const field of current.fields) if (field.disabled !== true) {
          const base: ControlBase = { key: `${currentPath}:field:${field.id}`, preferred: false, group: currentPath, navigation: 'vertical' }
          if (field.kind === 'toggle') controls.push({ ...base, kind: 'toggle', field })
          else if (field.kind === 'select') controls.push({ ...base, kind: 'select', field })
          else controls.push({ ...base, kind: 'text', field })
        }
        if (current.submitActionId !== undefined) controls.push({ kind: 'submit', key: `${currentPath}:submit`, preferred: false, group: currentPath, navigation: 'vertical', form: current, formPath: currentPath })
        if (current.cancelActionId !== undefined) controls.push({ kind: 'event', key: `${currentPath}:cancel`, preferred: false, group: currentPath, navigation: 'vertical', event: { kind: 'activate', controlId: current.cancelActionId } })
        break
      case 'actions':
        for (const item of current.items) if (item.disabled !== true && item.busy !== true) controls.push({ kind: 'event', key: `${currentPath}:${item.id}`, preferred: item.intent === 'primary', group: currentPath, navigation: 'horizontal', event: { kind: 'activate', controlId: item.id }, ...(item.confirm === undefined ? {} : { confirm: item.confirm }) })
        break
      case 'loader':
        if (current.cancelActionId !== undefined) controls.push({ kind: 'event', key: `${currentPath}:cancel`, preferred: false, group: currentPath, navigation: 'none', event: { kind: 'activate', controlId: current.cancelActionId } })
        break
      case 'empty': if (current.actions !== undefined) visit(current.actions, `${currentPath}.actions`); break
      default: break
    }
  }
  visit(node, path)
  return controls
}

function compileNode(node: BlueUiNode, state: FocusState, options: BlueUiCompilerOptions, path = '$'): Component {
  switch (node.kind) {
    case 'text':
    case 'fields':
    case 'code':
    case 'diff':
    case 'sections': return staticComponent(width => renderCanonicalView(
      node as BlueView,
      width,
      options.components,
      options.colors,
      options.maxLeafRows ?? 20,
    ), options)
    case 'rich-text': return staticComponent(width => options.components.wrapText(joinSpans(node, options.colors), Math.max(1, width)), options)
    case 'stack': {
      const stackOptions = {
        ...(node.gap === undefined ? {} : { gap: node.gap }),
        ...(node.align === undefined ? {} : { align: node.align }),
      }
      const stack = options.screenMode === 'main' || node.direction === 'column'
        ? new VStack([], stackOptions)
        : new HStack([], stackOptions)
      for (const [index, child] of node.children.entries()) {
        const compiled = compileNode(child.node, state, options, `${path}.${String(index)}`)
        const layout = options.screenMode === 'main'
          ? { visible: () => conditionMatches(child.when, safeViewport(options.getViewport)) }
          : {
              ...(child.basis === undefined || child.basis === 'auto' ? (child.basis === 'auto' ? { basis: 'auto' as const } : {}) : { basis: Math.min(child.basis, LAYOUT_VALUE_MAX) }),
              ...(child.grow === undefined ? {} : { grow: Math.min(child.grow, LAYOUT_VALUE_MAX) }),
              ...(child.shrink === undefined ? {} : { shrink: Math.min(child.shrink, LAYOUT_VALUE_MAX) }),
              ...(child.minSize === undefined ? {} : { minSize: Math.min(child.minSize, LAYOUT_VALUE_MAX) }),
              ...(child.maxSize === undefined ? {} : { maxSize: Math.min(child.maxSize, LAYOUT_VALUE_MAX) }),
              visible: (viewport: LayoutViewport) => {
                const current = state.layoutPass
                  ? { columns: viewport.width, rows: viewport.height }
                  : safeViewport(options.getViewport)
                if (state.layoutPass) {
                  state.setLayoutViewport(current)
                  reconcile(state)
                }
                return conditionMatches(child.when, current)
              },
            }
        stack.addChild(compiled, layout)
      }
      return stack
    }
    case 'surface': return surfaceComponent(node, compileNode(node.child, state, options, `${path}.child`), node.footer === undefined ? undefined : compileNode(node.footer, state, options, `${path}.footer`), options)
    case 'scroll': {
      const child = compileNode(node.child, state, options, `${path}.scroll`)
      if (options.screenMode === 'main') return child
      return new ScrollView(child, { follow: node.follow === 'end' ? 'end' : 'none', primary: false, overscroll: 'contain', scrollbar: node.scrollbar === true ? 'auto' : 'hidden' })
    }
    case 'tabs': {
      return staticComponent(width => renderTabs(node, width, patternFocus(state, `${path}:`), options.colors), options)
    }
    case 'list': {
      if (node.items.length === 0) return node.empty === undefined ? staticComponent(() => [], options) : compileNode(node.empty, state, options, `${path}.empty`)
      return staticComponent(width => renderList(node, width, options.screenMode === 'main' ? Number.MAX_SAFE_INTEGER : safeViewport(options.getViewport).rows, patternFocus(state, `${path}:`), options.colors), options)
    }
    case 'form': {
      const stack = new VStack()
      for (const field of node.fields) {
        const key = `${path}:field:${field.id}`
        stack.addChild(staticComponent(width => renderFormField(state.field(field, key), width, patternFocus(state, `${path}:field:`), options.colors), options))
      }
      if (node.submitActionId !== undefined) stack.addChild(staticComponent(width => renderActions({ kind: 'actions', id: node.id, items: [{ id: 'submit', label: node.submitActionId!, intent: 'primary' }] }, width, patternFocus(state, `${path}:`), options.colors, true), options))
      if (node.cancelActionId !== undefined) stack.addChild(staticComponent(width => renderActions({ kind: 'actions', id: node.id, items: [{ id: 'cancel', label: node.cancelActionId! }] }, width, patternFocus(state, `${path}:`), options.colors, true), options))
      return stack
    }
    case 'actions': {
      return staticComponent(width => renderActions(node, width, patternFocus(state, `${path}:`), options.colors, options.screenMode === 'main'), options)
    }
    case 'loader': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => renderLoader(node, width, options.colors), options))
      if (node.cancelActionId !== undefined) stack.addChild(staticComponent(width => renderActions({ kind: 'actions', id: node.cancelActionId!, items: [{ id: 'cancel', label: node.cancelActionId! }] }, width, patternFocus(state, `${path}:`), options.colors, true), options))
      return stack
    }
    case 'empty': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => renderEmpty(node, width, options.colors), options))
      if (node.actions !== undefined) stack.addChild(compileNode(node.actions, state, options, `${path}.actions`))
      return stack
    }
    case 'progress': return staticComponent(width => renderProgress(node, width, options.colors), options)
    case 'spacer': return staticComponent(() => Array.from({ length: node.size ?? 1 }, () => ''), options)
    case 'divider': return staticComponent(width => renderDivider(node.label, width, options.colors), options)
  }
}

function reconcile(state: FocusState): readonly ControlDescriptor[] {
  const controls = state.controls()
  if (controls.length === 0) {
    state.activeKey = undefined
    state.pendingConfirmation = undefined
    state.lastIndex = 0
    return controls
  }
  const current = controls.findIndex(control => control.key === state.activeKey)
  if (current >= 0) {
    state.lastIndex = current
    return controls
  }
  const preferred = controls.findIndex(control => control.preferred)
  state.lastIndex = preferred >= 0 ? preferred : Math.min(state.lastIndex, controls.length - 1)
  state.pendingConfirmation = undefined
  state.activeKey = controls[state.lastIndex]!.key
  return controls
}

class CompiledSurface implements BlueFocusable {
  private readonly state: FocusState
  private readonly root: Component
  private viewport: BlueUiViewport

  constructor(node: BlueUiNode, private readonly options: BlueUiCompilerOptions) {
    this.viewport = safeViewport(options.getViewport)
    const runtimeOptions: BlueUiCompilerOptions = { ...options, getViewport: () => this.viewport }
    const textBuffers = new Map<string, { canonical: string, value: string }>()
    const selectDrafts = new Map<string, { canonical: string | null, value: string | null }>()
    const toggleDrafts = new Map<string, { canonical: boolean, value: boolean }>()
    const fieldValue = (field: BlueFormField, key: string): string | boolean | null => {
      if (field.kind === 'toggle') {
        const current = toggleDrafts.get(key)
        if (current !== undefined && current.canonical === field.value) return current.value
        toggleDrafts.set(key, { canonical: field.value, value: field.value })
        return field.value
      }
      if (field.kind === 'select') {
        const current = selectDrafts.get(key)
        if (current !== undefined && current.canonical === field.value) return current.value
        selectDrafts.set(key, { canonical: field.value, value: field.value })
        return field.value
      }
      const current = textBuffers.get(key)
      if (current !== undefined && current.canonical === field.value) return current.value
      textBuffers.set(key, { canonical: field.value, value: field.value })
      return field.value
    }
    this.state = {
      activeKey: undefined,
      lastIndex: 0,
      focused: false,
      layoutPass: false,
      pendingConfirmation: undefined,
      controls: () => controlsForNode(node, runtimeOptions),
      emit: event => {
        try { options.emit(event) } catch { /* event failures are host-owned */ }
      },
      field: (field, key) => ({ ...field, value: fieldValue(field, key) } as BlueFormField),
      fieldValue,
      setTextValue: (key, canonical, value) => { textBuffers.set(key, { canonical, value }) },
      setSelectValue: (key, canonical, value) => { selectDrafts.set(key, { canonical, value }) },
      setToggleValue: (key, canonical, value) => { toggleDrafts.set(key, { canonical, value }) },
      setLayoutViewport: viewport => { this.viewport = viewport },
    }
    this.root = compileNode(node, this.state, runtimeOptions)
  }

  get focused(): boolean { return this.state.focused }
  set focused(value: boolean) {
    this.state.focused = value
    if (!value) this.state.pendingConfirmation = undefined
  }

  [LAYOUT_NODE](): LayoutNode {
    this.viewport = safeViewport(this.options.getViewport)
    reconcile(this.state)
    this.state.layoutPass = true
    return getLayoutNode(this.root) ?? {
      type: 'vstack',
      entries: [{ component: this.root, basis: 'auto', grow: 1, shrink: 1 }],
      gap: 0,
      align: 'stretch',
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    try {
      this.state.layoutPass = false
      this.viewport = safeViewport(this.options.getViewport)
      reconcile(this.state)
      const rows = this.root.render(safeWidth)
      const rendered = (this.options.screenMode === 'alternate' ? rows.slice(0, this.viewport.rows) : rows)
        .map(row => visibleWidth(row) <= safeWidth ? row : sliceByColumn(row, 0, safeWidth, true))
      let inserted = false
      return rendered.map(row => {
        if (!this.focused || inserted || !row.includes(FOCUS_SENTINEL)) return row.replaceAll(FOCUS_SENTINEL, ' ')
        inserted = true
        return row.replace(FOCUS_SENTINEL, `${CURSOR_MARKER} `).replaceAll(FOCUS_SENTINEL, ' ')
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown render failure'
      return errorRows(message, safeWidth, this.options.colors)
    }
  }

  handleInput(data: string): void {
    this.viewport = safeViewport(this.options.getViewport)
    const controls = reconcile(this.state)
    if (data === '\x1b') {
      const consumed = this.state.pendingConfirmation !== undefined
      this.state.pendingConfirmation = undefined
      if (!consumed) this.options.onUnhandledEscape?.()
      return
    }
    if (controls.length === 0) return
    const active = controls[this.state.lastIndex]!
    const moveTo = (index: number): void => {
      this.state.pendingConfirmation = undefined
      this.state.lastIndex = index
      this.state.activeKey = controls[index]!.key
    }
    if (data === '\t' || data === '\x1b[Z') {
      const delta = data === '\t' ? 1 : -1
      moveTo((this.state.lastIndex + controls.length + delta) % controls.length)
      return
    }
    const direction = data === '\x1b[A' || data === '\x1b[D' ? -1 : data === '\x1b[B' || data === '\x1b[C' ? 1 : 0
    if (active.kind === 'select' && direction !== 0) {
      const enabled = active.field.options.filter(option => option.disabled !== true)
      if (enabled.length === 0) return
      const current = this.state.fieldValue(active.field, active.key)
      const currentIndex = enabled.findIndex(option => option.id === current)
      const nextIndex = currentIndex < 0
        ? direction > 0 ? 0 : enabled.length - 1
        : (currentIndex + enabled.length + direction) % enabled.length
      this.state.setSelectValue(active.key, active.field.value, enabled[nextIndex]!.id)
      return
    }
    if (direction !== 0) {
      const matchingDirection = active.navigation === 'horizontal'
        ? data === '\x1b[D' || data === '\x1b[C'
        : active.navigation === 'vertical' && (data === '\x1b[A' || data === '\x1b[B')
      if (!matchingDirection) return
      const siblings = controls.map((control, index) => ({ control, index })).filter(entry => entry.control.group === active.group)
      const siblingIndex = siblings.findIndex(entry => entry.index === this.state.lastIndex)
      moveTo(siblings[(siblingIndex + siblings.length + direction) % siblings.length]!.index)
      return
    }
    if (active.kind === 'text') {
      const current = String(this.state.fieldValue(active.field, active.key))
      if (data === '\x7f' || data === '\b') {
        const value = Array.from(current).slice(0, -1).join('')
        this.state.setTextValue(active.key, active.field.value, value)
        this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
        return
      }
      if (/^[^\x00-\x1f\x7f-\x9f]+$/u.test(data)) {
        const value = `${current}${data}`
        this.state.setTextValue(active.key, active.field.value, value)
        this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
        return
      }
      if (data === '\r' || data === '\n') this.state.emit({ kind: 'value-change', controlId: active.field.id, value: current })
      return
    }
    if (data !== '\r' && data !== '\n' && data !== ' ') return
    if (active.kind === 'toggle') {
      const value = !this.state.fieldValue(active.field, active.key)
      this.state.setToggleValue(active.key, active.field.value, value)
      this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
      return
    }
    if (active.kind === 'select') {
      this.state.emit({ kind: 'value-change', controlId: active.field.id, value: this.state.fieldValue(active.field, active.key) })
      return
    }
    if (active.kind === 'submit') {
      const values = Object.fromEntries(active.form.fields.map(field => [field.id, this.state.fieldValue(field, `${active.formPath}:field:${field.id}`)]))
      this.state.emit({ kind: 'submit', controlId: active.form.id, values })
      return
    }
    if (active.confirm !== undefined && this.state.pendingConfirmation !== active.key) {
      this.state.pendingConfirmation = active.key
      return
    }
    this.state.pendingConfirmation = undefined
    this.state.emit(active.event)
  }

  invalidate(): void { this.root.invalidate?.() }
}

/** Validate first, then compile one canonical UI tree without a bypass path. */
export function compileBlueUiNode(value: unknown, options: BlueUiCompilerOptions): BlueUiCompileResult {
  const admitted = validateBlueUiNode(value)
  if (!admitted.ok) {
    return { ok: false, code: admitted.code, message: admitted.message, errorComponent: new ErrorComponent(admitted.message, options.colors) }
  }
  try {
    const surface = new CompiledSurface(admitted.value, options)
    const focusTarget = controlsForNode(admitted.value, options, '$', true).length === 0 ? null : surface
    return { ok: true, value: { node: admitted.value, component: surface, focusTarget } }
  } catch {
    const message = 'Blue UI compilation failed safely'
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message, errorComponent: new ErrorComponent(message, options.colors) }
  }
}
