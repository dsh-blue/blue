/**
 * The shared chrome helper layer (D25): pure `string[]` post-processing that
 * turns pi-tui's bare horizontal rules into rounded boxes. Everything here
 * is theme-agnostic math — callers inject the paint function — so the module
 * carries no pi-tui component machinery and no lifecycle; it is re-exported
 * as `@dsh-blue/blue-core/chrome` for the interaction/transcript
 * packages (S11 opens the seam; each function lands with its first real
 * consumer). The algorithms are kimi-code ports kept ANSI-safe: visible
 * columns are located by stripping SGR runs, and styled cells are never
 * clobbered.
 *
 * @module @dsh-blue/blue-core/chrome
 */

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match ANSI SGR escape sequences
const ANSI_SGR = /\x1b\[[0-9;]*m/g

/** Drop every SGR escape sequence, leaving only visible characters. */
function stripSgr(text: string): string {
  return text.replace(ANSI_SGR, '')
}

/**
 * Convert a visible-character index (ANSI-stripped) back into an index into
 * the raw ANSI-bearing string: a sticky-regex walk that skips SGR runs
 * without counting them.
 * @param line - the raw line, SGR escapes allowed.
 * @param visibleIdx - the index into `stripSgr(line)`.
 * @returns the corresponding index into `line`.
 */
function visibleIndexToRaw(line: string, visibleIdx: number): number {
  let visibleCount = 0
  let i = 0
  const re = new RegExp(ANSI_SGR.source, 'y')
  while (i < line.length && visibleCount < visibleIdx) {
    re.lastIndex = i
    const match = re.exec(line)
    if (match !== null && match.index === i) {
      i += match[0].length
    } else {
      visibleCount++
      i++
    }
  }
  return i
}

/**
 * Locate the leading `/command` token on a visible (SGR-stripped) line: the
 * `/` must be the first non-whitespace character (a mid-sentence slash is
 * prose, not a command) and the token ends at the next whitespace; a token
 * containing a second `/` is a path, not a command, and declines.
 * @param visible - the SGR-stripped line.
 * @returns the token's half-open visible range, or `null` when absent.
 */
function leadingSlashTokenRange(visible: string): { start: number, end: number } | null {
  const slashIdx = visible.indexOf('/')
  if (slashIdx < 0) return null
  for (let i = 0; i < slashIdx; i++) {
    if (visible[i] !== ' ' && visible[i] !== '\t') return null
  }
  let endVisible = slashIdx + 1
  while (endVisible < visible.length) {
    const ch = visible[endVisible]
    if (ch === ' ' || ch === '\t') break
    endVisible++
  }
  const visibleToken = visible.slice(slashIdx, endVisible)
  if (visibleToken.slice(1).includes('/')) return null
  return { start: slashIdx, end: endVisible }
}

/**
 * Paint the leading `/command` token of an editor content row (the kimi
 * `highlightFirstSlashToken` port). The row may already carry SGR escapes
 * (the inverse-video cursor), so the token is located through visible-index
 * math and the paint wraps the raw slice — ANSI pass-through survives.
 * @param line - the rendered editor content row.
 * @param paint - the token styling (bold + `primary` at the call site).
 * @returns the repainted row, or `undefined` when no leading slash token
 *   exists on the row.
 */
export function highlightLeadingSlashToken(
  line: string,
  paint: (text: string) => string,
): string | undefined {
  const visible = stripSgr(line)
  const range = leadingSlashTokenRange(visible)
  if (range === null) return undefined
  const rawStart = visibleIndexToRaw(line, range.start)
  const rawEnd = visibleIndexToRaw(line, range.end)
  return line.slice(0, rawStart) + paint(line.slice(rawStart, rawEnd)) + line.slice(rawEnd)
}

/** The editor's horizontal padding; the ghost splices into a padded content row. */
const EDITOR_LEFT_PADDING = 4
/** pi-tui renders the end-of-input cursor as an inverse-video space. */
// oxlint-disable-next-line no-control-regex -- the cursor block is a raw SGR sequence
const CURSOR_BLOCK = '\x1b[7m \x1b[0m'

/**
 * Clip a ghost hint to `maxLen` visible columns with an ellipsis.
 * @param hint - the hint text.
 * @param maxLen - the maximum visible length.
 * @returns the clipped hint, or `''` when there is no room at all.
 */
function truncateHint(hint: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (hint.length <= maxLen) return hint
  if (maxLen === 1) return '…'
  return `${hint.slice(0, maxLen - 1)}…`
}

/**
 * Splice a dimmed argument-hint ghost into an editor content row (the kimi
 * `injectArgumentHint` port). The ghost is purely visual: it lands after the
 * typed text — after the inverse-video cursor block when one is rendered —
 * and consumes the trailing padding, so the row width is preserved; a hint
 * that would overflow the content area is ellipsized instead. When the
 * cursor block sits before trailing non-padding text (cursor mid-text), the
 * row is returned unchanged: the ghost belongs at the end of the input.
 * @param line - the first content row of an editor render (`paddingX: 4`).
 * @param hint - the ghost text, already lead-spaced by the caller.
 * @param textLength - the visible length of the real editor text.
 * @param width - the full render width of the row.
 * @param paint - the ghost styling (`textMuted` at the call site).
 * @returns the row with the ghost spliced in, or the row unchanged when
 *   there is no room or the cursor is mid-text.
 */
export function injectGhostHint(
  line: string,
  hint: string,
  textLength: number,
  width: number,
  paint: (text: string) => string,
): string {
  const cursorIdx = line.indexOf(CURSOR_BLOCK)
  const cursorPresent = cursorIdx !== -1
  if (cursorPresent) {
    // Everything after the cursor block must be padding for the ghost to
    // belong here; otherwise the cursor is mid-text and the hint declines.
    if (stripSgr(line.slice(cursorIdx + CURSOR_BLOCK.length)).trim().length > 0) return line
  }
  const contentWidth = Math.max(1, width - EDITOR_LEFT_PADDING * 2)
  const available = contentWidth - textLength - (cursorPresent ? 1 : 0)
  const trimmed = truncateHint(hint, available)
  if (trimmed.length === 0) return line
  const insertAt = cursorPresent
    ? cursorIdx + CURSOR_BLOCK.length
    : visibleIndexToRaw(line, EDITOR_LEFT_PADDING + textLength)
  const trailing = line.length - insertAt
  return line.slice(0, insertAt) + paint(trimmed) + ' '.repeat(Math.max(0, trailing - trimmed.length))
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
    // Key rows grow with every new panel action; an over-wide footer would
    // crash the renderer's width invariant, so it clips ANSI-safe like the
    // title line (the S23 model-family footer is the first to need it).
    lines.push(truncateToWidth(hintRow(footer, options.footerPaint ?? identity), ruleWidth))
  }
  lines.push(rulePaint('─'.repeat(ruleWidth)))
  // Body rows arrive pre-budgeted by their callers; only a degenerate
  // viewport — narrow enough that the rows' fixed furniture (their
  // two-space indents) already exceeds the frame — can leave them
  // over-wide, and only then does the framer cut (D48). Wider frames
  // emit the body untouched.
  if (width >= FRAME_DEGENERATE_WIDTH) return lines
  return lines.map(line => truncateToWidth(line, Math.max(1, width)))
}

/**
 * Below this width a frame's fixed row furniture (indents, ellipses) no
 * longer fits; the D48 backstop engages.
 */
const FRAME_DEGENERATE_WIDTH = 8

/** Options for {@link topRule}. */
export interface TopRuleOptions {
  /** Title text rendered after the left corner, typically pre-styled (e.g. bold ` BTW `). */
  readonly title?: string
  /** Styling for the title; defaults to unstyled. */
  readonly titlePaint?: (text: string) => string
  /** Hint text rendered after the title and a `─ ` joiner, typically pre-styled. */
  readonly hint?: string
  /** Styling for the hint; defaults to unstyled. */
  readonly hintPaint?: (text: string) => string
  /** Styling for the corners, the joiner, and the dash fill; defaults to unstyled. */
  readonly paint?: (text: string) => string
}

/**
 * Render a panel's top border with an in-border title — the kimi
 * `╭ BTW ─ Esc close ────╮` row. The joiner `─ ` appears only when both a
 * title and a hint are present; the composite title+hint is clipped
 * ANSI-safe (styled text is never cut mid-SGR) with the dash fill taking the
 * remainder of the inner width. Callers guard `width >= 4` before invoking.
 * @param width - the full render width of the panel row.
 * @param options - the title, hint, and their paints.
 * @returns the single top-border row.
 */
export function topRule(width: number, options: TopRuleOptions = {}): string {
  const paint = options.paint ?? identity
  const innerWidth = Math.max(1, width - 2)
  const title = options.title
  const hint = options.hint
  const composite =
    title !== undefined && hint !== undefined
      ? `${(options.titlePaint ?? identity)(title)}${paint('─ ')}${(options.hintPaint ?? identity)(hint)}`
      : title !== undefined
        ? (options.titlePaint ?? identity)(title)
        : hint !== undefined
          ? (options.hintPaint ?? identity)(hint)
          : ''
  const clipped =
    composite === ''
      ? ''
      : visibleWidth(composite) > innerWidth
        ? truncateToWidth(composite, innerWidth, '')
        : composite
  return paint('╭') + clipped + paint('─'.repeat(Math.max(0, innerWidth - visibleWidth(clipped)))) + paint('╮')
}

/**
 * Indent a block of rendered rows by a column gutter: every row gains `n`
 * literal leading spaces, which the side-border post-processing overlays its
 * bars onto only at content rows' outermost literal spaces. The pure-function
 * equivalent of kimi's `GutterContainer(1)` — S13 lands the helper and
 * measures a real terminal before deciding whether any consumer enables it.
 * @param lines - the block's rendered rows.
 * @param n - the gutter width in columns.
 * @returns the indented rows, styling untouched.
 */
export function padColumns(lines: readonly string[], n: number): string[] {
  return lines.map(line => ' '.repeat(n) + line)
}

/**
 * The component-level width backstop (D48): every hand-assembled row —
 * bullet plus wrapped text, indent plus content — passes through the
 * display-width-aware truncate before it leaves `render`. Rows that already
 * fit come back untouched (the truncate fast path), so the cost on healthy
 * widths is one width measurement per row; at degenerate widths (a resize
 * drag crossing two or three columns) the row is cut instead of tripping
 * pi-tui's width guard. The render-exit clamp in terminal.ts is the frame
 * backstop behind this one; a clamped row is still a component bug.
 * @param rows - the assembled rows.
 * @param width - the viewport width the rows were rendered for.
 * @param truncate - the components service's `truncateToWidth`.
 * @returns rows whose visible width never exceeds `width`.
 */
export function clampRowsToWidth(
  rows: readonly string[],
  width: number,
  truncate: (text: string, width: number) => string,
): string[] {
  return rows.map(row => truncate(row, width))
}
