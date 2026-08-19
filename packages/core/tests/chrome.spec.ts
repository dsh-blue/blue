/**
 * The chrome helper layer: the `withSideBorders` / `injectPromptSymbol`
 * pure functions over representative row shapes — plain rules, pre-painted
 * rules, scroll indicators, content rows with and without SGR at the
 * outermost columns — plus the S12 dialog frame (`framePanel` / `hintRow`)
 * over its branch matrix: titles, hints, footers, and paints.
 */

import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { framePanel, hintRow, injectPromptSymbol, withSideBorders } from '../src/chrome.ts'

/** Identity paint keeps assertions readable; the functions never repaint text. */
const plain = (text: string): string => text

describe('withSideBorders', () => {
  it('boxes plain rules into rounded corners', () => {
    const boxed = withSideBorders(
      ['────', '  x  ', '────'],
      plain,
    )
    expect(boxed).toEqual(['╭──╮', '│ x │', '╰──╯'])
  })

  it('repaints pre-painted rules as one span and strips the old SGR', () => {
    const boxed = withSideBorders(
      ['\x1b[38;2;1;2;3m────\x1b[0m', '    '],
      text => `[${text}]`,
    )
    expect(boxed[0]).toBe('[╭──╮]')
    expect(boxed[1]).toBe('[│]  [│]')
  })

  it('draws connected corners on top when a panel sits above', () => {
    const boxed = withSideBorders(['──', '  '], plain, { connectedAbove: true })
    expect(boxed).toEqual(['├┤', '││'])
  })

  it('lays a fitting label into the top rule only', () => {
    const label = '\x1b[38;5;99mtag\x1b[0m'
    const boxed = withSideBorders(
      ['─'.repeat(10), ' '.repeat(10), '─'.repeat(10)],
      plain,
      { label },
    )
    // The label's visible width is 3, leaving five of the eight dashes.
    expect(boxed[0]).toBe(`╭${label}─────╮`)
    expect(boxed[2]).toBe(`╰${'─'.repeat(8)}╯`)
  })

  it('drops an oversized label instead of overflowing the rule', () => {
    const boxed = withSideBorders(['────', '    '], plain, { label: 'too wide' })
    expect(boxed[0]).toBe('╭──╮')
  })

  it('never labels a scroll-indicator rule', () => {
    // `── ↑ 2 more ──` keeps its text; the label is skipped because the
    // middle is not a pure dash run.
    const boxed = withSideBorders(
      [`── ↑ 2 more ${'─'.repeat(2)}`, '  ', '─'.repeat(12)],
      plain,
      { label: '\x1b[38;5;99mtag\x1b[0m' },
    )
    expect(boxed[0]).toBe(`╭─ ↑ 2 more ─╮`)
    expect(boxed[2]).toBe(`╰${'─'.repeat(10)}╯`)
  })

  it('renders a lone dash row as a single corner cell', () => {
    expect(withSideBorders(['─'], plain)).toEqual(['╭'])
  })

  it('keeps empty rows and overlays bars only on literal outer spaces', () => {
    const boxed = withSideBorders(
      [
        '─────',
        '',
        '     ',
        ' ',
        'x   ',
        '  x\x1b[7m \x1b[0m',
      ],
      text => `[${text}]`,
    )
    expect(boxed[1]).toBe('')
    // A single-space row collapses to its bar.
    expect(boxed[3]).toBe('[│]')
    // A non-space first cell keeps its byte: the head bar is skipped, the
    // trailing-space tail still lands.
    expect(boxed[4]).toBe('x  [│]')
    // An SGR-tagged last cell (the inverse-video cursor) blocks the tail
    // bar while its escape sequence survives the head-side slice intact.
    expect(boxed[5]).toBe('[│] x\x1b[7m \x1b[0m')
  })
})

describe('injectPromptSymbol', () => {
  it('overlays the symbol at column 2 of a padded row', () => {
    expect(injectPromptSymbol('    rest', '>')).toBe('  > rest')
  })

  it('paints the symbol through the injected color function', () => {
    expect(injectPromptSymbol('    x', '!', text => `«b:${text}»`)).toBe('  «b:!» x')
  })

  it('declines rows shorter than the padding or with content in it', () => {
    expect(injectPromptSymbol('   ', '>')).toBeUndefined()
    expect(injectPromptSymbol('  x ', '>')).toBeUndefined()
    expect(injectPromptSymbol('x   ', '>')).toBeUndefined()
  })
})

describe('hintRow', () => {
  it('joins the parts with dot separators and indents the row', () => {
    expect(hintRow(['↑/↓ select', '1-4 choose', '↵ confirm'], plain))
      .toBe('  ↑/↓ select · 1-4 choose · ↵ confirm')
  })

  it('paints the whole row through the injected color function', () => {
    expect(hintRow(['a', 'b'], text => `[${text}]`)).toBe('[  a · b]')
  })

  it('renders a single part with no trailing separator', () => {
    expect(hintRow(['esc cancel'], plain)).toBe('  esc cancel')
  })
})

describe('framePanel', () => {
  it('frames the body with rules spanning the render width', () => {
    const framed = framePanel(['  body'], 12, { title: 'T' })
    expect(framed).toEqual(['─'.repeat(12), 'T', '  body', '─'.repeat(12)])
  })

  it('renders without a title or footer', () => {
    expect(framePanel(['x'], 4)).toEqual(['────', 'x', '────'])
  })

  it('appends the title hint on the title line with its own paint', () => {
    const framed = framePanel([], 20, {
      title: 'help',
      titlePaint: text => `<${text}>`,
      titleHint: '· Esc close',
      hintPaint: text => `~${text}~`,
    })
    expect(framed[1]).toBe('<help> ~· Esc close~')
  })

  it('renders the footer above the bottom rule through its paint', () => {
    const framed = framePanel([''], 20, {
      footer: ['esc cancel', '↵ resume'],
      footerPaint: text => `_${text}_`,
    })
    expect(framed).toEqual(['─'.repeat(20), '', '_  esc cancel · ↵ resume_', '─'.repeat(20)])
  })

  it('skips the footer when the parts list is empty', () => {
    expect(framePanel([''], 4, { footer: [] })).toEqual(['────', '', '────'])
  })

  it('defaults the footer and rule paints to identity', () => {
    // No paints injected: the footer row and rules render unstyled.
    expect(framePanel([''], 4, { footer: ['a', 'b'] })).toEqual(['────', '', '  a · b', '────'])
  })

  it('repaints the rules through the injected paint', () => {
    const framed = framePanel([], 4, { rulePaint: text => `%${text}%` })
    expect(framed).toEqual(['%────%', '%────%'])
  })

  it('truncates an over-long title with styled hint to the width', () => {
    const framed = framePanel([], 10, {
      title: 'ab'.repeat(8),
      titleHint: 'cd'.repeat(8),
    })
    // pi-tui truncation keeps SGR resets in the string; the visible width
    // is what must never exceed the frame.
    expect(visibleWidth(framed[1] ?? '')).toBe(10)
  })

  it('keeps a narrow width at least one column', () => {
    expect(framePanel([], 0)).toEqual(['─', '─'])
  })
})
