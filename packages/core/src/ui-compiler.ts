/**
 * The sole compiler from canonical public Blue UI nodes into pi-tui-backed
 * components. One outer focus target owns roving state, event dispatch,
 * responsive reconciliation, cursor-marker insertion, and render containment.
 *
 * @module @dsh-blue/blue-core/ui-compiler
 */

import type { BlueEditorShellNode, BlueErrorCode, BlueFormField, BlueStatusNode, BlueTone, BlueUiEvent, BlueUiNode, BlueViewportCondition, BlueView } from '@dsh-blue/blue-api'
import { CURSOR_MARKER, HStack, ScrollView, VStack, type Component } from '@earendil-works/pi-tui'
import { getLayoutNode, LAYOUT_NODE, type LayoutNode, type LayoutViewport } from '@earendil-works/pi-tui/dist/layout-node.js'
import { ownDataErrorMessage } from './error-message.ts'
import { paintPluginTone, renderCanonicalView } from './plugin-view.ts'
import type { BlueComponent, BlueComponents, BlueEditor, BlueFocusable, BlueSemanticColors } from './types.ts'
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
  /** Internal stable editor pool used only by official form adapters. */
  readonly resolveTextEditor?: (controlId: string, path: string) => BlueEditor
  /** Internal official-form submit bridge. */
  readonly onTextSubmit?: (controlId: string, value: string) => void
  readonly emit: (event: BlueUiEvent) => void
  /** Called only when Escape did not first cancel compiler-local state. */
  readonly onUnhandledEscape?: () => void
}

/** Canonical shell dependencies, including the one host-owned editing engine. */
export interface BlueEditorShellCompilerOptions extends BlueUiCompilerOptions {
  readonly editor: BlueEditor
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
  | (ControlBase & { readonly kind: 'editor' })

interface FocusState {
  activeKey: string | undefined
  lastIndex: number
  lastGroupIndex: number
  focused: boolean
  layoutPass: boolean
  pendingConfirmation: string | undefined
  controls(): readonly ControlDescriptor[]
  emit(event: BlueUiEvent): void
  field(field: BlueFormField, key: string): BlueFormField
  fieldValue(field: BlueFormField, key: string): string | boolean | null
  setTextValue(key: string, canonical: string, value: string): void
  textEditor(field: TextField, key: string): BlueEditor
  setSelectValue(key: string, canonical: string | null, value: string | null): void
  setToggleValue(key: string, canonical: boolean, value: boolean): void
  setLayoutViewport(viewport: BlueUiViewport): void
}

interface ControlGroup {
  readonly id: string
  readonly entries: readonly { readonly control: ControlDescriptor, readonly index: number }[]
}

function controlGroups(controls: readonly ControlDescriptor[]): ControlGroup[] {
  const groups: { id: string, entries: { control: ControlDescriptor, index: number }[] }[] = []
  const byId = new Map<string, { id: string, entries: { control: ControlDescriptor, index: number }[] }>()
  for (const [index, control] of controls.entries()) {
    let group = byId.get(control.group)
    if (group === undefined) {
      group = { id: control.group, entries: [] }
      byId.set(control.group, group)
      groups.push(group)
    }
    group.entries.push({ control, index })
  }
  return groups
}

function preferredControlIndex(group: ControlGroup): number {
  return (group.entries.find(entry => entry.control.preferred) ?? group.entries[0]!).index
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
  const editor = state.textEditor(field, key)
  return {
    render: width => {
      try {
        const available = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
        const focused = state.focused && state.activeKey === key && field.disabled !== true
        editor.focused = focused
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
    invalidate: () => editor.invalidate(),
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

function pad(component: Component, amount: number, options: RuntimeCompilerOptions): Component {
  if (amount === 0) return component
  const padded = new HStack()
  const spacer = (): BlueComponent => staticComponent(() => [''], options)
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  padded.addChild(component, { basis: 0, grow: 1, shrink: 1, minSize: 1 })
  padded.addChild(spacer(), { basis: amount, grow: 0, shrink: 1 })
  return padded
}

function overlaySurfaceComponent(node: Extract<CompilableNode, { readonly kind: 'surface' }>, child: Component, footer: Component | undefined, options: RuntimeCompilerOptions): BlueComponent & { [LAYOUT_NODE](): LayoutNode } {
  const body = new VStack()
  body.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors).slice(1), options))
  body.addChild(child)
  if (footer !== undefined) body.addChild(footer)

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

function surfaceComponent(node: Extract<CompilableNode, { readonly kind: 'surface' }>, child: Component, footer: Component | undefined, options: RuntimeCompilerOptions): BlueComponent {
  if (node.chrome === 'overlay') return overlaySurfaceComponent(node, child, footer, options)
  const component = new VStack()
  component.addChild(staticComponent(width => renderSurfaceHead(node, width, options.colors), options))
  component.addChild(child)
  if (footer !== undefined) component.addChild(footer)
  component.addChild(staticComponent(width => renderSurfaceTail(node, width, options.colors), options))
  return pad(component, node.padding ?? 0, options)
}

function controlsForNode(node: CompilableNode, options: BlueUiCompilerOptions, path = '$', includeHidden = false): ControlDescriptor[] {
  const controls: ControlDescriptor[] = []
  const visit = (current: CompilableNode, currentPath: string): void => {
    switch (current.kind) {
      case 'editor-control':
        controls.push({ kind: 'editor', key: currentPath, preferred: true, group: currentPath, navigation: 'none' })
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
          const key = `${currentPath}:field:${field.id}`
          const base: ControlBase = { key, preferred: true, group: key, navigation: 'none' }
          if (field.kind === 'toggle') controls.push({ ...base, kind: 'toggle', field })
          else if (field.kind === 'select') controls.push({ ...base, kind: 'select', field })
          else controls.push({ ...base, kind: 'text', field })
        }
        if (current.submitActionId !== undefined) controls.push({ kind: 'submit', key: `${currentPath}:submit`, preferred: true, group: `${currentPath}:actions`, navigation: 'horizontal', form: current, formPath: currentPath })
        if (current.cancelActionId !== undefined) controls.push({ kind: 'event', key: `${currentPath}:cancel`, preferred: false, group: `${currentPath}:actions`, navigation: 'horizontal', event: { kind: 'activate', controlId: current.cancelActionId } })
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

function compileNode(node: CompilableNode, state: FocusState, options: RuntimeCompilerOptions, path = '$', mode: CompilerMode = 'ui'): Component {
  switch (node.kind) {
    case 'editor-control': {
      const editor = options.editor
      if (editor === undefined) throw new Error('editor-control requires a host editor')
      return {
        render: width => {
          try {
            editor.focused = state.focused && state.activeKey === path
            return editor.render(Math.max(1, width))
          } catch (error) {
            const message = renderFailure(error, 'unknown editor failure')
            options.reportRuntimeFailure(message)
            return errorRows(message, width, options.colors)
          }
        },
        invalidate: () => editor.invalidate(),
      }
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
    case 'surface': return surfaceComponent(node, compileNode(node.child, state, options, `${path}.child`, mode), node.footer === undefined ? undefined : compileNode(node.footer, state, options, `${path}.footer`, mode), options)
    case 'scroll': {
      const child = compileNode(node.child, state, options, `${path}.scroll`, mode)
      if (options.screenMode === 'main') return child
      return new ScrollView(child, { follow: node.follow === 'end' ? 'end' : 'none', primary: false, overscroll: 'contain', scrollbar: node.scrollbar === true ? 'auto' : 'hidden' })
    }
    case 'tabs': {
      return staticComponent(width => renderTabs(node, width, patternFocus(state, `${path}:`), options.colors), options)
    }
    case 'list': {
      if (node.items.length === 0) return node.empty === undefined ? staticComponent(() => [], options) : compileNode(node.empty, state, options, `${path}.empty`, mode)
      return staticComponent(width => renderList(node, width, options.screenMode === 'main' ? Number.MAX_SAFE_INTEGER : safeViewport(options.getViewport).rows, patternFocus(state, `${path}:`), options.colors), options)
    }
    case 'form': {
      const stack = new VStack()
      for (const field of node.fields) {
        const key = `${path}:field:${field.id}`
        stack.addChild(field.kind === 'input' || field.kind === 'textarea' || field.kind === 'secret'
          ? editorFieldComponent(field, key, state, options)
          : staticComponent(width => renderFormField(state.field(field, key), width, patternFocus(state, `${path}:field:`), options.colors), options))
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
  if (controls.length === 0) {
    state.activeKey = undefined
    state.pendingConfirmation = undefined
    state.lastIndex = 0
    state.lastGroupIndex = 0
    return controls
  }
  const groups = controlGroups(controls)
  const current = controls.findIndex(control => control.key === state.activeKey)
  if (current >= 0) {
    state.lastIndex = current
    state.lastGroupIndex = groups.findIndex(group => group.id === controls[current]!.group)
    return controls
  }
  state.lastGroupIndex = Math.min(state.lastGroupIndex, groups.length - 1)
  const group = groups[state.lastGroupIndex]!
  state.lastIndex = preferredControlIndex(group)
  state.pendingConfirmation = undefined
  state.activeKey = controls[state.lastIndex]!.key
  return controls
}

class CompiledSurface implements BlueEditorShellComponent {
  private readonly state: FocusState
  private readonly root: Component
  private viewport: BlueUiViewport
  private runtimeFailure: string | undefined

  constructor(node: CompilableNode, private readonly options: BlueUiCompilerOptions, mode: CompilerMode, private readonly editor?: BlueEditor) {
    this.viewport = safeViewport(options.getViewport)
    const runtimeOptions: RuntimeCompilerOptions = {
      ...options,
      ...(editor === undefined ? {} : { editor }),
      getViewport: () => this.viewport,
      reportRuntimeFailure: message => { this.runtimeFailure ??= message },
    }
    const textBuffers = new Map<string, { canonical: string, value: string }>()
    const selectDrafts = new Map<string, { canonical: string | null, value: string | null }>()
    const toggleDrafts = new Map<string, { canonical: boolean, value: boolean }>()
    const textEditors = new Map<string, BlueEditor>()
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
    let runtimeState!: FocusState
    const textEditor = (field: TextField, key: string): BlueEditor => {
      let editor = options.resolveTextEditor?.(field.id, key) ?? textEditors.get(key)
      if (editor === undefined) {
        editor = options.components.createEditor()
        textEditors.set(key, editor)
      }
      const controlled = String(runtimeState.fieldValue(field, key))
      if (editor.getExpandedText() !== controlled) {
        editor.onChange = undefined
        editor.setText(controlled)
      }
      editor.disableSubmit = field.kind === 'textarea'
      editor.onChange = () => {
        const value = editor!.getExpandedText()
        runtimeState.setTextValue(key, field.value, value)
        runtimeState.emit({ kind: 'value-change', controlId: field.id, value })
      }
      editor.onSubmit = value => {
        runtimeState.setTextValue(key, field.value, value)
        runtimeState.emit({ kind: 'value-change', controlId: field.id, value })
        try { options.onTextSubmit?.(field.id, value) } catch { /* official submit observers cannot escape input */ }
      }
      return editor
    }
    runtimeState = {
      activeKey: undefined,
      lastIndex: 0,
      lastGroupIndex: 0,
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
      textEditor,
      setSelectValue: (key, canonical, value) => { selectDrafts.set(key, { canonical, value }) },
      setToggleValue: (key, canonical, value) => { toggleDrafts.set(key, { canonical, value }) },
      setLayoutViewport: viewport => { this.viewport = viewport },
    }
    this.state = runtimeState
    this.root = compileNode(node, this.state, runtimeOptions, '$', mode)
  }

  get focused(): boolean { return this.state.focused }
  set focused(value: boolean) {
    this.state.focused = value
    if (!value && this.editor !== undefined) this.editor.focused = false
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

  private renderFrame(width: number, maxRows: number | undefined): BlueStatusRenderResult {
    const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
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
    const focus = {
      activeKey: this.state.activeKey,
      lastIndex: this.state.lastIndex,
      lastGroupIndex: this.state.lastGroupIndex,
      focused: this.state.focused,
      layoutPass: this.state.layoutPass,
      pendingConfirmation: this.state.pendingConfirmation,
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
      this.state.lastIndex = focus.lastIndex
      this.state.lastGroupIndex = focus.lastGroupIndex
      this.state.focused = focus.focused
      this.state.layoutPass = focus.layoutPass
      this.state.pendingConfirmation = focus.pendingConfirmation
      this.viewport = focus.viewport
      this.runtimeFailure = focus.runtimeFailure
      editor.focused = focus.editorFocused
    }
  }

  focusEditor(): void {
    this.viewport = safeViewport(this.options.getViewport)
    const controls = this.state.controls()
    const index = controls.findIndex(control => control.kind === 'editor')
    this.state.activeKey = controls[index]!.key
    this.state.lastIndex = index
    this.state.lastGroupIndex = controlGroups(controls).findIndex(group => group.id === controls[index]!.group)
    this.state.pendingConfirmation = undefined
  }

  /** Render a passive status surface with a fixed row budget and overflow signal. */
  renderStatus(width: number, maxRows: number): BlueStatusRenderResult { return this.renderFrame(width, maxRows) }

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
    const groups = controlGroups(controls)
    const moveTo = (index: number): void => {
      this.state.pendingConfirmation = undefined
      this.state.lastIndex = index
      this.state.activeKey = controls[index]!.key
      this.state.lastGroupIndex = groups.findIndex(group => group.id === controls[index]!.group)
    }
    if (data === '\t' || data === '\x1b[Z') {
      // An editor-only provider shell has nowhere to rove. Preserve the
      // editing engine's Tab contract so it can accept or explicitly open
      // autocomplete without the canonical wrapper consuming the key.
      if (controls.length === 1 && active.kind === 'editor') {
        this.editor?.handleInput?.(data)
        return
      }
      if (groups.length === 1) {
        this.state.pendingConfirmation = undefined
        return
      }
      const delta = data === '\t' ? 1 : -1
      const groupIndex = groups.findIndex(group => group.id === active.group)
      const nextGroup = groups[(groupIndex + groups.length + delta) % groups.length]!
      moveTo(preferredControlIndex(nextGroup))
      return
    }
    if (active.kind === 'editor') {
      this.editor?.handleInput?.(data)
      return
    }
    const direction = data === '\x1b[A' || data === '\x1b[D' ? -1 : data === '\x1b[B' || data === '\x1b[C' ? 1 : 0
    const matchingDirection = direction !== 0 && (active.navigation === 'horizontal'
      ? data === '\x1b[D' || data === '\x1b[C'
      : active.navigation === 'vertical' && (data === '\x1b[A' || data === '\x1b[B'))
    if (active.kind === 'select' && (data === '\x1b[D' || data === '\x1b[C')) {
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
    if (matchingDirection) {
      const siblings = controls.map((control, index) => ({ control, index })).filter(entry => entry.control.group === active.group)
      const siblingIndex = siblings.findIndex(entry => entry.index === this.state.lastIndex)
      moveTo(siblings[(siblingIndex + siblings.length + direction) % siblings.length]!.index)
      return
    }
    if (active.kind === 'text') {
      this.state.textEditor(active.field, active.key).handleInput?.(data)
      return
    }
    if (direction !== 0) return
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

function admittedSurface(node: CompilableNode, options: BlueUiCompilerOptions, mode: CompilerMode, editor?: BlueEditor): CompiledSurface {
  return new CompiledSurface(node, options, mode, editor)
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
    const surface = admittedSurface(admitted.value, options, 'ui')
    const focusTarget = controlsForNode(admitted.value, options, '$', true).length === 0 ? null : surface
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
