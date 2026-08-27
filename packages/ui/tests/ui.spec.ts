import { describe, expect, it } from 'vitest'
import { BLUE_API_VERSION, deepFreeze, defineBlueComponent, ui } from '../src/index.ts'

function expectDeepFrozen(value: unknown, seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child, seen)
}

describe('ui builders', () => {
  it('builds and freezes every content leaf without changing its wire shape', () => {
    const leaves = [
      ui.text('hello', { tone: 'accent' }),
      ui.fields([{ label: 'branch', value: [{ text: 'main', emphasis: 'strong' }] }]),
      ui.code('const value = 1', { language: 'ts' }),
      ui.diff('before', 'after'),
      ui.sections([{ title: 'Details', body: { kind: 'text', content: 'body' }, collapsed: false }]),
      ui.richText([{ text: 'ready', tone: 'success' }]),
    ]
    expect(leaves).toEqual([
      { kind: 'text', content: 'hello', tone: 'accent' },
      { kind: 'fields', rows: [{ label: 'branch', value: [{ text: 'main', emphasis: 'strong' }] }] },
      { kind: 'code', code: 'const value = 1', language: 'ts' },
      { kind: 'diff', before: 'before', after: 'after' },
      { kind: 'sections', sections: [{ title: 'Details', body: { kind: 'text', content: 'body' }, collapsed: false }] },
      { kind: 'rich-text', spans: [{ text: 'ready', tone: 'success' }] },
    ])
    for (const leaf of leaves) expectDeepFrozen(leaf)
  })

  it('builds explicit children, both stack directions, surfaces, and scrolls', () => {
    const first = ui.child(ui.text('first'), {
      basis: 'auto', grow: 1, shrink: 0, minSize: 2, maxSize: 20,
      when: { minWidth: 40, maxWidth: 120, minHeight: 10, maxHeight: 50 },
    })
    const second = ui.child(ui.scroll(ui.text('second'), { follow: 'end', scrollbar: true }))
    const row = ui.stack.row([first], { gap: 1, align: 'center' })
    const column = ui.stack.column([ui.child(row), second], { gap: 2, align: 'stretch' })
    const node = ui.surface({
      title: 'Inspector', subtitle: 'Live', badges: [{ text: '2' }], chrome: 'surface', padding: 1,
      child: column, footer: ui.divider({ label: 'End' }),
    })
    expect(node).toEqual({
      kind: 'surface', title: 'Inspector', subtitle: 'Live', badges: [{ text: '2' }], chrome: 'surface', padding: 1,
      child: {
        kind: 'stack', direction: 'column', gap: 2, align: 'stretch', children: [
          { node: { kind: 'stack', direction: 'row', gap: 1, align: 'center', children: [first] } },
          { node: { kind: 'scroll', child: { kind: 'text', content: 'second' }, follow: 'end', scrollbar: true } },
        ],
      },
      footer: { kind: 'divider', label: 'End' },
    })
    expectDeepFrozen(node)
  })

  it('builds and freezes every controlled pattern and spacing node', () => {
    const action = ui.actions({ id: 'actions', items: [{ id: 'save', label: 'Save', intent: 'primary', busy: true }] })
    const nodes = [
      ui.tabs({ id: 'tabs', activeId: 'one', items: [{ id: 'one', label: 'One', count: 2 }, { id: 'two', label: 'Two', disabled: true }] }),
      ui.list({ id: 'list', mode: 'multiple', selectedIds: ['one'], items: [{ id: 'one', label: 'One', detail: 'detail', badge: 'new', group: 'g' }], filter: 'o', empty: ui.text('none') }),
      ui.form({ id: 'form', fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'Blue', placeholder: 'name' },
        { kind: 'textarea', id: 'notes', label: 'Notes', value: '', error: 'required' },
        { kind: 'secret', id: 'token', label: 'Token', value: '', disabled: true },
        { kind: 'select', id: 'mode', label: 'Mode', value: null, options: [{ id: 'one', label: 'One' }] },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      ], submitActionId: 'save', cancelActionId: 'cancel' }),
      action,
      ui.loader({ message: 'Loading', variant: 'tide', elapsedMs: 120, cancelActionId: 'cancel' }),
      ui.empty({ title: 'Nothing here', description: 'Create an item', actions: action }),
      ui.progress({ label: 'Context', value: 42, max: 100 }),
      ui.spacer({ size: 2 }),
      ui.divider({ label: 'More' }),
    ]
    expect(nodes.map(node => node.kind)).toEqual(['tabs', 'list', 'form', 'actions', 'loader', 'empty', 'progress', 'spacer', 'divider'])
    for (const node of nodes) expectDeepFrozen(node)
  })

  it('keeps optional builder defaults equivalent to minimal handwritten nodes', () => {
    expect(ui.text('x')).toEqual({ kind: 'text', content: 'x' })
    expect(ui.code('x')).toEqual({ kind: 'code', code: 'x' })
    expect(ui.child(ui.text('x'))).toEqual({ node: { kind: 'text', content: 'x' } })
    expect(ui.stack.row([])).toEqual({ kind: 'stack', direction: 'row', children: [] })
    expect(ui.stack.column([])).toEqual({ kind: 'stack', direction: 'column', children: [] })
    expect(ui.scroll(ui.text('x'))).toEqual({ kind: 'scroll', child: { kind: 'text', content: 'x' } })
    expect(ui.spacer()).toEqual({ kind: 'spacer' })
    expect(ui.divider()).toEqual({ kind: 'divider' })
    expect(Object.isFrozen(ui)).toBe(true)
    expect(Object.isFrozen(ui.stack)).toBe(true)
  })
})

describe('deepFreeze', () => {
  it('returns primitives and null unchanged', () => {
    expect(deepFreeze(null)).toBeNull()
    expect(deepFreeze('value')).toBe('value')
  })

  it('deeply freezes arrays and terminates on cycles', () => {
    const root: { items: Array<{ value: number }>, self?: unknown } = { items: [{ value: 1 }] }
    root.self = root
    expect(deepFreeze(root)).toBe(root)
    expectDeepFrozen(root)
  })
})

describe('defineBlueComponent', () => {
  it('returns frozen metadata and deeply freezes each render result', () => {
    const component = defineBlueComponent<{ readonly label: string }>({
      id: '@acme/metric-board', api: `^${BLUE_API_VERSION}`,
      render: props => ui.surface({ child: ui.text(props.label) }),
    })
    expect(component.id).toBe('@acme/metric-board')
    expect(component.api).toBe('^1.0.0')
    expect(Object.isFrozen(component)).toBe(true)
    const result = component.render({ label: 'Context' })
    expect(result).toEqual({ kind: 'surface', child: { kind: 'text', content: 'Context' } })
    expectDeepFrozen(result)
  })

  it('validates only definition metadata and leaves schema admission to core', () => {
    const component = defineBlueComponent({
      id: '@acme/future-node', api: '^1.0.0',
      render: () => ({ kind: 'future-node', payload: { acceptedByBuilder: true } } as never),
    })
    const result = component.render(undefined)
    expect(result).toEqual({ kind: 'future-node', payload: { acceptedByBuilder: true } })
    expectDeepFrozen(result)
  })

  it('rejects invalid definitions, ids, API ranges, and render functions', () => {
    expect(() => defineBlueComponent(null as never)).toThrow('definition must be an object')
    expect(() => defineBlueComponent({ id: 'Bad ID', api: '^1.0.0', render: () => ui.text('x') })).toThrow('plugin id')
    expect(() => defineBlueComponent({ id: '@acme/kit', api: 'latest', render: () => ui.text('x') })).toThrow('plugin api')
    expect(() => defineBlueComponent({ id: '@acme/kit', api: '^2.0.0', render: () => ui.text('x') })).toThrow('Unsupported Blue component API')
    expect(() => defineBlueComponent({ id: '@acme/kit', api: '^1.0.0', render: null as never })).toThrow('render must be a function')
  })
})
