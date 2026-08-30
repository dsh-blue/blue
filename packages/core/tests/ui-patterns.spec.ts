/** Private L2 pattern presentation and degradation behavior. */
import { describe, expect, it, vi } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import {
  renderActions,
  renderDivider,
  renderEmpty,
  renderFormField,
  renderList,
  renderLoader,
  renderProgress,
  renderSurfaceHead,
  renderSurfaceTail,
  renderTabs,
  type PatternFocus,
} from '../src/ui-patterns.ts'
import type { BlueSemanticColors } from '../src/types.ts'
import { visibleWidth } from '../src/width.ts'

const identity = (value: string): string => value
const colors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity }) as BlueSemanticColors
const idle: PatternFocus = { key: '', focused: false, marker: '|' }

describe('private UI pattern painters', () => {
  it('renders distinct surface chrome and every badge tone', () => {
    const badges = [
      { text: 'default' },
      { text: 'muted', tone: 'muted' as const },
      { text: 'accent', tone: 'accent' as const },
      { text: 'success', tone: 'success' as const },
      { text: 'warning', tone: 'warning' as const },
      { text: 'danger', tone: 'danger' as const, emphasis: 'strong' as const },
    ]
    const none = ui.surface({ title: 'Title', subtitle: 'Subtitle', badges, child: ui.text('body') })
    expect(renderSurfaceHead(none, 120, colors)).toHaveLength(3)
    expect(renderSurfaceTail(none, 20, colors)).toEqual([])
    expect(renderSurfaceHead(ui.surface({ child: ui.text('body') }), 20, colors)).toEqual([])

    const lane = ui.surface({ chrome: 'lane', title: 'Lane', child: ui.text('body') })
    const surface = ui.surface({ chrome: 'surface', child: ui.text('body') })
    const overlay = ui.surface({ chrome: 'overlay', title: 'Overlay', child: ui.text('body') })
    expect(renderSurfaceHead(lane, 20, colors)[0]).toContain('─ Lane')
    expect(renderSurfaceTail(lane, 20, colors)).toEqual([])
    expect(renderSurfaceHead(surface, 1, colors)).toEqual(['┌'])
    expect(renderSurfaceTail(surface, 1, colors)).toEqual(['└'])
    expect(renderSurfaceHead(overlay, 20, colors)[0]).toContain('╭ Overlay')
    expect(renderSurfaceTail(overlay, 20, colors)[0]).toContain('╰')
    expect(renderSurfaceHead(overlay, 8, colors)).toEqual(['╭ Ove ─╮'])
    expect(renderSurfaceHead(overlay, 2, colors)).toEqual(['╭╮'])
    expect(renderSurfaceHead(overlay, 1, colors)).toEqual(['╭'])
  })

  it('keeps tab active state separate from focus and collapses counts first', () => {
    const node = ui.tabs({ id: 'tabs', activeId: 'a', items: [
      { id: 'a', label: 'Alpha', count: 12 },
      { id: 'b', label: 'Beta', disabled: true, count: 3 },
      { id: 'c', label: 'Gamma', count: 4 },
    ] })
    const wide = renderTabs(node, 80, idle, colors)[0]!
    expect(wide).toContain('‹ ● Alpha › 12')
    expect(wide).toContain('○ Beta 3')
    const forty = renderTabs(node, 40, { key: 'c', focused: true, marker: '|' }, colors)[0]!
    expect(forty).not.toContain('12')
    expect(forty).toContain('|→ ○ Gamma')
    expect(renderTabs(node, 40, { key: 'a', focused: true, marker: '|' }, colors)[0]).toContain('| ‹ ● Alpha ›')
    const disabled = renderTabs(node, 40, { key: 'b', focused: true, marker: '|' }, colors)[0]!
    expect(disabled).toContain('○ Beta')
    expect(disabled).not.toContain('|')
    expect(disabled).not.toContain('→')
    const disabledActive = renderTabs({ ...node, activeId: 'b' }, 40, idle, colors)[0]!
    expect(disabledActive).toContain('‹ ● Beta ›')
    const narrow = renderTabs(node, 11, { key: 'c', focused: true, marker: '|' }, colors)[0]!
    expect(visibleWidth(narrow)).toBeLessThanOrEqual(11)
    expect(narrow).toContain('|→ ○ Gamma')
    expect(renderTabs(node, 5, idle, colors)[0]).toHaveLength(5)
    expect(renderTabs(node, 1, { key: 'c', focused: true, marker: '|' }, colors)[0]).toHaveLength(1)
    const primary = vi.fn(identity)
    const text = vi.fn(identity)
    const palette = new Proxy(colors, { get: (target, key, receiver) => key === 'primary' ? primary : key === 'text' ? text : Reflect.get(target, key, receiver) })
    renderTabs(node, 40, { key: 'c', focused: true, marker: '|' }, palette)
    expect(primary).toHaveBeenCalledWith('‹ ● Alpha ›')
    expect(text).toHaveBeenCalledWith('○ Gamma')
  })

  it('renders list selection, focus, groups, filtering, detail degradation, and windows', () => {
    const selectedBg = vi.fn(identity)
    const primary = vi.fn(identity)
    const tracked = new Proxy(colors, { get: (target, key, receiver) => key === 'selectedBg' ? selectedBg : key === 'primary' ? primary : Reflect.get(target, key, receiver) })
    const node = ui.list({
      id: 'list', mode: 'multiple', selectedIds: ['a', 'd'], filter: 'term',
      items: [
        { id: 'a', label: 'Alpha', detail: 'detail-a', badge: 'hot', group: 'One' },
        { id: 'b', label: 'Beta', detail: 'detail-b', group: 'One', disabled: true },
        { id: 'c', label: 'Gamma', group: 'Two' },
        { id: 'd', label: 'Delta' },
        { id: 'e', label: 'Epsilon' },
      ],
    })
    const idleRows = renderList(node, 80, 20, idle, tracked)
    expect(idleRows.join('\n')).toContain('/ term')
    expect(idleRows.join('\n')).toContain('detail-a')
    expect(idleRows.join('\n')).toContain('[hot]')
    expect(idleRows.join('\n')).toContain('● Alpha')
    const alpha = idleRows.find(row => row.includes('Alpha'))!
    expect(alpha.indexOf('[hot]')).toBeLessThan(alpha.indexOf('detail-a'))
    expect(selectedBg).not.toHaveBeenCalled()

    const focusedRows = renderList(node, 40, 3, { key: 'd', focused: true, marker: '|' }, tracked)
    expect(focusedRows).toHaveLength(3)
    expect(focusedRows.join('\n')).toContain('|→ Delta')
    expect(focusedRows.join('\n')).not.toContain('detail-a')
    expect(selectedBg).toHaveBeenCalledOnce()
    selectedBg.mockClear()
    primary.mockClear()
    const unselectedFocus = renderList(node, 80, 20, { key: 'c', focused: true, marker: '|' }, tracked)
    expect(unselectedFocus.join('\n')).toContain('|→ Gamma')
    expect(selectedBg).toHaveBeenCalledOnce()
    expect(primary).toHaveBeenCalledWith(expect.stringContaining('|→ Gamma'))
    expect(visibleWidth(selectedBg.mock.calls[0]![0])).toBe(80)
    expect(renderList(node, 20, 2, { key: 'missing', focused: true, marker: '|' }, colors)[0]).toContain('/ term')
    expect(renderList(node, 20, Number.NaN, { key: 'e', focused: true, marker: '|' }, colors)).toHaveLength(1)
    expect(renderList(ui.list({ id: 'single', selectedIds: [], items: [{ id: 'x', label: 'X' }] }), 20, 3, idle, colors)).toEqual(['   X'])
    expect(renderList(node, 80, 2, { key: 'a', focused: true, marker: '|' }, colors).join('\n')).toContain('detail-a')
    expect(renderList(node, 40, 2, { key: 'a', focused: true, marker: '|' }, colors).join('\n')).not.toContain('detail-a')

    const nestedPaint = new Proxy(colors, { get: (target, key, receiver) => {
      if (key === 'primary') return (value: string) => `<primary>${value}</primary>`
      if (key === 'muted') return (value: string) => `<muted>${value}</muted>`
      return Reflect.get(target, key, receiver)
    } })
    const disabledSelected = renderList(ui.list({ id: 'disabled', selectedIds: ['x'], items: [{ id: 'x', label: 'X', disabled: true }] }), 80, 3, { key: 'x', focused: true, marker: '|' }, nestedPaint)[0]!
    expect(disabledSelected).toContain('<muted>')
    expect(disabledSelected).not.toContain('<primary>')
    expect(disabledSelected).not.toContain('|')
  })

  it('paints structured list detail spans without losing semantics on focused rows', () => {
    const accent = vi.fn((value: string) => `<accent>${value}</accent>`)
    const muted = vi.fn((value: string) => `<muted>${value}</muted>`)
    const selectedBg = vi.fn(identity)
    const tracked = new Proxy(colors, { get: (target, key, receiver) => {
      if (key === 'accent') return accent
      if (key === 'muted') return muted
      if (key === 'selectedBg') return selectedBg
      return Reflect.get(target, key, receiver)
    } })
    const node = ui.list({
      id: 'variants', selectedIds: ['model'], items: [{
        id: 'model', label: 'Model', detail: 'legacy detail',
        detailSpans: [
          { text: 'ctx 64k' },
          { text: ' [Low]', tone: 'muted' },
          { text: ' [High]', tone: 'accent', emphasis: 'strong' },
        ],
      }],
    })

    const idleRow = renderList(node, 80, 2, idle, tracked)[0]!
    expect(idleRow).toContain('ctx 64k')
    expect(idleRow).not.toContain('legacy detail')
    expect(idleRow).toContain('<muted> [Low]</muted>')
    expect(idleRow).toContain('\x1b[1m<accent> [High]</accent>\x1b[22m')
    expect(accent).toHaveBeenCalledTimes(1)

    const focusedRow = renderList(node, 80, 2, { key: 'model', focused: true, marker: '|' }, tracked)[0]!
    expect(focusedRow).toContain('<muted> [Low]</muted>')
    expect(focusedRow).toContain('\x1b[1m<accent> [High]</accent>\x1b[22m')
    expect(selectedBg).toHaveBeenCalledOnce()
    expect(renderList(node, 40, 2, idle, tracked)[0]).not.toContain('High')
    expect(renderList(ui.list({ id: 'empty-detail', selectedIds: [], items: [{ id: 'x', label: 'X', detailSpans: [] }] }), 80, 2, idle, tracked)[0]).toBe('   X')
  })

  it('renders every form field state with validation on its own row', () => {
    const focus = { key: 'input', focused: true, marker: '|' }
    expect(renderFormField({ kind: 'input', id: 'input', label: 'Input', value: '', placeholder: 'hint', error: 'required' }, 40, focus, colors)).toEqual([
      '|→ Input: hint',
      '   ! required',
    ])
    expect(renderFormField({ kind: 'textarea', id: 'text', label: 'Text', value: '' }, 20, idle, colors)[0]).toBe('   Text: ')
    expect(renderFormField({ kind: 'textarea', id: 'text', label: 'Text', value: 'body' }, 20, idle, colors)[0]).toContain('body')
    expect(renderFormField({ kind: 'secret', id: 'secret', label: 'Secret', value: '', placeholder: 'secret' }, 20, idle, colors)[0]).toContain('secret')
    expect(renderFormField({ kind: 'secret', id: 'secret', label: 'Secret', value: '' }, 20, idle, colors)[0]).toBe('   Secret: ')
    expect(renderFormField({ kind: 'secret', id: 'secret', label: 'Secret', value: 'abc' }, 20, idle, colors)[0]).toContain('•••')
    expect(renderFormField({ kind: 'select', id: 'select', label: 'Select', value: null, options: [] }, 20, idle, colors)[0]).toContain('Choose…')
    expect(renderFormField({ kind: 'select', id: 'select', label: 'Select', value: 'a', options: [{ id: 'a', label: 'Alpha' }] }, 20, idle, colors)[0]).toContain('Alpha')
    expect(renderFormField({ kind: 'select', id: 'select', label: 'Select', value: 'missing', options: [] }, 20, idle, colors)[0]).toContain('missing')
    expect(renderFormField({ kind: 'toggle', id: 'toggle', label: 'Toggle', value: true }, 20, idle, colors)[0]).toContain('[on]')
    expect(renderFormField({ kind: 'toggle', id: 'toggle', label: 'Toggle', value: false, disabled: true }, 5, idle, colors)[0]).toHaveLength(5)
    const mutedOnly = new Proxy(colors, { get: (target, key, receiver) => key === 'muted'
      ? (value: string) => `<muted>${value}</muted>`
      : key === 'text' || key === 'textStrong' ? (value: string) => `<foreground>${value}</foreground>` : Reflect.get(target, key, receiver) })
    const disabled = renderFormField({ kind: 'input', id: 'disabled', label: 'Disabled', value: 'value', disabled: true }, 80, idle, mutedOnly)[0]!
    expect(disabled).toContain('<muted>')
    expect(disabled).not.toContain('<foreground>')
    expect(renderFormField({ kind: 'input', id: 'disabled', label: 'Disabled', value: '', disabled: true }, 80, { key: 'disabled', focused: true, marker: '|' }, colors)[0]).not.toContain('|')
    const focusPalette = new Proxy(colors, { get: (target, key, receiver) => key === 'primary' ? (value: string) => `<primary>${value}</primary>` : Reflect.get(target, key, receiver) })
    expect(renderFormField({ kind: 'input', id: 'focused', label: 'Focused', value: 'value' }, 80, { key: 'focused', focused: true, marker: '|' }, focusPalette)[0]).toContain('<primary>|→ Focused: value</primary>')
  })

  it('renders action intents, busy/confirm states, deterministic loaders, and empty groups', () => {
    const node = ui.actions({ id: 'actions', items: [
      { id: 'primary', label: 'Run', intent: 'primary' },
      { id: 'secondary', label: 'Later', intent: 'secondary', confirm: 'sure' },
      { id: 'danger', label: 'Delete', intent: 'danger' },
      { id: 'busy', label: 'Wait', busy: true },
      { id: 'disabled', label: 'No', disabled: true },
    ] })
    const vertical = renderActions(node, 40, { key: 'secondary', focused: true, marker: '|', pendingKey: 'secondary' }, colors, true)
    expect(vertical).toHaveLength(5)
    expect(vertical.join('\n')).toContain('[ Run ]')
    expect(vertical.join('\n')).toContain('|Later ? sure')
    expect(vertical.join('\n')).toContain('! Delete')
    expect(renderActions(node, 40, { key: 'danger', focused: true, marker: '|' }, colors, true).join('\n')).toContain('|! Delete')
    expect(vertical.join('\n')).toContain('… Wait')
    expect(renderActions(node, 80, { key: 'busy', focused: true, marker: '|', pendingKey: 'busy' }, colors, true).join('')).not.toContain('|')
    expect(renderActions(node, 80, { key: 'disabled', focused: true, marker: '|', pendingKey: 'disabled' }, colors, true).join('')).not.toContain('|')
    const actionPalette = new Proxy(colors, { get: (target, key, receiver) => key === 'primary' ? (value: string) => `<primary>${value}</primary>` : Reflect.get(target, key, receiver) })
    expect(renderActions(node, 80, { key: 'secondary', focused: true, marker: '|' }, actionPalette, true).join('\n')).toContain('|<primary>Later</primary>')
    expect(visibleWidth(renderActions(node, 10, { key: 'danger', focused: true, marker: '|' }, colors, false)[0]!)).toBeLessThanOrEqual(10)
    expect(renderActions(ui.actions({ id: 'empty', items: [] }), 10, idle, colors, false)).toEqual([])
    expect(renderLoader(ui.loader({ message: 'Load' }), 20, colors)).toEqual(['⠋ Load'])
    expect(renderLoader(ui.loader({ message: 'Tide', variant: 'tide', elapsedMs: 25 }), 20, colors)).toEqual(['≈ Tide 25ms'])
    expect(renderEmpty(ui.empty({ title: 'Nothing', description: 'Try again' }), 20, colors)).toEqual(['Nothing', 'Try again'])
    const narrowEmpty = renderEmpty(ui.empty({ title: 'Nothing' }), 3, colors)
    expect(narrowEmpty.join('')).toBe('Nothing')
    expect(narrowEmpty.every(row => visibleWidth(row) <= 3)).toBe(true)
  })

  it('uses eighth-block progress and semantic dividers at degenerate widths', () => {
    expect(renderProgress(ui.progress({ label: 'Half', value: 1, max: 2 }), 20, colors)[0]).toContain('Half ')
    expect(renderProgress(ui.progress({ value: 1, max: 3 }), 8, colors)[0]).toMatch(/[▏▎▍▌▋▊▉]/u)
    expect(renderProgress(ui.progress({ value: 0, max: 2 }), 2, colors)).toEqual(['░░'])
    expect(renderProgress(ui.progress({ value: 2, max: 2 }), 2, colors)).toEqual(['██'])
    expect(renderDivider(undefined, 3, colors)).toEqual(['───'])
    expect(renderDivider('long label', 3, colors)[0]).toHaveLength(3)
    expect(renderDivider(undefined, Number.NaN, colors)).toEqual(['─'])
  })
})
