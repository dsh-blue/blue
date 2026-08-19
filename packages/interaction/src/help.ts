/**
 * `HelpOverlay`: the framed `/help` dialog (the S12 kimi HelpPanel port):
 * a primary-ruled frame with a ` help ` title and a muted key hint, the
 * sections as two-column rows (labels padEnd-aligned, descriptions muted),
 * and a scroll window — `showing 1-N of M` — when the content overflows
 * its budget. Escape/Enter/`q` close, arrows and PageUp/PageDown scroll.
 *
 * @module @deepseek-ai/dsh-blue-interaction/help
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@deepseek-ai/dsh-blue-core'
import { framePanel } from '@deepseek-ai/dsh-blue-core/chrome'
import { ACTION_CANCEL, ACTION_SUBMIT } from './keys.ts'

/** Decoded input sequences the overlay handles directly (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'

/** Rows scrolled at once by PageUp/PageDown (kimi value). */
const PAGE_SCROLL = 10

/**
 * Content rows visible without scrolling. The pull-up panel budget (85% of
 * the viewport minus the two-row footer) fits a sixteen-row window on the
 * smallest 24-row terminal the suite renders.
 */
const DEFAULT_MAX_VISIBLE = 16

/** One aligned row of a section. */
export interface HelpRow {
  readonly label: string
  readonly description: string
}

/** One headed group of aligned rows. */
export interface HelpSection {
  readonly heading: string
  readonly rows: readonly HelpRow[]
  /** Styling for the row labels (keys take warning, commands primary). */
  readonly labelPaint?: (text: string) => string
}

/** Construction options for {@link HelpOverlay}. */
export interface HelpOverlayOptions {
  /** Theme supplying the frame, heading, and row colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width helpers. */
  readonly components: BlueComponents
  /** Keymap resolving the close keys (cancel/submit). */
  readonly keymap: BlueKeymap
  /** The sections to list, in display order. */
  readonly sections: readonly HelpSection[]
  /** Called when a close key is pressed. */
  readonly onClose: () => void
  /** Content rows visible without scrolling; defaults to 10. */
  readonly maxVisible?: number
}

/**
 * The scrollable `/help` overlay. Rows wrap at the section's widest label
 * (at least eight columns) with two-column alignment; when the sections
 * exceed {@link maxVisible} rows the window scrolls and a `showing` line
 * replaces the tail.
 */
export class HelpOverlay implements BlueFocusable {
  /** Whether the overlay currently holds focus. Managed by the screen. */
  focused = false

  private scrollTop = 0

  /**
   * @param options - see {@link HelpOverlayOptions}.
   */
  constructor(private readonly options: HelpOverlayOptions) {}

  /**
   * Dispatch one input sequence against the overlay.
   * @param data - the input sequence as read from the terminal.
   */
  handleInput(data: string): void {
    const { keymap } = this.options
    if (
      keymap.matches(data, ACTION_CANCEL)
      || keymap.matches(data, ACTION_SUBMIT)
      || data === 'q'
      || data === 'Q'
    ) {
      this.options.onClose()
      return
    }
    if (data === KEY_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - 1)
      return
    }
    if (data === KEY_DOWN) {
      this.scrollTop += 1 // render clamps
      return
    }
    if (data === KEY_PAGE_UP) {
      this.scrollTop = Math.max(0, this.scrollTop - PAGE_SCROLL)
      return
    }
    if (data === KEY_PAGE_DOWN) {
      this.scrollTop += PAGE_SCROLL
    }
  }

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the framed dialog: the title line, the scrolled window of
   * section rows (or a `showing 1-N of M` tail when the content overflows),
   * and the closing rule.
   * @param width - current viewport width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const { theme, components } = this.options
    const colors = theme.colors
    const content = this.contentLines(width)
    const maxVisible = Math.max(5, this.options.maxVisible ?? DEFAULT_MAX_VISIBLE)
    const body: string[] = []
    if (content.length > maxVisible) {
      this.scrollTop = Math.max(0, Math.min(this.scrollTop, content.length - maxVisible))
      const slice = content.slice(this.scrollTop, this.scrollTop + maxVisible)
      body.push(...slice)
      body.push(colors.textMuted(components.truncateToWidth(
        ` showing ${String(this.scrollTop + 1)}-${String(this.scrollTop + slice.length)} of ${String(content.length)}`,
        width,
      )))
    } else {
      this.scrollTop = 0
      body.push(...content)
    }
    return framePanel(body, width, {
      title: 'help',
      titlePaint: colors.primary,
      titleHint: '· Esc / Enter / q to cancel · ↑↓ scroll',
      hintPaint: colors.textMuted,
      rulePaint: colors.primary,
    })
  }

  /** The section rows between the title and the scroll window. */
  private contentLines(width: number): string[] {
    const { theme, components, sections } = this.options
    const colors = theme.colors
    const lines: string[] = []
    for (const section of sections) {
      const labelWidth = Math.max(8, ...section.rows.map(row => row.label.length))
      const paint = section.labelPaint ?? ((text: string): string => text)
      lines.push('')
      lines.push(`  ${components.truncateToWidth(colors.textStrong(section.heading), Math.max(1, width - 4))}`)
      for (const row of section.rows) {
        const styled = `${paint(row.label.padEnd(labelWidth))}  ${colors.muted(row.description)}`
        lines.push(`    ${components.truncateToWidth(styled, Math.max(1, width - 4))}`)
      }
    }
    return lines
  }
}
