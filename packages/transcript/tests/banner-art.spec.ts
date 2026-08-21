/**
 * The banner logo literal: the kimi-code placeholder rows pinned exactly, so
 * an accidental edit of {@link LOGO_ART} surfaces in review.
 */

import { describe, expect, it } from 'vitest'
import { LOGO_ART } from '../src/banner-art.ts'

describe('LOGO_ART', () => {
  it('pins the placeholder logo rows', () => {
    expect(LOGO_ART).toEqual(['▐█▛█▛█▌', '▐█████▌'])
  })

  it('keeps every row seven columns wide', () => {
    for (const row of LOGO_ART) {
      expect(row).toHaveLength(7)
    }
  })
})
