/**
 * The welcome banner's logo — a terminal window with a `>_` prompt, nine
 * rows of braille block art, rendered frameless to the left of the status
 * column. This module stays the logo's single home; every consumer imports
 * the rows from here and never hardcodes a copy.
 *
 * Rows are written padded to a uniform width AND carry a flush right border
 * (the window frame's right edge), so the right-hand status text keeps an
 * even gap on every row — the earlier whale mark's ragged right edge made
 * the text column read misaligned against the art.
 *
 * The mark matches the interim brand logo (the blue terminal favicon); the
 * gradient sweep stays the brand identity across themes.
 *
 * @module @dsh-blue/blue-transcript/banner-art
 */

/** The logo's uniform column width — every row is padded to this. */
export const LOGO_COLS = 25

/**
 * The terminal-window `>_` mark: nine rows of braille block art, each padded
 * to {@link LOGO_COLS} columns. Dot semantics per row: top border with three
 * window-control dots, a title-bar separator, the `>` chevron arms meeting
 * at their right apex, the `_` cursor block, and the bottom border — the
 * left and right frame edges run through every row.
 */
export const LOGO_ART: readonly string[] = [
  '⡔⠉⠩⠍⠩⠍⠩⠍⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢢'.padEnd(LOGO_COLS),
  '⡇⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢸'.padEnd(LOGO_COLS),
  '⡇                       ⢸'.padEnd(LOGO_COLS),
  '⡇       ⠘⠶⣤⣀            ⢸'.padEnd(LOGO_COLS),
  '⡇          ⠉⠛⠶⣤⡀        ⢸'.padEnd(LOGO_COLS),
  '⡇          ⣀⣤⠶⠛⠁        ⢸'.padEnd(LOGO_COLS),
  '⡇       ⢠⠶⠛⠉     ⣤⣤⣤⣤⣤⡄ ⢸'.padEnd(LOGO_COLS),
  '⡇                       ⢸'.padEnd(LOGO_COLS),
  '⠣⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⠜'.padEnd(LOGO_COLS),
]

/** The logo's row count — the status column's vertical anchor. */
export const LOGO_ROWS = LOGO_ART.length

/**
 * The logo's brand-blue gradient, one hex per row: deep navy at the top,
 * through the brand blue at the waist, to a light sky blue at the bottom.
 * Each entry maps to the same-index {@link LOGO_ART} row, so the mark reads
 * as one sweeping gradient down its body.
 */
export const LOGO_GRADIENT: readonly string[] = [
  '#2a3bd0',
  '#3247db',
  '#3b53e7',
  '#445ff2',
  '#4d6bfe',
  '#617cfe',
  '#758efe',
  '#899ffe',
  '#9db1ff',
]
