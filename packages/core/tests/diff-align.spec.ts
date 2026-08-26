/**
 * The diff alignment core: fast paths, prefix/suffix trim, LCS interleaving,
 * the oversized-input guard, change counts, and the painted rows with their
 * context-run elision.
 */

import { describe, expect, it } from 'vitest'
import {
  alignDiffLines,
  CTX_EDGE_ROWS,
  diffChangeCounts,
  DIFF_ALIGN_MAX_ROWS,
  paintDiffRows,
} from '../src/diff-align.ts'

const ops = (before: string, after: string): Array<[string, string]> =>
  alignDiffLines(before, after).map(op => [op.type, op.text])

describe('alignDiffLines', () => {
  it('takes the whole-side fast paths', () => {
    expect(ops('', 'a\nb')).toEqual([['add', 'a'], ['add', 'b']])
    expect(ops('a\nb', '')).toEqual([['del', 'a'], ['del', 'b']])
    expect(ops('', '')).toEqual([])
    expect(ops('same\nlines', 'same\nlines')).toEqual([['ctx', 'same'], ['ctx', 'lines']])
  })

  it('treats a trailing terminator as a line ending, not an extra line', () => {
    expect(ops('a\nb\n', 'a\nb')).toEqual([['ctx', 'a'], ['ctx', 'b']])
  })

  it('interleaves a substitution with removals leading additions', () => {
    expect(ops('a\nb\nc', 'a\nx\nc')).toEqual([['ctx', 'a'], ['del', 'b'], ['add', 'x'], ['ctx', 'c']])
    expect(ops('head\n1\n2\ntail', 'head\n1\ntail')).toEqual([['ctx', 'head'], ['ctx', '1'], ['del', '2'], ['ctx', 'tail']])
    expect(ops('head\ntail', 'head\nmid\ntail')).toEqual([['ctx', 'head'], ['add', 'mid'], ['ctx', 'tail']])
  })

  it('aligns interleaved edits through the LCS middle', () => {
    const before = 'keep\none\ntwo\nkeep\nthree\nfour\nkeep'
    const after = 'keep\nuno\nkeep\ntres\nkeep'
    const aligned = ops(before, after)
    expect(aligned.filter(([type]) => type === 'ctx').map(([, text]) => text)).toEqual(['keep', 'keep', 'keep'])
    expect(diffChangeCounts(before, after)).toEqual({ added: 2, removed: 4 })
    // A swap costs one removal and one addition, never a full rewrite.
    expect(diffChangeCounts('a\nb', 'b\na')).toEqual({ added: 1, removed: 1 })
  })

  it('degrades oversized middles to whole blocks instead of an unbounded table', () => {
    const before = Array.from({ length: DIFF_ALIGN_MAX_ROWS + 5 }, (_, index) => `b${String(index)}`).join('\n')
    const after = Array.from({ length: DIFF_ALIGN_MAX_ROWS + 5 }, (_, index) => `a${String(index)}`).join('\n')
    const aligned = alignDiffLines(before, after)
    expect(aligned).toHaveLength((DIFF_ALIGN_MAX_ROWS + 5) * 2)
    expect(aligned[0]).toEqual({ type: 'del', text: 'b0' })
    expect(aligned[DIFF_ALIGN_MAX_ROWS + 5]).toEqual({ type: 'add', text: 'a0' })
    expect(diffChangeCounts(before, after)).toEqual({ added: DIFF_ALIGN_MAX_ROWS + 5, removed: DIFF_ALIGN_MAX_ROWS + 5 })
  })

  it('keeps equal counts for identical and empty-change inputs', () => {
    expect(diffChangeCounts('x', 'x')).toEqual({ added: 0, removed: 0 })
    expect(diffChangeCounts('', '')).toEqual({ added: 0, removed: 0 })
  })
})

describe('paintDiffRows', () => {
  const palette = {
    diffAdded: (text: string): string => `<A>${text}</A>`,
    diffRemoved: (text: string): string => `<R>${text}</R>`,
    diffMeta: (text: string): string => `<M>${text}</M>`,
  }

  it('paints context once and colors removals and additions', () => {
    const aligned = alignDiffLines('a\nb', 'a\nc')
    expect(paintDiffRows(aligned)).toEqual(['  a', '- b', '+ c'])
    expect(paintDiffRows(aligned, palette)).toEqual(['  a', '<R>- b</R>', '<A>+ c</A>'])
  })

  it('elides only genuinely long unchanged runs', () => {
    const ctx = Array.from({ length: CTX_EDGE_ROWS * 2 }, (_, index) => `c${String(index)}`)
    expect(paintDiffRows(ctx.map(text => ({ type: 'ctx' as const, text })))).toHaveLength(CTX_EDGE_ROWS * 2)
    const long = Array.from({ length: CTX_EDGE_ROWS * 2 + 7 }, (_, index) => `l${String(index)}`)
    const rows = paintDiffRows(long.map(text => ({ type: 'ctx' as const, text })), palette)
    expect(rows).toEqual([
      ...long.slice(0, CTX_EDGE_ROWS).map(text => `  ${text}`),
      `<M>⋯ ${String(7)} unchanged lines</M>`,
      ...long.slice(-CTX_EDGE_ROWS).map(text => `  ${text}`),
    ])
    // Elision resets between separate runs around a change.
    const mixed = alignDiffLines('1\n2\n3\nx\n7\n8\n9\n10\n11\n12\n13\n14\n15', '1\n2\n3\ny\n7\n8\n9\n10\n11\n12\n13\n14\n15')
    const painted = paintDiffRows(mixed)
    expect(painted).toContain('- x')
    expect(painted).toContain('+ y')
  })
})
