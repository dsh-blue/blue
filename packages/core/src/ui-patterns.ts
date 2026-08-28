/**
 * Private L2 pattern painters for the canonical Blue UI compiler. They own
 * semantic presentation and width degradation only; layout, focus routing,
 * validation, and events remain in ui-compiler.ts.
 *
 * @module @dsh-blue/blue-core/ui-patterns
 */

import type { BlueFormField, BlueInlineSpan, BlueTone, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueSemanticColors } from './types.ts'
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from './width.ts'

type SurfaceNode = Extract<BlueUiNode, { readonly kind: 'surface' }>
type TabsNode = Extract<BlueUiNode, { readonly kind: 'tabs' }>
type ListNode = Extract<BlueUiNode, { readonly kind: 'list' }>
type ActionsNode = Extract<BlueUiNode, { readonly kind: 'actions' }>
type LoaderNode = Extract<BlueUiNode, { readonly kind: 'loader' }>
type EmptyNode = Extract<BlueUiNode, { readonly kind: 'empty' }>
type ProgressNode = Extract<BlueUiNode, { readonly kind: 'progress' }>

export interface PatternFocus {
  readonly key: string
  readonly focused: boolean
  readonly marker: string
  readonly pendingKey?: string
}

const PARTIAL_BLOCKS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'] as const
const DEFAULT_PRIMARY_COLUMN_WIDTH = 32
const PRIMARY_COLUMN_GAP = 2
const MIN_DESCRIPTION_WIDTH = 10
const DESCRIPTION_MAX_LINES = 2
const ELLIPSIS = '…'
const ELLIPSIS_WIDTH = visibleWidth(ELLIPSIS)

// Plain autocomplete content sits inside theme paint. Remove the reset that
// pi-tui's truncator appends so it cannot cancel that enclosing paint.
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) matches ANSI SGR resets
const TRAILING_ANSI_RESET = /(?:\x1b\[0m)+$/

/** Renderer paint and layout supplied by the thin pi-tui select adapter. */
export interface AutocompleteListPatternOptions {
  readonly selectedText: (text: string) => string
  readonly description: (text: string) => string
  readonly scrollInfo: (text: string) => string
  readonly noMatch: (text: string) => string
  readonly minPrimaryColumnWidth?: number
  readonly maxPrimaryColumnWidth?: number
  readonly truncatePrimary?: (context: {
    readonly id: string
    readonly text: string
    readonly maxWidth: number
    readonly columnWidth: number
    readonly isSelected: boolean
  }) => string
}

function safeWidth(width: number): number {
  return Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
}

function fit(value: string, width: number): string {
  const available = safeWidth(width)
  return visibleWidth(value) <= available ? value : sliceByColumn(value, 0, available, true)
}

function pad(value: string, width: number): string {
  const available = safeWidth(width)
  const fitted = fit(value, available)
  return `${fitted}${' '.repeat(Math.max(0, available - visibleWidth(fitted)))}`
}

function truncatePlainToWidth(text: string, maxWidth: number): string {
  return truncateToWidth(text, maxWidth, '').replace(TRAILING_ANSI_RESET, '')
}

function wrapDescription(text: string, width: number): string[] {
  const wrapped = wrapTextWithAnsi(text, width)
  if (wrapped.length <= DESCRIPTION_MAX_LINES) return wrapped
  const kept = wrapped.slice(0, DESCRIPTION_MAX_LINES - 1)
  const rest = wrapped.slice(DESCRIPTION_MAX_LINES - 1).join(' ')
  const clipped = truncatePlainToWidth(rest, width - ELLIPSIS_WIDTH).trimEnd()
  return [...kept, `${clipped}${ELLIPSIS}`]
}

/** Render the editor's canonical list node with its compact description rows. */
export function renderAutocompleteList(
  node: ListNode,
  width: number,
  maxVisible: number,
  options: AutocompleteListPatternOptions,
): string[] {
  const available = safeWidth(width)
  if (node.items.length === 0) return [options.noMatch(fit('  No matching commands', available))]

  const selectedId = node.selectedIds[0]
  const selectedIndex = Math.max(0, node.items.findIndex(item => item.id === selectedId))
  const visibleCount = Math.max(1, Math.floor(maxVisible))
  const startIndex = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), node.items.length - visibleCount))
  const endIndex = Math.min(startIndex + visibleCount, node.items.length)
  const rawMin = options.minPrimaryColumnWidth ?? options.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH
  const rawMax = options.maxPrimaryColumnWidth ?? options.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH
  const min = Math.max(1, Math.min(rawMin, rawMax))
  const max = Math.max(1, Math.max(rawMin, rawMax))
  const widest = node.items.reduce((current, item) => Math.max(current, visibleWidth(item.label) + PRIMARY_COLUMN_GAP), 0)
  const primaryColumnWidth = Math.max(min, Math.min(widest, max))
  const rows: string[] = []

  for (let index = startIndex; index < endIndex; index += 1) {
    const item = node.items[index]!
    const selected = item.id === selectedId
    const prefix = selected ? '→ ' : '  '
    const prefixWidth = visibleWidth(prefix)
    const detail = item.detail?.replaceAll(/[\r\n]+/g, ' ').trim()
    const primary = (maxWidth: number, columnWidth: number): string => {
      const transformed = options.truncatePrimary?.({
        id: item.id,
        text: item.label,
        maxWidth,
        columnWidth,
        isSelected: selected,
      }) ?? item.label
      return truncatePlainToWidth(transformed, maxWidth)
    }

    if (detail !== undefined && detail.length > 0 && available > 40) {
      const effectiveColumnWidth = Math.max(1, Math.min(primaryColumnWidth, available - prefixWidth - 4))
      const value = primary(Math.max(1, effectiveColumnWidth - PRIMARY_COLUMN_GAP), effectiveColumnWidth)
      const spacing = ' '.repeat(Math.max(1, effectiveColumnWidth - visibleWidth(value)))
      const detailStart = prefixWidth + visibleWidth(value) + spacing.length
      const remaining = available - detailStart - 2
      if (remaining > MIN_DESCRIPTION_WIDTH) {
        const detailRows = wrapDescription(detail, remaining)
        const indent = ' '.repeat(detailStart)
        rows.push(...detailRows.map((line, lineIndex) => selected
          ? options.selectedText(lineIndex === 0 ? `${prefix}${value}${spacing}${line}` : `${indent}${line}`)
          : lineIndex === 0 ? `${prefix}${value}${options.description(`${spacing}${line}`)}` : options.description(`${indent}${line}`)))
        continue
      }
    }

    const maxWidth = Math.max(1, available - prefixWidth - 2)
    const value = primary(maxWidth, maxWidth)
    rows.push(selected ? options.selectedText(`${prefix}${value}`) : `${prefix}${value}`)
  }

  if (startIndex > 0 || endIndex < node.items.length) {
    const indicator = `  (${String(selectedIndex + 1)}/${String(node.items.length)})`
    rows.push(options.scrollInfo(truncatePlainToWidth(indicator, Math.max(1, available - 2))))
  }
  // Only the fixed two-column pointer can out-wide a viewport mid-resize.
  // Normal rows remain untouched so theme paint composes outside this seam.
  return available < 3 ? rows.map(row => sliceByColumn(row, 0, available, true)) : rows
}

function interactivePrefix(focus: PatternFocus): string {
  return focus.focused ? `${focus.marker}→ ` : '   '
}

function paintTone(tone: BlueTone | undefined, value: string, colors: BlueSemanticColors): string {
  switch (tone) {
    case 'muted': return colors.muted(value)
    case 'accent': return colors.accent(value)
    case 'success': return colors.success(value)
    case 'warning': return colors.warning(value)
    case 'danger': return colors.error(value)
    default: return colors.text(value)
  }
}

function paintSpan(span: BlueInlineSpan, colors: BlueSemanticColors): string {
  const painted = paintTone(span.tone, span.text, colors)
  return span.emphasis === 'strong' ? `\x1b[1m${painted}\x1b[22m` : painted
}

function paintListDetail(item: ListNode['items'][number], colors: BlueSemanticColors): string {
  if (item.detailSpans !== undefined) return item.detailSpans.length === 0 ? '' : ` ${colors.text('—')} ${item.detailSpans.map(span => paintSpan(span, colors)).join('')}`
  return item.detail === undefined ? '' : colors.text(` — ${item.detail}`)
}

function compactTokens(tokens: readonly { readonly value: string, readonly focused: boolean, readonly active: boolean }[], width: number): string {
  const available = safeWidth(width)
  const complete = tokens.map(token => token.value).join(' ')
  if (visibleWidth(complete) <= available) return complete
  const priority = tokens.filter(token => token.focused)
  for (const token of tokens) if (!token.focused && token.active) priority.push(token)
  for (const token of tokens) if (!token.focused && !token.active) priority.push(token)
  const kept: string[] = []
  for (const token of priority) {
    const hiddenAfter = tokens.length - kept.length - 1
    const overflow = hiddenAfter > 0 ? ` +${String(hiddenAfter)}` : ''
    const candidate = `${kept.join(' ')}${kept.length === 0 ? '' : ' '}${token.value}${overflow}`
    if (visibleWidth(candidate) <= available || kept.length === 0) kept.push(token.value)
  }
  const hidden = Math.max(0, tokens.length - kept.length)
  return fit(`${kept.join(' ')}${hidden === 0 ? '' : ` +${String(hidden)}`}`, available)
}

export function renderSurfaceHead(node: SurfaceNode, width: number, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const chrome = node.chrome ?? 'none'
  const title = node.title ?? ''
  const rows: string[] = []
  if (chrome === 'none') {
    if (title.length > 0) rows.push(fit(colors.textStrong(title), available))
  } else {
    const pair = chrome === 'lane' ? ['─', '─'] : chrome === 'surface' ? ['┌', '┐'] : ['╭', '╮']
    const paint = chrome === 'overlay' ? colors.borderFocus : chrome === 'lane' ? colors.muted : colors.border
    const heading = title.length === 0 ? pair[0]! : `${pair[0]} ${title} `
    const fill = '─'.repeat(Math.max(0, available - visibleWidth(heading) - 1))
    rows.push(fit(paint(`${heading}${fill}${available > 1 ? pair[1] : ''}`), available))
  }
  if (node.subtitle !== undefined) rows.push(fit(colors.muted(node.subtitle), available))
  if (node.badges !== undefined && node.badges.length > 0) {
    rows.push(fit(node.badges.map(span => paintSpan(span, colors)).join(' '), available))
  }
  return rows
}

export function renderSurfaceTail(node: SurfaceNode, width: number, colors: BlueSemanticColors): string[] {
  const chrome = node.chrome ?? 'none'
  if (chrome === 'none' || chrome === 'lane') return []
  const available = safeWidth(width)
  const pair = chrome === 'surface' ? ['└', '┘'] : ['╰', '╯']
  const paint = chrome === 'surface' ? colors.border : colors.borderFocus
  return [fit(paint(`${pair[0]}${'─'.repeat(Math.max(0, available - 2))}${available > 1 ? pair[1] : ''}`), available)]
}

export function renderTabs(node: TabsNode, width: number, focus: PatternFocus, colors: BlueSemanticColors): string[] {
  const showCounts = safeWidth(width) > 40
  const tokens = node.items.map(item => {
    const active = item.id === node.activeId
    const focused = focus.focused && focus.key === item.id && item.disabled !== true
    const label = `${active ? `‹ ${item.label} ›` : item.label}${showCounts && item.count !== undefined ? ` ${String(item.count)}` : ''}`
    const content = item.disabled === true ? colors.muted(label) : active ? colors.primary(label) : colors.text(label)
    return { value: `${focused ? focus.marker : ' '}${content}`, focused, active }
  })
  return [compactTokens(tokens, width)]
}

export function renderList(node: ListNode, width: number, height: number, focus: PatternFocus, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const rows: { readonly value: string, readonly itemId?: string }[] = []
  if (node.filter !== undefined) rows.push({ value: fit(colors.textMuted(`/ ${node.filter}`), available) })
  let group: string | undefined
  for (const item of node.items) {
    if (item.group !== undefined && item.group !== group) {
      group = item.group
      rows.push({ value: fit(colors.muted(item.group), available) })
    }
    const selected = node.selectedIds.includes(item.id)
    const focused = focus.focused && focus.key === item.id
    const enabledFocus = focused && item.disabled !== true
    const marker = enabledFocus ? focus.marker : ' '
    const pointerGlyph = enabledFocus ? '→' : selected ? '●' : node.mode === 'multiple' ? '○' : ' '
    const detail = available > 40 ? paintListDetail(item, colors) : ''
    const badge = item.badge === undefined ? '' : ` [${item.badge}]`
    if (item.disabled === true) {
      rows.push({ value: fit(colors.muted(`${marker}${pointerGlyph} ${item.label}${detail}${badge}`), available), itemId: item.id })
      continue
    }
    if (enabledFocus) {
      const focusedRow = item.detailSpans === undefined
        ? colors.primary(`${marker}${pointerGlyph} ${item.label}${item.detail === undefined || available <= 40 ? '' : ` — ${item.detail}`}${badge}`)
        : `${colors.primary(`${marker}${pointerGlyph} ${item.label}`)}${detail}${colors.text(badge)}`
      rows.push({ value: colors.selectedBg(pad(focusedRow, available)), itemId: item.id })
      continue
    }
    const pointer = selected ? colors.primary(pointerGlyph) : colors.textMuted(pointerGlyph)
    rows.push({ value: fit(`${marker}${pointer} ${colors.text(item.label)}${detail}${colors.text(badge)}`, available), itemId: item.id })
  }
  const limit = Math.max(1, Number.isFinite(height) ? Math.floor(height) : 1)
  if (rows.length <= limit) return rows.map(row => row.value)
  const focusRow = rows.findIndex(row => row.itemId === focus.key)
  const start = focusRow < 0 ? 0 : Math.min(Math.max(0, focusRow - Math.floor(limit / 2)), rows.length - limit)
  return rows.slice(start, start + limit).map(row => row.value)
}

export function renderFormField(field: BlueFormField, width: number, focus: PatternFocus, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const focused = focus.focused && focus.key === field.id && field.disabled !== true
  let value: string
  let placeholder = false
  if (field.kind === 'toggle') value = field.value ? '[on]' : '[off]'
  else if (field.kind === 'select') value = field.value === null ? 'Choose…' : field.options.find(option => option.id === field.value)?.label ?? field.value
  else if (field.kind === 'secret') value = field.value.length === 0 ? field.placeholder ?? '' : '•'.repeat(field.value.length)
  else value = field.value.length === 0 ? field.placeholder ?? '' : field.value
  if (field.kind !== 'toggle' && field.kind !== 'select') placeholder = field.value.length === 0 && field.placeholder !== undefined
  const prefix = interactivePrefix({ key: field.id, focused, marker: focus.marker })
  const row = field.disabled === true
    ? colors.muted(`${prefix}${field.label}: ${value}`)
    : focused ? colors.primary(`${prefix}${field.label}: ${value}`)
      : `${prefix}${colors.textStrong(`${field.label}:`)} ${placeholder ? colors.textMuted(value) : colors.text(value)}`
  const rows = [fit(row, available)]
  if (field.error !== undefined) rows.push(fit(colors.error(`   ! ${field.error}`), available))
  return rows
}

function actionToken(item: ActionsNode['items'][number], focus: PatternFocus, colors: BlueSemanticColors): { readonly value: string, readonly focused: boolean, readonly active: boolean } {
  const busy = item.busy === true
  const focused = focus.focused && focus.key === item.id && item.disabled !== true && !busy
  const pending = focused && focus.pendingKey === item.id && item.confirm !== undefined
  const label = `${busy ? '… ' : ''}${item.label}${pending ? ` ? ${item.confirm}` : ''}`
  const framed = item.intent === 'primary' ? `[ ${label} ]` : item.intent === 'danger' ? `! ${label}` : label
  const content = item.disabled === true || busy ? colors.muted(framed) : item.intent === 'danger' ? colors.error(framed) : focused || item.intent === 'primary' ? colors.primary(framed) : colors.text(framed)
  return { value: `${focused ? focus.marker : ' '}${content}`, focused, active: item.intent === 'primary' }
}

export function renderActions(node: ActionsNode, width: number, focus: PatternFocus, colors: BlueSemanticColors, vertical: boolean): string[] {
  const tokens = node.items.map(item => actionToken(item, focus, colors))
  if (tokens.length === 0) return []
  return vertical ? tokens.map(token => fit(token.value, width)) : [compactTokens(tokens, width)]
}

export function renderLoader(node: LoaderNode, width: number, colors: BlueSemanticColors): string[] {
  const indicator = node.variant === 'tide' ? '≈' : '⠋'
  const elapsed = node.elapsedMs === undefined ? '' : ` ${String(node.elapsedMs)}ms`
  return [fit(`${colors.primary(indicator)} ${colors.text(node.message)}${colors.textMuted(elapsed)}`, width)]
}

export function renderEmpty(node: EmptyNode, width: number, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const rows = wrapTextWithAnsi(colors.textStrong(node.title), available)
  if (node.description !== undefined) rows.push(...wrapTextWithAnsi(colors.muted(node.description), available))
  return rows
}

export function renderProgress(node: ProgressNode, width: number, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const counter = `${String(node.value)}/${String(node.max)}`
  const counterWidth = visibleWidth(counter)
  const showCounter = available >= counterWidth + 2
  const label = node.label === undefined ? '' : `${node.label} `
  const showLabel = label.length > 0 && available >= visibleWidth(label) + counterWidth + 4
  const furniture = (showLabel ? visibleWidth(label) : 0) + (showCounter ? counterWidth + 1 : 0)
  const cells = Math.max(1, available - furniture)
  const eighths = Math.round((node.value / node.max) * cells * 8)
  const bar = Array.from({ length: cells }, (_, index) => {
    const remaining = eighths - index * 8
    return remaining >= 8 ? '█' : remaining <= 0 ? '░' : PARTIAL_BLOCKS[remaining]!
  }).join('')
  return [fit(`${showLabel ? colors.text(label) : ''}${colors.primary(bar)}${showCounter ? ` ${colors.textMuted(counter)}` : ''}`, available)]
}

export function renderDivider(label: string | undefined, width: number, colors: BlueSemanticColors): string[] {
  const available = safeWidth(width)
  const heading = label === undefined ? '' : ` ${label} `
  return [fit(colors.border(`${heading}${'─'.repeat(Math.max(0, available - visibleWidth(heading)))}`), available)]
}
