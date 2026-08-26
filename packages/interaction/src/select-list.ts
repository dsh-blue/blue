/**
 * `SelectListPanel`: the shared single-select list panel, plus the small
 * list-geometry helpers (`cycle`, `windowedRange`, `counterRow`) every
 * pick surface reuses. The panel absorbs what `/sessions`, the provider
 * picker, and the `/permission` preset picker each hand-rolled before
 * (S24b): the center-on-cursor window, the `❯ ` pointer row, the
 * `← current` badge, the `(n/m)` scroll counter, and the S12 dialog
 * frame with its title hint. Key resolution goes through
 * `ctx.blueKeymap` actions, styling through `ctx.blueTheme`, and width
 * math through `ctx.blueComponents` — the display quartet callers
 * resolve lazily via `displayServices`.
 *
 * `filter: true` opts a panel into type-to-filter (S30②, `/sessions`
 * being the first consumer): printable characters grow a query, the
 * rows narrow through `fuzzyMatch` over `filterText ?? label`, and
 * Escape clears the query before it cancels (the kimi rule shared with
 * `FrontendPanel`). Opt-in keeps the other six consumers byte-identical.
 *
 * `BlueSelect` keeps its own multi-select checkbox geometry. Grouped,
 * filterable single-select models use the generic `FrontendPanel` consumer.
 *
 * @module @dsh-blue/blue-interaction/select-list
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT, ACTION_TOGGLE } from './keys.ts'
import { SELECT_POINTER } from './symbols.ts'

/** One selectable row of a {@link SelectListPanel}. */
export interface SelectRow {
  /** Stable value passed back through `onSelect`. */
  readonly value: string
  /** User-facing label. */
  readonly label: string
  /**
   * Match text for type-to-filter; defaults to the label. The first
   * consumer is `/sessions`, whose visible label is the session title
   * while the id and date ride in the description.
   */
  readonly filterText?: string
  /** Muted one-line tail rendered after the label (` — ` joined). */
  readonly description?: string
  /** Trailing mark on the row (the `← current` badge, kimi CURRENT_MARK). */
  readonly badge?: string
  /** Enter on the row is refused; `onBlockedSelect` fires instead. */
  readonly disabled?: boolean
}

/** Construction options for {@link SelectListPanel}. */
export interface SelectListPanelOptions {
  /** Keybinding registry used to resolve the list keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the cursor, badge, description, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width measurement/truncation helpers. */
  readonly components: BlueComponents
  /** Rows to choose from, or a query-aware source for interactive trees. */
  readonly rows: readonly SelectRow[] | ((query: string) => readonly SelectRow[])
  /** Dialog title; defaults to `Select`. */
  readonly title?: string
  /** Muted key row rendered beside the title (`· esc cancel · ↵ resume`). */
  readonly titleHint?: string
  /** Optional muted safety/context line rendered below the choices. */
  readonly footer?: string
  /** Seeds the cursor on this row's value (the current entry); head otherwise. */
  readonly initialValue?: string
  /**
   * Opt the panel into type-to-filter (S30②): printable characters grow
   * a query, Backspace shrinks it, and Escape clears it before
   * cancelling. Off by default — the shared consumers are unchanged.
   */
  readonly filter?: boolean
  /** Called after navigation so callers can lazily hydrate the visible page. */
  readonly onCursorChanged?: (cursor: number, rows: readonly SelectRow[]) => void
  /** Enter on an enabled row. */
  readonly onSelect: (row: SelectRow) => void
  /** Enter on a `disabled` row; absent handlers ignore the press. */
  readonly onBlockedSelect?: (row: SelectRow) => void
  /**
   * The cursor moved onto a new row (Up/Down). Absent by default — the
   * first consumer is the `/theme` picker, whose live preview applies the
   * highlighted palette.
   */
  readonly onHighlight?: (row: SelectRow) => void
  /** Space on the focused row while no filter query is live. */
  readonly onToggle?: (row: SelectRow) => void
  /** Escape. */
  readonly onCancel: () => void
}

/** Rows of a list rendered at once; longer lists scroll. */
export const MAX_LIST_VISIBLE = 8

/**
 * Wraparound step over a list: `(i + d + n) % n` with the empty and
 * single-entry degenerate cases pinned to the index itself.
 * @param index - the current index.
 * @param count - the list length.
 * @param delta - the step direction.
 * @returns the next index, always within `[0, count)`.
 */
export function cycle(index: number, count: number, delta: 1 | -1): number {
  if (count <= 1) return Math.max(0, index)
  return ((index + delta) % count + count) % count
}

/**
 * The visible window of a center-on-cursor list, clamped to the bounds.
 * @param cursor - the cursor index.
 * @param count - the list length.
 * @param maxVisible - rows rendered at once.
 * @returns the `[start, end)` index range to render.
 */
export function windowedRange(cursor: number, count: number, maxVisible: number): { start: number, end: number } {
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), count - maxVisible))
  return { start, end: Math.min(start + maxVisible, count) }
}

/**
 * The scroll-position counter row for a windowed list.
 * @param cursor - the cursor index.
 * @param count - the list length.
 * @param maxVisible - rows rendered at once.
 * @returns the `  (i/n)` row to paint muted, or `undefined` while the
 *   list fits the window.
 */
export function counterRow(cursor: number, count: number, maxVisible: number): string | undefined {
  return count > maxVisible ? `  (${cursor + 1}/${count})` : undefined
}

/**
 * Collapse a multi-line string to one line for list rendering: a pure
 * string transform with no width math.
 * @param text - the raw text.
 * @returns the text with line breaks replaced by spaces, trimmed.
 */
export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Single-select list panel: Up/Down wrap the cursor, Enter selects (a
 * `disabled` row blocks the press), Escape cancels. With `filter: true`
 * the panel also narrows to the typed query (fuzzy over
 * `filterText ?? label`; Escape clears the query before cancelling —
 * the kimi rule). The cursor row takes the `❯ ` pointer and the
 * `primary` hue on the label, badges render in `success`, descriptions
 * ride muted inside the row, and the dialog frames itself with the S12
 * chrome (title + full-width rules).
 */
export class SelectListPanel implements BlueFocusable {
  /** Whether the list currently holds focus. Managed by the screen. */
  focused = false

  private cursor: number

  /** The live type-to-filter query (empty while unused). */
  private query = ''

  private readonly filter: boolean

  private rows: readonly SelectRow[]

  /**
   * @param options - see {@link SelectListPanelOptions}.
   */
  constructor(private readonly options: SelectListPanelOptions) {
    this.rows = typeof options.rows === 'function' ? options.rows('') : options.rows
    const seeded = options.initialValue === undefined
      ? -1
      : this.sourceRows().findIndex(row => row.value === options.initialValue)
    this.cursor = seeded >= 0 ? seeded : 0
    this.filter = options.filter === true
  }

  /**
   * Replace the list rows while preserving the selected value when possible.
   * This lets callers show an id/date skeleton immediately and hydrate labels
   * from a slower persistence query without replacing the focused panel.
   * @param rows - the refreshed rows in display order.
   */
  setRows(rows: readonly SelectRow[]): void {
    const current = this.filtered()[this.cursor]?.value
    this.rows = rows
    const view = this.filtered()
    const next = current === undefined ? -1 : view.findIndex(row => row.value === current)
    this.cursor = next >= 0 ? next : Math.min(this.cursor, Math.max(0, view.length - 1))
  }

  /** Resolve static rows or the caller's query-aware row projection. */
  private sourceRows(): readonly SelectRow[] {
    return typeof this.options.rows === 'function'
      ? this.options.rows(this.query)
      : this.rows
  }

  /** The rows under the live query: identity while the filter is off or
   * the query empty, else the fuzzy matches in list order (no re-rank —
   * the shared filterable-list precedent). */
  private filtered(): readonly SelectRow[] {
    const rows = this.sourceRows()
    const { components } = this.options
    if (!this.filter || this.query.length === 0) return rows
    return rows.filter(row => components.fuzzyMatch(this.query, row.filterText ?? row.label).matches)
  }

  /** Re-anchor the cursor after a query change: the `initialValue` row
   * if it survived the filter, else the head of the filtered view. */
  private reseedCursor(): void {
    const { initialValue } = this.options
    const view = this.filtered()
    const seeded = initialValue === undefined
      ? -1
      : view.findIndex(row => row.value === initialValue)
    this.cursor = seeded >= 0 ? seeded : 0
  }

  /**
   * Dispatch one input sequence against the list keybindings, then the
   * type-to-filter bytes when the panel opted in.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap } = this.options
    const view = this.filtered()
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = cycle(this.cursor, view.length, -1)
      this.options.onCursorChanged?.(this.cursor, view)
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = cycle(this.cursor, view.length, 1)
      this.options.onCursorChanged?.(this.cursor, view)
      return
    }
    // Space toggles tree disclosure only before a search starts. Once a
    // query is live it remains an ordinary printable space, preserving
    // multi-word title search.
    if (this.query.length === 0 && this.options.onToggle !== undefined
      && keymap.matches(data, ACTION_TOGGLE)) {
      const row = view[this.cursor]
      if (row === undefined) return
      this.options.onToggle(row)
      const next = this.filtered()
      const anchored = next.findIndex(candidate => candidate.value === row.value)
      this.cursor = anchored >= 0 ? anchored : 0
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      const row = view[this.cursor]
      if (row === undefined) return
      if (row.disabled === true) this.options.onBlockedSelect?.(row)
      else this.options.onSelect(row)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) {
      // The kimi rule: Escape clears a live query before it cancels.
      if (this.filter && this.query.length > 0) {
        this.query = ''
        this.reseedCursor()
        this.options.onCursorChanged?.(this.cursor, this.filtered())
        return
      }
      this.options.onCancel()
      return
    }
    // Type-to-filter bytes (only when opted in; other consumers keep
    // swallowing printables). FrontendPanel matches the same raw bytes —
    // no keymap action exists for these and the freeze holds.
    if (!this.filter) return
    if (data === '\x7f') {
      this.query = this.query.slice(0, -1)
      this.reseedCursor()
      return
    }
    if (data.length === 1 && data >= ' ') {
      this.query += data
      this.reseedCursor()
      this.options.onCursorChanged?.(this.cursor, this.filtered())
    }
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed dialog: the visible window of rows with the
   * cursor pointer, badges, muted descriptions, and a scroll position.
   * A live query paints a `Search:` row above the window and the empty
   * result paints a muted `no matches` row.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { components } = this.options
    const colors = this.options.theme.colors
    const view = this.filtered()
    const lines: string[] = []
    if (this.filter && this.query.length > 0) {
      // Self-truncated: framePanel does not clip body rows (the #15
      // width-discipline lesson), so the composed row must fit itself.
      lines.push(
        components.truncateToWidth(
          `  ${colors.primary('Search: ')}${colors.text(this.query)}`,
          width,
        ),
        '',
      )
    }
    const { start, end } = windowedRange(this.cursor, view.length, MAX_LIST_VISIBLE)
    for (let index = start; index < end; index += 1) {
      const row = view[index]
      /* v8 ignore next -- start/end are clamped to view.length, so the index is always valid */
      if (row === undefined) continue
      const isCursor = index === this.cursor
      const prefix = isCursor ? `${SELECT_POINTER} ` : '  '
      const badge = row.badge === undefined ? '' : `  ${row.badge}`
      const label = components.truncateToWidth(`${prefix}${row.label}${badge}`, Math.max(1, width - 2))
      const descriptionWidth = width - 2 - components.visibleWidth(label)
      const description = row.description !== undefined && descriptionWidth > 4
        ? components.truncateToWidth(` — ${oneLine(row.description)}`, descriptionWidth)
        : ''
      const head = isCursor ? colors.primary(label) : colors.text(label)
      // The composed row already fits: prefix(2) + label(≤ width − 2) +
      // description(the remaining budget), so no post-paint truncation.
      lines.push(`${head}${colors.muted(description)}`)
    }
    if (view.length === 0 && this.filter && this.query.length > 0) {
      lines.push(colors.textMuted('  no matches'))
    }
    const counter = counterRow(this.cursor, view.length, MAX_LIST_VISIBLE)
    if (counter !== undefined) lines.push(colors.textMuted(counter))
    if (this.options.footer !== undefined) {
      lines.push('', colors.textMuted(components.truncateToWidth(`  ${this.options.footer}`, width)))
    }
    lines.push('')
    // The affordance hint rides the title-hint channel (the frame paints
    // it muted): while no query is live, every filtered panel advertises
    // type-to-search, with the caller's own hint fragments behind it.
    const hint = this.filter && this.query.length === 0
      ? this.options.titleHint === undefined
        ? '· type to search'
        : `· type to search ${this.options.titleHint}`
      : this.options.titleHint
    return framePanel(lines, width, {
      title: this.options.title ?? 'Select',
      titlePaint: colors.primary,
      ...hint === undefined ? {} : { titleHint: hint },
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
}
