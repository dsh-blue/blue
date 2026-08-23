/**
 * `ReadGroupComponent` — the kimi `read-group` port (S20 back half): two or
 * more same-step Read calls render as one group instead of individual
 * cards. The mounter (`src/index.ts`) forms the group when a second Read
 * mounts consecutively in the same step (kimi's contiguity rule — any
 * other tool between two Reads breaks the chain), retiring the lone card
 * and mounting this component over the pair; later Reads attach to it.
 *
 * The header mirrors kimi: `● ` (`text`) + bold `primary` `Reading N
 * files…` while any member runs; `✓ ` (success) + bold `primary` `Read N
 * files` with a dim ` · L lines` count (plus an error ` · F failed` tail)
 * once all settle; `✗ ` (error) + bold error `Read N files · failed` when
 * every member failed. The body is the kimi tree — one `  ├─`/`└─` row
 * per member with its path in `text` and a dim ` · N lines` / ` ·
 * reading…` tail (error ` · failed`); members without a recognizable path
 * stay header-only. Members keep their state on their own fold items (the
 * kimi "state stays in each card" rule, Blue's items being the cards); the
 * component reads them on every render, so a settling result re-renders
 * through the mounter's ordinary redraw nudge. The group exposes no
 * `setExpanded` — kimi's group never expands, and the Ctrl-O toggle skips
 * components without one. The render cache keys on the members' states.
 *
 * @module @dsh-blue/blue-transcript/read-group
 */

import type { BlueComponent, BlueComponents, BlueSemanticColors } from '@dsh-blue/blue-core'
import { clampRowsToWidth } from '@dsh-blue/blue-core/chrome'
import type { TranscriptToolItem } from './types.ts'

/** Bold SGR pair (the S18 local-constant precedent). */
const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** One member's rendered snapshot — kimi's `ToolCallReadSnapshot`. */
interface ReadSnapshot {
  /** The member's target path, or undefined when the args carry none. */
  readonly filePath: string | undefined
  /** pending until the result lands, failed on error, done otherwise. */
  readonly phase: 'pending' | 'done' | 'failed'
  /** Non-empty result lines when done; 0 pending or failed. */
  readonly lines: number
}

/** Cache keyed on the inputs the rendered lines depend on. */
interface RenderCache {
  key: string
  lines: string[]
}

/**
 * Renders one grouped run of same-step Reads.
 */
export class ReadGroupComponent implements BlueComponent {
  /** The member tool items, in call order; the first one is the group's
   * bookkeeping item (turn/step identity for folding and eviction). */
  private readonly members: TranscriptToolItem[]
  private readonly colors: BlueSemanticColors
  private readonly components: BlueComponents
  private cache: RenderCache | null = null

  /**
   * @param member - the first member (the retired lone card's item).
   * @param colors - the semantic color table.
   * @param components - the component factory providing the width helpers.
   */
  constructor(member: TranscriptToolItem, colors: BlueSemanticColors, components: BlueComponents) {
    this.members = [member]
    this.colors = colors
    this.components = components
  }

  /** Drop the cached lines; the next render rebuilds from the members. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * Join one more Read call to the group (third and later mounts).
   * @param member - the tool item to attach.
   */
  attach(member: TranscriptToolItem): void {
    this.members.push(member)
    this.invalidate()
  }

  /** One member's snapshot, from its live fold item. */
  private snapshot(member: TranscriptToolItem): ReadSnapshot {
    const parsed = member.parsedArguments
    let filePath: string | undefined
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      const args = parsed as Record<string, unknown>
      const raw = args['file_path'] ?? args['path']
      if (typeof raw === 'string' && raw !== '') filePath = raw
    }
    const result = member.result
    if (result === undefined) return { filePath, phase: 'pending', lines: 0 }
    if (result.isError) return { filePath, phase: 'failed', lines: 0 }
    const text = result.fullText ?? result.text
    return {
      filePath,
      phase: 'done',
      lines: text.split('\n').filter(line => line.length > 0).length,
    }
  }

  /** The kimi header line, from the member snapshots. */
  private header(snapshots: readonly ReadSnapshot[], width: number): string {
    const { colors } = this
    const total = snapshots.length
    let pending = 0
    let failed = 0
    let totalLines = 0
    for (const snap of snapshots) {
      if (snap.phase === 'pending') pending += 1
      else if (snap.phase === 'failed') failed += 1
      else totalLines += snap.lines
    }
    const label = (text: string): string => `${BOLD_OPEN}${colors.primary(text)}${BOLD_CLOSE}`
    let line: string
    if (pending > 0) {
      line = `${colors.text('● ')}${label(`Reading ${total} files…`)}`
    } else if (failed === total) {
      const failedLabel = `${BOLD_OPEN}${colors.error(`Read ${total} files`)}${BOLD_CLOSE}`
      line = `${colors.error('✗ ')}${failedLabel}${colors.error(' · failed')}`
    } else {
      const linesPart = colors.muted(` · ${totalLines} ${totalLines === 1 ? 'line' : 'lines'}`)
      const failPart = failed > 0 ? colors.error(` · ${failed} failed`) : ''
      line = `${colors.success('✓ ')}${label(`Read ${total} files`)}${linesPart}${failPart}`
    }
    return this.components.truncateToWidth(line, width)
  }

  /** One tree row: `  ├─/└─ path · tail` (the path is always defined here). */
  private bodyRow(snapshot: ReadSnapshot & { filePath: string }, isLast: boolean, width: number): string {
    const { colors } = this
    const branch = isLast ? '└─' : '├─'
    const path = colors.text(snapshot.filePath)
    let tail: string
    if (snapshot.phase === 'pending') {
      tail = colors.muted(' · reading…')
    } else if (snapshot.phase === 'failed') {
      tail = colors.error(' · failed')
    } else {
      tail = colors.muted(` · ${snapshot.lines} ${snapshot.lines === 1 ? 'line' : 'lines'}`)
    }
    return this.components.truncateToWidth(`  ${branch} ${path}${tail}`, width)
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the rendered rows: separator, header, and the tree.
   */
  render(width: number): string[] {
    const key = `${width}|${this.members.map(member =>
      `${member.seq}:${member.result ? `${member.result.isError}:${member.result.fullText ?? member.result.text}` : 'pending'}`).join('|')}`
    if (this.cache?.key === key) return this.cache.lines
    const snapshots = this.members.map(member => this.snapshot(member))
    const lines = ['', this.header(snapshots, width)]
    const visible = snapshots.filter(
      (snapshot): snapshot is ReadSnapshot & { filePath: string } => snapshot.filePath !== undefined)
    visible.forEach((snapshot, index) => {
      lines.push(this.bodyRow(snapshot, index === visible.length - 1, width))
    })
    const clamped = clampRowsToWidth(lines, width, text => this.components.truncateToWidth(text, width))
    this.cache = { key, lines: clamped }
    return clamped
  }
}
