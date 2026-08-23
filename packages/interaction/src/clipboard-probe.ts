/**
 * Shared primitives for the clipboard-image probes behind the
 * `blue-paste-image` plugin: the reader-result contract every probe
 * resolves to, the never-rejecting tool runner with its run/failure
 * shapes, the raw-failure detail formatter, and the bounded,
 * magic-byte-sniffed read of one copied local file. The Linux
 * wl-paste/xclip table and its type negotiation live in
 * `./paste-image.ts`; the win32/darwin helpers live in
 * `./paste-image-native.ts`.
 *
 * @module @dsh-blue/blue-interaction/clipboard-probe
 */

import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ImageMediaType, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { sniffImageMediaType } from './attachments.ts'

/** Concrete clipboard backend that produced an image. */
export type ClipboardBackend = 'wayland' | 'x11'

/**
 * One clipboard read: direct image bytes, an ordered copied-file image
 * batch, or a failure kind naming what is missing.
 */
export type ClipboardImageResult =
  | { kind: 'image'; data: Uint8Array; mediaType: ImageMediaType; backend?: ClipboardBackend; fallback?: boolean }
  | { kind: 'images'; images: readonly SaveImageAttachment[]; backend?: ClipboardBackend; fallback?: boolean }
  | { kind: 'no-image' }
  | { kind: 'unsupported'; mediaType: string }
  | { kind: 'file-failed'; detail: string }
  | { kind: 'unreachable' }
  | { kind: 'missing-tool' }
  | { kind: 'timeout' }
  | { kind: 'failed'; detail: string }

/** Every unsuccessful clipboard result. */
export type FailureResult = Exclude<ClipboardImageResult, { kind: 'image' | 'images' }>

/** The non-image result kinds. */
export type FailureKind = FailureResult['kind']

/** Per-tool timeout; a hung clipboard helper must not wedge the editor. */
export const CLIPBOARD_TOOL_TIMEOUT_MS = 3000

/** Outcome of one clipboard tool invocation. */
export type ToolRun =
  | { ok: true; stdout: Buffer }
  | { ok: false; code: string | number | undefined; killed: boolean; stderr: string }

/** The failed half of {@link ToolRun}. */
export type FailedRun = Extract<ToolRun, { ok: false }>

/**
 * Run one clipboard tool to completion. Never rejects; a nonzero exit or a
 * spawn failure resolves as a failed run carrying the exit code, kill flag,
 * and stderr text for classification.
 * @param command - the tool to run.
 * @param args - its arguments.
 * @returns the stdout bytes, or the failure details.
 */
export function runTool(command: string, args: readonly string[]): Promise<ToolRun> {
  return new Promise(resolve => {
    // SIGKILL, not the default SIGTERM: wl-clipboard traps TERM for its own
    // cleanup and, wedged on an unresponsive compositor (GNOME's core-
    // protocol fallback never gains focus from a background process), never
    // returns from the handler — a TERM'd tool survives as a zombie and the
    // exit event never settles this promise.
    execFile(command, args, { encoding: 'buffer', timeout: CLIPBOARD_TOOL_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) {
        resolve({ ok: true, stdout })
        return
      }
      resolve({
        ok: false,
        // `null` arrives only from a killed run without an exit code; the
        // detail formatter prints it like any other code.
        code: error.code ?? undefined,
        killed: error.killed ?? false,
        stderr: stderr.toString(),
      })
    })
  })
}

/**
 * Build the raw-failure detail in the `clipboard-write` idiom: the command,
 * its exit code, and the first non-empty stderr line.
 * @param command - the tool that failed.
 * @param run - its failed run.
 * @returns the one-line detail.
 */
export function failureDetail(command: string, run: FailedRun): string {
  const code = String(run.code)
  const firstLine = run.stderr.split('\n').map(line => line.trim()).find(line => line.length > 0)
  return firstLine === undefined
    ? `${command} exited with code ${code}`
    : `${command} exited with code ${code}: ${firstLine}`
}

/** Read one copied local file without following a final symlink. */
export async function readCopiedImage(path: string, maxBytes: number): Promise<SaveImageAttachment | FailureResult> {
  const displayName = basename(path) || 'copied file'
  let handle
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const reason = code === 'ELOOP' ? 'symbolic links are not accepted' : `could not be opened (${String(code)})`
    return { kind: 'file-failed', detail: `${displayName} ${reason}` }
  }
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) return { kind: 'file-failed', detail: `${displayName} is not a regular file` }
    if (stat.size > maxBytes) return { kind: 'file-failed', detail: `${displayName} exceeds the per-image byte limit` }
    const data = await handle.readFile()
    if (data.byteLength > maxBytes) return { kind: 'file-failed', detail: `${displayName} exceeds the per-image byte limit` }
    const mediaType = sniffImageMediaType(data)
    if (mediaType === undefined) {
      return { kind: 'file-failed', detail: `${displayName} is not a supported PNG, JPEG, WebP, or GIF image` }
    }
    return { data, mediaType, name: displayName }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { kind: 'file-failed', detail: `${displayName} could not be read (${String(code)})` }
  } finally {
    await handle.close()
  }
}
