/**
 * Safe renderer adapter for the public, renderer-neutral `BlueView` model.
 * Third-party text is stripped of terminal controls before Blue applies its
 * own theme and width helpers, so a contribution cannot write raw ANSI or
 * escape its assigned rows.
 *
 * @module @dsh-blue/blue-core/plugin-view
 */

import type { BlueInlineSpan, BlueTone, BlueView } from '@dsh-blue/blue-api'
import { clampRowsToWidth } from './chrome.ts'
import type { BlueComponent, BlueComponents, BlueSemanticColors } from './types.ts'

/** Maximum source characters accepted from one dynamic view render. */
export const PLUGIN_VIEW_MAX_CHARS = 20_000

/** Maximum rows one dynamic dock contribution may occupy. */
export const PLUGIN_VIEW_MAX_ROWS = 20

/** Maximum recursive `sections` nesting accepted from a dynamic view. */
export const PLUGIN_VIEW_MAX_DEPTH = 8

const ANSI_OR_OSC = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)/gu
const UNSAFE_CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/gu

/** Strip terminal escapes and non-layout controls from untrusted text. */
export function sanitizePluginText(text: string): string {
  return text.replace(ANSI_OR_OSC, '').replace(UNSAFE_CONTROLS, '')
}

/** Resolve one semantic public tone into Blue's current palette. */
export function paintPluginTone(colors: BlueSemanticColors, tone: BlueTone | undefined): (text: string) => string {
  switch (tone) {
    case 'muted': return colors.muted
    case 'accent': return colors.primary
    case 'success': return colors.success
    case 'warning': return colors.warning
    case 'danger': return colors.error
    default: return colors.text
  }
}

function checkedText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  if (value.length > PLUGIN_VIEW_MAX_CHARS) throw new RangeError(`${label} exceeds ${String(PLUGIN_VIEW_MAX_CHARS)} characters`)
  return sanitizePluginText(value)
}

function strong(text: string): string { return `\x1b[1m${text}\x1b[22m` }

function spanText(span: BlueInlineSpan, colors: BlueSemanticColors): string {
  if (typeof span !== 'object' || span === null) throw new TypeError('field span must be an object')
  const painted = paintPluginTone(colors, span.tone)(checkedText(span.text, 'field span text'))
  return span.emphasis === 'strong' ? strong(painted) : painted
}

function wrapped(text: string, width: number, components: BlueComponents): string[] {
  return components.wrapText(text, Math.max(1, width))
}

function renderView(
  view: BlueView,
  width: number,
  components: BlueComponents,
  colors: BlueSemanticColors,
  depth: number,
): string[] {
  if (depth > PLUGIN_VIEW_MAX_DEPTH) throw new RangeError(`view nesting exceeds ${String(PLUGIN_VIEW_MAX_DEPTH)}`)
  if (typeof view !== 'object' || view === null || typeof view.kind !== 'string') throw new TypeError('view must be an object with a kind')
  switch (view.kind) {
    case 'text': {
      const content = checkedText(view.content, 'text content')
      return wrapped(content, width, components).map(paintPluginTone(colors, view.tone))
    }
    case 'fields': {
      if (!Array.isArray(view.rows)) throw new TypeError('fields rows must be an array')
      return view.rows.flatMap((row) => {
        if (typeof row !== 'object' || row === null || !Array.isArray(row.value)) throw new TypeError('field row is invalid')
        const label = colors.muted(`${checkedText(row.label, 'field label')}: `)
        const value = (row.value as readonly BlueInlineSpan[]).map(span => spanText(span, colors)).join('')
        return wrapped(label + value, width, components)
      })
    }
    case 'code': {
      const language = view.language === undefined ? '' : checkedText(view.language, 'code language')
      const heading = language.length === 0 ? [] : [colors.muted(language)]
      const body = checkedText(view.code, 'code content').split('\n')
        .flatMap(line => wrapped(colors.mdCodeBlock(line), width, components))
      return [...heading, ...body]
    }
    case 'diff': {
      const before = checkedText(view.before, 'diff before').split('\n')
        .flatMap(line => wrapped(colors.diffRemoved(`- ${line}`), width, components))
      const after = checkedText(view.after, 'diff after').split('\n')
        .flatMap(line => wrapped(colors.diffAdded(`+ ${line}`), width, components))
      return [...before, ...after]
    }
    case 'sections': {
      if (!Array.isArray(view.sections)) throw new TypeError('sections must be an array')
      return view.sections.flatMap((section) => {
        if (typeof section !== 'object' || section === null) throw new TypeError('section is invalid')
        const title = section.title === undefined ? [] : [strong(colors.primary(checkedText(section.title, 'section title')))]
        if (section.collapsed === true) return title.length === 0 ? [colors.muted('...')] : title
        return [...title, ...renderView(section.body, width, components, colors, depth + 1)]
      })
    }
    default: throw new TypeError(`unknown BlueView kind "${String((view as { kind?: unknown }).kind)}"`)
  }
}

/** Render and width-bound one public view, throwing only to its owner adapter. */
export function renderPluginView(
  view: BlueView,
  width: number,
  components: BlueComponents,
  colors: BlueSemanticColors,
  maxRows = PLUGIN_VIEW_MAX_ROWS,
): string[] {
  const rows = renderView(view, Math.max(1, width), components, colors, 0).slice(0, Math.max(0, Math.min(maxRows, PLUGIN_VIEW_MAX_ROWS)))
  return clampRowsToWidth(rows, Math.max(1, width), (text, target) => components.truncateToWidth(text, target))
}

/** Produce a safe one-line notification/status summary from any public view. */
export function summarizePluginView(view: BlueView): string {
  if (typeof view !== 'object' || view === null) throw new TypeError('view must be an object')
  switch (view.kind) {
    case 'text': return checkedText(view.content, 'text content').replace(/\s+/gu, ' ').trim()
    case 'fields': return view.rows.map(row => `${checkedText(row.label, 'field label')}: ${row.value.map(span => checkedText(span.text, 'field span text')).join('')}`).join(' · ')
    case 'code': return checkedText(view.code, 'code content').replace(/\s+/gu, ' ').trim()
    case 'diff': return 'diff contribution'
    case 'sections': return view.sections.map(section => section.title === undefined ? summarizePluginView(section.body) : checkedText(section.title, 'section title')).join(' · ')
    default: throw new TypeError(`unknown BlueView kind "${String((view as { kind?: unknown }).kind)}"`)
  }
}

/** Passive dock component that contains every plugin render failure. */
export class BluePluginViewComponent implements BlueComponent {
  constructor(
    private readonly source: BlueView | (() => BlueView | null),
    private readonly components: BlueComponents,
    private readonly colors: BlueSemanticColors,
    private readonly maxRows = PLUGIN_VIEW_MAX_ROWS,
  ) {}

  render(width: number): string[] {
    try {
      const view = typeof this.source === 'function' ? this.source() : this.source
      if (view === null) return []
      return renderPluginView(view, width, this.components, this.colors, this.maxRows)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown render failure'
      return renderPluginView({ kind: 'text', content: `plugin view rejected: ${message}`, tone: 'danger' }, width, this.components, this.colors, 1)
    }
  }

  invalidate(): void {}
}
