/**
 * `InfoPanel`: the framed read-only two-column panel `/status` and `/usage`
 * mount (S25, the kimi usage/status report shape in Blue's HelpOverlay
 * idiom): headed sections of label/value rows — labels muted and padEnd
 * aligned, values composed of styled segments so a context bar can carry
 * its severity color beside plain counts — over the same scroll window
 * (`showing 1-N of M`) and close keys (Escape/Enter/`q`) as `/help`.
 *
 * @module @dsh-blue/blue-interaction/info-panel
 */

import type { BlueComponents, BlueFocusable, BlueKeymap, BlueTheme } from '@dsh-blue/blue-core'
import { framePanel } from '@dsh-blue/blue-core/chrome'
import { ACTION_CANCEL, ACTION_SUBMIT } from './keys.ts'

/** Decoded input sequences the panel handles directly (no keymap actions). */
const KEY_UP = '\x1b[A'
const KEY_DOWN = '\x1b[B'
const KEY_PAGE_UP = '\x1b[5~'
const KEY_PAGE_DOWN = '\x1b[6~'

/** Rows scrolled at once by PageUp/PageDown (the `/help` value). */
const PAGE_SCROLL = 10

/**
 * Content rows visible without scrolling — the `/help` budget (the panels
 * this component serves stay well under it; the window exists so a
 * narrow-terminal resize never clips rows away invisibly).
 */
const DEFAULT_MAX_VISIBLE = 16

/** The value stylings a segment may request (default `text`). */
export type InfoStyle = 'text' | 'muted' | 'success' | 'warning' | 'error'

/** One styled run of a row's value; consecutive segments join directly. */
export interface InfoSegment {
  readonly text: string
  readonly style?: InfoStyle
}

/** One aligned row: a muted label plus the styled value segments. */
export interface InfoRow {
  readonly label: string
  readonly segments: readonly InfoSegment[]
}

/** One headed group of aligned rows. */
export interface InfoSection {
  readonly heading: string
  readonly rows: readonly InfoRow[]
}

/** Construction options for {@link InfoPanel}. */
export interface InfoPanelOptions {
  /** Theme supplying the frame, heading, and row colors. */
  readonly theme: BlueTheme
  /** Component factory supplying the width helpers. */
  readonly components: BlueComponents
  /** Keymap resolving the close keys (cancel/submit). */
  readonly keymap: BlueKeymap
  /** The panel title rendered in the frame's border. */
  readonly title: string
  /** The sections to list, in display order. */
  readonly sections: readonly InfoSection[]
  /** Called when a close key is pressed. */
  readonly onClose: () => void
  /** Content rows visible without scrolling; defaults to 16. */
  readonly maxVisible?: number
}

/**
 * The scrollable read-only info panel. Labels wrap at the section's widest
 * label (at least eight columns) with two-column alignment; when the
 * sections exceed {@link InfoPanelOptions.maxVisible} rows the window
 * scrolls and a `showing` line replaces the tail.
 */
export class InfoPanel implements BlueFocusable {
  /** Whether the panel currently holds focus. Managed by the screen. */
  focused = false

  private scrollTop = 0

  /**
   * @param options - see {@link InfoPanelOptions}.
   */
  constructor(private readonly options: InfoPanelOptions) {}

  /**
   * Dispatch one input sequence against the panel.
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
   * Render the framed panel: the title line, the scrolled window of section
   * rows (or a `showing 1-N of M` tail when the content overflows), and the
   * closing rule.
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
      title: this.options.title,
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
    const stylePaint = (style: InfoStyle | undefined) => {
      switch (style) {
        case 'muted': return colors.muted
        case 'success': return colors.success
        case 'warning': return colors.warning
        case 'error': return colors.error
        default: return colors.text
      }
    }
    const budget = Math.max(1, width - 4)
    const lines: string[] = []
    for (const section of sections) {
      const labelWidth = Math.max(8, ...section.rows.map(row => row.label.length))
      lines.push('')
      lines.push(`  ${components.truncateToWidth(colors.textStrong(section.heading), budget)}`)
      for (const row of section.rows) {
        const styled = `${colors.muted(row.label.padEnd(labelWidth))}  ${row.segments
          .map(segment => stylePaint(segment.style)(segment.text))
          .join('')}`
        lines.push(`    ${components.truncateToWidth(styled, budget)}`)
      }
    }
    return lines
  }
}
