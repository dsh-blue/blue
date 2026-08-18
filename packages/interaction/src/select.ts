/**
 * `BlueSelect`: the MVP option-list overlay component (single- and
 * multi-select) and `BluePanel`, the header-plus-child overlay container.
 * Self-contained in this package; key resolution goes through
 * `ctx.blueKeymap`, styling through `ctx.blueTheme`.
 *
 * @module @deepseek-ai/dsh-blue-interaction/select
 */

import type { BlueComponent, BlueFocusable, BlueKeymap, BlueTheme } from '@deepseek-ai/dsh-blue-core'
import {
  ACTION_CANCEL,
  ACTION_MOVE_DOWN,
  ACTION_MOVE_UP,
  ACTION_SUBMIT,
  ACTION_TOGGLE,
} from './keys.ts'
import { oneLine, truncate, visibleWidth } from './text.ts'

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
  /** Entries to choose from; must not be empty. */
  readonly items: readonly BlueSelectItem[]
  /** Whether Space toggles additional entries before confirming. */
  readonly multiSelect?: boolean
  /**
   * Called with the confirmed entries: the toggled ones for a multi-select
   * (the focused entry when nothing was toggled), the focused entry
   * otherwise.
   * @param items - the confirmed entries, never empty.
   */
  readonly onConfirm: (items: BlueSelectItem[]) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel: () => void
}

/** Rows of items rendered at once; longer lists scroll. */
const MAX_VISIBLE = 8

/**
 * Option-list overlay: Up/Down wrap the cursor, Space toggles in
 * multi-select mode, Enter confirms, Escape cancels.
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
    if (this.options.multiSelect === true && keymap.matches(data, ACTION_TOGGLE)) {
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
   * Render the visible window of items with cursor, toggle marks, and a
   * footer hint generated from the registered key bindings.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { items } = this.options
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
      const prefix = index === this.cursor ? '→ ' : '  '
      const checkbox = this.options.multiSelect === true
        ? this.toggled.has(item.value) ? '[x] ' : '[ ] '
        : ''
      const label = truncate(`${checkbox}${item.label}`, Math.max(1, width - 2))
      const descriptionWidth = width - 2 - visibleWidth(label)
      const description = item.description !== undefined && descriptionWidth > 4
        ? truncate(` — ${oneLine(item.description)}`, descriptionWidth)
        : ''
      const row = index === this.cursor
        ? colors.accent(`${prefix}${label}`) + colors.muted(description)
        : `${prefix}${label}${colors.muted(description)}`
      lines.push(row)
    }
    if (items.length > MAX_VISIBLE) {
      lines.push(colors.muted(`  (${this.cursor + 1}/${items.length})`))
    }
    lines.push(colors.muted(truncate(this.footer(), width)))
    return lines
  }

  /** Entries a confirm would return right now. */
  private confirmed(): BlueSelectItem[] {
    const { items } = this.options
    if (this.options.multiSelect === true) {
      const chosen = items.filter(item => this.toggled.has(item.value))
      if (chosen.length > 0) return [...chosen]
    }
    const focused = items[this.cursor]
    return focused === undefined ? [] : [focused]
  }

  /** Footer hint text from the currently bound keys. */
  private footer(): string {
    const { keymap } = this.options
    const key = (action: string): string => keymap.getKeys(action)[0] ?? action
    const parts = [
      `${key(ACTION_MOVE_UP)}/${key(ACTION_MOVE_DOWN)} move`,
      ...this.options.multiSelect === true ? [`${key(ACTION_TOGGLE)} toggle`] : [],
      `${key(ACTION_SUBMIT)} confirm`,
      `${key(ACTION_CANCEL)} cancel`,
    ]
    return `  ${parts.join(' · ')}`
  }
}

/**
 * Overlay container stacking pre-styled header lines above a focusable
 * child (select list or input). Header lines must fit the overlay width;
 * callers truncate before styling so ANSI sequences are never cut.
 */
export class BluePanel implements BlueFocusable {
  /**
   * @param header - pre-styled header rows rendered above the child.
   * @param child - the interactive body receiving focus and input.
   */
  constructor(
    private readonly header: readonly string[],
    private readonly child: BlueFocusable & BlueComponent,
  ) {}

  /** Focus state of the wrapped child. Managed by the screen. */
  get focused(): boolean {
    return this.child.focused
  }

  set focused(value: boolean) {
    this.child.focused = value
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
