/**
 * Pure line-level diff: identical texts, pure inserts and deletes, replace
 * runs, empty inputs, trailing-newline handling, exact LCS backtrack
 * sequences on mixed cases, and the count summary.
 */

import { describe, expect, it } from 'vitest'
import { diffLines, summarizeDiffRows } from '../src/line-diff.ts'

describe('diffLines', () => {
  it('returns all context rows for identical texts', () => {
    expect(diffLines('a\nb\nc', 'a\nb\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('emits only added rows for a pure insert', () => {
    expect(diffLines('a\nc', 'a\nb\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('emits only removed rows for a pure delete', () => {
    expect(diffLines('a\nb\nc', 'a\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('orders a replace run removed-first, added-second', () => {
    expect(diffLines('a\nX\nc', 'a\nY\nc')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'X' },
      { kind: 'added', text: 'Y' },
      { kind: 'context', text: 'c' },
    ])
  })

  it('handles empty old and new texts', () => {
    expect(diffLines('', '')).toEqual([])
    expect(diffLines('', 'x')).toEqual([{ kind: 'added', text: 'x' }])
    expect(diffLines('x', '')).toEqual([{ kind: 'removed', text: 'x' }])
  })

  it('drops the trailing empty line a final newline produces', () => {
    // 'a\n' and 'a' are the same one-line file; no phantom added/removed row.
    expect(diffLines('a\n', 'a')).toEqual([{ kind: 'context', text: 'a' }])
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'context', text: 'b' },
    ])
  })

  it('backtracks a mixed case to the exact row sequence', () => {
    const rows = diffLines('1\n2\n3\n4\n5', '1\nthree\n3\n4\nsix')
    expect(rows).toEqual([
      { kind: 'context', text: '1' },
      { kind: 'removed', text: '2' },
      { kind: 'added', text: 'three' },
      { kind: 'context', text: '3' },
      { kind: 'context', text: '4' },
      { kind: 'removed', text: '5' },
      { kind: 'added', text: 'six' },
    ])
  })

  it('keeps all rows of the old tail removed before the new tail adds', () => {
    const rows = diffLines('keep\nold1\nold2', 'keep\nnew1\nnew2\nnew3')
    expect(rows).toEqual([
      { kind: 'context', text: 'keep' },
      { kind: 'removed', text: 'old1' },
      { kind: 'removed', text: 'old2' },
      { kind: 'added', text: 'new1' },
      { kind: 'added', text: 'new2' },
      { kind: 'added', text: 'new3' },
    ])
  })
})

describe('summarizeDiffRows', () => {
  it('counts added and removed rows, context excluded', () => {
    expect(summarizeDiffRows(diffLines('a\nX\nc', 'a\nY\nZ'))).toEqual({ added: 2, removed: 2 })
  })

  it('returns zeros for empty or all-context scripts', () => {
    expect(summarizeDiffRows([])).toEqual({ added: 0, removed: 0 })
    expect(summarizeDiffRows(diffLines('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 })
  })
})
