/**
 * `blue-paste-image` plugin: Ctrl-V pastes a clipboard image into the input
 * editor as an attachment. The contextual `blue.image.paste` key action is
 * registered keyless-style (bound to ctrl+v, no handler) and resolved in a
 * wrapper chained onto the shared editor's `onKey` hook — ahead of the
 * pi-tui Editor, which has no clipboard-image handling of its own. The paste
 * flow is fire-and-forget: an injectable reader (the default negotiates with
 * the Linux stdout-form tools `wl-paste` and `xclip` in session-aware order)
 * resolves to direct image bytes tagged with the clipboard's declared type,
 * or to local image files copied through `text/uri-list` / GNOME's copied-
 * files representation. Copied files are opened without following a final
 * symlink, bounded by the attachment deployment limits, magic-byte sniffed,
 * and admitted as one ordered batch. Otherwise the reader returns a failure
 * kind
 * naming what is missing: the tool absent, the display session unreachable,
 * no image, an unsupported image type, a timeout, or a raw tool failure.
 * Every kind flashes a one-shot notice; nothing is installed or worked
 * around on the user's behalf (D49). Images are admitted through
 * `ctx.attachments.saveImage` — the store cross-checks the declared type
 * against the sniffed bytes — and land in the editor as an `[image #N]`
 * marker recorded in a module-level marker→ref map. A submit transformer
 * (`./editor-instance.ts`) then splits submitted text on known markers into
 * text and image content blocks; unknown markers stay literal text. The map
 * and counter are module-level so markers survive theme-swap reloads, which
 * restore the editor text from the draft stash. Ships as a subpath plugin so
 * the baseline bundle keeps the plain text editor.
 *
 * @module @dsh-blue/blue-interaction/paste-image
 */

import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
// Empty type import carries the `settings` Context merge and the
// 'settings/updated' Events merge the backend override subscribes to.
import type {} from '@deepseek-ai/dsh-settings'
import {
  getSharedEditor,
  registerSubmitTransformer,
  type SharedEditor,
  type SubmitTransformation,
} from './editor-instance.ts'
import { ADMITTED_IMAGE_TYPES, EXT_BY_MEDIA_TYPE, sniffImageMediaType } from './attachments.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-paste-image'
/** Services required before the paste flow can run. */
export const inject = ['attachments', 'blueKeymap']

/** Clipboard backend policy: automatic session order, or one strict backend. */
export type ClipboardBackendPolicy = 'auto' | 'wayland' | 'x11'

/** Concrete clipboard backend that produced an image. */
export type ClipboardBackend = Exclude<ClipboardBackendPolicy, 'auto'>

/** Plugin configuration for clipboard backend selection. */
export interface Config {
  /** Backend policy; strict modes never cross the Wayland/X11 boundary. */
  backend: ClipboardBackendPolicy
}

/** Validated plugin configuration; automatic session-aware probing is the default. */
export const Config: z<Config> = z.object({
  backend: z.union([z.const('auto'), z.const('wayland'), z.const('x11')]).default('auto'),
})

/**
 * The user-layer `blue.pasteImageBackend` override. The composition config
 * stays the base — the settings schema's `auto` default must not clobber a
 * configured strict backend, so only a value the user actually wrote into
 * the settings document lands here (the apply-time reader diffs the
 * descriptor's raw `user` section, not the resolved value).
 */
let backendOverride: ClipboardBackendPolicy | undefined

/**
 * Replace the user-layer backend override.
 * @param value - the override, or `undefined` to follow the plugin config.
 */
export function setClipboardBackendOverride(value: ClipboardBackendPolicy | undefined): void {
  backendOverride = value
}

/**
 * Contextual action triggering the clipboard-image paste. Bound to Ctrl-V;
 * carries no handler because the editor's `onKey` chain resolves it via
 * `blueKeymap.matches`.
 */
export const ACTION_IMAGE_PASTE = 'blue.image.paste'

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

/**
 * Reads the clipboard's current image, or resolves the failure kind. Never
 * rejects (the injected test readers may).
 */
export type ClipboardImageReader = () => Promise<ClipboardImageResult>

/** How one clipboard tool lists the offered types and reads one back. */
type ClipboardTool = {
  /** Stable backend identity used by policy selection and cooldowns. */
  backend: ClipboardBackend
  /** The probe command. */
  command: string
  /** stderr signature meaning "no display session is reachable". */
  unreachable: RegExp
  /** Args listing the clipboard's offered types, one per line. */
  listArgs: readonly string[]
  /** Args reading back one offered media type. */
  readArgs: (mediaType: string) => string[]
}

/** Standard and desktop-specific clipboard representations for copied files. */
const FILE_URI_TYPES = ['text/uri-list', 'x-special/gnome-copied-files'] as const

/** Clipboard image tools keyed by their display protocol. */
const CLIPBOARD_TOOLS: Readonly<Record<ClipboardBackend, ClipboardTool>> = {
  wayland: {
    backend: 'wayland',
    command: 'wl-paste',
    unreachable: /failed to connect to a wayland server/i,
    listArgs: ['-l'],
    readArgs: mediaType => ['-t', mediaType],
  },
  x11: {
    backend: 'x11',
    command: 'xclip',
    unreachable: /can(?:not|'t) open display/i,
    listArgs: ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
    readArgs: mediaType => ['-selection', 'clipboard', '-t', mediaType, '-o'],
  },
}

/** Per-tool timeout; a hung clipboard helper must not wedge the editor. */
const CLIPBOARD_TOOL_TIMEOUT_MS = 3000

/** A timed-out backend stays skipped briefly, then is retried automatically. */
const BACKEND_COOLDOWN_MS = 60_000

/** Wall clock seam for deterministic cooldown specs. */
export type ClipboardClock = () => number

const defaultClipboardClock: ClipboardClock = () => Date.now()
let clipboardClock: ClipboardClock = defaultClipboardClock

/** Retry deadline per backend and display-environment identity. */
const backendCooldowns = new Map<string, number>()

/** Replace the cooldown clock in tests. */
export function setClipboardClock(clock: ClipboardClock | undefined): void {
  clipboardClock = clock ?? defaultClipboardClock
}

/** Clear every remembered backend timeout. */
export function resetClipboardBackendCooldowns(): void {
  backendCooldowns.clear()
}

/** The display identity whose failures may be reused safely. */
function cooldownKey(backend: ClipboardBackend): string {
  return [backend, process.env.DISPLAY ?? '', process.env.WAYLAND_DISPLAY ?? '', process.env.XDG_RUNTIME_DIR ?? ''].join('\0')
}

/** Resolve the configured backend order against the current display session. */
function clipboardToolsFor(policy: ClipboardBackendPolicy): readonly ClipboardTool[] {
  if (policy === 'wayland') return [CLIPBOARD_TOOLS.wayland]
  if (policy === 'x11') return [CLIPBOARD_TOOLS.x11]
  if ((process.env.WAYLAND_DISPLAY ?? '') !== '') return [CLIPBOARD_TOOLS.wayland, CLIPBOARD_TOOLS.x11]
  if ((process.env.DISPLAY ?? '') !== '') return [CLIPBOARD_TOOLS.x11, CLIPBOARD_TOOLS.wayland]
  return [CLIPBOARD_TOOLS.wayland, CLIPBOARD_TOOLS.x11]
}

/** Outcome of one clipboard tool invocation. */
type ToolRun =
  | { ok: true; stdout: Buffer }
  | { ok: false; code: string | number | undefined; killed: boolean; stderr: string }

/** The failed half of {@link ToolRun}. */
type FailedRun = Extract<ToolRun, { ok: false }>

/** Every unsuccessful clipboard result. */
type FailureResult = Exclude<ClipboardImageResult, { kind: 'image' | 'images' }>

/** The non-image result kinds. */
type FailureKind = FailureResult['kind']

/**
 * Failure kinds in cross-tool aggregation order: a completed clipboard query
 * (including "holds an unsupported image type") outranks environment
 * failures, which outrank a hang, which outranks a missing binary — a tool
 * that exists and timed out must not be reported as absent.
 */
const OUTCOME_RANK: Readonly<Record<FailureKind, number>> = {
  unsupported: 0,
  'file-failed': 1,
  'no-image': 2,
  unreachable: 3,
  failed: 4,
  timeout: 5,
  'missing-tool': 6,
}

/**
 * Run one clipboard tool to completion. Never rejects; a nonzero exit or a
 * spawn failure resolves as a failed run carrying the exit code, kill flag,
 * and stderr text for classification.
 * @param command - the tool to run.
 * @param args - its arguments.
 * @returns the stdout bytes, or the failure details.
 */
function runTool(command: string, args: readonly string[]): Promise<ToolRun> {
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
function failureDetail(command: string, run: FailedRun): string {
  const code = String(run.code)
  const firstLine = run.stderr.split('\n').map(line => line.trim()).find(line => line.length > 0)
  return firstLine === undefined
    ? `${command} exited with code ${code}`
    : `${command} exited with code ${code}: ${firstLine}`
}

/**
 * Map a failed run to the shared failure kinds: ENOENT is the missing
 * binary, `killed` is the timeout, the per-tool stderr signature is the
 * unreachable display session, and everything else keeps its raw detail.
 * @param tool - the tool that was running.
 * @param run - its failed run.
 * @returns the classified failure.
 */
function classifyFailure(tool: ClipboardTool, run: FailedRun): ClipboardImageResult {
  if (run.code === 'ENOENT') return { kind: 'missing-tool' }
  if (run.killed) return { kind: 'timeout' }
  if (tool.unreachable.test(run.stderr)) return { kind: 'unreachable' }
  return { kind: 'failed', detail: failureDetail(tool.command, run) }
}

/** A parsed local file selection, or a user-facing refusal detail. */
type ParsedFileUris =
  | { ok: true; paths: readonly string[] }
  | { ok: false; detail: string }

/** Parse standard URI-list or GNOME copied-files bytes into unique local paths. */
function parseFileUris(data: Buffer, mediaType: typeof FILE_URI_TYPES[number]): ParsedFileUris {
  const lines = data.toString('utf8').split(/\r?\n/).map(line => line.trim())
  if (mediaType === 'x-special/gnome-copied-files') {
    const operation = lines.shift()
    if (operation !== 'copy' && operation !== 'cut') {
      return { ok: false, detail: 'GNOME copied-files data has no copy/cut operation' }
    }
  }
  const paths: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (line === '' || line.startsWith('#')) continue
    let url: URL
    try {
      url = new URL(line)
    } catch {
      return { ok: false, detail: 'clipboard file list contains an invalid URI' }
    }
    if (url.protocol !== 'file:') {
      return { ok: false, detail: `clipboard URI scheme ${url.protocol.slice(0, -1)} is not local` }
    }
    let path: string
    try {
      path = fileURLToPath(url)
    } catch {
      return { ok: false, detail: 'clipboard file URI does not name a local path' }
    }
    if (!seen.has(path)) {
      seen.add(path)
      paths.push(path)
    }
  }
  return { ok: true, paths }
}

/** Read one copied local file without following a final symlink. */
async function readCopiedImage(path: string, maxBytes: number): Promise<SaveImageAttachment | FailureResult> {
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

/** Read and preflight one copied-file representation as an ordered batch. */
async function readCopiedImages(data: Buffer, mediaType: typeof FILE_URI_TYPES[number], limits: ImageAttachmentLimits): Promise<ClipboardImageResult> {
  const parsed = parseFileUris(data, mediaType)
  if (!parsed.ok) return { kind: 'file-failed', detail: parsed.detail }
  if (parsed.paths.length === 0) return { kind: 'no-image' }
  if (parsed.paths.length > limits.maxImagesPerMessage) {
    return { kind: 'file-failed', detail: `copied file selection exceeds the ${limits.maxImagesPerMessage}-image limit` }
  }
  const images: SaveImageAttachment[] = []
  let totalBytes = 0
  for (const path of parsed.paths) {
    const image = await readCopiedImage(path, limits.maxImageBytes)
    if ('kind' in image) return image
    totalBytes += image.data.byteLength
    if (totalBytes > limits.maxMessageImageBytes) {
      return { kind: 'file-failed', detail: 'copied file selection exceeds the aggregate image-byte limit' }
    }
    images.push(image)
  }
  return { kind: 'images', images }
}

/**
 * Probe one tool: list the clipboard's offered types, try direct admitted
 * images in `ADMITTED_IMAGE_TYPES` order, then try a copied local-file
 * representation. A listing that only offers non-admitted `image/*` types
 * reports the unsupported type; hard read failures stop the loop.
 * @param tool - the tool to probe.
 * @param limits - deployment image limits used for bounded local-file reads.
 * @returns the probe outcome.
 */
async function probeTool(tool: ClipboardTool, limits: ImageAttachmentLimits): Promise<ClipboardImageResult> {
  const listing = await runTool(tool.command, tool.listArgs)
  if (!listing.ok) {
    const failure = classifyFailure(tool, listing)
    // xclip's empty-clipboard TARGETS query exits nonzero without stderr.
    // Keep this quirk backend-specific: a silent wl-paste failure is not
    // evidence that the clipboard was queried successfully.
    if (tool.backend === 'x11' && failure.kind === 'failed' && listing.stderr.trim() === '') return { kind: 'no-image' }
    return failure
  }
  const offered = listing.stdout.toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const admitted = ADMITTED_IMAGE_TYPES.filter(mediaType => offered.includes(mediaType))
  let softFailure: ClipboardImageResult | undefined
  for (const mediaType of admitted) {
    const read = await runTool(tool.command, tool.readArgs(mediaType))
    if (read.ok) {
      if (read.stdout.length > 0) {
        const sniffed = sniffImageMediaType(read.stdout)
        if (sniffed === mediaType) {
          return { kind: 'image', data: read.stdout, mediaType, backend: tool.backend }
        }
        if (softFailure === undefined) {
          softFailure = sniffed === undefined
            ? { kind: 'failed', detail: `${tool.command} returned invalid bytes for ${mediaType}` }
            : { kind: 'failed', detail: `${tool.command} returned ${sniffed} bytes for ${mediaType}` }
        }
        continue
      }
      // The listing promised the type but the read came back empty (the
      // clipboard can change mid-probe): fall through to the next type.
      continue
    }
    const failure = classifyFailure(tool, read)
    if (failure.kind !== 'failed') return failure
    if (softFailure === undefined) softFailure = failure
  }
  for (const fileType of FILE_URI_TYPES) {
    if (!offered.includes(fileType)) continue
    const read = await runTool(tool.command, tool.readArgs(fileType))
    if (!read.ok) return classifyFailure(tool, read)
    const files = await readCopiedImages(read.stdout, fileType, limits)
    if (files.kind === 'images') return { ...files, backend: tool.backend }
    if (files.kind !== 'no-image') return files
  }
  if (admitted.length === 0) {
    const imageType = offered.find(type => type.startsWith('image/'))
    return imageType === undefined ? { kind: 'no-image' } : { kind: 'unsupported', mediaType: imageType }
  }
  return softFailure ?? { kind: 'no-image' }
}

/**
 * Collapse the per-tool outcomes into one verdict: the highest-ranked
 * outcome wins, except that an unreachable/missing-tool mix is re-gated on
 * the session env — when a display session exists the absent tool is what
 * is missing (installing it connects); without one, the unreachable session
 * is.
 * @param outcomes - every tool's non-image outcome.
 * @returns the aggregate verdict.
 */
function aggregateOutcomes(outcomes: FailureResult[]): ClipboardImageResult {
  let best = outcomes[0]!
  for (const outcome of outcomes) {
    if (OUTCOME_RANK[outcome.kind] < OUTCOME_RANK[best.kind]) best = outcome
  }
  const kinds = new Set(outcomes.map(outcome => outcome.kind))
  if (!kinds.has('unreachable') || !kinds.has('missing-tool')) return best
  const hasDisplaySession = (process.env.DISPLAY ?? '') !== '' || (process.env.WAYLAND_DISPLAY ?? '') !== ''
  return hasDisplaySession ? { kind: 'missing-tool' } : { kind: 'unreachable' }
}

/** The default reader: probe each policy-selected tool in order; the first
 * valid image wins, otherwise the failures aggregate into one verdict. */
async function defaultClipboardImageReader(config: Config, limits: ImageAttachmentLimits): Promise<ClipboardImageResult> {
  const policy = backendOverride ?? config.backend
  const outcomes: FailureResult[] = []
  const tools = clipboardToolsFor(policy)
  for (const [index, tool] of tools.entries()) {
    const key = cooldownKey(tool.backend)
    const retryAt = backendCooldowns.get(key)
    if (retryAt !== undefined && clipboardClock() < retryAt) {
      outcomes.push({ kind: 'timeout' })
      continue
    }
    backendCooldowns.delete(key)
    const outcome = await probeTool(tool, limits)
    if (outcome.kind === 'timeout') backendCooldowns.set(key, clipboardClock() + BACKEND_COOLDOWN_MS)
    if (outcome.kind === 'image' || outcome.kind === 'images') {
      return {
        ...outcome,
        fallback: policy === 'auto' && index > 0,
      }
    }
    outcomes.push(outcome)
  }
  return aggregateOutcomes(outcomes)
}

let clipboardImageReader: ClipboardImageReader | undefined

/**
 * Replace the clipboard image reader (tests inject a fake here).
 * @param reader - the replacement, or `undefined` to restore the default.
 */
export function setClipboardImageReader(reader: ClipboardImageReader | undefined): void {
  clipboardImageReader = reader
}

/**
 * Notice text per failure kind: each names what is missing so the user can
 * fix it (D49: diagnose, never work around).
 * @param result - the non-image reader outcome.
 * @returns the notice text.
 */
function failureNotice(result: FailureResult): string {
  switch (result.kind) {
    case 'missing-tool': return 'clipboard image tool missing: install wl-clipboard (wl-paste) or xclip'
    case 'unreachable': return 'clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'
    case 'no-image': return 'no image available from the clipboard'
    case 'unsupported': return `clipboard image type ${result.mediaType} is not supported`
    case 'file-failed': return `clipboard image file failed: ${result.detail}`
    case 'timeout': return 'clipboard read timed out'
    case 'failed': return `clipboard read failed: ${result.detail}`
  }
}

/** Marker→attachment map for images pasted into the editor. */
const pastedImages = new Map<string, ImageAttachmentRef>()
/** Running paste counter; gives each marker a unique number. */
let pasteCount = 0

/** The marker shape inserted into the editor text. */
const IMAGE_MARKER = /\[image #\d+\]/g

/**
 * Submit transformer splitting the submitted line on known `[image #N]`
 * markers: text runs become text blocks unaltered apart from the marker
 * removal, each known marker becomes an image block, and consumed markers
 * leave the map. Unknown (expired or never pasted) markers stay literal
 * text. Declines (empty result) when the line references no known marker.
 * @param text - the submitted line.
 * @returns the contributed content blocks, empty when nothing was split.
 */
function transformImageMarkers(text: string): ContentBlock[] | SubmitTransformation {
  const blocks: ContentBlock[] = []
  const consumed: Array<readonly [string, ImageAttachmentRef]> = []
  let last = 0
  for (const match of text.matchAll(IMAGE_MARKER)) {
    const ref = pastedImages.get(match[0])
    // Unknown marker: leave it in the surrounding text run.
    if (ref === undefined) continue
    const run = text.slice(last, match.index)
    if (run.length > 0) blocks.push({ type: 'text', text: run })
    blocks.push({ type: 'image', attachment: ref })
    pastedImages.delete(match[0])
    consumed.push([match[0], ref])
    last = match.index + match[0].length
  }
  if (blocks.length === 0) return []
  const tail = text.slice(last)
  if (tail.length > 0) blocks.push({ type: 'text', text: tail })
  return {
    blocks,
    rollback: () => {
      for (const [marker, ref] of consumed) pastedImages.set(marker, ref)
    },
  }
}

/**
 * Read the clipboard, admit it through the attachment store, and insert its
 * marker at the editor cursor. Every failure kind degrades to a one-shot
 * notice naming what is missing; late completions after a fiber unload
 * no-op.
 * @param ctx - plugin context carrying the attachment store.
 * @param shared - the shared editor entry.
 * @param isUnloaded - reports whether this fiber unloaded mid-flight.
 */
async function pasteFlow(ctx: Context, config: Config, shared: SharedEditor, isUnloaded: () => boolean): Promise<void> {
  // A missing notice callback degrades to silence rather than a throw.
  const notice = shared.notice ?? (() => {})
  // The probe can take seconds (a wedged wl-paste costs its whole timeout);
  // flash an in-progress notice so the wait reads as work, not a dead key.
  // The marker insertion's own change event clears it on success; a failure
  // notice overwrites it in place.
  notice('pasting image...')
  let result: ClipboardImageResult
  try {
    result = await (clipboardImageReader?.() ?? defaultClipboardImageReader(config, ctx.attachments.imageLimits))
  } catch (error) {
    // An injected reader rejecting degrades to the same notice family.
    if (isUnloaded()) return
    const message = error instanceof Error ? error.message : String(error)
    notice(`clipboard read failed: ${message}`)
    return
  }
  if (isUnloaded()) return
  if (result.kind !== 'image' && result.kind !== 'images') {
    notice(failureNotice(result))
    return
  }
  try {
    // Direct representations retain their declared type for the store's
    // cross-check; copied files carry a type sniffed from their bytes and
    // use the batch path for count and aggregate-byte admission.
    const refs = result.kind === 'image'
      ? [await ctx.attachments.saveImage({
          data: result.data,
          mediaType: result.mediaType,
          name: `pasted-image.${EXT_BY_MEDIA_TYPE[result.mediaType]}`,
        })]
      : await ctx.attachments.saveImages(result.images)
    if (isUnloaded()) return
    const markers = refs.map(ref => {
      pasteCount += 1
      const marker = `[image #${pasteCount}]`
      pastedImages.set(marker, ref)
      return marker
    })
    shared.editor.insertText(markers.join(' '))
    if (result.fallback === true && result.backend !== undefined) {
      const label = result.backend === 'x11' ? 'X11' : 'Wayland'
      notice(`pasted image via ${label} fallback; verify it is current`)
    }
  } catch (error) {
    if (isUnloaded()) return
    const message = error instanceof Error ? error.message : String(error)
    notice(`image rejected: ${message}`)
  }
}

/**
 * Chain the paste trigger onto the shared editor's `onKey` hook, preserving
 * the handler `blue-input` installed.
 * @param ctx - plugin context.
 * @param shared - the shared editor entry.
 * @param isUnloaded - reports whether this fiber has unloaded; forwarded to
 *   the paste flow so a paste settling after a theme-swap reload no-ops.
 * @returns a detacher restoring the previous handler.
 */
function attach(ctx: Context, config: Config, shared: SharedEditor, isUnloaded: () => boolean): () => void {
  const { editor } = shared
  const previousOnKey = editor.onKey
  editor.onKey = (data) => {
    if (ctx.blueKeymap.matches(data, ACTION_IMAGE_PASTE)) {
      void pasteFlow(ctx, config, shared, isUnloaded)
      return true
    }
    return previousOnKey?.(data) ?? false
  }
  return () => {
    editor.onKey = previousOnKey
  }
}

/**
 * Register the paste key action and submit transformer, and attach to the
 * shared editor whenever `blue-input` (re)mounts it; detach when it
 * unmounts or this fiber disposes.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context, config: Config): void {
  /**
   * Set when this fiber unloads: a paste can settle after a theme-swap
   * reload disposed the fiber, and the late completion must not touch the
   * editor through the dead context.
   */
  let unloaded = false
  ctx.effect(() => () => {
    unloaded = true
  })
  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_IMAGE_PASTE,
    keys: ['ctrl+v'],
    description: 'Paste a clipboard image into the prompt',
  }]))
  ctx.effect(() => registerSubmitTransformer(transformImageMarkers))
  // The `blue.pasteImageBackend` user layer overrides the composition
  // backend. Read the descriptor's RAW user section — the resolved value's
  // `auto` schema default would clobber a configured strict backend — and
  // re-read on every `blue` commit; a host without settings keeps the
  // composition value.
  const syncBackendOverride = (): void => {
    const descriptor = ctx.get('settings')?.describe().find(entry => String(entry.ns) === 'blue')
    const user = descriptor?.user
    const raw = typeof user === 'object' && user !== null
      ? (user as Record<string, unknown>).pasteImageBackend
      : undefined
    setClipboardBackendOverride(raw === 'auto' || raw === 'wayland' || raw === 'x11' ? raw : undefined)
  }
  syncBackendOverride()
  ctx.on('settings/updated', (ns) => {
    if (String(ns) === 'blue') syncBackendOverride()
  })
  ctx.effect(() => () => setClipboardBackendOverride(undefined))
  let detach: (() => void) | undefined
  const reattach = (): void => {
    detach?.()
    detach = undefined
    const shared = getSharedEditor()
    if (shared !== undefined) detach = attach(ctx, config, shared, () => unloaded)
  }
  ctx.effect(() => () => {
    detach?.()
  })
  ctx.on('blue/input-editor-changed', reattach)
  reattach()
}
