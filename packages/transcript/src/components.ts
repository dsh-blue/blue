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
 * Renders one user prompt: an accent `❯` gutter followed by the wrapped
 * text, with a blank separator line above. When the item carries image
 * attachments and a loader was provided, loads kick off lazily on the first
 * render; each image renders its loaded lines below the text (a muted
 * `[image]` row while loading or after failure), and a resolve bumps the
 * cache version, invalidates, and nudges `onReady`.
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
    const gutter = `${this.colors.roleUser('❯')} `
    const contentWidth = Math.max(1, width - this.components.visibleWidth('❯ '))
    const wrapped = this.components.wrapText(this.item.text, contentWidth)
    const lines = ['', ...wrapped.map((line, index) =>
      index === 0 ? gutter + line : '  ' + line)]
    const load = this.loadImage
    if (load !== undefined && this.item.images.length > 0) {
      this.requestImages(load)
      for (let index = 0; index < this.item.images.length; index += 1) {
        const image = this.resolved.get(index)
        if (image) lines.push(...image.render(width))
        else lines.push(`  ${this.colors.muted('[image]')}`)
      }
    }
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Renders one assistant step's visible Markdown body plus a streaming
 * cursor while chunks are still arriving. The step's reasoning renders in
 * its own sibling `ThinkingComponent` (`src/thinking.ts`) mounted above
 * this block. The body is a held `BlueMarkdown` whose own text/width cache
 * replaces the former hand-rolled Markdown cache; mid-stream unterminated
 * constructs settle as the text completes.
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
   * @param colors - the semantic color table.
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
    const { text, streaming } = this.item
    const key = `${width}:${streaming}:${text}`
    if (this.cache?.key === key) return this.cache.lines

    const lines: string[] = ['']
    if (text.trim()) {
      this.markdown.setText(text)
      lines.push(...this.markdown.render(width))
    }
    if (streaming) {
      const cursor = this.colors.primary('▌')
      const last = lines.at(-1)
      // The cursor shares the last row: a full-width row must yield one
      // column, or pi-tui rejects the over-wide line at render time.
      if (last) {
        lines[lines.length - 1] = this.components.visibleWidth(last) >= width
          ? this.components.truncateToWidth(last, width - 1) + cursor
          : last + cursor
      } else {
        lines.push(cursor)
      }
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
 * Renders one folded-away mid-turn step as a single textMuted line:
 * `… step N · Read ×2, Edit ×1` — occurrences counted per tool name in
 * first-seen order (`toolNames` keeps duplicates; this is the counting
 * step). The item is immutable, so the cache keys on width alone.
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
    const counts = new Map<string, number>()
    for (const name of this.item.toolNames) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const tools = [...counts].map(([name, count]) => `${name} ×${count}`).join(', ')
    const line = this.colors.textMuted(
      this.components.truncateToWidth(`… step ${this.item.step} · ${tools}`, width))
    this.cache = { key, lines: [line] }
    return this.cache.lines
  }
}
