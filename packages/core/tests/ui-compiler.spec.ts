/** Canonical compiler layout, focus, event, width, and failure containment. */
import { CURSOR_MARKER, HStack, ScrollView } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import { compileBlueUiNode, type BlueUiCompilerOptions } from '../src/ui-compiler.ts'
import type { BlueComponents, BlueSemanticColors } from '../src/types.ts'
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'

const identity = (value: string): string => value
const colors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity }) as BlueSemanticColors
const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
} as BlueComponents

function fixture(overrides: Partial<BlueUiCompilerOptions> = {}): { options: BlueUiCompilerOptions, events: unknown[], viewport: { columns: number, rows: number } } {
  const events: unknown[] = []
  const viewport = { columns: 80, rows: 20 }
  return {
    events,
    viewport,
    options: {
      components,
      colors,
      getViewport: () => viewport,
      screenMode: 'alternate',
      emit: event => events.push(event),
      ...overrides,
    },
  }
}

function compiled(value: unknown, options: BlueUiCompilerOptions) {
  const result = compileBlueUiNode(value, options)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

describe('compileBlueUiNode', () => {
  it('compiles builders and equivalent handwritten nodes identically', () => {
    const built = ui.stack.row([ui.text('left'), ui.divider({ label: 'middle' }), ui.text('right')], { gap: 1 })
    const hand = { kind: 'stack', direction: 'row', gap: 1, children: [{ node: { kind: 'text', content: 'left' } }, { node: { kind: 'divider', label: 'middle' } }, { node: { kind: 'text', content: 'right' } }] }
    const a = fixture()
    const b = fixture()
    expect(compiled(built, a.options).component.render(60)).toEqual(compiled(hand, b.options).component.render(60))
  })

  it('compiles every non-BlueView node kind into width-safe rows', () => {
    const tree = ui.stack.column([
      ui.richText([{ text: 'rich' }]),
      ui.surface({ title: 'surface', child: ui.text('child'), footer: ui.text('footer') }),
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', disabled: true }] }),
      ui.list({ id: 'list', selectedIds: ['a'], items: [{ id: 'a', label: 'A' }] }),
      ui.form({ id: 'form', fields: [{ kind: 'secret', id: 'secret', label: 'Secret', value: 'value' }, { kind: 'toggle', id: 'toggle', label: 'Toggle', value: false }] }),
      ui.actions({ id: 'actions', items: [{ id: 'go', label: 'Go' }] }),
      ui.loader({ message: 'load', variant: 'braille', elapsedMs: 3, cancelActionId: 'cancel' }),
      ui.empty({ title: 'empty', description: 'description' }),
      ui.progress({ value: 1, max: 2 }),
      ui.spacer(),
      ui.divider(),
    ])
    const { options } = fixture()
    const result = compiled(tree, options)
    for (const width of [1, 2, 5, 20, 80]) {
      expect(result.component.render(width).every(row => visibleWidth(row.replaceAll(CURSOR_MARKER, '')) <= width)).toBe(true)
    }
    expect(result.focusTarget).not.toBeNull()
    result.component.invalidate()
  })

  it('renders all surface chrome content, rich emphasis, and explicit stack sizing', () => {
    const { options } = fixture()
    const tree = ui.stack.row([
      ui.child(ui.surface({ title: 'Title', subtitle: 'Subtitle', badges: [{ text: 'Badge', emphasis: 'strong' }], padding: 1, child: ui.richText([{ text: 'Body', emphasis: 'strong' }]), footer: ui.text('Footer') }), { basis: 'auto', grow: 1, shrink: 0, minSize: 2, maxSize: 100 }),
      ui.child(ui.text('hidden'), { when: { maxWidth: 10, minHeight: 30 } }),
    ], { align: 'end' })
    const rows = compiled(tree, options).component.render(80)
    expect(rows.join('\n')).toContain('Title')
    expect(rows.join('\n')).toContain('Subtitle')
    expect(rows.join('\n')).toContain('Badge')
    expect(rows.join('\n')).toContain('Body')
    expect(rows.join('\n')).toContain('Footer')
    expect(rows.join('\n')).not.toContain('hidden')
  })

  it('builds alternate public scroll as non-primary and omits it in main mode', () => {
    const node = ui.scroll(ui.text('scroll'), { follow: 'end', scrollbar: true })
    const alternate = compiled(node, fixture().options)
    const altRoot = (alternate.component as unknown as { root: unknown }).root
    expect(altRoot).toBeInstanceOf(ScrollView)
    expect((altRoot as ScrollView).primary).toBe(false)

    const mainFixture = fixture({ screenMode: 'main' })
    const main = compiled(node, mainFixture.options)
    expect((main.component as unknown as { root: unknown }).root).not.toBeInstanceOf(ScrollView)
    expect(main.component.render(20).join('')).toContain('scroll')
  })

  it('degrades row stacks into MainScreen document order', () => {
    const { options } = fixture({ screenMode: 'main' })
    const result = compiled(ui.stack.row([ui.text('first'), ui.text('second'), ui.text('third')]), options)
    expect(result.component.render(20)).toEqual(['first', 'second', 'third'])
  })

  it('keeps the complete linear document in MainScreen mode', () => {
    const { options } = fixture({ screenMode: 'main', getViewport: () => ({ columns: 20, rows: 2 }) })
    const result = compiled(ui.stack.column(Array.from({ length: 30 }, (_, index) => ui.text(`line-${String(index)}`))), options)
    expect(result.component.render(20)).toHaveLength(30)
    expect(result.component.render(20).at(-1)).toBe('line-29')
  })

  it('keeps stack sizing independent of the viewport at compile time', () => {
    const current = { columns: 40, rows: 20 }
    const { options } = fixture({ getViewport: () => current })
    const result = compiled(ui.stack.row([
      ui.child(ui.divider(), { basis: 80, shrink: 0 }),
      ui.child(ui.divider(), { basis: 40, shrink: 0 }),
    ]), options)
    current.columns = 120
    expect(visibleWidth(result.component.render(120)[0]!)).toBe(120)
  })

  it('uses one roving focus target, skips disabled controls, and dispatches structured events', () => {
    const { options, events } = fixture()
    const result = compiled(ui.actions({ id: 'actions', items: [{ id: 'one', label: 'One' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'three', label: 'Three' }] }), options)
    const focus = result.focusTarget!
    expect(focus).toBe(result.component)
    focus.focused = true
    expect(focus.render(40).join('')).toContain(CURSOR_MARKER)
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'three' }])
    focus.handleInput?.('\x1b[Z')
    focus.handleInput?.(' ')
    expect(events.at(-1)).toEqual({ kind: 'activate', controlId: 'one' })
  })

  it('reconciles focus deterministically when a responsive child disappears', () => {
    const { options, events, viewport } = fixture()
    const tree = ui.stack.row([
      ui.child(ui.actions({ id: 'left', items: [{ id: 'left-action', label: 'Left' }] })),
      ui.child(ui.actions({ id: 'right', items: [{ id: 'right-action', label: 'Right' }] }), { when: { minWidth: 60 } }),
    ])
    const result = compiled(tree, options)
    const focus = result.focusTarget!
    focus.focused = true
    focus.render(80)
    focus.handleInput?.('\t')
    viewport.columns = 40
    focus.render(40)
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'left-action' }])
  })

  it('evaluates every viewport boundary against the live pane snapshot', () => {
    const { options, viewport } = fixture()
    const tree = ui.stack.column([
      ui.child(ui.text('bounded'), { when: { minWidth: 70, maxWidth: 90, minHeight: 10, maxHeight: 30 } }),
    ])
    expect(compiled(tree, options).component.render(80)).toEqual(['bounded'])
    viewport.rows = 31
    expect(compiled(tree, options).component.render(80)).toEqual([])
  })

  it('retains a structural focus target when every control starts hidden', () => {
    const { options, viewport } = fixture()
    viewport.columns = 40
    const result = compiled(ui.stack.column([ui.child(ui.actions({ id: 'later', items: [{ id: 'later-action', label: 'Later' }] }), { when: { minWidth: 60 } })]), options)
    expect(result.focusTarget).not.toBeNull()
    expect(result.component.render(40).join('')).not.toContain(CURSOR_MARKER)
    viewport.columns = 80
    result.focusTarget!.focused = true
    expect(result.component.render(80).join('').match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
  })

  it('preserves the roving index across overlay-style focused false -> true', () => {
    const { options, events } = fixture()
    const focus = compiled(ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), options).focusTarget!
    focus.focused = true
    focus.handleInput?.('\t')
    focus.focused = false
    expect(focus.render(20).join('')).not.toContain(CURSOR_MARKER)
    focus.focused = true
    expect(focus.render(20).join('')).toContain(CURSOR_MARKER)
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'tab-change', controlId: 'tabs', tabId: 'b' }])
  })

  it('inserts its marker only after HStack composition', () => {
    const upstream = new HStack([], { gap: 1 })
    upstream.addChild({ render: () => [`> ${CURSOR_MARKER}alpha`], invalidate: () => {} }, { basis: 7 })
    upstream.addChild({ render: () => ['beta'], invalidate: () => {} }, { basis: 4 })
    expect(upstream.render(10).join('')).not.toContain('alpha')

    const { options } = fixture()
    const focus = compiled(ui.actions({ id: 'actions', items: [{ id: 'alpha', label: 'alpha' }, { id: 'beta', label: 'beta' }] }), options).focusTarget!
    focus.focused = true
    const row = focus.render(40).join('')
    expect(row).toContain('alpha')
    expect(row).toContain('beta')
    expect(row.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
  })

  it('cannot be tricked into extra markers by canonical user text', () => {
    const { options } = fixture()
    const focus = compiled(ui.stack.column([
      ui.text(`fake \uf8ff ${CURSOR_MARKER}`),
      ui.actions({ id: 'actions', items: [{ id: 'real', label: 'Real' }] }),
    ]), options).focusTarget!
    focus.focused = true
    expect(focus.render(40).join('').match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
    focus.focused = false
    expect(focus.render(40).join('')).not.toContain(CURSOR_MARKER)
  })

  it('keeps controlled list/form values while emitting proposed changes', () => {
    const { options, events } = fixture()
    const list = compiled(ui.list({ id: 'list', mode: 'multiple', selectedIds: ['a'], items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), options)
    list.focusTarget!.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'selection-change', controlId: 'list', value: [] }])
    expect(list.node).toMatchObject({ selectedIds: ['a'] })
  })

  it('dispatches list-add, form toggle/submit/cancel, loader and empty actions', () => {
    const { options, events } = fixture()
    const tree = ui.stack.column([
      ui.list({ id: 'list', mode: 'multiple', selectedIds: [], items: [{ id: 'item', label: 'Item' }] }),
      ui.form({ id: 'form', fields: [{ kind: 'toggle', id: 'toggle', label: 'Toggle', value: false }, { kind: 'select', id: 'select', label: 'Select', value: null, options: [] }], submitActionId: 'submit', cancelActionId: 'cancel' }),
      ui.loader({ message: 'Load', cancelActionId: 'loader-cancel' }),
      ui.empty({ title: 'Empty', actions: ui.actions({ id: 'empty-actions', items: [{ id: 'empty-go', label: 'Go' }] }) }),
    ])
    const focus = compiled(tree, options).focusTarget!
    for (let index = 0; index < 7; index += 1) {
      focus.handleInput?.('\r')
      focus.handleInput?.('\t')
    }
    expect(events).toEqual([
      { kind: 'selection-change', controlId: 'list', value: ['item'] },
      { kind: 'value-change', controlId: 'toggle', value: true },
      { kind: 'value-change', controlId: 'select', value: null },
      { kind: 'submit', controlId: 'form', values: { toggle: false, select: null } },
      { kind: 'activate', controlId: 'cancel' },
      { kind: 'activate', controlId: 'loader-cancel' },
      { kind: 'activate', controlId: 'empty-go' },
    ])
  })

  it('handles empty controls/lists and alternate backward keys', () => {
    const { options } = fixture()
    const passive = compiled(ui.stack.column([ui.list({ id: 'empty-list', selectedIds: [], items: [] }), ui.actions({ id: 'none', items: [] })]), options)
    expect(passive.focusTarget).toBeNull()
    expect(() => passive.component.handleInput?.('\r')).not.toThrow()
    expect(passive.component.render(20)).toEqual([])

    const focus = compiled(ui.actions({ id: 'a', items: [{ id: 'one', label: 'One' }, { id: 'busy', label: 'Busy', busy: true }, { id: 'two', label: 'Two' }] }), options).focusTarget!
    focus.handleInput?.('\x1b[A')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\x1b[D')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('x')
  })

  it('renders optional and disabled control variants', () => {
    const tree = ui.stack.column([
      ui.surface({ child: ui.text('bare surface') }),
      ui.scroll(ui.text('plain scroll')),
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A', count: 2 }] }),
      ui.list({ id: 'disabled-list', selectedIds: [], items: [{ id: 'disabled', label: 'Disabled', disabled: true, detail: 'detail', badge: 'badge' }] }),
      ui.list({ id: 'single-list', selectedIds: [], items: [{ id: 'single', label: 'Single' }] }),
      ui.list({ id: 'fallback-list', selectedIds: [], items: [], empty: ui.actions({ id: 'fallback', items: [{ id: 'fallback-action', label: 'Fallback' }] }) }),
      ui.form({ id: 'form', fields: [
        { kind: 'input', id: 'input', label: 'Input', value: 'value', error: 'bad', disabled: true },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      ] }),
      ui.actions({ id: 'actions', items: [{ id: 'go', label: 'Go' }] }),
      ui.loader({ message: 'tide', variant: 'tide' }),
      ui.progress({ label: 'done', value: 1, max: 2 }),
    ])
    const alternate = compiled(tree, fixture().options)
    expect(alternate.component.render(80).join('\n')).toContain('Fallback')

    const main = compiled(tree, fixture({ screenMode: 'main' }).options)
    expect(main.component.render(80).join('\n')).toContain('done')
  })

  it('returns bounded error surfaces and contains render/event sink failures', () => {
    const invalid = compileBlueUiNode({ kind: 'custom' }, fixture().options)
    expect(invalid).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    if (invalid.ok) throw new Error('expected failure')
    for (const width of [1, 2, 10]) {
      const rows = invalid.errorComponent.render(width)
      expect(rows.length).toBeLessThanOrEqual(3)
      expect(rows.every(row => visibleWidth(row) <= width)).toBe(true)
    }

    const unicode = compileBlueUiNode({ kind: '界🙂' }, fixture().options)
    if (unicode.ok) throw new Error('expected failure')
    const unicodeRows = unicode.errorComponent.render(20)
    expect(unicodeRows.join('')).toContain('界🙂')
    expect(unicodeRows.every(row => visibleWidth(row) <= 20)).toBe(true)

    const boundary = compileBlueUiNode({ kind: `${'x'.repeat(19)}界` }, fixture().options)
    if (boundary.ok) throw new Error('expected failure')
    expect(boundary.errorComponent.render(20).every(row => visibleWidth(row) <= 20)).toBe(true)

    const throwingComponents = { ...components, wrapText: () => { throw new Error('render exploded') } } as BlueComponents
    const rendered = compiled(ui.text('safe'), fixture({ components: throwingComponents }).options).component.render(12)
    expect(rendered.join('')).toContain('render')
    expect(rendered.every(row => visibleWidth(row) <= 12)).toBe(true)

    const event = compiled(ui.actions({ id: 'a', items: [{ id: 'go', label: 'Go' }] }), fixture({ emit: () => { throw new Error('sink') } }).options).focusTarget!
    expect(() => event.handleInput?.('\r')).not.toThrow()
    event.invalidate()

    const nonErrorComponents = { ...components, wrapText: () => { throw 'non-error' } } as BlueComponents
    expect(compiled(ui.richText([{ text: 'x' }]), fixture({ components: nonErrorComponents }).options).component.render(12).join('')).toContain('unknown')

    const overwideComponents = { ...components, wrapText: () => ['overwide row'] } as BlueComponents
    expect(compiled(ui.richText([{ text: 'x' }]), fixture({ components: overwideComponents }).options).component.render(4).every(row => visibleWidth(row) <= 4)).toBe(true)
  })

  it('contains viewport and semantic paint failures', () => {
    const brokenColors = new Proxy(colors, { get: () => { throw new Error('paint') } })
    const { options } = fixture({ colors: brokenColors, getViewport: () => { throw new Error('viewport') } })
    const result = compileBlueUiNode({ kind: 'custom' }, options)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(() => result.errorComponent.render(8)).not.toThrow()
    expect(result.errorComponent.render(8).every(row => visibleWidth(sliceByColumn(row, 0, 8, true)) <= 8)).toBe(true)
    result.errorComponent.invalidate()

    const invalidViewport = fixture({ getViewport: () => ({ columns: Number.NaN, rows: Number.POSITIVE_INFINITY }) })
    expect(compiled(ui.text('x'), invalidViewport.options).component.render(Number.NaN)).toHaveLength(1)

    const widePaint = new Proxy(colors, { get: (_target, key) => key === 'error' ? (value: string) => `${value}too-wide` : identity })
    const failed = compileBlueUiNode({}, fixture({ colors: widePaint as BlueSemanticColors }).options)
    if (failed.ok) throw new Error('expected failure')
    expect(failed.errorComponent.render(2).every(row => visibleWidth(row) <= 2)).toBe(true)
    expect(failed.errorComponent.render(Number.NaN)).toHaveLength(3)

    const throwingViewport = fixture({ getViewport: () => { throw new Error('viewport') } })
    expect(compiled(ui.text('x'), throwingViewport.options).component.render(8)).toEqual(['x'])
  })

  it('contains compiler setup failures', () => {
    const base = fixture().options
    const options = new Proxy(base, { get: (target, key, receiver) => {
      if (key === 'getViewport') throw new Error('setup')
      return Reflect.get(target, key, receiver)
    } })
    expect(compileBlueUiNode(ui.text('x'), options)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue UI compilation failed safely' })
  })
})
