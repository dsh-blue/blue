/**
 * `ctx.blueTerminalInfo` service and the startup OSC 11 background probe.
 * The probe runs before the renderer takes over stdin (raw mode), so Blue
 * queries the terminal itself instead of using pi-tui's built-in query,
 * which depends on the post-start input chain. The probe's process handle
 * is injectable for tests.
 *
 * @module @dsh-blue/blue-core/terminal-info
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { parseOsc11BackgroundColor } from '@earendil-works/pi-tui'
import type { BlueRgbColor, BlueTerminalInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    blueTerminalInfo: BlueTerminalInfoService
  }
}

/** The slice of the process the OSC 11 probe touches; tests inject a fake. */
export interface BlueProbeProcess {
  stdin: {
    /** Enter or leave raw mode while the probe owns stdin; absent on non-TTY stdin. */
    setRawMode?(raw: boolean): void
    /** Subscribe to stdin data. */
    on(event: 'data', listener: (data: Buffer) => void): void
    /** Unsubscribe from stdin data. */
    removeListener(event: 'data', listener: (data: Buffer) => void): void
  }
  stdout: {
    /** Write the query sequence to the terminal. */
    write(data: string): void
  }
}

/** How long the probe waits for the terminal's reply before giving up. */
export const PROBE_TIMEOUT_MS = 200

/** The OSC 11 background-color query (`ESC ] 11 ; ? BEL`). */
const OSC11_QUERY = '\x1b]11;?\x07'

/**
 * Query the terminal's default background color with OSC 11. Temporarily
 * enables raw mode, writes the query, and resolves with the parsed color;
 * a missing, late, or unparseable reply resolves `undefined`. Raw mode and
 * the stdin listener are always restored.
 * @param proc - the process to query through; defaults to the live process.
 * @param timeoutMs - reply timeout in milliseconds.
 * @returns the parsed background color, or `undefined` without one.
 */
export function probeTerminalBackground(
  proc: BlueProbeProcess = process,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<BlueRgbColor | undefined> {
  return new Promise(resolve => {
    let received = ''
    // settle runs at most once: the reply path removes the listener and
    // clears the timer, the timeout path does the same for the reply.
    const settle = (rgb: BlueRgbColor | undefined) => {
      clearTimeout(timer)
      proc.stdin.removeListener('data', onData)
      proc.stdin.setRawMode?.(false)
      resolve(rgb)
    }
    const onData = (data: Buffer) => {
      received += data.toString('utf8')
      const start = received.indexOf('\x1b]11;')
      if (start === -1) return
      const rest = received.slice(start)
      // Wait until the reply's terminator (BEL or ST) has arrived; an
      // unterminated prefix means the response is split across chunks.
      const bel = rest.indexOf('\x07')
      const st = rest.indexOf('\x1b\\')
      const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
      if (end === -1) return
      const response = rest.slice(0, end + (rest[end] === '\x07' ? 1 : 2))
      settle(parseOsc11BackgroundColor(response))
    }
    const timer = setTimeout(() => settle(undefined), timeoutMs)
    proc.stdin.setRawMode?.(true)
    proc.stdin.on('data', onData)
    proc.stdout.write(OSC11_QUERY)
  })
}

/**
 * Classify a sampled background color by relative luminance.
 * @param rgb - the sampled color, or `undefined` when the probe failed.
 * @returns `'light'` above the mid-gray threshold, `'dark'` at or below it,
 *   `undefined` without a sample.
 */
export function backgroundFromRgb(rgb: BlueRgbColor | undefined): 'dark' | 'light' | undefined {
  if (rgb === undefined) return undefined
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255
  return luminance > 0.5 ? 'light' : 'dark'
}

/**
 * The `blueTerminalInfo` service: a frozen snapshot of probed terminal
 * facts. Unregistered automatically when the plugin's fiber unloads.
 */
export class BlueTerminalInfoService extends Service implements BlueTerminalInfo {
  readonly background: 'dark' | 'light' | undefined
  readonly kittyKeyboard: boolean

  /**
   * Create and register the service as an immutable fact snapshot.
   * @param ctx - the owning Cordis context.
   * @param info - the probed facts.
   */
  constructor(ctx: Context, info: BlueTerminalInfo) {
    super(ctx, 'blueTerminalInfo')
    this.background = info.background
    this.kittyKeyboard = info.kittyKeyboard
    Object.freeze(this)
  }
}
