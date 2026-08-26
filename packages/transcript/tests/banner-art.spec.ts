/**
 * The banner logo literal: the DeepSeek whale rows pinned exactly, so an
 * accidental edit of {@link LOGO_ART} surfaces in review.
 */

import { describe, expect, it } from 'vitest'
import { LOGO_ART, LOGO_COLS, LOGO_GRADIENT, LOGO_ROWS } from '../src/banner-art.ts'

describe('LOGO_ART', () => {
  it('pins the whale logo rows', () => {
    expect(LOGO_ART).toEqual([
      '   ⢀⣀⣰⣰⣰⣰⣰⣼⣼⠜   ⣺⣵⡀    ⢀⡀'.padEnd(LOGO_COLS),
      ' ⢀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣵⣐  ⢯⣿⣿⣵⣸⣼⣼⣿⠕'.padEnd(LOGO_COLS),
      '⢨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣐⠂⠯⣿⣿⣿⣿⠿⠇'.padEnd(LOGO_COLS),
      '⣿⡟⠃⠃⠋⠏⠿⣿⣿⣿⣿⣿⣿⠯⢿⣿⣽⣴⣿⣿⡕'.padEnd(LOGO_COLS),
      '⣿⣿      ⠋⢿⣿⣿⣿⣿ ⠋⣿⣿⣿⣿⠁'.padEnd(LOGO_COLS),
      '⢯⣿⣵       ⠫⣿⣿⣿⣽⣼⣿⣿⣿⠗'.padEnd(LOGO_COLS),
      '⠂⢯⣿⣵⡀   ⣰⣀ ⠊⢿⣿⣿⣿⣿⡿⠇'.padEnd(LOGO_COLS),
      '  ⠋⣿⣿⣼⣰⣰⣻⣿⣽⣰⣀⠋⢿⣿⣿⣼⣰⡀'.padEnd(LOGO_COLS),
      '    ⠃⠏⠿⣿⣿⣿⣿⣿⠿⠟⠇⠂⠃⠃⠃'.padEnd(LOGO_COLS),
    ])
  })

  it('keeps every row the uniform width', () => {
    for (const row of LOGO_ART) {
      expect(row).toHaveLength(LOGO_COLS)
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
