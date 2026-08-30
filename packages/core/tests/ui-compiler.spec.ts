/** Canonical compiler layout, focus, event, width, and failure containment. */
import { CURSOR_MARKER, HStack, ScrollView, stripTerminalSequences, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame, type LayoutBox, type LayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { describe, expect, it, vi } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import {
  compileBlueEditorShellNode,
  compileBlueStatusNode,
  compileBlueUiNode,
  type BlueEditorShellCompilerOptions,
  type BlueStatusCompilerOptions,
  type BlueUiCompilerOptions,
} from '../src/ui-compiler.ts'
import type { BlueComponent, BlueComponents, BlueEditor, BlueSemanticColors } from '../src/types.ts'
import { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from '../src/width.ts'
import { ADVERSARIAL, expectLinesFit, SCAN_WIDTHS } from './width-scan.ts'

const identity = (value: string): string => value
const colors = new Proxy({ logoGradient: [identity] }, { get: (target, key) => key === 'logoGradient' ? target.logoGradient : identity }) as BlueSemanticColors

function createTestEditor(): BlueEditor {
  let value = ''
  let cursor = 0
  const editor = {
    focused: false,
    onSubmit: undefined,
    onChange: undefined,
    onKey: undefined,
    disableSubmit: false,
    setSubmitBarrier: () => {},
    submit: () => { if (!editor.disableSubmit) editor.onSubmit?.(value) },
    getText: () => value,
    getExpandedText: () => value,
    setText: (text: string) => { value = text; cursor = text.length },
    renderContent: (width: number, masked = false) => {
      const shown = masked ? '•'.repeat(value.length) : value
      const row = `${shown.slice(0, cursor)}${editor.focused ? CURSOR_MARKER : ''}${shown.slice(cursor)}`
      return [truncateToWidth(row, width)]
    },
    handleInput: (data: string) => {
      if (editor.onKey?.(data) === true) return
      if (data === '\r') { if (!editor.disableSubmit) editor.onSubmit?.(value); return }
      if (data === '\x1b[D') { cursor = Math.max(0, cursor - 1); return }
      if (data === '\x1b[C') { cursor = Math.min(value.length, cursor + 1); return }
      if (data === '\x7f' || data === '\b') {
        if (cursor > 0) {
          const before = Array.from(value.slice(0, cursor))
          before.pop()
          const prefix = before.join('')
          value = `${prefix}${value.slice(cursor)}`
          cursor = prefix.length
          editor.onChange?.(value)
        }
        return
      }
      const paste = /^\x1b\[200~([\s\S]*)\x1b\[201~$/u.exec(data)
      const inserted = paste?.[1] ?? (/^[^\x00-\x1f\x7f-\x9f]+$/u.test(data) ? data : '')
      if (inserted.length === 0) return
      value = `${value.slice(0, cursor)}${inserted}${value.slice(cursor)}`
      cursor += inserted.length
      editor.onChange?.(value)
    },
    addToHistory: () => {},
    getHistory: () => [],
    setBorderColor: () => {},
    setPromptSymbol: () => {},
    setBorderLabel: () => {},
    setConnectedAbove: () => {},
    setGhostHint: () => {},
    setAutocompleteProvider: () => {},
    isShowingAutocomplete: () => false,
    refreshAutocomplete: () => {},
    insertText: (text: string) => { value = `${value.slice(0, cursor)}${text}${value.slice(cursor)}`; cursor += text.length; editor.onChange?.(value) },
    render: (width: number) => editor.renderContent(width),
    invalidate: () => {},
  } as BlueEditor
  return editor
}

const components = {
  visibleWidth,
  wrapText: wrapTextWithAnsi,
  truncateToWidth,
  createEditor: createTestEditor,
  createMarkdown: (options?: { text?: string }) => {
    let value = options?.text ?? ''
    return {
      setText: (text: string) => { value = text },
      render: (width: number) => wrapTextWithAnsi(value, width),
      invalidate: () => {},
    }
  },
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

function statusOptions(overrides: Partial<BlueStatusCompilerOptions> = {}): BlueStatusCompilerOptions {
  return {
    components,
    colors,
    getViewport: () => ({ columns: 80, rows: 20 }),
    screenMode: 'alternate',
    ...overrides,
  }
}

function compiledStatus(value: unknown, options: BlueStatusCompilerOptions = statusOptions()) {
  const result = compileBlueStatusNode(value, options)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

function compiledEditorShell(value: unknown, editor: BlueEditor, overrides: Partial<BlueEditorShellCompilerOptions> = {}) {
  const base = fixture(overrides)
  const result = compileBlueEditorShellNode(value, { ...base.options, editor, ...overrides })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return { ...base, result: result.value }
}

function layout(component: Component, columns: number, rows: number): LayoutFrame {
  return renderLayoutFrame(component, columns, rows, () => {})
}

function scrollViews(box: LayoutBox): ScrollView[] {
  return [...(box.scrollView === undefined ? [] : [box.scrollView]), ...box.children.flatMap(scrollViews)]
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
      ui.fields([{ label: 'field', value: [{ text: 'value' }] }]),
      ui.code('const x = 1'),
      ui.diff('before', 'after'),
      ui.sections([{ title: 'section', body: ui.text('body') }]),
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

  it('applies the private compatibility row budget to wrapped rich text', () => {
    const { options } = fixture({ screenMode: 'main', maxLeafRows: 3 })
    const result = compiled(ui.richText([{ text: 'abcdefghij' }]), options)
    const rows = result.component.render(2)
    expect(rows).toHaveLength(3)
    expect(rows.every(row => visibleWidth(row) <= 2)).toBe(true)
  })

  it('windows only the targeted text leaf after wrapping and reports live clamps', () => {
    let offset = 1
    const observe = vi.fn()
    const { options } = fixture({
      screenMode: 'main',
      maxLeafRows: 2,
      leafRowWindowPath: '$.0',
      leafRowOffset: () => offset,
      onLeafRowOffset: observe,
    })
    const result = compiled(ui.stack.column([ui.text('abcdefgh'), ui.text('ok')]), options)
    expect(result.component.render(2)).toEqual(['cd', 'ef', 'ok'])
    expect(observe).toHaveBeenLastCalledWith(1, 4, 2)

    offset = 99
    expect(result.component.render(2)).toEqual(['ef', 'gh', 'ok'])
    expect(observe).toHaveBeenLastCalledWith(2, 4, 2)

    expect(result.component.render(4)).toEqual(['abcd', 'efgh', 'ok'])
    expect(observe).toHaveBeenLastCalledWith(0, 2, 2)

    const defaultOffset = compiled(ui.text('abcdefgh'), fixture({
      maxLeafRows: 2,
      leafRowWindowPath: '$',
    }).options)
    expect(defaultOffset.component.render(2)).toEqual(['ab', 'cd'])
  })

  it('windows rich text and contains compatibility getter and observer failures', () => {
    const getterFailure = compiled(ui.richText([{ text: 'abcdefgh' }]), fixture({
      maxLeafRows: 2,
      leafRowWindowPath: '$',
      leafRowOffset: () => { throw new Error('offset failed') },
      onLeafRowOffset: () => { throw new Error('observer failed') },
    }).options)
    expect(getterFailure.component.render(2)).toEqual(['ab', 'cd'])

    const nonFinite = compiled(ui.richText([{ text: 'abcdefgh' }]), fixture({
      maxLeafRows: 2,
      leafRowWindowPath: '$',
      leafRowOffset: () => Number.NaN,
    }).options)
    expect(nonFinite.component.render(2)).toEqual(['ab', 'cd'])
  })

  it('windows renderer-owned Markdown rows at the selected text leaf', () => {
    const invalidate = vi.fn()
    const markdownComponents = {
      ...components,
      createMarkdown: () => ({
        setText: () => {},
        render: () => ['heading', 'list', 'fence', 'tail'],
        invalidate,
      }),
    } as BlueComponents
    const result = compiled(ui.text('# heading\n- list\n```ts\nfence\n```'), fixture({
      components: markdownComponents,
      maxLeafRows: 2,
      leafRowWindowPath: '$',
      markdownLeafPath: '$',
      leafRowOffset: () => 1,
    }).options)
    expect(result.component.render(20)).toEqual(['list', 'fence'])
    result.component.invalidate()
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('contains renderer-owned Markdown failures at the selected text leaf', () => {
    const markdownComponents = {
      ...components,
      createMarkdown: () => ({
        setText: () => {},
        render: () => { throw new Error('markdown failed') },
        invalidate: () => {},
      }),
    } as BlueComponents
    const error = compiled(ui.text('# heading'), fixture({ components: markdownComponents, markdownLeafPath: '$' }).options)
    expect(error.component.render(20).join('')).toContain('markdown failed')

    const unknownComponents = {
      ...components,
      createMarkdown: () => ({
        setText: () => {},
        render: () => { throw 'markdown failed' },
        invalidate: () => {},
      }),
    } as BlueComponents
    const unknown = compiled(ui.text('# heading'), fixture({ components: unknownComponents, markdownLeafPath: '$' }).options)
    expect(unknown.component.render(20).join('')).toContain('unknown')
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

  it('renders overlay chrome as one closed core-owned frame at wide and degenerate widths', () => {
    const overlay = compiled(ui.surface({
      chrome: 'overlay',
      title: 'Details',
      padding: 1,
      child: ui.text('body'),
    }), fixture().options)
    expect(overlay.component.render(20)).toEqual([
      '╭ Details ─────────╮',
      '│ body             │',
      '╰──────────────────╯',
    ])
    expect(overlay.component.render(8)).toEqual([
      '╭ Det ─╮',
      '│ body │',
      '╰──────╯',
    ])
    expect(() => overlay.component.invalidate()).not.toThrow()

    const degenerate = compiled(ui.surface({ chrome: 'overlay', title: 'Details', padding: 2, child: ui.text('x') }), fixture().options)
    expect(degenerate.component.render(2)).toEqual(['x'])
    expect(degenerate.component.render(1)).toEqual(['x'])
    expect(degenerate.component.render(Number.NaN)).toEqual(['x'])
  })

  it('preserves nested layout and scroll semantics inside closed overlay chrome', () => {
    const content = ui.stack.column(Array.from({ length: 10 }, (_, index) => ui.text(`line-${String(index)}`)))
    const overlay = compiled(ui.surface({
      chrome: 'overlay',
      title: 'Scrollable',
      padding: 1,
      child: ui.scroll(content, { scrollbar: true }),
    }), fixture({ getViewport: () => ({ columns: 20, rows: 5 }) }).options)
    const frame = layout(overlay.component as Component, 20, 5)

    expect(frame.lines[0]).toMatch(/^╭ Scrollable ─+╮$/u)
    expect(frame.lines.at(-1)).toBe('╰──────────────────╯')
    expect(frame.lines.map(stripTerminalSequences).slice(1, -1).every(row => /^│.*│$/u.test(row))).toBe(true)
    expect(scrollViews(frame.root)).toHaveLength(1)
    expect(frame.lines).toHaveLength(5)
    for (const width of [1, 2]) {
      const narrow = layout(overlay.component as Component, width, 5).lines
      expectLinesFit('closed overlay layout', narrow, width)
      expect(narrow.join('')).toContain('l')
    }
  })

  it('lays out alternate scroll with real start/end state and unwraps it in main mode', () => {
    const content = ui.stack.column(Array.from({ length: 10 }, (_, index) => ui.text(`line-${String(index)}`)))
    for (const follow of ['none', 'start'] as const) {
      const result = compiled(ui.scroll(content, { follow, scrollbar: true }), fixture().options)
      const frame = layout(result.component as Component, 20, 3)
      const [scroll] = scrollViews(frame.root)
      expect(frame.lines).toEqual(['line-0', 'line-1', 'line-2'])
      expect(scroll).toMatchObject({ primary: false, overscroll: 'contain', scrollTop: 0, viewportHeight: 3 })
    }

    const end = compiled(ui.scroll(content, { follow: 'end', scrollbar: true }), fixture().options)
    const endFrame = layout(end.component as Component, 20, 3)
    const [endScroll] = scrollViews(endFrame.root)
    expect(endFrame.lines).toEqual(['line-7', 'line-8', 'line-9'])
    expect(endScroll).toMatchObject({ primary: false, overscroll: 'contain', scrollTop: 7, viewportHeight: 3 })

    const mainFixture = fixture({ screenMode: 'main' })
    const main = compiled(ui.scroll(content, { follow: 'end' }), mainFixture.options)
    expect((main.component as unknown as { root: unknown }).root).not.toBeInstanceOf(ScrollView)
    expect(main.component.render(20)).toHaveLength(10)
  })

  it('passes stack-allocated height to a nested scroll', () => {
    const content = ui.stack.column(Array.from({ length: 10 }, (_, index) => ui.text(`line-${String(index)}`)))
    const tree = ui.stack.column([
      ui.child(ui.text('header'), { basis: 1, shrink: 0 }),
      ui.child(ui.scroll(content, { follow: 'end' }), { basis: 0, grow: 1, minSize: 1 }),
    ])
    const frame = layout(compiled(tree, fixture().options).component as Component, 20, 4)
    const [scroll] = scrollViews(frame.root)
    expect(frame.lines).toEqual(['header', 'line-7', 'line-8', 'line-9'])
    expect(scroll).toMatchObject({ scrollTop: 7, viewportHeight: 3, primary: false })

    const padded = compiled(ui.surface({ padding: 1, child: ui.scroll(content, { follow: 'end' }) }), fixture().options)
    const paddedFrame = layout(padded.component as Component, 20, 3)
    const [paddedScroll] = scrollViews(paddedFrame.root)
    expect(paddedFrame.lines.join('\n')).toContain('line-7')
    expect(paddedFrame.lines.join('\n')).toContain('line-9')
    expect(paddedScroll).toMatchObject({ scrollTop: 7, viewportHeight: 3, primary: false })
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

  it('uses the height allocated by the layout engine for responsive children', () => {
    const { options } = fixture({ getViewport: () => ({ columns: 80, rows: 99 }) })
    const tree = ui.stack.column([
      ui.child(ui.text('short'), { when: { maxHeight: 9 } }),
      ui.child(ui.text('tall'), { when: { minHeight: 10 } }),
    ])
    expect(layout(compiled(tree, options).component as Component, 80, 9).lines).toContain('short')
    expect(layout(compiled(tree, options).component as Component, 80, 9).lines).not.toContain('tall')
    expect(layout(compiled(tree, options).component as Component, 80, 10).lines).toContain('tall')

    const responsive = compiled(ui.stack.column([
      ui.child(ui.actions({ id: 'short-actions', items: [{ id: 'short-action', label: 'Short action' }] }), { when: { maxHeight: 9 } }),
      ui.child(ui.actions({ id: 'tall-actions', items: [{ id: 'tall-action', label: 'Tall action' }] }), { when: { minHeight: 10 } }),
    ]), options)
    responsive.focusTarget!.focused = true
    const shortFrame = layout(responsive.component as Component, 80, 9).lines.join('')
    expect(shortFrame).toContain('Short action')
    expect(shortFrame.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
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

  it('preserves focused HStack labels in layout and subsequent direct replay', () => {
    const { options } = fixture()
    const focus = compiled(ui.actions({ id: 'actions', items: [{ id: 'alpha', label: 'alpha' }, { id: 'beta', label: 'beta' }] }), options).focusTarget!
    focus.focused = true
    const frameRow = layout(focus as Component, 40, 3).lines.join('')
    expect(frameRow).toContain('alpha')
    expect(frameRow).toContain('beta')
    expect(frameRow.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)

    const replay = focus.render(40).join('')
    expect(replay).toContain('alpha')
    expect(replay).toContain('beta')
    expect(replay.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
  })

  it('preserves one focused editor marker in layout and subsequent direct replay', () => {
    const { options } = fixture()
    const focus = compiled(ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'alpha' }] }), options).focusTarget!
    focus.focused = true
    for (const width of [40, 2]) {
      const frame = layout(focus as Component, width, 3).lines.join('')
      expect(frame).not.toContain('\uf8ff')
      expect(frame.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)

      const replay = focus.render(width).join('')
      expect(replay).not.toContain('\uf8ff')
      expect(replay.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
    }
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

  it('keeps form edit buffers local while emitting text, toggle, select, and submit proposals', () => {
    const { options, events } = fixture()
    const node = ui.form({
      id: 'profile',
      fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'A' },
        { kind: 'textarea', id: 'notes', label: 'Notes', value: '' },
        { kind: 'secret', id: 'secret', label: 'Secret', value: 'x' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
        { kind: 'select', id: 'choice', label: 'Choice', value: null, options: [
          { id: 'disabled', label: 'Disabled', disabled: true },
          { id: 'a', label: 'Alpha' },
          { id: 'b', label: 'Beta' },
        ] },
      ],
      submitActionId: 'Save',
    })
    const result = compiled(node, options)
    const focus = result.focusTarget!
    focus.focused = true
    expect(focus.render(80).join('').match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
    expect(focus.render(80).join('')).toContain('→ Name:')
    focus.handleInput?.('B')
    focus.handleInput?.(' ')
    focus.handleInput?.('界🙂')
    focus.handleInput?.('\x1b[31mred')
    expect(focus.render(80).join('\n')).toContain('Name: AB ')
    focus.handleInput?.('\x7f')
    expect(focus.render(80).join('\n')).toContain('Name: AB 界')
    expect(result.node).toMatchObject({ kind: 'form' })
    if (result.node.kind !== 'form') throw new Error('expected form')
    expect(result.node.fields[0]).toMatchObject({ value: 'A' })

    focus.handleInput?.('\t')
    focus.handleInput?.('note')
    focus.handleInput?.('\t')
    focus.handleInput?.('z')
    expect(focus.render(80).join('\n')).toContain('Secret: ••')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[B')
    expect(focus.render(80).join('\n')).toContain('Choice: Alpha')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')

    expect(events).toEqual([
      { kind: 'value-change', controlId: 'name', value: 'AB' },
      { kind: 'value-change', controlId: 'name', value: 'AB ' },
      { kind: 'value-change', controlId: 'name', value: 'AB 界🙂' },
      { kind: 'value-change', controlId: 'name', value: 'AB 界' },
      { kind: 'value-change', controlId: 'notes', value: 'note' },
      { kind: 'value-change', controlId: 'secret', value: 'xz' },
      { kind: 'value-change', controlId: 'enabled', value: true },
      { kind: 'value-change', controlId: 'choice', value: 'b' },
      { kind: 'submit', controlId: 'profile', values: { name: 'AB 界', notes: 'note', secret: 'xz', enabled: true, choice: 'b' } },
    ])

    const refreshed = compiled(ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'Server' }] }), fixture().options)
    expect(refreshed.component.render(40).join('')).toContain('Server')
    expect(refreshed.component.render(40).join('')).not.toContain('AB')

    const selectDraft = compiled(ui.form({ id: 'select-form', fields: [{ kind: 'select', id: 'select', label: 'Select', value: null, options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }] }), fixture().options)
    selectDraft.focusTarget!.handleInput?.('\x1b[A')
    expect(selectDraft.component.render(40).join('')).toContain('Beta')
    const selectRefresh = compiled(ui.form({ id: 'select-form', fields: [{ kind: 'select', id: 'select', label: 'Select', value: 'b', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }] }), fixture().options)
    expect(selectRefresh.component.render(40).join('')).toContain('Beta')

    const noOptionsEvents: unknown[] = []
    const noOptions = compiled(ui.form({ id: 'empty-select', fields: [{ kind: 'select', id: 'empty', label: 'Empty', value: null, options: [{ id: 'disabled', label: 'Disabled', disabled: true }] }] }), fixture({ emit: event => noOptionsEvents.push(event) }).options)
    noOptions.focusTarget!.handleInput?.('\x1b[B')
    noOptions.focusTarget!.handleInput?.('\r')
    expect(noOptionsEvents).toEqual([{ kind: 'value-change', controlId: 'empty', value: null }])

    const enterEvents: unknown[] = []
    const enterText = compiled(ui.form({ id: 'enter-form', fields: [{ kind: 'input', id: 'enter', label: 'Enter', value: 'value' }] }), fixture({ emit: event => enterEvents.push(event) }).options)
    enterText.focusTarget!.handleInput?.('\r')
    expect(enterEvents).toEqual([{ kind: 'value-change', controlId: 'enter', value: 'value' }])
  })

  it('contains editor-backed field render failures', () => {
    const multilineEditor = createTestEditor()
    multilineEditor.renderContent = () => ['first', 'second']
    const multiline = compiled(ui.form({ id: 'form', fields: [{ kind: 'textarea', id: 'notes', label: 'Notes', value: '' }] }), fixture({
      resolveTextEditor: () => multilineEditor,
    }).options)
    expect(multiline.component.render(20)).toEqual(['   Notes: first', '          second'])
    const multilineRoot = multiline.component as unknown as { root: { entries: { component: BlueComponent }[] } }
    expect(multilineRoot.root.entries[0]!.component.render(Number.NaN)).toEqual([' ', ' '])

    const failingEditor = createTestEditor()
    failingEditor.renderContent = () => { throw new Error('editor failed') }
    const failed = compiled(ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '' }] }), fixture({
      resolveTextEditor: () => failingEditor,
    }).options)
    expect(failed.component.render(20).join('')).toContain('editor failed')

    const unknownEditor = createTestEditor()
    unknownEditor.renderContent = () => { throw 'editor failed' }
    const unknown = compiled(ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '' }] }), fixture({
      resolveTextEditor: () => unknownEditor,
    }).options)
    expect(unknown.component.render(20).join('')).toContain('unknown')
  })

  it('requires two activation gestures for confirmed actions and clears pending state locally', () => {
    const escapes: string[] = []
    const { options, events } = fixture({ onUnhandledEscape: () => escapes.push('escape') })
    const result = compiled(ui.actions({ id: 'actions', items: [
      { id: 'delete', label: 'Delete', intent: 'primary', confirm: 'Really delete?' },
      { id: 'keep', label: 'Keep' },
      { id: 'disabled', label: 'Disabled', disabled: true, confirm: 'Never' },
      { id: 'busy', label: 'Busy', busy: true, confirm: 'Never' },
    ] }), options)
    const focus = result.focusTarget!
    focus.focused = true
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.('\r')
    expect(events).toEqual([])
    expect(focus.render(80).join('')).toContain('Really delete?')
    focus.handleInput?.('\x1b')
    expect(escapes).toEqual([])
    focus.handleInput?.('\x1b')
    expect(escapes).toEqual(['escape'])
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.('\x1b[Z')
    focus.handleInput?.(' ')
    focus.focused = false
    focus.focused = true
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.(' ')
    expect(events).toEqual([])
    focus.handleInput?.(' ')
    expect(events).toEqual([{ kind: 'activate', controlId: 'delete' }])
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    expect(events.at(-1)).toEqual({ kind: 'activate', controlId: 'keep' })
  })

  it('routes direction keys within the active pattern while Tab crosses controls', () => {
    const { options, events } = fixture()
    const tree = ui.stack.column([
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'b', label: 'B' }] }),
      ui.list({ id: 'list', selectedIds: [], items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }),
      ui.actions({ id: 'actions', items: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }] }),
    ])
    const focus = compiled(tree, options).focusTarget!
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    expect(events).toEqual([
      { kind: 'tab-change', controlId: 'tabs', tabId: 'b' },
      { kind: 'selection-change', controlId: 'list', value: 'two' },
      { kind: 'activate', controlId: 'right' },
    ])
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
      { kind: 'submit', controlId: 'form', values: { toggle: true, select: null } },
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

  it('keeps active, selected, and focused pattern states visually distinct', () => {
    const selectedBg = vi.fn(identity)
    const trackedColors = new Proxy(colors, { get: (target, key, receiver) => key === 'selectedBg' ? selectedBg : Reflect.get(target, key, receiver) })
    const tabs = compiled(ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'Active' }, { id: 'b', label: 'Focused' }] }), fixture({ colors: trackedColors }).options)
    tabs.focusTarget!.focused = true
    tabs.focusTarget!.handleInput?.('\t')
    const tabRow = tabs.component.render(40).join('')
    expect(tabRow).toContain('‹ Active ›')
    expect(tabRow).toContain(`${CURSOR_MARKER} → Focused`)
    expect(tabRow.replaceAll(CURSOR_MARKER, '')).toContain('→ Focused')
    const tabLayoutRow = layout(tabs.component as Component, 40, 1).lines.join('')
    expect(tabLayoutRow).toContain(`${CURSOR_MARKER} → Focused`)
    expect(tabLayoutRow.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)

    const list = compiled(ui.list({ id: 'list', mode: 'multiple', selectedIds: ['selected'], items: [
      { id: 'plain', label: 'Plain' },
      { id: 'selected', label: 'Selected' },
    ] }), fixture({ colors: trackedColors }).options)
    expect(list.component.render(40).join('')).toContain('● Selected')
    expect(selectedBg).not.toHaveBeenCalled()
    list.focusTarget!.focused = true
    expect(list.component.render(40).join('')).toContain(`${CURSOR_MARKER} → Selected`)
    expect(selectedBg).toHaveBeenCalledOnce()
    selectedBg.mockClear()
    list.focusTarget!.handleInput?.('\x1b[A')
    expect(list.component.render(40).join('')).toContain(`${CURSOR_MARKER} → Plain`)
    expect(selectedBg).toHaveBeenCalledOnce()
  })

  it('windows a focused list against the live viewport and keeps validation on the next row', () => {
    const { options, viewport } = fixture()
    viewport.rows = 3
    const list = compiled(ui.list({ id: 'list', selectedIds: ['six'], items: Array.from({ length: 8 }, (_, index) => ({ id: index === 6 ? 'six' : String(index), label: `row-${String(index)}` })) }), options)
    list.focusTarget!.focused = true
    const rows = list.component.render(20)
    expect(rows).toHaveLength(3)
    expect(rows.join('\n')).toContain('row-6')
    expect(rows.join('\n')).not.toContain('row-0')
    viewport.rows = 20
    const nested = compiled(ui.stack.column([
      ui.child(ui.text('header'), { basis: 1, shrink: 0 }),
      ui.child(ui.list({ id: 'nested-list', selectedIds: ['six'], items: Array.from({ length: 8 }, (_, index) => ({ id: index === 6 ? 'six' : String(index), label: `nested-${String(index)}` })) }), { basis: 0, grow: 1, minSize: 1 }),
    ]), options)
    nested.focusTarget!.focused = true
    const frameRows = layout(nested.component as Component, 20, 4).lines
    expect(frameRows).toHaveLength(4)
    expect(frameRows[0]).toBe('header')
    expect(frameRows.join('\n')).toContain('nested-6')
    expect(frameRows.join('\n')).not.toContain('nested-0')

    const main = compiled(ui.list({ id: 'main-list', selectedIds: [], items: Array.from({ length: 8 }, (_, index) => ({ id: String(index), label: `main-${String(index)}` })) }), fixture({ screenMode: 'main', getViewport: () => ({ columns: 20, rows: 3 }) }).options)
    expect(main.component.render(20)).toHaveLength(8)

    const form = compiled(ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '', placeholder: 'Ada', error: 'Required' }] }), fixture().options)
    expect(form.component.render(40)).toEqual(['   Name: Ada', '   ! Required'])
    const formActions = compiled(ui.form({ id: 'form-actions', fields: [], submitActionId: 'Save', cancelActionId: 'Cancel' }), fixture().options)
    expect(formActions.component.render(40).join('\n')).toContain('Save')
    expect(formActions.component.render(40).join('\n')).toContain('Cancel')
  })

  it('width-scans every L2 pattern with adversarial canonical content', () => {
    for (const [adversarialIndex, { name, text }] of ADVERSARIAL.entries()) {
      const suffix = String(adversarialIndex)
      const content = text.slice(0, 700)
      const tree = ui.stack.column([
        ui.surface({ chrome: 'overlay', title: content, subtitle: content, badges: [{ text: content, tone: 'warning' }], child: ui.text(content), footer: ui.divider({ label: content }) }),
        ui.tabs({ id: `tabs-${suffix}`, activeId: 'a', items: [{ id: 'a', label: content, count: 123 }, { id: 'b', label: content }] }),
        ui.list({ id: `list-${suffix}`, mode: 'multiple', selectedIds: ['a'], filter: content, items: [{ id: 'a', label: content, detail: content, detailSpans: [{ text: content, tone: 'accent', emphasis: 'strong' }], badge: content, group: content }, { id: 'b', label: content }] }),
        ui.form({ id: `form-${suffix}`, fields: [{ kind: 'input', id: `field-${suffix}`, label: content, value: content, error: content }] }),
        ui.actions({ id: `actions-${suffix}`, items: [{ id: `action-${suffix}`, label: content, intent: 'danger', confirm: content }] }),
        ui.loader({ message: content, elapsedMs: 12 }),
        ui.empty({ title: content, description: content }),
        ui.progress({ label: content, value: 1, max: 3 }),
      ])
      const { options, viewport } = fixture()
      viewport.rows = 200
      const alternate = compiled(tree, options)
      alternate.focusTarget!.focused = true
      const main = compiled(tree, fixture({ screenMode: 'main', getViewport: () => ({ columns: 120, rows: 20 }) }).options)
      main.focusTarget!.focused = true
      for (const width of SCAN_WIDTHS) {
        expectLinesFit(`${name} alternate patterns`, alternate.component.render(width), width)
        expectLinesFit(`${name} layout patterns`, layout(alternate.component as Component, width, 20).lines, width)
        expectLinesFit(`${name} main patterns`, main.component.render(width), width)
      }
    }
  })

  it('renders loader frames without owning timers', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout')
    const interval = vi.spyOn(globalThis, 'setInterval')
    try {
      const loader = compiled(ui.loader({ message: 'Loading', variant: 'braille', elapsedMs: 10 }), fixture().options)
      expect(loader.component.render(20)).toEqual(['⠋ Loading 10ms'])
      loader.component.invalidate()
      expect(timeout).not.toHaveBeenCalled()
      expect(interval).not.toHaveBeenCalled()
    } finally {
      timeout.mockRestore()
      interval.mockRestore()
    }
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
    expect(layout(compiled(ui.richText([{ text: 'x' }]), fixture({ components: nonErrorComponents }).options).component as Component, 12, 3).lines.join('')).toContain('unknown')

    const accessorError = Object.defineProperty({}, 'message', { get: () => { throw new Error('message getter escaped') } })
    const accessorComponents = { ...components, wrapText: () => { throw accessorError } } as BlueComponents
    expect(compiled(ui.richText([{ text: 'x' }]), fixture({ components: accessorComponents }).options).component.render(12).join('')).toContain('unknown render')

    const emptyMessageComponents = { ...components, wrapText: () => { throw new Error('   ') } } as BlueComponents
    expect(compiled(ui.richText([{ text: 'x' }]), fixture({ components: emptyMessageComponents }).options).component.render(12).join('')).toContain('unknown render')

    const revoked = Proxy.revocable({}, {})
    const hostileComponents = { ...components, wrapText: () => { throw revoked.proxy } } as BlueComponents
    const hostile = compiled(ui.richText([{ text: 'x' }]), fixture({ components: hostileComponents }).options)
    revoked.revoke()
    expect(hostile.component.render(12).join('')).toContain('unknown render')

    const overwideComponents = { ...components, wrapText: () => ['overwide row'] } as BlueComponents
    expect(compiled(ui.richText([{ text: 'x' }]), fixture({ components: overwideComponents }).options).component.render(4).every(row => visibleWidth(row) <= 4)).toBe(true)

    const brokenRoot = compiled(ui.stack.column([ui.text('x')]), fixture().options).component as unknown as { root: { render: (width: number) => string[] }, render: (width: number) => string[] }
    brokenRoot.root.render = () => { throw new Error('root exploded') }
    expect(brokenRoot.render(20).join('')).toContain('root exploded')
    brokenRoot.root.render = () => { throw 'root non-error' }
    expect(brokenRoot.render(20).join('')).toContain('unknown')
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

describe('compileBlueEditorShellNode', () => {
  it('reuses the injected editor through focus, input, layout, and direct rendering', () => {
    const editor = createTestEditor()
    editor.setText('draft')
    const shell = {
      kind: 'stack',
      direction: 'column',
      children: [
        { node: ui.text('before') },
        { node: { kind: 'editor-control' } },
        { node: ui.actions({ id: 'actions', items: [{ id: 'apply', label: 'Apply' }] }) },
      ],
    }
    const { events, result } = compiledEditorShell(shell, editor)
    expect(Object.isFrozen(result.node)).toBe(true)
    expect(result.focusTarget).toBe(result.component)
    result.focusTarget.focused = true

    for (const width of [40, 2, 1]) {
      const direct = result.component.render(width)
      expectLinesFit('editor shell direct', direct.map(row => row.replaceAll(CURSOR_MARKER, '')), width)
      const frame = layout(result.component as Component, width, 8).lines
      expectLinesFit('editor shell layout', frame.map(row => row.replaceAll(CURSOR_MARKER, '')), width)
    }
    expect(editor.focused).toBe(true)
    result.focusTarget.handleInput?.('!')
    expect(editor.getText()).toBe('draft!')

    result.focusTarget.handleInput?.('\t')
    result.component.render(40)
    expect(editor.focused).toBe(false)
    result.focusTarget.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'apply' }])

    result.focusTarget.handleInput?.('\x1b[Z')
    result.component.render(40)
    expect(editor.focused).toBe(true)
    result.focusTarget.focused = false
    expect(editor.focused).toBe(false)
    result.component.invalidate()
  })

  it('delegates Tab completion in an editor-only shell while multi-control shells keep roving', () => {
    const editorOnly = createTestEditor()
    const editorOnlyInput = vi.spyOn(editorOnly, 'handleInput')
    const root = compiledEditorShell({ kind: 'editor-control' }, editorOnly).result
    root.focusTarget.focused = true
    root.component.render(40)

    root.focusTarget.handleInput?.('\t')
    root.focusTarget.handleInput?.('\x1b[Z')

    expect(editorOnlyInput).toHaveBeenNthCalledWith(1, '\t')
    expect(editorOnlyInput).toHaveBeenNthCalledWith(2, '\x1b[Z')
    expect(editorOnly.focused).toBe(true)

    const rovingEditor = createTestEditor()
    const rovingInput = vi.spyOn(rovingEditor, 'handleInput')
    const shell = compiledEditorShell({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'editor-control' } },
        { node: ui.actions({ id: 'actions', items: [{ id: 'apply', label: 'Apply' }] }) },
      ],
    }, rovingEditor).result
    shell.focusTarget.focused = true

    shell.focusTarget.handleInput?.('\t')

    expect(rovingInput).not.toHaveBeenCalled()
    shell.component.render(40)
    expect(rovingEditor.focused).toBe(false)
  })

  it('reports checked failures, preserves dry-run focus, and restores the editor roving target', () => {
    const editor = createTestEditor()
    editor.setText('draft')
    const shell = {
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'editor-control' } },
        { node: ui.actions({ id: 'actions', items: [{ id: 'apply', label: 'Apply' }] }) },
      ],
    }
    const { events, result } = compiledEditorShell(shell, editor)

    result.focusTarget.focused = true
    result.component.render(20)
    expect(editor.focused).toBe(true)
    result.focusTarget.handleInput?.('\t')
    result.component.render(20)
    expect(editor.focused).toBe(false)

    const checked = result.component.renderChecked(2, { dryRun: true })
    expectLinesFit('editor shell checked dry render', checked.rows, 2)
    expect(result.focusTarget.focused).toBe(true)
    expect(editor.focused).toBe(false)
    result.focusTarget.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'apply' }])

    result.focusTarget.focused = false
    result.focusTarget.focusEditor()
    expect(result.focusTarget.focused).toBe(false)
    expect(editor.focused).toBe(false)
    result.focusTarget.focused = true
    result.focusTarget.handleInput?.('!')
    expect(editor.getText()).toBe('draft!')

    const candidate = compiledEditorShell(shell, editor).result
    editor.focused = true
    expect(candidate.focusTarget.focused).toBe(false)
    candidate.component.renderChecked(20, { dryRun: true })
    expect(candidate.focusTarget.focused).toBe(false)
    expect(editor.focused).toBe(true)

    const broken = createTestEditor()
    broken.render = () => { throw new Error('checked editor exploded') }
    const brokenShell = compiledEditorShell({ kind: 'editor-control' }, broken).result.component
    const failed = brokenShell.renderChecked(20)
    expect(failed.runtimeFailure).toBe('checked editor exploded')
    expect(failed.rows.join('')).toContain('checked editor exploded')
    expectLinesFit('editor shell checked runtime failure', failed.rows, 20)
    broken.focused = true
    const failedDry = brokenShell.renderChecked(20, { dryRun: true })
    expect(failedDry.runtimeFailure).toBe('checked editor exploded')
    expect(broken.focused).toBe(true)
  })

  it('compiles a root slot and contains validation, setup, and editor render failures', () => {
    const editor = createTestEditor()
    editor.setText('same object')
    const root = compiledEditorShell({ kind: 'editor-control' }, editor).result
    root.focusTarget.focused = true
    expect(root.component.render(20).join('')).toContain('same object')

    const invalid = compileBlueEditorShellNode(ui.text('missing'), { ...fixture().options, editor })
    expect(invalid).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    if (invalid.ok) throw new Error('expected failure')
    for (const width of [1, 2, 10]) expectLinesFit('editor shell rejection', invalid.errorComponent.render(width), width)

    expect(compileBlueEditorShellNode({ kind: 'editor-control' }, {
      ...fixture().options,
      editor: undefined as never,
    })).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: 'Blue editor shell compilation failed safely',
    })

    const broken = createTestEditor()
    broken.render = () => { throw new Error('editor exploded') }
    const contained = compiledEditorShell({ kind: 'editor-control' }, broken).result.component.render(20)
    expect(contained.join('')).toContain('editor exploded')
    expectLinesFit('editor shell runtime failure', contained, 20)

    const base = { ...fixture().options, editor }
    const options = new Proxy(base, { get: (target, key, receiver) => {
      if (key === 'getViewport') throw new Error('setup')
      return Reflect.get(target, key, receiver)
    } })
    expect(compileBlueEditorShellNode({ kind: 'editor-control' }, options)).toMatchObject({
      ok: false,
      code: 'BLUE_INVALID_CONTRIBUTION',
      message: 'Blue editor shell compilation failed safely',
    })
  })
})

describe('compileBlueStatusNode', () => {
  it('uses the narrowed validator and exposes no focus, input, or event surface', () => {
    const invalid = compileBlueStatusNode(ui.actions({ id: 'bad', items: [] }), statusOptions({ maxRows: 2 }))
    expect(invalid).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
    if (invalid.ok) throw new Error('expected failure')
    expect(invalid.errorComponent.renderStatus(8).rows.length).toBeLessThanOrEqual(2)
    expect(invalid.errorComponent.render(8).length).toBeLessThanOrEqual(2)

    const status = compiledStatus(ui.text('ready'))
    expect(status.node).toEqual({ kind: 'text', content: 'ready' })
    expect(status.component.render(20)).toEqual(['ready'])
    expect('focused' in status.component).toBe(false)
    expect('handleInput' in status.component).toBe(false)
    status.component.invalidate()
  })

  it('keeps compact row stacks spatial in main mode', () => {
    const status = compiledStatus(ui.stack.row([
      ui.child(ui.text('left'), { basis: 4, grow: 0, shrink: 0 }),
      ui.child(ui.text('right'), { basis: 5, grow: 0, shrink: 0 }),
    ], { gap: 1 }), statusOptions({ screenMode: 'main' }))
    const rows = status.component.render(20)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('left')
    expect(rows[0]).toContain('right')
  })

  it('bounds status height and reports row and column overflow', () => {
    const status = compiledStatus(ui.stack.column([
      ui.text('first'),
      ui.text('second'),
      ui.text('third'),
    ]), statusOptions({ maxRows: 2 }))
    expect(status.component.renderStatus(20)).toEqual({ rows: ['first', 'second'], overflowed: true })
    expect(status.component.render(20)).toEqual(['first', 'second'])

    const narrow = compiledStatus(ui.richText([{ text: 'abcdefghij' }]), statusOptions({ maxRows: 1 }))
    const rendered = narrow.component.renderStatus(4)
    expect(rendered.rows).toHaveLength(1)
    expect(rendered.overflowed).toBe(true)
    expectLinesFit('status overflow', rendered.rows, 4)

    const clamped = compiledStatus(ui.stack.column([ui.text('one'), ui.text('two')]), statusOptions({ maxRows: 99 as never }))
    expect(clamped.component.renderStatus(20)).toEqual({ rows: ['one'], overflowed: true })
  })

  it('evaluates status breakpoints against the allocated surface dimensions', () => {
    const status = compiledStatus({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'text', content: 'wide' }, when: { minWidth: 20 } },
        { node: { kind: 'text', content: 'tall' }, when: { minHeight: 4 } },
        { node: { kind: 'text', content: 'compact' }, when: { maxWidth: 19, maxHeight: 3 } },
      ],
    }, statusOptions({ viewport: { columns: 80, rows: 24 }, maxRows: 3 }))
    expect(status.component.renderStatus(18)).toEqual({ rows: ['compact'], overflowed: false })
    expect(status.component.renderStatus(20)).toEqual({ rows: ['wide'], overflowed: false })
  })

  it('contains validation, setup, and render failures in the status budget', () => {
    const invalid = compileBlueStatusNode({ kind: 'unknown' }, statusOptions({ maxRows: 1 }))
    if (invalid.ok) throw new Error('expected failure')
    const rejected = invalid.errorComponent.renderStatus(3)
    expect(rejected.rows.length).toBeLessThanOrEqual(1)
    expectLinesFit('status validation failure', rejected.rows, 3)
    invalid.errorComponent.invalidate()

    const throwingComponents = { ...components, wrapText: () => { throw new Error('status exploded') } } as BlueComponents
    const rendered = compiledStatus(ui.richText([{ text: 'safe' }]), statusOptions({ components: throwingComponents, maxRows: 2 })).component.renderStatus(12)
    expect(rendered.rows.join('')).toContain('status')
    expect(rendered.rows.length).toBeLessThanOrEqual(2)
    expect(rendered.runtimeFailure).toBe('status exploded')

    const broken = compiledStatus(ui.text('safe'), statusOptions({ maxRows: 2 })).component as unknown as {
      surface: { root: { render(width: number): string[] } }
      renderStatus(width: number): { rows: string[], overflowed: boolean, runtimeFailure?: string }
    }
    broken.surface.root.render = () => { throw new Error('status root exploded') }
    const failed = broken.renderStatus(12)
    expect(failed.rows.join('')).toContain('status')
    expect(failed.runtimeFailure).toBe('status root exploded')

    const base = statusOptions()
    const options = new Proxy(base, { get: (target, key, receiver) => {
      if (key === 'getViewport') throw new Error('setup')
      return Reflect.get(target, key, receiver)
    } })
    expect(compileBlueStatusNode(ui.text('x'), options)).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION', message: 'Blue status compilation failed safely' })
  })
})
