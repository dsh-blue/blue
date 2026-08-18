/**
 * Unit tests for the interaction text helpers: grapheme splitting, terminal
 * column measurement, and column-budget truncation.
 */

import { describe, expect, it } from 'vitest'
import { graphemes, graphemeWidth, isPrintable, oneLine, truncate, visibleWidth } from '../src/text.ts'

describe('graphemeWidth', () => {
  it('measures ASCII as one column and CJK as two', () => {
    expect(graphemeWidth('a')).toBe(1)
    expect(graphemeWidth('中')).toBe(2)
    expect(graphemeWidth('ｱ')).toBe(1)
  })

  it('measures tabs as three columns, emoji as two, combining marks as zero', () => {
    expect(graphemeWidth('\t')).toBe(3)
    expect(graphemeWidth('🙂')).toBe(2)
    expect(graphemeWidth('́')).toBe(0)
  })
})

describe('visibleWidth', () => {
  it('sums grapheme cells across the string', () => {
    expect(visibleWidth('')).toBe(0)
    expect(visibleWidth('ab中')).toBe(4)
    expect(visibleWidth('你好世界')).toBe(8)
  })
})

describe('truncate', () => {
  it('returns text within the budget untouched', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('中文', 4)).toBe('中文')
  })

  it('cuts with an ellipsis inside the budget', () => {
    expect(truncate('abcde', 3)).toBe('ab…')
    // Wide graphemes count as two columns and are never split mid-cell.
    expect(truncate('中文测试', 5)).toBe('中文…')
    expect(truncate('中文', 2)).toBe('…')
    expect(truncate('abc', 0)).toBe('')
  })
})

describe('graphemes / oneLine / isPrintable', () => {
  it('splits user-perceived characters', () => {
    expect(graphemes('a中')).toEqual(['a', '中'])
  })

  it('flattens line breaks for single-line rendering', () => {
    expect(oneLine('a\nb\r\nc')).toBe('a b c')
  })

  it('rejects control sequences and accepts printable text', () => {
    expect(isPrintable('中')).toBe(true)
    expect(isPrintable('\x1b[D')).toBe(false)
    expect(isPrintable('')).toBe(false)
  })
})
