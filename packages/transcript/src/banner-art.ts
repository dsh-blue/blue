/**
 * The welcome banner's pixel whale — a spouting whale, blue's namesake logo —
 * as a 16×14 source grid plus the pure half-block packer that folds it into
 * terminal rows. The packer pairs pixel rows top-to-bottom and emits one
 * terminal line per pair — both cells lit → `█`, top only → `▀`, bottom only
 * → `▄`, neither → space — so the 14 grid rows render as seven 16-column
 * lines inside the banner's logo cell.
 *
 * The grid is the S8-era 20×16 original hand-scaled to 0.8 (a 30% area cut)
 * with the design's asymmetries kept: the spout rows step in from the left
 * (the side-fin/head silhouette), the body carries its notches and inset
 * flanks, and the belly bulges one pixel left of the back. The spray itself
 * is re-drawn as staggered bubble dots — at the smaller scale they read
 * better than the compressed fan. `'1'` is a lit cell, anything else is
 * dark; the golden spec in `tests/banner-art.spec.ts` pins the packed result.
 *
 * @module @deepseek-ai/dsh-blue-transcript/banner-art
 */

/** The lit-pixel marker inside {@link WHALE_PIXELS} rows. */
const PIXEL_ON = '1'

/**
 * The spouting whale as 14 rows of 16 cells (`'1'` = lit). Rows 0–12 carry
 * the art; the blank border rows keep the logo's vertical breathing room
 * after packing.
 */
export const WHALE_PIXELS: readonly string[] = [
  '0000010010010000',
  '0000000000000000',
  '0000000000000000',
  '0000000100100000',
  '0000000000000000',
  '0000111111111000',
  '0000111111110000',
  '0011101111011100',
  '0011101111011100',
  '0011111111111100',
  '0001111111111000',
  '0001111111111000',
  '0001111111111000',
  '0000000000000000',
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
