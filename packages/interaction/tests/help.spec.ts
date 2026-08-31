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
      labelTone: 'accent',
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
    ...(options.maxVisible === undefined ? {} : { maxVisible: options.maxVisible }),
    onClose,
  })
  return { overlay, onClose }
}

describe('HelpOverlay', () => {
  it('renders one canonical overlay with semantic sections and a close footer', () => {
    const { overlay } = mount()
    overlay.focused = true
    expect(overlay.focused).toBe(true)
    const rows = overlay.render(60)
    expect(overlay.currentNode()).toMatchObject({ kind: 'surface', chrome: 'overlay', title: 'help' })
    expect(rows.join('\n')).toContain('help')
    expect(rows.join('\n')).toContain('Commands')
    expect(rows.join('\n')).toContain('/cmd-0')
    expect(rows.join('\n')).toContain('does thing 2')
    expect(rows.join('\n')).toContain('Esc/Enter/q close')
    overlay.invalidate()
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
    // Seven rendered rows (heading + six commands) against the five-row
    // floored window: the maximum scrollTop is 2.
    const { overlay } = mount({ maxVisible: 2, sections: sections(6) })
    overlay.handleInput(KEY.up)
    overlay.handleInput('\x1b[5~')
    const top = overlay.render(60)
    expect(top.some(row => row.includes(' showing 1-5 of 7'))).toBe(true)
    for (let i = 0; i < 20; i += 1) overlay.handleInput(KEY.down)
    const bottom = overlay.render(60)
    expect(bottom.some(row => row.includes(' showing 3-7 of 7'))).toBe(true)
    // PageDown past the end clamps to the last window.
    overlay.handleInput('\x1b[6~')
    expect(overlay.render(60).some(row => row.includes(' showing 3-7 of 7'))).toBe(true)
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
    expect(rows.some(row => row.includes('Plain'))).toBe(true)
    expect(rows.some(row => row.includes('x') && row.includes('plain'))).toBe(true)
  })

  it('renders without the showing tail when the sections fit the window', () => {
    const { overlay } = mount({ maxVisible: 20 })
    const rows = overlay.render(60)
    expect(rows.some(row => row.includes('showing'))).toBe(false)
    expect(rows.length).toBeGreaterThan(5)
  })

  it('resets the scroll position when the window fits the content again', () => {
    const { overlay } = mount({ maxVisible: 2, sections: sections(6) })
    for (let i = 0; i < 5; i += 1) overlay.handleInput(KEY.down)
    const scrolled = overlay.render(60)
    expect(scrolled.some(row => row.includes(' showing 3-7 of 7'))).toBe(true)
    const wide = mount({ maxVisible: 20 })
    expect(wide.overlay.render(60).some(row => row.includes('showing'))).toBe(false)
  })

  it('bounds wrapped narrow content by the configured visible-row budget', () => {
    const { overlay } = mount({ maxVisible: 5, sections: sections(6) })
    const rows = overlay.render(2)
    expect(rows.length).toBeLessThanOrEqual(9)
    expect(rows.some(row => row.includes(':'))).toBe(false)
  })

  it('pages through one wrapped CJK/emoji row and clamps after a wide resize', () => {
    const { overlay } = mount({
      maxVisible: 5,
      sections: [{ heading: 'H', rows: [{ label: 'X', description: '界🙂界🙂尾' }] }],
    })
    const first = overlay.render(2).join('\n')
    expect(JSON.stringify(overlay.currentNode())).toMatch(/showing 1-5 of \d+/u)
    expect(first).not.toContain('尾')

    overlay.handleInput('\x1b[6~')
    expect(overlay.render(2).join('')).toContain('尾')

    const wide = overlay.render(80).join('\n')
    expect(wide).toContain('尾')
    expect(wide).not.toContain('showing')
  })
})
