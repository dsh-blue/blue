/**
 * Tests for the `blue-attachments` plugin: magic-byte sniffing, the
 * admission checks (type whitelist, sniff/declared match, byte and pixel
 * caps, dimension decoding), durable saves under the resolved storage root,
 * sanitized reads with cancellation, and the batch saveImages contract.
 */

import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId, type ImageAttachmentLimits, type ImageAttachmentRef, type SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import * as attachmentsPlugin from '../src/attachments.ts'
import { FilesystemAttachmentStore, sniffImageMediaType } from '../src/attachments.ts'
import { fakeBlueContext } from './fakes.ts'
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

/** A minimal JPEG signature (enough bytes for the sniffer). */
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])

/** A minimal RIFF/WEBP container header. */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
])

/** A RIFF container that is not WebP (the WEBP-at-offset-8 miss). */
const RIFF_NOT_WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x41, 0x42, 0x43, 0x44])

/** A prefix shorter than any magic (the startsWith length miss). */
const SHORT_BUFFER = new Uint8Array([0xff, 0xd8])

const GARBAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

/**
 * A store with test-sized caps: the admission comparisons are exercised with
 * tiny fixtures instead of 10MB buffers (the production limits are constants;
 * the branches under test read `this.imageLimits`).
 */
class CappedStore extends FilesystemAttachmentStore {
  // `declare`: re-declaring without it would reset the base field to
  // undefined (useDefineForClassFields) before the constructor runs.
  declare readonly imageLimits: ImageAttachmentLimits

  constructor(ctx: Context, limits: Partial<ImageAttachmentLimits>) {
    super(ctx)
    this.imageLimits = { ...this.imageLimits, ...limits }
  }
}

describe('sniffImageMediaType', () => {
  it('recognizes PNG, JPEG, GIF, and WebP signatures', () => {
    expect(sniffImageMediaType(PNG_1X1)).toBe('image/png')
    expect(sniffImageMediaType(JPEG_BYTES)).toBe('image/jpeg')
    expect(sniffImageMediaType(GIF_1X1)).toBe('image/gif')
    expect(sniffImageMediaType(WEBP_BYTES)).toBe('image/webp')
  })

  it('returns undefined for garbage, non-WebP RIFF, and short buffers', () => {
    expect(sniffImageMediaType(GARBAGE)).toBeUndefined()
    expect(sniffImageMediaType(RIFF_NOT_WEBP)).toBeUndefined()
    expect(sniffImageMediaType(SHORT_BUFFER)).toBeUndefined()
  })
})

describe('FilesystemAttachmentStore', () => {
  let root: string
  let ctx: Context
  let fiber: { dispose(): Promise<void> } | undefined

  beforeEach(() => {
    root = mkdtempTracked('blue-attachments-')
    process.env.DSH_BLUE_ATTACHMENT_DIR = root
    const blue = fakeBlueContext()
    ctx = blue.ctx
  })

  afterEach(async () => {
    delete process.env.DSH_BLUE_ATTACHMENT_DIR
    delete process.env.DSH_HOME
    await fiber?.dispose()
    fiber = undefined
    rmSync(root, { recursive: true, force: true })
  })

  /** Mount the store the way the plugin does. */
  async function mount(): Promise<FilesystemAttachmentStore> {
    fiber = await ctx.plugin(attachmentsPlugin)
    const store = ctx.attachments
    expect(store).toBeInstanceOf(FilesystemAttachmentStore)
    return store
  }

  it('registers as the attachments service through apply', async () => {
    await mount()
  })

  it('resolves the root from DSH_HOME when the dir override is unset', async () => {
    delete process.env.DSH_BLUE_ATTACHMENT_DIR
    const home = mkdtempTracked('blue-attachments-home-')
    process.env.DSH_HOME = home
    rmSync(root, { recursive: true, force: true })
    root = home
    const store = await mount()
    const ref = await store.saveImage({ data: PNG_1X1, mediaType: 'image/png' })
    statSync(join(home, 'attachments', `${ref.attachmentId}.png`))
  })

  it('falls back to ~/.dsh when neither override is set', async () => {
    delete process.env.DSH_BLUE_ATTACHMENT_DIR
    delete process.env.DSH_HOME
    // Construction alone resolves the root branch; no IO touches ~ here.
    new FilesystemAttachmentStore(ctx)
    // Re-arm the per-test cleanup path with a throwaway mount.
    process.env.DSH_BLUE_ATTACHMENT_DIR = root
    await mount()
  })

  it('validateImage admits a known image and rejects each failure mode', async () => {
    const store = await mount()
    await expect(store.validateImage({ data: PNG_1X1, mediaType: 'image/png' })).resolves.toBeUndefined()

    const unsupported = await store.validateImage({ data: PNG_1X1, mediaType: 'image/bmp' as 'image/png' }).catch(error => error as AttachmentError)
    expect(unsupported).toBeInstanceOf(AttachmentError)
    expect(unsupported.code).toBe('UNSUPPORTED_IMAGE_TYPE')

    const undetectable = await store.validateImage({ data: GARBAGE, mediaType: 'image/png' }).catch(error => error as AttachmentError)
    expect(undetectable.code).toBe('INVALID_IMAGE')

    const mismatch = await store.validateImage({ data: PNG_1X1, mediaType: 'image/gif' }).catch(error => error as AttachmentError)
    expect(mismatch.code).toBe('IMAGE_TYPE_MISMATCH')

    const undecodable = await store.validateImage({ data: JPEG_BYTES, mediaType: 'image/jpeg' }).catch(error => error as AttachmentError)
    expect(undecodable.code).toBe('INVALID_IMAGE')
  })

  it('enforces the byte and pixel caps against this.imageLimits', async () => {
    // Each direct construction registers the attachments service, so each
    // capped store gets its own throwaway context.
    const capped = new CappedStore(fakeBlueContext().ctx, { maxImageBytes: 10, maxImagePixels: 0 })
    // PNG-magic-prefixed filler: sniffing passes, the byte cap trips before
    // dimension decoding is consulted.
    const oversized = new Uint8Array(70)
    oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const tooLarge = await capped.validateImage({ data: oversized, mediaType: 'image/png' }).catch(error => error as AttachmentError)
    expect(tooLarge.code).toBe('IMAGE_TOO_LARGE')
    // The byte cap passes but the pixel cap (0) trips on the 1x1 fixture.
    const cappedPixels = new CappedStore(fakeBlueContext().ctx, { maxImagePixels: 0 })
    const tooMany = await cappedPixels.validateImage({ data: GIF_1X1, mediaType: 'image/gif' }).catch(error => error as AttachmentError)
    expect(tooMany.code).toBe('IMAGE_TOO_MANY_PIXELS')
    // The per-side dimension cap (0.1.1's limits field) trips independently
    // of the aggregate pixel count.
    const cappedDimension = new CappedStore(fakeBlueContext().ctx, { maxImageDimension: 0 })
    const tooWide = await cappedDimension.validateImage({ data: GIF_1X1, mediaType: 'image/gif' }).catch(error => error as AttachmentError)
    expect(tooWide.code).toBe('IMAGE_TOO_MANY_PIXELS')
  })

  it('saveImage persists under the root with decoded metadata and optional name', async () => {
    const store = await mount()
    const ref = await store.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'shot.png' })
    expect(ref.mediaType).toBe('image/png')
    expect(ref.bytes).toBe(PNG_1X1.byteLength)
    expect(ref).toMatchObject({ width: 1, height: 1, name: 'shot.png' })
    statSync(join(root, `${ref.attachmentId}.png`))

    const unnamed = await store.saveImage({ data: GIF_1X1, mediaType: 'image/gif' })
    expect('name' in unnamed).toBe(false)
    statSync(join(root, `${unnamed.attachmentId}.gif`))
  })

  it('saveImage maps write failures to ATTACHMENT_WRITE_FAILED', async () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'a regular file')
    process.env.DSH_BLUE_ATTACHMENT_DIR = join(blocker, 'sub')
    const store = await mount()
    const error = await store.saveImage({ data: PNG_1X1, mediaType: 'image/png' }).catch(failure => failure as AttachmentError)
    expect(error.code).toBe('ATTACHMENT_WRITE_FAILED')
  })

  it('readImage round-trips stored bytes', async () => {
    const store = await mount()
    const ref = await store.saveImage({ data: PNG_1X1, mediaType: 'image/png' })
    const stored = await store.readImage(ref)
    expect(stored.ref).toEqual(ref)
    expect(Array.from(stored.data)).toEqual(Array.from(PNG_1X1))
  })

  it('readImage rejects non-store ids before touching the filesystem', async () => {
    const store = await mount()
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('../escape'),
      mediaType: 'image/png',
      bytes: 0,
      width: 0,
      height: 0,
    }
    const error = await store.readImage(ref).catch(failure => failure as AttachmentError)
    expect(error.code).toBe('INVALID_ATTACHMENT_REF')
  })

  it('readImage maps ENOENT to ATTACHMENT_NOT_FOUND', async () => {
    const store = await mount()
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('deadbeef'),
      mediaType: 'image/png',
      bytes: 0,
      width: 0,
      height: 0,
    }
    const error = await store.readImage(ref).catch(failure => failure as AttachmentError)
    expect(error.code).toBe('ATTACHMENT_NOT_FOUND')
  })

  it('readImage maps other failures to ATTACHMENT_READ_FAILED', async () => {
    const blocker = join(root, 'blocker')
    writeFileSync(blocker, 'a regular file')
    process.env.DSH_BLUE_ATTACHMENT_DIR = join(blocker, 'sub')
    const store = await mount()
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('deadbeef'),
      mediaType: 'image/png',
      bytes: 0,
      width: 0,
      height: 0,
    }
    const error = await store.readImage(ref).catch(failure => failure as AttachmentError)
    expect(error.code).toBe('ATTACHMENT_READ_FAILED')
  })

  it('readImage honors the abort signal before and after the read', async () => {
    const store = await mount()
    const ref = await store.saveImage({ data: PNG_1X1, mediaType: 'image/png' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(store.readImage(ref, aborted.signal)).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))

    // The post-read check: a signal that only trips the second time through.
    let checks = 0
    const lateAbort = {
      throwIfAborted(): void {
        checks += 1
        if (checks > 1) throw new DOMException('aborted', 'AbortError')
      },
    } as unknown as AbortSignal
    await expect(store.readImage(ref, lateAbort)).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))
  })

  it('saveImages validates the whole batch before committing any member', async () => {
    const store = await mount()
    const inputs: SaveImageAttachment[] = [
      { data: PNG_1X1, mediaType: 'image/png', name: 'a.png' },
      { data: GIF_1X1, mediaType: 'image/gif', name: 'b.gif' },
    ]
    const refs = await store.saveImages(inputs)
    expect(refs).toHaveLength(2)
    expect(readdirSync(root).sort()).toHaveLength(2)

    const failing: SaveImageAttachment[] = [inputs[0]!, { data: GARBAGE, mediaType: 'image/png' }]
    await expect(store.saveImages(failing)).rejects.toBeInstanceOf(AttachmentError)
    // The valid first member was never written.
    expect(readdirSync(root).sort()).toHaveLength(2)
  })
})
