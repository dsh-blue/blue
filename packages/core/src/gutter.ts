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
import { padColumns } from './chrome.ts'

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
   * @param width - current viewport width in columns.
   * @returns the child's rows, squeezed and gutter-padded.
   */
  render(width: number): string[] {
    return padColumns(this.child.render(width - 2 * this.n), this.n)
  }

  /** Forward the cache drop to the wrapped child. */
  invalidate(): void {
    this.child.invalidate()
  }
}
