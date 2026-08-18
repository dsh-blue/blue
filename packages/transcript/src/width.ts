/**
 * Minimal terminal-width text helpers for the transcript components.
 *
 * W4 ALIGNMENT: this is a deliberately small stand-in for pi-tui's
 * `visibleWidth`/`wrapTextWithAnsi`, which only `dsh-blue-core` may import.
 * It is exact for ASCII and CJK wide/full-width code points and approximate
 * for emoji sequences and combining marks (counted by broad class, without
 * pi-tui's RGI and spacing-mark tables); emoji ZWJ/flag clusters may wrap
 * mid-cluster. When core grows a component factory these helpers should be
 * replaced by it.
 *
 * Styled input may contain only simple SGR sequences (color open/close pairs
 * as produced by `BlueColorFn`, `\x1b[1m`/`\x1b[3m` emphasis and their
 * closers, `\x1b[0m`); the wrapper tracks them as a stack and reopens them
 * after each line break.
 *
 * @module @deepseek-ai/dsh-blue-transcript/width
 */

/** Capturing split pattern keeping each SGR sequence as its own part. */
const SGR_CAPTURE = /(\x1b\[[0-9;]*m)/
/** Matches every SGR sequence (global, for stripping). */
const SGR_GLOBAL = /\x1b\[[0-9;]*m/g

/**
 * Broad East-Asian wide/full-width ranges (Hangul jamo and syllables, CJK
 * radicals through extensions, compatibility ideographs and forms, fullwidth
 * forms, and plane-2/3 ideographs).
 */
const WIDE_PATTERN = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u
const MARK_PATTERN = /\p{Mark}/u

/**
 * Terminal cell width of one ANSI-free code point or grapheme cluster: 2
 * for CJK wide/full-width and pictographic emoji, 0 for combining marks,
 * else 1. Tabs count as 3 columns.
 * @param grapheme - text without escape sequences; clusters are summed per
 *   code point, so multi-codepoint emoji are approximate.
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
 * Visible terminal width of a string, ignoring SGR escape sequences.
 * @param text - the string to measure; tabs count as 3 columns.
 * @returns the width in terminal columns.
 */
export function visibleWidth(text: string): number {
  if (!text) return 0
  const clean = text.includes('\x1b') ? text.replace(SGR_GLOBAL, '') : text
  let width = 0
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(clean)) {
    width += graphemeWidth(segment)
  }
  return width
}

/** Stack of currently open SGR sequences, in open order. */
type StyleStack = string[]

/** Update the SGR stack from one escape sequence. */
function trackSgr(stack: StyleStack, code: string): void {
  // Callers pass only full SGR sequences (`\x1b[...m`), so the parameter
  // list is a plain slice.
  const params = code.slice(2, -1)
  if (params === '0' || params === '') {
    stack.length = 0
    return
  }
  // Closers drop the most recent matching opener; everything else pushes.
  const closers: Record<string, RegExp> = {
    '22': /^\x1b\[[12]m$/,
    '23': /^\x1b\[3m$/,
    '39': /^\x1b\[38;/,
    '49': /^\x1b\[48;/,
  }
  const opener = closers[params]
  if (opener) {
    const index = stack.findLastIndex(open => opener.test(open))
    if (index !== -1) stack.splice(index, 1)
    return
  }
  stack.push(code)
}

/** `\x1b[0m` when any style is open, else the empty string. */
function closeStyles(stack: StyleStack): string {
  return stack.length > 0 ? '\x1b[0m' : ''
}

/** All open styles concatenated, in open order. */
function reopenStyles(stack: StyleStack): string {
  return stack.join('')
}

/**
 * Split styled text into alternating escape-sequence and visible segments.
 * Escape segments carry their literal sequence; visible segments are code
 * points (not grapheme clusters — see the module header's approximation
 * note).
 */
function* segments(text: string): Generator<{ ansi: string } | { char: string }> {
  for (const part of text.split(SGR_CAPTURE)) {
    if (part === '') continue
    if (part.startsWith('\x1b[')) {
      yield { ansi: part }
      continue
    }
    for (const char of part) yield { char }
  }
}

/** One wrap token: a whitespace run, one word, or one CJK/emoji cell. */
interface WrapToken {
  /** The literal text, including any leading escape sequences. */
  text: string
  /** Visible width; zero for pure escape-sequence text. */
  width: number
  /** Whether the token is whitespace (dropped at line starts and wraps). */
  isSpace: boolean
}

/** Split one styled line into wrap tokens. */
function tokenize(line: string): WrapToken[] {
  const tokens: WrapToken[] = []
  let pendingAnsi = ''
  let current = ''
  let currentKind: 'space' | 'word' | null = null

  const flush = (): void => {
    if (!current) return
    tokens.push({ text: current, width: visibleWidth(current), isSpace: currentKind === 'space' })
    current = ''
    currentKind = null
  }

  for (const segment of segments(line)) {
    if ('ansi' in segment) {
      pendingAnsi += segment.ansi
      continue
    }
    const { char } = segment
    const isSpace = char === ' ' || char === '\t'
    const width = graphemeWidth(char)
    // Wide CJK and emoji cells tokenize alone so lines may wrap between
    // them without spaces.
    if (!isSpace && width > 1) {
      flush()
      tokens.push({ text: pendingAnsi + char, width, isSpace: false })
      pendingAnsi = ''
      continue
    }
    const kind = isSpace ? 'space' : 'word'
    if (current && currentKind !== kind) flush()
    if (!current) {
      current = pendingAnsi
      pendingAnsi = ''
    }
    current += char
    currentKind = kind
  }
  flush()
  const last = tokens[tokens.length - 1]
  if (pendingAnsi && last) last.text += pendingAnsi
  return tokens
}

/** Feed one placed token's escape sequences to the SGR stack. */
function trackToken(stack: StyleStack, text: string): void {
  for (const segment of segments(text)) {
    if ('ansi' in segment) trackSgr(stack, segment.ansi)
  }
}

/** Hard-break one over-wide word token code point by code point. */
function breakLongToken(token: WrapToken, width: number, stack: StyleStack, lines: string[]): string {
  let current = ''
  let currentWidth = 0
  for (const segment of segments(token.text)) {
    if ('ansi' in segment) {
      trackSgr(stack, segment.ansi)
      current += segment.ansi
      continue
    }
    const charWidth = graphemeWidth(segment.char)
    if (currentWidth + charWidth > width && currentWidth > 0) {
      lines.push(current + closeStyles(stack))
      current = reopenStyles(stack)
      currentWidth = 0
    }
    current += segment.char
    currentWidth += charWidth
  }
  return current
}

/**
 * Word-wrap styled text so every returned line fits `width` visible columns.
 * Lines break at spaces and between wide CJK/emoji cells; over-wide words
 * hard-break at code points. Open SGR styles close at each break and reopen
 * on the next line.
 * @param text - the text to wrap; may contain `\n` and simple SGR sequences.
 * @param width - the maximum visible columns per line.
 * @returns the wrapped lines, never empty.
 */
export function wrapStyledText(text: string, width: number): string[] {
  const limit = Math.max(1, width)
  const lines: string[] = []
  const stack: StyleStack = []

  const pushLine = (line: string): void => {
    lines.push(line.trimEnd() + closeStyles(stack))
  }

  for (const inputLine of text.split('\n')) {
    if (visibleWidth(inputLine) <= limit) {
      lines.push(inputLine)
      trackToken(stack, inputLine)
      continue
    }
    let current = ''
    let currentWidth = 0
    for (const token of tokenize(inputLine)) {
      if (token.width === 0) {
        current += token.text
        trackToken(stack, token.text)
        continue
      }
      if (currentWidth + token.width > limit) {
        if (token.isSpace) continue
        if (token.width > limit) {
          if (current) {
            pushLine(current)
            current = reopenStyles(stack)
            currentWidth = 0
          }
          current += breakLongToken(token, limit, stack, lines)
          currentWidth = visibleWidth(current)
          continue
        }
        // `current` is always non-empty here: a token within the limit
        // cannot overflow an empty line.
        pushLine(current)
        current = reopenStyles(stack) + token.text
        currentWidth = token.width
        trackToken(stack, token.text)
        continue
      }
      if (token.isSpace && currentWidth === 0) continue
      current += token.text
      currentWidth += token.width
      trackToken(stack, token.text)
    }
    if (current.trim()) pushLine(current)
  }
  return lines.length > 0 ? lines : ['']
}

/**
 * Truncate styled text to at most `width` visible columns, appending `…`
 * (one column) when truncation occurred and closing any SGR style left open
 * by the cut.
 * @param text - the text to truncate; may contain simple SGR sequences.
 * @param width - the maximum visible columns.
 * @returns the truncated text.
 */
export function truncateToWidth(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text
  const limit = Math.max(0, width - 1)
  const stack: StyleStack = []
  let result = ''
  let currentWidth = 0
  for (const segment of segments(text)) {
    if ('ansi' in segment) {
      trackSgr(stack, segment.ansi)
      result += segment.ansi
      continue
    }
    const charWidth = graphemeWidth(segment.char)
    if (currentWidth + charWidth > limit) break
    result += segment.char
    currentWidth += charWidth
  }
  return result + closeStyles(stack) + '…'
}

/**
 * Collapse a multi-line string to one ellipsized line.
 * @param text - the text to flatten.
 * @param maxChars - the maximum string length (not terminal columns) kept.
 * @returns whitespace-collapsed text, ellipsized beyond `maxChars`.
 */
export function ellipsize(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars - 1)}…`
}
