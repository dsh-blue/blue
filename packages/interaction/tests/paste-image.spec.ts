/**
 * Tests for the `blue-paste-image` plugin: the Ctrl-V key wrapper over the
 * shared editor's onKey chain, the paste flow (clipboard reader, declared
 * media type, admission through `ctx.attachments`, marker insertion, the
 * per-failure-kind notices), the submit transformer splitting `[image #N]`
 * markers, the default reader's two-step type negotiation through fake
 * clipboard tools, and the attach/registration lifecycle including
 * mid-flight fiber unloads.
 */

import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { applySubmitTransformers } from '../src/editor-instance.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import * as pasteImage from '../src/paste-image.ts'
import { ACTION_IMAGE_PASTE, type ClipboardImageResult } from '../src/paste-image.ts'
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

/** A JPEG magic prefix; the mocked store in this suite does not sniff. */
const JPEG_PREFIX = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
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

  it('pastes a declared image as an incrementing marker and splits it on submit', async () => {
    await mount()
    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: PNG_1X1, mediaType: 'image/png' }))
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

    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: GIF_1X1, mediaType: 'image/gif' }))
    pressPaste()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(2)
    })
    const secondMarker = editor.inserted[1]!
    expect(Number(/#(\d+)/.exec(secondMarker)![1])).toBe(Number(/#(\d+)/.exec(firstMarker)![1]) + 1)
    expect((saveImage.mock.calls[1]![0] as SaveImageAttachment).mediaType).toBe('image/gif')

    // The declared type passes through untouched: the name derives from it
    // and the store's admission (mocked here) owns the byte cross-check.
    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: JPEG_PREFIX, mediaType: 'image/jpeg' }))
    pressPaste()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(3)
    })
    const thirdRef = saveImage.mock.calls[2]![0] as SaveImageAttachment
    expect(thirdRef.mediaType).toBe('image/jpeg')
    expect(thirdRef.name).toBe('pasted-image.jpg')

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
      { type: 'image', attachment: expect.objectContaining({ mediaType: 'image/jpeg' }) },
    ])
    // No known markers at all: the fallback single text block.
    expect(applySubmitTransformers('plain line')).toEqual([{ type: 'text', text: 'plain line' }])
  })

  it('notices each clipboard failure kind with what is missing', async () => {
    await mount()
    const cases: ReadonlyArray<readonly [ClipboardImageResult, string]> = [
      [{ kind: 'missing-tool' }, 'clipboard image tool missing: install wl-clipboard (wl-paste) or xclip'],
      [{ kind: 'unreachable' }, 'clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'],
      [{ kind: 'no-image' }, 'no image available from the clipboard'],
      [{ kind: 'unsupported', mediaType: 'image/bmp' }, 'clipboard image type image/bmp is not supported'],
      [{ kind: 'timeout' }, 'clipboard read timed out'],
      [{ kind: 'failed', detail: 'wl-paste exited with code 1: nope' }, 'clipboard read failed: wl-paste exited with code 1: nope'],
    ]
    let seen = 0
    for (const [result, expected] of cases) {
      pasteImage.setClipboardImageReader(() => Promise.resolve(result))
      pressPaste()
      seen += 1
      await vi.waitFor(() => {
        expect(notices).toHaveLength(seen)
      })
      expect(notices[seen - 1]).toBe(expected)
    }
    expect(editor.inserted).toHaveLength(0)
  })

  it('notices when the reader rejects, with or without an Error', async () => {
    await mount()
    pasteImage.setClipboardImageReader(() => Promise.reject(new Error('tool broke')))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard read failed: tool broke'])
    })
    pasteImage.setClipboardImageReader(() => Promise.reject('raw failure'))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toHaveLength(2)
    })
    expect(notices[1]).toBe('clipboard read failed: raw failure')
    expect(editor.inserted).toHaveLength(0)
  })

  it('notices and keeps the buffer when admission rejects the image', async () => {
    await mount()
    const image = { kind: 'image', data: PNG_1X1, mediaType: 'image/png' } as const
    saveImage.mockRejectedValue(new AttachmentError('image exceeds the per-image byte limit', 'IMAGE_TOO_LARGE'))
    pasteImage.setClipboardImageReader(() => Promise.resolve(image))
    pressPaste()
    await vi.waitFor(() => {
      expect(notices).toEqual(['image rejected: image exceeds the per-image byte limit'])
    })
    expect(editor.inserted).toHaveLength(0)

    // A non-Error rejection still degrades to a readable notice.
    saveImage.mockRejectedValue('raw failure')
    pasteImage.setClipboardImageReader(() => Promise.resolve(image))
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
    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'no-image' }))
    plain.handleInput(KEY.ctrlV)
    await tick()
    expect(plain.inserted).toHaveLength(0)
    expect(plain.getText()).toBe('')
  })

  it('no-ops when the fiber unloads before the clipboard settles', async () => {
    await mount()
    const gate = Promise.withResolvers<ClipboardImageResult>()
    pasteImage.setClipboardImageReader(() => gate.promise)
    pressPaste()
    await fiber!.dispose()
    fiber = undefined
    gate.resolve({ kind: 'image', data: PNG_1X1, mediaType: 'image/png' })
    await tick()
    expect(editor.inserted).toHaveLength(0)
    expect(notices).toHaveLength(0)
    expect(saveImage).not.toHaveBeenCalled()

    // The same unload gate covers a rejecting reader: no notice flashes
    // through the dead fiber.
    await mount()
    const rejection = Promise.withResolvers<ClipboardImageResult>()
    pasteImage.setClipboardImageReader(() => rejection.promise)
    pressPaste()
    await fiber!.dispose()
    fiber = undefined
    rejection.reject(new Error('too late'))
    await tick()
    expect(notices).toHaveLength(0)
  })

  it('no-ops when the fiber unloads before the save settles or the rejection lands', async () => {
    await mount()
    const gate = Promise.withResolvers<ImageAttachmentRef>()
    saveImage.mockReturnValue(gate.promise)
    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: PNG_1X1, mediaType: 'image/png' }))
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
    pasteImage.setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: PNG_1X1, mediaType: 'image/png' }))
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
  const savedDisplay = process.env.DISPLAY
  const savedWayland = process.env.WAYLAND_DISPLAY
  let editor: FakeBlueEditor
  let notices: string[]
  let saveImage: ReturnType<typeof vi.fn>
  let ctx: Context
  let fiber: { dispose(): Promise<void> } | undefined

  beforeEach(() => {
    editor = new FakeBlueEditor()
    notices = []
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
    setSharedEditor({ editor, submitPrompt: () => {}, notice: text => notices.push(text) })
  })

  afterEach(async () => {
    process.env.PATH = savedPath
    if (savedDisplay === undefined) delete process.env.DISPLAY
    else process.env.DISPLAY = savedDisplay
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY
    else process.env.WAYLAND_DISPLAY = savedWayland
    pasteImage.setClipboardImageReader(undefined)
    clearSharedEditor()
    await fiber?.dispose()
    fiber = undefined
  })

  /** Octal-escape a byte array for a printf literal. */
  function shBytes(bytes: Uint8Array): string {
    return Array.from(bytes, byte => `\\${byte.toString(8).padStart(3, '0')}`).join('')
  }

  /** Write one executable fake tool into the bin directory. */
  function tool(bin: string, name: string, body: string): string {
    const path = join(bin, name)
    writeFileSync(path, body)
    chmodSync(path, 0o755)
    return path
  }

  /** Pin the session env to "no display" for the env-gated aggregation. */
  function unsetDisplaySession(): void {
    delete process.env.DISPLAY
    delete process.env.WAYLAND_DISPLAY
  }

  /** Mount the plugin with the default reader probing the fake bin. */
  async function mountDefault(): Promise<void> {
    fiber = await ctx.plugin(pasteImage)
    pasteImage.setClipboardImageReader(undefined)
    editor.handleInput(KEY.ctrlV)
  }

  /** A wl-paste fake: `-l` lists types, `-t <type>` prints mapped bytes. */
  function wlPasteFake(listing: string, reads: Record<string, string>): string {
    const cases = Object.entries(reads)
      .map(([type, bytes]) => `  ${type}) printf '${bytes}'; exit 0 ;;`)
      .join('\n')
    return `#!/bin/sh
if [ "$1" = '-l' ]; then printf '${listing}'; exit 0; fi
case "$2" in
${cases}
esac
exit 1
`
  }

  /** An xclip fake: TARGETS lists types, `-t <type> -o` prints mapped bytes. */
  function xclipFake(listing: string, reads: Record<string, string>): string {
    const cases = Object.entries(reads)
      .map(([type, bytes]) => `  ${type}) printf '${bytes}'; exit 0 ;;`)
      .join('\n')
    return `#!/bin/sh
if [ "$4" = 'TARGETS' ]; then printf '${listing}'; exit 0; fi
case "$4" in
${cases}
esac
exit 1
`
  }

  it('reads the first admitted type the listing offers, in admitted order', async () => {
    // The listing offers JPEG first, but png leads the admitted order and
    // both reads succeed: png wins.
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', wlPasteFake('image/jpeg\nimage/png\n', {
      'image/jpeg': shBytes(JPEG_PREFIX),
      'image/png': shBytes(PNG_1X1),
    }))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(1)
    })
    expect(saveImage.mock.calls[0]![0]).toMatchObject({ mediaType: 'image/png', name: 'pasted-image.png' })
  })

  it('falls to the next admitted type when the first read comes back empty', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', wlPasteFake('image/png\nimage/jpeg\n', {
      'image/png': '',
      'image/jpeg': shBytes(JPEG_PREFIX),
    }))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(1)
    })
    expect(saveImage.mock.calls[0]![0]).toMatchObject({ mediaType: 'image/jpeg', name: 'pasted-image.jpg' })
  })

  it('probes xclip after a silently failing wl-paste listing', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', '#!/bin/sh\nexit 1\n')
    tool(bin, 'xclip', xclipFake('TARGETS\nimage/png\n', { 'image/png': shBytes(PNG_1X1) }))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(editor.inserted).toHaveLength(1)
    })
    expect(saveImage.mock.calls[0]![0]).toMatchObject({ mediaType: 'image/png', name: 'pasted-image.png' })
  })

  it('notices the unsupported kind when only non-admitted image types are offered', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', wlPasteFake('image/bmp\n', {}))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard image type image/bmp is not supported'])
    })
    expect(editor.inserted).toHaveLength(0)
  })

  it('notices the missing tools when neither is on PATH', async () => {
    const bin = mkdtempTracked('blue-paste-empty-')
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard image tool missing: install wl-clipboard (wl-paste) or xclip'])
    })
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('notices the unreachable session when both tools cannot reach a display', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', '#!/bin/sh\necho \'Failed to connect to a Wayland server\' >&2\nexit 1\n')
    tool(bin, 'xclip', '#!/bin/sh\necho "Error: Can\'t open display: (null)" >&2\nexit 1\n')
    unsetDisplaySession()
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'])
    })
  })

  it('gates the unreachable/missing mix on the session env: display set', async () => {
    // wl-paste exists but cannot connect; xclip is absent. A display
    // session exists, so the absent tool is what is missing.
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', '#!/bin/sh\necho \'Failed to connect to a Wayland server\' >&2\nexit 1\n')
    process.env.DISPLAY = ':0'
    delete process.env.WAYLAND_DISPLAY
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard image tool missing: install wl-clipboard (wl-paste) or xclip'])
    })
  })

  it('gates the unreachable/missing mix on the session env: no display', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', '#!/bin/sh\necho \'Failed to connect to a Wayland server\' >&2\nexit 1\n')
    unsetDisplaySession()
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'])
    })
  })

  it('notices the timeout when a clipboard tool hangs', async () => {
    // /bin/sleep by absolute path: the replaced PATH cannot resolve a bare
    // `sleep`, which would exit 127 and never exercise the kill.
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', '#!/bin/sh\nexec /bin/sleep 10\n')
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard read timed out'])
    }, { timeout: 8000 })
    expect(saveImage).not.toHaveBeenCalled()
  })

  it('notices the raw failure detail when a read exits nonzero with stderr', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', `#!/bin/sh
if [ "$1" = '-l' ]; then printf 'image/png\n'; exit 0; fi
echo 'boom' >&2
exit 2
`)
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard read failed: wl-paste exited with code 2: boom'])
    })
  })

  it('keeps the first soft failure when every promised read fails softly', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', `#!/bin/sh
if [ "$1" = '-l' ]; then printf 'image/png\nimage/jpeg\n'; exit 0; fi
echo 'first boom' >&2
exit 3
`)
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard read failed: wl-paste exited with code 3: first boom'])
    })
  })

  it('notices no image when the clipboard holds only text', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', wlPasteFake('text/plain;charset=utf-8\nUTF8_STRING\n', {}))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['no image available from the clipboard'])
    })
  })

  it('treats a silent failed xclip listing as no image', async () => {
    // xclip's empty-clipboard quirk: nonzero listing exit, no stderr.
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'xclip', '#!/bin/sh\nexit 1\n')
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['no image available from the clipboard'])
    })
  })

  it('stops the read loop when a read step loses the display session', async () => {
    // The listing succeeds, the typed read hits the unreachable signature:
    // a hard failure must surface instead of retrying the remaining types.
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', `#!/bin/sh
if [ "$1" = '-l' ]; then printf 'image/png\nimage/jpeg\n'; exit 0; fi
echo 'Failed to connect to a Wayland server' >&2
exit 1
`)
    unsetDisplaySession()
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['clipboard unreachable: DISPLAY/WAYLAND_DISPLAY is not set in this session'])
    })
  })

  it('notices no image when every promised type reads back empty', async () => {
    const bin = mkdtempTracked('blue-paste-bin-')
    tool(bin, 'wl-paste', wlPasteFake('image/png\nimage/jpeg\n', {
      'image/png': '',
      'image/jpeg': '',
    }))
    process.env.PATH = bin
    await mountDefault()
    await vi.waitFor(() => {
      expect(notices).toEqual(['no image available from the clipboard'])
    })
  })
})
