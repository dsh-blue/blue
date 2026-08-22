/**
 * The kimi `GutterContainer` equivalent (D29, consumed in S21): a
 * component wrapper that insets its child by a one-column gutter on both
 * sides without the child knowing. The child renders at `width - 2*n`
 * (the squeeze is the right margin) and every row gains `n` leading
 * columns through the chrome layer's pure `padColumns` — styling
 * untouched. The wrapped children are the passive transcript and dock
 * surfaces; the editor, dialogs, and overlays stay full-width, so nothing
 * focusable passes through.
 *
 * @module @dsh-blue/blue-core/gutter
 */

import type { BlueComponent } from './types.ts'
import { clampRowsToWidth, padColumns } from './chrome.ts'
import { truncateToWidth } from './width.ts'

/**
 * Renders one wrapped child inside the kimi one-column gutter.
 */
export class GutterComponent implements BlueComponent {
  /**
   * @param child - the component to inset; a passive surface (no input).
   * @param n - the gutter width in columns; defaults to 1.
   */
  constructor(
    private readonly child: BlueComponent,
    private readonly n = 1,
  ) {}

  /**
   * Render the child squeezed by both gutters and inset by the left one.
   * The child width floors at one column (a degenerate viewport during a
   * resize drag must not hand children a zero or negative width, and a
   * wide character cannot fit below two). Rows are cut only in that
   * degenerate regime — a viewport too narrow for the gutter furniture
   * itself; wider viewports emit the child's rows untouched (D45).
   * @param width - current viewport width in columns.
   * @returns the child's rows, squeezed, gutter-padded, width-bounded.
   */
  render(width: number): string[] {
    const inner = Math.max(1, width - 2 * this.n)
    const rows = padColumns(this.child.render(inner), this.n)
    if (width >= 2 * this.n + 2) return rows
    return clampRowsToWidth(rows, Math.max(1, width), (text, target) => truncateToWidth(text, target))
  }

  /** Forward the cache drop to the wrapped child. */
  invalidate(): void {
    this.child.invalidate()
  }
}
