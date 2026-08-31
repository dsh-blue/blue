/**
 * Unit tests for the `InfoPanel` dialog: the framed title, the two-column
 * label/value rows with per-segment styling, the scroll window and its
 * `showing` tail, and the close/scroll key handling (Escape/Enter/`q`
 * close; arrows and PageUp/PageDown scroll).
 */

import { describe, expect, it, vi } from 'vitest'
import { InfoPanel, type InfoSection } from '../src/info-panel.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function sections(count = 3): InfoSection[] {
  return [
    {
      heading: 'Session',
      rows: [
        { label: 'id', segments: [{ text: 'spec-session' }] },
        { label: 'longer label', segments: [
          { text: 'value ' },
          { text: 'dim tail', style: 'muted' },
          { text: ' red tail', style: 'error' },
          { text: ' amber', style: 'warning' },
          { text: ' green', style: 'success' },
        ] },
        ...Array.from({ length: count }, (_, index) => ({
          label: `row-${index}`,
          segments: [{ text: `value ${index}` }],
        })),
      ],
    },
  ]
}

function mount(options: {
  sections?: readonly InfoSection[]
  maxVisible?: number
  t?: (key: string) => string
} = {}): { panel: InfoPanel; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const panel = new InfoPanel({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: new FakeKeymap(),
    title: 'status',
    sections: options.sections ?? sections(),
    ...(options.maxVisible === undefined ? {} : { maxVisible: options.maxVisible }),
    ...(options.t === undefined ? {} : { t: options.t }),
    onClose,
  })
  return { panel, onClose }
}

describe('InfoPanel', () => {
  it('renders a canonical overlay with semantic field spans', () => {
    const { panel } = mount()
    panel.focused = true
    expect(panel.focused).toBe(true)
    const rows = panel.render(80)
    expect(panel.currentNode()).toMatchObject({ kind: 'surface', chrome: 'overlay', title: 'status' })
    expect(rows.join('\n')).toContain('Session')
    expect(rows.join('\n')).toContain('spec-session')
    expect(rows.join('\n')).toContain('dim tail')
    expect(rows.join('\n')).toContain('red tail')
    expect(rows.join('\n')).toContain('green')
  })

  it('translates contextual operation labels when supplied', () => {
    const { panel } = mount({ t: key => `translated:${key}` })
    panel.focused = true
    expect(panel.render(80).join('\n')).toContain('Esc/Enter/q translated:close')
  })

  it('normalizes empty and unlabeled rows while merging adjacent semantic spans', () => {
    const { panel } = mount({
      sections: [
        {
          heading: '',
          rows: [
            { label: '', segments: [] },
            { label: '', segments: [{ text: '', style: 'primary' }, { text: 'primary', style: 'primary' }, { text: ' accent', style: 'accent' }] },
            { label: 'joined', segments: [{ text: 'one' }, { text: ' two' }] },
          ],
        },
        { heading: 'Second', rows: [] },
      ],
    })
    const node = panel.currentNode()
    if (node.kind !== 'surface' || node.child.kind !== 'rich-text') throw new Error('expected canonical info surface')
    expect(node.child.spans.some(span => span.text === '\n')).toBe(true)
    expect(node.child.spans.some(span => span.text.includes('primary') && span.tone === 'accent')).toBe(true)
    expect(node.child.spans.some(span => span.text.includes('one two'))).toBe(true)
    expect(node.child.spans.some(span => span.text === '\n\nSecond')).toBe(true)
  })

  it('contains over-wide rows through the canonical width contract', () => {
    const { panel } = mount({
      sections: [{ heading: 'S', rows: [{ label: 'x', segments: [{ text: 'a'.repeat(60) }] }] }],
    })
    expect(panel.render(30).every(row => new FakeBlueComponents().visibleWidth(row) <= 30)).toBe(true)
  })

  it('scrolls a long body with a showing tail and resets when it fits', () => {
    const { panel } = mount({ sections: sections(10), maxVisible: 5 })
    expect(panel.render(60).some(row => row.includes('showing 1-5 of'))).toBe(true)
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.down)
    expect(panel.render(60).some(row => row.includes('showing 3-7 of'))).toBe(true)
    // PageUp floors at the top; PageDown (ten rows) runs into the end clamp.
    panel.handleInput('\x1b[5~')
    expect(panel.render(60).some(row => row.includes('showing 1-5 of'))).toBe(true)
    panel.handleInput('\x1b[6~')
    expect(panel.render(60).some(row => row.includes('showing 6-10 of'))).toBe(true)
    // Down advances visual rows; up walks back.
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.down)
    expect(panel.render(60).some(row => row.includes('showing 8-12 of'))).toBe(true)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    expect(panel.render(60).some(row => row.includes('showing 2-6 of'))).toBe(true)
    // A body that fits resets the scroll.
    const small = mount({ sections: sections(0) })
    small.panel.handleInput(KEY.down)
    expect(small.panel.render(60).some(row => row.includes('showing'))).toBe(false)
  })

  it('closes on the keymap cancel and submit keys and on q/Q', () => {
    const { panel, onClose } = mount()
    panel.handleInput(KEY.escape)
    panel.handleInput(KEY.enter)
    panel.handleInput('q')
    panel.handleInput('Q')
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('ignores other keys without closing', () => {
    const { panel, onClose } = mount()
    panel.handleInput('x')
    panel.handleInput('\t')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('invalidate is a no-op', () => {
    const { panel } = mount()
    expect(panel.invalidate()).toBeUndefined()
  })

  it('bounds wrapped narrow content without introducing field colons', () => {
    const { panel } = mount({ maxVisible: 5, sections: sections(10) })
    const rows = panel.render(2)
    expect(rows.length).toBeLessThanOrEqual(9)
    expect(rows.some(row => row.includes(':'))).toBe(false)
  })

  it('pages through one wrapped CJK/emoji row and clamps after a wide resize', () => {
    const { panel } = mount({
      maxVisible: 5,
      sections: [{ heading: 'H', rows: [{ label: 'X', segments: [{ text: '界🙂界🙂尾' }] }] }],
    })
    const first = panel.render(2).join('\n')
    expect(JSON.stringify(panel.currentNode())).toMatch(/showing 1-5 of \d+/u)
    expect(first).not.toContain('尾')

    panel.handleInput('\x1b[6~')
    expect(panel.render(2).join('')).toContain('尾')

    const wide = panel.render(80).join('\n')
    expect(wide).toContain('尾')
    expect(wide).not.toContain('showing')
  })
})
