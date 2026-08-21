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
 * `BlueSelect` (the multi-select checkbox list) and `ModelPanel` (the
 * tabbed, type-to-search model picker) keep their own geometry: the
 * former toggles rather than selects, the latter interleaves tab and
 * search chrome the plain list shape cannot carry (revisit when a
 * second tabbed panel appears). Both consume the helpers.
 *
 * @module @dsh-blue/blue-interaction/select-list
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import { ACTION_CANCEL, ACTION_MOVE_DOWN, ACTION_MOVE_UP, ACTION_SUBMIT } from './keys.ts'
import { SELECT_POINTER } from './symbols.ts'

/** One selectable row of a {@link SelectListPanel}. */
export interface SelectRow {
  /** Stable value passed back through `onSelect`. */
  readonly value: string
  /** User-facing label. */
  readonly label: string
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
  /** Rows to choose from, in list order. */
  readonly rows: readonly SelectRow[]
  /** Dialog title; defaults to `Select`. */
  readonly title?: string
  /** Muted key row rendered beside the title (`· esc cancel · ↵ resume`). */
  readonly titleHint?: string
  /** Seeds the cursor on this row's value (the current entry); head otherwise. */
  readonly initialValue?: string
  /** Enter on an enabled row. */
  readonly onSelect: (row: SelectRow) => void
  /** Enter on a `disabled` row; absent handlers ignore the press. */
  readonly onBlockedSelect?: (row: SelectRow) => void
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
 * `disabled` row blocks the press), Escape cancels. The cursor row
 * takes the `❯ ` pointer and the `primary` hue on the label, badges
 * render in `success`, descriptions ride muted inside the row, and the
 * dialog frames itself with the S12 chrome (title + full-width rules).
 */
export class SelectListPanel implements BlueFocusable {
  /** Whether the list currently holds focus. Managed by the screen. */
  focused = false

  private cursor: number

  /**
   * @param options - see {@link SelectListPanelOptions}.
   */
  constructor(private readonly options: SelectListPanelOptions) {
    const seeded = options.initialValue === undefined
      ? -1
      : options.rows.findIndex(row => row.value === options.initialValue)
    this.cursor = seeded >= 0 ? seeded : 0
  }

  /**
   * Dispatch one input sequence against the list keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap, rows } = this.options
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = cycle(this.cursor, rows.length, -1)
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = cycle(this.cursor, rows.length, 1)
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      const row = rows[this.cursor]
      if (row === undefined) return
      if (row.disabled === true) this.options.onBlockedSelect?.(row)
      else this.options.onSelect(row)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed dialog: the visible window of rows with the
   * cursor pointer, badges, muted descriptions, and a scroll position.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { rows, components } = this.options
    const colors = this.options.theme.colors
    const { start, end } = windowedRange(this.cursor, rows.length, MAX_LIST_VISIBLE)
    const lines: string[] = []
    for (let index = start; index < end; index += 1) {
      const row = rows[index]
      /* v8 ignore next -- start/end are clamped to rows.length, so the index is always valid */
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
    const counter = counterRow(this.cursor, rows.length, MAX_LIST_VISIBLE)
    if (counter !== undefined) lines.push(colors.textMuted(counter))
    lines.push('')
    const titleHint = this.options.titleHint
    return framePanel(lines, width, {
      title: this.options.title ?? 'Select',
      titlePaint: colors.primary,
      ...titleHint === undefined ? {} : { titleHint },
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
}
