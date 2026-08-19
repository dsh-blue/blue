/**
 * `ctx.blueStatus` service and the footer shell it feeds. The registry keeps
 * entries sorted (ascending priority, registration order on ties) and nudges
 * the shell on every change; the shell is mounted once, bottom-pinned above
 * the input editor, by the `blue-transcript` plugin's `apply` and lays the
 * entries out over at most two bands — the kimi footer shape. Each entry
 * picks its band (`row`, default 1) and its cluster within the band
 * (`align`, default left); a cluster is filled first-fit in layout order,
 * joining its entries with a two-space slot gap (no separator glyph and no
 * separator color — kimi's slot identity), and an entry that does not fit
 * its cluster's remaining budget — or renders '' — is dropped for the frame
 * (overflow always sacrifices the lowest priorities; entries never spill
 * into another band). A band's right cluster lays out after its left cluster
 * plus a minimum gap and is right-aligned, so a crowded left band yields the
 * right cluster first. An empty registry (or a frame where every entry
 * renders '') yields zero rows, so the footer vanishes entirely.
 *
 * @module @dsh-blue/blue-transcript/status
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueComponents,
  BlueScreen,
} from '@dsh-blue/blue-core'
import type { BlueStatus, BlueStatusEntry } from './types.ts'

/** The footer's band budget. */
export const FOOTER_MAX_ROWS = 2

/** The minimum gap between a band's left and right clusters. */
export const FOOTER_GAP_COLUMNS = 2

/** The slot gap joining two entries of one cluster (kimi's footer slots). */
export const FOOTER_SLOT_GAP = '  '

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

/** One band's two clusters, bucketed from the sorted entries. */
interface Band {
  left: BlueStatusEntry[]
  right: BlueStatusEntry[]
}

/** The visible width of a placed cluster: its segments plus slot gaps. */
function clusterWidth(segments: readonly Segment[], gapWidth: number): number {
  if (segments.length === 0) return 0
  return segments.reduce((total, segment) => total + segment.width, 0)
    + gapWidth * (segments.length - 1)
}

/** Join a placed cluster's segments with the slot gap. */
function joinCluster(segments: readonly Segment[]): string {
  return segments.map(segment => segment.text).join(FOOTER_SLOT_GAP)
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
 * The persistent two-band footer. Cluster fill is first-fit in layout order,
 * an entry that fits its cluster's remaining budget — or renders '' — is
 * dropped for the frame (so overflow always sacrifices the lowest
 * priorities), and every entry is rendered exactly once per frame. The right
 * cluster's budget is what remains after the left cluster and the
 * inter-cluster gap, so it yields first under width pressure and renders
 * right-aligned. Every band is padded to the full width so a shrinking
 * footer never leaves stale cells behind. The cache key carries the placed
 * texts, so an entry whose output changed re-lays-out without an explicit
 * invalidate.
 */
export class FooterShellComponent implements BlueComponent {
  private cache: { key: string, lines: string[] } | null = null

  /**
   * @param status - the registry supplying the entries.
   * @param components - the component factory providing the width helpers.
   */
  constructor(
    private readonly status: BlueStatusService,
    private readonly components: BlueComponents,
  ) {}

  /** Drop the cached lines; the next render re-lays-out from the registry. */
  invalidate(): void {
    this.cache = null
  }

  /**
   * @param width - current viewport width in columns.
   * @returns up to {@link FOOTER_MAX_ROWS} band rows; none when nothing renders.
   */
  render(width: number): string[] {
    const gapWidth = this.components.visibleWidth(FOOTER_SLOT_GAP)

    // Bucket the sorted entries into per-band clusters, keeping the global
    // layout order inside each cluster. Dishonest `row`/`align` values (a
    // cast `3`, an unknown align) clamp into the budget rather than crash or
    // drop the entry.
    const bands: Band[] = Array.from({ length: FOOTER_MAX_ROWS }, () => ({ left: [], right: [] }))
    for (const entry of this.status.sortedEntries) {
      const band = Math.min(FOOTER_MAX_ROWS, Math.max(1, entry.row ?? 1)) - 1
      const cluster = entry.align === 'right' ? bands[band]!.right : bands[band]!.left
      cluster.push(entry)
    }

    const lines: string[] = []
    const bandKeys: string[] = []
    for (const band of bands) {
      const left = this.layoutCluster(band.left, width, gapWidth)
      const leftUsed = clusterWidth(left, gapWidth)
      const rightBudget = left.length === 0 ? width : width - leftUsed - FOOTER_GAP_COLUMNS
      // A starved right cluster is not even rendered: its entries yield.
      const right = rightBudget > 0
        ? this.layoutCluster(band.right, rightBudget, gapWidth)
        : []
      if (left.length === 0 && right.length === 0) continue

      const rightUsed = clusterWidth(right, gapWidth)
      let line: string
      if (left.length === 0) {
        line = ' '.repeat(width - rightUsed) + joinCluster(right)
      } else if (right.length === 0) {
        line = joinCluster(left) + ' '.repeat(width - leftUsed)
      } else {
        // The gap is at least FOOTER_GAP_COLUMNS by the right budget's definition.
        line = joinCluster(left)
          + ' '.repeat(width - leftUsed - rightUsed)
          + joinCluster(right)
      }
      lines.push(line)
      bandKeys.push(
        `${left.map(segment => segment.text).join('\x00')}\x02${right.map(segment => segment.text).join('\x00')}`,
      )
    }

    const key = `${width}:${bandKeys.join('\x01')}`
    if (this.cache?.key === key) return this.cache.lines
    this.cache = { key, lines }
    return lines
  }

  /**
   * Fill one cluster first-fit: each entry sees the budget remaining after
   * the segments already placed, is skipped without a render when nothing
   * remains, and is dropped when it renders '' or measures over budget.
   * @param entries - the cluster's entries in layout order.
   * @param budget - the cluster's total width in columns.
   * @param gapWidth - the slot gap's visible width.
   * @returns the placed segments.
   */
  private layoutCluster(
    entries: readonly BlueStatusEntry[],
    budget: number,
    gapWidth: number,
  ): Segment[] {
    const placed: Segment[] = []
    let used = 0
    for (const entry of entries) {
      const spent = used + (placed.length > 0 ? gapWidth : 0)
      const remaining = budget - spent
      if (remaining <= 0) continue
      const text = entry.render(remaining)
      // '' means "no contribution at this budget": the entry hides this frame.
      if (text === '') continue
      const textWidth = this.components.visibleWidth(text)
      if (textWidth > remaining) continue
      placed.push({ text, width: textWidth })
      used = spent + textWidth
    }
    return placed
  }
}
