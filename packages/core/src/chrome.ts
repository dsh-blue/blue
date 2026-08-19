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

import { visibleWidth } from '@earendil-works/pi-tui'

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
