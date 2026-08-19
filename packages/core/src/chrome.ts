/**
 * The shared chrome helper layer (D25): pure `string[]` post-processing that
 * turns pi-tui's bare horizontal rules into rounded boxes. Everything here
 * is theme-agnostic math — callers inject the paint function — so the module
 * carries no pi-tui component machinery and no lifecycle; it is re-exported
 * as `@deepseek-ai/dsh-blue-core/chrome` for the interaction/transcript
 * packages (S11 opens the seam; each function lands with its first real
 * consumer). The algorithms are the kimi-code ports of
 * `wrapWithSideBorders` / `injectPromptSymbol`, kept ANSI-safe: visible
 * columns are located by stripping SGR runs, and styled cells are never
 * clobbered.
 *
 * @module @deepseek-ai/dsh-blue-core/chrome
 */

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences
const ANSI_SGR = /\x1b\[[0-9;]*m/g

/** Drop every SGR escape sequence, leaving only visible characters. */
function stripSgr(text: string): string {
  return text.replace(ANSI_SGR, '')
}

/** Options for {@link withSideBorders}. */
export interface SideBordersOptions {
  /** Draw `├┤` top corners instead of `╭╮` (a panel is docked above). */
  readonly connectedAbove?: boolean
  /**
   * Pre-styled text overlaid on the left of the top border (e.g. a mode
   * badge), replacing the leading dash run. Never applied to a scroll
   * indicator row.
   */
  readonly label?: string | undefined
}

/**
 * Post-process a bordered block's rows into a full box: pi-tui-style rows
 * whose first visible character is `─` (plain rules and `── ↑ N more ──`
 * scroll indicators alike) gain `╭╮` / `╰╯` corners — `├┤` on top when
 * `connectedAbove` — and are repainted as one box-drawn span. Content rows
 * keep their inner SGR intact; `│` is overlaid on column 0 and the last
 * column only when they hold a literal space, which protects the
 * inverse-video cursor an editor can park in the outermost column. The
 * `label` is laid into the top border when its middle is a pure dash run,
 * and only when it fits.
 * @param lines - the block's rendered rows, all padded to one width.
 * @param paint - the border color function for corners, bars, and rules.
 * @param options - corner style and top-border label.
 * @returns the boxed rows, width preserved.
 */
export function withSideBorders(
  lines: string[],
  paint: (text: string) => string,
  options: SideBordersOptions = {},
): string[] {
  let seenTop = false
  return lines.map(line => {
    const plain = stripSgr(line)
    if (plain.length > 0 && plain[0] === '─') {
      const leftCorner = seenTop ? '╰' : options.connectedAbove === true ? '├' : '╭'
      const rightCorner = seenTop ? '╯' : options.connectedAbove === true ? '┤' : '╮'
      const isTop = !seenTop
      seenTop = true
      if (plain.length === 1) return paint(leftCorner)
      const middle = plain.slice(1, -1)
      if (isTop && options.label !== undefined && /^─+$/.test(middle)) {
        const labelWidth = visibleWidth(options.label)
        if (labelWidth <= middle.length) {
          return (
            paint(leftCorner)
            + options.label
            + paint('─'.repeat(middle.length - labelWidth))
            + paint(rightCorner)
          )
        }
      }
      return paint(leftCorner + middle + rightCorner)
    }
    if (line.length === 0) return line
    // charAt (not indexing): a plain `string` return keeps the impossible
    // `undefined` arm of noUncheckedIndexedAccess out of the branch count.
    const firstCh = line.charAt(0)
    const lastCh = line.charAt(line.length - 1)
    const head = firstCh === ' ' ? paint('│') : firstCh
    const tail = line.length > 1 && lastCh === ' ' ? paint('│') : lastCh
    if (line.length === 1) return head
    return head + line.slice(1, -1) + tail
  })
}

/**
 * Overlay a terminal-style prompt symbol on an editor content row. The row
 * must start with four literal spaces (`paddingX: 4`): columns 0-1 stay
 * blank for the side border and its gap, the symbol lands in column 2, and
 * column 3 separates it from the content. Without `paint` the symbol emits
 * no SGR and renders in the terminal's default foreground.
 * @param line - the first content row of an editor render.
 * @param symbol - the one-character prompt symbol.
 * @param paint - optional color function for the symbol.
 * @returns the row with the symbol overlaid, or `undefined` when the row is
 *   too short or does not begin with the expected padding.
 */
export function injectPromptSymbol(
  line: string,
  symbol: string,
  paint?: (text: string) => string,
): string | undefined {
  if (line.length < 4) return undefined
  for (let i = 0; i < 4; i++) {
    if (line[i] !== ' ') return undefined
  }
  const rendered = paint === undefined ? symbol : paint(symbol)
  return '  ' + rendered + ' ' + line.slice(4)
}

/**
 * Join key-hint parts into one dialog footer row: `↑/↓ select · 1-4 choose ·
 * ↵ confirm`. Parts are joined with ` · ` (the kimi convention) and the row
 * is indented two columns so it never sits flush against the surrounding
 * rule.
 * @param parts - the key-hint fragments, already styled if they carry color.
 * @param paint - the color function for the joiners and the indent.
 * @returns the rendered footer row.
 */
export function hintRow(parts: readonly string[], paint: (text: string) => string): string {
  return paint(`  ${parts.join(' · ')}`)
}

/** Options for {@link framePanel}. */
export interface FramePanelOptions {
  /** Title text rendered on its own line under the top rule, indented two columns. */
  readonly title?: string
  /** Styling for the title line; defaults to unstyled. */
  readonly titlePaint?: (text: string) => string
  /** Muted hint appended to the title line after a space (lead with `· `). */
  readonly titleHint?: string
  /** Styling for the title hint; defaults to unstyled. */
  readonly hintPaint?: (text: string) => string
  /** Key-row parts rendered as a footer above the bottom rule. */
  readonly footer?: readonly string[]
  /** Styling for the footer row; defaults to unstyled. */
  readonly footerPaint?: (text: string) => string
  /** Styling for the top and bottom rules; defaults to unstyled. */
  readonly rulePaint?: (text: string) => string
}

const identity = (text: string): string => text

/**
 * Frame a dialog body in the kimi full-width-rule style: a `─` rule, an
 * optional title line (with an optional muted hint on the same line), the
 * body rows, an optional key-row footer, and a closing `─` rule. Dialogs
 * use flat rules — never the rounded corners of {@link withSideBorders},
 * which belong to panels and the editor. The rules span the full render
 * width even when the body truncates shorter; title, hint, and footer are
 * ANSI-safe truncated so styled text is never cut mid-SGR.
 * @param body - the dialog's content rows, already rendered at `width`.
 * @param width - the render width the rules and truncation use.
 * @param options - title, hint, footer, and their paints.
 * @returns the framed rows, width preserved.
 */
export function framePanel(
  body: readonly string[],
  width: number,
  options: FramePanelOptions = {},
): string[] {
  const ruleWidth = Math.max(1, width)
  const rulePaint = options.rulePaint ?? identity
  const lines: string[] = [rulePaint('─'.repeat(ruleWidth))]
  const title = options.title
  if (title !== undefined) {
    const titlePaint = options.titlePaint ?? identity
    const hint = options.titleHint
    if (hint === undefined) {
      lines.push(truncateToWidth(titlePaint(`  ${title}`), ruleWidth))
    } else {
      const hintPaint = options.hintPaint ?? identity
      // The kimi title line: `  help · Esc / Enter / q to cancel · ↑↓ scroll`
      // — callers lead the hint with `· ` so the join is a single space.
      lines.push(truncateToWidth(`${titlePaint(`  ${title}`)} ${hintPaint(hint)}`, ruleWidth))
    }
  }
  lines.push(...body)
  const footer = options.footer
  if (footer !== undefined && footer.length > 0) {
    lines.push(hintRow(footer, options.footerPaint ?? identity))
  }
  lines.push(rulePaint('─'.repeat(ruleWidth)))
  return lines
}
