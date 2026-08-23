/**
 * The welcome banner's logo — the DeepSeek whale in braille block art, nine
 * rows tall, rendered frameless to the left of the status column. This
 * module stays the logo's single home for its ART; the per-row color sweep
 * is palette furniture and lives in each theme's `logoGradient` token.
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

