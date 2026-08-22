/**
 * The welcome banner's logo — the DeepSeek whale in braille block art, nine
 * rows tall, rendered frameless to the left of the status column. This
 * module stays the logo's single home; every consumer imports the rows from
 * here and never hardcodes a copy.
 *
 * Rows are written left-padded to a uniform width so the right-hand status
 * text lands on one aligned column whatever the whale's silhouette.
 *
 * @module @dsh-blue/blue-transcript/banner-art
 */

/** The logo's uniform column width — every row is padded to this. */
export const LOGO_COLS = 25

/**
 * The DeepSeek whale: nine rows of braille block art, each padded to
 * {@link LOGO_COLS} columns. The leading whitespace is the whale's left
 * margin, so the mark reads flush against the status column.
 */
export const LOGO_ART: readonly string[] = [
  '   ⢀⣀⣰⣰⣰⣰⣰⣼⣼⠜   ⣺⣵⡀    ⢀⡀'.padEnd(LOGO_COLS),
  ' ⢀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣵⣐  ⢯⣿⣿⣵⣸⣼⣼⣿⠕'.padEnd(LOGO_COLS),
  '⢨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣐⠂⠯⣿⣿⣿⣿⠿⠇'.padEnd(LOGO_COLS),
  '⣿⡟⠃⠃⠋⠏⠿⣿⣿⣿⣿⣿⣿⠯⢿⣿⣽⣴⣿⣿⡕'.padEnd(LOGO_COLS),
  '⣿⣿      ⠋⢿⣿⣿⣿⣿ ⠋⣿⣿⣿⣿⠁'.padEnd(LOGO_COLS),
  '⢯⣿⣵       ⠫⣿⣿⣿⣽⣼⣿⣿⣿⠗'.padEnd(LOGO_COLS),
  '⠂⢯⣿⣵⡀   ⣰⣀ ⠊⢿⣿⣿⣿⣿⡿⠇'.padEnd(LOGO_COLS),
  '  ⠋⣿⣿⣼⣰⣰⣻⣿⣽⣰⣀⠋⢿⣿⣿⣼⣰⡀'.padEnd(LOGO_COLS),
  '    ⠃⠏⠿⣿⣿⣿⣿⣿⠿⠟⠇⠂⠃⠃⠃'.padEnd(LOGO_COLS),
]

/** The logo's row count — the status column's vertical anchor. */
export const LOGO_ROWS = LOGO_ART.length

/**
 * The logo's brand-blue gradient, one hex per row: deep navy at the top,
 * through the DeepSeek brand blue at the waist, to a light sky blue at the
 * bottom. Each entry maps to the same-index {@link LOGO_ART} row, so the
 * whale reads as one sweeping gradient down its body.
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

