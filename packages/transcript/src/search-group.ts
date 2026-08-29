/**
 * The search-group card: one tree for a run of consecutive search calls
 * (grep and glob interleaved). Each call leads as a pattern row — a content
 * search carries its file and match counts (a capped search says so), a path
 * search its path count — and the expanded card nests each call's file rows
 * with bounded match previews (or the capped path page). Collapsed (the
 * default) the tree shows pattern rows only, never match text.
 *
 * @module @dsh-blue/blue-transcript/search-group
 */

import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import type { SearchCallModel, TranscriptSearchGroupModel } from '@dsh-blue/blue-frontend'

/** Tree rows kept in the collapsed card before the expand hint. */
export const SEARCH_GROUP_ROW_LIMIT = 8

/** Total row ceiling in the expanded card, matching the tool-body budget. */
export const SEARCH_GROUP_EXPANDED_ROW_LIMIT = 200

/** Colors plus width helpers threaded through the row builders. */
interface RenderDeps {
  readonly colors: BlueSemanticColors
  readonly components: BlueComponents
}

/**
 * Render one search group as the kimi tool-card family shape: a blank spacer,
 * the status header, then the per-pattern tree.
 * @param model - the frozen group model.
 * @param colors - the semantic color table.
 * @param components - the component factory providing the width helpers.
 */
export class SearchGroupComponent implements BlueComponent {
  private expanded = false
  private cache: { key: string; lines: string[] } | null = null

  constructor(
    private readonly model: TranscriptSearchGroupModel,
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /** Switch between the collapsed pattern rows and the expanded detail tree. */
  setExpanded(expanded: boolean): void { this.expanded = expanded }

  /** Drop the cached lines; the next render rebuilds. */
  invalidate(): void { this.cache = null }

  /** @param width - current viewport width in columns. @returns the rows. */
  render(width: number): string[] {
    const key = `${String(width)}:${String(this.expanded)}`
    if (this.cache?.key === key) return this.cache.lines
    const lines = this.renderTree(width)
    this.cache = { key, lines }
    return lines
  }

  private renderTree(width: number): string[] {
    const deps: RenderDeps = { colors: this.colors, components: this.components }
    const cut = (row: string): string => this.components.truncateToWidth(row, width)
    const clamp = (rows: string[]): string[] => rows.map(cut)
    const tree = this.renderPatternRows(deps, cut)
    const limit = this.expanded ? SEARCH_GROUP_EXPANDED_ROW_LIMIT : SEARCH_GROUP_ROW_LIMIT
    if (tree.length <= limit) return clamp(['', this.renderHeader(width), ...tree])
    const hidden = tree.length - (limit - 1)
    const hint = this.expanded ? `... (${String(hidden)} more lines)` : `... (${String(hidden)} more, ctrl+o to expand)`
    return clamp(['', this.renderHeader(width), ...tree.slice(0, limit - 1), this.colors.textMuted(cut(hint))])
  }

  private renderHeader(width: number): string {
    const { colors, components } = this
    const searches = this.model.searches
    const pending = searches.filter(call => call.state === 'pending').length
    const failed = searches.filter(call => call.state === 'error').length
    const bold = (text: string): string => `\x1b[1m${String(text)}\x1b[22m`
    const label = pending > 0
      ? bold(colors.primary(`Searching ${String(searches.length)} ${searches.length === 1 ? 'pattern' : 'patterns'}…`))
      : failed === searches.length
        ? bold(colors.error(`Searched ${String(searches.length)} ${searches.length === 1 ? 'pattern' : 'patterns'} · failed`))
        : bold(colors.primary(`Searched ${String(searches.length)} ${searches.length === 1 ? 'pattern' : 'patterns'}`))
    let header = `${String(pending > 0 ? colors.text('● ') : failed === searches.length ? colors.error('✗ ') : colors.success('✓ '))}${String(label)}`
    const files = searches.reduce((sum, call) => sum + (call.shape === 'matches' ? call.files?.length ?? 0 : 0), 0)
    const matches = searches.reduce((sum, call) => sum + (call.shape === 'matches' ? call.total ?? call.files?.reduce((inner, file) => inner + file.count, 0) ?? 0 : 0), 0)
    const paths = searches.reduce((sum, call) => sum + (call.shape === 'paths' ? call.pathsTotal ?? call.paths?.length ?? 0 : 0), 0)
    const chips: string[] = []
    if (files > 0) chips.push(`${String(files)} ${files === 1 ? 'file' : 'files'}`)
    if (matches > 0) chips.push(`${String(matches)} ${matches === 1 ? 'match' : 'matches'}`)
    if (paths > 0) chips.push(`${String(paths)} ${paths === 1 ? 'path' : 'paths'}`)
    if (chips.length > 0) header += colors.muted(` · ${chips.join(', ')}`)
    if (failed > 0 && failed < searches.length) header += colors.error(` · ${String(failed)} failed`)
    return components.truncateToWidth(header, width)
  }

  private renderPatternRows(deps: RenderDeps, cut: (row: string) => string): string[] {
    const rows: string[] = []
    const searches = this.model.searches
    searches.forEach((call, index) => {
      const last = index === searches.length - 1
      const branch = last ? '└─' : '├─'
      const continuation = last ? '   ' : '│  '
      const label = call.pattern === undefined ? 'search'
        : call.shape === 'matches' ? `"${String(call.pattern)}"`
          : String(call.pattern)
      let row: string
      if (call.state === 'error') {
        row = `  ${String(branch)} ${String(label)} ${deps.colors.error('✗')}${String(call.error === undefined ? '' : ` ${deps.colors.error(call.error)}`)}`
      } else if (call.state === 'pending') {
        row = `  ${String(branch)} ${String(label)} ${deps.colors.textMuted('…')}`
      } else if (call.shape === 'matches') {
        const files = call.files ?? []
        const kept = files.reduce((sum, file) => sum + file.count, 0)
        const shown = call.truncated === true && call.total !== undefined ? `${String(kept)} of ${String(call.total)}` : String(kept)
        const filesText = files.length === 0 ? '0 matches' : `${String(files.length)} ${files.length === 1 ? 'file' : 'files'}, ${shown} ${kept === 1 ? 'match' : 'matches'}`
        row = `  ${String(branch)} ${String(label)} · ${String(filesText)} ${deps.colors.success('✓')}`
      } else if (call.shape === 'paths') {
        const count = call.pathsTotal ?? call.paths?.length ?? 0
        row = `  ${String(branch)} ${String(label)} · ${String(count)} ${count === 1 ? 'path' : 'paths'} ${deps.colors.success('✓')}`
      } else {
        row = `  ${String(branch)} ${String(label)} ${deps.colors.success('✓')}`
      }
      rows.push(cut(row))
      if (this.expanded && call.state === 'ok') {
        rows.push(...this.renderCallDetail(call, continuation, deps, cut))
      }
    })
    return rows
  }

  private renderCallDetail(call: SearchCallModel, continuation: string, deps: RenderDeps, cut: (row: string) => string): string[] {
    const rows: string[] = []
    if (call.shape === 'matches') {
      const files = call.files ?? []
      files.forEach((file, index) => {
        const last = index === files.length - 1
        const branch = last ? '└─' : '├─'
        const childContinuation = `${String(continuation)}${last ? '   ' : '│  '}`
        rows.push(cut(`  ${String(continuation)}${String(branch)} ${String(file.path)} · ${String(file.count)}`))
        for (const preview of file.previews) {
          rows.push(cut(`  ${String(childContinuation)}${String(preview.lineNumber)}: ${String(preview.line)}`))
        }
      })
      return rows
    }
    if (call.shape === 'paths') {
      const paths = call.paths ?? []
      paths.forEach((path, index) => {
        const last = index === paths.length - 1
        const branch = last ? '└─' : '├─'
        rows.push(cut(`  ${String(continuation)}${String(branch)} ${String(path)}`))
      })
      const total = call.pathsTotal ?? paths.length
      if (total > paths.length) {
        rows.push(cut(`  ${String(continuation)}${deps.colors.textMuted(`… ${String(total - paths.length)} more paths`)}`))
      }
    }
    return rows
  }
}
