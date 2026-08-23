/**
 * Pure line-level diff over two texts: the LCS edit script as unified-diff
 * style rows plus a count summary. No terminal, color, or component concerns
 * live here — the diff intent component (`src/intent-diff.ts`) consumes these
 * primitives. The algorithm is the classic dynamic-programming LCS: an
 * O(n·m) table over split lines with a greedy backtrack. That quadratic cost
 * is acceptable because inputs are file contents already capped by the tools'
 * output budgets, and the DP keeps the code compact and obviously correct —
 * no Myers heuristic boundary cases to reason about.

 * @module @dsh-blue/blue-transcript/line-diff
 */

/** One rendered row of a line diff, unified-diff style. */
export interface LineDiffRow {
  /** Row role: unchanged, inserted by the new text, or deleted from the old. */
  kind: 'context' | 'added' | 'removed'
  /** The line text without its newline. */
  text: string
}

/**
 * Split a text into lines: `\n`-separated, with the trailing empty segment a
 * final newline produces dropped (a file ending in a newline has no extra
 * empty last line).
 * @param text - the text to split; '' yields no lines.
 * @returns the lines, in order.
 */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Compute the line-level edit script between two texts as unified-diff style
 * rows: context lines interleaved, and each changed run ordered removed-lines
 * first, added-lines second (the backtrack prefers consuming the old text on
 * LCS ties, which yields exactly that ordering).
 * @param oldText - the before text.
 * @param newText - the after text.
 * @returns the row script, old-to-new.
 */
export function diffLines(oldText: string, newText: string): LineDiffRow[] {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const n = oldLines.length
  const m = newLines.length

  // table[i][j] = LCS length of oldLines[i..] and newLines[j..], built
  // back-to-front so the backtrack below can read it forward.
  const table: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i]![j] = oldLines[i] === newLines[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const rows: LineDiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ kind: 'context', text: oldLines[i]! })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      rows.push({ kind: 'removed', text: oldLines[i]! })
      i += 1
    } else {
      rows.push({ kind: 'added', text: newLines[j]! })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: 'removed', text: oldLines[i]! })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'added', text: newLines[j]! })
    j += 1
  }
  return rows
}

/**
 * Count the added and removed rows of a diff script.
 * @param rows - the rows {@link diffLines} produced.
 * @returns the added and removed line counts (context excluded).
 */
export function summarizeDiffRows(rows: LineDiffRow[]): { added: number, removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'added') added += 1
    else if (row.kind === 'removed') removed += 1
  }
  return { added, removed }
}
