/**
 * The banner logo literal: the terminal-window `>_` rows pinned exactly, so
 * an accidental edit of {@link LOGO_ART} surfaces in review.
 */

import { describe, expect, it } from 'vitest'
import { LOGO_ART, LOGO_COLS, LOGO_GRADIENT, LOGO_ROWS } from '../src/banner-art.ts'

describe('LOGO_ART', () => {
  it('pins the terminal-window logo rows', () => {
    expect(LOGO_ART).toEqual([
      '⡔⠉⠩⠍⠩⠍⠩⠍⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢢'.padEnd(LOGO_COLS),
      '⡇⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢸'.padEnd(LOGO_COLS),
      '⡇                       ⢸'.padEnd(LOGO_COLS),
      '⡇       ⠘⠶⣤⣀            ⢸'.padEnd(LOGO_COLS),
      '⡇          ⠉⠛⠶⣤⡀        ⢸'.padEnd(LOGO_COLS),
      '⡇          ⣀⣤⠶⠛⠁        ⢸'.padEnd(LOGO_COLS),
      '⡇       ⢠⠶⠛⠉     ⣤⣤⣤⣤⣤⡄ ⢸'.padEnd(LOGO_COLS),
      '⡇                       ⢸'.padEnd(LOGO_COLS),
      '⠣⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⠜'.padEnd(LOGO_COLS),
    ])
  })

  it('keeps every row the uniform width and a flush right frame edge', () => {
    for (const row of LOGO_ART) {
      expect(row).toHaveLength(LOGO_COLS)
      // The window frame's right border runs through every row — the even
      // gap to the status column depends on it (any braille cell counts;
      // a space would mean the row's art stops short of the frame edge).
      expect(row[LOGO_COLS - 1]).toMatch(/[⠀-⣿]/)
    }
  })

  it('exposes the row count the layout anchors on', () => {
    expect(LOGO_ROWS).toBe(LOGO_ART.length)
  })

  it('carries one brand-blue gradient hex per logo row', () => {
    expect(LOGO_GRADIENT).toHaveLength(LOGO_ROWS)
    for (const hex of LOGO_GRADIENT) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
