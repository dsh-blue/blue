/**
 * Terminal escape emitters that write to the process stdout without
 * rendering anything: the OSC 52 clipboard-copy sequence and the OSC 0
 * window-title sequence. The terminal emulator consumes the sequence
 * itself, so the write keeps working over SSH or inside a container where
 * no platform tool exists for the job.
 *
 * The clipboard half: the terminal puts the payload on the *local*
 * clipboard (terminals without OSC 52 support silently ignore it — the
 * write is always safe but its effect is unverifiable from this side,
 * which is why callers report the method as "unverified"). The title half:
 * the terminal renames its window/tab (inside tmux the sequence becomes
 * the tmux window name instead — tmux consumes OSC 0 rather than
 * swallowing it, so unlike OSC 52 no DCS passthrough wrapping is needed).
 *
 * Neither sequence produces visible output — no cursor motion, no cell
 * paint — so neither interacts with pi-tui's differential rendering; the
 * alt-screen gating the roadmap carried for OSC 52 was an over-broad
 * association, corrected with S26. The process handle is injectable for
 * tests (the OSC 11 probe's precedent).
 *
 * @module @dsh-blue/blue-core/terminal-escape
 */

const ESC = '\x1b'
const BEL = '\x07'

/** The slice of the process the OSC 52 emitter touches; tests inject a fake. */
export interface BlueEscapeProcess {
  stdout: {
    /** TTY status; absent when stdout is piped or redirected. */
    readonly isTTY?: boolean
    /** Write the sequence; may throw on a destroyed stream. */
    write(chunk: string): unknown
  }
}

/**
 * Build an OSC 52 sequence asking the terminal to put `text` on the
 * clipboard.
 * @param text - the text to copy.
 * @param insideTmux - whether the process runs inside tmux (detected from
 * `$TMUX` by default): tmux swallows bare OSC sequences, so inside tmux
 * the sequence is wrapped in a DCS passthrough with doubled ESC bytes.
 * @returns the escape sequence, ready for a single stdout write.
 */
export function buildClipboardOsc52(text: string, insideTmux: boolean = (process.env.TMUX ?? '').length > 0): string {
  const payload = Buffer.from(text, 'utf8').toString('base64')
  const sequence = `${ESC}]52;c;${payload}${BEL}`
  if (!insideTmux) return sequence
  const escaped = sequence.replaceAll(ESC, `${ESC}${ESC}`)
  return `${ESC}Ptmux;${escaped}${ESC}\\`
}

/**
 * Write the OSC 52 clipboard-copy sequence to the terminal.
 * @param text - the text to copy.
 * @param proc - the process to write through; defaults to the live process.
 * @returns whether the sequence was written — `false` when stdout is not a
 * terminal (the sequence would pollute piped output) or the write failed.
 */
export function emitClipboardOsc52(text: string, proc: BlueEscapeProcess = process): boolean {
  if (proc.stdout.isTTY !== true) return false
  try {
    proc.stdout.write(buildClipboardOsc52(text))
    return true
  } catch {
    return false
  }
}

/** Maximum code points a terminal title carries (the kimi cap). */
export const TITLE_MAX_CHARS = 32

/**
 * Neutralize title text before it enters an OSC sequence: strip every
 * C0/C1 control character (an embedded ESC or BEL would corrupt or
 * terminate the sequence) plus the directional and invisible controls
 * that can make a displayed title deceptive, collapse whitespace runs,
 * and trim. The harness title service already normalizes what it logs —
 * this is the emitter's own defense, so no upstream regression can break
 * out of the title slot.
 * @param title - untrusted title text.
 * @returns the sanitized one-line title, possibly empty.
 */
export function sanitizeTitleText(title: string): string {
  return title
    .replace(/[\u0000-\u001F\u007F-\u009F]/gu, '')
    .replace(/[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Build an OSC 0 sequence setting the terminal's window (and tab) title:
 * the sanitized title capped to {@link TITLE_MAX_CHARS} code points. An
 * empty result sets an empty title — callers substitute their own
 * fallback text before emitting.
 * @param title - untrusted title text.
 * @returns the escape sequence, ready for one terminal write.
 */
export function buildTitleOsc0(title: string): string {
  const capped = [...sanitizeTitleText(title)].slice(0, TITLE_MAX_CHARS).join('')
  return `${ESC}]0;${capped}${BEL}`
}
