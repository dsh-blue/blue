/**
 * The minimal Markdown renderer: block constructs (headings, fences, lists,
 * quotes, rules, paragraphs) and inline styling (code, bold, links), all
 * wrapped to the viewport width.
 */

import { describe, expect, it } from 'vitest'
import type { BlueSemanticColors } from '@deepseek-ai/dsh-blue-core'
import { renderMarkdown } from '../src/markdown.ts'
import { visibleWidth } from '../src/width.ts'

/** Identity colors: assertions see structure, not escape codes. */
function identityColors(): BlueSemanticColors {
  const id = (text: string): string => text
  return {
    text: id,
    muted: id,
    accent: id,
    border: id,
    success: id,
    error: id,
    warning: id,
    selectedBg: id,
    mdHeading: id,
    mdLink: id,
    mdLinkUrl: id,
    mdCode: id,
    mdCodeBlock: id,
    mdCodeBlockBorder: id,
    mdQuote: id,
    mdQuoteBorder: id,
    mdHr: id,
    mdListBullet: id,
  }
}

/** Colors that tag each role with a letter so styling is assertable. */
function taggedColors(): BlueSemanticColors {
  const colors = identityColors()
  const tag = (role: keyof BlueSemanticColors, letter: string): void => {
    colors[role] = text => `[${letter}]${text}[/${letter}]`
  }
  tag('mdHeading', 'H')
  tag('mdCode', 'C')
  tag('mdCodeBlock', 'B')
  tag('mdLink', 'L')
  tag('mdLinkUrl', 'U')
  tag('mdQuote', 'Q')
  tag('mdQuoteBorder', 'q')
  tag('mdHr', 'R')
  tag('mdListBullet', 'b')
  return colors
}

describe('renderMarkdown', () => {
  it('renders plain paragraphs, wrapped to width', () => {
    expect(renderMarkdown('hello world', 80, identityColors())).toEqual(['hello world'])
    expect(renderMarkdown('aaa bbb ccc', 7, identityColors())).toEqual(['aaa bbb', 'ccc'])
  })

  it('renders headings with the heading color and bold', () => {
    expect(renderMarkdown('# Title', 80, taggedColors())).toEqual(['[H]\x1b[1mTitle\x1b[22m[/H]'])
  })

  it('renders fenced code blocks, hiding the fence markers', () => {
    const out = renderMarkdown('before\n```ts\nconst a = 1\n```\nafter', 80, taggedColors())
    expect(out).toEqual(['before', '  [B]const a = 1[/B]', 'after'])
  })

  it('treats an unterminated fence as code to the end (mid-stream)', () => {
    const out = renderMarkdown('```\ncode line', 80, taggedColors())
    expect(out).toEqual(['  [B]code line[/B]'])
  })

  it('renders unordered and ordered lists with a colored bullet', () => {
    expect(renderMarkdown('- one\n2. two', 80, taggedColors())).toEqual(['[b]-[/b] one', '[b]2.[/b] two'])
  })

  it('renders quotes with a border and quote color', () => {
    expect(renderMarkdown('> cited', 80, taggedColors())).toEqual(['[q]▎[/q][Q]cited[/Q]'])
  })

  it('renders a horizontal rule spanning the width', () => {
    const out = renderMarkdown('---', 10, identityColors())
    expect(out).toEqual(['──────────'])
    expect(visibleWidth(out[0]!)).toBe(10)
  })

  it('renders inline code, bold, and links', () => {
    const out = renderMarkdown('run `pnpm test` **now** see [docs](https://x.dev)', 80, taggedColors())
    expect(out).toEqual(['run [C]pnpm test[/C] \x1b[1mnow\x1b[22m see [L]docs[/L][U] (https://x.dev)[/U]'])
  })

  it('does not style markup inside code spans', () => {
    expect(renderMarkdown('`**not bold**`', 80, taggedColors())).toEqual(['[C]**not bold**[/C]'])
  })

  it('wraps styled lines within the width', () => {
    const out = renderMarkdown('`code` and more words here', 10, taggedColors())
    for (const line of out) expect(visibleWidth(line)).toBeLessThanOrEqual(10)
    expect(out.length).toBeGreaterThan(1)
  })

  it('preserves blank lines between paragraphs', () => {
    expect(renderMarkdown('a\n\nb', 80, identityColors())).toEqual(['a', '', 'b'])
  })
})
