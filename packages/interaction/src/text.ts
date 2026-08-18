/**
 * Plain-text helpers shared by the interaction components. These operate on
 * unstyled text only; callers truncate before applying theme colors so ANSI
 * sequences are never cut.
 *
 * @module @deepseek-ai/dsh-blue-interaction/text
 */

/** Grapheme segmenter behind {@link graphemes} (user-perceived characters). */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })

/**
 * Split text into grapheme clusters so editing and width math never break
 * a complex character (emoji, combining marks) into parts.
 * @param text - the raw text.
 * @returns one string per grapheme cluster.
 */
export function graphemes(text: string): string[] {
  return [...segmenter.segment(text)].map(part => part.segment)
}

/**
 * Broad East-Asian wide/full-width ranges, mirroring the transcript's
 * `width.ts` stand-in (kept per package while core grows no width service).
 */
const WIDE_PATTERN = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u
const MARK_PATTERN = /\p{Mark}/u

/**
 * Terminal cell width of one grapheme cluster: 2 for CJK wide/full-width
 * and pictographic emoji, 0 for combining marks, else 1. Tabs count as 3
 * columns. Rendering must budget in these cells, never in grapheme counts:
 * CJK text occupies two columns per grapheme and overflows otherwise.
 * @param grapheme - one cluster from {@link graphemes}.
 * @returns the width in terminal columns.
 */
export function graphemeWidth(grapheme: string): number {
  if (grapheme === '\t') return 3
  if (EMOJI_PATTERN.test(grapheme)) return 2
  let width = 0
  for (const char of grapheme) {
    if (WIDE_PATTERN.test(char)) width += 2
    else if (!MARK_PATTERN.test(char)) width += 1
  }
  return width
}

/**
 * Visible terminal width of plain (unstyled) text.
 * @param text - the text to measure; tabs count as 3 columns.
 * @returns the width in terminal columns.
 */
export function visibleWidth(text: string): number {
  let width = 0
  for (const char of graphemes(text)) width += graphemeWidth(char)
  return width
}

/**
 * Collapse a multi-line string to one line for list and header rendering.
 * @param text - the raw text.
 * @returns the text with line breaks replaced by spaces, trimmed.
 */
export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Truncate plain text to a column budget, appending an ellipsis when cut.
 * Budgets are terminal columns: wide CJK/emoji graphemes count as two.
 * @param text - the raw text.
 * @param width - the column budget.
 * @returns the text fitting within `width` columns.
 */
export function truncate(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text
  if (width <= 0) return ''
  const limit = width - 1
  let out = ''
  let used = 0
  for (const char of graphemes(text)) {
    const columns = graphemeWidth(char)
    if (used + columns > limit) break
    out += char
    used += columns
  }
  return `${out}…`
}

/**
 * Whether a decoded input sequence is printable text (not a control
 * sequence): rejects C0 controls, DEL, and C1 controls, so escape sequences
 * and key events never reach the text buffer.
 * @param data - the input sequence as read from the terminal.
 * @returns whether every character is printable.
 */
export function isPrintable(data: string): boolean {
  if (data.length === 0) return false
  return !graphemes(data).some((char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
  })
}
