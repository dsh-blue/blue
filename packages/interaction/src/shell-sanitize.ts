/**
 * Captured shell output can contain terminal control sequences — colours,
 * cursor moves, alternate-screen switches, hyperlinks, `\r` spinners, bells.
 * Blue renders captured text through pi-tui, which passes strings straight
 * to the terminal, so any sequence left intact is executed by the terminal
 * and fights pi-tui's own cursor control (the "blank screen + leftover
 * characters" symptom). These helpers strip everything a terminal would
 * interpret as a command rather than printable text, keeping only `\n` and
 * `\t` (which the renderer understands). This is the Blue port of kimi's
 * `sanitizeShellOutput` (`apps/kimi-code/src/tui/utils/shell-output.ts`).
 *
 * @module @dsh-blue/blue-interaction/shell-sanitize
 */

// ESC [ <params> <intermediates> <final> — colours, cursor moves, clear, and
// private modes such as ESC[?1049h (alt screen) / ESC[?25l (hide cursor).
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match CSI sequences
const CSI_PATTERN = /\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g
// ESC ] … <BEL> or ESC ] … ESC \ — window titles and OSC 8 hyperlinks.
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match OSC sequences
const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
// ESC <char> (and ESC <intermediate> <char>) — charset/keypad selection,
// save/restore cursor (ESC 7 / ESC 8), full reset (ESC c). Runs after the
// CSI/OSC patterns, so it only catches sequences they did not consume.
// oxlint-disable-next-line no-control-regex -- ESC (\x1b) is required to match single-ESC sequences
const ESC_SINGLE_PATTERN = /\x1b(?:[ -/][0-~]|[0-~])/g
// C0 control characters except \n (0x0A) and \t (0x09): NUL, BEL, \b, \r, …
// plus a lone ESC (0x1B) that was not part of a sequence recognised above.
// oxlint-disable-next-line no-control-regex -- the C0 range is the point of this pattern
const C0_CONTROL_PATTERN = /[\x00-\x08\x0B-\x1B\x1C-\x1F]/g

/**
 * Strip every terminal control sequence from captured command output so it
 * is safe to render through pi-tui (which does not sanitize on its own).
 *
 * Never throws: a bad or pathological input falls back to stripping only
 * the C0 control characters, so rendering can never crash the TUI.
 * @param text - the raw captured output, or a non-string for a hostile
 *   shell exit path.
 * @returns the sanitized text.
 */
export function sanitizeShellOutput(text: unknown): string {
  if (typeof text !== 'string') return ''
  if (text.length === 0) return text
  try {
    return text
      .replace(OSC_PATTERN, '')
      .replace(CSI_PATTERN, '')
      .replace(ESC_SINGLE_PATTERN, '')
      .replace(C0_CONTROL_PATTERN, '')
  } catch {
    // The regexes are constants, so nothing here can throw; the fallback is
    // a belt for a pathological engine, not a reachable branch.
    /* v8 ignore next -- unreachable by construction, see above */
    return text.replace(C0_CONTROL_PATTERN, '')
  }
}
