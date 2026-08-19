/**
 * `blue-intent-diff` plugin: the `'diff'` render-intent card. Tool items whose
 * resolved view is a `DiffCallView`/`DiffResultView` render here as a titled,
 * per-file unified diff instead of the generic `● name(args)` card. Rendering
 * scheme: a `diffMeta` header line (result title ?? call title ?? tool name),
 * then per file a `diffMeta` `path (+A −R)` count line followed by the diff
 * rows — removed rows as a `diffRemovedStrong('-')` marker plus
 * `diffRemoved(text)`, added rows as `diffAddedStrong('+')` plus
 * `diffAdded(text)`, context rows muted (`' ' + text`). Every row is truncated
 * to the viewport through `truncateToWidth`. A null `oldText` (create or
 * overwrite) renders the whole file as added and counts only additions.
 * Height caps keep the transcript bounded: 12 diff rows per file collapsed,
 * 200 expanded (Ctrl-O through `setExpanded`), each capped with a `… N more
 * lines` meta row; all files render in sequence (no per-file toggle). The
 * component assumes by construction that its view carries `card: 'diff'` —
 * the mounter only routes diff views here — and defensively renders just the
 * header line when the shape does not match. The item is immutable per view,
 * so the render cache keys on width, expansion, and view identity.

 * @module @dsh-blue/blue-transcript/intent-diff
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponents,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { FileDiff } from '@deepseek-ai/dsh-tools'
import { diffLines, summarizeDiffRows, type LineDiffRow } from './line-diff.ts'
import type { BlueIntentComponent, BlueIntentProps, TranscriptToolItem } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-intent-diff'

/** Services required before the diff card can register. */
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']

/** Collapsed cap: diff rows rendered per file. */
export const DIFF_COLLAPSED_ROWS = 12

/** Expanded cap: diff rows rendered per file. */
export const DIFF_EXPANDED_ROWS = 200

/**
 * Whether the item's view selects this card: `card: 'diff'` with a `diffs`
 * array. Both the call and the result view satisfy this; the title's
 * optionality makes the distinction (the call title is required, the result
 * title optional), which the title preference chain absorbs.
 * @param view - the item's resolved view.
 * @returns true when the view is a diff view.
 */
function isDiffView(view: NonNullable<TranscriptToolItem['view']>): view is { card: 'diff', title?: string, diffs: FileDiff[] } {
  return view.card === 'diff' && 'diffs' in view && Array.isArray(view.diffs)
}

/**
 * The diff card component: header, then each file's count line and capped
 * unified diff rows, colored through the diff palette.
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

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows.
   */
  render(width: number): string[] {
    const raw = this.item.view
    const key = `${width}:${this.expanded}:${raw === undefined ? 'none' : JSON.stringify(raw)}`
    if (this.cache?.key === key) return this.cache.lines

    const { colors, components } = this
    // The view's optional title is the result view's replacement title (the
    // call view's title is required); pending calls diff the call arguments.
    const view = raw !== undefined && isDiffView(raw) ? raw : undefined
    const title = view?.title ?? this.item.name
    const diffs = view?.diffs ?? []
    const lines: string[] = [colors.diffMeta(components.truncateToWidth(title, width))]

    const cap = this.expanded ? DIFF_EXPANDED_ROWS : DIFF_COLLAPSED_ROWS
    for (const file of diffs) {
      const rows = file.oldText === null
        ? splitAdded(file.newText)
        : diffLines(file.oldText, file.newText)
      const counts = file.oldText === null
        ? { added: rows.length, removed: 0 }
        : summarizeDiffRows(rows)
      const countText = counts.removed === 0
        ? ` (+${counts.added})`
        : ` (+${counts.added} −${counts.removed})`
      lines.push(colors.diffMeta(components.truncateToWidth(file.path + countText, width)))
      const shown = Math.min(rows.length, cap)
      for (const row of rows.slice(0, shown)) lines.push(this.renderRow(row, width))
      if (rows.length > shown) {
        lines.push(colors.textMuted(components.truncateToWidth(`… ${rows.length - shown} more lines`, width)))
      }
    }

    this.cache = { key, lines }
    return lines
  }
}

/**
 * Split a created file's text into all-added rows.
 * @param newText - the created file's whole content.
 * @returns one added row per line (final newline dropped, as in the split).
 */
function splitAdded(newText: string): LineDiffRow[] {
  const lines = newText.split('\n')
  if (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines.map(text => ({ kind: 'added' as const, text }))
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
