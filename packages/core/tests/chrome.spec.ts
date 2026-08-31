/**
 * The chrome helper layer: the `withSideBorders` / `injectPromptSymbol`
 * pure functions over representative row shapes — plain rules, pre-painted
 * rules, scroll indicators, content rows with and without SGR at the
 * outermost columns — plus the S12 dialog frame (`framePanel` / `hintRow`),
 * the S13 panel chrome (`topRule` / `padColumns`), and the S14 completion
 * polish (`highlightLeadingSlashToken` / `injectGhostHint`) over their
 * branch matrices: titles, hints, footers, paints, gutter indentation,
 * token bounds, and ghost-room accounting.
 */

import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import {
  framePanel,
  highlightLeadingSlashToken,
  hintRow,
  injectGhostHint,
  injectPromptSymbol,
  padColumns,
  topRule,
  withSideBorders,
} from '../src/chrome.ts'

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
    // The title line sits indented two columns (the kimi dialog look).
    expect(framed).toEqual(['─'.repeat(12), '  T', '  body', '─'.repeat(12)])
  })

  it('renders without a title or footer', () => {
    expect(framePanel(['x'], 4)).toEqual(['────', 'x', '────'])
  })

  it('appends the title hint on the title line with its own paint', () => {
    const framed = framePanel([], 30, {
      title: 'help',
      titlePaint: text => `<${text}>`,
      titleHint: '· Esc close',
      hintPaint: text => `~${text}~`,
    })
    // `  help · Esc close` — the indent sits inside the title paint, the
    // hint joins after a single space (callers lead it with `· `).
    expect(framed[1]).toBe('<  help> ~· Esc close~')
  })

  it('clips an over-wide footer row to the panel width', () => {
    const lines = framePanel(['body'], 12, {
      footer: ['esc cancel', 'enter resume', 'f6 next surface'],
      footerPaint: text => text,
    })
    expect(lines[2]).toBe('  esc can\u001b[0m...\u001b[0m')
    expect(lines).toHaveLength(4)
  })

  it('renders the footer above the bottom rule through its paint', () => {
    const framed = framePanel([''], 20, {
      footer: ['esc cancel', '↵ resume'],
      footerPaint: text => `_${text}_`,
    })
    // The joined row (22 wide) clips to the 20-column rule, paint and all.
    expect(framed).toEqual(['─'.repeat(20), '', '_  esc cancel · ↵\u001b[0m...\u001b[0m', '─'.repeat(20)])
  })

  it('skips the footer when the parts list is empty', () => {
    expect(framePanel([''], 4, { footer: [] })).toEqual(['────', '', '────'])
  })

  it('defaults the footer and rule paints to identity', () => {
    // No paints injected: the footer row and rules render unstyled.
    expect(framePanel([''], 4, { footer: ['a', 'b'] })).toEqual(['────', '', ' \u001b[0m...\u001b[0m', '────'])
  })

  it('repaints the rules through the injected paint, clamped to the width', () => {
    // The rule repeats the width first and paints after, so a paint whose
    // literals add columns reads past the frame — the D48 backstop cuts it
    // (the paint still lands: the marker survives the cut).
    const framed = framePanel([], 6, { rulePaint: text => `%${text}%` })
    expect(framed).toEqual(['%──\x1b[0m...\x1b[0m', '%──\x1b[0m...\x1b[0m'])
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

describe('topRule', () => {
  it('renders the kimi in-border title with a joiner and dash fill', () => {
    // `╭ BTW ─ Esc close · ↑↓ scroll ╮` — the title, the `─ ` joiner, and
    // the hint each paint separately, with the fill taking the remainder.
    expect(topRule(32, { title: ' BTW ', hint: 'Esc close · ↑↓ scroll ' })).toBe(
      '╭ BTW ─ Esc close · ↑↓ scroll ─╮',
    )
  })

  it('omits the joiner when only one of title and hint is present', () => {
    expect(topRule(10, { title: ' Todo ' })).toBe('╭ Todo ──╮')
    expect(topRule(10, { hint: 'ctrl+t ' })).toBe('╭ctrl+t ─╮')
  })

  it('renders a plain rule when neither title nor hint is present', () => {
    expect(topRule(6)).toBe('╭' + '────' + '╮')
  })

  it('paints the title, hint, and chrome separately', () => {
    const row = topRule(30, {
      title: ' BTW ',
      titlePaint: text => `<${text}>`,
      hint: 'Esc close ',
      hintPaint: text => `~${text}~`,
      paint: text => `%${text}%`,
    })
    expect(row).toBe('%╭%< BTW >%─ %~Esc close ~' + '%─────%' + '%╮%')
  })

  it('defaults the paints to identity', () => {
    // `' t ' + '─ ' + ' h '` joins with a double space in the middle — the
    // literal `╭ t ─  h ──╮` shape is the joiner plus the hint's lead space.
    expect(topRule(12, { title: ' t ', hint: ' h ' })).toBe('╭ t ─  h ──╮')
  })

  it('clips an over-long composite to the inner width, ANSI-safe', () => {
    const row = topRule(10, {
      title: 'ab'.repeat(8),
      titlePaint: text => `\x1b[1m${text}\x1b[22m`,
      hint: 'cd'.repeat(8),
    })
    // The composite is clipped with no ellipsis; the visible width never
    // exceeds the inner width, no SGR is cut mid-sequence, and the clip
    // appends a closing reset (pi-tui behavior) so the fill stays clean.
    expect(visibleWidth(row)).toBe(10)
    expect(row).toContain('\x1b[0m')
    expect(row).not.toContain('\x1b[22mcd')
  })

  it('truncates an overflowing composite with no dash fill left', () => {
    // ' BTW ─ Esc close · ↑↓ scroll ' is 29 wide at inner width 28: the
    // trailing space is dropped and the reset appended.
    expect(topRule(30, { title: ' BTW ', hint: 'Esc close · ↑↓ scroll ' })).toBe(
      '╭ BTW ─ Esc close · ↑↓ scroll\x1b[0m╮',
    )
  })

  it('exactly fits a composite title with no dash fill', () => {
    expect(topRule(10, { title: ' t ', hint: ' h ' })).toBe('╭ t ─  h ╮')
  })

  it('keeps a degenerate width at one inner column', () => {
    // width 0-1: the inner width clamps to one; the corners still render.
    expect(visibleWidth(topRule(0, { title: 'x' }))).toBe(3)
    expect(visibleWidth(topRule(1))).toBe(3)
  })
})

describe('padColumns', () => {
  it('prefixes every row with the gutter', () => {
    expect(padColumns(['a', 'bc'], 1)).toEqual([' a', ' bc'])
    expect(padColumns(['a'], 2)).toEqual(['  a'])
  })

  it('passes rows through unchanged at a zero gutter', () => {
    expect(padColumns(['a', ''], 0)).toEqual(['a', ''])
  })

  it('handles an empty input', () => {
    expect(padColumns([], 1)).toEqual([])
  })

  it('leaves styled rows intact', () => {
    expect(padColumns(['\x1b[1mab\x1b[22m'], 1)).toEqual([' \x1b[1mab\x1b[22m'])
  })
})

// oxlint-disable-next-line no-control-regex -- the inverse-video cursor is a raw SGR sequence
const CURSOR_BLOCK = '\x1b[7m \x1b[0m'

describe('highlightLeadingSlashToken', () => {
  it('paints the leading /command token and leaves the rest of the row alone', () => {
    expect(highlightLeadingSlashToken('    /btw rest', text => `[${text}]`)).toBe('    [/btw] rest')
  })

  it('paints a token that runs to the end of the row', () => {
    expect(highlightLeadingSlashToken('  /sessions', plain)).toBe('  /sessions')
  })

  it('wraps only the visible token when the row carries the cursor block', () => {
    // The inverse-video cursor parks after `/btw`; the paint wraps the four
    // token characters and the cursor's escape rides through untouched.
    expect(highlightLeadingSlashToken(`    /btw${CURSOR_BLOCK}`, text => `<${text}>`))
      .toBe(`    </btw>${CURSOR_BLOCK}`)
  })

  it('paints a token that straddles the inverse-video cursor mid-word', () => {
    // A focused editor replaces the grapheme under the caret with the
    // inverse-video grapheme; the visible-index walk crosses those SGR runs
    // and the paint wraps the raw slice around them.
    const row = '  /b\x1b[7mt\x1b[0mw end'
    expect(highlightLeadingSlashToken(row, text => `[${text}]`)).toBe('  [/b\x1b[7mt\x1b[0mw] end')
  })

  it('declines a mid-sentence slash (not the first non-whitespace character)', () => {
    expect(highlightLeadingSlashToken('  run /btw', plain)).toBeUndefined()
  })

  it('declines a token containing a second slash (a path)', () => {
    expect(highlightLeadingSlashToken('  /usr/bin', plain)).toBeUndefined()
  })

  it('declines rows without a slash', () => {
    expect(highlightLeadingSlashToken('  plain text', plain)).toBeUndefined()
  })
})

describe('injectGhostHint', () => {
  it('splices the ghost after the cursor block and preserves the row width', () => {
    // width 24, text `/btw` (4): contentWidth 16, room 11 — ` <question>`
    // fits exactly and the trailing padding shrinks to keep the row's
    // unpainted width (the bracket paint here adds 2 visible columns; a
    // zero-width SGR paint would keep 24).
    const row = `    /btw${CURSOR_BLOCK}${' '.repeat(15)}`
    const ghosted = injectGhostHint(row, ' <question>', 4, 24, text => `[${text}]`)
    expect(ghosted).toBe(`    /btw${CURSOR_BLOCK}[ <question>]${' '.repeat(4)}`)
    expect(visibleWidth(ghosted)).toBe(26)
  })

  it('ellipsizes the ghost when the room runs short', () => {
    // width 20, text 4: room 7 — the hint clips to ` <ques…`.
    const row = `    /btw${CURSOR_BLOCK}${' '.repeat(11)}`
    const ghosted = injectGhostHint(row, ' <question>', 4, 20, plain)
    expect(ghosted).toBe(`    /btw${CURSOR_BLOCK} <ques…${' '.repeat(4)}`)
    expect(visibleWidth(ghosted)).toBe(20)
  })

  it('reduces the ghost to a lone ellipsis when a single column remains', () => {
    // width 14, text 4, cursor 1: room 1 — the hint clips to bare `…`.
    const row = `    /btw${CURSOR_BLOCK}${' '.repeat(5)}`
    const ghosted = injectGhostHint(row, ' <q>', 4, 14, plain)
    expect(ghosted).toBe(`    /btw${CURSOR_BLOCK}…${' '.repeat(4)}`)
    expect(visibleWidth(ghosted)).toBe(14)
  })

  it('returns the row unchanged when there is no room at all', () => {
    const row = `    /btw${CURSOR_BLOCK}${' '.repeat(3)}`
    expect(injectGhostHint(row, ' <q>', 4, 12, plain)).toBe(row)
  })

  it('declines while the cursor sits mid-text', () => {
    // The cursor block before a real character means the caret is not at
    // the end of the input; the ghost belongs only after the text.
    const row = `    /bt${CURSOR_BLOCK}w${' '.repeat(14)}`
    expect(injectGhostHint(row, ' <q>', 4, 24, plain)).toBe(row)
  })

  it('falls back to the padding position when no cursor block renders', () => {
    // An unfocused editor renders no cursor; the ghost lands at the
    // content-end column instead.
    const row = `    /btw${' '.repeat(12)}`
    const ghosted = injectGhostHint(row, ' <q>', 4, 20, text => `[${text}]`)
    expect(ghosted).toBe(`    /btw[ <q>]${' '.repeat(8)}`)
    // Unpainted width 20; the bracket paint again adds its 2 columns.
    expect(visibleWidth(ghosted)).toBe(22)
  })
})
