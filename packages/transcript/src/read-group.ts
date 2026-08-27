/**
 * The read-group card: one tree for a run of consecutive read calls. Files
 * lead as parent rows in first-read order; a file read through several
 * windows nests its windows as child rows, a single-window file inlines its
 * window onto the file row. Collapsed (the default) the tree never shows
 * file content — expanded (Ctrl-O) each window gains its bounded preview
 * lines with their file line numbers. The model carries per-call facts only;
 * the by-file aggregation here is pure presentation.
 *
 * @module @dsh-blue/blue-transcript/read-group
 */

import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import { clampRowsToWidth } from '@dsh-blue/blue-core/chrome'
import type { ReadCallModel, TranscriptReadGroupModel } from '@dsh-blue/blue-frontend'

/** Tree rows kept in the collapsed card before the expand hint. */
export const READ_GROUP_ROW_LIMIT = 8

/** Total row ceiling in the expanded card, matching the tool-body budget. */
export const READ_GROUP_EXPANDED_ROW_LIMIT = 200

/** One file's read windows, in first-read order. */
export interface ReadFileGroup {
  readonly path: string
  readonly reads: readonly ReadCallModel[]
}

/** Colors plus width helpers threaded through the row builders. */
interface RenderDeps {
  readonly colors: BlueSemanticColors
  readonly components: BlueComponents
}

/**
 * Group read calls by their row identity — the file path, or the salient
 * label of a read-kind call without a file (the jobs reader) — keeping
 * first-read order; a call with neither joins no group (it still counts in
 * the header).
 * @param reads - the group model's per-call facts.
 * @returns one group per distinct row identity, empty when no read carries one.
 */
export function groupReadsByFile(reads: readonly ReadCallModel[]): readonly ReadFileGroup[] {
  const groups: { path: string; reads: ReadCallModel[] }[] = []
  const byPath = new Map<string, { path: string; reads: ReadCallModel[] }>()
  for (const read of reads) {
    const identity = read.path ?? read.label
    if (identity === undefined) continue
    let group = byPath.get(identity)
    if (group === undefined) {
      group = { path: identity, reads: [] }
      byPath.set(identity, group)
      groups.push(group)
    }
    group.reads.push(read)
  }
  return groups
}

function windowMark(read: ReadCallModel, deps: RenderDeps): string {
  if (read.state === 'pending') return deps.colors.textMuted('…')
  if (read.state === 'error') return deps.colors.error('✗')
  return deps.colors.success('✓')
}

/** `1-40 of 89` — the actual window when known, the requested one otherwise. */
function windowText(read: ReadCallModel): string {
  const range = read.range ?? read.requestedRange
  if (range === undefined) return 'read'
  const open = read.totalLines !== undefined && read.totalLines > range.last
  return `${String(range.first)}-${String(range.last)}${open ? ` of ${String(read.totalLines)}` : ''}`
}

function shortError(read: ReadCallModel | undefined, deps: RenderDeps): string {
  if (read === undefined) return ''
  return read.error === undefined ? '' : ` ${deps.colors.error(read.error)}`
}

/**
 * Render one read group as the kimi tool-card family shape: a blank spacer,
 * the status header, then the by-file tree.
 * @param model - the frozen group model.
 * @param colors - the semantic color table.
 * @param components - the component factory providing the width helpers.
 */
export class ReadGroupComponent implements BlueComponent {
  private expanded = false
  private cache: { key: string; lines: string[] } | null = null

  constructor(
    private readonly model: TranscriptReadGroupModel,
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /** Switch between the collapsed tree and the expanded preview-bearing tree. */
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
    const clamp = (rows: string[]): string[] =>
      clampRowsToWidth(rows, width, (text, target) => this.components.truncateToWidth(text, target))
    const tree = this.renderFileRows(deps, cut)
    const limit = this.expanded ? READ_GROUP_EXPANDED_ROW_LIMIT : READ_GROUP_ROW_LIMIT
    if (tree.length <= limit) return clamp(['', this.renderHeader(width), ...tree])
    const hint = this.expanded
      ? `... (${String(tree.length - (limit - 1))} more lines)`
      : `... (${String(tree.length - (limit - 1))} more, ctrl+o to expand)`
    return clamp(['', this.renderHeader(width), ...tree.slice(0, limit - 1), this.colors.textMuted(cut(hint))])
  }

  private renderHeader(width: number): string {
    const { colors, components } = this
    const reads = this.model.reads
    const files = groupReadsByFile(reads).length
    const pending = reads.filter(read => read.state === 'pending').length
    const failed = reads.filter(read => read.state === 'error').length
    const bold = (text: string): string => `\x1b[1m${String(text)}\x1b[22m`
    const label = pending > 0
      ? bold(colors.primary(`Reading ${String(files)} ${files === 1 ? 'file' : 'files'}…`))
      : failed === reads.length
        ? bold(colors.error(`Read ${String(files)} ${files === 1 ? 'file' : 'files'} · failed`))
        : bold(colors.primary(`Read ${String(files)} ${files === 1 ? 'file' : 'files'}`))
    let header = `${String(pending > 0 ? colors.text('● ') : failed === reads.length ? colors.error('✗ ') : colors.success('✓ '))}${String(label)}`
    if (reads.length > files) header += colors.muted(` · ${String(reads.length)} reads`)
    if (failed > 0 && failed < reads.length) header += colors.error(` · ${String(failed)} failed`)
    return components.truncateToWidth(header, width)
  }

  private renderFileRows(deps: RenderDeps, cut: (row: string) => string): string[] {
    const rows: string[] = []
    const groups = groupReadsByFile(this.model.reads)
    groups.forEach((group, index) => {
      const last = index === groups.length - 1
      const branch = last ? '└─' : '├─'
      const continuation = last ? '   ' : '│  '
      if (group.reads.length === 1) {
        const read = group.reads[0]!
        const inline = read.state === 'error'
          ? `  ${String(branch)} ${String(group.path)} ${String(windowMark(read, deps))}${String(shortError(read, deps))}`
          : `  ${String(branch)} ${String(group.path)} · ${String(windowText(read))} ${String(windowMark(read, deps))}`
        rows.push(cut(inline))
        if (this.expanded && read.state === 'ok') rows.push(...this.renderPreviewRows(read, continuation, cut))
        return
      }
      const errors = group.reads.filter(read => read.state === 'error')
      const pending = group.reads.some(read => read.state === 'pending')
      let parent = `  ${String(branch)} ${String(group.path)}`
      if (errors.length === group.reads.length) parent += ` ${String(windowMark(group.reads[0]!, deps))}${String(shortError(group.reads.find(read => read.error !== undefined), deps))}`
      else if (errors.length > 0) parent += ` ${deps.colors.warning('◐')}${String(shortError(errors[0], deps))}`
      else if (pending) parent += deps.colors.textMuted(' · reading…')
      rows.push(cut(parent))
      group.reads.forEach((read, window) => {
        const windowLast = window === group.reads.length - 1
        const windowBranch = windowLast ? '└─' : '├─'
        rows.push(cut(`  ${String(continuation)}${String(windowBranch)} ${String(windowText(read))} ${String(windowMark(read, deps))}`))
        if (this.expanded && read.state === 'ok') {
          rows.push(...this.renderPreviewRows(read, `${String(continuation)}${windowLast ? '   ' : '│  '}`, cut))
        }
      })
    })
    return rows
  }

  private renderPreviewRows(read: ReadCallModel, prefix: string, cut: (row: string) => string): string[] {
    if (read.previewLines === undefined) return []
    return read.previewLines.map(line => cut(`  ${String(prefix)}${String(line.number)}  ${String(line.text)}`))
  }
}
