/** Canonical frontend-panel controller behavior. */

import { describe, expect, it, vi } from 'vitest'
import { CanonicalDocumentController, type FrontendPanelDocument } from '../src/frontend-panel.ts'
import { fakeBlueContext, KEY } from './fakes.ts'

function fixture(initial?: FrontendPanelDocument, options: { hint?: string, showSelectedVariantInFooter?: boolean, onUnhandledInput?: (data: string, id: string | undefined) => { readonly kind: string } | undefined } = {}) {
  const display = fakeBlueContext()
  let model: FrontendPanelDocument = initial ?? { mode: 'info', title: 'Fixture', view: { kind: 'text', content: 'body' }, submit: { kind: 'refresh' } }
  const onAction = vi.fn()
  const onClose = vi.fn()
  const panel = new CanonicalDocumentController({
    ...display, model: () => model, onAction, onClose, maxVisible: 5,
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    ...(options.showSelectedVariantInFooter === undefined ? {} : { showSelectedVariantInFooter: options.showSelectedVariantInFooter }),
    ...(options.onUnhandledInput === undefined ? {} : { onUnhandledInput: options.onUnhandledInput }),
  })
  return { panel, onAction, onClose, setModel(next: FrontendPanelDocument) { model = next; panel.invalidate() } }
}

describe('CanonicalDocumentController', () => {
  it('renders canonical content and dispatches submit or closes', () => {
    const active = fixture()
    expect(active.panel.currentNode()).toMatchObject({ kind: 'surface', title: 'Fixture' })
    expect(active.panel.render(40).join('\n')).toContain('body')
    active.panel.handleInput(KEY.enter)
    expect(active.onAction).toHaveBeenCalledWith({ kind: 'refresh' })
    active.panel.invalidate()
    const passive = fixture({ mode: 'info', title: 'Passive' })
    passive.panel.handleInput('x')
    passive.panel.handleInput(KEY.enter)
    expect(passive.onClose).toHaveBeenCalledOnce()
  })

  it('selects enabled rows, wraps, and dispatches cancel', () => {
    const value = fixture({
      mode: 'select', title: 'Choose', selectedId: 'a', cancel: { kind: 'cancel' },
      items: [
        { id: 'a', label: 'A', action: { kind: 'a' } },
        { id: 'b', label: 'B', disabled: true, action: { kind: 'b' } },
        { id: 'c', label: 'C', action: { kind: 'c' } },
      ],
    })
    expect(extractList(value.panel.currentNode()).selectedIds).toEqual(['a'])
    value.panel.handleInput(KEY.down); value.panel.handleInput(KEY.enter)
    value.panel.handleInput(KEY.up); value.panel.handleInput(KEY.enter)
    value.panel.handleInput(KEY.escape)
    expect(value.onAction.mock.calls.map(call => call[0])).toEqual([{ kind: 'c' }, { kind: 'a' }, { kind: 'cancel' }])
    expect(value.onClose).toHaveBeenCalledOnce()
  })

  it('filters, clears search before close, and handles no matches', () => {
    const value = fixture({ mode: 'select', title: 'Filter', filterable: true, items: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }] })
    value.panel.handleInput('z')
    expect(value.panel.render(40).join('\n')).toContain('/ z')
    expect(value.panel.render(40).join('\n')).toContain('no matches')
    expect(value.panel.currentNode()).toMatchObject({ footer: { content: 'Esc close' } })
    value.panel.handleInput(KEY.escape)
    expect(value.onClose).not.toHaveBeenCalled()
    expect(value.panel.render(40).join('\n')).not.toContain('/ z')
    value.panel.handleInput(KEY.escape)
    expect(value.onClose).toHaveBeenCalledOnce()
  })

  it('switches groups and variants and dispatches the secondary action', () => {
    const value = fixture({
      mode: 'select', title: 'Models', grouped: true,
      items: [
        { id: 'a', label: 'Alpha', detail: 'ctx 64k', group: 'One', selectedVariantId: 'low', variants: [
          { id: 'low', label: 'Low', action: { kind: 'pick', id: 'low' }, secondaryAction: { kind: 'session', id: 'low' } },
          { id: 'high', label: 'High', action: { kind: 'pick', id: 'high' }, secondaryAction: { kind: 'session', id: 'high' } },
        ] },
        { id: 'b', label: 'Beta', group: 'Two', action: { kind: 'pick', id: 'b' } },
      ],
    })
    expect(value.panel.render(80).join('\n')).toContain('All')
    expect(value.panel.render(80).join('\n')).toContain('[Low]')
    expect(extractList(value.panel.currentNode()).items[0]!.detailSpans).toEqual([
      { text: 'ctx 64k' },
      { text: ' [Low]', tone: 'accent', emphasis: 'strong' },
      { text: ' [High]', tone: 'muted' },
    ])
    value.panel.handleInput(KEY.right)
    expect(value.panel.render(80).join('\n')).toContain('[High]')
    expect(extractList(value.panel.currentNode()).items[0]!.detailSpans).toEqual([
      { text: 'ctx 64k' },
      { text: ' [Low]', tone: 'muted' },
      { text: ' [High]', tone: 'accent', emphasis: 'strong' },
    ])
    value.panel.handleInput('\x1bs'); value.panel.handleInput(KEY.enter)
    expect(value.onAction.mock.calls.map(call => call[0])).toEqual([{ kind: 'session', id: 'high' }, { kind: 'pick', id: 'high' }])
    value.panel.handleInput(KEY.tab)
    value.panel.handleInput(KEY.left)
    value.panel.handleInput('\x1b[Z')

    const groupsOnly = fixture({
      mode: 'select', title: 'Groups', grouped: true,
      items: [
        { id: 'one', label: 'One', group: 'One' },
        { id: 'two', label: 'Two', group: 'Two' },
      ],
    })
    groupsOnly.panel.handleInput(KEY.right)
    expect(groupsOnly.panel.render(80).join('\n')).toContain('Two')
  })

  it('renders named counted tabs, group empty states, badges, and disabled variants', () => {
    const value = fixture({
      mode: 'select', title: 'Plugins', grouped: true, includeAllGroup: false,
      groups: ['installed', 'catalog'],
      groupLabels: { installed: 'Installed', catalog: 'Catalog' },
      groupCounts: { installed: 1, catalog: 0 },
      empty: { title: 'nothing here' },
      emptyByGroup: { catalog: { title: 'catalog unavailable', description: 'offline' } },
      items: [{
        id: 'a', label: 'Alpha', badge: 'ready', group: 'installed', detail: 'v1', variantsFirst: true,
        variants: [
          { id: 'verify', label: 'Verify', action: { kind: 'verify' } },
          { id: 'remove', label: 'Remove', disabled: true, action: { kind: 'remove' } },
        ],
      }],
    }, { showSelectedVariantInFooter: true })
    const node = value.panel.currentNode()
    if (node.kind !== 'surface' || node.child.kind !== 'stack') throw new Error('expected panel surface')
    expect(node.child.children.map(child => child.node).find(child => child.kind === 'tabs')).toEqual({
      kind: 'tabs', id: 'frontend-panel-groups', activeId: 'installed',
      items: [{ id: 'installed', label: 'Installed', count: 1 }, { id: 'catalog', label: 'Catalog', count: 0 }],
    })
    expect(extractList(node).items[0]).toMatchObject({ badge: 'ready' })
    expect(extractList(node).items[0]!.detailSpans).toEqual([
      { text: '[Verify]', tone: 'accent', emphasis: 'strong' },
      { text: ' [Remove]', tone: 'muted' },
      { text: ' · v1' },
    ])
    expect(node.footer).toMatchObject({ content: expect.stringContaining('Verify selected') })
    value.panel.handleInput(KEY.right)
    value.panel.handleInput(KEY.enter)
    expect(value.onAction).toHaveBeenCalledWith({ kind: 'verify' })
    value.panel.handleInput(KEY.tab)
    expect(value.panel.render(80).join('\n')).toContain('catalog unavailable')
    expect(value.panel.render(80).join('\n')).toContain('offline')

    value.setModel({ mode: 'select', title: 'Empty', grouped: true, includeAllGroup: false, groups: ['installed'], empty: { title: 'nothing here' }, items: [] })
    expect(value.panel.render(80).join('\n')).toContain('nothing here')
  })

  it('bounds long lists, supports page/top/end keys, and custom input', () => {
    const shortcut = vi.fn(() => ({ kind: 'shortcut' as const }))
    const value = fixture({
      mode: 'select', title: 'Long', items: Array.from({ length: 20 }, (_, index) => ({ id: String(index), label: `Item ${String(index)}` })),
    }, { hint: 'custom', onUnhandledInput: (data, id) => data === 'c' && id === '0' ? shortcut() : undefined })
    expect(extractList(value.panel.currentNode()).items).toHaveLength(5)
    value.panel.handleInput('c'); value.panel.handleInput('\x1b[6~'); value.panel.handleInput('G'); value.panel.handleInput('g'); value.panel.handleInput('\x1b[5~')
    expect(value.onAction).toHaveBeenCalledWith({ kind: 'shortcut' })
    expect(value.panel.render(60).join('\n')).toContain('custom')
  })

  it('locks loading panels and refreshes replacement models', () => {
    const value = fixture({ mode: 'loading', title: 'Busy', view: { kind: 'text', content: 'working' }, dismissible: false })
    value.panel.handleInput(KEY.escape); value.panel.handleInput(KEY.enter)
    expect(value.onClose).not.toHaveBeenCalled()
    expect(value.panel.render(40).join('\n')).toContain('working')
    value.setModel({ mode: 'error', title: 'Failed', view: { kind: 'text', content: 'down' } })
    expect(value.panel.render(40).join('\n')).toContain('down')

    const structured = fixture({ mode: 'loading', title: 'Structured', view: { kind: 'divider', label: 'waiting' } })
    expect(structured.panel.currentNode()).toMatchObject({
      child: { children: [{ node: { kind: 'loader' } }, { node: { kind: 'divider', label: 'waiting' } }] },
    })

    const groupedModel: FrontendPanelDocument = {
      mode: 'select', title: 'Stable tab', grouped: true, includeAllGroup: false, groups: ['installed', 'catalog'],
      items: [{ id: 'i', label: 'Installed', group: 'installed' }, { id: 'c', label: 'Catalog', group: 'catalog' }],
    }
    const grouped = fixture(groupedModel, { showSelectedVariantInFooter: true })
    grouped.panel.handleInput(KEY.tab)
    grouped.setModel({ mode: 'loading', title: 'Stable tab', dismissible: false })
    grouped.panel.render(80)
    grouped.setModel(groupedModel)
    const groupedNode = grouped.panel.currentNode()
    if (groupedNode.kind !== 'surface' || groupedNode.child.kind !== 'stack') throw new Error('expected grouped surface')
    expect(groupedNode.child.children.map(child => child.node).find(node => node.kind === 'tabs')).toMatchObject({ activeId: 'catalog' })
  })

  it('maps compiler list, tab, and Escape events through the canonical adapter', () => {
    const value = fixture({ mode: 'select', title: 'Compiler', items: [{ id: 'a', label: 'A', action: { kind: 'a' } }] })
    value.panel.focused = true
    expect(value.panel.focused).toBe(true)
    const adapter = (value.panel as unknown as { adapter: { handleInput(data: string): void } }).adapter
    adapter.handleInput(KEY.enter)
    adapter.handleInput(KEY.escape)
    expect(value.onAction).toHaveBeenCalledWith({ kind: 'a' })
    expect(value.onClose).toHaveBeenCalledOnce()

    const grouped = fixture({
      mode: 'select', title: 'Compiler', grouped: true,
      items: [
        { id: 'a', label: 'A', group: 'One', action: { kind: 'a' } },
        { id: 'b', label: 'B', group: 'Two' },
      ],
    })
    const groupAdapter = (grouped.panel as unknown as { adapter: { handleInput(data: string): void } }).adapter
    groupAdapter.handleInput(KEY.right)
    groupAdapter.handleInput(KEY.enter)
    expect(grouped.panel.currentNode()).toMatchObject({ kind: 'surface' })
  })

  it('handles empty navigation, secondary fallback, backspace, and both empty modes', () => {
    const empty = fixture({ mode: 'select', title: 'Empty', filterable: true, items: [] })
    empty.panel.handleInput(KEY.up)
    empty.panel.handleInput(KEY.down)
    empty.panel.handleInput('x')
    empty.panel.handleInput('\x7f')
    empty.panel.handleInput('\x1bs')
    expect(empty.onClose).not.toHaveBeenCalled()

    const secondary = fixture({ mode: 'select', title: 'Secondary', items: [{ id: 'a', label: 'A', secondaryAction: { kind: 'session' } }] })
    secondary.panel.handleInput('\x1bs')
    expect(secondary.onAction).toHaveBeenCalledWith({ kind: 'session' })

    const info = fixture({ mode: 'info', title: 'Nothing' })
    expect(info.panel.render(40).join('\n')).toContain('no content')
    const error = fixture({ mode: 'error', title: 'Nothing' })
    expect(error.panel.render(40).join('\n')).toContain('unavailable')
    const loading = fixture({ mode: 'loading', title: 'Loading' })
    expect(loading.panel.currentNode()).toMatchObject({ footer: { content: 'Esc / q to cancel' } })

    const detailed = fixture({ mode: 'select', title: 'Detail', items: [{ id: 'a', label: 'A', detail: 'description' }] })
    expect(extractList(detailed.panel.currentNode()).items[0]).toMatchObject({ detail: 'description' })
  })

  it('clamps scrolling, resets stale groups, and tolerates missing variants and events', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ id: String(index), label: `Item ${String(index)}` }))
    const value = fixture({ mode: 'select', title: 'Scroll', items })
    value.panel.handleInput('\x1b[6~')
    value.panel.currentNode()
    for (let index = 0; index < 6; index += 1) value.panel.handleInput(KEY.down)
    value.panel.currentNode()

    const grouped = fixture({
      mode: 'select', title: 'Groups', grouped: true,
      groups: ['One', 'Two'], items: [{ id: 'a', label: 'A', group: 'One' }, { id: 'b', label: 'B', group: 'Two' }],
    })
    grouped.panel.handleInput(KEY.tab)
    grouped.panel.handleInput(KEY.tab)
    grouped.setModel({ mode: 'select', title: 'Groups', grouped: true, includeAllGroup: false, groups: ['One', 'Two'], items: [] })
    grouped.panel.currentNode()
    grouped.setModel({ mode: 'select', title: 'Groups', grouped: true, includeAllGroup: false, groups: [], items: [] })
    grouped.panel.handleInput(KEY.tab)
    grouped.panel.handleInput(KEY.left)

    const outOfRange = fixture({ mode: 'select', title: 'Clamp', items: [{ id: 'a', label: 'A' }] })
    const outOfRangeState = outOfRange.panel as unknown as { group: number }
    outOfRangeState.group = 99
    expect(extractList(outOfRange.panel.currentNode()).items).toHaveLength(1)

    const variant = fixture({ mode: 'select', title: 'Variant', items: [{ id: 'a', label: 'A', selectedVariantId: 'missing', variants: [{ id: 'only', label: 'Only' }] }] })
    variant.panel.currentNode()
    variant.panel.handleInput('\x1bs')
    const emptyVariants = fixture({ mode: 'select', title: 'No variants', items: [{ id: 'a', label: 'A', variants: [] }] })
    expect(extractList(emptyVariants.panel.currentNode()).items[0]!.detailSpans).toEqual([])
    const variantsFirst = fixture({ mode: 'select', title: 'First', items: [{ id: 'a', label: 'A', variantsFirst: true, variants: [{ id: 'only', label: 'Only' }] }] })
    expect(extractList(variantsFirst.panel.currentNode()).items[0]!.detailSpans).toEqual([
      { text: '[Only]', tone: 'accent', emphasis: 'strong' },
    ])

    const events = variant.panel as unknown as { onEvent(event: { kind: string, controlId: string, value?: unknown, tabId?: string }): void }
    events.onEvent({ kind: 'activate', controlId: 'other' })
    events.onEvent({ kind: 'selection-change', controlId: 'frontend-panel-list', value: 1 })
    events.onEvent({ kind: 'selection-change', controlId: 'frontend-panel-list', value: 'a' })
    events.onEvent({ kind: 'tab-change', controlId: 'frontend-panel-groups', tabId: 'missing' })
  })
})

function extractList(node: ReturnType<CanonicalDocumentController['currentNode']>) {
  if (node.kind !== 'surface' || node.child.kind !== 'stack') throw new Error('expected panel surface')
  const list = node.child.children.map(child => child.node).find(child => child.kind === 'list')
  if (list?.kind !== 'list') throw new Error('expected panel list')
  return list
}
