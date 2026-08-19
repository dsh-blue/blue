/**
 * `ctx.blueStatus` service and the footer shell it feeds. The registry keeps
 * entries sorted (ascending priority, registration order on ties) and nudges
 * the shell on every change; the shell is mounted once, bottom-pinned above
 * the input editor, by the `blue-transcript` plugin's `apply` and lays the
 * entries out over at most two rows — joining them with a muted ` · `,
 * wrapping overflow onto the second row, and dropping the lowest-priority
 * entries that fit neither row. An empty registry (or a frame where every
 * entry renders '') yields zero rows, so the footer vanishes entirely.
 *
 * @module @dsh-blue/blue-transcript/status
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueComponents,
  BlueScreen,
  BlueSemanticColors,
} from '@dsh-blue/blue-core'
import type { BlueStatus, BlueStatusEntry } from './types.ts'

/** The footer's row budget. */
export const FOOTER_MAX_ROWS = 2

/** Stable error taxonomy for status-registry failures. */
export class BlueStatusError extends Error {
  /** Machine-readable failure kind. */
  readonly code: 'DUPLICATE_ENTRY'

  /**
   * @param message - the conflicting entry id.
   * @param code - the failure kind.
   */
  constructor(message: string, code: 'DUPLICATE_ENTRY') {
    super(message)
    this.name = 'BlueStatusError'
    this.code = code
  }
}

/** A registry record: the entry plus its registration-order tiebreak. */
interface RegisteredEntry {
  entry: BlueStatusEntry
  seq: number
}

/** One placed segment: the styled text and its measured visible width. */
interface Segment {
  text: string
  width: number
}

/**
 * The `blueStatus` service. Instantiated directly in the transcript plugin's
 * `apply` (the shell it nudges is built there too, so a class plugin cannot
 * close over it); registration is still effect-bound through the `Service`
 * base, so unloading the fiber unregisters the service.
 */
export class BlueStatusService extends Service implements BlueStatus {
  private readonly entries = new Map<string, RegisteredEntry>()
  private nextSeq = 0
  private shell: FooterShellComponent | null = null

  /**
   * Create and register the service.
   * @param ctx - the owning Cordis context.
   * @param screen - the screen registry changes request redraws on.
   */
  constructor(
    ctx: Context,
    private readonly screen: BlueScreen,
  ) {
    super(ctx, 'blueStatus')
  }

  /**
   * Bind the footer shell so registry changes invalidate it. Called once by
   * the transcript plugin right after constructing both.
   * @param shell - the mounted footer shell.
   */
  attach(shell: FooterShellComponent): void {
    this.shell = shell
  }

  /** The entries in layout order: ascending priority, registration order on ties. */
  get sortedEntries(): BlueStatusEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => a.entry.priority - b.entry.priority || a.seq - b.seq)
      .map(record => record.entry)
  }

  /**
   * Register one entry and nudge the shell.
   * @param entry - the entry to add; its id must be unclaimed.
   * @returns a disposer unregistering the entry; safe to call twice.
   */
  register(entry: BlueStatusEntry): () => void {
    if (this.entries.has(entry.id)) {
      throw new BlueStatusError(`status entry "${entry.id}" is already registered`, 'DUPLICATE_ENTRY')
    }
    this.entries.set(entry.id, { entry, seq: this.nextSeq })
    this.nextSeq += 1
    this.nudge()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.entries.delete(entry.id)
      this.nudge()
    }
  }

  /** Invalidate the shell and schedule a redraw after any registry change. */
  private nudge(): void {
    this.shell?.invalidate()
    this.screen.requestRender()
  }
}

/**
 * The persistent two-row footer. Row fill is first-fit in layout order: each
 * entry sees the width budget remaining on the first row it could join, an
 * entry that fits neither row is dropped (so overflow always sacrifices the
 * lowest priorities), and an entry rendering '' occupies nothing. Every row
 * is padded to the full width so a shrinking footer never leaves stale
 * cells behind. The cache key carries the placed texts, so an entry whose
 * output changed re-lays-out without an explicit invalidate.
 */
export class FooterShellComponent implements BlueComponent {
  private cache: { key: string, lines: string[] } | null = null

  /**
   * @param status - the registry supplying the entries.
   * @param colors - the semantic color table (the separator is muted).
   * @param components - the component factory providing the width helpers.
   */
  constructor(
    private readonly status: BlueStatusService,
    private readonly colors: BlueSemanticColors,
    private readonly components: BlueComponents,
  ) {}

  /** Drop the cached lines; the next render re-lays-out from the registry. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * @param width - current viewport width in columns.
   * @returns up to {@link FOOTER_MAX_ROWS} rows; none when nothing renders.
   */
  render(width: number): string[] {
    const rows: Segment[][] = [[]]
    const used: number[] = [0]
    const separator = this.colors.muted(' · ')
    const separatorWidth = this.components.visibleWidth(' · ')
    for (const entry of this.status.sortedEntries) {
      for (let row = 0; row < FOOTER_MAX_ROWS; row += 1) {
        const segments = rows[row] ?? []
        const spent = (used[row] ?? 0) + (segments.length > 0 ? separatorWidth : 0)
        const remaining = width - spent
        if (remaining <= 0) continue
        const text = entry.render(remaining)
        // '' means "no contribution at this budget": a hidden entry stays
        // hidden on every row, a too-wide one may still fit the next row.
        if (text === '') continue
        const textWidth = this.components.visibleWidth(text)
        if (textWidth > remaining) continue
        if (rows[row] === undefined) {
          rows[row] = []
          used[row] = 0
        }
        rows[row]!.push({ text, width: textWidth })
        used[row] = spent + textWidth
        break
      }
    }

    const key = `${width}:${rows.map(segments => segments.map(segment => segment.text).join('\x00')).join('\x01')}`
    if (this.cache?.key === key) return this.cache.lines
    const lines = rows
      .filter(segments => segments.length > 0)
      .map((segments) => {
        const body = segments.map(segment => segment.text).join(separator)
        const bodyWidth = segments.reduce((total, segment) => total + segment.width, 0)
          + separatorWidth * (segments.length - 1)
        return body + ' '.repeat(Math.max(0, width - bodyWidth))
      })
    this.cache = { key, lines }
    return lines
  }
}
