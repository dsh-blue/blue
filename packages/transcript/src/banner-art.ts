/**
 * The welcome banner's pixel logo — a rounded blob with two vertical eye
 * slits. The body is a 12×6 source grid folded into three terminal rows by
 * the pure half-block packer (row pairs, one line per pair — both cells lit
 * → `█`, top only → `▀`, bottom only → `▄`, neither → space). Each eye is a
 * dark column spanning a row-pair boundary, so it renders as a `▀` over a
 * `▄` — one dark cell in the packed output. `'1'` is a lit cell, anything
 * else is dark; the golden spec in `tests/banner-art.spec.ts` pins the
 * packed result.
 *
 * @module @dsh-blue/blue-transcript/banner-art
 */

/** The lit-pixel marker inside {@link LOGO_PIXELS} rows. */
const PIXEL_ON = '1'

/**
 * The logo's body as 6 rows of 12 cells (`'1'` = lit): rounded dome, the
 * two one-cell eye slits, and the tucked-in base.
 */
export const LOGO_PIXELS: readonly string[] = [
  '001111111100',
  '111101110111',
  '111101110111',
  '111111111111',
  '011111111110',
  '011111111110',
]

/** The full logo: the packed pixel grid, ready for the banner's left column. */
export const LOGO_ART: readonly string[] = packHalfBlockArt(LOGO_PIXELS)

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
