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
 * @module @deepseek-ai/dsh-blue-transcript/components
 */

import type {
  BlueComponent,
  BlueComponents,
  BlueMarkdown,
  BlueSemanticColors,
} from '@deepseek-ai/dsh-blue-core'
import { ellipsize } from './fold.ts'
import type {
  TranscriptAssistantItem,
  TranscriptToolItem,
  TranscriptUserItem,
} from './types.ts'

const ITALIC_OPEN = '\x1b[3m'
const ITALIC_CLOSE = '\x1b[23m'

/** Maximum length of the tool-call arguments shown on the call line. */
export const TOOL_ARGUMENTS_MAX_CHARS = 60

/** Cache keyed on the inputs a component's rendered lines depend on. */
interface RenderCache {
  key: string
  lines: string[]
}

/**
 * Renders one user prompt: an accent `❯` gutter followed by the wrapped
 * text, with a blank separator line above.
 */
export class UserMessageComponent implements BlueComponent {
  private readonly item: TranscriptUserItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private cache: RenderCache | null = null

  /**
   * @param item - the folded user item to render.
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   */
  constructor(item: TranscriptUserItem, colors: BlueSemanticColors, components: BlueComponents) {
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
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const key = `${this.item.seq}:${width}`
    if (this.cache?.key === key) return this.cache.lines
    const gutter = `${this.colors.accent('❯')} `
    const contentWidth = Math.max(1, width - this.components.visibleWidth('❯ '))
    const wrapped = this.components.wrapText(this.item.text, contentWidth)
    const lines = ['', ...wrapped.map((line, index) =>
      index === 0 ? gutter + line : '  ' + line)]
    this.cache = { key, lines }
    return lines
  }
}

/**
 * Renders one assistant step: accumulated reasoning (muted italic) above the
 * Markdown body, plus a streaming cursor while chunks are still arriving.
 * The body is a held `BlueMarkdown` whose own text/width cache replaces the
 * former hand-rolled Markdown cache; mid-stream unterminated constructs
 * settle as the text completes.
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
    const { text, reasoning, streaming } = this.item
    const key = `${width}:${streaming}:${reasoning.length}:${text.length}:${text}`
    if (this.cache?.key === key) return this.cache.lines

    const lines: string[] = ['']
    if (reasoning.trim()) {
      for (const line of this.components.wrapText(reasoning, width)) {
        lines.push(`${ITALIC_OPEN}${this.colors.muted(line)}${ITALIC_CLOSE}`)
      }
      lines.push('')
    }
    if (text.trim()) {
      this.markdown.setText(text)
      lines.push(...this.markdown.render(width))
    }
    if (streaming) {
      const cursor = this.colors.accent('▌')
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
      ? this.colors.muted('○')
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
        lines.push(`  ${this.colors.border('⎿')} ${summaryColor(line)}`)
      }
    }
    this.cache = { key, lines }
    return lines
  }
}
