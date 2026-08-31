/**
 * The sole compiler from canonical public Blue UI nodes into pi-tui-backed
 * components. One outer focus target owns roving state, event dispatch,
 * responsive reconciliation, cursor-marker insertion, and render containment.
 *
 * @module @dsh-blue/blue-core/ui-compiler
 */

import type { BlueEditorShellNode, BlueErrorCode, BlueFormField, BlueStatusNode, BlueTone, BlueUiEvent, BlueUiNode, BlueViewportCondition, BlueView } from '@dsh-blue/blue-api'
import { CURSOR_MARKER, HStack, Key, matchesKey, ScrollView, VStack, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame, type LayoutBox, type LayoutRect } from '@earendil-works/pi-tui/dist/layout.js'
import { getLayoutNode, LAYOUT_NODE, type LayoutNode, type LayoutViewport } from '@earendil-works/pi-tui/dist/layout-node.js'
import { hintRow } from './chrome.ts'
import { ownDataErrorMessage } from './error-message.ts'
import { paintPluginTone, renderCanonicalView } from './plugin-view.ts'
import type { BlueComponent, BlueComponents, BlueEditor, BlueFocusable, BlueFocusIdentity, BlueSemanticColors } from './types.ts'
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
import { validateBlueEditorShellNode, validateBlueStatusNode, validateBlueUiNode } from './ui-validator.ts'

const FOCUS_SENTINEL = '\uf8ff'
const ERROR_MAX_ROWS = 3
const LAYOUT_VALUE_MAX = 1_000_000
const INACTIVE_FIELD_CACHE_LIMIT = 64
const PASSIVE_EVENT_SINK = Function.prototype as (event: BlueUiEvent) => void

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
  /** Internal compatibility leaf path; public plugin surfaces never set it. */
  readonly leafRowWindowPath?: string
  /** Internal Markdown leaf path; public plugin surfaces never set it. */
  readonly markdownLeafPath?: string
  /** Live offset for the selected compatibility leaf. */
  readonly leafRowOffset?: () => number
  /** Receives the selected leaf's clamped offset and post-wrap row metadata. */
  readonly onLeafRowOffset?: (offset: number, totalRows: number, limit: number) => void
  /** Requests a new compatibility-leaf offset after a focused scroll gesture. */
  readonly onLeafRowScroll?: (offset: number) => void
  /** Internal stable editor pool used only by official form adapters. */
  readonly resolveTextEditor?: (controlId: string, path: string) => BlueEditor
  /** Internal official-form submit bridge. */
  readonly onTextSubmit?: (controlId: string, value: string) => void
  /** Interaction-private observation of renderer focus; public UI events stay confirmation-only. */
  readonly onFocusChange?: (identity: BlueFocusIdentity) => void
  /** Renderer-private contextual key hints used by official panel adapters. */
  readonly contextHints?: {
    readonly enabled?: boolean
    readonly suppressAuto?: boolean
    readonly focusWithoutControls?: boolean
    readonly translate?: (key: string) => string
    readonly extra?: () => readonly {
      readonly id: string
      readonly keys: string
      readonly label?: string
      readonly compact?: string
      readonly priority?: number
    }[]
  }
  readonly emit: (event: BlueUiEvent) => void
  /** Called only when Escape did not first cancel compiler-local state. */
  readonly onUnhandledEscape?: () => void
}

/** Canonical shell dependencies, including the one host-owned editing engine. */
export interface BlueEditorShellCompilerOptions extends BlueUiCompilerOptions {
  readonly editor: BlueEditor
}

/** Core-private compiler options for one bridge-owned plugin surface. */
interface BlueUiSurfaceCompilerOptions extends BlueUiCompilerOptions {
  readonly surfaceRuntime: BlueUiSurfaceRuntime
  readonly refreshMode: 'internal' | 'external'
  readonly escapeHint?: 'close' | 'leave'
}

/** Passive dependencies and bounded height for one compact status tree. */
export interface BlueStatusCompilerOptions {
  readonly components: BlueComponents
  readonly colors: BlueSemanticColors
  readonly getViewport: () => BlueUiViewport
  readonly screenMode: 'main' | 'alternate'
  /** Status output is always bounded to one through three rows; defaults to one. */
  readonly maxRows?: 1 | 2 | 3
}

/** Successful canonical compilation result. */
export interface BlueCompiledUi {
  readonly node: BlueUiNode
  readonly component: BlueComponent
  readonly focusTarget: BlueFocusable | null
}

/** Successful editor-shell compilation around the injected editing engine. */
export interface BlueCompiledEditorShell {
  readonly node: BlueEditorShellNode
  readonly component: BlueEditorShellComponent
  readonly focusTarget: BlueEditorShellComponent
}

/** One editor-shell render plus a contained renderer failure, when present. */
export interface BlueEditorShellRenderResult {
  readonly rows: string[]
  readonly runtimeFailure?: string
}

/** Checked-render options used before an editor provider is committed. */
export interface BlueEditorShellRenderOptions {
  /** Restore composite/editor focus and roving state after the render. */
  readonly dryRun?: boolean
}

/** Focusable editor shell with a provider-owned checked-render boundary. */
export interface BlueEditorShellComponent extends BlueFocusable {
  /**
   * Render with structured failure reporting. A dry run restores all focus
   * state after measuring the candidate.
   * @param width - assigned editor-shell width.
   * @param options - optional dry-run behavior.
   * @returns rendered rows and the first contained runtime failure.
   */
  renderChecked(width: number, options?: BlueEditorShellRenderOptions): BlueEditorShellRenderResult
  /** Select the host editor inside this shell without taking screen focus. */
  focusEditor(): void
}

/** One bounded status render and whether the assigned viewport hid content. */
export interface BlueStatusRenderResult {
  readonly rows: string[]
  readonly overflowed: boolean
  /** Renderer failure contained behind the status boundary, when present. */
  readonly runtimeFailure?: string
}

/** Passive status component with explicit overflow metadata for footer policy. */
export interface BlueStatusComponent extends BlueComponent {
  /**
   * Render within the compiler's one-to-three-row budget.
   * @param width - assigned status width in terminal columns.
   * @returns bounded rows plus whether row or column content overflowed.
   */
  renderStatus(width: number): BlueStatusRenderResult
}

/** Successful canonical status compilation result. */
export interface BlueCompiledStatus {
  readonly node: BlueStatusNode
  readonly component: BlueStatusComponent
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

/** Result returned by the no-bypass editor-shell compiler. */
export type BlueEditorShellCompileResult = { readonly ok: true, readonly value: BlueCompiledEditorShell } | BlueUiCompileFailure

/** Status compile failure with a passive, height-bounded error component. */
export interface BlueStatusCompileFailure {
  readonly ok: false
  readonly code: BlueErrorCode
  readonly message: string
  readonly errorComponent: BlueStatusComponent
}

/** Result returned by the no-bypass status compiler. */
export type BlueStatusCompileResult = { readonly ok: true, readonly value: BlueCompiledStatus } | BlueStatusCompileFailure

type CompilerMode = 'ui' | 'status' | 'editor'

type CompilableNode = BlueUiNode | BlueEditorShellNode

interface RuntimeCompilerOptions extends BlueUiCompilerOptions {
  readonly editor?: BlueEditor
  readonly reportRuntimeFailure: (message: string) => void
}

interface ControlBase {
  readonly key: string
  readonly renderKey: string
  readonly identity: BlueFocusIdentity
  readonly preferred: boolean
  readonly group: string
  readonly navigation: 'horizontal' | 'vertical' | 'none'
}

type TextField = Extract<BlueFormField, { readonly kind: 'input' | 'textarea' | 'secret' }>
type SelectField = Extract<BlueFormField, { readonly kind: 'select' }>
type ToggleField = Extract<BlueFormField, { readonly kind: 'toggle' }>
type FormNode = Extract<BlueUiNode, { readonly kind: 'form' }>

type ControlDescriptor =
  | (ControlBase & {
      readonly kind: 'event'
      readonly role: 'tab' | 'list-single' | 'list-multiple' | 'action' | 'cancel'
      readonly activation: 'enter' | 'space' | 'both'
      readonly event: BlueUiEvent
      readonly commitEvent?: BlueUiEvent
      readonly confirm?: string
    })
  | (ControlBase & { readonly kind: 'text', readonly field: TextField })
  | (ControlBase & { readonly kind: 'select', readonly field: SelectField })
  | (ControlBase & { readonly kind: 'toggle', readonly field: ToggleField })
  | (ControlBase & { readonly kind: 'submit', readonly form: FormNode })
  | (ControlBase & { readonly kind: 'editor' })
  | (ControlBase & { readonly kind: 'scroll' })

interface ControlGroup {
  readonly id: string
  readonly kind: 'tabs' | 'content'
  readonly entries: readonly { readonly control: ControlDescriptor, readonly index: number }[]
}

interface ControlBinding {
  readonly component: Component
  readonly axis: 'horizontal' | 'vertical' | 'none'
}

interface ScrollControl {
  readonly viewportHeight: number
  scrollBy(amount: number): void
  scrollToStart(): void
  scrollToEnd(): void
  setScrollbarActive(active: boolean): void
}

interface FocusState {
  activeKey: string | undefined
  activeGroup: string | undefined
  desiredKey: string | undefined
  desiredGroup: string | undefined
  editingKey: string | undefined
  readonly groupActiveKeys: Map<string, string>
  readonly controlBindings: Map<string, ControlBinding>
  readonly scrollViews: Map<string, ScrollControl>
  lastTabGroupIndex: number
  lastIndex: number
  focused: boolean
  layoutPass: boolean
  pendingConfirmation: string | undefined
  controls(): readonly ControlDescriptor[]
  allControls(): readonly ControlDescriptor[]
  emit(event: BlueUiEvent): void
  field(field: BlueFormField, key: string): BlueFormField
  fieldValue(field: BlueFormField, key: string): string | boolean | null
  setTextValue(key: string, canonical: string, value: string): void
  textEditor(field: TextField, key: string): BlueEditor
  setSelectValue(key: string, canonical: string | null, value: string | null): void
  beginSelectEditing(field: SelectField, key: string): void
  finishSelectEditing(field: SelectField, key: string, cancel: boolean): string | null
  setToggleValue(key: string, canonical: boolean, value: boolean): void
  setEditing(key: string | undefined): void
  blurInactiveEditors(controls: readonly ControlDescriptor[]): void
  setLayoutViewport(viewport: BlueUiViewport): void
  bindControls(keys: readonly string[], binding: ControlBinding): void
  bindScroll(key: string, scroll: ScrollControl): void
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

function renderFailure(error: unknown, fallback = 'unknown render failure'): string {
  return ownDataErrorMessage(error) ?? fallback
}

function staticComponent(render: (width: number) => string[], options: RuntimeCompilerOptions): BlueComponent {
  return {
    render: width => {
      try {
        return render(width)
      } catch (error) {
        const message = renderFailure(error)
        options.reportRuntimeFailure(message)
        return errorRows(message, width, options.colors)
      }
    },
    invalidate: () => {},
  }
}

function markdownLeafComponent(node: Extract<BlueUiNode, { readonly kind: 'text' }>, path: string, options: RuntimeCompilerOptions): BlueComponent {
  const markdown = options.components.createMarkdown({ text: node.content })
  return {
    render: width => {
      try { return windowLeafRows(markdown.render(Math.max(1, width)), path, options) }
      catch (error) {
        const message = renderFailure(error)
        options.reportRuntimeFailure(message)
        return errorRows(message, width, options.colors)
      }
    },
    invalidate: () => markdown.invalidate(),
  }
}

function editorFieldComponent(field: TextField, key: string, state: FocusState, options: RuntimeCompilerOptions): BlueComponent {
  let editor: BlueEditor | undefined
  const currentEditor = (): BlueEditor => editor ??= state.textEditor(field, key)
  return {
    render: width => {
      try {
        const editor = currentEditor()
        const available = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
        const focused = state.focused && state.activeKey === key && field.disabled !== true
        editor.focused = focused && state.editingKey === key
        const prefix = focused ? `${FOCUS_SENTINEL}→ ` : '   '
        const labelText = `${prefix}${field.label}: `
        const label = field.disabled === true ? options.colors.muted(labelText) : focused ? options.colors.primary(labelText) : options.colors.textStrong(labelText)
        const labelWidth = visibleWidth(label)
        const contentWidth = Math.max(1, available - labelWidth)
        const emptyPlaceholder = editor.getExpandedText().length === 0 && field.placeholder !== undefined
        const body = emptyPlaceholder && !editor.focused
          ? [options.colors.textMuted(field.placeholder!)]
          : editor.renderContent(contentWidth, field.kind === 'secret')
        const indent = ' '.repeat(Math.min(available, labelWidth))
        let rows = body.map((row, index) => sliceByColumn(`${index === 0 ? label : indent}${row}`, 0, available, true))
        if (field.error !== undefined) rows.push(sliceByColumn(options.colors.error(`   ! ${field.error}`), 0, available, true))
        if (state.layoutPass && focused) {
          let inserted = rows.some(row => row.includes(CURSOR_MARKER))
          rows = rows.map(row => {
            if (inserted || !row.includes(FOCUS_SENTINEL)) return row.replaceAll(FOCUS_SENTINEL, ' ')
            inserted = true
            return row.replace(FOCUS_SENTINEL, `${CURSOR_MARKER} `).replaceAll(FOCUS_SENTINEL, ' ')
          })
        }
        return rows
      } catch (error) {
        const message = renderFailure(error, 'unknown editor failure')
        options.reportRuntimeFailure(message)
        return errorRows(message, width, options.colors)
      }
    },
    invalidate: () => editor?.invalidate(),
  }
}

function windowLeafRows(rows: string[], path: string, options: BlueUiCompilerOptions): string[] {
  const limit = Math.max(0, Math.floor(options.maxLeafRows ?? 20))
  if (options.leafRowWindowPath !== path) return rows.slice(0, limit)
  let requested = 0
  try {
    const value = options.leafRowOffset?.() ?? 0
    if (Number.isFinite(value)) requested = Math.max(0, Math.floor(value))
  } catch { /* compatibility state failures fall back to the first page */ }
  const offset = Math.min(requested, Math.max(0, rows.length - limit))
  try { options.onLeafRowOffset?.(offset, rows.length, limit) } catch { /* compatibility observers cannot escape render */ }
  return rows.slice(offset, offset + limit)
}

class MainLeafScrollControl implements ScrollControl {
  private offset = 0
  private totalRows = Number.MAX_SAFE_INTEGER
  viewportHeight = 1

  constructor(
    private readonly notify?: (offset: number) => void,
    readOffset?: () => number,
    initialLimit = 1,
  ) {
    try {
      const value = readOffset?.() ?? 0
      if (Number.isFinite(value)) this.offset = Math.max(0, Math.floor(value))
    } catch { /* compatibility state failures start at the first row */ }
    this.viewportHeight = Math.max(1, Math.floor(initialLimit))
  }

  update(offset: number, totalRows: number, limit: number): void {
    this.offset = offset
    this.totalRows = totalRows
    this.viewportHeight = Math.max(1, limit)
  }

  scrollBy(amount: number): void { this.move(this.offset + amount) }
  scrollToStart(): void { this.move(0) }
  scrollToEnd(): void { this.move(this.totalRows) }
  setScrollbarActive(_active: boolean): void {}

  private move(requested: number): void {
    const offset = Math.max(0, Math.min(Math.floor(requested), Math.max(0, this.totalRows - this.viewportHeight)))
    if (offset === this.offset) return
    this.offset = offset
    try { this.notify?.(offset) } catch { /* official scroll observers cannot escape input */ }
  }
}

function safePaint(colors: BlueSemanticColors, tone: BlueTone | undefined, value: string): string {
  return paintPluginTone(colors, tone)(value)
}

function patternFocus(state: FocusState, prefix: string): PatternFocus {
  const controls = state.controls()
  const active = controls.find(control => control.group === prefix && control.key === state.activeKey)
  const pending = controls.find(control => control.group === prefix && control.key === state.pendingConfirmation)
  const adjusting = controls.find(control => control.group === prefix && control.key === state.editingKey && control.kind === 'select')
  return {
    key: active?.renderKey ?? '',
    focused: state.focused,
    marker: state.layoutPass ? `${CURSOR_MARKER} ` : FOCUS_SENTINEL,
    ...(pending === undefined ? {} : { pendingKey: pending.renderKey }),
    ...(adjusting === undefined ? {} : { adjustingKey: adjusting.renderKey }),
  }
}

function joinSpans(node: { readonly spans: readonly { readonly text: string, readonly tone?: BlueTone, readonly emphasis?: 'normal' | 'strong' }[] }, colors: BlueSemanticColors): string {
  return node.spans.map(span => {
    const painted = safePaint(colors, span.tone, span.text)
    return span.emphasis === 'strong' ? `\x1b[1m${painted}\x1b[22m` : painted
  }).join('')
}

function pad(component: Component, amount: number, options: RuntimeCompilerOptions): Component {
  if (amount === 0) return component
  const padded = new HStack()
  const spacer = (): BlueComponent => staticComponent(() => [''], options)
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  padded.addChild(component, { basis: 0, grow: 1, shrink: 1, minSize: 1 })
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  return padded
}

function overlaySurfaceComponent(node: Extract<CompilableNode, { readonly kind: 'surface' }>, child: Component, footer: Component | undefined, contextHint: Component | undefined, options: RuntimeCompilerOptions): BlueComponent & { [LAYOUT_NODE](): LayoutNode } {
  const body = new VStack()
  body.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors).slice(1), options))
  body.addChild(child)
  if (footer !== undefined) body.addChild(footer)
  if (contextHint !== undefined) body.addChild(contextHint)

  let layoutRows = 1
  const captureLayoutRows = (viewport: LayoutViewport): boolean => {
    layoutRows = Math.min(LAYOUT_VALUE_MAX, Math.max(1, Math.floor(viewport.height)))
    return viewport.width >= 3
  }
  const frameVisible = (viewport: LayoutViewport): boolean => viewport.width >= 3
  const paddingVisible = (index: number) => (viewport: LayoutViewport): boolean => viewport.width >= 5 + index * 2
  const borderRows = (): string[] => Array.from({ length: layoutRows }, () => options.colors.borderFocus('│'))
  const middle = new HStack()
  middle.addChild(staticComponent(borderRows, options), { basis: 1, grow: 0, shrink: 1, visible: captureLayoutRows })
  for (let index = 0; index < (node.padding ?? 0); index += 1) {
    middle.addChild(staticComponent(() => [''], options), { basis: 1, grow: 0, shrink: 100, visible: paddingVisible(index) })
  }
  middle.addChild(body, { basis: 1, grow: 1, shrink: 1, minSize: 0 })
  for (let index = 0; index < (node.padding ?? 0); index += 1) {
    middle.addChild(staticComponent(() => [''], options), { basis: 1, grow: 0, shrink: 100, visible: paddingVisible(index) })
  }
  middle.addChild(staticComponent(borderRows, options), { basis: 1, grow: 0, shrink: 1, visible: captureLayoutRows })

  const layout = new VStack()
  layout.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors).slice(0, 1), options), { basis: 1, grow: 0, shrink: 0, visible: frameVisible })
  layout.addChild(middle, { basis: 0, grow: 1, shrink: 1, minSize: 0 })
  layout.addChild(staticComponent(width => renderSurfaceTail(node, width, options.colors), options), { basis: 1, grow: 0, shrink: 0, visible: frameVisible })

  return {
    [LAYOUT_NODE](): LayoutNode { return layout[LAYOUT_NODE]() },
    render(width: number): string[] {
      const available = Math.max(1, Math.floor(width))
      if (available < 3) return body.render(available).map(row => options.components.truncateToWidth(row, available, ''))
      const requestedPadding = node.padding ?? 0
      const horizontalPadding = Math.min(requestedPadding, Math.max(0, Math.floor((available - 3) / 2)))
      const contentWidth = Math.max(1, available - 2 - horizontalPadding * 2)
      const head = renderSurfaceHead(node, available, options.colors)
      const bodyRows = body.render(contentWidth)
      const tail = renderSurfaceTail(node, available, options.colors)
      const border = options.colors.borderFocus('│')
      const framed = bodyRows.map(row => {
        const clipped = options.components.truncateToWidth(row, contentWidth, '')
        const fill = ' '.repeat(Math.max(0, contentWidth - options.components.visibleWidth(clipped)))
        const inset = ' '.repeat(horizontalPadding)
        return `${border}${inset}${clipped}${fill}${inset}${border}`
      })
      return [...head.slice(0, 1), ...framed, ...tail]
    },
    invalidate(): void { layout.invalidate() },
  }
}

function surfaceComponent(node: Extract<CompilableNode, { readonly kind: 'surface' }>, child: Component, footer: Component | undefined, contextHint: Component | undefined, options: RuntimeCompilerOptions): BlueComponent {
  if (node.chrome === 'overlay') return overlaySurfaceComponent(node, child, footer, contextHint, options)
  const component = new VStack()
  component.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors), options))
  component.addChild(child)
  if (footer !== undefined) component.addChild(footer)
  if (contextHint !== undefined) component.addChild(contextHint)
  component.addChild(staticComponent(width => renderSurfaceTail(node, width, options.colors), options))
  return pad(component, node.padding ?? 0, options)
}

function controlKey(kind: string, controlId: string, itemId?: string): string {
  return JSON.stringify(itemId === undefined ? [kind, controlId] : [kind, controlId, itemId])
}

function focusIdentity(controlId: string, itemId?: string): BlueFocusIdentity {
  return itemId === undefined ? { controlId } : { controlId, itemId }
}

function controlGroup(kind: string, controlId: string): string {
  return JSON.stringify([kind, controlId])
}

function actionGroup(node: Extract<BlueUiNode, { readonly kind: 'actions' }>): string {
  return JSON.stringify(['actions', node.id, [...node.items].map(item => item.id).sort()])
}

function fieldStateKey(key: string, kind: BlueFormField['kind']): string {
  return JSON.stringify(['field-state', key, kind])
}

function groupOrder(controls: readonly ControlDescriptor[]): string[] {
  return [...new Set(controls.map(control => control.group))]
}

function controlGroups(controls: readonly ControlDescriptor[]): ControlGroup[] {
  const groups: { id: string, kind: 'tabs' | 'content', entries: { control: ControlDescriptor, index: number }[] }[] = []
  const byId = new Map<string, (typeof groups)[number]>()
  for (const [index, control] of controls.entries()) {
    let group = byId.get(control.group)
    if (group === undefined) {
      group = {
        id: control.group,
        kind: control.kind === 'event' && control.role === 'tab' ? 'tabs' : 'content',
        entries: [],
      }
      groups.push(group)
      byId.set(control.group, group)
    }
    group.entries.push({ control, index })
  }
  return groups
}

function sameFocusIdentity(left: BlueFocusIdentity, right: BlueFocusIdentity): boolean {
  return left.controlId === right.controlId && left.itemId === right.itemId
}

function groupTarget(controls: readonly ControlDescriptor[], group: string, remembered: string | undefined): number {
  const rememberedIndex = remembered === undefined
    ? -1
    : controls.findIndex(control => control.group === group && control.key === remembered)
  if (rememberedIndex >= 0) return rememberedIndex
  const preferred = controls.findIndex(control => control.group === group && control.preferred)
  if (preferred >= 0) return preferred
  return controls.findIndex(control => control.group === group)
}

interface ContextKeyHint {
  readonly id: string
  readonly keys: string
  readonly label: string | undefined
  readonly compact: string
  readonly priority: number
}

function keyHint(id: string, keys: string, label: string, priority: number, compact = keys): ContextKeyHint {
  return { id, keys, label, compact, priority }
}

function automaticContextKeyHints(state: FocusState, options: RuntimeCompilerOptions, controls: readonly ControlDescriptor[], active: ControlDescriptor | undefined, escapeHint: 'close' | 'leave' | undefined): ContextKeyHint[] {
  if (options.contextHints?.suppressAuto === true) return []
  if (active === undefined || active.kind === 'editor') {
    return escapeHint === undefined || options.contextHints?.focusWithoutControls !== true
      ? []
      : [keyHint('dismiss', 'Esc', escapeHint, 70)]
  }
  if (active.kind === 'scroll') {
    return [
      keyHint('navigate', '↑↓/PgUp/PgDn', 'scroll', 100, 'PgUp/PgDn'),
      ...(groupOrder(controls).length > 1 ? [keyHint('group', 'Tab/Shift-Tab', 'groups', 80, 'Tab')] : []),
      ...(escapeHint === undefined ? [] : [keyHint('dismiss', 'Esc', 'back', 90)]),
    ]
  }
  if (state.pendingConfirmation === active.key) {
    return [keyHint('activate', 'Enter', 'confirm', 100), keyHint('dismiss', 'Esc', 'cancel', 95)]
  }
  if (active.kind === 'text' && state.editingKey === active.key) {
    return [
      ...(active.field.kind === 'textarea' ? [keyHint('newline', 'Alt+Enter', 'newline', 90)] : []),
      keyHint('activate', 'Enter', 'finish', 100),
      keyHint('dismiss', 'Esc', 'leave', 95),
      ...(groupOrder(controls).length > 1 ? [keyHint('group', 'Tab/Shift-Tab', 'groups', 80, 'Tab')] : []),
    ]
  }
  if (active.kind === 'select' && state.editingKey === active.key) {
    const optionCount = active.field.options.filter(option => option.disabled !== true).length
    return [
      ...(optionCount > 1 ? [keyHint('navigate', '←→', 'options', 90)] : []),
      keyHint('activate', 'Enter', 'apply', 100),
      keyHint('dismiss', 'Esc', 'cancel', 95),
      ...(groupOrder(controls).length > 1 ? [keyHint('group', 'Tab/Shift-Tab', 'groups', 80, 'Tab')] : []),
    ]
  }

  const siblings = controls.filter(control => control.group === active.group)
  const movement = siblings.length <= 1 && groupOrder(controls).length <= 1
    ? []
    : [keyHint(
        'navigate',
        active.kind === 'event' && active.role === 'tab' ? '←→' : '↑↓←→',
        active.kind === 'event' && active.role === 'tab'
          ? 'tabs'
          : active.kind === 'event' && active.role === 'action'
            ? 'actions'
            : active.kind === 'text' || active.kind === 'select' || active.kind === 'toggle'
              ? 'fields'
              : 'options',
        90,
      )]
  const primary = active.kind === 'text'
    ? keyHint('activate', 'Enter', 'edit', 100)
    : active.kind === 'select'
      ? keyHint('activate', 'Enter', 'adjust', 100)
      : active.kind === 'toggle'
        ? keyHint('activate', 'Space/Enter', 'toggle', 100, 'Enter')
        : active.kind === 'submit'
          ? keyHint('activate', 'Enter', 'submit', 100)
          : active.role === 'tab'
            ? keyHint('activate', 'Enter', 'open', 100)
            : active.role === 'list-single'
              ? keyHint('activate', 'Enter', 'choose', 100)
              : active.role === 'list-multiple'
                ? keyHint('activate', 'Space / Enter', 'toggle / confirm', 100, 'Space/Enter')
                : active.role === 'cancel'
                  ? keyHint('activate', 'Enter', 'cancel', 100)
                  : keyHint('activate', 'Enter', 'run', 100)
  return [
    ...movement,
    primary,
    ...(active.kind === 'event' && active.role === 'tab' ? [] : groupOrder(controls).length > 1 ? [keyHint('group', 'Tab/Shift-Tab', 'groups', 80, 'Tab')] : []),
    ...(escapeHint === undefined ? [] : [keyHint('dismiss', 'Esc', escapeHint, 70)]),
  ]
}

function contextualKeyHints(state: FocusState, options: RuntimeCompilerOptions, controls: readonly ControlDescriptor[], active: ControlDescriptor | undefined, escapeHint: 'close' | 'leave' | undefined): ContextKeyHint[] {
  const merged = new Map(automaticContextKeyHints(state, options, controls, active, escapeHint).map(hint => [hint.id, hint]))
  let extra: readonly { readonly id: string, readonly keys: string, readonly label?: string, readonly compact?: string, readonly priority?: number }[] = []
  try { extra = options.contextHints?.extra?.() ?? [] } catch { /* official hint providers cannot break their panel */ }
  for (const hint of extra) {
    if (hint.id.length === 0 || hint.keys.length === 0) continue
    merged.set(hint.id, {
      id: hint.id,
      keys: hint.keys,
      label: hint.label,
      compact: hint.compact ?? hint.keys,
      priority: hint.priority ?? 75,
    })
  }
  const indexed = [...merged.values()].map((hint, index) => ({ hint, index }))
  const admitted = new Set(indexed
    .toSorted((left, right) => right.hint.priority - left.hint.priority || left.index - right.index)
    .slice(0, 3)
    .map(entry => entry.hint.id))
  const displayOrder = (id: string): number => {
    if (id === 'navigate') return 10
    if (id === 'activate') return 20
    if (id === 'confirm') return 30
    if (id === 'group') return 40
    if (id === 'dismiss') return 50
    return 25
  }
  return indexed
    .filter(entry => admitted.has(entry.hint.id))
    .toSorted((left, right) => displayOrder(left.hint.id) - displayOrder(right.hint.id) || left.index - right.index)
    .map(entry => entry.hint)
}

function contextKeyHintRows(state: FocusState, options: RuntimeCompilerOptions, width: number, escapeHint: 'close' | 'leave' | undefined): string[] {
  if (!state.focused) return []
  const controls = reconcile(state)
  const parts = contextualKeyHints(state, options, controls, controls[state.lastIndex], escapeHint)
  if (parts.length === 0) return []
  const translate = (key: string): string => {
    try { return options.contextHints?.translate?.(key) ?? key } catch { return key }
  }
  const candidates: string[][] = []
  for (let count = parts.length; count > 0; count -= 1) {
    const retained = new Set(parts
      .map((part, index) => ({ part, index }))
      .toSorted((left, right) => right.part.priority - left.part.priority || left.index - right.index)
      .slice(0, count)
      .map(entry => entry.part.id))
    const candidate = parts.filter(part => retained.has(part.id))
    candidates.push(
      candidate.map(part => part.label === undefined ? part.keys : `${part.keys} ${translate(part.label)}`),
      candidate.map(part => part.compact),
    )
  }
  const safeWidth = Math.max(1, Math.floor(width))
  for (const candidate of candidates) {
    const row = hintRow(candidate, options.colors.textMuted)
    if (visibleWidth(row) <= safeWidth) return [row]
  }
  return []
}

function contextKeyHintComponent(state: FocusState, options: RuntimeCompilerOptions, escapeHint: 'close' | 'leave' | undefined): Component {
  return staticComponent(width => contextKeyHintRows(state, options, width, escapeHint), options)
}

function beginsTextEditing(data: string): boolean {
  if (/^\x1b\[200~[\s\S]*\x1b\[201~$/u.test(data)) return true
  return /^[^\x00-\x1f\x7f-\x9f]+$/u.test(data)
}

interface TextEditorLease {
  readonly editor: BlueEditor
  onChange: BlueEditor['onChange']
  onSubmit: BlueEditor['onSubmit']
}

interface SelectDraft {
  readonly canonical: string | null
  readonly value: string | null
  readonly editingOrigin: string | null | undefined
}

function detachTextEditorCallbacks(lease: TextEditorLease): void {
  if (lease.onChange !== undefined && lease.editor.onChange === lease.onChange) lease.editor.onChange = undefined
  if (lease.onSubmit !== undefined && lease.editor.onSubmit === lease.onSubmit) lease.editor.onSubmit = undefined
  lease.onChange = undefined
  lease.onSubmit = undefined
}

function releaseTextEditor(lease: TextEditorLease): void {
  lease.editor.focused = false
  detachTextEditorCallbacks(lease)
}

function controlsForNode(node: CompilableNode, options: BlueUiCompilerOptions, path = '$', includeHidden = false): ControlDescriptor[] {
  const controls: ControlDescriptor[] = []
  const visit = (current: CompilableNode, currentPath: string): void => {
    switch (current.kind) {
      case 'editor-control':
        controls.push({ kind: 'editor', key: controlKey('editor', 'editor-control'), renderKey: 'editor-control', identity: focusIdentity('editor-control'), preferred: true, group: controlGroup('editor', 'editor-control'), navigation: 'none' })
        break
      case 'stack':
        for (const [index, child] of current.children.entries()) {
          if (includeHidden || conditionMatches(child.when, safeViewport(options.getViewport))) visit(child.node, `${currentPath}.${String(index)}`)
        }
        break
      case 'surface':
        visit(current.child, `${currentPath}.child`)
        if (current.footer !== undefined) visit(current.footer, `${currentPath}.footer`)
        break
      case 'scroll': {
        const before = controls.length
        visit(current.child, `${currentPath}.scroll`)
        const mainWindow = options.screenMode === 'main'
          && options.leafRowWindowPath?.startsWith(`${currentPath}.scroll`) === true
        if (controls.length === before && (options.screenMode === 'alternate' || mainWindow)) {
          const key = controlKey('scroll', currentPath)
          controls.push({ kind: 'scroll', key, renderKey: currentPath, identity: focusIdentity(key), preferred: true, group: controlGroup('scroll', currentPath), navigation: 'none' })
        }
        break
      }
      case 'tabs':
        for (const item of current.items) if (item.disabled !== true) controls.push({ kind: 'event', role: 'tab', activation: 'enter', key: controlKey('tabs', current.id, item.id), renderKey: item.id, identity: focusIdentity(current.id, item.id), preferred: item.id === current.activeId, group: controlGroup('tabs', current.id), navigation: 'horizontal', event: { kind: 'tab-change', controlId: current.id, tabId: item.id } })
        break
      case 'list':
        for (const item of current.items) if (item.disabled !== true) {
          const value = current.mode === 'multiple'
            ? current.selectedIds.includes(item.id) ? current.selectedIds.filter(id => id !== item.id) : [...current.selectedIds, item.id]
            : item.id
          controls.push({
            kind: 'event',
            role: current.mode === 'multiple' ? 'list-multiple' : 'list-single',
            activation: current.mode === 'multiple' ? 'space' : 'enter',
            key: controlKey('list', current.id, item.id),
            renderKey: item.id,
            identity: focusIdentity(current.id, item.id),
            preferred: current.selectedIds.includes(item.id),
            group: controlGroup('list', current.id),
            navigation: 'vertical',
            event: { kind: 'selection-change', controlId: current.id, value },
            ...(current.mode === 'multiple' ? { commitEvent: { kind: 'selection-change', controlId: current.id, value: current.selectedIds } as BlueUiEvent } : {}),
          })
        }
        if (current.items.length === 0 && current.empty !== undefined) visit(current.empty, `${currentPath}.empty`)
        break
      case 'form':
        for (const field of current.fields) if (field.disabled !== true) {
          const base: ControlBase = { key: controlKey('form-field', current.id, field.id), renderKey: field.id, identity: focusIdentity(field.id), preferred: false, group: controlGroup('form', current.id), navigation: 'vertical' }
          if (field.kind === 'toggle') controls.push({ ...base, kind: 'toggle', field })
          else if (field.kind === 'select') controls.push({ ...base, kind: 'select', field })
          else controls.push({ ...base, kind: 'text', field })
        }
        if (current.submitActionId !== undefined) controls.push({ kind: 'submit', key: controlKey('form-submit', current.id), renderKey: 'submit', identity: focusIdentity(current.submitActionId), preferred: false, group: controlGroup('form', current.id), navigation: 'vertical', form: current })
        if (current.cancelActionId !== undefined) controls.push({ kind: 'event', role: 'cancel', activation: 'both', key: controlKey('form-cancel', current.id), renderKey: 'cancel', identity: focusIdentity(current.cancelActionId), preferred: false, group: controlGroup('form', current.id), navigation: 'vertical', event: { kind: 'activate', controlId: current.cancelActionId } })
        break
      case 'actions':
        for (const item of current.items) if (item.disabled !== true && item.busy !== true) controls.push({ kind: 'event', role: 'action', activation: 'both', key: controlKey('action', current.id, item.id), renderKey: item.id, identity: focusIdentity(item.id), preferred: item.intent === 'primary', group: actionGroup(current), navigation: 'horizontal', event: { kind: 'activate', controlId: item.id }, ...(item.confirm === undefined ? {} : { confirm: item.confirm }) })
        break
      case 'loader':
        if (current.cancelActionId !== undefined) controls.push({ kind: 'event', role: 'cancel', activation: 'both', key: controlKey('loader-cancel', current.cancelActionId), renderKey: 'cancel', identity: focusIdentity(current.cancelActionId), preferred: false, group: controlGroup('loader', current.cancelActionId!), navigation: 'none', event: { kind: 'activate', controlId: current.cancelActionId } })
        break
      case 'empty': if (current.actions !== undefined) visit(current.actions, `${currentPath}.actions`); break
      default: break
    }
  }
  visit(node, path)
  return controls
}

function compileNode(node: CompilableNode, state: FocusState, options: RuntimeCompilerOptions, path = '$', mode: CompilerMode = 'ui', contextHint?: Component): Component {
  switch (node.kind) {
    case 'editor-control': {
      const editor = options.editor
      if (editor === undefined) throw new Error('editor-control requires a host editor')
      const component: BlueComponent = {
        render: width => {
          try {
            editor.focused = state.focused && state.activeKey === controlKey('editor', 'editor-control')
            return editor.render(Math.max(1, width))
          } catch (error) {
            const message = renderFailure(error, 'unknown editor failure')
            options.reportRuntimeFailure(message)
            return errorRows(message, width, options.colors)
          }
        },
        invalidate: () => editor.invalidate(),
      }
      state.bindControls([controlKey('editor', 'editor-control')], { component, axis: 'none' })
      return component
    }
    case 'text': if (options.markdownLeafPath === path) return markdownLeafComponent(node, path, options)
      return staticComponent(width => windowLeafRows(renderCanonicalView(
        node,
        width,
        options.components,
        options.colors,
        Number.MAX_SAFE_INTEGER,
      ), path, options), options)
    case 'fields':
    case 'code':
    case 'diff':
    case 'sections': return staticComponent(width => windowLeafRows(renderCanonicalView(
      node as BlueView,
      width,
      options.components,
      options.colors,
      Number.MAX_SAFE_INTEGER,
    ), path, options), options)
    case 'rich-text': return staticComponent(width => windowLeafRows(
      options.components.wrapText(joinSpans(node, options.colors), Math.max(1, width)),
      path,
      options,
    ), options)
    case 'stack': {
      const stackOptions = {
        ...(node.gap === undefined ? {} : { gap: node.gap }),
        ...(node.align === undefined ? {} : { align: node.align }),
      }
      const spatial = mode === 'status' || options.screenMode === 'alternate'
      const stack = !spatial || node.direction === 'column'
        ? new VStack([], stackOptions)
        : new HStack([], stackOptions)
      for (const [index, child] of node.children.entries()) {
        const compiled = compileNode(child.node, state, options, `${path}.${String(index)}`, mode)
        const layout = !spatial
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
    case 'surface': return surfaceComponent(node, compileNode(node.child, state, options, `${path}.child`, mode), node.footer === undefined ? undefined : compileNode(node.footer, state, options, `${path}.footer`, mode), contextHint, options)
    case 'scroll': {
      const childPath = `${path}.scroll`
      if (options.screenMode === 'main') {
        if (options.leafRowWindowPath?.startsWith(childPath) !== true) return compileNode(node.child, state, options, childPath, mode)
        const scroll = new MainLeafScrollControl(options.onLeafRowScroll, options.leafRowOffset, options.maxLeafRows)
        const child = compileNode(node.child, state, {
          ...options,
          onLeafRowOffset: (offset, totalRows, limit) => {
            scroll.update(offset, totalRows, limit)
            options.onLeafRowOffset?.(offset, totalRows, limit)
          },
        }, childPath, mode)
        const key = controlKey('scroll', path)
        state.bindControls([key], { component: child, axis: 'none' })
        state.bindScroll(key, scroll)
        return child
      }
      const child = compileNode(node.child, state, options, childPath, mode)
      const scroll = new ScrollView(child, { follow: node.follow === 'end' ? 'end' : 'none', primary: false, overscroll: 'contain', scrollbar: node.scrollbar === true ? 'auto' : 'hidden' })
      const key = controlKey('scroll', path)
      state.bindControls([key], { component: scroll, axis: 'none' })
      state.bindScroll(key, scroll)
      return scroll
    }
    case 'tabs': {
      const component = staticComponent(width => renderTabs(node, width, patternFocus(state, controlGroup('tabs', node.id)), options.colors), options)
      state.bindControls(node.items.filter(item => item.disabled !== true).map(item => controlKey('tabs', node.id, item.id)), { component, axis: 'horizontal' })
      return component
    }
    case 'list': {
      if (node.items.length === 0) return node.empty === undefined ? staticComponent(() => [], options) : compileNode(node.empty, state, options, `${path}.empty`, mode)
      const component = staticComponent(width => renderList(node, width, options.screenMode === 'main' ? options.maxLeafRows ?? Number.MAX_SAFE_INTEGER : safeViewport(options.getViewport).rows, patternFocus(state, controlGroup('list', node.id)), options.colors), options)
      state.bindControls(node.items.filter(item => item.disabled !== true).map(item => controlKey('list', node.id, item.id)), { component, axis: 'vertical' })
      return component
    }
    case 'form': {
      const stack = new VStack()
      for (const field of node.fields) {
        const key = controlKey('form-field', node.id, field.id)
        const component = field.kind === 'input' || field.kind === 'textarea' || field.kind === 'secret'
          ? editorFieldComponent(field, key, state, options)
          : staticComponent(width => renderFormField(state.field(field, key), width, patternFocus(state, controlGroup('form', node.id)), options.colors), options)
        stack.addChild(component)
        if (field.disabled !== true) state.bindControls([key], { component, axis: 'none' })
      }
      if (node.submitActionId !== undefined) {
        const component = staticComponent(width => renderActions({ kind: 'actions', id: node.id, items: [{ id: 'submit', label: node.submitActionId!, intent: 'primary' }] }, width, patternFocus(state, controlGroup('form', node.id)), options.colors, true), options)
        stack.addChild(component)
        state.bindControls([controlKey('form-submit', node.id)], { component, axis: 'none' })
      }
      if (node.cancelActionId !== undefined) {
        const component = staticComponent(width => renderActions({ kind: 'actions', id: node.id, items: [{ id: 'cancel', label: node.cancelActionId! }] }, width, patternFocus(state, controlGroup('form', node.id)), options.colors, true), options)
        stack.addChild(component)
        state.bindControls([controlKey('form-cancel', node.id)], { component, axis: 'none' })
      }
      return stack
    }
    case 'actions': {
      const vertical = options.screenMode === 'main'
      const component = staticComponent(width => renderActions(node, width, patternFocus(state, actionGroup(node)), options.colors, vertical), options)
      state.bindControls(node.items.filter(item => item.disabled !== true && item.busy !== true).map(item => controlKey('action', node.id, item.id)), { component, axis: vertical ? 'vertical' : 'horizontal' })
      return component
    }
    case 'loader': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => renderLoader(node, width, options.colors), options))
      const cancelActionId = node.cancelActionId
      if (cancelActionId !== undefined) {
        const component = staticComponent(width => renderActions({ kind: 'actions', id: cancelActionId, items: [{ id: 'cancel', label: cancelActionId }] }, width, patternFocus(state, controlGroup('loader', cancelActionId)), options.colors, true), options)
        stack.addChild(component)
        state.bindControls([controlKey('loader-cancel', cancelActionId)], { component, axis: 'none' })
      }
      return stack
    }
    case 'empty': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => renderEmpty(node, width, options.colors), options))
      if (node.actions !== undefined) stack.addChild(compileNode(node.actions, state, options, `${path}.actions`, mode))
      return stack
    }
    case 'progress': return staticComponent(width => renderProgress(node, width, options.colors), options)
    case 'spacer': return staticComponent(() => Array.from({ length: node.size ?? 1 }, () => ''), options)
    case 'divider': return staticComponent(width => renderDivider(node.label, width, options.colors), options)
  }
}

function reconcile(state: FocusState): readonly ControlDescriptor[] {
  const controls = state.controls()
  const groups = controlGroups(controls)
  const tabGroups = groups.filter(group => group.kind === 'tabs')
  state.blurInactiveEditors(controls)
  const allControls = state.allControls()
  const allKeys = new Set(allControls.map(control => control.key))
  for (const [group, key] of state.groupActiveKeys) {
    if (!allControls.some(control => control.group === group && control.key === key)) state.groupActiveKeys.delete(group)
  }
  if (state.editingKey !== undefined && !allKeys.has(state.editingKey)) state.setEditing(undefined)
  if (state.desiredKey !== undefined && !allControls.some(control => control.key === state.desiredKey)) {
    state.desiredKey = undefined
    state.desiredGroup = undefined
  }
  if (controls.length === 0) {
    if (state.desiredKey === undefined) {
      state.activeKey = undefined
      state.activeGroup = undefined
    }
    state.pendingConfirmation = undefined
    state.lastIndex = 0
    state.lastTabGroupIndex = 0
    for (const scroll of state.scrollViews.values()) scroll.setScrollbarActive(false)
    return controls
  }
  state.lastTabGroupIndex = Math.min(state.lastTabGroupIndex, Math.max(0, tabGroups.length - 1))
  const syncScrollFocus = (): void => {
    for (const [key, scroll] of state.scrollViews) scroll.setScrollbarActive(state.focused && key === state.activeKey)
  }
  const rememberTabGroup = (control: ControlDescriptor): void => {
    const index = tabGroups.findIndex(group => group.id === control.group)
    if (index >= 0) state.lastTabGroupIndex = index
  }
  const desired = controls.findIndex(control => control.key === state.desiredKey)
  if (desired >= 0) {
    state.lastIndex = desired
    state.activeKey = controls[desired]!.key
    state.activeGroup = controls[desired]!.group
    state.groupActiveKeys.set(controls[desired]!.group, controls[desired]!.key)
    rememberTabGroup(controls[desired]!)
    syncScrollFocus()
    return controls
  }
  const desiredHidden = state.desiredKey !== undefined && allControls.some(control => control.key === state.desiredKey)
  const current = controls.findIndex(control => control.key === state.activeKey)
  if (current >= 0) {
    state.lastIndex = current
    state.activeGroup = controls[current]!.group
    if (state.desiredKey === undefined) {
      state.desiredKey = controls[current]!.key
      state.desiredGroup = controls[current]!.group
    }
    if (!desiredHidden) state.groupActiveKeys.set(controls[current]!.group, controls[current]!.key)
    rememberTabGroup(controls[current]!)
    syncScrollFocus()
    return controls
  }
  const groupIds = groups.map(group => group.id)
  const requestedGroup = desiredHidden ? state.desiredGroup : state.activeGroup
  const fallbackGroup = requestedGroup !== undefined && groupIds.includes(requestedGroup)
    ? requestedGroup
    : groupIds[0]!
  state.lastIndex = groupTarget(controls, fallbackGroup, state.groupActiveKeys.get(fallbackGroup))
  state.pendingConfirmation = undefined
  state.activeKey = controls[state.lastIndex]!.key
  state.activeGroup = controls[state.lastIndex]!.group
  if (!desiredHidden) {
    state.desiredKey = state.activeKey
    state.desiredGroup = state.activeGroup
    state.groupActiveKeys.set(state.activeGroup, state.activeKey)
  }
  rememberTabGroup(controls[state.lastIndex]!)
  syncScrollFocus()
  return controls
}

type NavigationDirection = 'up' | 'down' | 'left' | 'right'

function intersectRect(rect: LayoutRect, clip: LayoutRect): LayoutRect | undefined {
  const x = Math.max(rect.x, clip.x)
  const y = Math.max(rect.y, clip.y)
  const right = Math.min(rect.x + rect.width, clip.x + clip.width)
  const bottom = Math.min(rect.y + rect.height, clip.y + clip.height)
  return right <= x || bottom <= y ? undefined : { x, y, width: right - x, height: bottom - y }
}

function layoutBoxes(root: LayoutBox): Map<Component, LayoutRect> {
  const boxes = new Map<Component, LayoutRect>()
  const visit = (box: LayoutBox): void => {
    const visible = intersectRect(box.rect, box.clip)
    if (visible !== undefined) boxes.set(box.component, visible)
    for (const child of box.children) visit(child)
  }
  visit(root)
  return boxes
}

function divideRect(rect: LayoutRect, axis: ControlBinding['axis'], index: number, count: number): LayoutRect {
  if (axis === 'horizontal' && count > 1) {
    const start = Math.floor(rect.width * index / count)
    const end = Math.floor(rect.width * (index + 1) / count)
    return { x: rect.x + start, y: rect.y, width: Math.max(1, end - start), height: rect.height }
  }
  if (axis === 'vertical' && count > 1) {
    const start = Math.floor(rect.height * index / count)
    const end = Math.floor(rect.height * (index + 1) / count)
    return { x: rect.x, y: rect.y + start, width: rect.width, height: Math.max(1, end - start) }
  }
  return rect
}

function nearestDirectionalControl(
  controls: readonly ControlDescriptor[],
  rectangles: ReadonlyMap<string, LayoutRect>,
  activeIndex: number,
  direction: NavigationDirection,
): number | undefined {
  const active = rectangles.get(controls[activeIndex]!.key)
  if (active === undefined) return undefined
  const activeCenterX = active.x + active.width / 2
  const activeCenterY = active.y + active.height / 2
  const candidates = controls.flatMap((control, index) => {
    if (index === activeIndex || (control.kind === 'event' && control.role === 'tab')) return []
    const rect = rectangles.get(control.key)
    if (rect === undefined) return []
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const eligible = direction === 'left' ? centerX < activeCenterX
      : direction === 'right' ? centerX > activeCenterX
        : direction === 'up' ? centerY < activeCenterY
          : centerY > activeCenterY
    if (!eligible) return []
    const horizontal = direction === 'left' || direction === 'right'
    const overlap = horizontal
      ? Math.min(active.y + active.height, rect.y + rect.height) > Math.max(active.y, rect.y)
      : Math.min(active.x + active.width, rect.x + rect.width) > Math.max(active.x, rect.x)
    const primary = horizontal ? Math.abs(centerX - activeCenterX) : Math.abs(centerY - activeCenterY)
    const secondary = horizontal ? Math.abs(centerY - activeCenterY) : Math.abs(centerX - activeCenterX)
    return [{ index, overlap, primary, secondary }]
  })
  return candidates
    .toSorted((left, right) => left.index - right.index)
    .toSorted((left, right) => left.secondary - right.secondary)
    .toSorted((left, right) => left.primary - right.primary)
    .toSorted((left, right) => Number(right.overlap) - Number(left.overlap))[0]?.index
}

/**
 * Renderer-private state shared by every compiled projection of one mounted
 * plugin surface. The bridge owns its lifetime; canonical nodes remain plain
 * readonly data and never receive this object.
 */
export class BlueUiSurfaceRuntime {
  private node: CompilableNode | undefined
  private options: RuntimeCompilerOptions | undefined
  private layoutViewport: ((viewport: BlueUiViewport) => void) | undefined
  private generation = 0
  private live = true
  private readonly textBuffers = new Map<string, { canonical: string, value: string }>()
  private readonly selectDrafts = new Map<string, SelectDraft>()
  private readonly toggleDrafts = new Map<string, { canonical: boolean, value: boolean }>()
  private readonly textEditors = new Map<string, TextEditorLease>()
  private readonly editorFocusCheckpoints: Map<BlueEditor, boolean>[] = []
  private readonly fieldKinds = new Map<string, BlueFormField['kind']>()
  private readonly fieldOwners = new Map<string, string>()
  private readonly fieldRecency = new Map<string, true>()
  private readonly controlBindings = new Map<string, ControlBinding>()
  private readonly scrollViews = new Map<string, ScrollControl>()
  readonly state: FocusState

  constructor() {
    const fieldValue = (field: BlueFormField, key: string): string | boolean | null => {
      const stateKey = fieldStateKey(key, field.kind)
      if (field.kind === 'toggle') {
        const current = this.toggleDrafts.get(stateKey)
        if (current !== undefined && current.canonical === field.value) return current.value
        this.toggleDrafts.set(stateKey, { canonical: field.value, value: field.value })
        return field.value
      }
      if (field.kind === 'select') {
        const current = this.selectDrafts.get(stateKey)
        if (current !== undefined && current.canonical === field.value) return current.value
        this.selectDrafts.set(stateKey, { canonical: field.value, value: field.value, editingOrigin: undefined })
        return field.value
      }
      const current = this.textBuffers.get(stateKey)
      if (current !== undefined && current.canonical === field.value) return current.value
      this.textBuffers.set(stateKey, { canonical: field.value, value: field.value })
      return field.value
    }
    this.state = {
      activeKey: undefined,
      activeGroup: undefined,
      desiredKey: undefined,
      desiredGroup: undefined,
      editingKey: undefined,
      groupActiveKeys: new Map(),
      controlBindings: this.controlBindings,
      scrollViews: this.scrollViews,
      lastTabGroupIndex: 0,
      lastIndex: 0,
      focused: false,
      layoutPass: false,
      pendingConfirmation: undefined,
      controls: () => this.node === undefined || this.options === undefined ? [] : controlsForNode(this.node, this.options),
      allControls: () => this.node === undefined || this.options === undefined ? [] : controlsForNode(this.node, this.options, '$', true),
      emit: event => {
        if (!this.live) return
        try { this.options?.emit(event) } catch { /* event failures are host-owned */ }
      },
      field: (field, key) => ({ ...field, value: fieldValue(field, key) } as BlueFormField),
      fieldValue,
      setTextValue: (key, canonical, value) => { this.textBuffers.set(key, { canonical, value }) },
      textEditor: (field, key) => this.textEditor(field, key),
      setSelectValue: (key, canonical, value) => {
        const current = this.selectDrafts.get(key)
        this.selectDrafts.set(key, {
          canonical,
          value,
          editingOrigin: current?.editingOrigin,
        })
      },
      beginSelectEditing: (field, key) => {
        const stateKey = fieldStateKey(key, field.kind)
        const value = fieldValue(field, key) as string | null
        this.state.setEditing(key)
        this.selectDrafts.set(stateKey, { canonical: field.value, value, editingOrigin: value })
      },
      finishSelectEditing: (field, key, cancel) => {
        const stateKey = fieldStateKey(key, field.kind)
        const current = this.selectDrafts.get(stateKey)
        const candidate = current?.value ?? field.value
        const value = cancel && current?.editingOrigin !== undefined
          ? current.editingOrigin
          : candidate
        this.selectDrafts.set(stateKey, { canonical: field.value, value, editingOrigin: undefined })
        this.state.setEditing(undefined)
        return value
      },
      setToggleValue: (key, canonical, value) => { this.toggleDrafts.set(key, { canonical, value }) },
      setEditing: key => {
        if (this.state.editingKey === key) return
        if (this.state.editingKey !== undefined) {
          const stateKey = fieldStateKey(this.state.editingKey, 'select')
          const current = this.selectDrafts.get(stateKey)
          if (current?.editingOrigin !== undefined) {
            this.selectDrafts.set(stateKey, { canonical: current.canonical, value: current.editingOrigin, editingOrigin: undefined })
          }
        }
        this.state.editingKey = key
        for (const lease of this.textEditors.values()) lease.editor.focused = false
      },
      blurInactiveEditors: controls => {
        const visible = new Set(controls.flatMap(control => control.kind === 'text'
          ? [fieldStateKey(control.key, control.field.kind)]
          : []))
        for (const [stateKey, lease] of this.textEditors) if (!visible.has(stateKey)) lease.editor.focused = false
      },
      setLayoutViewport: viewport => { this.layoutViewport?.(viewport) },
      bindControls: (keys, binding) => { for (const key of keys) this.controlBindings.set(key, binding) },
      bindScroll: (key, scroll) => { this.scrollViews.set(key, scroll) },
    }
  }

  bind(node: CompilableNode, options: RuntimeCompilerOptions, refreshMode: 'internal' | 'external', setLayoutViewport: (viewport: BlueUiViewport) => void): number {
    if (!this.live) throw new Error('surface runtime is disposed')
    if (refreshMode === 'external') {
      if (this.state.editingKey !== undefined && this.fieldKinds.get(this.state.editingKey) === 'select') this.state.setEditing(undefined)
      this.textBuffers.clear()
      this.selectDrafts.clear()
      this.toggleDrafts.clear()
      this.state.pendingConfirmation = undefined
    }
    this.node = node
    this.options = options
    this.layoutViewport = setLayoutViewport
    this.controlBindings.clear()
    this.scrollViews.clear()
    this.generation += 1
    return this.generation
  }

  current(generation: number): boolean { return this.live && generation === this.generation }

  setFocused(value: boolean): void {
    this.state.focused = value
    if (!value) for (const lease of this.textEditors.values()) lease.editor.focused = false
  }

  checkpoint(): () => void {
    const node = this.node
    const options = this.options
    const layoutViewport = this.layoutViewport
    const generation = this.generation
    const focus = {
      activeKey: this.state.activeKey,
      activeGroup: this.state.activeGroup,
      desiredKey: this.state.desiredKey,
      desiredGroup: this.state.desiredGroup,
      editingKey: this.state.editingKey,
      lastIndex: this.state.lastIndex,
      focused: this.state.focused,
      layoutPass: this.state.layoutPass,
      pendingConfirmation: this.state.pendingConfirmation,
      lastTabGroupIndex: this.state.lastTabGroupIndex,
    }
    const textBuffers = new Map(this.textBuffers)
    const selectDrafts = new Map(this.selectDrafts)
    const toggleDrafts = new Map(this.toggleDrafts)
    const groupActiveKeys = new Map(this.state.groupActiveKeys)
    const controlBindings = new Map(this.controlBindings)
    const scrollViews = new Map(this.scrollViews)
    return () => {
      this.node = node
      this.options = options
      this.layoutViewport = layoutViewport
      this.generation = generation
      Object.assign(this.state, focus)
      this.textBuffers.clear(); for (const [key, value] of textBuffers) this.textBuffers.set(key, value)
      this.selectDrafts.clear(); for (const [key, value] of selectDrafts) this.selectDrafts.set(key, value)
      this.toggleDrafts.clear(); for (const [key, value] of toggleDrafts) this.toggleDrafts.set(key, value)
      this.state.groupActiveKeys.clear(); for (const [key, value] of groupActiveKeys) this.state.groupActiveKeys.set(key, value)
      this.controlBindings.clear(); for (const [key, value] of controlBindings) this.controlBindings.set(key, value)
      this.scrollViews.clear(); for (const [key, value] of scrollViews) this.scrollViews.set(key, value)
    }
  }

  checkpointEditorFocus(): () => void {
    const focused = new Map([...this.textEditors.values()].map(lease => [lease.editor, lease.editor.focused]))
    this.editorFocusCheckpoints.push(focused)
    let restored = false
    return () => {
      if (restored) return
      restored = true
      const index = this.editorFocusCheckpoints.lastIndexOf(focused)
      this.editorFocusCheckpoints.splice(index, 1)
      for (const [editor, value] of focused) editor.focused = value
    }
  }

  /** Retain recent inactive fields while bounding registration-owned renderer state. */
  admit(node: CompilableNode): void {
    const active = new Set<string>()
    const evict = (stateKey: string): void => {
      this.textBuffers.delete(stateKey)
      this.selectDrafts.delete(stateKey)
      this.toggleDrafts.delete(stateKey)
      const lease = this.textEditors.get(stateKey)
      if (lease !== undefined) {
        releaseTextEditor(lease)
        this.textEditors.delete(stateKey)
      }
      const owner = this.fieldOwners.get(stateKey)!
      if (this.state.editingKey === owner) this.state.setEditing(undefined)
      this.fieldKinds.delete(owner)
      this.fieldOwners.delete(stateKey)
      this.fieldRecency.delete(stateKey)
    }
    const touch = (key: string, field: BlueFormField): void => {
      const previousKind = this.fieldKinds.get(key)
      if (previousKind !== undefined && previousKind !== field.kind) evict(fieldStateKey(key, previousKind))
      const stateKey = fieldStateKey(key, field.kind)
      this.fieldKinds.set(key, field.kind)
      this.fieldOwners.set(stateKey, key)
      this.fieldRecency.delete(stateKey)
      this.fieldRecency.set(stateKey, true)
      active.add(stateKey)
    }
    const visit = (current: CompilableNode): void => {
      switch (current.kind) {
        case 'stack': for (const child of current.children) visit(child.node); break
        case 'surface': visit(current.child); if (current.footer !== undefined) visit(current.footer); break
        case 'scroll': visit(current.child); break
        case 'list': if (current.empty !== undefined) visit(current.empty); break
        case 'form': for (const field of current.fields) touch(controlKey('form-field', current.id, field.id), field); break
        case 'empty': if (current.actions !== undefined) visit(current.actions); break
        default: break
      }
    }
    visit(node)
    for (const [stateKey, lease] of this.textEditors) if (!active.has(stateKey)) lease.editor.focused = false
    let inactive = this.fieldRecency.size - active.size
    // Every active key was just touched and therefore sits after all inactive keys.
    for (const stateKey of this.fieldRecency.keys()) {
      if (inactive <= INACTIVE_FIELD_CACHE_LIMIT) break
      evict(stateKey)
      inactive -= 1
    }
  }

  deactivate(): void {
    if (!this.live) return
    this.generation += 1
    this.node = undefined
    this.options = undefined
    this.layoutViewport = undefined
    this.setFocused(false)
    this.state.pendingConfirmation = undefined
    for (const lease of this.textEditors.values()) releaseTextEditor(lease)
  }

  dispose(): void {
    if (!this.live) return
    this.deactivate()
    this.live = false
    for (const lease of this.textEditors.values()) releaseTextEditor(lease)
    this.textEditors.clear()
    this.textBuffers.clear()
    this.selectDrafts.clear()
    this.toggleDrafts.clear()
    this.fieldKinds.clear()
    this.fieldOwners.clear()
    this.fieldRecency.clear()
    this.controlBindings.clear()
    this.scrollViews.clear()
    this.state.activeKey = undefined
    this.state.activeGroup = undefined
    this.state.desiredKey = undefined
    this.state.desiredGroup = undefined
    this.state.setEditing(undefined)
    this.state.groupActiveKeys.clear()
    this.state.lastIndex = 0
    this.state.lastTabGroupIndex = 0
  }

  private textEditor(field: TextField, key: string): BlueEditor {
    const options = this.options
    if (options === undefined) throw new Error('surface runtime is inactive')
    const stateKey = fieldStateKey(key, field.kind)
    const previous = this.textEditors.get(stateKey)
    let editor = options.resolveTextEditor?.(field.id, stateKey) ?? previous?.editor
    if (editor === undefined) {
      editor = options.components.createEditor()
    }
    for (const checkpoint of this.editorFocusCheckpoints) {
      if (!checkpoint.has(editor)) checkpoint.set(editor, editor.focused)
    }
    let lease = previous
    if (lease === undefined || lease.editor !== editor) {
      if (lease !== undefined) releaseTextEditor(lease)
      lease = { editor, onChange: undefined, onSubmit: undefined }
      this.textEditors.set(stateKey, lease)
    } else {
      detachTextEditorCallbacks(lease)
    }
    const controlled = String(this.state.fieldValue(field, key))
    if (editor.getExpandedText() !== controlled) {
      editor.onChange = undefined
      editor.setText(controlled)
    }
    editor.disableSubmit = false
    const onChange = (): void => {
      if (!this.live || this.options !== options || editor.onChange !== onChange) return
      const value = editor!.getExpandedText()
      this.state.setTextValue(stateKey, field.value, value)
      this.state.emit({ kind: 'value-change', controlId: field.id, value })
    }
    const onSubmit = (value: string): void => {
      if (!this.live || this.options !== options || editor.onSubmit !== onSubmit) return
      this.state.setTextValue(stateKey, field.value, value)
      if (this.state.editingKey === key) this.state.setEditing(undefined)
      this.state.emit({ kind: 'value-change', controlId: field.id, value })
      try { options.onTextSubmit?.(field.id, value) } catch { /* official submit observers cannot escape input */ }
    }
    lease.onChange = onChange
    lease.onSubmit = onSubmit
    editor.onChange = onChange
    editor.onSubmit = onSubmit
    return editor
  }
}

class CompiledSurface implements BlueEditorShellComponent {
  private readonly state: FocusState
  private readonly root: Component
  private viewport: BlueUiViewport
  private runtimeFailure: string | undefined
  private readonly surfaceRuntime: BlueUiSurfaceRuntime
  private readonly generation: number

  constructor(
    node: CompilableNode,
    private readonly options: BlueUiCompilerOptions,
    mode: CompilerMode,
    private readonly editor?: BlueEditor,
    surfaceRuntime?: BlueUiSurfaceRuntime,
    refreshMode: 'internal' | 'external' = 'external',
    contextKeyHints = false,
    contextEscapeHint?: 'close' | 'leave',
  ) {
    this.viewport = safeViewport(options.getViewport)
    const runtimeOptions: RuntimeCompilerOptions = {
      ...options,
      ...(editor === undefined ? {} : { editor }),
      getViewport: () => this.viewport,
      reportRuntimeFailure: message => { this.runtimeFailure ??= message },
    }
    this.surfaceRuntime = surfaceRuntime ?? new BlueUiSurfaceRuntime()
    this.generation = this.surfaceRuntime.bind(node, runtimeOptions, refreshMode, viewport => { this.viewport = viewport })
    this.state = this.surfaceRuntime.state
    const contextHint = contextKeyHints ? contextKeyHintComponent(this.state, runtimeOptions, contextEscapeHint) : undefined
    const compiledRoot = compileNode(node, this.state, runtimeOptions, '$', mode, node.kind === 'surface' ? contextHint : undefined)
    if (contextHint === undefined || node.kind === 'surface') this.root = compiledRoot
    else {
      const root = new VStack()
      root.addChild(compiledRoot)
      root.addChild(contextHint)
      this.root = root
    }
    this.surfaceRuntime.admit(node)
    reconcile(this.state)
  }

  get focused(): boolean { return this.state.focused }
  set focused(value: boolean) {
    if (!this.surfaceRuntime.current(this.generation)) return
    this.surfaceRuntime.setFocused(value)
    if (!value && this.editor !== undefined) this.editor.focused = false
    if (!value) this.state.pendingConfirmation = undefined
    reconcile(this.state)
  }

  captureFocusIdentity(): BlueFocusIdentity | undefined {
    if (!this.surfaceRuntime.current(this.generation)) return undefined
    this.viewport = safeViewport(this.options.getViewport)
    const controls = reconcile(this.state)
    const active = controls[this.state.lastIndex]
    /* v8 ignore next -- a live focus facade is created only for a tree with controls. */
    if (active === undefined) return undefined
    const tabControlId = controlGroups(controls)
      .filter(group => group.kind === 'tabs')[this.state.lastTabGroupIndex]
      ?.entries[0]?.control.identity.controlId
    return tabControlId === undefined ? active.identity : { ...active.identity, tabControlId }
  }

  restoreFocusIdentity(identity: BlueFocusIdentity): boolean {
    if (!this.surfaceRuntime.current(this.generation)) return false
    this.viewport = safeViewport(this.options.getViewport)
    const controls = this.state.controls()
    const index = controls.findIndex(control => sameFocusIdentity(control.identity, identity))
    if (index < 0) return false
    const control = controls[index]!
    this.state.activeKey = control.key
    this.state.activeGroup = control.group
    this.state.desiredKey = control.key
    this.state.desiredGroup = control.group
    this.state.groupActiveKeys.set(control.group, control.key)
    this.state.lastIndex = index
    const tabGroups = controlGroups(controls).filter(group => group.kind === 'tabs')
    const tabIndex = tabGroups.findIndex(group => group.entries[0]?.control.identity.controlId === identity.tabControlId)
    if (tabIndex >= 0) this.state.lastTabGroupIndex = tabIndex
    this.state.pendingConfirmation = undefined
    reconcile(this.state)
    return true
  }

  [LAYOUT_NODE](): LayoutNode {
    if (!this.surfaceRuntime.current(this.generation)) return { type: 'vstack', entries: [], gap: 0, align: 'stretch' }
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

  private renderFrame(width: number, maxRows: number | undefined): BlueStatusRenderResult {
    const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
    if (!this.surfaceRuntime.current(this.generation)) return { rows: [], overflowed: false }
    this.runtimeFailure = undefined
    try {
      this.state.layoutPass = false
      this.viewport = maxRows === undefined
        ? safeViewport(this.options.getViewport)
        : { columns: safeWidth, rows: maxRows }
      reconcile(this.state)
      const rows = this.root.render(safeWidth)
      const rowLimit = maxRows ?? (this.options.screenMode === 'alternate' ? this.viewport.rows : undefined)
      const limited = rowLimit === undefined ? rows : rows.slice(0, rowLimit)
      let overflowed = rowLimit !== undefined && rows.length > rowLimit
      const rendered = limited.map(row => {
        if (visibleWidth(row) <= safeWidth) return row
        overflowed = true
        return sliceByColumn(row, 0, safeWidth, true)
      })
      let inserted = false
      const result = { rows: rendered.map(row => {
        if (!this.focused || inserted || !row.includes(FOCUS_SENTINEL)) return row.replaceAll(FOCUS_SENTINEL, ' ')
        inserted = true
        if (row.includes(CURSOR_MARKER)) return row.replaceAll(FOCUS_SENTINEL, ' ')
        return row.replace(FOCUS_SENTINEL, `${CURSOR_MARKER} `).replaceAll(FOCUS_SENTINEL, ' ')
      }), overflowed }
      return this.runtimeFailure === undefined ? result : { ...result, runtimeFailure: this.runtimeFailure }
    } catch (error) {
      const message = renderFailure(error)
      const rows = errorRows(message, safeWidth, this.options.colors)
      return { rows: maxRows === undefined ? rows : rows.slice(0, maxRows), overflowed: maxRows !== undefined && rows.length > maxRows, runtimeFailure: message }
    }
  }

  render(width: number): string[] { return this.renderChecked(width).rows }

  renderChecked(width: number, options: BlueEditorShellRenderOptions = {}): BlueEditorShellRenderResult {
    if (options.dryRun !== true) {
      const rendered = this.renderFrame(width, undefined)
      return rendered.runtimeFailure === undefined
        ? { rows: rendered.rows }
        : { rows: rendered.rows, runtimeFailure: rendered.runtimeFailure }
    }
    // `dryRun` is exposed only by the validated editor-shell result, whose
    // compiler contract guarantees the injected editor and its one control.
    const editor = this.editor!
    const restoreEditorFocus = this.surfaceRuntime.checkpointEditorFocus()
    const focus = {
      activeKey: this.state.activeKey,
      activeGroup: this.state.activeGroup,
      desiredKey: this.state.desiredKey,
      desiredGroup: this.state.desiredGroup,
      editingKey: this.state.editingKey,
      groupActiveKeys: new Map(this.state.groupActiveKeys),
      lastIndex: this.state.lastIndex,
      focused: this.state.focused,
      layoutPass: this.state.layoutPass,
      pendingConfirmation: this.state.pendingConfirmation,
      lastTabGroupIndex: this.state.lastTabGroupIndex,
      viewport: this.viewport,
      runtimeFailure: this.runtimeFailure,
      editorFocused: editor.focused,
    }
    try {
      const rendered = this.renderFrame(width, undefined)
      return rendered.runtimeFailure === undefined
        ? { rows: rendered.rows }
        : { rows: rendered.rows, runtimeFailure: rendered.runtimeFailure }
    } finally {
      this.state.activeKey = focus.activeKey
      this.state.activeGroup = focus.activeGroup
      this.state.desiredKey = focus.desiredKey
      this.state.desiredGroup = focus.desiredGroup
      this.state.editingKey = focus.editingKey
      this.state.groupActiveKeys.clear(); for (const [key, value] of focus.groupActiveKeys) this.state.groupActiveKeys.set(key, value)
      this.state.lastIndex = focus.lastIndex
      this.state.focused = focus.focused
      this.state.layoutPass = focus.layoutPass
      this.state.pendingConfirmation = focus.pendingConfirmation
      this.state.lastTabGroupIndex = focus.lastTabGroupIndex
      this.viewport = focus.viewport
      this.runtimeFailure = focus.runtimeFailure
      editor.focused = focus.editorFocused
      restoreEditorFocus()
    }
  }

  focusEditor(): void {
    if (!this.surfaceRuntime.current(this.generation)) return
    this.viewport = safeViewport(this.options.getViewport)
    const controls = this.state.controls()
    const index = controls.findIndex(control => control.kind === 'editor')
    this.state.activeKey = controls[index]!.key
    this.state.activeGroup = controls[index]!.group
    this.state.desiredKey = controls[index]!.key
    this.state.desiredGroup = controls[index]!.group
    this.state.groupActiveKeys.set(controls[index]!.group, controls[index]!.key)
    this.state.lastIndex = index
    this.state.pendingConfirmation = undefined
  }

  /** Render a passive status surface with a fixed row budget and overflow signal. */
  renderStatus(width: number, maxRows: number): BlueStatusRenderResult { return this.renderFrame(width, maxRows) }

  private controlRectangles(controls: readonly ControlDescriptor[]): Map<string, LayoutRect> {
    const rectangles = new Map<string, LayoutRect>()
    /* v8 ignore next -- input returns before geometry lookup when no control exists. */
    if (controls.length === 0) return rectangles
    const width = Math.max(1, this.viewport.columns)
    const measuredHeight = Math.max(1, this.root.render(width).length)
    const height = this.options.screenMode === 'alternate'
      ? Math.max(1, this.viewport.rows)
      : measuredHeight
    const previousLayoutPass = this.state.layoutPass
    this.state.layoutPass = true
    try {
      /* v8 ignore next -- pi-tui does not request repaint during synchronous measurement. */
      const frame = renderLayoutFrame(this.root, width, height, () => {})
      const boxes = layoutBoxes(frame.root)
      const byComponent = new Map<Component, ControlDescriptor[]>()
      for (const control of controls) {
        const binding = this.state.controlBindings.get(control.key)
        if (binding === undefined || !boxes.has(binding.component)) continue
        const siblings = byComponent.get(binding.component) ?? []
        siblings.push(control)
        byComponent.set(binding.component, siblings)
      }
      for (const [component, siblings] of byComponent) {
        const rect = boxes.get(component)!
        for (const [index, control] of siblings.entries()) {
          const binding = this.state.controlBindings.get(control.key)!
          rectangles.set(control.key, divideRect(rect, binding.axis, index, siblings.length))
        }
      }
    } catch { /* a missing layout box falls back to semantic group navigation */ }
    finally { this.state.layoutPass = previousLayoutPass }
    return rectangles
  }

  handleInput(data: string): void {
    if (!this.surfaceRuntime.current(this.generation)) return
    this.viewport = safeViewport(this.options.getViewport)
    const controls = reconcile(this.state)
    const active = controls[this.state.lastIndex]
    const groups = controlGroups(controls)
    const tabGroups = groups.filter(group => group.kind === 'tabs')
    const contentGroups = groups.filter(group => group.kind === 'content')
    const moveTo = (index: number): void => {
      const control = controls[index]
      /* v8 ignore next -- every caller resolves an entry from the current control set. */
      if (control === undefined) return
      this.state.setEditing(undefined)
      this.state.pendingConfirmation = undefined
      this.state.lastIndex = index
      this.state.activeKey = control.key
      this.state.activeGroup = control.group
      this.state.desiredKey = control.key
      this.state.desiredGroup = control.group
      this.state.groupActiveKeys.set(control.group, control.key)
      const tabIndex = tabGroups.findIndex(group => group.id === control.group)
      if (tabIndex >= 0) this.state.lastTabGroupIndex = tabIndex
      reconcile(this.state)
      try { this.options.onFocusChange?.(control.identity) } catch { /* focus observers cannot escape input */ }
    }
    const moveGroup = (delta: -1 | 1): void => {
      if (active === undefined || (active.kind === 'event' && active.role === 'tab') || contentGroups.length <= 1) return
      const current = contentGroups.findIndex(group => group.id === active.group)
      /* v8 ignore next -- a non-tab active control belongs to one content group above. */
      if (current < 0) return
      const target = contentGroups[(current + contentGroups.length + delta) % contentGroups.length]!
      moveTo(groupTarget(controls, target.id, this.state.groupActiveKeys.get(target.id)))
    }
    if (matchesKey(data, Key.escape)) {
      if (active !== undefined && this.state.editingKey === active.key && (active.kind === 'text' || active.kind === 'select')) {
        if (active.kind === 'select') this.state.finishSelectEditing(active.field, active.key, true)
        else this.state.setEditing(undefined)
        return
      }
      const consumed = this.state.pendingConfirmation !== undefined
      this.state.pendingConfirmation = undefined
      if (consumed) return
      if (active !== undefined && tabGroups.length > 0) {
        const activeTabIndex = tabGroups.findIndex(group => group.id === active.group)
        if (activeTabIndex > 0) {
          const parent = tabGroups[activeTabIndex - 1]!
          moveTo(groupTarget(controls, parent.id, this.state.groupActiveKeys.get(parent.id)))
          return
        }
        if (activeTabIndex < 0) {
          /* v8 ignore next -- reconcile keeps the remembered tab index in range. */
          const parent = tabGroups[this.state.lastTabGroupIndex] ?? tabGroups.at(-1)!
          moveTo(groupTarget(controls, parent.id, this.state.groupActiveKeys.get(parent.id)))
          return
        }
      }
      this.options.onUnhandledEscape?.()
      return
    }
    if (active === undefined) return
    if (data === '\t' || data === '\x1b[Z') {
      // An editor-only provider shell has nowhere to rove. Preserve the
      // editing engine's Tab contract so it can accept or explicitly open
      // autocomplete without the canonical wrapper consuming the key.
      if (controls.length === 1 && active.kind === 'editor') {
        this.editor?.handleInput?.(data)
        return
      }
      if (active.kind === 'event' && active.role === 'tab') return
      const delta = data === '\t' ? 1 : -1
      if (active.kind === 'text' && this.state.editingKey === active.key) {
        if (active.field.error !== undefined) return
        const editor = this.state.textEditor(active.field, active.key)
        editor.onSubmit?.(editor.getExpandedText())
        moveGroup(delta)
        return
      }
      if (active.kind === 'select' && this.state.editingKey === active.key) {
        if (active.field.error !== undefined) return
        const value = this.state.finishSelectEditing(active.field, active.key, false)
        this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
        moveGroup(delta)
        return
      }
      moveGroup(delta)
      return
    }
    if (active.kind === 'editor') {
      this.editor?.handleInput?.(data)
      return
    }
    if (active.kind === 'text' && this.state.editingKey === active.key) {
      const editor = this.state.textEditor(active.field, active.key)
      editor.focused = this.state.focused
      if (matchesKey(data, Key.alt('enter'))) {
        if (active.field.kind === 'textarea') editor.insertText('\n')
        return
      }
      if (matchesKey(data, Key.enter)) {
        editor.onSubmit?.(editor.getExpandedText())
        return
      }
      editor.handleInput?.(data)
      return
    }
    const direction: NavigationDirection | undefined = data === '\x1b[A' ? 'up'
      : data === '\x1b[B' ? 'down'
        : data === '\x1b[D' ? 'left'
          : data === '\x1b[C' ? 'right'
            : undefined
    const horizontal = data === '\x1b[D' || data === '\x1b[C'
    if (active.kind === 'select' && this.state.editingKey === active.key) {
      if (horizontal) {
        const enabled = active.field.options.filter(option => option.disabled !== true)
        if (enabled.length === 0) return
        const current = this.state.fieldValue(active.field, active.key)
        const currentIndex = enabled.findIndex(option => option.id === current)
        const delta = direction === 'left' ? -1 : 1
        const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : enabled.length - 1) : currentIndex + delta
        if (nextIndex < 0 || nextIndex >= enabled.length) return
        this.state.setSelectValue(fieldStateKey(active.key, active.field.kind), active.field.value, enabled[nextIndex]!.id)
        return
      }
      if (matchesKey(data, Key.enter)) {
        const value = this.state.finishSelectEditing(active.field, active.key, false)
        this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
      }
      return
    }
    if (active.kind === 'scroll') {
      const scroll = this.state.scrollViews.get(active.key)
      /* v8 ignore next -- compiler registration creates both descriptors atomically. */
      if (scroll === undefined) return
      if (direction === 'up') scroll.scrollBy(-1)
      else if (direction === 'down') scroll.scrollBy(1)
      else if (data === '\x1b[5~') scroll.scrollBy(-Math.max(1, scroll.viewportHeight))
      else if (data === '\x1b[6~') scroll.scrollBy(Math.max(1, scroll.viewportHeight))
      else if (data === '\x1b[H' || data === 'g') scroll.scrollToStart()
      else if (data === '\x1b[F' || data === 'G') scroll.scrollToEnd()
      return
    }
    if (active.kind === 'event' && active.role === 'tab') {
      if (direction === 'left' || direction === 'right') {
        const group = tabGroups.find(candidate => candidate.id === active.group)!
        const current = group.entries.findIndex(entry => entry.index === this.state.lastIndex)
        const next = current + (direction === 'left' ? -1 : 1)
        const target = group.entries[next]
        if (target !== undefined) {
          moveTo(target.index)
          this.state.emit((target.control as Extract<ControlDescriptor, { readonly kind: 'event' }>).event)
        }
        return
      }
      if (matchesKey(data, Key.enter)) {
        const groupIndex = groups.findIndex(group => group.id === active.group)
        const target = groups[groupIndex + 1]
        if (target !== undefined) moveTo(groupTarget(controls, target.id, this.state.groupActiveKeys.get(target.id)))
      }
      return
    }
    if ((data === '\x1b[5~' || data === '\x1b[6~' || data === '\x1b[H' || data === '\x1b[F')
      && active.kind === 'event'
      && (active.role === 'list-single' || active.role === 'list-multiple')) {
      const group = groups.find(candidate => candidate.id === active.group)!
      const current = group.entries.findIndex(entry => entry.index === this.state.lastIndex)
      const page = Math.max(1, Math.min(10, this.viewport.rows - 1))
      const targetIndex = data === '\x1b[H' ? 0
        : data === '\x1b[F' ? group.entries.length - 1
          : Math.max(0, Math.min(group.entries.length - 1, current + (data === '\x1b[5~' ? -page : page)))
      const target = group.entries[targetIndex]
      if (target !== undefined && target.index !== this.state.lastIndex) moveTo(target.index)
      return
    }
    if (direction !== undefined) {
      const group = groups.find(candidate => candidate.id === active.group)
      const matchingAxis = active.navigation === 'horizontal'
        ? direction === 'left' || direction === 'right'
        : active.navigation === 'vertical' && (direction === 'up' || direction === 'down')
      let target: number | undefined
      if (matchingAxis && group !== undefined) {
        const current = group.entries.findIndex(entry => entry.index === this.state.lastIndex)
        target = group.entries[current + (direction === 'left' || direction === 'up' ? -1 : 1)]?.index
      }
      if (target === undefined) target = nearestDirectionalControl(controls, this.controlRectangles(controls), this.state.lastIndex, direction)
      if (target !== undefined) moveTo(target)
      return
    }
    if (active.kind === 'text') {
      if (matchesKey(data, Key.enter)) {
        this.state.setEditing(active.key)
        return
      }
      if (!beginsTextEditing(data)) return
      this.state.setEditing(active.key)
      const editor = this.state.textEditor(active.field, active.key)
      editor.focused = this.state.focused
      editor.handleInput?.(data)
      return
    }
    if (active.kind === 'select') {
      if (matchesKey(data, Key.enter)) this.state.beginSelectEditing(active.field, active.key)
      return
    }
    const enter = matchesKey(data, Key.enter)
    const space = data === ' '
    if (active.kind === 'toggle') {
      if (!enter && !space) return
      const value = !this.state.fieldValue(active.field, active.key)
      this.state.setToggleValue(fieldStateKey(active.key, active.field.kind), active.field.value, value)
      this.state.emit({ kind: 'value-change', controlId: active.field.id, value })
      return
    }
    if (active.kind === 'submit') {
      if (!enter && !space) return
      const values = Object.fromEntries(active.form.fields.map(field => [field.id, this.state.fieldValue(field, controlKey('form-field', active.form.id, field.id))]))
      this.state.emit({ kind: 'submit', controlId: active.form.id, values })
      return
    }
    const eventControl = active as Extract<ControlDescriptor, { readonly kind: 'event' }>
    if (eventControl.role === 'list-multiple' && enter) {
      this.state.emit(eventControl.commitEvent!)
      return
    }
    const activates = eventControl.activation === 'both'
      ? enter || space
      : eventControl.activation === 'enter' ? enter : space
    if (!activates) return
    if (eventControl.confirm !== undefined && this.state.pendingConfirmation !== eventControl.key) {
      this.state.pendingConfirmation = eventControl.key
      return
    }
    if (eventControl.confirm !== undefined && !enter) return
    this.state.pendingConfirmation = undefined
    this.state.emit(eventControl.event)
  }

  invalidate(): void { if (this.surfaceRuntime.current(this.generation)) this.root.invalidate?.() }
}

/** Passive facade that deliberately does not expose focus or input methods. */
class CompiledStatusComponent implements BlueStatusComponent {
  constructor(private readonly surface: CompiledSurface, private readonly maxRows: number) {}
  render(width: number): string[] { return this.renderStatus(width).rows }
  renderStatus(width: number): BlueStatusRenderResult { return this.surface.renderStatus(width, this.maxRows) }
  invalidate(): void { this.surface.invalidate() }
}

/** Passive bounded facade for status validation and setup failures. */
class StatusErrorComponent implements BlueStatusComponent {
  private readonly error: ErrorComponent
  constructor(message: string, colors: BlueSemanticColors, private readonly maxRows: number) {
    this.error = new ErrorComponent(message, colors)
  }
  render(width: number): string[] { return this.renderStatus(width).rows }
  renderStatus(width: number): BlueStatusRenderResult {
    const rows = this.error.render(width)
    return { rows: rows.slice(0, this.maxRows), overflowed: rows.length > this.maxRows }
  }
  invalidate(): void { this.error.invalidate() }
}

function admittedSurface(node: CompilableNode, options: BlueUiCompilerOptions, mode: CompilerMode, editor?: BlueEditor, surfaceRuntime?: BlueUiSurfaceRuntime, refreshMode?: 'internal' | 'external', contextKeyHints = false, contextEscapeHint?: 'close' | 'leave'): CompiledSurface {
  const rollback = surfaceRuntime?.checkpoint()
  try { return new CompiledSurface(node, options, mode, editor, surfaceRuntime, refreshMode, contextKeyHints, contextEscapeHint) }
  catch (error) { rollback?.(); throw error }
}

function statusRowLimit(value: BlueStatusCompilerOptions['maxRows']): number {
  return value === 2 || value === 3 ? value : 1
}

/** Validate first, then compile one canonical UI tree without a bypass path. */
export function compileBlueUiNode(value: unknown, options: BlueUiCompilerOptions): BlueUiCompileResult {
  const admitted = validateBlueUiNode(value)
  if (!admitted.ok) {
    return { ok: false, code: admitted.code, message: admitted.message, errorComponent: new ErrorComponent(admitted.message, options.colors) }
  }
  try {
    const contextKeyHints = options.contextHints?.enabled === true
    const contextEscapeHint = options.onUnhandledEscape === undefined ? undefined : 'close'
    const surface = admittedSurface(admitted.value, options, 'ui', undefined, undefined, undefined, contextKeyHints, contextEscapeHint)
    const hasControls = controlsForNode(admitted.value, options, '$', true).length > 0
    const focusTarget = hasControls || (contextKeyHints && options.contextHints?.focusWithoutControls === true) ? surface : null
    return { ok: true, value: { node: admitted.value, component: surface, focusTarget } }
  } catch {
    const message = 'Blue UI compilation failed safely'
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message, errorComponent: new ErrorComponent(message, options.colors) }
  }
}

/** Compile one validated projection into a bridge-owned persistent runtime. */
export function compileBlueUiSurfaceNode(value: unknown, options: BlueUiSurfaceCompilerOptions): BlueUiCompileResult {
  const admitted = validateBlueUiNode(value)
  if (!admitted.ok) {
    return { ok: false, code: admitted.code, message: admitted.message, errorComponent: new ErrorComponent(admitted.message, options.colors) }
  }
  try {
    const contextEscapeHint = options.onUnhandledEscape === undefined ? undefined : options.escapeHint ?? 'close'
    const surface = admittedSurface(admitted.value, options, 'ui', undefined, options.surfaceRuntime, options.refreshMode, true, contextEscapeHint)
    const hasControls = controlsForNode(admitted.value, options, '$', true).length > 0
    const focusTarget = hasControls || options.contextHints?.focusWithoutControls === true ? surface : null
    return { ok: true, value: { node: admitted.value, component: surface, focusTarget } }
  } catch {
    const message = 'Blue UI compilation failed safely'
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message, errorComponent: new ErrorComponent(message, options.colors) }
  }
}

/** Validate an editor shell, then compile it around the exact injected engine. */
export function compileBlueEditorShellNode(value: unknown, options: BlueEditorShellCompilerOptions): BlueEditorShellCompileResult {
  const admitted = validateBlueEditorShellNode(value)
  if (!admitted.ok) {
    return { ok: false, code: admitted.code, message: admitted.message, errorComponent: new ErrorComponent(admitted.message, options.colors) }
  }
  try {
    const surface = admittedSurface(admitted.value, options, 'editor', options.editor)
    return { ok: true, value: { node: admitted.value, component: surface, focusTarget: surface } }
  } catch {
    const message = 'Blue editor shell compilation failed safely'
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message, errorComponent: new ErrorComponent(message, options.colors) }
  }
}

/** Validate the non-interactive status subset, then compile it through the canonical painter. */
export function compileBlueStatusNode(value: unknown, options: BlueStatusCompilerOptions): BlueStatusCompileResult {
  const maxRows = statusRowLimit(options.maxRows)
  const admitted = validateBlueStatusNode(value)
  if (!admitted.ok) {
    return { ok: false, code: admitted.code, message: admitted.message, errorComponent: new StatusErrorComponent(admitted.message, options.colors, maxRows) }
  }
  try {
    const runtimeOptions: BlueUiCompilerOptions = {
      components: options.components,
      colors: options.colors,
      getViewport: options.getViewport,
      screenMode: options.screenMode,
      emit: PASSIVE_EVENT_SINK,
    }
    const surface = admittedSurface(admitted.value, runtimeOptions, 'status')
    return { ok: true, value: { node: admitted.value, component: new CompiledStatusComponent(surface, maxRows) } }
  } catch {
    const message = 'Blue status compilation failed safely'
    return { ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message, errorComponent: new StatusErrorComponent(message, options.colors, maxRows) }
  }
}
