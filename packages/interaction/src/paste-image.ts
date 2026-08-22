/**
 * `blue-paste-image` plugin: Ctrl-V pastes a clipboard image into the input
 * editor as an attachment. The contextual `blue.image.paste` key action is
 * registered keyless-style (bound to ctrl+v, no handler) and resolved in a
 * wrapper chained onto the shared editor's `onKey` hook — ahead of the
 * pi-tui Editor, which has no clipboard-image handling of its own. The paste
 * flow is fire-and-forget: an injectable reader (the default negotiates with
 * the stdout-form tools `wl-paste` then `xclip` — macOS's `pngpaste` writes
 * only to files, so it is deliberately not probed) resolves to either image
 * bytes tagged with the clipboard's own declared type or a failure kind
 * naming what is missing: the tool absent, the display session unreachable,
 * no image, an unsupported image type, a timeout, or a raw tool failure.
 * Every kind flashes a one-shot notice; nothing is installed or worked
 * around on the user's behalf (D48). Images are admitted through
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
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { getSharedEditor, registerSubmitTransformer, type SharedEditor } from './editor-instance.ts'
import { ADMITTED_IMAGE_TYPES, EXT_BY_MEDIA_TYPE } from './attachments.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-paste-image'
/** Services required before the paste flow can run. */
export const inject = ['attachments', 'blueKeymap']

/**
 * Contextual action triggering the clipboard-image paste. Bound to Ctrl-V;
 * carries no handler because the editor's `onKey` chain resolves it via
 * `blueKeymap.matches`.
 */
export const ACTION_IMAGE_PASTE = 'blue.image.paste'

/**
 * One clipboard read: the image bytes tagged with the media type the
 * clipboard itself declared, or a failure kind naming what is missing.
 */
export type ClipboardImageResult =
  | { kind: 'image'; data: Uint8Array; mediaType: ImageMediaType }
  | { kind: 'no-image' }
  | { kind: 'unsupported'; mediaType: string }
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
  /** The probe command. */
  command: string
  /** stderr signature meaning "no display session is reachable". */
  unreachable: RegExp
  /** Args listing the clipboard's offered types, one per line. */
  listArgs: readonly string[]
  /** Args reading back one offered media type. */
  readArgs: (mediaType: string) => string[]
}

/** Clipboard image tools probed in order: Wayland first, then X11. */
const CLIPBOARD_TOOLS: readonly ClipboardTool[] = [
  {
    command: 'wl-paste',
    unreachable: /failed to connect to a wayland server/i,
    listArgs: ['-l'],
    readArgs: mediaType => ['-t', mediaType],
  },
  {
    command: 'xclip',
    unreachable: /can(?:not|'t) open display/i,
    listArgs: ['-selection', 'clipboard', '-t', 'TARGETS', '-o'],
    readArgs: mediaType => ['-selection', 'clipboard', '-t', mediaType, '-o'],
  },
]

/** Per-tool timeout; a hung clipboard helper must not wedge the editor. */
const CLIPBOARD_TOOL_TIMEOUT_MS = 3000

/** Outcome of one clipboard tool invocation. */
type ToolRun =
  | { ok: true; stdout: Buffer }
  | { ok: false; code: string | number | undefined; killed: boolean; stderr: string }

/** The failed half of {@link ToolRun}. */
type FailedRun = Extract<ToolRun, { ok: false }>

/** Every non-image result kind. */
type FailureResult = Exclude<ClipboardImageResult, { kind: 'image' }>

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
  'no-image': 1,
  unreachable: 2,
  failed: 3,
  timeout: 4,
  'missing-tool': 5,
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
    execFile(command, args, { encoding: 'buffer', timeout: CLIPBOARD_TOOL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
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

/**
 * Probe one tool: list the clipboard's offered types, intersect with the
 * store's admitted types (`ADMITTED_IMAGE_TYPES` order — first readable
 * type wins), and read the bytes. A listing that only offers non-admitted
 * `image/*` types reports the unsupported type; hard read failures stop the
 * loop (they repeat for every remaining type).
 * @param tool - the tool to probe.
 * @returns the probe outcome.
 */
async function probeTool(tool: ClipboardTool): Promise<ClipboardImageResult> {
  const listing = await runTool(tool.command, tool.listArgs)
  if (!listing.ok) {
    const failure = classifyFailure(tool, listing)
    // A terse nonzero listing exit (xclip's empty-clipboard quirk fails
    // with no stderr) still queried the clipboard: treat it as no image.
    if (failure.kind === 'failed' && listing.stderr.trim() === '') return { kind: 'no-image' }
    return failure
  }
  const offered = listing.stdout.toString('utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
  const admitted = ADMITTED_IMAGE_TYPES.filter(mediaType => offered.includes(mediaType))
  if (admitted.length === 0) {
    const imageType = offered.find(type => type.startsWith('image/'))
    return imageType === undefined ? { kind: 'no-image' } : { kind: 'unsupported', mediaType: imageType }
  }
  let softFailure: ClipboardImageResult | undefined
  for (const mediaType of admitted) {
    const read = await runTool(tool.command, tool.readArgs(mediaType))
    if (read.ok) {
      if (read.stdout.length > 0) return { kind: 'image', data: read.stdout, mediaType }
      // The listing promised the type but the read came back empty (the
      // clipboard can change mid-probe): fall through to the next type.
      continue
    }
    const failure = classifyFailure(tool, read)
    if (failure.kind !== 'failed') return failure
    if (softFailure === undefined) softFailure = failure
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

/** The default reader: probe each tool in order; the first image wins,
 * otherwise the failures aggregate into one verdict. */
const defaultClipboardImageReader: ClipboardImageReader = async () => {
  const outcomes: FailureResult[] = []
  for (const tool of CLIPBOARD_TOOLS) {
    const outcome = await probeTool(tool)
    if (outcome.kind === 'image') return outcome
    outcomes.push(outcome)
  }
  return aggregateOutcomes(outcomes)
}

let clipboardImageReader: ClipboardImageReader = defaultClipboardImageReader

/**
 * Replace the clipboard image reader (tests inject a fake here).
 * @param reader - the replacement, or `undefined` to restore the default.
 */
export function setClipboardImageReader(reader: ClipboardImageReader | undefined): void {
  clipboardImageReader = reader ?? defaultClipboardImageReader
}

/**
 * Notice text per failure kind: each names what is missing so the user can
 * fix it (D48: diagnose, never work around).
 * @param result - the non-image reader outcome.
 * @returns the notice text.
 */
function failureNotice(result: FailureResult): string {
  switch (result.kind) {
    case 'missing-tool': return 'clipboard image tool missing: install wl-clipboard (wl-paste) or xclip'
    case 'unreachable': return 'clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'
    case 'no-image': return 'no image available from the clipboard'
    case 'unsupported': return `clipboard image type ${result.mediaType} is not supported`
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
function transformImageMarkers(text: string): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let last = 0
  for (const match of text.matchAll(IMAGE_MARKER)) {
    const ref = pastedImages.get(match[0])
    // Unknown marker: leave it in the surrounding text run.
    if (ref === undefined) continue
    const run = text.slice(last, match.index)
    if (run.length > 0) blocks.push({ type: 'text', text: run })
    blocks.push({ type: 'image', attachment: ref })
    pastedImages.delete(match[0])
    last = match.index + match[0].length
  }
  if (blocks.length === 0) return []
  const tail = text.slice(last)
  if (tail.length > 0) blocks.push({ type: 'text', text: tail })
  return blocks
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
async function pasteFlow(ctx: Context, shared: SharedEditor, isUnloaded: () => boolean): Promise<void> {
  // A missing notice callback degrades to silence rather than a throw.
  const notice = shared.notice ?? (() => {})
  let result: ClipboardImageResult
  try {
    result = await clipboardImageReader()
  } catch (error) {
    // An injected reader rejecting degrades to the same notice family.
    if (isUnloaded()) return
    const message = error instanceof Error ? error.message : String(error)
    notice(`clipboard read failed: ${message}`)
    return
  }
  if (isUnloaded()) return
  if (result.kind !== 'image') {
    notice(failureNotice(result))
    return
  }
  // The declared type comes from the clipboard's own type listing; the
  // store's admission sniffer cross-checks it against the bytes.
  try {
    const ref = await ctx.attachments.saveImage({
      data: result.data,
      mediaType: result.mediaType,
      name: `pasted-image.${EXT_BY_MEDIA_TYPE[result.mediaType]}`,
    })
    if (isUnloaded()) return
    pasteCount += 1
    const marker = `[image #${pasteCount}]`
    pastedImages.set(marker, ref)
    shared.editor.insertText(marker)
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
function attach(ctx: Context, shared: SharedEditor, isUnloaded: () => boolean): () => void {
  const { editor } = shared
  const previousOnKey = editor.onKey
  editor.onKey = (data) => {
    if (ctx.blueKeymap.matches(data, ACTION_IMAGE_PASTE)) {
      void pasteFlow(ctx, shared, isUnloaded)
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
export function apply(ctx: Context): void {
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
  let detach: (() => void) | undefined
  const reattach = (): void => {
    detach?.()
    detach = undefined
    const shared = getSharedEditor()
    if (shared !== undefined) detach = attach(ctx, shared, () => unloaded)
  }
  ctx.effect(() => () => {
    detach?.()
  })
  ctx.on('blue/input-editor-changed', reattach)
  reattach()
}
