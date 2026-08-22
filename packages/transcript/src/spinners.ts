/**
 * Shared spinner frame cycles (the kimi `constant/rendering` port): the
 * braille dots animate the text-side states (the thinking component's live
 * label, the activity pane's composing row) and the moon cycle animates the
 * turn-level waiting/tool states. The intervals differ by style — 80 ms
 * braille, 120 ms moon — and the moon glyph is two terminal cells wide, a
 * width every row layout holding it must account for through the live
 * `blueComponents.visibleWidth`, never a hardcoded one-column assumption.
 *
 * @module @dsh-blue/blue-transcript/spinners
 */

/** The braille frame cycle, two terminal cells wide per frame. */
export const BRAILLE_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

/** Braille frame advance interval in milliseconds. */
export const BRAILLE_SPINNER_INTERVAL_MS = 80

/**
 * The moon-pane frame cycle — the DeepSeek deep-sea ripple: a wave that
 * slides left-to-right across the two-cell slot. Every frame spans two
 * terminal cells (the row layout's width budget for the spinner), so each
 * entry carries a trailing space where its glyph is a single cell.
 */
export const MOON_SPINNER_FRAMES = ['··', '·≈', '≈≈', '≈·', '··', '·≈', '≈≈', '≈·'] as const

/** Moon frame advance interval in milliseconds. */
export const MOON_SPINNER_INTERVAL_MS = 120
