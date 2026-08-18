/**
 * `BlueInput`: the MVP single-line input editor as a self-contained
 * {@link BlueFocusable}. Key resolution goes through `ctx.blueKeymap`
 * against the shared interaction actions; styling uses `ctx.blueTheme`.
 * Self-contained in this package because `dsh-blue-core` exposes no pi-tui
 * component wrappers; whether the component sinks into core is re-evaluated
 * once more consumers exist.
 *
 * @module @deepseek-ai/dsh-blue-interaction/editor
 */

import type { BlueFocusable, BlueKeymap, BlueTheme } from '@deepseek-ai/dsh-blue-core'
import {
  ACTION_CANCEL,
  ACTION_CURSOR_LEFT,
  ACTION_CURSOR_RIGHT,
  ACTION_DELETE_BACKWARD,
  ACTION_SUBMIT,
} from './keys.ts'
import { graphemes, graphemeWidth, isPrintable, truncate, visibleWidth } from './text.ts'

/** Construction options for {@link BlueInput}. */
export interface BlueInputOptions {
  /** Keybinding registry used to resolve the editing keys. */
  readonly keymap: BlueKeymap
  /** Theme supplying the prompt and hint colors. */
  readonly theme: BlueTheme
  /** Prompt prefix shown before the text; defaults to `'> '`. */
  readonly prompt?: string
  /**
   * Dynamic hint line rendered below the input (slash-command discovery,
   * notices). Called on every render.
   * @returns the hint text, or `undefined` for no hint line.
   */
  readonly hint?: () => string | undefined
  /** Called after every mutation of the text buffer. */
  readonly onChange?: () => void
  /**
   * Called with the buffer content when the submit key is pressed.
   * @param value - the current buffer content.
   */
  readonly onSubmit?: (value: string) => void
  /** Called when the cancel key is pressed. */
  readonly onCancel?: () => void
}

/** Bracketed-paste markers enabled by the core terminal runtime. */
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/**
 * Single-line input editor with horizontal scrolling and a reverse-video
 * cursor while focused. Bracketed paste is supported when the whole paste
 * arrives in one input chunk; the pasted text is flattened to one line.
 */
export class BlueInput implements BlueFocusable {
  /** Whether the editor currently holds focus. Managed by the screen. */
  focused = false

  private value = ''
  /** Cursor position as a code-point index into the buffer. */
  private cursor = 0
  private readonly prompt: string

  /**
   * @param options - see {@link BlueInputOptions}.
   */
  constructor(private readonly options: BlueInputOptions) {
    this.prompt = options.prompt ?? '> '
  }

  /**
   * Current buffer content.
   * @returns the text.
   */
  getValue(): string {
    return this.value
  }

  /**
   * Replace the buffer content, clamping the cursor into range.
   * @param value - the new text.
   */
  setValue(value: string): void {
    this.value = value
    this.cursor = Math.min(this.cursor, graphemes(value).length)
  }

  /**
   * Dispatch one input sequence: editing keys resolve through the keymap;
   * remaining printable sequences insert at the cursor.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap } = this.options
    if (keymap.matches(data, ACTION_SUBMIT)) {
      this.options.onSubmit?.(this.value)
      return
    }
    if (keymap.matches(data, ACTION_CANCEL)) {
      this.options.onCancel?.()
      return
    }
    if (keymap.matches(data, ACTION_CURSOR_LEFT)) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (keymap.matches(data, ACTION_CURSOR_RIGHT)) {
      this.cursor = Math.min(graphemes(this.value).length, this.cursor + 1)
      return
    }
    if (keymap.matches(data, ACTION_DELETE_BACKWARD)) {
      if (this.cursor === 0) return
      const chars = graphemes(this.value)
      chars.splice(this.cursor - 1, 1)
      this.cursor -= 1
      this.setBuffer(chars)
      return
    }
    if (data.startsWith(PASTE_START) && data.endsWith(PASTE_END)) {
      this.insert(data.slice(PASTE_START.length, -PASTE_END.length).replace(/[\r\n]+/g, ' '))
      return
    }
    if (isPrintable(data)) this.insert(data)
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the prompt line (with reverse-video cursor while focused and
   * horizontal scrolling on overflow) plus the optional hint line. All
   * horizontal math runs in terminal columns: wide graphemes (CJK, emoji)
   * occupy two cells, so a grapheme count would overflow the viewport and
   * trip the renderer's width guard.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const colors = this.options.theme.colors
    // One column past the text budget stays reserved for the cursor glyph.
    const budget = Math.max(0, width - visibleWidth(this.prompt) - 1)
    const cells = graphemes(this.value).map(char => ({ char, columns: graphemeWidth(char) }))
    const total = cells.reduce((sum, cell) => sum + cell.columns, 0)
    // On overflow, scroll right until the columns before the cursor fit the
    // budget; the window then fills from that offset.
    let start = 0
    if (total > budget) {
      let beforeCursor = cells.slice(0, this.cursor).reduce((sum, cell) => sum + cell.columns, 0)
      for (const cell of cells) {
        if (start >= this.cursor || beforeCursor <= budget) break
        beforeCursor -= cell.columns
        start += 1
      }
    }
    let used = 0
    let end = start
    for (const cell of cells.slice(start)) {
      if (used + cell.columns > budget) break
      used += cell.columns
      end += 1
    }
    const visible = cells.slice(start, end).map(cell => cell.char)
    const cursorIndex = Math.min(this.cursor - start, visible.length)
    const before = visible.slice(0, cursorIndex).join('')
    const at = visible[cursorIndex] ?? ' '
    const after = visible.slice(cursorIndex + 1).join('')
    const cursorGlyph = this.focused ? `\x1b[7m${at}\x1b[27m` : at
    const padding = ' '.repeat(Math.max(0, budget - used))
    const line = colors.accent(this.prompt) + before + cursorGlyph + after + padding
    const hint = this.options.hint?.()
    if (hint === undefined) return [line]
    return [line, colors.muted(truncate(hint, width))]
  }

  /**
   * Insert text at the cursor and notify the change listener.
   * @param text - printable text.
   */
  private insert(text: string): void {
    const chars = graphemes(this.value)
    const inserted = graphemes(text)
    chars.splice(this.cursor, 0, ...inserted)
    this.cursor += inserted.length
    this.setBuffer(chars)
  }

  /**
   * Replace the buffer from a code-point array and fire `onChange`.
   * @param chars - the new buffer content.
   */
  private setBuffer(chars: string[]): void {
    this.value = chars.join('')
    this.options.onChange?.()
  }
}
