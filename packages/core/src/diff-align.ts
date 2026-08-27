/**
 * Line alignment for inline diff panels. The official `FileDiff` presentation
 * carries whole-text `oldText`/`newText` pairs (per-hunk, with the context
 * lines duplicated on both sides); this module re-derives the line-level
 * `ctx`/`del`/`add` alignment a unified panel needs — dependency-free, with a
 * prefix/suffix trim that absorbs the presenter's duplicated context, an LCS
 * core for the small middle, and a size guard that degrades oversized inputs
 * to whole-block removal plus addition instead of an unbounded DP table.
 *
 * @module @dsh-blue/blue-core/diff-align
 */

import type { BlueSemanticColors } from './types.ts'

/** One aligned line: unchanged on both sides, removed, or added. */
export type DiffOp =
  | { readonly type: 'ctx'; readonly text: string }
  | { readonly type: 'del'; readonly text: string }
  | { readonly type: 'add'; readonly text: string }

/** Either middle side above this many lines skips the LCS and renders as whole blocks. */
export const DIFF_ALIGN_MAX_ROWS = 1200

/** Context rows kept at each edge of a long unchanged run before eliding the middle. */
export const CTX_EDGE_ROWS = 3

/** The palette slice a diff panel paints with. */
export type DiffPaintColors = Pick<BlueSemanticColors, 'diffAdded' | 'diffRemoved' | 'diffMeta'>

/** Split whole-file text into lines; a trailing terminator adds no empty line. */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Align two whole texts line by line.
 * @param before - the prior text (an empty string aligns as pure additions).
 * @param after - the updated text (an empty string aligns as pure removals).
 * @returns the aligned ops in order — context lines appear once, removals
 *   before additions within a change, and inputs whose changed middle
 *   exceeds {@link DIFF_ALIGN_MAX_ROWS} degrade to whole-block del+add.
 */
export function alignDiffLines(before: string, after: string): readonly DiffOp[] {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)
  if (beforeLines.length === 0) return afterLines.map(text => ({ type: 'add', text }))
  if (afterLines.length === 0) return beforeLines.map(text => ({ type: 'del', text }))

  let start = 0
  const maxStart = Math.min(beforeLines.length, afterLines.length)
  while (start < maxStart && beforeLines[start] === afterLines[start]) start += 1
  let endBefore = beforeLines.length
  let endAfter = afterLines.length
  while (endBefore > start && endAfter > start && beforeLines[endBefore - 1] === afterLines[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }

  const ops: DiffOp[] = []
  for (let index = 0; index < start; index += 1) ops.push({ type: 'ctx', text: beforeLines[index]! })
  const midBefore = beforeLines.slice(start, endBefore)
  const midAfter = afterLines.slice(start, endAfter)
  if (midBefore.length > DIFF_ALIGN_MAX_ROWS || midAfter.length > DIFF_ALIGN_MAX_ROWS) {
    for (const text of midBefore) ops.push({ type: 'del', text })
    for (const text of midAfter) ops.push({ type: 'add', text })
  } else {
    ops.push(...lcsOps(midBefore, midAfter))
  }
  for (let index = endBefore; index < beforeLines.length; index += 1) ops.push({ type: 'ctx', text: beforeLines[index]! })
  return ops
}

/** Classic LCS table walk over the trimmed middle; removals lead additions. */
function lcsOps(before: readonly string[], after: readonly string[]): DiffOp[] {
  const width = after.length + 1
  const table = new Uint32Array((before.length + 1) * width)
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + (j + 1)]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + (j + 1)]!)
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      ops.push({ type: 'ctx', text: before[i]! })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j]! >= table[i * width + (j + 1)]!) {
      ops.push({ type: 'del', text: before[i]! })
      i += 1
    } else {
      ops.push({ type: 'add', text: after[j]! })
      j += 1
    }
  }
  for (; i < before.length; i += 1) ops.push({ type: 'del', text: before[i]! })
  for (; j < after.length; j += 1) ops.push({ type: 'add', text: after[j]! })
  return ops
}

/**
 * Count the added and removed lines of one alignment.
 * @param before - the prior text.
 * @param after - the updated text.
 * @returns exact counts for aligned inputs; block counts for guarded ones.
 */
export function diffChangeCounts(before: string, after: string): { readonly added: number; readonly removed: number } {
  let added = 0
  let removed = 0
  for (const op of alignDiffLines(before, after)) {
    if (op.type === 'add') added += 1
    else if (op.type === 'del') removed += 1
  }
  return { added, removed }
}

/**
 * Paint aligned ops as terminal rows: `  context`, `- removed`, `+ added`,
 * with a long unchanged run elided to its edges around a
 * `⋯ N unchanged lines` marker.
 * @param ops - the alignment to paint.
 * @param colors - the diff palette; omitted yields uncolored rows.
 * @returns one row per kept line, coloring only the removed/added/marker rows.
 */
export function paintDiffRows(ops: readonly DiffOp[], colors?: DiffPaintColors): string[] {
  const rows: string[] = []
  let ctxRun: string[] = []
  const flushCtx = (): void => {
    if (ctxRun.length === 0) return
    if (ctxRun.length <= CTX_EDGE_ROWS * 2) {
      rows.push(...ctxRun)
    } else {
      rows.push(...ctxRun.slice(0, CTX_EDGE_ROWS))
      const marker = `⋯ ${String(ctxRun.length - CTX_EDGE_ROWS * 2)} unchanged lines`
      rows.push(colors === undefined ? marker : colors.diffMeta(marker))
      rows.push(...ctxRun.slice(-CTX_EDGE_ROWS))
    }
    ctxRun = []
  }
  for (const op of ops) {
    if (op.type === 'ctx') {
      ctxRun.push(`  ${op.text}`)
      continue
    }
    flushCtx()
    if (op.type === 'del') rows.push(colors === undefined ? `- ${op.text}` : colors.diffRemoved(`- ${op.text}`))
    else rows.push(colors === undefined ? `+ ${op.text}` : colors.diffAdded(`+ ${op.text}`))
  }
  flushCtx()
  return rows
}
