/**
 * Canonical single-select controller and shared list geometry helpers.
 * Filtering, hydration, and command callbacks remain interaction state;
 * presentation is a public Blue list/surface compiled only by core.
 *
 * @module @dsh-blue/blue-interaction/select-list
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter, type CanonicalNodeSource } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT, ACTION_TOGGLE } from './keys.ts'

/** One selectable row of a {@link CanonicalSelectController}. */
export interface SelectRow {
  readonly value: string
  readonly label: string
  readonly filterText?: string
  readonly description?: string
  readonly badge?: string
  readonly disabled?: boolean
}

/** Construction options for {@link CanonicalSelectController}. */
export interface SelectListPanelOptions {
  readonly keymap: BlueKeymap
  readonly theme: BlueTheme
  readonly components: BlueComponents
  readonly rows: readonly SelectRow[] | ((query: string) => readonly SelectRow[])
  readonly title?: string
  readonly titleHint?: string
  readonly footer?: string
  readonly initialValue?: string
  readonly filter?: boolean
  /** Dynamic translator for package-owned chrome and row copy. */
  readonly t?: BlueTranslate
  readonly onCursorChanged?: (cursor: number, rows: readonly SelectRow[]) => void
  readonly onSelect: (row: SelectRow) => void
  readonly onBlockedSelect?: (row: SelectRow) => void
  readonly onHighlight?: (row: SelectRow) => void
  readonly onToggle?: (row: SelectRow) => void
  readonly onCancel: () => void
}

export const MAX_LIST_VISIBLE = 8

export function cycle(index: number, count: number, delta: 1 | -1): number {
  if (count <= 1) return Math.max(0, index)
  return ((index + delta) % count + count) % count
}

export function windowedRange(cursor: number, count: number, maxVisible: number): { start: number, end: number } {
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), count - maxVisible))
  return { start, end: Math.min(start + maxVisible, count) }
}

export function counterRow(cursor: number, count: number, maxVisible: number): string | undefined {
  return count > maxVisible ? `  (${cursor + 1}/${count})` : undefined
}

export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/** Canonical single-select panel preserving filtering and callback behavior. */
export class CanonicalSelectController implements BlueFocusable, CanonicalNodeSource {
  private readonly adapter: CanonicalPanelAdapter
  private cursor: number
  private query = ''
  private readonly filter: boolean
  private rows: readonly SelectRow[]

  constructor(private readonly options: SelectListPanelOptions) {
    this.rows = typeof options.rows === 'function' ? options.rows('') : options.rows
    const seeded = options.initialValue === undefined ? -1 : this.sourceRows().findIndex(row => row.value === options.initialValue)
    this.cursor = seeded >= 0 ? seeded : 0
    this.filter = options.filter === true
    this.adapter = new CanonicalPanelAdapter({
      components: options.components,
      theme: options.theme,
      node: () => this.currentNode(),
      onEvent: event => this.onEvent(event),
      onUnhandledEscape: options.onCancel,
    })
  }

  get focused(): boolean { return this.adapter.focused }
  set focused(value: boolean) { this.adapter.focused = value }

  setRows(rows: readonly SelectRow[]): void {
    const current = this.filtered()[this.cursor]?.value
    this.rows = rows
    const view = this.filtered()
    const next = current === undefined ? -1 : view.findIndex(row => row.value === current)
    this.cursor = next >= 0 ? next : Math.min(this.cursor, Math.max(0, view.length - 1))
    this.adapter.invalidate()
  }

  handleInput(data: string): void {
    const view = this.filtered()
    if (this.options.keymap.matches(data, ACTION_MOVE_UP)) { this.move(-1); return }
    if (this.options.keymap.matches(data, ACTION_MOVE_DOWN)) { this.move(1); return }
    if (this.query.length === 0 && this.options.onToggle !== undefined && this.options.keymap.matches(data, ACTION_TOGGLE)) {
      const row = view[this.cursor]
      if (row === undefined) return
      this.options.onToggle(row)
      const next = this.filtered()
      const anchored = next.findIndex(candidate => candidate.value === row.value)
      this.cursor = anchored >= 0 ? anchored : 0
      this.adapter.invalidate()
      return
    }
    if (this.options.keymap.matches(data, ACTION_SUBMIT)) { this.activate(); return }
    if (this.options.keymap.matches(data, ACTION_CANCEL)) {
      if (this.filter && this.query !== '') {
        this.query = ''
        this.reseedCursor()
        this.options.onCursorChanged?.(this.cursor, this.filtered())
        this.adapter.invalidate()
      } else this.options.onCancel()
      return
    }
    if (!this.filter) return
    if (data === '\x7f') {
      this.query = this.query.slice(0, -1)
      this.reseedCursor()
      this.adapter.invalidate()
      return
    }
    if (data.length === 1 && data >= ' ') {
      this.query += data
      this.reseedCursor()
      this.options.onCursorChanged?.(this.cursor, this.filtered())
      this.adapter.invalidate()
    }
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }

  currentNode(): BlueUiNode {
    const t = this.options.t ?? ((value: string) => value)
    const view = this.filtered()
    const selected = view[this.cursor]
    const range = windowedRange(this.cursor, view.length, MAX_LIST_VISIBLE)
    const visible = view.slice(range.start, range.end)
    const titleHint = this.options.titleHint === undefined ? undefined : t(this.options.titleHint)
    const hint = this.filter && this.query === ''
      ? [titleHint, t('type to search')].filter(Boolean).join(' · ')
      : titleHint
    const footer = [
      this.options.footer === undefined ? undefined : t(this.options.footer),
      hint,
      counterRow(this.cursor, view.length, MAX_LIST_VISIBLE),
    ].filter((value): value is string => value !== undefined && value !== '')
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: this.options.title === undefined ? t('Select') : t(this.options.title),
      child: {
        kind: 'list',
        id: 'select-list',
        selectedIds: selected === undefined ? [] : [selected.value],
        ...(this.query === '' ? {} : { filter: this.query }),
        items: visible.map(row => ({
          id: row.value,
          label: t(row.label),
          ...(row.description === undefined ? {} : { detail: oneLine(t(row.description)) }),
          ...(row.badge === undefined ? {} : { badge: row.badge }),
          ...(row.disabled === true ? { disabled: true } : {}),
        })),
        ...(view.length === 0 ? { empty: { kind: 'empty', title: t('no matches') } as const } : {}),
      },
      ...(footer.length === 0 ? {} : { footer: { kind: 'text', content: footer.join(' · '), tone: 'muted' } as const }),
    }
  }

  private sourceRows(): readonly SelectRow[] {
    return typeof this.options.rows === 'function' ? this.options.rows(this.query) : this.rows
  }

  private filtered(): readonly SelectRow[] {
    const rows = this.sourceRows()
    if (!this.filter || this.query === '') return rows
    const t = this.options.t ?? ((value: string) => value)
    return rows.filter(row => this.options.components.fuzzyMatch(this.query, row.filterText ?? t(row.label)).matches)
  }

  private reseedCursor(): void {
    const view = this.filtered()
    const seeded = this.options.initialValue === undefined ? -1 : view.findIndex(row => row.value === this.options.initialValue)
    this.cursor = seeded >= 0 ? seeded : 0
  }

  private move(delta: 1 | -1): void {
    const view = this.filtered()
    this.cursor = cycle(this.cursor, view.length, delta)
    const row = view[this.cursor]
    if (row !== undefined) this.options.onHighlight?.(row)
    this.options.onCursorChanged?.(this.cursor, view)
    this.adapter.invalidate()
  }

  private activate(): void {
    const row = this.filtered()[this.cursor]
    if (row === undefined) return
    this.onEvent({ kind: 'selection-change', controlId: 'select-list', value: row.value })
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind !== 'selection-change' || event.controlId !== 'select-list' || typeof event.value !== 'string') return
    const row = this.filtered().find(candidate => candidate.value === event.value)
    if (row === undefined) return
    if (row.disabled === true) this.options.onBlockedSelect?.(row)
    else this.options.onSelect(row)
  }
}
