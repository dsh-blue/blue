/**
 * Minimal Markdown renderer for assistant transcript items: line-based block
 * handling (headings, fenced code, lists, quotes, rules, paragraphs) plus a
 * small inline pass (code spans, bold, links), styled with the semantic
 * color table and hard-wrapped to the viewport width.
 *
 * This is NOT pi-tui's `Markdown` (only `dsh-blue-core` may import pi-tui);
 * it covers the block/inline subset Blue's MVP transcript shows. Streaming
 * text is re-rendered whole on every chunk, so unterminated constructs
 * (open fences, partial emphasis) simply render as plain text until closed.
 *
 * @module @deepseek-ai/dsh-blue-transcript/markdown
 */

import type { BlueSemanticColors } from '@deepseek-ai/dsh-blue-core'
import { wrapStyledText } from './width.ts'

const BOLD_OPEN = '\x1b[1m'
const BOLD_CLOSE = '\x1b[22m'

/** Apply inline styles (code spans, bold, links) to one raw text segment. */
function inline(text: string, colors: BlueSemanticColors): string {
  // Code spans first: their content takes no further styling.
  const parts = text.split(/(`[^`\n]*`)/)
  return parts
    .map((part) => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
        return colors.mdCode(part.slice(1, -1))
      }
      return part
        .replace(/\[([^\[\]\n]*)\]\(([^)\n]*)\)/g, (_match, label: string, url: string) =>
          colors.mdLink(label) + colors.mdLinkUrl(` (${url})`))
        .replace(/\*\*([^*\n]+)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`)
    })
    .join('')
}

/** Wrap one styled logical line to the viewport width. */
function wrapLine(styled: string, width: number, lines: string[]): void {
  for (const line of wrapStyledText(styled, width)) lines.push(line)
}

/**
 * Render Markdown text to styled terminal lines.
 * @param text - the Markdown source (complete or mid-stream).
 * @param width - the maximum visible columns per returned line.
 * @param colors - the semantic color table.
 * @returns one styled string per row, each within `width` visible columns.
 */
export function renderMarkdown(text: string, width: number, colors: BlueSemanticColors): string[] {
  const lines: string[] = []
  let inFence = false

  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      // Code content hard-wraps; it never word-wraps mid-token semantics.
      wrapLine(`  ${colors.mdCodeBlock(raw)}`, width, lines)
      continue
    }

    const headingBody = /^(?:#{1,6})\s+(.*)$/.exec(raw)?.[1]
    if (headingBody !== undefined) {
      wrapLine(colors.mdHeading(`${BOLD_OPEN}${inline(headingBody, colors)}${BOLD_CLOSE}`), width, lines)
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
      lines.push(colors.mdHr('─'.repeat(Math.max(1, width))))
      continue
    }

    const quoteBody = /^>\s?(.*)$/.exec(raw)?.[1]
    if (quoteBody !== undefined) {
      wrapLine(`${colors.mdQuoteBorder('▎')}${colors.mdQuote(inline(quoteBody, colors))}`, width, lines)
      continue
    }

    const listMarker = /^(\s*(?:[-*+]|\d+\.)\s+)/.exec(raw)?.[1]
    if (listMarker !== undefined) {
      const body = raw.slice(listMarker.length)
      wrapLine(`${colors.mdListBullet(listMarker.trimEnd())} ${inline(body, colors)}`, width, lines)
      continue
    }

    wrapLine(inline(raw, colors), width, lines)
  }
  return lines
}
