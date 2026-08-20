/** The model-family panels: row layout, segment control, and key dispatch. */

import { describe, expect, it, vi } from 'vitest'
import { cycleSegment } from '../src/thinking-segments.ts'
import { EffortPanel, ModelPanel, formatContextWindow, type ModelPanelItem } from '../src/model-panel.ts'
import { fakeBlueContext, KEY } from './fakes.ts'

/** A panel item with sane defaults for the layout tests. */
function item(overrides: Partial<ModelPanelItem> = {}): ModelPanelItem {
  return {
    provider: 'deepseek',
    providerLabel: 'deepseek',
    id: 'deepseek-chat',
    name: 'deepseek-chat',
    current: true,
    ...overrides,
  }
}

function panel(items: readonly ModelPanelItem[], options: {
  currentEffort?: string
  warning?: string
} = {}) {
  const { theme, keymap, components } = fakeBlueContext()
  const onSelect = vi.fn()
  const onSessionOnlySelect = vi.fn()
  const onCancel = vi.fn()
  const component = new ModelPanel({
    keymap,
    theme,
    components,
    items,
    ...options.currentEffort === undefined ? {} : { currentEffort: options.currentEffort },
    ...options.warning === undefined ? {} : { warning: options.warning },
    onSelect,
    onSessionOnlySelect,
    onCancel,
  })
  return { component, onSelect, onSessionOnlySelect, onCancel }
}

describe('formatContextWindow', () => {
  it('formats 1024-base sizes', () => {
    expect(formatContextWindow(512)).toBe('512')
    expect(formatContextWindow(1024)).toBe('1k')
    expect(formatContextWindow(1536)).toBe('1.5k')
    expect(formatContextWindow(131072)).toBe('128k')
    expect(formatContextWindow(200_000)).toBe('195k')
    expect(formatContextWindow(1_048_576)).toBe('1m')
  })
})

describe('ModelPanel', () => {
  it('renders the current row with the pointer, metadata, and badge', () => {
    const { component } = panel([
      item({ contextWindow: 131072, efforts: ['low', 'high'], defaultEffort: 'high' }),
      item({ id: 'other', name: 'other', current: false }),
    ])
    const rows = component.render(80)
    // framePanel: rule, title+hint rows, then the body. The current row
    // carries the name column, the muted provider and context cells, the
    // success badge; the second row is the plain text variant.
    const currentRow = rows.find(row => row.includes('❯')) ?? ''
    // The row label is `Provider Name/model` (the dogfood ruling).
    expect(currentRow).toContain('deepseek/deepseek-chat')
    expect(currentRow).toContain('_· ctx 128k_')
    expect(currentRow).toContain('← current')
    const otherRow = rows.find(row => row.includes('other')) ?? ''
    expect(otherRow).toContain('deepseek/other')
    expect(otherRow).not.toContain('❯')
    expect(otherRow).not.toContain('← current')
  })

  it('renders the title, hint, and warning rows in the kimi order', () => {
    const { component } = panel([item()], { warning: 'switching models starts a fresh prompt cache' })
    const rows = component.render(80)
    expect(rows[1]).toContain('Select a model')
    expect(rows[1]).toContain('(type to search)')
    expect(rows[2]).toContain('navigate')
    expect(rows[2]).toContain('session-only')
    // Single-provider catalog: no tab strip, the warning follows the blank.
    expect(rows[3]).toBe('')
    expect(rows[4]).toBe('?  switching models starts a fresh prompt cache?')
  })

  it('renders the thinking footer from the highlighted row and Off (Unsupported) without efforts', () => {
    const withEfforts = panel([item({ efforts: ['low', 'high'], defaultEffort: 'high' })])
    const rows = withEfforts.component.render(80)
    const caption = rows.find(row => row.includes('Thinking'))
    expect(caption).toContain('_  Thinking  (←→ to switch)_')
    const segmentRow = rows[rows.indexOf(caption ?? '') + 1] ?? ''
    expect(segmentRow).toContain('[ High ]')
    expect(segmentRow).toContain('  Low  ')

    const without = panel([item({ efforts: undefined })])
    const plainRows = without.component.render(80)
    const plainCaption = plainRows.find(row => row.includes('Thinking'))
    expect(plainRows[plainRows.indexOf(plainCaption ?? '') + 1] ?? '').toContain('_  Off (Unsupported)_')
  })

  it('shows the scroll position row past the visible window', () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      item({ id: `m${index}`, name: `m${index}`, current: false }))
    items[9] = item({ id: 'm9', name: 'm9', current: true })
    const { component } = panel(items)
    const rows = component.render(80)
    expect(rows.some(row => row.includes('(10/10)'))).toBe(true)
  })

  it('truncates a long combined label at half the width', () => {
    const { component } = panel([item({ name: 'x'.repeat(60) })])
    const rows = component.render(60)
    const row = rows.find(candidate => candidate.includes('❯')) ?? ''
    // nameCap = 30 → the `deepseek/xxx…` label clips with the ellipsis.
    expect(row).toContain('…')
  })

  it('moves the cursor with wraparound and submits the effort draft', () => {
    const { component, onSelect } = panel([
      item({ id: 'a', name: 'a', efforts: ['low', 'high'], defaultEffort: 'low', current: true }),
      item({ id: 'b', name: 'b', current: false }),
      item({ id: 'c', name: 'c', current: false }),
    ])
    // Down twice from the current row: a plain step then the wrap over the
    // tail; Up then takes a plain step back. Both non-wrapping arms run.
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    component.handleInput(KEY.up)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }), undefined)
    component.handleInput(KEY.up)
    component.handleInput(KEY.right)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), 'high')
    // Left wraps from the first segment back to the last.
    component.handleInput(KEY.left)
    component.handleInput(KEY.left)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), 'high')
    // Wrapping: Down off the tail and Up off the head both round the list.
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    component.handleInput(KEY.down)
    component.handleInput(KEY.up)
    // An unbound non-printable key falls through every branch untouched.
    component.handleInput('\x00')
  })

  it('seeds a no-default row at its first effort', () => {
    const { component, onSelect } = panel([
      item({ efforts: ['low', 'high'], defaultEffort: undefined }),
    ])
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat' }), 'low')
  })

  it('partly fits the badge when only a few columns remain', () => {
    // The long label fills most of the budget: the ctx cell fits whole at
    // this width and the badge drops; one column wider it cuts partly.
    const { component } = panel([
      item({ name: 'x'.repeat(16), contextWindow: 65536 }),
    ])
    const tight = component.render(38).find(candidate => candidate.includes('❯')) ?? ''
    expect(tight).not.toContain('← current')
    const roomy = component.render(46).find(candidate => candidate.includes('❯')) ?? ''
    expect(roomy).toContain('← c')
  })

  it('keeps ← and → a no-op on a row without efforts', () => {
    const { component, onSelect } = panel([item({ efforts: undefined })])
    component.handleInput(KEY.right)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat' }), undefined)
  })

  it('seeds the current row draft from the live effort and commits session-only with Alt+S', () => {
    const { component, onSessionOnlySelect } = panel(
      [item({ efforts: ['low', 'high'], defaultEffort: 'low' })],
      { currentEffort: 'low' },
    )
    component.handleInput(KEY.altS)
    expect(onSessionOnlySelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'deepseek-chat' }), 'low')
  })

  it('cancels with Escape', () => {
    const { component, onCancel } = panel([item()])
    component.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders and ignores keys with an empty item set', () => {
    const { component, onSelect, onCancel } = panel([])
    const rows = component.render(60)
    expect(rows.some(row => row.includes('_  Off (Unsupported)_'))).toBe(true)
    component.handleInput(KEY.enter)
    component.handleInput(KEY.escape)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledOnce()
    component.invalidate()
  })

  it('renders the provider tab strip for multi-provider catalogs', () => {
    const { component } = panel([
      item(),
      item({ providerLabel: 'z-ai', provider: 'z-ai', id: 'glm', name: 'glm', current: false }),
    ])
    const rows = component.render(60)
    const strip = rows.find(row => row.includes('All')) ?? ''
    expect(strip).toContain('^All^')
    expect(strip).toContain('_z-ai_')
    expect(rows.some(row => row.includes('tab toggle provider'))).toBe(true)
  })

  it('filters by provider tab and by the typed query', () => {
    const { component, onSelect } = panel([
      item(),
      item({ providerLabel: 'z-ai', provider: 'z-ai', id: 'glm', name: 'glm', current: false }),
      item({ id: 'other', name: 'other', current: false }),
    ])
    // Two tabs: All → deepseek → z-ai.
    component.handleInput('\t')
    component.handleInput('\t')
    let rows = component.render(60)
    expect(rows.some(row => row.includes('glm'))).toBe(true)
    expect(rows.some(row => row.includes('deepseek/deepseek-chat'))).toBe(false)
    // Enter selects within the tab.
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'glm' }), undefined)
    // Back on All, a typed query narrows to the matching rows.
    component.handleInput('\t')
    for (const char of 'glm') component.handleInput(char)
    rows = component.render(60)
    expect(rows.some(row => row.includes('Search:') && row.includes('glm'))).toBe(true)
    expect(rows.some(row => row.includes('deepseek/deepseek-chat'))).toBe(false)
    // Backspace shrinks the query; Escape clears it first (the kimi
    // rule), not the panel.
    component.handleInput('\x7f')
    expect(rows.some(row => row.includes('Search:') && row.includes('gl'))).toBe(true)
    component.handleInput(KEY.escape)
    rows = component.render(60)
    expect(rows.some(row => row.includes('deepseek/deepseek-chat'))).toBe(true)
  })

})

describe('cycleSegment', () => {
  it('holds the index when there are no segments', () => {
    expect(cycleSegment(0, 0, 1)).toBe(0)
  })
})

describe('EffortPanel', () => {
  const segments = [
    { id: 'default', label: 'Default' },
    { id: 'low', label: 'Low' },
    { id: 'high', label: 'High' },
  ]

  function effortPanel(activeIndex = 0) {
    const { theme, keymap, components } = fakeBlueContext()
    const onSelect = vi.fn()
    const onSessionOnlySelect = vi.fn()
    const onCancel = vi.fn()
    const component = new EffortPanel({
      keymap, theme, components, segments, activeIndex, onSelect, onSessionOnlySelect, onCancel,
    })
    return { component, onSelect, onSessionOnlySelect, onCancel }
  }

  it('renders the horizontal segments with the active one bracketed', () => {
    const { component } = effortPanel(1)
    const rows = component.render(60)
    const segmentRow = rows.find(row => row.includes('[ Low ]') || row.includes('[ High ]'))
    expect(segmentRow).toBeDefined()
    expect(segmentRow).toContain('[ Low ]')
    expect(segmentRow).toContain('  High  ')
  })

  it('cycles with ←/→ wraparound, commits with Enter, and honors Alt+S', () => {
    const { component, onSelect, onSessionOnlySelect } = effortPanel(0)
    component.handleInput(KEY.right)
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenCalledWith('low')
    component.handleInput(KEY.right)
    component.handleInput(KEY.right)
    // From `high`, right wraps back to `default`.
    component.handleInput(KEY.enter)
    expect(onSelect).toHaveBeenLastCalledWith('default')
    component.handleInput(KEY.left)
    component.handleInput(KEY.altS)
    expect(onSessionOnlySelect).toHaveBeenCalledWith('high')
  })

  it('cancels with Escape', () => {
    const { component, onCancel } = effortPanel()
    component.handleInput(KEY.escape)
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('ignores keys with an empty segment set', () => {
    const { theme, keymap } = fakeBlueContext()
    const onSelect = vi.fn()
    const component = new EffortPanel({
      keymap, theme, components: fakeBlueContext().components, segments: [], activeIndex: 0, onSelect, onSessionOnlySelect: vi.fn(), onCancel: vi.fn(),
    })
    component.handleInput(KEY.enter)
    component.handleInput('x')
    expect(onSelect).not.toHaveBeenCalled()
    component.invalidate()
  })
})
