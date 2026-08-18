/**
 * The welcome banner's pixel castle: the 20×20 source grid (rows 0–15; the
 * reference's lower rows are empty) and the pure half-block packer that folds
 * it into terminal rows. The packer pairs pixel rows top-to-bottom and emits
 * one terminal line per pair — both cells lit → `█`, top only → `▀`, bottom
 * only → `▄`, neither → space — so the 16 castle rows render as eight
 * 20-column lines inside the banner's left column.
 *
 * The grid is generated offline from the reference pixel art (the
 * `banner.py`/`pixel.json` pair): `'1'` is a lit cell, anything else is dark.
 * Regenerate the constant there when the art changes; the golden spec in
 * `tests/banner-art.spec.ts` pins the packed result.
 *
 * @module @deepseek-ai/dsh-blue-transcript/banner-art
 */

/** The lit-pixel marker inside {@link CASTLE_PIXELS} rows. */
const PIXEL_ON = '1'

/**
 * The castle as 16 rows of 20 cells (`'1'` = lit). Rows 3–14 carry the art;
 * the blank border rows keep the reference banner's vertical breathing room
 * after packing.
 */
export const CASTLE_PIXELS: readonly string[] = [
  '00000000000000000000',
  '00000000000000000000',
  '00000000000000000000',
  '00000000100010000000',
  '00000001010101000000',
  '00000000001000000000',
  '00000000000000000000',
  '00000111111111110000',
  '00000111111111110000',
  '00111110111110111100',
  '00111110111110111100',
  '00111111111111111100',
  '00001111111111110000',
  '00001111111111110000',
  '00001111111111110000',
  '00000000000000000000',
]

/**
 * Pack pixel rows into half-block terminal lines: consecutive row pairs
 * become one line, each column mapped to `█` (both lit), `▀` (top lit),
 * `▄` (bottom lit), or a space. An odd trailing row pairs with an implicit
 * dark row; every output line is as wide as the widest row of its pair, so
 * uniform-width input yields uniform-width lines.
 * @param rows - the pixel grid, one string per row.
 * @returns the packed lines, `rows.length / 2` rounded up.
 */
export function packHalfBlockArt(rows: readonly string[]): string[] {
  const lines: string[] = []
  for (let top = 0; top < rows.length; top += 2) {
    // The loop bound guarantees `top` indexes a row; `top + 1` may not.
    const topRow = rows[top]!
    const bottomRow = rows[top + 1] ?? ''
    const columns = Math.max(topRow.length, bottomRow.length)
    let line = ''
    for (let column = 0; column < columns; column++) {
      const hasTop = topRow[column] === PIXEL_ON
      const hasBottom = bottomRow[column] === PIXEL_ON
      line += hasTop && hasBottom ? '█' : hasTop ? '▀' : hasBottom ? '▄' : ' '
    }
    lines.push(line)
  }
  return lines
}
