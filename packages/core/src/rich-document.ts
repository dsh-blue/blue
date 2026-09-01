/**
 * Rich Markdown segmentation and bounded Mermaid-to-terminal rendering.
 *
 * @module @dsh-blue/blue-core/rich-document
 */

import { renderMermaidASCII, type AsciiRenderOptions } from 'beautiful-mermaid'
import { visibleWidth } from '@earendil-works/pi-tui'

export const MERMAID_MAX_SOURCE_BYTES = 8 * 1024
export const MERMAID_MAX_NON_EMPTY_LINES = 100
export const MERMAID_MAX_OUTPUT_LINES = 200
export const MERMAID_MAX_OUTPUT_CELLS = 20_000

export type RichDocumentSegment =
  | { readonly kind: 'markdown', readonly source: string }
  | { readonly kind: 'mermaid', readonly source: string, readonly fallback: string }

interface OpenFence {
  readonly marker: '`' | '~'
  readonly length: number
  readonly indent: number
  readonly start: number
  readonly contentStart: number
  readonly mermaid: boolean
}

function sourceLines(source: string): readonly { readonly start: number, readonly end: number, readonly text: string }[] {
  const lines: Array<{ start: number, end: number, text: string }> = []
  let start = 0
  while (start < source.length) {
    const newline = source.indexOf('\n', start)
    const end = newline === -1 ? source.length : newline + 1
    const raw = source.slice(start, newline === -1 ? end : newline)
    lines.push({ start, end, text: raw.endsWith('\r') ? raw.slice(0, -1) : raw })
    start = end
  }
  return lines
}

/** Split only closed, top-level Mermaid fences; incomplete streamed fences remain Markdown. */
export function splitRichDocument(source: string): readonly RichDocumentSegment[] {
  let fence: OpenFence | undefined
  let cursor = 0
  const segments: RichDocumentSegment[] = []
  for (const line of sourceLines(source)) {
    if (fence === undefined) {
      const match = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/u.exec(line.text)
      if (match === null) continue
      const run = match[2]!
      const info = match[3]!.trim().toLowerCase()
      fence = {
        marker: run[0] as '`' | '~',
        length: run.length,
        indent: match[1]!.length,
        start: line.start,
        contentStart: line.end,
        mermaid: info === 'mermaid',
      }
      continue
    }
    const close = new RegExp(`^ {0,3}${fence.marker === '`' ? '`' : '~'}{${String(fence.length)},}[ \\t]*$`, 'u')
    if (!close.test(line.text)) continue
    if (fence.mermaid) {
      if (fence.start > cursor) segments.push({ kind: 'markdown', source: source.slice(cursor, fence.start) })
      const fencedSource = source.slice(fence.contentStart, line.start).replace(/\r?\n$/u, '')
      segments.push({
        kind: 'mermaid',
        source: fence.indent === 0
          ? fencedSource
          : fencedSource.replace(new RegExp(`^ {0,${String(fence.indent)}}`, 'gmu'), ''),
        fallback: source.slice(fence.start, line.end),
      })
      cursor = line.end
    }
    fence = undefined
  }
  if (cursor < source.length) segments.push({ kind: 'markdown', source: source.slice(cursor) })
  return segments.length === 0 ? [{ kind: 'markdown', source }] : segments
}

function normalizedRows(output: string): string[] {
  const rows = output.replaceAll('\r\n', '\n').split('\n')
  while (rows.length > 0 && rows.at(-1) === '') rows.pop()
  return rows
}

function renderAttempt(source: string, width: number, options: AsciiRenderOptions): string[] | undefined {
  try {
    // beautiful-mermaid 1.1.3 documents the standard one-line flowchart form
    // but rejects a semicolon immediately after the header. Normalize only
    // that delimiter; all diagram parsing remains library-owned.
    const compatibleSource = source.replace(/^( {0,3}(?:graph|flowchart)[ \t]+(?:TD|TB|LR|BT|RL));[ \t]*/iu, '$1\n')
    const rows = normalizedRows(renderMermaidASCII(compatibleSource, options))
    if (rows.length === 0 || rows.length > MERMAID_MAX_OUTPUT_LINES) return undefined
    let cells = 0
    for (const row of rows) {
      const rowWidth = visibleWidth(row)
      if (rowWidth > width) return undefined
      cells += rowWidth
      if (cells > MERMAID_MAX_OUTPUT_CELLS) return undefined
    }
    return rows
  } catch {
    return undefined
  }
}

/** Render one Mermaid source without ANSI, or return undefined for the source-fence fallback. */
export function renderMermaidRows(source: string, width: number): string[] | undefined {
  const safeWidth = Math.max(1, Number.isFinite(width) ? Math.floor(width) : 1)
  if (new TextEncoder().encode(source).byteLength > MERMAID_MAX_SOURCE_BYTES) return undefined
  if (source.split(/\r?\n/u).filter(line => line.trim().length > 0).length > MERMAID_MAX_NON_EMPTY_LINES) return undefined
  const plain = renderAttempt(source, safeWidth, { colorMode: 'none' })
  if (plain !== undefined) return plain
  return renderAttempt(source, safeWidth, {
    colorMode: 'none',
    paddingX: 1,
    paddingY: 1,
    boxBorderPadding: 0,
  })
}
