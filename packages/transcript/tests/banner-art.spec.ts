/**
 * Pure half-block packing: the four column combinations, odd trailing rows,
 * empty input, ragged pair widths, and the whale grid's golden output.
 */

import { describe, expect, it } from 'vitest'
import { WHALE_ART, WHALE_PIXELS, packHalfBlockArt } from '../src/banner-art.ts'

describe('packHalfBlockArt', () => {
  it('maps the four column combinations of a row pair', () => {
    expect(packHalfBlockArt(['01', '01'])).toEqual([' █'])
    expect(packHalfBlockArt(['01', '00'])).toEqual([' ▀'])
    expect(packHalfBlockArt(['00', '01'])).toEqual([' ▄'])
    expect(packHalfBlockArt(['00', '00'])).toEqual(['  '])
  })

  it('pairs an odd trailing row with an implicit dark row', () => {
    expect(packHalfBlockArt(['1', '0', '1'])).toEqual(['▀', '▀'])
  })

  it('returns no lines for an empty grid', () => {
    expect(packHalfBlockArt([])).toEqual([])
  })

  it('pads a pair to its widest row', () => {
    expect(packHalfBlockArt(['11', ''])).toEqual(['▀▀'])
  })

  it('packs the whale body into the four golden lines', () => {
    expect(packHalfBlockArt(WHALE_PIXELS)).toEqual([
      '    ▄▄▄▄▄▄▄▄▄   ',
      '  ▄▄█▀████▀█▄▄  ',
      '   ██████████   ',
      '   ▀▀▀▀▀▀▀▀▀▀   ',
    ])
  })

  it('keeps every packed body line sixteen columns wide', () => {
    for (const line of packHalfBlockArt(WHALE_PIXELS)) {
      expect(line).toHaveLength(16)
    }
  })

  it('composes the logo as the text spray above the packed body', () => {
    expect(WHALE_ART).toEqual([
      '      ·  .  ·   ',
      '        .·.     ',
      '    ▄▄▄▄▄▄▄▄▄   ',
      '  ▄▄█▀████▀█▄▄  ',
      '   ██████████   ',
      '   ▀▀▀▀▀▀▀▀▀▀   ',
    ])
  })
})
