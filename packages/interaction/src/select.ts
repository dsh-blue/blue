/**
 * `BlueSelect`: the multi-select option-list overlay component,
 * `SessionList`: the single-select session picker list, and `BluePanel`,
 * the header-plus-child overlay container. Single-select lists moved to
 * `ctx.blueComponents.createSelectList` (the pi-tui SelectList); pi-tui
 * ships no multi-select component, so BlueSelect stays as the
 * multi-select-only implementation, and the session picker renders its own
 * kimi-style rows (the `← current` badge needs per-row styling the opaque
 * SelectList cannot carry). Both lists frame themselves with the S12
 * dialog chrome (`framePanel`): title, full-width rules, and a key row.
 * Key resolution goes through `ctx.blueKeymap`, styling through
 * `ctx.blueTheme`, and width math through `ctx.blueComponents`.
 *
 * @module @dsh-blue/blue-interaction/select
 */

import type { BlueComponent, BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import {
  ACTION_CANCEL,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_SUBMIT,
  ACTION_TOGGLE,
} from './keys.ts'
import { CURRENT_MARK, SELECT_POINTER } from './symbols.ts'

/** One selectable entry. */
export interface BlueSelectItem {
  /** Stable value returned on confirm. */
  readonly value: string
  /** User-facing label. */
  readonly label: string
  /** Optional extra context rendered after the label. */
  readonly description?: string
}

/** Construction options for {@link BlueSelect}. */
export interface BlueSelectOptions {
  /** Keybinding registry used to resolve the list keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the selected-row, description, and hint colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width measurement/truncation helpers. */
  readonly components: BlueComponents
  /** Entries to choose from; must not be empty. */
  readonly items: readonly BlueSelectItem[]
  /** Dialog title; defaults to `Select`. */
  readonly title?: string
  /**
   * Called with the confirmed entries: the toggled ones, or the focused
   * entry when nothing was toggled.
   * @param items - the confirmed entries, never empty unless the list is.
   */
  readonly onConfirm: (items: BlueSelectItem[]) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/** Rows of items rendered at once; longer lists scroll. */
const MAX_VISIBLE = 8

/**
 * Collapse a multi-line string to one line for list rendering: a pure
 * string transform with no width math, kept local to this module.
 * @param text - the raw text.
 * @returns the text with line breaks replaced by spaces, trimmed.
 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Multi-select option-list overlay: Up/Down wrap the cursor, Space toggles,
 * Enter confirms the toggled set (the focused entry when nothing was
 * toggled), Escape cancels.
 */
export class BlueSelect implements BlueFocusable {
  /** Whether the list currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0
  private readonly toggled = new Set<string>()

  /**
   * @param options - see {@link BlueSelectOptions}.
   */
  constructor(private readonly options: BlueSelectOptions) {}

  /**
   * Dispatch one input sequence against the list keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap, items } = this.options
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = this.cursor === 0 ? items.length - 1 : this.cursor - 1
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = this.cursor === items.length - 1 ? 0 : this.cursor + 1
      return
    }
    if (keymap.matches(data, ACTION_TOGGLE)) {
      const value = items[this.cursor]?.value
      if (value !== undefined) {
        if (this.toggled.has(value)) this.toggled.delete(value)
        else this.toggled.add(value)
      }
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      this.options.onConfirm(this.confirmed())
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed dialog: the visible window of items with cursor,
   * toggle marks, a scroll position, and a footer key row generated from
   * the registered key bindings. The cursor row carries the full-width
   * `selectedBg` (the token's first real use) so the background never
   * breaks mid-line.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { items, components } = this.options
    const colors = this.options.theme.colors
    const start = Math.max(0, Math.min(
      this.cursor - Math.floor(MAX_VISIBLE / 2),
      items.length - MAX_VISIBLE,
    ))
    const end = Math.min(start + MAX_VISIBLE, items.length)
    const lines: string[] = []
    for (let index = start; index < end; index += 1) {
      const item = items[index]
      /* v8 ignore next -- start/end are clamped to items.length, so the index is always valid */
      if (item === undefined) continue
      const prefix = index === this.cursor ? `${SELECT_POINTER} ` : '  '
      const checkbox = this.toggled.has(item.value) ? '[x] ' : '[ ] '
      const label = components.truncateToWidth(`${checkbox}${item.label}`, Math.max(1, width - 2))
      const descriptionWidth = width - 2 - components.visibleWidth(label)
      const description = item.description !== undefined && descriptionWidth > 4
        ? components.truncateToWidth(` — ${oneLine(item.description)}`, descriptionWidth)
        : ''
      const row = `${prefix}${label}${colors.muted(description)}`
      if (index === this.cursor) {
        // Pad the row to the full width before wrapping it in the
        // background so the highlight spans the dialog edge to edge.
        const truncated = components.truncateToWidth(row, width)
        const padding = ' '.repeat(Math.max(0, width - components.visibleWidth(truncated)))
        lines.push(colors.selectedBg(truncated + padding))
      } else {
        lines.push(row)
      }
    }
    // Long selections (a discovery adopt list) window instead of spilling
    // the screen — the S23 dogfood ruling for every list surface.
    if (items.length > MAX_VISIBLE) {
      lines.push(colors.textMuted(`  (${this.cursor + 1}/${items.length})`))
    }
    lines.push('')
    return framePanel(lines, width, {
      title: this.options.title ?? 'Select',
      titlePaint: colors.primary,
      rulePaint: colors.primary,
      footer: this.footerParts(),
      footerPaint: colors.textMuted,
    })
  }

  /** Entries a confirm would return right now. */
  private confirmed(): BlueSelectItem[] {
    const { items } = this.options
    const chosen = items.filter(item => this.toggled.has(item.value))
    if (chosen.length > 0) return [...chosen]
    const focused = items[this.cursor]
    return focused === undefined ? [] : [focused]
  }

  /** Footer key-row parts from the currently bound keys. */
  private footerParts(): string[] {
    const { keymap } = this.options
    const key = (action: string): string => keymap.getKeys(action)[0] ?? action
    return [
      `${key(ACTION_MOVE_UP)}/${key(ACTION_MOVE_DOWN)} move`,
      `${key(ACTION_TOGGLE)} toggle`,
      `${key(ACTION_SUBMIT)} confirm`,
      `${key(ACTION_CANCEL)} cancel`,
    ]
  }
}

/** One selectable session row. */
export interface SessionListItem {
  /** Stable value returned on confirm. */
  readonly value: string
  /** User-facing label. */
  readonly label: string
  /** Renders the `← current` badge after the label (kimi CURRENT_MARK). */
  readonly current?: boolean
}

/** Construction options for {@link SessionList}. */
export interface SessionListOptions {
  /** Keybinding registry used to resolve the list keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the cursor, badge, and rule colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width measurement/truncation helpers. */
  readonly components: BlueComponents
  /** Sessions to choose from, newest first. */
  readonly items: readonly SessionListItem[]
  /** Dialog title; defaults to `Sessions`. */
  readonly title?: string
  /** Muted key row rendered under the title. */
  readonly titleHint?: string
  /** Called with the focused entry when the confirm key is pressed. */
  readonly onSelect: (item: SessionListItem) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/**
 * Single-select session picker: Up/Down wrap the cursor, Enter selects,
 * Escape cancels. The cursor row takes the `❯ ` pointer in `primary`, and
 * the current session carries a `← current` badge; the dialog frames
 * itself with the S12 chrome (title + full-width rules).
 */
export class SessionList implements BlueFocusable {
  /** Whether the list currently holds focus. Managed by the screen. */
  focused = false

  private cursor = 0

  /**
   * @param options - see {@link SessionListOptions}.
   */
  constructor(private readonly options: SessionListOptions) {}

  /**
   * Dispatch one input sequence against the list keybindings.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap, items } = this.options
    if (keymap.matches(data, ACTION_MOVE_UP)) {
      this.cursor = this.cursor === 0 ? items.length - 1 : this.cursor - 1
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = this.cursor === items.length - 1 ? 0 : this.cursor + 1
      return
    }
    if (keymap.matches(data, ACTION_SUBMIT)) {
      const item = items[this.cursor]
      if (item !== undefined) this.options.onSelect(item)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) this.options.onCancel()
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed dialog: the visible window of sessions with the
   * cursor pointer, the current-session badge, and a scroll position.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { items, components } = this.options
    const colors = this.options.theme.colors
    const start = Math.max(0, Math.min(
      this.cursor - Math.floor(MAX_VISIBLE / 2),
      items.length - MAX_VISIBLE,
    ))
    const end = Math.min(start + MAX_VISIBLE, items.length)
    const lines: string[] = []
    for (let index = start; index < end; index += 1) {
      const item = items[index]
      /* v8 ignore next -- start/end are clamped to items.length, so the index is always valid */
      if (item === undefined) continue
      const prefix = index === this.cursor ? `${SELECT_POINTER} ` : '  '
      const badge = item.current === true ? `  ${CURRENT_MARK}` : ''
      const row = components.truncateToWidth(`${prefix}${item.label}${badge}`, width)
      lines.push(index === this.cursor ? colors.primary(row) : row)
    }
    if (items.length > MAX_VISIBLE) {
      lines.push(colors.textMuted(`  (${this.cursor + 1}/${items.length})`))
    }
    lines.push('')
    const titleHint = this.options.titleHint
    return framePanel(lines, width, {
      title: this.options.title ?? 'Sessions',
      titlePaint: colors.primary,
      ...titleHint === undefined ? {} : { titleHint },
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }
}

/**
 * Overlay container stacking pre-styled header lines above a child
 * component (select list or input editor). Header lines must fit the
 * overlay width; callers truncate before styling so ANSI sequences are
 * never cut. Focus is forwarded to the child when the child is focusable.
 */
export class BluePanel implements BlueFocusable {
  private ownFocused = false

  /**
   * @param header - pre-styled header rows rendered above the child.
   * @param child - the interactive body receiving input.
   */
  constructor(
    private readonly header: readonly string[],
    private readonly child: BlueComponent,
  ) {}

  /** Focus state of the panel (and the child, when focusable). Managed by the screen. */
  get focused(): boolean {
    return this.ownFocused
  }

  set focused(value: boolean) {
    this.ownFocused = value
    if (isFocusable(this.child)) this.child.focused = value
  }

  /**
   * Forward one input sequence to the child.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    this.child.handleInput?.(data)
  }

  /** Drop the child's cached render state. */
  invalidate(): void {
    this.child.invalidate()
  }

  /**
   * Render the header rows followed by the child.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    return [...this.header, ...this.child.render(width)]
  }
}

/** Whether a component carries the focus flag (editors do; select lists do not). */
function isFocusable(component: BlueComponent): component is BlueFocusable {
  return 'focused' in component
}
