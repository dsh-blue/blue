/**
 * Blue clipboard write pipeline for the `/copy` command: platform clipboard
 * tools fed the text over stdin — `wl-copy` then `xclip` on Linux,
 * `pbcopy` on macOS, `clip.exe` on Windows — probed in order with the
 * paste-image timeout discipline, so a hung helper never wedges the
 * command. OSC 52 is deliberately not emitted (the roadmap hangs it on the
 * unavailable main-screen escape). A module-level writer hook lets tests
 * substitute a fake (the `setClipboardImageReader` precedent in
 * `./paste-image.ts`).
 *
 * @module @dsh-blue/blue-interaction/clipboard-write
 */

import { spawn } from 'node:child_process'

/** Per-tool timeout; a hung clipboard helper must not wedge the command. */
const CLIPBOARD_TOOL_TIMEOUT_MS = 3000

/**
 * Clipboard text tools probed in order, per platform (kimi's list).
 * @param platform - the host platform (tested directly for all three).
 * @returns the ordered tool list for that platform.
 */
export function clipboardToolsFor(platform: NodeJS.Platform): readonly (readonly [command: string, args: string[]])[] {
  if (platform === 'darwin') return [['pbcopy', []]]
  if (platform === 'win32') return [['clip.exe', []]]
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
  ]
}

/** The host platform's clipboard tool list, resolved once at load. */
const CLIPBOARD_TOOLS = clipboardToolsFor(process.platform)

/**
 * Run one clipboard tool with the text on stdin, resolving on a zero exit
 * and rejecting otherwise (missing tool, nonzero exit, timeout). The exit
 * code is the truth — a tool that closes stdin unread resolves like kimi's
 * spawnSync (code 0 wins) — and the settle guard makes the `error`
 * (ENOENT) and `close` events race-safe.
 */
function runClipboardTool(command: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: CLIPBOARD_TOOL_TIMEOUT_MS,
    })
    let stderr = ''
    let settled = false
    const settle = (failure: Error | undefined): void => {
      if (settled) return
      settled = true
      if (failure === undefined) resolve()
      else reject(failure)
    }
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    // EPIPE after the tool exits is expected; close carries the verdict.
    // (An unhandled stdin error would crash the process, but the write is
    // synchronous and the pipe buffered, so the handler is defensive.)
    /* v8 ignore next -- EPIPE after a fast tool exit is a race, not a testable state */
    child.stdin.on('error', () => {})
    child.stdin.end(text)
    child.on('error', (error) => settle(error))
    child.on('close', (code) => {
      if (code === 0) {
        settle(undefined)
        return
      }
      const detail = stderr.trim()
      settle(new Error(
        detail.length > 0
          ? `${command} exited with code ${String(code)}: ${detail}`
          : `${command} exited with code ${String(code)}`,
      ))
    })
  })
}

/**
 * Classify one tool failure for the aggregate message: a missing binary
 * (`ENOENT` from spawn) reads as "not installed" instead of the raw spawn
 * error, every other failure keeps its own message (exit code + stderr).
 */
function toolFailure(command: string, error: unknown): string {
  if (
    error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
  ) {
    return `${command} not installed`
  }
  // Every failure this pipeline produces is an Error (spawn errors and the
  // exit-code classification alike); the String arm only satisfies the
  // unknown-type contract.
  /* v8 ignore next -- no non-Error failure can reach this pipeline */
  return error instanceof Error ? error.message : String(error)
}

/** The default writer: the first probed tool accepting the text wins. */
const defaultClipboardTextWriter: ClipboardTextWriter = async (text) => {
  const failures: string[] = []
  for (const [command, args] of CLIPBOARD_TOOLS) {
    try {
      await runClipboardTool(command, args, text)
      return
    } catch (error) {
      failures.push(toolFailure(command, error))
    }
  }
  // Every platform lists at least one tool, so the loop always leaves a
  // failure behind and this throw always carries the aggregate.
  throw new Error(`no clipboard tool is available (${failures.join(', ')})`)
}

/**
 * Writes text to the system clipboard, resolving when some tool accepted
 * it and rejecting when none did (headless server, SSH session, missing
 * tools).
 */
export type ClipboardTextWriter = (text: string) => Promise<void>

let clipboardTextWriter: ClipboardTextWriter = defaultClipboardTextWriter

/**
 * Replace the clipboard text writer (tests inject a fake here).
 * @param writer - the replacement, or `undefined` to restore the default.
 */
export function setClipboardTextWriter(writer: ClipboardTextWriter | undefined): void {
  clipboardTextWriter = writer ?? defaultClipboardTextWriter
}

/**
 * Copy text to the system clipboard through the current writer.
 * @param text - the text to copy.
 * @throws when no clipboard tool accepted the text.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  await clipboardTextWriter(text)
}
