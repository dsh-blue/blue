/**
 * Terminal escape emitters that write to the process stdout without
 * rendering anything: the OSC 52 clipboard-copy sequence. The terminal
 * emulator consumes the sequence and puts the payload on the *local*
 * clipboard, so a copy keeps working over SSH or inside a container where
 * no platform clipboard tool exists. Terminals without OSC 52 support
 * (gnome-terminal/VTE, or xterm without `allowWindowOps`) silently ignore
 * it — the write is always safe but its effect is unverifiable from this
 * side, which is why callers report the method as "unverified".
 *
 * The sequence produces no visible output — no cursor motion, no cell
 * paint — so unlike the scrollback-touching gestures (mouse wheel, text
 * selection) it does not interact with pi-tui's differential rendering at
 * all; the alt-screen gating the roadmap carried for it was an
 * over-broad association, corrected with S26. The process handle is
 * injectable for tests (the OSC 11 probe's precedent).
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
