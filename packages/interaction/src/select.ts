/**
 * `BlueSelect`: the multi-select option-list overlay component, and
 * `BluePanel`, the header-plus-child overlay container. Single-select
 * lists moved to `ctx.blueComponents.createSelectList` (the pi-tui
 * SelectList) until S24b extracted the shared `SelectListPanel`
 * (`select-list.ts`) — now the home of every single-select pick surface
 * (/sessions, /provider, /permission) and the list-geometry helpers.
 * pi-tui ships no multi-select component, so BlueSelect stays as the
 * multi-select-only implementation (checkbox rows, the `selectedBg`
 * cursor) and consumes those helpers for its window and wraparound.
 * Both lists frame themselves with the S12 dialog chrome (`framePanel`).
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
import { SELECT_POINTER } from './symbols.ts'
import { MAX_LIST_VISIBLE, counterRow, cycle, oneLine, windowedRange } from './select-list.ts'

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
      this.cursor = cycle(this.cursor, items.length, -1)
      return
    }
    if (keymap.matches(data, ACTION_MOVE_DOWN)) {
      this.cursor = cycle(this.cursor, items.length, 1)
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
    const { start, end } = windowedRange(this.cursor, items.length, MAX_LIST_VISIBLE)
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
    const counter = counterRow(this.cursor, items.length, MAX_LIST_VISIBLE)
    if (counter !== undefined) lines.push(colors.textMuted(counter))
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
