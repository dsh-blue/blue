/**
 * The welcome banner's pixel whale — a spouting whale, blue's namesake logo.
 * The body is a 16×8 source grid folded into four terminal rows by the pure
 * half-block packer (row pairs, one line per pair — both cells lit → `█`,
 * top only → `▀`, bottom only → `▄`, neither → space). The spray above the
 * blowhole is typographic — scattered `. ·` droplets, deliberately not pixel
 * blocks — two text rows completing the six-row {@link WHALE_ART}.
 *
 * The body is the S8-era original hand-scaled to 0.8 with the design's
 * asymmetries kept: the spray rows step in from the left (the side-fin/head
 * silhouette), the body carries its notches and inset flanks, and the belly
 * bulges one pixel left of the back. `'1'` is a lit cell, anything else is
 * dark; the golden spec in `tests/banner-art.spec.ts` pins the packed result.
 *
 * @module @deepseek-ai/dsh-blue-transcript/banner-art
 */

/** The lit-pixel marker inside {@link WHALE_PIXELS} rows. */
const PIXEL_ON = '1'

/** The spray above the blowhole: scattered droplets, not pixel blocks. */
const WHALE_SPRAY: readonly string[] = [
  '      ·  .  ·   ',
  '        .·.     ',
]

/**
 * The whale's body as 8 rows of 16 cells (`'1'` = lit): back, notched
 * mid-body, solid belly, and ▀ base.
 */
export const WHALE_PIXELS: readonly string[] = [
  '0000000000000000',
  '0000111111111000',
  '0000111111110000',
  '0011101111011100',
  '0001111111111000',
  '0001111111111000',
  '0001111111111000',
  '0000000000000000',
]

/** The full logo: the text spray above the packed pixel body. */
export const WHALE_ART: readonly string[] = [...WHALE_SPRAY, ...packHalfBlockArt(WHALE_PIXELS)]

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
