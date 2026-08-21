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
} = {}): { panel: InfoPanel; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const panel = new InfoPanel({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: new FakeKeymap(),
    title: 'status',
    sections: options.sections ?? sections(),
    maxVisible: options.maxVisible,
    onClose,
  })
  return { panel, onClose }
}

describe('InfoPanel', () => {
  it('renders the framed title, aligned two-column rows, and the closing rule', () => {
    const { panel } = mount()
    const rows = panel.render(80)
    const bar = '^' + '─'.repeat(80) + '^'
    expect(rows[0]).toBe(bar)
    expect(rows[1]).toBe('^  status^ _· Esc / Enter / q to cancel · ↑↓ scroll_')
    expect(rows[3]).toBe('  #Session#')
    // Labels padEnd to the section's widest label; values join their
    // styled segments in place.
    expect(rows[4]).toBe('    ~id          ~  spec-session')
    expect(rows[5]).toBe('    ~longer label~  value ~dim tail~! red tail!? amber? green')
    expect(rows[8]).toBe('    ~row-2       ~  value 2')
    expect(rows.at(-1)).toBe(bar)
  })

  it('ellipsizes over-wide rows', () => {
    const { panel } = mount({
      sections: [{ heading: 'S', rows: [{ label: 'x', segments: [{ text: 'a'.repeat(60) }] }] }],
    })
    expect(panel.render(30).some(row => row.includes('...'))).toBe(true)
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
    expect(panel.render(60).some(row => row.includes('showing 10-14 of'))).toBe(true)
    // Down past the end clamps; up walks back.
    panel.handleInput(KEY.down)
    panel.handleInput(KEY.down)
    expect(panel.render(60).some(row => row.includes('showing 10-14 of'))).toBe(true)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    panel.handleInput(KEY.up)
    expect(panel.render(60).some(row => row.includes('showing 4-8 of'))).toBe(true)
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
})
