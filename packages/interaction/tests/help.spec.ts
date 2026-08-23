/**
 * Unit tests for the `HelpOverlay` dialog: the framed `help` title, the
 * two-column sections, the scroll window and its `showing` tail, and the
 * close/scroll key handling (Escape/Enter/`q` close; arrows and PageUp/
 * PageDown scroll).
 */

import { describe, expect, it, vi } from 'vitest'
import type { BlueKeymap } from '@dsh-blue/blue-core'
import { HelpOverlay } from '../src/help.ts'
import type { HelpSection } from '../src/help.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

function sections(count = 3): HelpSection[] {
  return [
    {
      heading: 'Commands',
      labelPaint: (text: string): string => `^${text}^`,
      rows: Array.from({ length: count }, (_, index) => ({
        label: `/cmd-${index}`,
        description: `does thing ${index}`,
      })),
    },
  ]
}

function mount(options: {
  sections?: readonly HelpSection[]
  maxVisible?: number
  keymap?: BlueKeymap
} = {}): { overlay: HelpOverlay; onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn()
  const overlay = new HelpOverlay({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: options.keymap ?? new FakeKeymap(),
    sections: options.sections ?? sections(),
    maxVisible: options.maxVisible,
    onClose,
  })
  return { overlay, onClose }
}

describe('HelpOverlay', () => {
  it('renders the framed title, aligned two-column rows, and the closing rule', () => {
    const { overlay } = mount()
    const rows = overlay.render(60)
    const bar = '^' + '─'.repeat(60) + '^'
    expect(rows[0]).toBe(bar)
    expect(rows[1]).toBe('^  help^ _· Esc / Enter / q to cancel · ↑↓ scroll_')
    expect(rows[3]).toBe('  #Commands#')
    // Labels padEnd to the section's widest label inside the label paint.
    expect(rows[4]).toBe('    ^/cmd-0  ^  ~does thing 0~')
    expect(rows[5]).toBe('    ^/cmd-1  ^  ~does thing 1~')
    expect(rows[6]).toBe('    ^/cmd-2  ^  ~does thing 2~')
    expect(rows.at(-1)).toBe(bar)
  })

  it('closes on the keymap cancel and submit keys and on q/Q', () => {
    const { overlay, onClose } = mount()
    overlay.handleInput(KEY.escape)
    overlay.handleInput(KEY.enter)
    overlay.handleInput('q')
    overlay.handleInput('Q')
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('ignores unrelated keys', () => {
    const { overlay, onClose } = mount()
    overlay.handleInput('x')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('scrolls with arrows and pages, clamping at both ends', () => {
    // Eight content rows (blank + heading + six commands) against the
    // five-row floored window: the maximum scrollTop is 3.
    const { overlay } = mount({ maxVisible: 2, sections: sections(6) })
    overlay.handleInput(KEY.up)
    overlay.handleInput('\x1b[5~')
    const top = overlay.render(60)
    expect(top.some(row => row.includes(' showing 1-5 of 8'))).toBe(true)
    for (let i = 0; i < 20; i += 1) overlay.handleInput(KEY.down)
    const bottom = overlay.render(60)
    expect(bottom.some(row => row.includes(' showing 4-8 of 8'))).toBe(true)
    // PageDown past the end clamps to the last window.
    overlay.handleInput('\x1b[6~')
    expect(overlay.render(60).some(row => row.includes(' showing 4-8 of 8'))).toBe(true)
  })

  it('renders sections without a label paint and with empty rows', () => {
    const { overlay } = mount({
      maxVisible: 20,
      sections: [
        { heading: 'Plain', rows: [] },
        { heading: 'Defaulted', rows: [{ label: 'x', description: 'plain' }] },
      ],
    })
    const rows = overlay.render(60)
    expect(rows.some(row => row.includes('#Plain#'))).toBe(true)
    // The label pads to the eight-column width inside the default paint,
    // then the two-column gap separates it from the description.
    expect(rows.some(row => row.includes('x         ~plain~'))).toBe(true)
  })

  it('renders without the showing tail when the sections fit the window', () => {
    const { overlay } = mount({ maxVisible: 20 })
    const rows = overlay.render(60)
    expect(rows.some(row => row.includes('showing'))).toBe(false)
    expect(rows).toHaveLength(8)
  })

  it('resets the scroll position when the window fits the content again', () => {
    const { overlay } = mount({ maxVisible: 2, sections: sections(6) })
    for (let i = 0; i < 5; i += 1) overlay.handleInput(KEY.down)
    const scrolled = overlay.render(60)
    expect(scrolled.some(row => row.includes(' showing 4-8 of 8'))).toBe(true)
    const wide = mount({ maxVisible: 20 })
    expect(wide.overlay.render(60).some(row => row.includes('showing'))).toBe(false)
  })
})
