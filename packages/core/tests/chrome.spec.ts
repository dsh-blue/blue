/**
 * The chrome helper layer: the `withSideBorders` / `injectPromptSymbol`
 * pure functions over representative row shapes — plain rules, pre-painted
 * rules, scroll indicators, content rows with and without SGR at the
 * outermost columns.
 */

import { describe, expect, it } from 'vitest'
import { injectPromptSymbol, withSideBorders } from '../src/chrome.ts'

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
