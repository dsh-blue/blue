/**
 * Tests for the `blue-paste-image` plugin: the Ctrl-V key wrapper over the
 * shared editor's onKey chain, the paste flow (clipboard reader, sniffed
 * media type, admission through `ctx.attachments`, marker insertion, notice
 * degradation), the submit transformer splitting `[image #N]` markers, and
 * the attach/registration lifecycle including mid-flight fiber unloads.
 */

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { applySubmitTransformers } from '../src/editor-instance.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import * as pasteImage from '../src/paste-image.ts'
import { ACTION_IMAGE_PASTE } from '../src/paste-image.ts'
import { fakeBlueContext, FakeBlueEditor, KEY, type FakeKeymap } from './fakes.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'


registerTempDirCleanup()

/** A 1x1 PNG (shared literal shape with core's components suite). */
const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
  0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
  0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

/** A 1x1 GIF. */
const GIF_1X1 = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 33, 249, 4, 1, 0, 0,
  0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
])

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

describe('blue-paste-image plugin', () => {
  let root: string
  let editor: FakeBlueEditor
  let notices: string[]
  let saveImage: ReturnType<typeof vi.fn>
  let ctx: Context
  let keymap: FakeKeymap
  let fiber: { dispose(): Promise<void> } | undefined

  beforeEach(() => {
    root = mkdtempTracked('blue-paste-image-')
    editor = new FakeBlueEditor()
    notices = []
    let saved = 0
    saveImage = vi.fn(async (input: SaveImageAttachment): Promise<ImageAttachmentRef> => {
      saved += 1
      return {
        attachmentId: AttachmentId(`spec-${saved}`),
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width: 1,
        height: 1,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
    })
    const blue = fakeBlueContext()
    ctx = blue.ctx
    keymap = blue.keymap
    ctx.provide('attachments', { saveImage })
    setSharedEditor({ editor, submitPrompt: () => {}, notice: text => notices.push(text) })
  })

  afterEach(async () => {
    pasteImage.setClipboardImageReader(undefined)
    clearSharedEditor()
    await fiber?.dispose()
    fiber = undefined
    rmSync(root, { recursive: true, force: true })
  })

  /** Mount the plugin against the fakes. */
  async function mount(): Promise<void> {
    fiber = await ctx.plugin(pasteImage)
  }

  /** Trigger the paste key; the wrapper consumes it. */
  function pressPaste(): void {
    editor.handleInput(KEY.ctrlV)
  }

  it('registers the ctrl+v action and the submit transformer until dispose', async () => {
    await mount()
    expect(keymap.getKeys(ACTION_IMAGE_PASTE)).toEqual(['ctrl+v'])
    expect(applySubmitTransformers('[image #99]')).toEqual([{ type: 'text', text: '[image #99]' }])
    await fiber!.dispose()
    fiber = undefined
    expect(keymap.getKeys(ACTION_IMAGE_PASTE)).toEqual([])
    expect(keymap.list().some(action => action.id === ACTION_IMAGE_PASTE)).toBe(false)
  })

  it('consumes the paste key and delegates every other key to the previous handler', async () => {
    const consumed: string[] = []
    editor.onKey = data => {
      consumed.push(data)
      return data === KEY.escape
    }
    await mount()
    pressPaste()
    expect(editor.getText()).toBe('')
    expect(editor.handleInput(KEY.escape)).toBeUndefined()
    expect(consumed).toEqual([KEY.escape])
    // No prior handler for a wrapped bare editor: the wrapper reports false.
    const bare = new FakeBlueEditor()
    setSharedEditor({ editor: bare, submitPrompt: () => {} })
    ctx.emit('blue/input-editor-changed')
    expect(bare.onKey?.('x')).toBe(false)
    expect(bare.getText()).toBe('')
  })

  it('restores the previous handler when the fiber disposes', async () => {
    const previous = vi.fn(() => false)
    editor.onKey = previous
    await mount()
    await fiber!.dispose()
    fiber = undefined
    expect(editor.onKey).toBe(previous)
    // The wrapper is gone: the paste key now falls through to the restored
    // handler instead of triggering a paste.
    pressPaste()
    expect(previous).toHaveBeenCalledWith(KEY.ctrlV)
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('reattaches on blue/input-editor-changed without stacking wrappers', async () => {
    await mount()
    const first = editor.onKey
    const second = new FakeBlueEditor()
    setSharedEditor({ editor: second, submitPrompt: () => {} })
    ctx.emit('blue/input-editor-changed')
    // The first editor's handler chain was restored (undefined originally).
    expect(editor.onKey).toBeUndefined()
    expect(second.onKey).toBeDefined()
    expect(second.onKey).not.toBe(first)
    // A second emission replaces, not stacks: the wrapper delegates through
    // at most one paste wrapper, observable by both keys still routing.
    const third = new FakeBlueEditor()
    setSharedEditor({ editor: third, submitPrompt: () => {} })
    ctx.emit('blue/input-editor-changed')
    expect(second.onKey).toBeUndefined()
    expect(third.onKey).toBeDefined()
    // And a clearing emission with no mounted editor is tolerated.
    clearSharedEditor()
    ctx.emit('blue/input-editor-changed')
    // Re-arming for afterEach teardown checks.
    setSharedEditor({ editor: third, submitPrompt: () => {} })
  })

  it('pastes a sniffed image as an incrementing marker and splits it on submit', async () => {
    await mount()
    pasteImage.setClipboardImageReader(() => Promise.resolve(PNG_1X1))
    pressPaste()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(1)
    })
    const firstMarker = editor.inserted[0]!
    expect(firstMarker).toMatch(/^\[image #\d+\]$/)
    const firstRef = saveImage.mock.calls[0]![0] as SaveImageAttachment
    expect(firstRef.mediaType).toBe('image/png')
    expect(firstRef.name).toBe('pasted-image.png')
    expect(firstRef.data).toBe(PNG_1X1)

    pasteImage.setClipboardImageReader(() => Promise.resolve(GIF_1X1))
    pressPaste()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(2)
    })
    const secondMarker = editor.inserted[1]!
    expect(Number(/#(\d+)/.exec(secondMarker)![1])).toBe(Number(/#(\d+)/.exec(firstMarker)![1]) + 1)
    expect((saveImage.mock.calls[1]![0] as SaveImageAttachment).mediaType).toBe('image/gif')

    // Sniffing miss falls back to the PNG label the tools promise.
    pasteImage.setClipboardImageReader(() => Promise.resolve(new Uint8Array([1, 2, 3])))
    pressPaste()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(3)
    })
    expect((saveImage.mock.calls[2]![0] as SaveImageAttachment).mediaType).toBe('image/png')

    // Submit splitting: known markers become image blocks with text runs.
    const blocks = applySubmitTransformers(`before ${firstMarker} mid ${secondMarker} after`)
    expect(blocks).toEqual([
      { type: 'text', text: 'before ' },
      { type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png' }) },
      { type: 'text', text: ' mid ' },
      { type: 'image', attachment: expect.objectContaining({ mediaType: 'image/gif' }) },
      { type: 'text', text: ' after' },
    ])
    // Consumed markers leave the map: a resubmit keeps them literal.
    expect(applySubmitTransformers(`again ${firstMarker}`)).toEqual([
      { type: 'text', text: `again ${firstMarker}` },
    ])
    // A marker-only line yields just the image block (the third, unconsumed
    // paste).
    const thirdMarker = editor.inserted[2]!
    expect(applySubmitTransformers(thirdMarker)).toEqual([
      { type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png' }) },
    ])
    // No known markers at all: the fallback single text block.
    expect(applySubmitTransformers('plain line')).toEqual([{ type: 'text', text: 'plain line' }])
  })

  it('notices when the clipboard has no image or the reader fails', async () => {
    await mount()
    pasteImage.setClipboardImageReader(() => Promise.resolve(undefined))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toEqual(['no image available from the clipboard'])
    })
    pasteImage.setClipboardImageReader(() => Promise.reject(new Error('tool broke')))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toHaveLength(2)
    })
    expect(notices[1]).toBe('no image available from the clipboard')
    expect(editor.inserted).toHaveLength(0)
  })

  it('notices and keeps the buffer when admission rejects the image', async () => {
    await mount()
    saveImage.mockRejectedValue(new AttachmentError('image exceeds the per-image byte limit', 'IMAGE_TOO_LARGE'))
    pasteImage.setClipboardImageReader(() => Promise.resolve(PNG_1X1))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toEqual(['image rejected: image exceeds the per-image byte limit'])
    })
    expect(editor.inserted).toHaveLength(0)

    // A non-Error rejection still degrades to a readable notice.
    saveImage.mockRejectedValue('raw failure')
    pasteImage.setClipboardImageReader(() => Promise.resolve(PNG_1X1))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toEqual([
        'image rejected: image exceeds the per-image byte limit',
        'image rejected: raw failure',
      ])
    })
    expect(editor.inserted).toHaveLength(0)
  })

  it('stays silent without a notice callback', async () => {
    await mount()
    const plain = new FakeBlueEditor()
    setSharedEditor({ editor: plain, submitPrompt: () => {} })
    ctx.emit('blue/input-editor-changed')
    pasteImage.setClipboardImageReader(() => Promise.resolve(undefined))
    plain.handleInput(KEY.ctrlV)
    await tick()
    expect(plain.inserted).toHaveLength(0)
    expect(plain.getText()).toBe('')
  })

  it('no-ops when the fiber unloads before the clipboard settles', async () => {
    await mount()
    const gate = Promise.withResolvers<Uint8Array | undefined>()
    pasteImage.setClipboardImageReader(() => gate.promise)
    pressPaste()
    await fiber!.dispose()
    fiber = undefined
    gate.resolve(PNG_1X1)
    await tick()
    expect(editor.inserted).toHaveLength(0)
    expect(notices).toHaveLength(0)
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('no-ops when the fiber unloads before the save settles or the rejection lands', async () => {
    await mount()
    const gate = Promise.withResolvers<ImageAttachmentRef>()
    saveImage.mockReturnValue(gate.promise)
    pasteImage.setClipboardImageReader(() => Promise.resolve(PNG_1X1))
    pressPaste()
    await fiber!.dispose()
    fiber = undefined
    gate.resolve({
      attachmentId: AttachmentId('late'),
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    })
    await tick()
    expect(editor.inserted).toHaveLength(0)

    // The same guard covers the rejection continuation.
    await mount()
    const failure = Promise.withResolvers<ImageAttachmentRef>()
    saveImage.mockReturnValue(failure.promise)
    pasteImage.setClipboardImageReader(() => Promise.resolve(PNG_1X1))
    pressPaste()
    await fiber!.dispose()
    fiber = undefined
    failure.reject(new AttachmentError('late', 'IMAGE_TOO_LARGE'))
    await tick()
    expect(notices).toHaveLength(0)
  })
})

describe('default clipboard image reader', () => {
  const savedPath = process.env.PATH
  let editor: FakeBlueEditor
  let saveImage: ReturnType<typeof vi.fn>
  let ctx: Context
  let fiber: { dispose(): Promise<void> } | undefined

  beforeEach(() => {
    editor = new FakeBlueEditor()
    saveImage = vi.fn(async (input: SaveImageAttachment): Promise<ImageAttachmentRef> => ({
      attachmentId: AttachmentId('spec-default'),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }))
    const blue = fakeBlueContext()
    ctx = blue.ctx
    ctx.provide('attachments', { saveImage })
    setSharedEditor({ editor, submitPrompt: () => {}, notice: () => {} })
  })

  afterEach(async () => {
    process.env.PATH = savedPath
    pasteImage.setClipboardImageReader(undefined)
    clearSharedEditor()
    await fiber?.dispose()
    fiber = undefined
  })

  /** Octal-escape script body printing the PNG bytes on stdout. */
  function pngPrinter(): string {
    const escaped = Array.from(PNG_1X1, byte => `\\${byte.toString(8).padStart(3, '0')}`).join('')
    return `#!/bin/sh\nprintf '${escaped}'\n`
  }

  it('probes wl-paste then xclip through the real tools', async () => {
    fiber = await ctx.plugin(pasteImage)
    // Restoring the default reader makes the paste flow probe the real tools.
    pasteImage.setClipboardImageReader(undefined)
    const bin = mkdtempTracked('blue-paste-bin-')
    const wl = join(bin, 'wl-paste')
    writeFileSync(wl, '#!/bin/sh\nexit 1\n')
    chmodSync(wl, 0o755)
    const xc = join(bin, 'xclip')
    writeFileSync(xc, pngPrinter())
    chmodSync(xc, 0o755)
    process.env.PATH = bin
    editor.handleInput(KEY.ctrlV)
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(1)
    })
    expect(saveImage.mock.calls[0]![0]).toMatchObject({ mediaType: 'image/png', name: 'pasted-image.png' })
    rmSync(bin, { recursive: true, force: true })
  })

  it('resolves undefined when both tools fail', async () => {
    fiber = await ctx.plugin(pasteImage)
    pasteImage.setClipboardImageReader(undefined)
    const bin = mkdtempTracked('blue-paste-empty-')
    process.env.PATH = bin
    editor.handleInput(KEY.ctrlV)
    await new Promise(resolve => setImmediate(resolve))
    expect(editor.inserted).toHaveLength(0)
    expect(saveImage).not.toHaveBeenCalled()
    rmSync(bin, { recursive: true, force: true })
  })
})
