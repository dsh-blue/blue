/**
 * `blue-attachments` plugin: provides the harness `attachments` service with
 * a filesystem-backed `AttachmentStore`. Images are admitted through the
 * deployment limits below (media-type whitelist, magic-byte sniffing matched
 * against the declared type, byte cap, and pixel cap decoded through
 * `blueComponents.imageDimensions` — only core may parse image bytes) and
 * persisted as `<attachmentId>.<ext>` files under the storage root:
 * `DSH_BLUE_ATTACHMENT_DIR`, else `$DSH_HOME/attachments`, else
 * `~/.dsh/attachments`. Attachment ids are random UUIDs, so reads sanitize
 * the id against path traversal before touching the filesystem. Ships as a
 * subpath plugin so the baseline bundle keeps the abstract seam unprovided;
 * `blue-paste-image` is the in-tree consumer. The admitted-type order and
 * the extension map are shared with that sibling plugin, which negotiates
 * clipboard types against the order and derives attachment names from the
 * map; the magic-byte sniffer is the store's own admission cross-check.
 *
 * @module @dsh-blue/blue-interaction/attachments
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError, AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'

/** Stable Cordis plugin name. */
export const name = 'blue-attachments'
/** Services required before the store can decode image dimensions. */
export const inject = ['blueComponents']

/**
 * Admitted image media types in probe-preference order. Single source for
 * the store whitelist and for `blue-paste-image`, which negotiates
 * clipboard types against this order (first readable type wins).
 */
export const ADMITTED_IMAGE_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** The deployment image policy this store admits against. */
const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImagesPerMessage: 8,
  maxMessageImageBytes: 30 * 1024 * 1024,
  // 4096×4096: the pixel cap and the per-side cap agree on a square bound.
  maxImagePixels: 16_777_216,
  maxImageDimension: 4096,
  mediaTypes: [...ADMITTED_IMAGE_TYPES],
}

/**
 * File extension per admitted media type, shared with `blue-paste-image`
 * for attachment name derivation.
 */
export const EXT_BY_MEDIA_TYPE: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_MAGIC = [0xff, 0xd8, 0xff]
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38]
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]

/**
 * Test whether `data` starts with the given byte sequence.
 * @param data - the bytes to inspect.
 * @param magic - the expected prefix.
 * @returns whether the prefix matches.
 */
function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  if (data.length < magic.length) return false
  return magic.every((byte, at) => data[at] === byte)
}

/**
 * Sniff the image media type from encoded magic bytes. The store's
 * admission cross-check: a declared type that disagrees with the bytes is
 * rejected (`IMAGE_TYPE_MISMATCH`).
 * @param data - the encoded image bytes.
 * @returns the detected type, or `undefined` when no signature matches.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (startsWith(data, PNG_MAGIC)) return 'image/png'
  if (startsWith(data, JPEG_MAGIC)) return 'image/jpeg'
  if (startsWith(data, GIF_MAGIC)) return 'image/gif'
  // WebP is a RIFF container: 'RIFF' at 0 and 'WEBP' at offset 8.
  if (startsWith(data, RIFF_MAGIC) && startsWith(data.subarray(8), WEBP_MAGIC)) return 'image/webp'
  return undefined
}

/**
 * The filesystem-backed `attachments` service. Registered as a Cordis
 * service by construction (`AttachmentStore` extends `Service`), so mounting
 * it with `ctx.plugin` makes `ctx.attachments` resolve until this fiber
 * unloads.
 */
export class FilesystemAttachmentStore extends AttachmentStore {
  readonly imageLimits = IMAGE_LIMITS
  private readonly root: string

  /**
   * Create and register the store.
   * @param ctx - the owning Cordis context.
   */
  constructor(ctx: Context) {
    super(ctx)
    this.root = process.env.DSH_BLUE_ATTACHMENT_DIR
      ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'attachments')
  }

  /** The storage path for one id and media type. */
  private pathFor(id: string, mediaType: ImageMediaType): string {
    return join(this.root, `${id}.${EXT_BY_MEDIA_TYPE[mediaType]}`)
  }

  /**
   * Run the admission checks shared by validate and save.
   * @param input - encoded bytes, declared media type, and optional name.
   * @returns the decoded pixel dimensions.
   */
  private admission(input: SaveImageAttachment): { width: number, height: number } {
    if (!this.imageLimits.mediaTypes.includes(input.mediaType)) {
      throw new AttachmentError(`image type ${input.mediaType} is not supported`, 'UNSUPPORTED_IMAGE_TYPE')
    }
    const sniffed = sniffImageMediaType(input.data)
    if (sniffed === undefined) {
      throw new AttachmentError('image bytes are not a recognizable PNG, JPEG, GIF, or WebP', 'INVALID_IMAGE')
    }
    if (sniffed !== input.mediaType) {
      throw new AttachmentError(`declared ${input.mediaType} but the bytes sniff as ${sniffed}`, 'IMAGE_TYPE_MISMATCH')
    }
    if (input.data.byteLength > this.imageLimits.maxImageBytes) {
      throw new AttachmentError('image exceeds the per-image byte limit', 'IMAGE_TOO_LARGE')
    }
    const dimensions = this.ctx.blueComponents.imageDimensions(input.data)
    if (dimensions === undefined) {
      throw new AttachmentError('image dimensions could not be decoded', 'INVALID_IMAGE')
    }
    if (dimensions.width * dimensions.height > this.imageLimits.maxImagePixels) {
      throw new AttachmentError('image exceeds the pixel limit', 'IMAGE_TOO_MANY_PIXELS')
    }
    if (
      dimensions.width > this.imageLimits.maxImageDimension
      || dimensions.height > this.imageLimits.maxImageDimension
    ) {
      throw new AttachmentError('image exceeds the per-side dimension limit', 'IMAGE_TOO_MANY_PIXELS')
    }
    return dimensions
  }

  /**
   * Validate one image without persisting it.
   * @param input - encoded bytes, declared media type, and optional name.
   */
  async validateImage(input: SaveImageAttachment): Promise<void> {
    this.admission(input)
  }

  /**
   * Validate and durably commit one image.
   * @param input - encoded bytes, declared media type, and optional name.
   * @returns the durable reference with decoded metadata filled in.
   */
  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const dimensions = this.admission(input)
    const id = randomUUID()
    try {
      await mkdir(this.root, { recursive: true })
      await writeFile(this.pathFor(id, input.mediaType), input.data)
    } catch (error) {
      throw new AttachmentError('failed to write the image to the attachment store', 'ATTACHMENT_WRITE_FAILED', { cause: error })
    }
    return {
      attachmentId: AttachmentId(id),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      // exactOptionalPropertyTypes forbids assigning undefined to the slot.
      ...(input.name === undefined ? {} : { name: input.name }),
    }
  }

  /**
   * Read one stored image. The id is sanitized before path construction —
   * it is opaque, never caller-controlled path material.
   * @param ref - the durable reference from the session log.
   * @param signal - optional cancellation for the read.
   * @returns the stored bytes with their canonical reference.
   */
  async readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    const id: string = ref.attachmentId
    // Store ids are random UUIDs; anything else is not a store key.
    if (!/^[0-9a-f-]+$/i.test(id)) {
      throw new AttachmentError('attachment id is not a valid store key', 'INVALID_ATTACHMENT_REF')
    }
    signal?.throwIfAborted()
    let data: Buffer
    try {
      data = await readFile(this.pathFor(id, ref.mediaType))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new AttachmentError('attachment is not in the store', 'ATTACHMENT_NOT_FOUND', { cause: error })
      }
      throw new AttachmentError('failed to read the attachment from the store', 'ATTACHMENT_READ_FAILED', { cause: error })
    }
    signal?.throwIfAborted()
    return { ref, data: new Uint8Array(data) }
  }
}

/**
 * Mount the filesystem attachment store as `ctx.attachments`; the service
 * unregisters when the plugin's fiber unloads.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(FilesystemAttachmentStore)
}
