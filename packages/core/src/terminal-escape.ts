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
 * which is why callers report the method as "unverified"). Inside tmux,
 * application selection uses `tmux load-buffer -w -` instead: the common
 * `set-clipboard external` policy deliberately ignores OSC 52 emitted by
 * applications, while `load-buffer -w` asks tmux itself to update its paste
 * buffer and forward the clipboard write to the outer terminal. A tmux DCS
 * passthrough wrapper is not used because its separate `allow-passthrough`
 * gate is off by default. The title half renames the terminal window/tab
 * (inside tmux it becomes the tmux window name).
 *
 * Neither sequence produces visible output — no cursor motion, no cell
 * paint — so neither interacts with pi-tui's differential rendering; the
 * alt-screen gating the roadmap carried for OSC 52 was an over-broad
 * association, corrected with S26. The process handle is injectable for
 * tests (the OSC 11 probe's precedent).
 *
 * @module @dsh-blue/blue-core/terminal-escape
 */

import { spawn } from 'node:child_process'

const ESC = '\x1b'
const BEL = '\x07'
/** A stalled tmux server must not leave selection feedback pending forever. */
const TMUX_CLIPBOARD_TIMEOUT_MS = 3000

/** The slice of the process the OSC 52 emitter touches; tests inject a fake. */
export interface BlueEscapeProcess {
  stdout: {
    /** TTY status; absent when stdout is piped or redirected. */
    readonly isTTY?: boolean
    /** Write the sequence; may throw on a destroyed stream. */
    write(chunk: string): unknown
  }
}

/** The terminal write slice used by application-owned selection copying. */
export interface BlueClipboardTerminal {
  /** Write one OSC sequence; may throw when the terminal has closed. */
  write(chunk: string): unknown
}

/**
 * Build an OSC 52 sequence asking the terminal to put `text` on the
 * clipboard.
 * @param text - the text to copy.
 * @param insideTmux - whether the process runs inside tmux (detected from
 * `$TMUX` by default). Retained for call-site compatibility; selection
 * routing now happens in {@link copySelectionText}, so this pure builder
 * always returns the direct-terminal form.
 * @returns the escape sequence, ready for a single stdout write.
 */
export function buildClipboardOsc52(text: string, insideTmux: boolean = (process.env.TMUX ?? '').length > 0): string {
  void insideTmux
  const payload = Buffer.from(text, 'utf8').toString('base64')
  return `${ESC}]52;c;${payload}${BEL}`
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

/**
 * Put text in tmux's paste buffer and ask tmux to forward it to the outer
 * terminal clipboard. `-w` follows tmux's own `set-clipboard`/terminfo path,
 * so it works with `set-clipboard external` and does not require application
 * OSC 52 acceptance or `allow-passthrough`.
 * @param text - the selected text, written verbatim to tmux on stdin.
 * @returns whether tmux accepted the buffer and clipboard request.
 */
export function loadTmuxClipboard(text: string): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const child = spawn('tmux', ['load-buffer', '-w', '-'], {
        stdio: ['pipe', 'ignore', 'ignore'],
        timeout: TMUX_CLIPBOARD_TIMEOUT_MS,
      })
      child.once('error', () => finish(false))
      child.once('close', code => finish(code === 0))
      child.stdin.once('error', () => finish(false))
      try {
        child.stdin.end(text)
      } catch {
        finish(false)
      }
    } catch {
      finish(false)
    }
  })
}

/**
 * Copy an application-owned selection through the environment's reliable
 * path: tmux's own buffer command inside tmux, or direct OSC 52 otherwise.
 * @param text - selected terminal text.
 * @param terminal - active terminal writer for the non-tmux OSC path.
 * @param insideTmux - tmux detection; tests override it explicitly.
 * @returns whether the selected path accepted the copy operation.
 */
export async function copySelectionText(
  text: string,
  terminal: BlueClipboardTerminal,
  insideTmux: boolean = (process.env.TMUX ?? '').length > 0,
): Promise<boolean> {
  if (insideTmux) return loadTmuxClipboard(text)
  try {
    terminal.write(buildClipboardOsc52(text, false))
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
