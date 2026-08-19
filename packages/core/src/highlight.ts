/**
 * Code-fence syntax coloring behind the pi-tui markdown `highlightCode`
 * hook (S10). Ported from kimi-code's `code-highlight.ts`: gate on
 * `supportsLanguage`, highlight with `ignoreIllegals`, and fall back to the
 * uncolored split on unknown languages or highlighter errors so the hook can
 * never change line count. The highlight theme keeps the palette as the only
 * color authority: `string`/`regexp`/`deletion` (cli-highlight's reds) are
 * reset to `base`, which itself is a Blue color fn and therefore re-resolved
 * on every `/theme` switch.
 */

import { highlight, supportsLanguage, type Theme } from 'cli-highlight'

import type { BlueColorFn } from './types.ts'

/**
 * Split fenced code into syntax-highlighted lines.
 * @param code - the raw code block body.
 * @param lang - the info string after the fence, if any.
 * @param base - palette color used for plain runs and the de-reded tokens.
 * @returns one string per input line, never more or fewer.
 */
export function highlightCodeLines(code: string, lang: string | undefined, base: BlueColorFn): string[] {
  const normalized = lang?.trim().toLowerCase()
  if (normalized === undefined || normalized === '' || !supportsLanguage(normalized)) return code.split('\n')
  const theme: Theme = { default: base, string: base, regexp: base, deletion: base }
  try {
    return highlight(code, { language: normalized, ignoreIllegals: true, theme }).split('\n')
  } catch {
    return code.split('\n')
  }
}
