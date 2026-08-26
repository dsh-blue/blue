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
import { clampRowsToWidth } from '@dsh-blue/blue-core/chrome'
import { extractKeyArgument, isPlanDecline, KEY_ARG_MAX_CHARS } from './present.ts'
import { parseXmlEnvelope, summarizeToolText } from './envelope.ts'
import {
  DEFAULT_USER_FOLD_CHARS,
  DEFAULT_USER_FOLD_LINES,
  DEFAULT_TRANSCRIPT_PRESENTATION,
  type TranscriptPresentationSnapshot,
} from './presentation-policy.ts'
import type {
  TranscriptAssistantItem,
  TranscriptStepSummaryItem,
  TranscriptToolItem,
  TranscriptToolResult,
  TranscriptUserItem,
} from './types.ts'

/** Maximum length of the tool-call arguments shown on the call line. */
export const TOOL_ARGUMENTS_MAX_CHARS = KEY_ARG_MAX_CHARS

/** Collapsed result preview: visual rows kept (kimi `RESULT_PREVIEW_LINES`). */
export const RESULT_PREVIEW_LINES = 3

/** Collapsed Write/Edit-style preview: rows kept (kimi `COMMAND_PREVIEW_LINES`). */
export const COMMAND_PREVIEW_LINES = 10

/** Collapsed long user-message preview: visual rows kept (the S20 idiom, D46). */
export const USER_PREVIEW_LINES = 3

/**
 * Default raw-line count above which a user message folds. Mirrors the
 * pi-tui editor's paste-fold line ("> 10 lines") so what folds in the
 * editor folds in the transcript echo too (D46).
 */
export { DEFAULT_USER_FOLD_LINES }

/**
 * Default raw character count above which a user message folds — the
 * pi-tui editor's second paste-fold criterion ("> 1000 characters"), so a
 * single long line (a big one-line JSON, say) folds as well.
 */
export { DEFAULT_USER_FOLD_CHARS }

/** Indent of the collapsed/expanded result preview rows (kimi's default). */
const PREVIEW_INDENT = '  '

/** The assistant block's first-line marker (kimi `constant/symbols.ts`). */
const STATUS_BULLET = '● '

/** The user block's first-line marker (the DeepSeek guide arrow). */
export const USER_MESSAGE_BULLET = '» '

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
  /** Tree-scoped policy getter; omitted consumers use shipped defaults. */
  presentation?: () => TranscriptPresentationSnapshot
}

/** Cache keyed on the inputs a component's rendered lines depend on. */
interface RenderCache {
  key: string
  lines: string[]
}

/**
 * Renders one user prompt behind the DeepSeek user-message chrome (S18): a
 * blank separator row, then the bold `roleUser` `» ` bullet on the first
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
 *
 * A long message (raw metrics over the original text — the pi-tui editor
 * paste-fold thresholds, >10 lines or >1000 characters — never wrap
 * width) renders collapsed (D46): the first {@link USER_PREVIEW_LINES}
 * wrapped lines plus the dim `ctrl+o` hint row, the S20 tool-card idiom.
 * The fold stays component-local so the fold layer stays pure/width-free
 * and replay converges for free (D16); `setExpanded` joins the global
 * Ctrl-O toggle, and raw metrics mean a resize never refolds an expanded
 * message.
 */
export class UserMessageComponent implements BlueComponent {
  private readonly item: TranscriptUserItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private readonly loadImage: UserImageLoader | undefined
  private readonly onReady: (() => void) | undefined
  private readonly presentation: () => TranscriptPresentationSnapshot
  /** Per-image outcome: the image component, null for a failed load. */
  private readonly resolved = new Map<number, BlueImage | null>()
  private imagesRequested = false
  private imageVersion = 0
  private expanded = false
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
    this.presentation = images.presentation ?? (() => DEFAULT_TRANSCRIPT_PRESENTATION)
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Switch a foldable message between the collapsed preview and the full
   * text. The expansion flag joins the render cache key, so the next
   * render rebuilds without an explicit invalidate (the ToolCall
   * precedent); short messages ignore the flag — nothing is hidden.
   * @param expanded - true renders every wrapped line, false the preview.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  /** Whether the raw-text metrics put this message over a fold threshold. */
  private isFoldable(): boolean {
    const policy = this.presentation()
    return this.item.text.split('\n').length > policy.userFoldLines || this.item.text.length > policy.userFoldChars
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
    const key = `${this.item.seq}:${width}:${this.imageVersion}:${this.expanded}`
    if (this.cache?.key === key) return this.cache.lines
    const bullet = `${BOLD_OPEN}${this.colors.roleUser(USER_MESSAGE_BULLET)}${BOLD_CLOSE}`
    const bulletWidth = this.components.visibleWidth(USER_MESSAGE_BULLET)
    const contentWidth = Math.max(1, width - bulletWidth)
    const wrapped = this.components.wrapText(this.item.text, contentWidth)
    const bold = (text: string): string => `${BOLD_OPEN}${this.colors.roleUser(text)}${BOLD_CLOSE}`
    const indent = ' '.repeat(bulletWidth)
    // The fold gates on `expanded`, never on the wrapped count: a resize
    // changes wrapping but never refolds an expanded message back.
    const folded = !this.expanded && this.isFoldable()
    const shown = folded ? wrapped.slice(0, USER_PREVIEW_LINES) : wrapped
    let lines = ['', ...shown.map((line, index) =>
      (index === 0 ? bullet : indent) + bold(line))]
    if (folded && wrapped.length > shown.length) {
      // The S20 expand hint, width-disciplined to the content indent.
      const remaining = wrapped.length - shown.length
      const hint = `... (${remaining} more lines, ${wrapped.length} total, ctrl+o to expand)`
      lines.push(indent + this.colors.textMuted(this.components.truncateToWidth(hint, contentWidth)))
    }
    const load = this.loadImage
    if (load !== undefined && this.item.images.length > 0) {
      this.requestImages(load)
      for (let index = 0; index < this.item.images.length; index += 1) {
        const image = this.resolved.get(index)
        if (image) lines.push(...image.render(contentWidth).map(line => indent + line))
        else lines.push(`${indent}${this.colors.muted('[image]')}`)
      }
    }
    // The bullet can out wide a degenerate viewport (a resize drag crossing
    // three columns); every assembled row passes the width backstop.
    lines = clampRowsToWidth(lines, width, text => this.components.truncateToWidth(text, width))
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
    const clamped = clampRowsToWidth(lines, width, text => this.components.truncateToWidth(text, width))
    this.cache = { key, lines: clamped }
    return clamped
  }
}

/**
 * Renders one tool call in the kimi tool-card chrome (S20 front half): a
 * three-state header — the solid `text` `● ` while running (the old hollow
 * marker flickered on every re-render, kimi's reason for going solid), the
 * success `✓` / error `✗ ` once finished — behind a `Using/Used ToolName
 * (keyArg)` label: the verb plain, the tool name bold `primary`, and the
 * key argument dim in parentheses (whitelist `file_path`/`command`/`pattern`
 * first, then the first short string argument; values flatten to one line
 * at {@link TOOL_ARGUMENTS_MAX_CHARS}). `bash` keeps the kimi pure label
 * `Running a command`/`Ran a command` — the command belongs to the body,
 * and Blue's shell tool normally renders through the terminal intent, so
 * this branch is the presenter-less fallback. A finished card carries a dim
 * ` · N lines` chip counting the result's non-empty lines (error-colored on
 * failure). The collapsed body is the kimi result preview: the full text
 * wrapped at the content width, capped at {@link RESULT_PREVIEW_LINES}
 * visual rows, under a dim `... (N more lines, M total, ctrl+o to expand)`
 * hint — the two-column kimi indent replaces the retired `⎿` connector
 * (kimi has no such glyph; the dogfood rules its fate). Expanded (Ctrl-O)
 * renders every wrapped line. MCP tools need no
 * dim suffix yet: the rc.7 harness has no MCP surface, and Blue does not
 * build for a consumer that does not exist.
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
  constructor(
    item: TranscriptToolItem,
    colors: BlueSemanticColors,
    components: BlueComponents,
    private readonly presentedBody?: BlueComponent & { setExpanded?(expanded: boolean): void },
  ) {
    this.item = item
    this.colors = colors
    this.components = components
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
    this.presentedBody?.invalidate()
  }

  /**
   * Switch the result block between the collapsed preview and the full tool
   * output. The expansion flag joins the render cache key, so the next
   * render rebuilds without an explicit invalidate.
   * @param expanded - true renders every wrapped line, false the preview.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
    this.presentedBody?.setExpanded?.(expanded)
  }

  /** The header row: bullet, verb, bold name, key arg, and the lines chip. */
  private renderHeader(width: number): string {
    const { result } = this.item
    const { colors } = this
    const declined = result !== undefined && isPlanDecline(this.item)
    const bullet = result === undefined
      ? colors.text(STATUS_BULLET)
      : declined
        ? colors.warning('◐ ')
        : result.isError
          ? colors.error('✗ ')
          : colors.success('✓ ')
    let header: string
    if (this.item.name === 'bash') {
      const label = result === undefined ? 'Running a command' : 'Ran a command'
      header = `${bullet}${BOLD_OPEN}${colors.primary(label)}${BOLD_CLOSE}`
    } else {
      const verb = result === undefined ? 'Using' : 'Used'
      const name = `${BOLD_OPEN}${colors.primary(this.item.name)}${BOLD_CLOSE}`
      const keyArg = extractKeyArgument(this.item)
      const argStr = keyArg === undefined ? '' : colors.muted(` (${keyArg})`)
      header = `${bullet}${verb} ${name}${argStr}`
    }
    if (declined) {
      header += colors.warning(' · plan declined')
    } else if (result !== undefined) {
      const text = result.fullText ?? result.text
      const count = text.split('\n').filter(line => line.length > 0).length
      if (count > 0) {
        const chip = ` · ${count} ${count === 1 ? 'line' : 'lines'}`
        header += result.isError ? colors.error(chip) : colors.muted(chip)
      }
    }
    return this.components.truncateToWidth(header, width)
  }

  /** The bash fallback's command lines, or undefined for a non-bash card. */
  private commandPreview(): string[] | undefined {
    if (this.item.name !== 'bash') return undefined
    const parsed = this.item.parsedArguments
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) return undefined
    const command = (parsed as Record<string, unknown>)['command']
    if (typeof command !== 'string' || command === '') return undefined
    return command.split('\n')
  }

  /**
   * The body rows: the kimi shell chrome for a bash fallback command
   * (`$ ` shellMode + the command one step dimmer, continuations indented,
   * the collapsed preview capped at {@link COMMAND_PREVIEW_LINES}), then
   * the result preview — the kimi wrap-aware 3-row cap with the expand
   * hint collapsed, every wrapped line expanded.
   * @param width - current viewport width in columns.
   * @param result - the paired result, or undefined while pending.
   * @returns the body rows (possibly empty).
   */
  private renderBody(width: number, result: TranscriptToolResult | undefined): string[] {
    const { colors, components } = this
    const lines: string[] = []
    const command = this.commandPreview()
    if (command !== undefined) {
      const cap = this.expanded
        ? command.length
        : Math.min(command.length, COMMAND_PREVIEW_LINES)
      for (let index = 0; index < cap; index += 1) {
        const body = colors.muted(command[index]!)
        // Budgeted like every other composed row (the select-list idiom): a
        // long one-liner command must truncate to the viewport, not reach
        // pi-tui's width guard (the #15 family — an 186-column grep
        // pipeline crashed the real run).
        lines.push(index === 0
          ? components.truncateToWidth(`${PREVIEW_INDENT}${colors.shellMode('$ ')}${body}`, width)
          : components.truncateToWidth(`${PREVIEW_INDENT}  ${body}`, width))
      }
    }
    if (result === undefined) return lines
    const text = (result.fullText ?? result.text).replace(/\n+$/, '')
    if (text === '') return lines
    const contentWidth = Math.max(1, width - components.visibleWidth(PREVIEW_INDENT))
    const allLines = components.wrapText(text, contentWidth)
    const paint = (line: string): string => `${PREVIEW_INDENT}${
      isPlanDecline(this.item) ? colors.warning(line)
        : result.isError ? colors.error(line)
          : colors.muted(line)
    }`
    // An XML envelope (file-tool model-facing text) collapses to its one
    // summary line while collapsed; the expanded card keeps the raw text as
    // the debug view.
    const shown = this.expanded
      ? allLines
      : parseXmlEnvelope(text) !== undefined
        ? components.wrapText(summarizeToolText(text), contentWidth)
        : allLines.slice(0, RESULT_PREVIEW_LINES)
    lines.push(...shown.map(paint))
    if (shown.length < allLines.length) {
      const remaining = allLines.length - shown.length
      const hint = `... (${remaining} more lines, ${allLines.length} total, ctrl+o to expand)`
      lines.push(colors.textMuted(components.truncateToWidth(hint, width)))
    }
    return lines
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const { result } = this.item
    const body = result === undefined ? '' : (result.fullText ?? result.text)
    const key = `${width}:${this.expanded}:${result ? `${result.isError}:${body}` : 'pending'}`
    if (this.cache?.key === key) return this.cache.lines
    const presentedWidth = Math.max(1, width - this.components.visibleWidth(PREVIEW_INDENT))
    const presentedRows = this.presentedBody?.render(presentedWidth)
      .map(row => this.components.truncateToWidth(`${PREVIEW_INDENT}${row}`, width))
    const lines = ['', this.renderHeader(width), ...(presentedRows ?? this.renderBody(width, result))]
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
/**
 * One failed-turn row: the `✗` marker in `error` beside the structured
 * failure's message, wrapped to the content width — the dead-endpoint
 * answer to the silent transcript (S23 dogfood).
 */
export class ErrorMessageComponent implements BlueComponent {
  /**
   * @param item - the failed-turn item to render.
   * @param colors - the theme's color table.
   * @param components - the component factory (width wrapping).
   */
  constructor(
    private readonly item: import('./types.ts').TranscriptErrorItem,
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the marker plus the wrapped message.
   * @param width - current render width in columns.
   * @returns one string per rendered row.
   */
  render(width: number): string[] {
    const label = this.item.code !== undefined
      ? `✗ request failed (${this.item.code}): ${this.item.message}`
      : `✗ request failed: ${this.item.message}`
    return this.components.wrapText(label, width).map((line: string) => this.colors.error(line))
  }
}

/**
 * One cut-turn row: the text-presentation `■` marker and the `interrupted` label in error
 * red — the visible tombstone of an Esc interrupt (or a crash-recovery
 * close), so the stream going quiet always carries its reason (the S24a
 * dogfood ruling; round 4 moved it from textMuted to the error paint for
 * prominence).
 */
export class InterruptedMarkerComponent implements BlueComponent {
  /**
   * @param colors - the theme's color table.
   * @param components - the component factory providing `truncateToWidth`
   *   (the fixed label still has to honor degenerate widths).
   */
  constructor(
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /** No cached render state. */
  invalidate(): void {}

  /**
   * Render the single error-red marker row, truncated to the width.
   * @param width - current render width in columns (the label never wraps).
   * @returns one string.
   */
  render(width: number): string[] {
    return [this.components.truncateToWidth(this.colors.error('■ interrupted'), width)]
  }
}

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
