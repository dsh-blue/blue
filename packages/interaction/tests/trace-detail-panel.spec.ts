/** Tests for the dedicated, scrollable trace detail window. */

import { describe, expect, it, vi } from 'vitest'
import { TraceDetailPanel } from '../src/trace-detail-panel.ts'
import type { TraceItem } from '../src/trace-format.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

const item: TraceItem = {
  seq: 3,
  lastSeq: 5,
  eventSeqs: [3, 4, 5],
  time: 1000,
  type: 'assistant/chunk',
  surface: 'current',
  title: 'Thinking',
  summary: 'assembled',
}

function mount(text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')) {
  const onClose = vi.fn()
  const panel = new TraceDetailPanel({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: new FakeKeymap(),
    item,
    text,
    onClose,
  })
  return { panel, onClose }
}

describe('TraceDetailPanel', () => {
  it('renders a fixed detail window and scrolls by line or page', () => {
    const mounted = mount()
    const first = mounted.panel.render(70).join('\n')
    expect(first).toContain('line 1')
    expect(first).toContain('lines 1-14 of 40')
    mounted.panel.handleInput(KEY.up)
    expect(mounted.panel.render(70).join('\n')).toContain('lines 1-14 of 40')
    mounted.panel.handleInput(KEY.down)
    expect(mounted.panel.render(70).join('\n')).toContain('lines 2-15 of 40')
    mounted.panel.handleInput('\x1b[6~')
    expect(mounted.panel.render(70).join('\n')).toContain('lines 16-29 of 40')
    mounted.panel.handleInput('\x1b[5~')
    expect(mounted.panel.render(70).join('\n')).toContain('lines 2-15 of 40')
    mounted.panel.handleInput('G')
    expect(mounted.panel.render(70).join('\n')).toContain('lines 27-40 of 40')
    mounted.panel.handleInput('g')
    expect(mounted.panel.render(70).join('\n')).toContain('lines 1-14 of 40')
  })

  it('closes on cancel and handles short or narrow content', () => {
    const mounted = mount('one')
    expect(mounted.panel.render(40).join('\n')).toContain('lines 1-1 of 1')
    expect(mounted.panel.render(12).length).toBeGreaterThan(0)
    mounted.panel.handleInput(KEY.escape)
    mounted.panel.handleInput('q')
    mounted.panel.handleInput('Q')
    expect(mounted.onClose).toHaveBeenCalledTimes(3)
    mounted.panel.handleInput(KEY.pageDown)
    expect(mounted.panel.invalidate()).toBeUndefined()
  })
})
