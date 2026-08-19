/**
 * `blue-paste-image` plugin: Ctrl-V pastes a clipboard image into the input
 * editor as an attachment. The contextual `blue.image.paste` key action is
 * registered keyless-style (bound to ctrl+v, no handler) and resolved in a
 * wrapper chained onto the shared editor's `onKey` hook — ahead of the
 * pi-tui Editor, which has no clipboard-image handling of its own. The paste
 * flow is fire-and-forget: clipboard bytes come from an injectable reader
 * (the default probes stdout-form tools, `wl-paste` then `xclip`; macOS's
 * `pngpaste` writes only to files, so it is deliberately not probed), are
 * admitted through `ctx.attachments.saveImage`, and land in the editor as an
 * `[image #N]` marker recorded in a module-level marker→ref map. A submit
 * transformer (`./editor-instance.ts`) then splits submitted text on known
 * markers into text and image content blocks; unknown markers stay literal
 * text. The map and counter are module-level so markers survive theme-swap
 * reloads, which restore the editor text from the draft stash. Ships as a
 * subpath plugin so the baseline bundle keeps the plain text editor.
 *
 * @module @dsh-blue/blue-interaction/paste-image
 */

import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { getSharedEditor, registerSubmitTransformer, type SharedEditor } from './editor-instance.ts'
import { sniffImageMediaType } from './attachments.ts'

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
 * Reads the clipboard's current image, or resolves `undefined` when no
 * tool, no image, or a tool error applies. Never rejects.
 */
export type ClipboardImageReader = () => Promise<Uint8Array | undefined>

/** Clipboard image tools probed in order: Wayland first, then X11. */
const CLIPBOARD_TOOLS: readonly (readonly [command: string, args: string[]])[] = [
  ['wl-paste', ['-t', 'image/png']],
  ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
]

/** Per-tool timeout; a hung clipboard helper must not wedge the editor. */
const CLIPBOARD_TOOL_TIMEOUT_MS = 3000

/**
 * Run one clipboard tool, resolving its stdout bytes or `undefined` on any
 * failure (missing tool, no image, timeout, empty output).
 */
function runClipboardTool(command: string, args: string[]): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: 'buffer', timeout: CLIPBOARD_TOOL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null || stdout.length === 0) {
        resolve(undefined)
        return
      }
      resolve(new Uint8Array(stdout))
    })
  })
}

/** The default reader: the first probed tool yielding bytes wins. */
const defaultClipboardImageReader: ClipboardImageReader = async () => {
  for (const [command, args] of CLIPBOARD_TOOLS) {
    const data = await runClipboardTool(command, args)
    if (data !== undefined) return data
  }
  return undefined
}

let clipboardImageReader: ClipboardImageReader = defaultClipboardImageReader

/**
 * Replace the clipboard image reader (tests inject a fake here).
 * @param reader - the replacement, or `undefined` to restore the default.
 */
export function setClipboardImageReader(reader: ClipboardImageReader | undefined): void {
  clipboardImageReader = reader ?? defaultClipboardImageReader
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
 * Read the clipboard image, admit it through the attachment store, and
 * insert its marker at the editor cursor. All failures degrade to a
 * one-shot notice; late completions after a fiber unload no-op.
 * @param ctx - plugin context carrying the attachment store.
 * @param shared - the shared editor entry.
 * @param isUnloaded - reports whether this fiber unloaded mid-flight.
 */
async function pasteFlow(ctx: Context, shared: SharedEditor, isUnloaded: () => boolean): Promise<void> {
  // A missing notice callback degrades to silence rather than a throw.
  const notice = shared.notice ?? (() => {})
  let data: Uint8Array | undefined
  try {
    data = await clipboardImageReader()
  } catch {
    data = undefined
  }
  if (isUnloaded()) return
  if (data === undefined) {
    notice('no image available from the clipboard')
    return
  }
  // The probed tools yield PNG, but trust the sniffed bytes over the label.
  const mediaType = sniffImageMediaType(data) ?? 'image/png'
  try {
    const ref = await ctx.attachments.saveImage({ data, mediaType, name: 'pasted-image.png' })
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
