/** Tests for `/trace` navigation, detail loading, and copy shortcuts. */

import { describe, expect, it, vi } from 'vitest'
import { TracePanel } from '../src/trace-panel.ts'
import type { TraceItem } from '../src/trace-format.ts'
import { FakeBlueComponents, FakeKeymap, FakeTheme, KEY } from './fakes.ts'

const items: TraceItem[] = Array.from({ length: 3 }, (_, seq) => ({
  seq,
  lastSeq: seq,
  eventSeqs: [seq],
  time: seq === 2 ? Number.NaN : seq * 1000,
  type: 'user/message',
  surface: seq === 2 ? 'shadowed' : 'current',
  title: 'User request',
  summary: seq === 2 ? '' : `summary ${seq}`,
}))

function mount() {
  const onClose = vi.fn()
  const onCopyItem = vi.fn()
  const onCopyAll = vi.fn()
  const onLoadDetail = vi.fn()
  const panel = new TracePanel({
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: new FakeKeymap(),
    sessionId: 'session',
    items,
    onClose,
    onCopyItem,
    onCopyAll,
    onLoadDetail,
  })
  return { panel, onClose, onCopyItem, onCopyAll, onLoadDetail }
}

function options(overrides: Partial<ConstructorParameters<typeof TracePanel>[0]> = {}): ConstructorParameters<typeof TracePanel>[0] {
  return {
    theme: new FakeTheme(),
    components: new FakeBlueComponents(),
    keymap: new FakeKeymap(),
    sessionId: 'session',
    items,
    onClose: vi.fn(),
    onCopyItem: vi.fn(),
    onCopyAll: vi.fn(),
    onLoadDetail: vi.fn(),
    ...overrides,
  }
}

describe('TracePanel', () => {
  it('renders empty and populated states and handles selection actions', () => {
    const empty = new TracePanel(options({ items: [] }))
    expect(empty.render(60).join('\n')).toContain('no trace events yet')
    empty.handleInput('\r')
    empty.handleInput('c')
    const mounted = mount()
    expect(mounted.panel.render(70).join('\n')).toContain('summary 0')
    mounted.panel.handleInput(KEY.down)
    mounted.panel.handleInput(KEY.enter)
    mounted.panel.handleInput('x')
    expect(mounted.panel.render(70).join('\n')).toContain('loading details')
    mounted.panel.setDetail(1, 'detail line')
    expect(mounted.panel.render(70).join('\n')).toContain('detail line')
    mounted.panel.handleInput('c')
    mounted.panel.handleInput('a')
    mounted.panel.handleInput('A')
    mounted.panel.handleInput(KEY.enter)
    expect(mounted.onCopyItem).toHaveBeenCalledWith(items[1])
    expect(mounted.onCopyAll).toHaveBeenCalledTimes(2)
    expect(mounted.onLoadDetail).toHaveBeenCalledWith(items[1])
    expect(mounted.panel.render(70).join('\n')).toContain('·')
  })

  it('covers page navigation and long windows', () => {
    const many = Array.from({ length: 15 }, (_, seq) => ({ ...items[0]!, seq }))
    const mounted = new TracePanel(options({ items: many }))
    mounted.handleInput(KEY.up)
    mounted.handleInput('\x1b[6~')
    mounted.handleInput('\x1b[5~')
    for (let index = 0; index < 12; index += 1) mounted.handleInput(KEY.down)
    for (let index = 0; index < 12; index += 1) mounted.handleInput(KEY.up)
    expect(mounted.render(30).length).toBeGreaterThan(0)
  })

  it('closes on cancel and q, pages, and invalidates safely', () => {
    const mounted = mount()
    mounted.panel.handleInput(KEY.escape)
    mounted.panel.handleInput('q')
    mounted.panel.handleInput('Q')
    mounted.panel.handleInput('\x1b[5~')
    mounted.panel.handleInput('\x1b[6~')
    expect(mounted.onClose).toHaveBeenCalledTimes(3)
    expect(mounted.panel.invalidate()).toBeUndefined()
  })
})
