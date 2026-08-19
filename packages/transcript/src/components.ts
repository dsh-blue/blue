/**
 * Transcript components: self-contained `BlueComponent` implementations over
 * the `blueComponents` factory (`ctx.blueComponents`). None of them imports
 * pi-tui — `render(width)` returns styled ANSI lines within `width` visible
 * columns. The assistant body is a held `BlueMarkdown` instance (created
 * once, streamed via `setText`, rendered straight through); the remaining
 * components wrap/truncate through the factory's width helpers and cache by
 * (source text, width) so the screen's throttled redraws stay cheap while a
 * `TranscriptItem` mutates underneath.
 *
 * @module @dsh-blue/blue-transcript/components
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {
  BlueComponent,
  BlueComponents,
  BlueImage,
  BlueMarkdown,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import { ellipsize } from './fold.ts'
import type {
  TranscriptAssistantItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from './types.ts'

/** Maximum length of the tool-call arguments shown on the call line. */
export const TOOL_ARGUMENTS_MAX_CHARS = 60

/** The assistant block's first-line marker (kimi `constant/symbols.ts`). */
const STATUS_BULLET = '● '

/** The user block's first-line marker (kimi `USER_MESSAGE_BULLET`). */
export const USER_MESSAGE_BULLET = '✨ '

/** Continuation indent: the bullet's visible width (kimi `MESSAGE_INDENT`). */
export const MESSAGE_INDENT = '  '

/** Bold SGR pair — S18 wraps the user echo the way kimi's `boldFg` does. */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** Maximum rendered height of one user-message image, in terminal cells. */
export const USER_IMAGE_MAX_HEIGHT_CELLS = 12

/**
 * Loads one image attachment's bytes. Resolves `undefined` when the bytes
 * are unavailable (missing store, read failure) — the placeholder stays.
 */
export type UserImageLoader = (ref: ImageAttachmentRef) => Promise<Uint8Array | undefined>

/** Optional image-rendering wiring for {@link UserMessageComponent}. */
export interface UserMessageImages {
  /** The attachment byte loader; absent loaders keep the `[image]` rows. */
  loadImage?: UserImageLoader
  /** Nudge called after an image resolves so the screen re-renders. */
  onReady?(): void
}

/** Cache keyed on the inputs a component's rendered lines depend on. */
interface RenderCache {
  key: string
  lines: string[]
}

/**
 * Renders one user prompt behind the kimi user-message chrome (S18): a
 * blank separator row, then the bold `roleUser` `✨ ` bullet on the first
 * line with the full text bold `roleUser` — the kimi `boldFg('roleUser', …)`
 * wrap, composed here as bold SGR around the palette color, so the visible
 * width never changes. Continuations align under the text with spaces of
 * the bullet's visible width (kimi re-dyes the text before wrapping; Blue
 * colors each wrapped line, which re-emits the same per-line spans). When
 * the item carries image attachments and a loader was provided, loads kick
 * off lazily on the first render; each image renders its loaded lines
 * below the text at the content width, indented to the same bullet width
 * (a muted `[image]` row while loading or after failure), and a resolve
 * bumps the cache version, invalidates, and nudges `onReady`.
 */
export class UserMessageComponent implements BlueComponent {
  private readonly item: TranscriptUserItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private readonly loadImage: UserImageLoader | undefined
  private readonly onReady: (() => void) | undefined
  /** Per-image outcome: the image component, null for a failed load. */
  private readonly resolved = new Map<number, BlueImage | null>()
  private imagesRequested = false
  private imageVersion = 0
  private cache: RenderCache | null = null

  /**
   * @param item - the folded user item to render.
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   * @param images - optional image loader and readiness nudge.
   */
  constructor(
    item: TranscriptUserItem,
    colors: BlueSemanticColors,
    components: BlueComponents,
    images: UserMessageImages = {},
  ) {
    this.item = item
    this.colors = colors
    this.components = components
    this.loadImage = images.loadImage
    this.onReady = images.onReady
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /** Kick off all image loads once; each settle stores its outcome. */
  private requestImages(load: UserImageLoader): void {
    if (this.imagesRequested) return
    this.imagesRequested = true
    this.item.images.forEach((ref, index) => {
      const settle = (data: Uint8Array | undefined): void => {
        this.resolved.set(index, data === undefined
          ? null
          : this.components.createImage({
            data,
            mediaType: ref.mediaType,
            ...(ref.name === undefined ? {} : { filename: ref.name }),
            maxHeightCells: USER_IMAGE_MAX_HEIGHT_CELLS,
          }))
        this.imageVersion += 1
        this.invalidate()
        this.onReady?.()
      }
      void load(ref).then(settle, () => settle(undefined))
    })
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const key = `${this.item.seq}:${width}:${this.imageVersion}`
    if (this.cache?.key === key) return this.cache.lines
    const bullet = `${BOLD_OPEN}${this.colors.roleUser(USER_MESSAGE_BULLET)}${BOLD_CLOSE}`
    const bulletWidth = this.components.visibleWidth(USER_MESSAGE_BULLET)
    const contentWidth = Math.max(1, width - bulletWidth)
    const wrapped = this.components.wrapText(this.item.text, contentWidth)
    const bold = (text: string): string => `${BOLD_OPEN}${this.colors.roleUser(text)}${BOLD_CLOSE}`
    const indent = ' '.repeat(bulletWidth)
    const lines = ['', ...wrapped.map((line, index) =>
      (index === 0 ? bullet : indent) + bold(line))]
    const load = this.loadImage
    if (load !== undefined && this.item.images.length > 0) {
      this.requestImages(load)
      for (let index = 0; index < this.item.images.length; index += 1) {
        const image = this.resolved.get(index)
        if (image) lines.push(...image.render(contentWidth).map(line => indent + line))
        else lines.push(`${indent}${this.colors.muted('[image]')}`)
      }
    }
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Renders one assistant step's visible Markdown body behind the kimi
 * message chrome: a blank separator row, then the `text`-colored `● `
 * bullet on the first line with every continuation indented by the
 * bullet's visible width — the S18 assistant half, pulled into the S17
 * dogfood by the user's margin ruling. The markdown renders at the
 * content width (viewport minus the bullet), so its horizontal rules span
 * exactly the body text. The step's reasoning renders in its own sibling
 * `ThinkingComponent` (`src/thinking.ts`) mounted above this block. There
 * is no streaming marker: kimi renders growing text bare, and the Blue
 * `▌` cursor retired with the S17 third dogfood ruling — the activity
 * pane's composing row is the signal. The body is a held `BlueMarkdown`
 * whose own text/width cache replaces the former hand-rolled Markdown
 * cache; mid-stream unterminated constructs settle as the text completes.
 */
export class AssistantMessageComponent implements BlueComponent {
  private readonly item: TranscriptAssistantItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private readonly markdown: BlueMarkdown
  private cache: RenderCache | null = null

  /**
   * @param item - the folded assistant item; mutated by the fold as the
   *   step streams and finalizes.
   * @param colors - the semantic color table (the bullet carries `text`).
   * @param components - the component factory; creates the held Markdown.
   */
  constructor(item: TranscriptAssistantItem, colors: BlueSemanticColors, components: BlueComponents) {
    this.item = item
    this.colors = colors
    this.components = components
    this.markdown = components.createMarkdown({ text: '' })
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const { text } = this.item
    const key = `${width}:${text}`
    if (this.cache?.key === key) return this.cache.lines

    const lines: string[] = ['']
    if (text.trim()) {
      this.markdown.setText(text)
      const contentWidth = Math.max(1, width - this.components.visibleWidth(STATUS_BULLET))
      const content = this.markdown.render(contentWidth)
      lines.push(...content.map((line, index) =>
        (index === 0 ? this.colors.text(STATUS_BULLET) : MESSAGE_INDENT) + line))
    }
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Renders one tool call generically: `● name(arguments)` with the arguments
 * ellipsized, and — once paired — an indented `⎿ result` block in success or
 * error colors. Collapsed (the default) the block shows the one-line summary;
 * {@link setExpanded} switches it to the unsummarized `fullText` for the
 * Ctrl-O expansion toggle.
 */
export class ToolCallComponent implements BlueComponent {
  private readonly item: TranscriptToolItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private expanded = false
  private cache: RenderCache | null = null

  /**
   * @param item - the folded tool item; `result` appears when the paired
   *   `tool/result` folds in.
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   */
  constructor(item: TranscriptToolItem, colors: BlueSemanticColors, components: BlueComponents) {
    this.item = item
    this.colors = colors
    this.components = components
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Switch the result block between the one-line summary and the full tool
   * output. The expansion flag joins the render cache key, so the next
   * render rebuilds without an explicit invalidate.
   * @param expanded - true renders `fullText`, false the summary.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const { result } = this.item
    const body = result === undefined
      ? ''
      : this.expanded
        ? (result.fullText ?? result.text)
        : result.text
    const key = `${width}:${this.expanded}:${result ? `${result.isError}:${body}` : 'pending'}`
    if (this.cache?.key === key) return this.cache.lines

    const bullet = result === undefined
      ? this.colors.primary('○')
      : result.isError
        ? this.colors.error('●')
        : this.colors.success('●')
    const args = this.item.arguments
      ? this.colors.muted(`(${ellipsize(this.item.arguments, TOOL_ARGUMENTS_MAX_CHARS)})`)
      : ''
    const callLine = `${bullet} ${this.item.name}${args}`

    const lines = ['', this.components.truncateToWidth(callLine, width)]
    if (result !== undefined) {
      const summaryColor = result.isError ? this.colors.error : this.colors.muted
      const prefix = '  ⎿ '
      const contentWidth = Math.max(1, width - this.components.visibleWidth(prefix))
      for (const line of this.components.wrapText(body, contentWidth)) {
        lines.push(`  ${this.colors.textMuted('⎿')} ${summaryColor(line)}`)
      }
    }
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Renders one folded-away mid-turn step as a single textMuted line in the
 * kimi step-summary wording (S18): `… step N · thinking X times, call Y
 * tools` — the two parts joined by `, `, each omitted at zero, with kimi's
 * unconditional pluralization (`1 times`, `1 tools`) kept verbatim. The
 * `step N ·` prefix is Blue's own: folding is per-step, so one turn can
 * carry several summaries. The item is immutable, so the cache keys on
 * width alone.
 */
export class StepSummaryComponent implements BlueComponent {
  private readonly item: TranscriptStepSummaryItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private cache: RenderCache | null = null

  /**
   * @param item - the folded step-summary item to render.
   * @param colors - the semantic color table (the line is textMuted).
   * @param components - the component factory providing the width helpers.
   */
  constructor(item: TranscriptStepSummaryItem, colors: BlueSemanticColors, components: BlueComponents) {
    this.item = item
    this.colors = colors
    this.components = components
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the single summary row, truncated to `width`.
   */
  render(width: number): string[] {
    const key = `${width}`
    if (this.cache?.key === key) return this.cache.lines
    const parts: string[] = []
    if (this.item.thinking > 0) parts.push(`thinking ${this.item.thinking} times`)
    if (this.item.toolNames.length > 0) parts.push(`call ${this.item.toolNames.length} tools`)
    const line = this.colors.textMuted(
      this.components.truncateToWidth(`… step ${this.item.step} · ${parts.join(', ')}`, width))
    this.cache = { key, lines: [line] }
    return this.cache.lines
  }
}
