/**
 * Canonical single-select controller and shared list geometry helpers.
 * Filtering, hydration, and command callbacks remain interaction state;
 * presentation is a public Blue list/surface compiled only by core.
 *
 * @module @dsh-blue/blue-interaction/select-list
 */

import type { BlueUiEvent, BlueUiNode } from '@dsh-blue/blue-api'
import type { BlueComponents, BlueFocusable, BlueFocusIdentity, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { CanonicalPanelAdapter, type CanonicalContextHint, type CanonicalNodeSource } from './canonical-panel.ts'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_TOGGLE } from './keys.ts'

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
  readonly footer?: string
  readonly contextHints?: readonly CanonicalContextHint[]
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

export function counterRow(cursor: number, count: number, maxVisible: number): string | undefined {
  return count > maxVisible ? `  (${cursor + 1}/${count})` : undefined
}

export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

function windowStart(cursor: number, count: number): number {
  return Math.min(
    Math.max(0, count - MAX_LIST_VISIBLE),
    Math.max(0, cursor - Math.floor(MAX_LIST_VISIBLE / 2)),
  )
}

/** Canonical single-select panel preserving filtering and callback behavior. */
export class CanonicalSelectController implements BlueFocusable, CanonicalNodeSource {
  private readonly adapter: CanonicalPanelAdapter
  private cursor: number
  private query = ''
  private filterEditing = false
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
      maxLeafRows: MAX_LIST_VISIBLE,
      ...(options.t === undefined ? {} : { t: options.t }),
      contextHints: () => [
        ...(this.filter && this.query === '' ? [{ id: 'filter', keys: 'Type', label: 'to search', priority: 85 }] : []),
        ...(this.query.length === 0 && this.options.onToggle !== undefined
          ? [{ id: 'toggle', keys: this.options.keymap.getKeys(ACTION_TOGGLE)[0] ?? 'Space', label: 'toggle', priority: 95 }]
          : []),
        ...(this.options.contextHints ?? []),
      ],
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
    this.focusCursor()
  }

  handleInput(data: string): void {
    const view = this.filtered()
    if (this.query.length === 0 && this.options.onToggle !== undefined && this.options.keymap.matches(data, ACTION_TOGGLE)) {
      const row = view[this.cursor]
      if (row === undefined) return
      this.options.onToggle(row)
      const next = this.filtered()
      const anchored = next.findIndex(candidate => candidate.value === row.value)
      this.cursor = anchored >= 0 ? anchored : 0
      this.focusCursor()
      return
    }
    if (this.options.keymap.matches(data, ACTION_CANCEL)) {
      if (this.filterEditing) {
        this.filterEditing = false
        this.adapter.invalidate()
      } else this.adapter.handleInput(data)
      return
    }
    const movement = this.options.keymap.matches(data, ACTION_MOVE_UP) ? -1
      : this.options.keymap.matches(data, ACTION_MOVE_DOWN) ? 1
        : data === '\x1b[5~' ? -MAX_LIST_VISIBLE
          : data === '\x1b[6~' ? MAX_LIST_VISIBLE
            : data === '\x1b[H' ? -Infinity
              : data === '\x1b[F' ? Infinity
                : undefined
    if (movement !== undefined) {
      this.moveCursor(view, movement)
      return
    }
    if (!this.filter) { this.adapter.handleInput(data); return }
    if (data === '\x7f') {
      this.query = this.query.slice(0, -1)
      this.reseedCursor()
      this.focusCursor()
      return
    }
    if (data.length === 1 && data >= ' ') {
      this.filterEditing = true
      this.query += data
      this.reseedCursor()
      this.options.onCursorChanged?.(this.cursor, this.filtered())
      this.focusCursor()
      return
    }
    this.adapter.handleInput(data)
  }

  invalidate(): void { this.adapter.invalidate() }
  render(width: number): string[] { return this.adapter.render(width) }
  currentFocusIdentity(): BlueFocusIdentity | undefined { return this.adapter.currentFocusIdentity() }

  currentNode(): BlueUiNode {
    const t = this.options.t ?? ((value: string) => value)
    const view = this.filtered()
    const selected = view[this.cursor]
    const start = windowStart(this.cursor, view.length)
    const visible = view.slice(start, start + MAX_LIST_VISIBLE)
    const footer = [
      this.options.footer === undefined ? undefined : t(this.options.footer),
      counterRow(this.cursor, view.length, MAX_LIST_VISIBLE),
    ].filter((value): value is string => value !== undefined && value !== '')
    const list = {
      kind: 'list' as const,
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
    }
    const footerNode: BlueUiNode | undefined = this.query === ''
      ? footer.length === 0 ? undefined : { kind: 'text', content: footer.join(' · '), tone: 'muted' }
      : {
          kind: 'stack', direction: 'column', gap: 1,
          children: [
            ...footer.length === 0 ? [] : [{ node: { kind: 'text' as const, content: footer.join(' · '), tone: 'muted' as const } }],
            { node: { kind: 'actions', id: 'select-list-filter-actions', items: [{ id: 'select-list-clear-filter', label: t('Clear filter') }] } },
          ],
        }
    return {
      kind: 'surface',
      chrome: 'overlay',
      title: this.options.title === undefined ? t('Select') : t(this.options.title),
      child: list,
      ...(footerNode === undefined ? {} : { footer: footerNode }),
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

  private moveCursor(view: readonly SelectRow[], movement: number): void {
    if (view.length === 0) return
    if (!Number.isFinite(movement)) {
      const target = movement < 0
        ? view.findIndex(row => row.disabled !== true)
        : view.findLastIndex(row => row.disabled !== true)
      if (target < 0 || target === this.cursor) return
      this.cursor = target
      const row = view[target]!
      this.options.onHighlight?.(row)
      this.options.onCursorChanged?.(target, view)
      this.focusCursor()
      return
    }
    const direction = movement < 0 ? -1 : 1
    let remaining = Math.max(1, Math.abs(movement))
    let next = this.cursor
    let target = -1
    while (remaining > 0) {
      const candidate = next + direction
      if (candidate < 0 || candidate >= view.length) break
      next = candidate
      if (view[next]!.disabled !== true) {
        target = next
        remaining -= 1
      }
    }
    if (target < 0 || target === this.cursor) return
    this.cursor = target
    const row = view[target]!
    this.options.onHighlight?.(row)
    this.options.onCursorChanged?.(target, view)
    this.focusCursor()
  }

  private focusCursor(): void {
    const selected = this.filtered()[this.cursor]
    if (selected === undefined) this.adapter.invalidate()
    else this.adapter.focus({ controlId: 'select-list', itemId: selected.value })
  }

  private onEvent(event: BlueUiEvent): void {
    if (event.kind === 'activate' && event.controlId === 'select-list-clear-filter') {
      this.query = ''
      this.filterEditing = false
      this.reseedCursor()
      const view = this.filtered()
      this.options.onCursorChanged?.(this.cursor, view)
      this.focusCursor()
      return
    }
    if (event.kind !== 'selection-change' || event.controlId !== 'select-list' || typeof event.value !== 'string') return
    const row = this.filtered().find(candidate => candidate.value === event.value)
    if (row === undefined) return
    if (row.disabled === true) this.options.onBlockedSelect?.(row)
    else this.options.onSelect(row)
  }
}
