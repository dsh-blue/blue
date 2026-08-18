/**
 * The ANSI text helpers: width measurement (ASCII/CJK/emoji/marks/tabs),
 * style-aware word wrapping, truncation, and one-line ellipsizing.
 */

import { describe, expect, it } from 'vitest'
import { ellipsize, graphemeWidth, truncateToWidth, visibleWidth, wrapStyledText } from '../src/width.ts'

const RED = (text: string): string => `\x1b[38;2;255;0;0m${text}\x1b[39m`

describe('visibleWidth', () => {
  it('measures plain ASCII', () => {
    expect(visibleWidth('hello')).toBe(5)
    expect(visibleWidth('')).toBe(0)
  })

  it('ignores SGR sequences', () => {
    expect(visibleWidth(RED('hi'))).toBe(2)
  })

  it('counts CJK and emoji as two columns, marks as zero', () => {
    expect(visibleWidth('你好')).toBe(4)
    expect(visibleWidth('á')).toBe(1)
    expect(graphemeWidth('😀')).toBe(2)
  })

  it('counts tabs as three columns', () => {
    expect(visibleWidth('\t')).toBe(3)
    expect(graphemeWidth('\t')).toBe(3)
  })
})

describe('wrapStyledText', () => {
  it('returns short lines untouched, one per input line', () => {
    expect(wrapStyledText('abc\ndef', 10)).toEqual(['abc', 'def'])
  })

  it('returns one empty line for empty text', () => {
    expect(wrapStyledText('', 10)).toEqual([''])
  })

  it('word-wraps at spaces', () => {
    expect(wrapStyledText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
  })

  it('drops whitespace at line starts and wrap points', () => {
    expect(wrapStyledText('aaaa bbb', 4)).toEqual(['aaaa', 'bbb'])
  })

  it('hard-breaks over-wide words', () => {
    expect(wrapStyledText('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })

  it('wraps between CJK cells without spaces', () => {
    expect(wrapStyledText('你好世界啊', 4)).toEqual(['你好', '世界', '啊'])
  })

  it('mixes CJK cells into word wrapping', () => {
    expect(wrapStyledText('ab 你 cd', 4)).toEqual(['ab', '你', 'cd'])
  })

  it('keeps styles intact on unwrapped styled lines', () => {
    expect(wrapStyledText(RED('hi'), 10)).toEqual([RED('hi')])
  })

  it('closes and reopens styles across soft wraps', () => {
    const wrapped = wrapStyledText(RED('aaa bbb'), 4)
    expect(wrapped).toHaveLength(2)
    expect(wrapped[0]).toBe('\x1b[38;2;255;0;0maaa\x1b[0m')
    expect(wrapped[1]).toBe('\x1b[38;2;255;0;0mbbb\x1b[39m')
    for (const line of wrapped) expect(visibleWidth(line)).toBeLessThanOrEqual(4)
  })

  it('closes and reopens styles across hard breaks', () => {
    const wrapped = wrapStyledText(RED('abcdef'), 3)
    expect(wrapped).toHaveLength(2)
    expect(wrapped[0]).toBe('\x1b[38;2;255;0;0mabc\x1b[0m')
    expect(wrapped[1]).toBe('\x1b[38;2;255;0;0mdef\x1b[39m')
  })

  it('tracks bold open/close pairs', () => {
    const bold = (text: string): string => `\x1b[1m${text}\x1b[22m`
    const wrapped = wrapStyledText(bold('aaa bbb'), 4)
    expect(wrapped[0]).toBe('\x1b[1maaa\x1b[0m')
    expect(wrapped[1]).toBe('\x1b[1mbbb\x1b[22m')
  })

  it('clamps zero width to one column', () => {
    expect(wrapStyledText('ab', 0)).toEqual(['a', 'b'])
  })

  it('resets all tracked styles on a bare SGR reset', () => {
    expect(wrapStyledText('\x1b[maaa bbb', 4)).toEqual(['\x1b[maaa', 'bbb'])
  })

  it('tolerates a closer with no matching opener', () => {
    expect(wrapStyledText('aaaa bbb\x1b[39m', 4)).toEqual(['aaaa', 'bbb\x1b[39m'])
  })

  it('attaches zero-width mark tokens to the current line', () => {
    expect(wrapStyledText('aaaaa ́́ bbbbb', 5)).toEqual(['aaaaá́', 'bbbbb'])
  })

  it('pushes pending content before hard-breaking an over-wide word', () => {
    expect(wrapStyledText('xy abcdef', 3)).toEqual(['xy', 'abc', 'def'])
  })

  it('drops leading spaces when the line needs wrapping', () => {
    expect(wrapStyledText('  aaaa bbbb', 4)).toEqual(['aaaa', 'bbbb'])
  })

  it('skips whitespace-only over-wide lines', () => {
    expect(wrapStyledText('ok\n     \nfine', 2)).toEqual(['ok', 'fi', 'ne'])
  })

  it('returns one empty line when every line collapses away', () => {
    expect(wrapStyledText('   ', 2)).toEqual([''])
  })
})

describe('truncateToWidth', () => {
  it('returns fitting text untouched', () => {
    expect(truncateToWidth('abc', 3)).toBe('abc')
  })

  it('truncates with an ellipsis within the width', () => {
    const out = truncateToWidth('abcdef', 4)
    expect(out).toBe('abc…')
    expect(visibleWidth(out)).toBeLessThanOrEqual(4)
  })

  it('closes styles left open by the cut', () => {
    const out = truncateToWidth(RED('abcdef'), 4)
    expect(out).toBe('\x1b[38;2;255;0;0mabc\x1b[0m…')
  })

  it('truncates CJK by cell width', () => {
    expect(truncateToWidth('你好世界', 5)).toBe('你好…')
  })
})

describe('ellipsize', () => {
  it('collapses whitespace and trims', () => {
    expect(ellipsize('  a\nb\tc  ', 20)).toBe('a b c')
  })

  it('ellipsizes beyond the limit', () => {
    const out = ellipsize('x'.repeat(50), 10)
    expect(out).toBe(`${'x'.repeat(9)}…`)
  })
})
