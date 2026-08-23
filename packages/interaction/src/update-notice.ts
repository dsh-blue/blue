/**
 * The update-available notice (D52): the two-row scroll-area component
 * the boot check appends below the banner when the registry offers a
 * newer release. Plain text by design — no theme dependency, so the
 * notice survives `/theme` swaps without being a theme dependent (the
 * `/theme` fiber-dispose trap), and no banner involvement (S35's
 * three-round logo ruling keeps the banner untouchable). Width-safe
 * through the components service's truncator, the banner's own
 * discipline.
 *
 * @module @dsh-blue/blue-interaction/update-notice
 */

import type { BlueComponent } from '@dsh-blue/blue-core'

/** How the notice truncates a row to the viewport. */
export type RowTruncator = (text: string, width: number) => string

/** The notice's facts. */
export interface UpdateNoticeContent {
  /** The version the process runs. */
  readonly current: string
  /** The version the registry offers. */
  readonly target: string
  /** The manual install command shown on the second row. */
  readonly command: string
}

/**
 * Compose the notice rows for the given content.
 * @param content - the notice facts.
 * @returns the two untruncated rows.
 */
export function updateNoticeRows(content: UpdateNoticeContent): string[] {
  return [
    `Blue v${content.target} is available (current: v${content.current})`,
    `run /update — or: ${content.command}`,
  ]
}

/**
 * The two-row update notice. Renders the composed rows truncated to the
 * viewport; holds no state, so `invalidate` is a no-op.
 */
export class UpdateNoticeComponent implements BlueComponent {
  private readonly rows: string[]
  private readonly truncate: RowTruncator

  /**
   * @param truncate - the components service's width-safe truncator.
   * @param content - the notice facts.
   */
  constructor(truncate: RowTruncator, content: UpdateNoticeContent) {
    this.rows = updateNoticeRows(content)
    this.truncate = truncate
  }

  /**
   * @param width - current viewport width in columns.
   * @returns the notice rows, each within `width`.
   */
  render(width: number): string[] {
    return this.rows.map(row => this.truncate(row, width))
  }

  /** Stateless render; nothing to drop. */
  invalidate(): void {}
}
