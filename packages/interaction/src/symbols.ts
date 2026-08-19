/**
 * The shared selector symbols — the kimi `constant/symbols.ts` port,
 * scoped to this package's list surfaces. The pointer marks the cursor
 * row; the current mark is appended to the row holding the live value
 * (`SessionList`'s live session, the `/theme` listing's active palette).
 * Widths are load-bearing: rows assume the pointer occupies one leading
 * cell plus a space, and the mark appends after a two-space gap.
 *
 * @module @dsh-blue/blue-interaction/symbols
 */

/** The cursor-row pointer. */
export const SELECT_POINTER = '❯'

/** The trailing mark on the currently-active row. */
export const CURRENT_MARK = '← current'
