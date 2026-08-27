/**
 * The sole compiler from canonical public Blue UI nodes into pi-tui-backed
 * components. One outer focus target owns roving state, event dispatch,
 * responsive reconciliation, cursor-marker insertion, and render containment.
 *
 * @module @dsh-blue/blue-core/ui-compiler
 */

import type { BlueErrorCode, BlueTone, BlueUiEvent, BlueUiNode, BlueViewportCondition, BlueView } from '@dsh-blue/blue-api'
import { CURSOR_MARKER, HStack, ScrollView, VStack, type Component } from '@earendil-works/pi-tui'
import { getLayoutNode, LAYOUT_NODE, type LayoutNode, type LayoutViewport } from '@earendil-works/pi-tui/dist/layout-node.js'
import { paintPluginTone, renderPluginView } from './plugin-view.ts'
import type { BlueComponent, BlueComponents, BlueFocusable, BlueSemanticColors } from './types.ts'
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
  readonly emit: (event: BlueUiEvent) => void
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

interface ControlDescriptor {
  readonly key: string
  readonly preferred: boolean
  readonly event: BlueUiEvent
}

interface FocusState {
  activeKey: string | undefined
  lastIndex: number
  focused: boolean
  layoutPass: boolean
  controls(): readonly ControlDescriptor[]
  emit(event: BlueUiEvent): void
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

function labelComponent(
  key: string,
  label: string,
  disabled: boolean,
  state: FocusState,
  options: BlueUiCompilerOptions,
): BlueComponent {
  return staticComponent(width => {
    const active = state.focused && state.activeKey === key
    const prefix = active ? state.layoutPass ? `${CURSOR_MARKER} ` : FOCUS_SENTINEL : ' '
    const value = `${prefix}${disabled ? '-' : '>'} ${label}`
    const painted = disabled ? options.colors.muted(value) : active ? options.colors.primary(value) : options.colors.text(value)
    return [visibleWidth(painted) <= width ? painted : sliceByColumn(painted, 0, Math.max(1, width), true)]
  }, options)
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
  if (node.title !== undefined) component.addChild(staticComponent(width => options.components.wrapText(options.colors.textStrong(node.title!), width), options))
  if (node.subtitle !== undefined) component.addChild(staticComponent(width => options.components.wrapText(options.colors.muted(node.subtitle!), width), options))
  if (node.badges !== undefined) component.addChild(staticComponent(width => options.components.wrapText(joinSpans({ spans: node.badges! }, options.colors), width), options))
  component.addChild(child)
  if (footer !== undefined) component.addChild(footer)
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
        for (const item of current.items) if (item.disabled !== true) controls.push({ key: `${currentPath}:${item.id}`, preferred: item.id === current.activeId, event: { kind: 'tab-change', controlId: current.id, tabId: item.id } })
        break
      case 'list':
        for (const item of current.items) if (item.disabled !== true) {
          const value = current.mode === 'multiple'
            ? current.selectedIds.includes(item.id) ? current.selectedIds.filter(id => id !== item.id) : [...current.selectedIds, item.id]
            : item.id
          controls.push({ key: `${currentPath}:${item.id}`, preferred: current.selectedIds.includes(item.id), event: { kind: 'selection-change', controlId: current.id, value } })
        }
        if (current.items.length === 0 && current.empty !== undefined) visit(current.empty, `${currentPath}.empty`)
        break
      case 'form':
        for (const field of current.fields) if (field.disabled !== true) {
          const value = field.kind === 'toggle' ? !field.value : field.value
          controls.push({ key: `${currentPath}:field:${field.id}`, preferred: false, event: { kind: 'value-change', controlId: field.id, value } })
        }
        if (current.submitActionId !== undefined) controls.push({ key: `${currentPath}:submit`, preferred: false, event: { kind: 'submit', controlId: current.id, values: Object.fromEntries(current.fields.map(field => [field.id, field.value])) } })
        if (current.cancelActionId !== undefined) controls.push({ key: `${currentPath}:cancel`, preferred: false, event: { kind: 'activate', controlId: current.cancelActionId } })
        break
      case 'actions':
        for (const item of current.items) if (item.disabled !== true && item.busy !== true) controls.push({ key: `${currentPath}:${item.id}`, preferred: item.intent === 'primary', event: { kind: 'activate', controlId: item.id } })
        break
      case 'loader':
        if (current.cancelActionId !== undefined) controls.push({ key: `${currentPath}:cancel`, preferred: false, event: { kind: 'activate', controlId: current.cancelActionId } })
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
    case 'sections': return staticComponent(width => renderPluginView(node as BlueView, width, options.components, options.colors, 20), options)
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
      const stack = options.screenMode === 'main' ? new VStack() : new HStack([], { gap: 1 })
      for (const item of node.items) stack.addChild(labelComponent(`${path}:${item.id}`, `${item.label}${item.count === undefined ? '' : ` (${String(item.count)})`}`, item.disabled === true, state, options))
      return stack
    }
    case 'list': {
      if (node.items.length === 0) return node.empty === undefined ? staticComponent(() => [], options) : compileNode(node.empty, state, options, `${path}.empty`)
      const stack = new VStack()
      for (const item of node.items) {
        const selected = node.selectedIds.includes(item.id) ? '[x] ' : node.mode === 'multiple' ? '[ ] ' : ''
        const suffix = [item.detail, item.badge].filter(value => value !== undefined).join(' · ')
        stack.addChild(labelComponent(`${path}:${item.id}`, `${selected}${item.label}${suffix.length === 0 ? '' : ` — ${suffix}`}`, item.disabled === true, state, options))
      }
      return stack
    }
    case 'form': {
      const stack = new VStack()
      for (const field of node.fields) {
        const value = field.kind === 'secret' ? '*'.repeat(field.value.length) : field.kind === 'toggle' ? field.value ? 'on' : 'off' : field.kind === 'select' ? field.value ?? '-' : field.value
        stack.addChild(labelComponent(`${path}:field:${field.id}`, `${field.label}: ${value}${field.error === undefined ? '' : ` (${field.error})`}`, field.disabled === true, state, options))
      }
      if (node.submitActionId !== undefined) stack.addChild(labelComponent(`${path}:submit`, node.submitActionId, false, state, options))
      if (node.cancelActionId !== undefined) stack.addChild(labelComponent(`${path}:cancel`, node.cancelActionId, false, state, options))
      return stack
    }
    case 'actions': {
      const stack = options.screenMode === 'main' ? new VStack() : new HStack([], { gap: 1 })
      for (const item of node.items) stack.addChild(labelComponent(`${path}:${item.id}`, item.busy === true ? `${item.label}...` : item.label, item.disabled === true || item.busy === true, state, options))
      return stack
    }
    case 'loader': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => options.components.wrapText(`${node.variant === 'tide' ? '~' : '⠋'} ${node.message}${node.elapsedMs === undefined ? '' : ` ${String(node.elapsedMs)}ms`}`, width), options))
      if (node.cancelActionId !== undefined) stack.addChild(labelComponent(`${path}:cancel`, node.cancelActionId, false, state, options))
      return stack
    }
    case 'empty': {
      const stack = new VStack()
      stack.addChild(staticComponent(width => options.components.wrapText(options.colors.textStrong(node.title), width), options))
      if (node.description !== undefined) stack.addChild(staticComponent(width => options.components.wrapText(options.colors.muted(node.description!), width), options))
      if (node.actions !== undefined) stack.addChild(compileNode(node.actions, state, options, `${path}.actions`))
      return stack
    }
    case 'progress': return staticComponent(width => {
      const prefix = node.label === undefined ? '' : `${node.label} `
      const available = Math.max(1, width - visibleWidth(prefix) - 8)
      const filled = Math.round((node.value / node.max) * available)
      return [`${prefix}${'█'.repeat(filled)}${'░'.repeat(Math.max(0, available - filled))} ${String(node.value)}/${String(node.max)}`]
    }, options)
    case 'spacer': return staticComponent(() => Array.from({ length: node.size ?? 1 }, () => ''), options)
    case 'divider': return staticComponent(width => {
      const label = node.label === undefined ? '' : ` ${node.label} `
      return [`${label}${'─'.repeat(Math.max(0, width - visibleWidth(label)))}`]
    }, options)
  }
}

function reconcile(state: FocusState): readonly ControlDescriptor[] {
  const controls = state.controls()
  if (controls.length === 0) {
    state.activeKey = undefined
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
    this.state = {
      activeKey: undefined,
      lastIndex: 0,
      focused: false,
      layoutPass: false,
      controls: () => controlsForNode(node, runtimeOptions),
      emit: event => {
        try { options.emit(event) } catch { /* event failures are host-owned */ }
      },
      setLayoutViewport: viewport => { this.viewport = viewport },
    }
    this.root = compileNode(node, this.state, runtimeOptions)
  }

  get focused(): boolean { return this.state.focused }
  set focused(value: boolean) { this.state.focused = value }

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
    if (controls.length === 0) return
    if (data === '\t' || data === '\x1b[C' || data === '\x1b[B') {
      this.state.lastIndex = (this.state.lastIndex + 1) % controls.length
      this.state.activeKey = controls[this.state.lastIndex]!.key
      return
    }
    if (data === '\x1b[Z' || data === '\x1b[D' || data === '\x1b[A') {
      this.state.lastIndex = (this.state.lastIndex + controls.length - 1) % controls.length
      this.state.activeKey = controls[this.state.lastIndex]!.key
      return
    }
    if (data === '\r' || data === '\n' || data === ' ') this.state.emit(controls[this.state.lastIndex]!.event)
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
