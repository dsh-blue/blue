/**
 * `blue-intent-diff` plugin: the `'diff'` render-intent card in the kimi
 * Write/Edit chrome (S20 dogfood alignment). Tool items whose resolved view
 * is a `DiffCallView`/`DiffResultView` render here instead of the generic
 * card. The header is the shared kimi card header — the three-state bullet
 * (solid `text` `● ` running, `✓ `/`✗ ` finished) behind
 * `Using/Used ToolName (keyArg)` with the tool name bold `primary` and the
 * key argument dim (the shared `extractKeyArgument` whitelist), plus a chip
 * once the result lands: creates-only calls carry kimi's ` · N lines`
 * (the Write chip), any edit hunk carries ` · +A -R` (the kimi Edit chip).
 * The body follows kimi's Write/Edit split: a null `oldText` (create or
 * overwrite — the harness's Write) renders the kimi numbered file preview
 * — dim `    N  ` line numbers at the two-column base indent over the plain
 * content rows (the trailing empty row kept, kimi's `highlightLines`
 * shape; Blue skips the language highlighting for now), capped at
 * {@link DIFF_COLLAPSED_ROWS} collapsed under the kimi `... (N more lines,
 * M total, ctrl+o to expand)` hint and uncapped expanded — while an edit
 * hunk renders the unified diff rows through the diff palette (removed as
 * a `diffRemovedStrong('-')` marker plus `diffRemoved(text)`, added as
 * `diffAddedStrong('+')` plus `diffAdded(text)`, context muted), capped at
 * {@link DIFF_COLLAPSED_ROWS} collapsed / {@link DIFF_EXPANDED_ROWS}
 * expanded with the same hint. All files render in sequence (no per-file
 * toggle), every row truncated to the viewport. The component assumes by
 * construction that its view carries `card: 'diff'` — the mounter only
 * routes diff views here — and defensively renders just the header when
 * the shape does not match. The render cache keys on width, expansion, and
 * view identity.

 * @module @dsh-blue/blue-transcript/intent-diff
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponents,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import { COMMAND_PREVIEW_LINES } from './components.ts'
import { diffLines, summarizeDiffRows, type LineDiffRow } from './line-diff.ts'
import { extractKeyArgument } from './present.ts'
import type { BlueIntentComponent, BlueIntentProps, TranscriptToolItem } from './types.ts'

/** Bold SGR pair (the S18 local-constant precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** Stable Cordis plugin name. */
export const name = 'blue-intent-diff'

/** Services required before the diff card can register. */
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']

/** Collapsed cap: preview rows rendered per file (kimi's Write/Edit cap). */
export const DIFF_COLLAPSED_ROWS = COMMAND_PREVIEW_LINES

/** Expanded cap: diff rows rendered per file. */
export const DIFF_EXPANDED_ROWS = 200

/**
 * Whether the item's view selects this card: `card: 'diff'` with a `diffs`
 * array. Both the call and the result view satisfy this; the call view's
 * diffs preview the arguments, the result view's the applied change.
 * @param view - the item's resolved view.
 * @returns true when the view is a diff view.
 */
function isDiffView(view: NonNullable<TranscriptToolItem['view']>): view is { card: 'diff', title?: string, diffs: FileDiff[] } {
  return view.card === 'diff' && 'diffs' in view && Array.isArray(view.diffs)
}

/** The kimi Write chip count: content lines, trailing newline ignored. */
function contentLineCount(newText: string): number {
  const normalized = newText.endsWith('\n') ? newText.slice(0, -1) : newText
  return normalized.length > 0 ? normalized.split('\n').length : 0
}

/**
 * The diff card component: the kimi card header, then each file's Write
 * numbered preview or Edit unified diff, capped per the expansion state.
 */
export class DiffCardComponent implements BlueIntentComponent {
  private readonly item: TranscriptToolItem
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private expanded: boolean
  private cache: { key: string, lines: string[] } | null = null

  /**
   * @param props - the item, colors, factory, and expansion state at creation.
   */
  constructor(props: BlueIntentProps) {
    this.item = props.item
    this.colors = props.colors
    this.components = props.components
    this.expanded = props.expanded
  }

  /** Drop the cached lines; the next render rebuilds from the item. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Switch between the collapsed and expanded per-file row caps. The flag
   * joins the render cache key, so the next render rebuilds.
   * @param expanded - true raises the cap to {@link DIFF_EXPANDED_ROWS}.
   */
  setExpanded(expanded: boolean): void {
    this.expanded = expanded
  }

  /** The kimi card header: bullet, verb, bold name, key arg, and the chip. */
  private renderHeader(diffs: readonly FileDiff[], width: number): string {
    const { colors, components } = this
    const result = this.item.result
    const bullet = result === undefined
      ? colors.text('● ')
      : result.isError
        ? colors.error('✗ ')
        : colors.success('✓ ')
    const verb = result === undefined ? 'Using' : 'Used'
    const name = `${BOLD_OPEN}${colors.primary(this.item.name)}${BOLD_CLOSE}`
    const keyArg = extractKeyArgument(this.item)
    const argStr = keyArg === undefined ? '' : colors.muted(` (${keyArg})`)
    let header = `${bullet}${verb} ${name}${argStr}`
    if (result !== undefined && diffs.length > 0) {
      let hasEdits = false
      let createLines = 0
      let added = 0
      let removed = 0
      for (const file of diffs) {
        if (file.oldText === null) {
          createLines += contentLineCount(file.newText)
        } else {
          hasEdits = true
          const counts = summarizeDiffRows(diffLines(file.oldText, file.newText))
          added += counts.added
          removed += counts.removed
        }
      }
      const parts: string[] = []
      if (added > 0) parts.push(`+${added}`)
      if (removed > 0) parts.push(`-${removed}`)
      const chip = hasEdits
        ? (parts.length > 0 ? ` · ${parts.join(' ')}` : '')
        : ` · ${createLines} ${createLines === 1 ? 'line' : 'lines'}`
      if (chip !== '') header += result.isError ? colors.error(chip) : colors.muted(chip)
    }
    return components.truncateToWidth(header, width)
  }

  /**
   * Render one diff row with its gutter marker, truncated to `width`.
   * @param row - the row to render.
   * @param width - current viewport width in columns.
   * @returns the styled row.
   */
  private renderRow(row: LineDiffRow, width: number): string {
    const { colors, components } = this
    switch (row.kind) {
      case 'context':
        return colors.muted(components.truncateToWidth(` ${row.text}`, width))
      case 'added':
        return colors.diffAddedStrong('+') + colors.diffAdded(components.truncateToWidth(row.text, Math.max(1, width - 1)))
      case 'removed':
        return colors.diffRemovedStrong('-') + colors.diffRemoved(components.truncateToWidth(row.text, Math.max(1, width - 1)))
    }
  }

  /** The kimi Write preview: dim `    N  ` line numbers over the content. */
  private renderCreatePreview(newText: string, width: number): string[] {
    const { colors, components } = this
    // kimi skips empty content outright (`if (content.length === 0) return`).
    if (newText.length === 0) return []
    // kimi's `highlightLines` shape keeps the trailing empty row (a final
    // newline renders as an empty numbered line).
    const rows = newText.split('\n')
    const cap = this.expanded ? rows.length : Math.min(rows.length, DIFF_COLLAPSED_ROWS)
    const lines: string[] = []
    for (let index = 0; index < cap; index += 1) {
      const number = colors.muted(`${String(index + 1).padStart(4)}  `)
      lines.push(components.truncateToWidth(`  ${number}${rows[index]!}`, width))
    }
    if (rows.length > cap) {
      const hint = `... (${rows.length - cap} more lines, ${rows.length} total, ctrl+o to expand)`
      lines.push(colors.textMuted(components.truncateToWidth(hint, width)))
    }
    return lines
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const raw = this.item.view
    const key = `${width}:${this.expanded}:${raw === undefined ? 'none' : JSON.stringify(raw)}`
    if (this.cache?.key === key) return this.cache.lines

    const { colors, components } = this
    const view = raw !== undefined && isDiffView(raw) ? raw : undefined
    const diffs = view?.diffs ?? []
    const lines: string[] = ['', this.renderHeader(diffs, width)]
    for (const file of diffs) {
      if (file.oldText === null) {
        lines.push(...this.renderCreatePreview(file.newText, width))
        continue
      }
      const rows = diffLines(file.oldText, file.newText)
      const cap = this.expanded ? DIFF_EXPANDED_ROWS : DIFF_COLLAPSED_ROWS
      const shown = Math.min(rows.length, cap)
      for (const row of rows.slice(0, shown)) lines.push(this.renderRow(row, width))
      if (rows.length > shown) {
        const hint = `... (${rows.length - shown} more lines, ${rows.length} total, ctrl+o to expand)`
        lines.push(colors.textMuted(components.truncateToWidth(hint, width)))
      }
    }

    this.cache = { key, lines }
    return lines
  }
}

/**
 * Register the diff intent entry. Effect-bound so unloading the fiber
 * unregisters the entry from `ctx.blueIntents`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueIntents.register({
    intent: 'diff',
    create: props => new DiffCardComponent(props),
  }))
}
