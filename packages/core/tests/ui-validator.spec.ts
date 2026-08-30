/** Canonical UI validator quotas, narrowing, and hostile-input containment. */
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import {
  BLUE_UI_MAX_COLLECTION,
  BLUE_UI_MAX_DEPTH,
  BLUE_UI_MAX_NODES,
  BLUE_UI_MAX_TEXT,
  validateBlueEditorShellNode,
  validateBlueStatusNode,
  validateBlueUiNode,
} from '../src/ui-validator.ts'

function accepted(value: unknown): unknown {
  const result = validateBlueUiNode(value)
  expect(result).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(result.message)
  return result.value
}

describe('validateBlueUiNode', () => {
  it.each([
    [null, 'object'],
    [[], 'object'],
    [new Date(), 'plain object'],
    [{ kind: 'text' }, 'required'],
    [{ kind: 'text', content: 1 }, 'string'],
    [{ kind: 'actions', id: 'x', items: 'bad' }, 'array'],
    [{ kind: 'actions', id: 'x', items: [{ id: 'a', label: 'A', disabled: 'yes' }] }, 'boolean'],
    [{ kind: 'tabs', id: 'x', activeId: 'a', items: [{ id: 'a', label: 'A', count: -1 }] }, 'finite integer'],
    [{ kind: 'text', content: 'x', tone: 'neon' }, 'invalid'],
  ])('contains malformed primitive/schema input %j', (value, message) => {
    expect(validateBlueUiNode(value)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining(message) })
  })

  it('canonicalizes every public node kind and drops unknown fields', () => {
    const all = ui.stack.column([
      ui.text('text', { tone: 'accent' }),
      ui.fields([{ label: 'field', value: [{ text: 'value', emphasis: 'strong' }] }]),
      ui.code('const x = 1', { language: 'ts' }),
      ui.diff('before', 'after'),
      ui.sections([{ title: 'section', body: ui.text('body'), collapsed: false }]),
      ui.richText([{ text: 'rich', tone: 'success' }]),
      ui.surface({ title: 'title', subtitle: 'subtitle', badges: [{ text: 'badge' }], chrome: 'surface', padding: 1, child: ui.text('child'), footer: ui.text('footer') }),
      ui.scroll(ui.text('scroll'), { follow: 'start', scrollbar: true }),
      ui.tabs({ id: 'tabs', activeId: 'one', items: [{ id: 'one', label: 'One', count: 2 }, { id: 'two', label: 'Two', disabled: true }] }),
      ui.list({ id: 'list', mode: 'multiple', selectedIds: ['one'], filter: 'o', items: [{ id: 'one', label: 'One', detail: 'detail', detailSpans: [{ text: '\x1b[31mcurrent', tone: 'accent', emphasis: 'strong' }], badge: 'badge', group: 'g' }], empty: ui.empty({ title: 'none' }) }),
      ui.form({ id: 'form', fields: [
        { kind: 'input', id: 'input', label: 'Input', value: 'v', placeholder: 'p', error: 'e' },
        { kind: 'textarea', id: 'area', label: 'Area', value: 'v' },
        { kind: 'secret', id: 'secret', label: 'Secret', value: 'v', disabled: true },
        { kind: 'select', id: 'select', label: 'Select', value: null, options: [{ id: 'o', label: 'O' }] },
        { kind: 'toggle', id: 'toggle', label: 'Toggle', value: true },
      ], submitActionId: 'submit', cancelActionId: 'form-cancel' }),
      ui.actions({ id: 'actions', items: [{ id: 'go', label: 'Go', intent: 'primary', busy: false, confirm: 'sure?' }] }),
      ui.loader({ message: 'loading', variant: 'tide', elapsedMs: 10, cancelActionId: 'loader-cancel' }),
      ui.empty({ title: 'empty', description: 'description', actions: ui.actions({ id: 'empty-actions', items: [] }) }),
      ui.progress({ label: 'progress', value: 15, max: 10 }),
      ui.spacer({ size: 2 }),
      ui.divider({ label: 'divider' }),
    ], { gap: 1, align: 'center' })
    const handwritten = { ...all, ignored: 'metadata' }
    const result = accepted(handwritten) as typeof all & { ignored?: string }
    const expected = structuredClone(all)
    ;((expected.children[9]!.node as { items: { detailSpans?: { text: string }[] }[] }).items[0]!.detailSpans![0]!).text = 'current'
    ;(expected.children[14]!.node as { value: number }).value = 10
    expect(result).toEqual(expected)
    expect(result.ignored).toBeUndefined()
    expect((result.children[14]!.node as { value: number }).value).toBe(10)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.children)).toBe(true)
    expect((result.children[9]!.node as { items: readonly { detailSpans?: readonly { text: string }[] }[] }).items[0]!.detailSpans).toEqual([{ text: 'current', tone: 'accent', emphasis: 'strong' }])
    expect(Object.isFrozen((result.children[9]!.node as { items: readonly { detailSpans?: readonly unknown[] }[] }).items[0]!.detailSpans)).toBe(true)
  })

  it('admits ordinary records and dense arrays from another VM realm', () => {
    const foreign = runInNewContext(`({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'text', content: 'foreign' } },
        { node: { kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok' }] }] } },
      ],
    })`) as unknown
    const result = validateBlueUiNode(foreign)
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value).toEqual({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'text', content: 'foreign' } },
        { node: { kind: 'fields', rows: [{ label: 'state', value: [{ text: 'ok' }] }] } },
      ],
    })
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype)
    expect(Object.isFrozen(result.value)).toBe(true)
  })

  it('strips ESC and C1 CSI/OSC/DCS/SOS/PM/APC sequences while preserving LF and Tab', () => {
    const source = 'a\t\nb\x1b[31mred\x1b[0m\x1b]0;title\x07x\x1b]8;;url\x1b\\y\x1bPesc-dcs\x1b\\\x1bXesc-sos\x1b\\\x1b^esc-pm\x1b\\\x1b_esc-apc\x07z\x9d0;c1-osc\x9c\x90c1-dcs\x9c\x98c1-sos\x9c\x9ec1-pm\x9c\x9fc1-apc\x9cq\x00\x85\x9b31mC1'
    const result = accepted({ kind: 'text', content: source }) as { content: string }
    expect(result.content).toBe('a\t\nbredxyzqC1')
  })

  it('accepts exact budgets and rejects text, depth, node, and collection overflow', () => {
    expect(validateBlueUiNode(ui.text('x'.repeat(BLUE_UI_MAX_TEXT))).ok).toBe(true)
    expect(validateBlueUiNode(ui.text('x'.repeat(BLUE_UI_MAX_TEXT + 1)))).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    let depth: unknown = ui.text('leaf')
    for (let index = 0; index < BLUE_UI_MAX_DEPTH; index += 1) depth = ui.surface({ child: depth as never })
    expect(validateBlueUiNode(depth).ok).toBe(true)
    depth = ui.surface({ child: depth as never })
    expect(validateBlueUiNode(depth)).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })

    const groups = Array.from({ length: 2 }, (_, group) => ui.stack.column(Array.from({ length: 128 }, (_, index) => ui.text(`${String(group)}-${String(index)}`))))
    expect(validateBlueUiNode(ui.stack.column(groups))).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED', message: expect.stringContaining(String(BLUE_UI_MAX_NODES)) })
    expect(validateBlueUiNode({ kind: 'fields', rows: Array.from({ length: BLUE_UI_MAX_COLLECTION + 1 }, () => ({ label: 'x', value: [] })) })).toMatchObject({ ok: false, code: 'BLUE_LIMIT_EXCEEDED' })
  })

  it.each([
    [{}, 'kind'],
    [{ kind: 'custom' }, 'unknown'],
    [{ kind: 'progress', value: Number.NaN, max: 1 }, 'finite integer'],
    [{ kind: 'progress', value: 0, max: Number.POSITIVE_INFINITY }, 'finite integer'],
    [{ kind: 'progress', value: -1, max: 1 }, 'finite integer'],
    [{ kind: 'progress', value: Number.MAX_SAFE_INTEGER + 1, max: Number.MAX_SAFE_INTEGER + 1 }, 'safe range'],
    [{ kind: 'spacer', size: 3 }, 'invalid'],
    [{ kind: 'tabs', id: 'x', activeId: 'missing', items: [] }, 'activeId'],
    [{ kind: 'list', id: 'x', selectedIds: ['missing'], items: [] }, 'selectedIds'],
    [{ kind: 'list', id: 'x', selectedIds: [], items: [{ id: 'a', label: 'A', detailSpans: [{ text: 'x', tone: 'neon' }] }] }, 'invalid'],
    [{ kind: 'form', id: 'x', fields: [{ kind: 'toggle', id: 'a', label: 'A', value: true }, { kind: 'toggle', id: 'a', label: 'B', value: false }] }, 'duplicate'],
    [{ kind: 'stack', direction: 'row', children: [{ node: { kind: 'text', content: 'x' }, minSize: 2, maxSize: 1 }] }, 'inverted'],
  ])('returns a stable invalid-contribution result for %j', (value, message) => {
    expect(validateBlueUiNode(value)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining(message) })
  })

  it('rejects cycles and nested scrolls', () => {
    const cyclic: { kind: 'surface', child?: unknown } = { kind: 'surface' }
    cyclic.child = cyclic
    expect(validateBlueUiNode(cyclic)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining('cycle') })
    expect(validateBlueUiNode(ui.scroll(ui.surface({ child: ui.scroll(ui.text('nested')) })))).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining('nested scroll') })
  })

  it('rejects ambiguous control ids and invalid selection cardinality', () => {
    const duplicate = ui.stack.column([
      ui.tabs({ id: 'same', activeId: 'a', items: [{ id: 'a', label: 'A' }] }),
      ui.actions({ id: 'actions', items: [{ id: 'same', label: 'Same' }] }),
    ])
    expect(validateBlueUiNode(duplicate)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining('duplicated') })
    expect(validateBlueUiNode(ui.actions({ id: 'actions', items: [{ id: '', label: 'Empty' }] }))).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
    expect(validateBlueUiNode(ui.list({ id: 'list', selectedIds: ['a', 'a'], items: [{ id: 'a', label: 'A' }] }))).toMatchObject({ ok: false, message: expect.stringContaining('duplicate') })
    expect(validateBlueUiNode(ui.list({ id: 'list', selectedIds: ['a', 'b'], items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }))).toMatchObject({ ok: false, message: expect.stringContaining('single mode') })
    expect(validateBlueUiNode(ui.list({ id: '', selectedIds: [], items: [] }))).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
    expect(validateBlueUiNode(ui.stack.column([
      ui.tabs({ id: 'same', activeId: 'a', items: [{ id: 'a', label: 'A' }] }),
      ui.tabs({ id: 'same', activeId: 'b', items: [{ id: 'b', label: 'B' }] }),
    ]))).toMatchObject({ ok: false, message: expect.stringContaining('duplicated') })
  })

  it('removes renderer-reserved focus and cursor markers from public text', () => {
    const marker = '\x1b_pi:c\x07'
    const result = accepted(ui.text(`before\uf8ff${marker}after`)) as { content: string }
    expect(result.content).toBe('beforeafter')
  })

  it('validates viewport ranges and explicit flex sizing', () => {
    const valid = { kind: 'stack', direction: 'row', gap: 0, align: 'end', children: [{ node: { kind: 'text', content: 'x' }, basis: 'auto', grow: 1, shrink: 0, minSize: 1, maxSize: 10, when: { minWidth: 10, maxWidth: 20, minHeight: 2, maxHeight: 5 } }] }
    expect(validateBlueUiNode(valid).ok).toBe(true)
    expect(validateBlueUiNode({ ...valid, children: [{ ...valid.children[0], when: { minWidth: 20, maxWidth: 10 } }] })).toMatchObject({ ok: false, message: expect.stringContaining('width range') })
    expect(validateBlueUiNode({ ...valid, children: [{ ...valid.children[0], when: { minHeight: 5, maxHeight: 2 } }] })).toMatchObject({ ok: false, message: expect.stringContaining('height range') })
    expect(validateBlueUiNode({ ...valid, children: [{ node: ui.text('x'), basis: 3 }] }).ok).toBe(true)
  })

  it('rejects malformed field/action options and wrong empty actions', () => {
    expect(validateBlueUiNode({ kind: 'form', id: 'f', fields: [{ kind: 'select', id: 's', label: 'S', value: 1, options: [] }] })).toMatchObject({ ok: false, message: expect.stringContaining('string or null') })
    expect(validateBlueUiNode({ kind: 'empty', title: 'x', actions: { kind: 'text', content: 'wrong' } })).toMatchObject({ ok: false, message: expect.stringContaining('actions node') })
    expect(validateBlueUiNode({ kind: 'loader', message: 'x', cancelActionId: '' })).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
    expect(validateBlueUiNode({ kind: 'form', id: 'f', fields: [], submitActionId: '' })).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
    expect(validateBlueUiNode({ kind: 'sections', sections: [{ body: { kind: 'rich-text', spans: [] } }] })).toMatchObject({ ok: false, message: expect.stringContaining('BlueView') })
    expect(validateBlueUiNode({ kind: 'form', id: 'f', fields: [{ kind: 'input', id: '', label: 'Empty', value: '' }] })).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
    expect(validateBlueUiNode({ kind: 'form', id: 'f', fields: [{ kind: 'input', id: 'f', label: 'Duplicate', value: '' }] })).toMatchObject({ ok: false, message: expect.stringContaining('duplicated') })
    expect(validateBlueUiNode({ kind: 'form', id: 'f', fields: [], submitActionId: 'submit', cancelActionId: 'submit' })).toMatchObject({ ok: false, message: expect.stringContaining('duplicated') })
    expect(validateBlueUiNode(ui.stack.column([ui.actions({ id: 'a', items: [{ id: 'cancel', label: 'Cancel' }] }), ui.loader({ message: 'load', cancelActionId: 'cancel' })]))).toMatchObject({ ok: false, message: expect.stringContaining('duplicated') })
    expect(validateBlueUiNode(ui.loader({ message: 'load' })).ok).toBe(true)
    expect(validateBlueUiNode(ui.scroll(ui.text('plain'))).ok).toBe(true)
    expect(validateBlueUiNode(ui.sections([{ body: ui.text('body') }])).ok).toBe(true)
    expect(validateBlueUiNode(ui.list({ id: 'disabled-list', selectedIds: [], items: [{ id: 'disabled', label: 'Disabled', disabled: true }] })).ok).toBe(true)
  })

  it('validates scoped page shortcuts and non-focusable action metadata', () => {
    const valid = validateBlueUiNode({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'list', id: 'rows', selectedIds: [], items: [{ id: 'row', label: 'Row' }] } },
        { node: { kind: 'actions', id: 'paging', items: [
          { id: 'previous', label: 'Previous', shortcut: 'pageup', shortcutFor: 'rows', focusable: false },
          { id: 'next', label: 'Next', shortcut: 'pagedown', shortcutFor: 'rows' },
        ] } },
      ],
    })
    expect(valid).toMatchObject({ ok: true })
    if (!valid.ok || valid.value.kind !== 'stack') throw new Error('expected stack')
    expect(valid.value.children[1]?.node).toMatchObject({
      kind: 'actions',
      items: [
        { id: 'previous', shortcut: 'pageup', shortcutFor: 'rows', focusable: false },
        { id: 'next', shortcut: 'pagedown', shortcutFor: 'rows' },
      ],
    })

    for (const [item, message] of [
      [{ id: 'bad', label: 'Bad', shortcut: 'home', shortcutFor: 'rows' }, '.shortcut is invalid'],
      [{ id: 'bad', label: 'Bad', shortcut: 'pageup' }, 'shortcut and shortcutFor must be provided together'],
      [{ id: 'bad', label: 'Bad', shortcutFor: 'rows' }, 'shortcut and shortcutFor must be provided together'],
      [{ id: 'bad', label: 'Bad', focusable: 'no' }, '.focusable must be a boolean'],
    ] as const) {
      expect(validateBlueUiNode({ kind: 'actions', id: 'actions', items: [item] })).toMatchObject({ ok: false, message: expect.stringContaining(message) })
    }
    expect(validateBlueUiNode({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'list', id: 'rows', selectedIds: [], items: [{ id: 'row', label: 'Row' }] } },
        { node: { kind: 'actions', id: 'first', items: [{ id: 'first-page', label: 'First', shortcut: 'pageup', shortcutFor: 'rows' }] } },
        { node: { kind: 'actions', id: 'second', items: [{ id: 'second-page', label: 'Second', shortcut: 'pageup', shortcutFor: 'rows' }] } },
      ],
    })).toMatchObject({ ok: false, message: expect.stringContaining('duplicates pageup') })
    expect(validateBlueUiNode({ kind: 'actions', id: 'actions', items: [{ id: 'page', label: 'Page', shortcut: 'pageup', shortcutFor: 'missing' }] })).toMatchObject({ ok: false, message: expect.stringContaining('does not name a tabs, list, or form control') })
  })

  it('contains proxies/accessors, ignores unknown getters, and never freezes caller data', () => {
    const proxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('boom') } })
    expect(validateBlueUiNode(proxy)).toEqual({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue UI validation failed safely' })
    const accessor = { kind: 'text', get content(): string { throw new Error('boom') } }
    expect(validateBlueUiNode(accessor)).toMatchObject({ ok: false, message: expect.stringContaining('must be data') })
    let reads = 0
    const caller = { kind: 'text', content: 'safe', get hidden(): string { reads += 1; throw new Error('unread') } }
    const result = validateBlueUiNode(caller)
    expect(result.ok).toBe(true)
    expect(reads).toBe(0)
    expect(Object.isFrozen(caller)).toBe(false)

    class TextNode {
      readonly kind = 'text'
      readonly content = 'class instance'
    }
    expect(validateBlueUiNode(new TextNode())).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('plain object'),
    })
    const NamedObject = class Object {
      readonly kind = 'text'
      readonly content = 'named class instance'
    }
    expect(validateBlueUiNode(new NamedObject())).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('plain object'),
    })
    const spoofedPrototype = Object.create(null) as object
    Object.defineProperty(spoofedPrototype, 'constructor', { value: function Object() {} })
    const spoofed = Object.assign(Object.create(spoofedPrototype) as object, { kind: 'text', content: 'spoofed prototype' })
    expect(validateBlueUiNode(spoofed)).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('plain object'),
    })
    expect(validateBlueUiNode(Object.create({ kind: 'text', content: 'prototype data' }))).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('plain object'),
    })
  })

  it('copies only dense plain arrays without invoking index or method accessors', () => {
    let indexReads = 0
    const accessorChildren: unknown[] = []
    Object.defineProperty(accessorChildren, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        indexReads += 1
        return { node: ui.text('unsafe') }
      },
    })
    accessorChildren.length = 1
    expect(validateBlueUiNode({ kind: 'stack', direction: 'column', children: accessorChildren })).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('must be data'),
    })
    expect(indexReads).toBe(0)

    const sparseChildren: unknown[] = []
    sparseChildren.length = 1
    expect(validateBlueUiNode({ kind: 'stack', direction: 'column', children: sparseChildren })).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('dense array'),
    })

    let methodReads = 0
    const safeChildren = [{ node: ui.text('safe') }]
    Object.defineProperty(safeChildren, 'map', {
      configurable: true,
      get: () => {
        methodReads += 1
        throw new Error('must not execute caller methods')
      },
    })
    expect(validateBlueUiNode({ kind: 'stack', direction: 'column', children: safeChildren })).toMatchObject({ ok: true })
    expect(methodReads).toBe(0)

    class ArraySubclass extends Array<unknown> {}
    Object.defineProperty(ArraySubclass.prototype, 'constructor', { value: function Array() {} })
    expect(validateBlueUiNode({ kind: 'stack', direction: 'column', children: new ArraySubclass() })).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: expect.stringContaining('plain array'),
    })
  })
})

describe('narrow validators', () => {
  it('accepts recursive status nodes and rejects interactive descendants', () => {
    expect(validateBlueStatusNode({ kind: 'stack', direction: 'row', children: [{ node: { kind: 'progress', value: 1, max: 2 }, when: { minWidth: 20 } }] }).ok).toBe(true)
    expect(validateBlueStatusNode(ui.stack.column([ui.actions({ id: 'bad', items: [] })]))).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: expect.stringContaining('interactive') })
  })

  it('requires exactly one editor-control and rejects it from ordinary UI', () => {
    expect(validateBlueUiNode({ kind: 'editor-control' })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    expect(validateBlueEditorShellNode(ui.text('none'))).toMatchObject({ ok: false, message: expect.stringContaining('received 0') })
    expect(validateBlueEditorShellNode({ kind: 'surface', child: { kind: 'stack', direction: 'column', children: [{ node: ui.text('before') }, { node: { kind: 'editor-control' } }] }, footer: ui.text('after') }).ok).toBe(true)
    expect(validateBlueEditorShellNode({ kind: 'surface', child: { kind: 'editor-control' } }).ok).toBe(true)
    expect(validateBlueEditorShellNode({ kind: 'surface', child: ui.text('head'), footer: { kind: 'editor-control' } }).ok).toBe(true)
    expect(validateBlueEditorShellNode({ kind: 'stack', direction: 'column', children: [{ node: { kind: 'editor-control' } }, { node: { kind: 'editor-control' } }] })).toMatchObject({ ok: false, message: expect.stringContaining('received 2') })
    expect(validateBlueEditorShellNode({ kind: 'scroll', child: { kind: 'editor-control' } })).toMatchObject({ ok: false, message: expect.stringContaining('shell slot') })
    expect(validateBlueEditorShellNode({ kind: 'scroll', child: { kind: 'stack', direction: 'column', children: [{ node: { kind: 'editor-control' } }] } })).toMatchObject({ ok: false, message: expect.stringContaining('shell slot') })
  })

  it('rejects shell layouts that can deterministically hide the editor control', () => {
    const shell = (child: Record<string, unknown>) => ({
      kind: 'stack',
      direction: 'column',
      children: [{ node: { kind: 'editor-control' }, ...child }],
    })
    expect(validateBlueEditorShellNode(shell({ when: { minWidth: 40 } }))).toMatchObject({ ok: false, message: expect.stringContaining('.when') })
    expect(validateBlueEditorShellNode(shell({ maxSize: 0 }))).toMatchObject({ ok: false, message: expect.stringContaining('.maxSize') })
    expect(validateBlueEditorShellNode(shell({ basis: 0, grow: 0 }))).toMatchObject({ ok: false, message: expect.stringContaining('zero size') })
    expect(validateBlueEditorShellNode(shell({ basis: 0, grow: 0, minSize: 1 })).ok).toBe(true)
    expect(validateBlueEditorShellNode({
      kind: 'stack',
      direction: 'column',
      children: [{
        when: { minHeight: 2 },
        node: { kind: 'stack', direction: 'column', children: [{ node: { kind: 'editor-control' } }] },
      }],
    })).toMatchObject({ ok: false, message: expect.stringContaining('.when') })
    expect(validateBlueEditorShellNode({
      kind: 'stack',
      direction: 'column',
      children: [{
        maxSize: 0,
        node: { kind: 'surface', child: ui.text('head'), footer: { kind: 'editor-control' } },
      }],
    })).toMatchObject({ ok: false, message: expect.stringContaining('.maxSize') })
    expect(validateBlueEditorShellNode({
      kind: 'surface',
      child: {
        kind: 'stack',
        direction: 'column',
        children: [{ node: ui.text('row') }, { node: { kind: 'editor-control' }, when: { maxHeight: 3 } }],
      },
    })).toMatchObject({ ok: false, message: expect.stringContaining('.when') })
  })
})
