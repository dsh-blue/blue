/** Canonical compiler layout, focus, event, width, and failure containment. */
import { CURSOR_MARKER, HStack, ScrollView, stripTerminalSequences, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame, type LayoutBox, type LayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'
import { LAYOUT_NODE, type LayoutNode } from '@earendil-works/pi-tui/dist/layout-node.js'
import { describe, expect, it, vi } from 'vitest'
import { ui } from '../../ui/src/index.ts'
import {
  BlueUiSurfaceRuntime,
  compileBlueEditorShellNode,
  compileBlueStatusNode,
  compileBlueUiSurfaceNode,
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

function compiledSurface(value: unknown, options: BlueUiCompilerOptions, surfaceRuntime = new BlueUiSurfaceRuntime()) {
  const result = compileBlueUiSurfaceNode(value, { ...options, surfaceRuntime, refreshMode: 'external' })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return { ...result.value, surfaceRuntime }
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

  it('focuses and scrolls a windowed read-only leaf in main mode', () => {
    let offset = 1
    const offsets: number[] = []
    const observed = vi.fn()
    const result = compiledSurface(ui.scroll(ui.text('abcdefgh')), fixture({
      screenMode: 'main',
      maxLeafRows: 2,
      leafRowWindowPath: '$.scroll',
      leafRowOffset: () => offset,
      onLeafRowScroll: next => { offset = next; offsets.push(next) },
      onLeafRowOffset: observed,
    }).options)
    const focus = result.focusTarget!
    focus.focused = true
    expect(focus.render(2)).toEqual(['cd', 'ef'])
    expect(observed).toHaveBeenLastCalledWith(1, 4, 2)

    focus.handleInput?.('\x1b[B')
    expect(offset).toBe(2)
    expect(focus.render(2)).toEqual(['ef', 'gh'])
    focus.handleInput?.('\x1b[6~')
    expect(offset).toBe(2)
    focus.handleInput?.('\x1b[A')
    focus.handleInput?.('\x1b[5~')
    expect(offset).toBe(0)
    focus.handleInput?.('G')
    expect(offset).toBe(2)
    focus.handleInput?.('g')
    expect(offset).toBe(0)
    focus.handleInput?.('\x1b[F')
    expect(offset).toBe(2)
    focus.handleInput?.('\x1b[H')
    focus.handleInput?.('x')
    expect(offsets).toEqual([2, 1, 0, 2, 0, 2, 0])

    const defaultOffset = compiled(ui.scroll(ui.text('abcdefgh')), fixture({
      screenMode: 'main', leafRowWindowPath: '$.scroll', maxLeafRows: 2,
    }).options)
    expect(defaultOffset.component.render(2)).toEqual(['ab', 'cd'])
  })

  it('contains main-leaf offset reader and observer failures', () => {
    const result = compiled(ui.scroll(ui.text('a'.repeat(50))), fixture({
      screenMode: 'main',
      leafRowWindowPath: '$.scroll',
      leafRowOffset: () => { throw new Error('offset unavailable') },
      onLeafRowScroll: () => { throw new Error('observer unavailable') },
    }).options)
    expect(result.component.render(1)).toHaveLength(20)
    expect(() => result.focusTarget!.handleInput?.('\x1b[B')).not.toThrow()
  })

  it('clears a compiled scroll binding when its responsive branch is hidden', () => {
    const result = compiled(ui.stack.column([
      ui.child(ui.scroll(ui.text('hidden')), { when: { minWidth: 100 } }),
    ]), fixture({ getViewport: () => ({ columns: 40, rows: 10 }) }).options)
    expect(result.focusTarget).not.toBeNull()
    expect(result.component.render(40)).toEqual([])
  })

  it('restores main-scroll bindings after a persistent compile failure', () => {
    const runtime = new BlueUiSurfaceRuntime()
    let offset = 0
    const first = compileBlueUiSurfaceNode(ui.scroll(ui.text('abcdefgh')), {
      ...fixture({
        screenMode: 'main', maxLeafRows: 2, leafRowWindowPath: '$.scroll',
        leafRowOffset: () => offset, onLeafRowScroll: next => { offset = next },
      }).options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    first.value.component.render(2)

    const failed = compileBlueUiSurfaceNode(ui.text('broken markdown'), {
      ...fixture({
        components: { ...components, createMarkdown: () => { throw new Error('setup failed') } } as BlueComponents,
        markdownLeafPath: '$',
      }).options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(failed.ok).toBe(false)
    first.value.focusTarget!.handleInput?.('\x1b[B')
    expect(offset).toBe(1)
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

  it('uses one roving focus target, skips disabled controls, and keeps Tab inside one group', () => {
    const { options, events } = fixture()
    const result = compiled(ui.actions({ id: 'actions', items: [{ id: 'one', label: 'One' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'three', label: 'Three' }] }), options)
    const focus = result.focusTarget!
    expect(focus).toBe(result.component)
    focus.focused = true
    expect(focus.render(40).join('')).toContain(CURSOR_MARKER)
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'three' }])
    focus.handleInput?.('\x1b[Z')
    focus.handleInput?.('\x1b[D')
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
    viewport.columns = 40
    expect(result.component.render(40).join('')).not.toContain(CURSOR_MARKER)
    viewport.columns = 80
    expect(result.component.render(80).join('').match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
  })

  it('preserves the roving index across overlay-style focused false -> true', () => {
    const { options, events } = fixture()
    const focus = compiled(ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), options).focusTarget!
    focus.focused = true
    focus.handleInput?.('\x1b[C')
    focus.focused = false
    expect(focus.render(20).join('')).not.toContain(CURSOR_MARKER)
    focus.focused = true
    expect(focus.render(20).join('')).toContain(CURSOR_MARKER)
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'tab-change', controlId: 'tabs', tabId: 'b' }])
  })

  it('keeps semantic focus, editor cursor, drafts, and confirmation in one surface runtime', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const firstFixture = fixture()
    const first = compileBlueUiSurfaceNode(ui.stack.column([
      ui.text('before'),
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'AB' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
      ] }),
      ui.actions({ id: 'footer-actions', items: [{ id: 'delete', label: 'Delete', confirm: 'Really?' }] }),
    ]), { ...firstFixture.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const stale = first.value.focusTarget!
    stale.focused = true
    stale.handleInput?.('\r')
    stale.handleInput?.('\x1b[D')
    stale.handleInput?.('X')
    expect(firstFixture.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'AXB' })

    const secondFixture = fixture()
    const second = compileBlueUiSurfaceNode(ui.stack.column([
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Display name', value: 'AXB' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
      ] }),
      ui.text('path changed'),
      ui.actions({ id: 'footer-actions', items: [{ id: 'delete', label: 'Delete', confirm: 'Really?' }] }),
    ]), { ...secondFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.message)
    const current = second.value.focusTarget!
    current.focused = true
    current.handleInput?.('Y')
    expect(secondFixture.events).toEqual([{ kind: 'value-change', controlId: 'name', value: 'AXYB' }])
    stale.handleInput?.('stale')
    expect(firstFixture.events).toHaveLength(1)
    expect(secondFixture.events).toHaveLength(1)
    layout(stale as Component, 40, 4)
    ;(stale as unknown as { focusEditor(): void }).focusEditor()
    stale.invalidate()

    current.handleInput?.('\x1b')
    current.handleInput?.('\x1b[B')
    current.handleInput?.('\r')
    current.handleInput?.('\t')
    current.handleInput?.('\r')
    const thirdFixture = fixture()
    const third = compileBlueUiSurfaceNode(ui.stack.column([
      ui.actions({ id: 'footer-actions', items: [{ id: 'delete', label: 'Delete', confirm: 'Really?' }] }),
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Display name', value: 'AXYB' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      ] }),
    ]), { ...thirdFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(third.ok).toBe(true)
    if (!third.ok) throw new Error(third.message)
    third.value.focusTarget!.focused = true
    expect(third.value.component.render(80).join('\n')).toContain('Enabled: [on]')
    const confirmationFixture = fixture()
    const confirmation = compileBlueUiSurfaceNode(ui.stack.column([
      ui.actions({ id: 'footer-actions', items: [{ id: 'delete', label: 'Delete', confirm: 'Really?' }] }),
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Display name', value: 'AXYB' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      ] }),
    ]), { ...confirmationFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(confirmation.ok).toBe(true)
    if (!confirmation.ok) throw new Error(confirmation.message)
    confirmation.value.focusTarget!.focused = true
    expect(confirmation.value.component.render(80).join('\n')).toContain('Really?')

    const externalFixture = fixture()
    const external = compileBlueUiSurfaceNode(ui.form({ id: 'profile', fields: [
      { kind: 'input', id: 'name', label: 'Name', value: 'Server' },
      { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
    ] }), { ...externalFixture.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(external.ok).toBe(true)
    if (!external.ok) throw new Error(external.message)
    external.value.focusTarget!.focused = true
    expect(external.value.component.render(80).join('\n')).toContain('Server')
    external.value.focusTarget!.handleInput?.('\x1b[A')
    external.value.focusTarget!.handleInput?.('\r')
    external.value.focusTarget!.handleInput?.('\r')
    expect(externalFixture.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'Server' })

    runtime.dispose()
    external.value.focusTarget!.handleInput?.('ignored')
    expect(externalFixture.events).toHaveLength(1)
    expect(external.value.component.render(80)).toEqual([])
    expect(runtime.state.controls()).toEqual([])
    expect(runtime.state.allControls()).toEqual([])
    runtime.state.emit({ kind: 'activate', controlId: 'ignored' })
    expect(() => runtime.state.textEditor({ kind: 'input', id: 'name', label: 'Name', value: '' }, 'missing')).toThrow('inactive')
    const afterDispose = compileBlueUiSurfaceNode(ui.text('ignored'), { ...externalFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(afterDispose.ok).toBe(false)
    runtime.deactivate()
    runtime.dispose()
  })

  it('retains a Director textarea while its tab content is temporarily absent', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editor.handleInput = vi.fn(editor.handleInput)
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const configureTree = (value: string, moved = false) => {
      const form = ui.form({ id: 'director-form', fields: [{ kind: 'textarea' as const, id: 'instructions', label: 'Instructions', value }] })
      return ui.stack.column([
        ui.tabs({ id: 'director-tabs', activeId: 'configure', items: [
          { id: 'overview', label: 'Overview' },
          { id: 'configure', label: 'Configure' },
        ] }),
        ...(moved ? [ui.surface({ child: form })] : [form]),
        ui.actions({ id: 'director-actions', items: [{ id: 'save', label: 'Save', intent: 'primary' }] }),
      ])
    }
    const firstFixture = fixture({ components: localComponents })
    const first = compileBlueUiSurfaceNode(configureTree('AB'), { ...firstFixture.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const stale = first.value.focusTarget!
    stale.focused = true
    first.value.component.render(80)
    stale.handleInput?.('\r')
    stale.handleInput?.('\r')
    stale.handleInput?.('\x1b[D')
    stale.handleInput?.('X')
    expect(firstFixture.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'instructions', value: 'AXB' })
    expect(editors).toHaveLength(1)

    const overviewFixture = fixture({ components: localComponents })
    const overview = compileBlueUiSurfaceNode(ui.stack.column([
      ui.tabs({ id: 'director-tabs', activeId: 'overview', items: [
        { id: 'overview', label: 'Overview' },
        { id: 'configure', label: 'Configure' },
      ] }),
      ui.text('overview'),
    ]), { ...overviewFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(overview.ok).toBe(true)
    if (!overview.ok) throw new Error(overview.message)
    overview.value.component.render(80)
    expect(editors[0]!.focused).toBe(false)

    const restoredFixture = fixture({ components: localComponents })
    const restored = compileBlueUiSurfaceNode(configureTree('AXB', true), { ...restoredFixture.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    const target = restored.value.focusTarget!
    target.focused = true
    target.render(80)
    target.handleInput?.('\r')
    target.handleInput?.('\r')
    target.handleInput?.('Y')
    expect(restoredFixture.events).toEqual([{ kind: 'value-change', controlId: 'instructions', value: 'AXYB' }])
    expect(editors).toHaveLength(1)
    expect(editors[0]!.handleInput).not.toHaveBeenCalledWith('\x1b[B')
    const restoredRows = restored.value.component.render(80).join('\n')
    expect(restoredRows.replaceAll(CURSOR_MARKER, '')).toContain('Instructions: AXYB')
    expect(restoredRows.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
    stale.handleInput?.('ignored')
    expect(firstFixture.events).toHaveLength(1)
    expect(restoredFixture.events).toHaveLength(1)
  })

  it('keeps TokenLedger nested-tab focus through tree and item reorder', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const f = fixture()
    const first = compileBlueUiSurfaceNode(ui.stack.column([
      ui.tabs({ id: 'ledger-view', activeId: 'projects', items: [
        { id: 'overview', label: 'Overview' },
        { id: 'projects', label: 'Projects' },
      ] }),
      ui.surface({ child: ui.stack.column([
        ui.text('usage ledger'),
        ui.tabs({ id: 'metric-view', activeId: 'cost', items: [
          { id: 'tokens', label: 'Tokens' },
          { id: 'cost', label: 'Cost' },
        ] }),
      ]) }),
    ]), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const stale = first.value.focusTarget!
    stale.focused = true
    first.value.component.render(80)
    stale.handleInput?.('\r')
    stale.handleInput?.('\x1b[D')

    const reordered = compileBlueUiSurfaceNode(ui.stack.column([
      ui.surface({ child: ui.stack.column([
        ui.tabs({ id: 'metric-view', activeId: 'cost', items: [
          { id: 'cost', label: 'Cost' },
          { id: 'tokens', label: 'Tokens' },
        ] }),
        ui.text('usage ledger'),
      ]) }),
      ui.tabs({ id: 'ledger-view', activeId: 'overview', items: [
        { id: 'projects', label: 'Projects' },
        { id: 'overview', label: 'Overview' },
      ] }),
    ]), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) throw new Error(reordered.message)
    const target = reordered.value.focusTarget!
    target.focused = true
    const rows = reordered.value.component.render(80).join('')
    expect(rows.match(new RegExp(CURSOR_MARKER, 'gu'))).toHaveLength(1)
    expect(target.captureFocusIdentity?.()).toMatchObject({ controlId: 'metric-view', itemId: 'tokens' })
    target.handleInput?.('\x1b[D')
    expect(f.events).toEqual([
      { kind: 'tab-change', controlId: 'metric-view', tabId: 'tokens' },
      { kind: 'tab-change', controlId: 'metric-view', tabId: 'cost' },
    ])
    stale.handleInput?.('\r')
    expect(f.events).toHaveLength(2)
  })

  it('keeps duplicate action node ids in separate semantic navigation groups', () => {
    const f = fixture()
    const target = compiled(ui.stack.column([
      ui.actions({ id: 'shared', items: [{ id: 'first-a', label: 'First A' }, { id: 'first-b', label: 'First B' }] }),
      ui.actions({ id: 'shared', items: [{ id: 'second-a', label: 'Second A' }, { id: 'second-b', label: 'Second B' }] }),
    ]), f.options).focusTarget!
    expect(target.restoreFocusIdentity?.({ controlId: 'first-b' })).toBe(true)
    expect(target.captureFocusIdentity?.()).toMatchObject({ controlId: 'first-b' })
    target.handleInput?.('\r')
    target.handleInput?.('\t')
    expect(target.captureFocusIdentity?.()).toMatchObject({ controlId: 'second-a' })
    target.handleInput?.('\x1b[C')
    target.handleInput?.('\r')
    target.handleInput?.('\x1b[Z')
    expect(target.captureFocusIdentity?.()).toMatchObject({ controlId: 'first-b' })
    expect(f.events).toEqual([
      { kind: 'activate', controlId: 'first-b' },
      { kind: 'activate', controlId: 'second-b' },
    ])
  })

  it('blurs pooled editors when responsive visibility or disabled state removes their control', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const tree = (disabled = false) => ui.stack.column([
      ui.child(ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'AB', disabled }] }), { when: { minWidth: 60 } }),
    ])
    const first = compileBlueUiSurfaceNode(tree(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    first.value.focusTarget!.focused = true
    first.value.component.render(80)
    expect(editors[0]!.focused).toBe(false)
    first.value.focusTarget!.handleInput?.('\r')
    first.value.component.render(80)
    expect(editors[0]!.focused).toBe(true)

    f.viewport.columns = 40
    first.value.component.render(40)
    expect(editors[0]!.focused).toBe(false)
    f.viewport.columns = 80
    first.value.component.render(80)
    expect(editors[0]!.focused).toBe(true)

    const disabled = compileBlueUiSurfaceNode(tree(true), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(disabled.ok).toBe(true)
    if (!disabled.ok) throw new Error(disabled.message)
    expect(disabled.value.focusTarget).toBeNull()
    const disabledLayout = disabled.value.component as BlueComponent & { [LAYOUT_NODE](): LayoutNode }
    disabledLayout[LAYOUT_NODE]()
    expect(editors[0]!.focused).toBe(false)

    const restored = compileBlueUiSurfaceNode(tree(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    restored.value.focusTarget!.focused = true
    restored.value.component.render(80)
    expect(editors).toHaveLength(1)
    expect(editors[0]!.focused).toBe(false)
  })

  it('restores responsive focus by semantic id but forgets controls that are removed', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const f = fixture()
    const tree = (disabled = false) => ui.stack.column([
      ui.child(ui.tabs({ id: 'modes', activeId: 'b', items: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta', disabled },
      ] }), { when: { minWidth: 60 } }),
      ui.actions({ id: 'fallback', items: [{ id: 'fallback', label: 'Fallback' }] }),
    ])
    const first = compileBlueUiSurfaceNode(tree(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const firstFocus = first.value.focusTarget!
    firstFocus.focused = true
    firstFocus.handleInput?.('\x1b[D')
    firstFocus.handleInput?.('\x1b[C')
    expect(f.events.at(-1)).toEqual({ kind: 'tab-change', controlId: 'modes', tabId: 'b' })

    f.viewport.columns = 40
    first.value.component.render(40)
    firstFocus.handleInput?.('\r')
    expect(f.events.at(-1)).toEqual({ kind: 'activate', controlId: 'fallback' })

    f.viewport.columns = 80
    first.value.component.render(80)
    expect(firstFocus.captureFocusIdentity?.()).toMatchObject({ controlId: 'modes', itemId: 'b' })

    f.viewport.columns = 40
    first.value.component.render(40)
    const removed = compileBlueUiSurfaceNode(tree(true), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error(removed.message)
    removed.value.focusTarget!.focused = true
    removed.value.component.render(40)
    removed.value.focusTarget!.handleInput?.('\r')
    expect(f.events.at(-1)).toEqual({ kind: 'activate', controlId: 'fallback' })

    const restored = compileBlueUiSurfaceNode(tree(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    f.viewport.columns = 80
    restored.value.component.render(80)
    restored.value.focusTarget!.focused = true
    restored.value.focusTarget!.handleInput?.('\r')
    expect(f.events.at(-1)).toEqual({ kind: 'activate', controlId: 'fallback' })
  })

  it('falls back to the preferred sibling when the selected semantic control is removed', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const f = fixture()
    const tabs = (withBeta: boolean) => ui.tabs({ id: 'modes', activeId: 'a', items: [
      { id: 'a', label: 'Alpha' },
      ...(withBeta ? [{ id: 'b', label: 'Beta' }] : []),
    ] })
    const first = compileBlueUiSurfaceNode(tabs(true), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    first.value.focusTarget!.handleInput?.('\x1b[C')
    const removed = compileBlueUiSurfaceNode(tabs(false), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error(removed.message)
    expect(removed.value.focusTarget!.captureFocusIdentity?.()).toMatchObject({ controlId: 'modes', itemId: 'a' })

    const firstSiblingRuntime = new BlueUiSurfaceRuntime()
    const firstSiblingFixture = fixture()
    const selected = compileBlueUiSurfaceNode(ui.actions({ id: 'commands', items: [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ] }), { ...firstSiblingFixture.options, surfaceRuntime: firstSiblingRuntime, refreshMode: 'external' })
    expect(selected.ok).toBe(true)
    if (!selected.ok) throw new Error(selected.message)
    selected.value.focusTarget!.handleInput?.('\x1b[C')
    const firstSibling = compileBlueUiSurfaceNode(ui.actions({ id: 'commands', items: [
      { id: 'a', label: 'Alpha' },
    ] }), { ...firstSiblingFixture.options, surfaceRuntime: firstSiblingRuntime, refreshMode: 'internal' })
    expect(firstSibling.ok).toBe(true)
    if (!firstSibling.ok) throw new Error(firstSibling.message)
    firstSibling.value.focusTarget!.handleInput?.('\r')
    expect(firstSiblingFixture.events.at(-1)).toEqual({ kind: 'activate', controlId: 'a' })
  })

  it('rolls back external setup failure without clearing local state or moving the editor cursor', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const first = compileBlueUiSurfaceNode(ui.stack.column([
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'AB' },
        { kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [{ id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' }] },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: true },
      ] }),
      ui.actions({ id: 'danger', items: [{ id: 'delete', label: 'Delete', confirm: 'Really?' }] }),
    ]), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const focus = first.value.focusTarget!
    focus.focused = true
    first.value.component.render(80)
    expect(editors).toHaveLength(1)
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[D')
    focus.handleInput?.('X')
    focus.handleInput?.('\x1b')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')

    const failingComponents = {
      ...localComponents,
      createMarkdown: () => { throw new Error('setup failed') },
    } as BlueComponents
    const failed = compileBlueUiSurfaceNode(ui.stack.column([
      ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'Server' }] }),
      ui.text('failure after the form'),
    ]), {
      ...f.options,
      components: failingComponents,
      markdownLeafPath: '$.1',
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(failed.ok).toBe(false)

    expect(first.value.component.render(80).join('\n').replaceAll(CURSOR_MARKER, '')).toContain('Name: AXB')
    expect(first.value.component.render(80).join('\n')).toContain('Theme: Light')
    expect(first.value.component.render(80).join('\n')).toContain('Enabled: [off]')
    focus.handleInput?.('\r')
    expect(f.events.at(-1)).toEqual({ kind: 'activate', controlId: 'delete' })
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[A')
    focus.handleInput?.('\x1b[A')
    focus.handleInput?.('\r')
    focus.handleInput?.('Y')
    expect(f.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'AXYB' })
    expect(first.value.component.render(40).join('').replaceAll(CURSOR_MARKER, '')).toContain('AXYB')
    expect(editors).toHaveLength(1)
  })

  it('retains an inactive field editor and draft until the semantic field returns', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const form = ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'AB' }] })
    const first = compileBlueUiSurfaceNode(form, { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const firstTarget = first.value.focusTarget!
    firstTarget.focused = true
    first.value.component.render(40)
    expect(editors).toHaveLength(1)
    firstTarget.handleInput?.('\r')
    firstTarget.handleInput?.('\x1b[D')
    firstTarget.handleInput?.('X')
    expect(f.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'AXB' })
    const staleChange = editors[0]!.onChange!
    const staleSubmit = editors[0]!.onSubmit!

    const removed = compileBlueUiSurfaceNode(ui.text('removed'), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error(removed.message)
    expect(editors[0]!.focused).toBe(false)
    removed.value.component.render(40)
    staleChange('ignored')
    staleSubmit('ignored')
    expect(f.events).toHaveLength(1)

    const reused = compileBlueUiSurfaceNode(form, { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(reused.ok).toBe(true)
    if (!reused.ok) throw new Error(reused.message)
    reused.value.component.render(40)
    expect(editors).toHaveLength(1)
    reused.value.focusTarget!.focused = true
    reused.value.focusTarget!.handleInput?.('\r')
    reused.value.focusTarget!.handleInput?.('Y')
    expect(f.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'name', value: 'AXYB' })
    firstTarget.handleInput?.('stale')
    expect(f.events).toHaveLength(2)
    const disposedChange = editors[0]!.onChange!
    const disposedSubmit = editors[0]!.onSubmit!
    runtime.dispose()
    disposedChange('ignored')
    disposedSubmit('ignored')
    expect(f.events).toHaveLength(2)
  })

  it('cleans replaced and disposed compatibility-resolved editors', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const firstEditor = createTestEditor()
    const secondEditor = createTestEditor()
    const firstKey = vi.fn(() => false)
    const secondKey = vi.fn(() => false)
    firstEditor.onKey = firstKey
    secondEditor.onKey = secondKey
    let resolved = firstEditor
    const f = fixture({ resolveTextEditor: () => resolved })
    const form = ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'Blue' }] })
    const first = compileBlueUiSurfaceNode(form, {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    first.value.focusTarget!.focused = true
    first.value.focusTarget!.handleInput?.('\r')
    first.value.component.render(40)
    expect(firstEditor.focused).toBe(true)
    const staleChange = firstEditor.onChange!
    const staleSubmit = firstEditor.onSubmit!

    resolved = secondEditor
    const replaced = compileBlueUiSurfaceNode(form, {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) throw new Error(replaced.message)
    replaced.value.component.render(40)
    expect(firstEditor.focused).toBe(false)
    expect(firstEditor.onChange).toBeUndefined()
    expect(firstEditor.onSubmit).toBeUndefined()
    expect(firstEditor.onKey).toBe(firstKey)
    expect(secondEditor.onChange).toBeTypeOf('function')
    expect(secondEditor.onSubmit).toBeTypeOf('function')
    staleChange('ignored')
    staleSubmit('ignored')
    expect(f.events).toEqual([])

    runtime.deactivate()
    expect(secondEditor.focused).toBe(false)
    expect(secondEditor.onChange).toBeUndefined()
    expect(secondEditor.onSubmit).toBeUndefined()
    expect(secondEditor.onKey).toBe(secondKey)

    const rebound = compileBlueUiSurfaceNode(form, {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(rebound.ok).toBe(true)
    if (!rebound.ok) throw new Error(rebound.message)
    rebound.value.component.render(40)
    const disposedChange = secondEditor.onChange!
    const disposedSubmit = secondEditor.onSubmit!
    const externalChange = vi.fn()
    const externalSubmit = vi.fn()
    secondEditor.onChange = externalChange
    secondEditor.onSubmit = externalSubmit
    runtime.dispose()
    expect(secondEditor.focused).toBe(false)
    expect(secondEditor.onChange).toBe(externalChange)
    expect(secondEditor.onSubmit).toBe(externalSubmit)
    expect(secondEditor.onKey).toBe(secondKey)
    disposedChange('ignored')
    disposedSubmit('ignored')
    expect(f.events).toEqual([])
  })

  it('drops incompatible field state when a semantic field changes kind', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const input = () => ui.form({ id: 'profile', fields: [{ kind: 'input' as const, id: 'mode', label: 'Mode', value: 'A' }] })
    const first = compileBlueUiSurfaceNode(input(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'external' })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    first.value.component.render(40)
    first.value.focusTarget!.handleInput?.('B')
    expect(f.events.at(-1)).toEqual({ kind: 'value-change', controlId: 'mode', value: 'AB' })

    const select = compileBlueUiSurfaceNode(ui.form({ id: 'profile', fields: [{
      kind: 'select', id: 'mode', label: 'Mode', value: 'dark', options: [{ id: 'dark', label: 'Dark' }],
    }] }), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(select.ok).toBe(true)
    if (!select.ok) throw new Error(select.message)
    expect(select.value.component.render(40).join('\n')).toContain('Mode: Dark')

    const restored = compileBlueUiSurfaceNode(input(), { ...f.options, surfaceRuntime: runtime, refreshMode: 'internal' })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    expect(restored.value.component.render(40).join('\n')).toContain('Mode: A')
    expect(restored.value.component.render(40).join('\n')).not.toContain('AB')
    expect(editors).toHaveLength(2)
  })

  it('evicts the oldest inactive field after the registration cache reaches 64 entries', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const field = (index: number) => ui.form({ id: 'profile', fields: [{ kind: 'input' as const, id: `field-${String(index)}`, label: `Field ${String(index)}`, value: '' }] })
    const compileField = (index: number, refreshMode: 'internal' | 'external') => {
      const result = compileBlueUiSurfaceNode(field(index), { ...f.options, surfaceRuntime: runtime, refreshMode })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.message)
      result.value.component.render(40)
    }

    compileField(0, 'external')
    for (let index = 1; index <= 64; index += 1) compileField(index, 'internal')
    expect(editors).toHaveLength(65)
    const oldestInactiveEditor = editors[1]!
    compileField(0, 'internal')
    expect(editors).toHaveLength(65)
    compileField(65, 'internal')
    expect(editors).toHaveLength(66)
    expect(oldestInactiveEditor.onChange).toBeUndefined()
    compileField(0, 'internal')
    expect(editors).toHaveLength(66)
    compileField(1, 'internal')
    expect(editors).toHaveLength(67)
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
    list.focusTarget!.handleInput?.(' ')
    expect(events).toEqual([{ kind: 'selection-change', controlId: 'list', value: [] }])
    expect(list.node).toMatchObject({ selectedIds: ['a'] })
  })

  it('ignores unrelated keys on toggle and submit controls', () => {
    const f = fixture()
    const focus = compiled(ui.form({
      id: 'form',
      fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled', value: false }],
      submitActionId: 'Save',
    }), f.options).focusTarget!
    focus.handleInput?.('x')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('x')
    expect(f.events).toEqual([])
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
    focus.handleInput?.('\x7f')
    expect(events).toEqual([])
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

    focus.handleInput?.('\x1b')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('note')
    focus.handleInput?.('\x1b')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('z')
    expect(focus.render(80).join('\n')).toContain('Secret: ••')
    focus.handleInput?.('\x1b')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[C')
    expect(focus.render(80).join('\n')).toContain('Choice: ‹ Alpha ›')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
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
    selectDraft.focusTarget!.focused = true
    selectDraft.focusTarget!.handleInput?.('\x1b[D')
    expect(selectDraft.component.render(40).join('')).toContain('Choose…')
    selectDraft.focusTarget!.handleInput?.('\r')
    selectDraft.focusTarget!.handleInput?.('\x1b[D')
    expect(selectDraft.component.render(40).join('')).toContain('‹ Beta ›')
    selectDraft.focusTarget!.handleInput?.('\x1b')
    expect(selectDraft.component.render(40).join('')).toContain('Choose…')
    const selectRefresh = compiled(ui.form({ id: 'select-form', fields: [{ kind: 'select', id: 'select', label: 'Select', value: 'b', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] }] }), fixture().options)
    expect(selectRefresh.component.render(40).join('')).toContain('Beta')

    const noOptionsEvents: unknown[] = []
    const noOptions = compiled(ui.form({ id: 'empty-select', fields: [{ kind: 'select', id: 'empty', label: 'Empty', value: null, options: [{ id: 'disabled', label: 'Disabled', disabled: true }] }] }), fixture({ emit: event => noOptionsEvents.push(event) }).options)
    noOptions.focusTarget!.handleInput?.('\x1b[C')
    noOptions.focusTarget!.handleInput?.('\r')
    noOptions.focusTarget!.handleInput?.('\x1b[C')
    noOptions.focusTarget!.handleInput?.('\r')
    expect(noOptionsEvents).toEqual([{ kind: 'value-change', controlId: 'empty', value: null }])

    const pasteEvents: unknown[] = []
    const pasteText = compiled(ui.form({ id: 'paste-form', fields: [{ kind: 'input', id: 'paste', label: 'Paste', value: '' }] }), fixture({ emit: event => pasteEvents.push(event) }).options)
    pasteText.focusTarget!.handleInput?.('\x1b[200~pasted\x1b[201~')
    expect(pasteEvents).toEqual([{ kind: 'value-change', controlId: 'paste', value: 'pasted' }])

    const enterEvents: unknown[] = []
    const enterEditor = createTestEditor()
    const enterText = compiled(ui.form({ id: 'enter-form', fields: [{ kind: 'input', id: 'enter', label: 'Enter', value: 'value' }] }), fixture({
      emit: event => enterEvents.push(event),
      resolveTextEditor: () => enterEditor,
    }).options)
    enterText.focusTarget!.focused = true
    enterText.focusTarget!.handleInput?.('\r')
    enterText.component.render(40)
    expect(enterEditor.focused).toBe(true)
    expect(enterEvents).toEqual([])
    enterText.focusTarget!.handleInput?.('\r')
    const submittedRows = enterText.component.render(40).join('\n')
    expect(enterEditor.focused).toBe(false)
    expect(submittedRows).toContain('→ Enter: value')
    expect(enterEvents).toEqual([{ kind: 'value-change', controlId: 'enter', value: 'value' }])

    const textareaEvents: unknown[] = []
    const textareaEditor = createTestEditor()
    const textarea = compiled(ui.form({ id: 'notes-form', fields: [{ kind: 'textarea', id: 'notes', label: 'Notes', value: 'first' }] }), fixture({
      emit: event => textareaEvents.push(event),
      resolveTextEditor: () => textareaEditor,
    }).options)
    textarea.focusTarget!.focused = true
    textarea.focusTarget!.handleInput?.('\r')
    textarea.component.render(40)
    expect(textareaEditor.focused).toBe(true)
    textarea.focusTarget!.handleInput?.('\x1b[D')
    textarea.focusTarget!.handleInput?.('\x1b\r')
    textarea.focusTarget!.handleInput?.('\x1b[13;3u')
    expect(textareaEditor.getExpandedText()).toBe('firs\n\nt')
    textarea.focusTarget!.handleInput?.('\r')
    textarea.component.render(40)
    expect(textareaEditor.focused).toBe(false)
    expect(textareaEditor.getExpandedText()).toBe('firs\n\nt')
    expect(textareaEvents).toEqual([
      { kind: 'value-change', controlId: 'notes', value: 'firs\nt' },
      { kind: 'value-change', controlId: 'notes', value: 'firs\n\nt' },
      { kind: 'value-change', controlId: 'notes', value: 'firs\n\nt' },
    ])
  })

  it('treats select adjustment as an explicit confirmable transaction', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const f = fixture()
    const form = (value: string) => ui.form({
      id: 'profile',
      fields: [{ kind: 'select', id: 'mode', label: 'Mode', value, options: [
        { id: 'guided', label: 'Guided' },
        { id: 'direct', label: 'Direct' },
        { id: 'review', label: 'Review' },
      ] }],
      submitActionId: 'Save',
    })
    const first = compileBlueUiSurfaceNode(form('guided'), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const focus = first.value.focusTarget!
    focus.focused = true

    focus.handleInput?.(' ')
    focus.handleInput?.('\x1b[C')
    expect(first.value.component.render(60).join('\n')).toContain('→ Mode: Guided')
    expect(f.events).toEqual([])

    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[C')
    expect(first.value.component.render(60).join('\n')).toContain('→ Mode: ‹ Direct ›')
    focus.handleInput?.('\x1b[B')
    expect(first.value.component.render(60).join('\n')).toContain('→ Mode: ‹ Direct ›')
    focus.handleInput?.('\t')
    expect(first.value.component.render(60).join('\n')).toContain('→ Mode: Direct')
    expect(f.events).toEqual([{ kind: 'value-change', controlId: 'mode', value: 'direct' }])

    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[D')
    focus.handleInput?.('\x1b[27u')
    expect(first.value.component.render(60).join('\n')).toContain('→ Mode: Direct')
    expect(f.events).toHaveLength(1)

    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[C')
    const refreshed = compileBlueUiSurfaceNode(form('review'), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) throw new Error(refreshed.message)
    const refreshedFocus = refreshed.value.focusTarget!
    refreshedFocus.focused = true
    expect(refreshed.value.component.render(60).join('\n')).toContain('→ Mode: Review')
    f.events.length = 0

    refreshedFocus.handleInput?.('\r')
    refreshedFocus.handleInput?.('\x1b[C')
    refreshedFocus.handleInput?.('\x1b[Z')
    refreshedFocus.handleInput?.('\x1b[B')
    refreshedFocus.handleInput?.('\r')
    expect(f.events).toEqual([
      { kind: 'value-change', controlId: 'mode', value: 'review' },
      { kind: 'submit', controlId: 'profile', values: { mode: 'review' } },
    ])

    refreshedFocus.handleInput?.('\x1b[A')
    refreshedFocus.handleInput?.('\r')
    refreshedFocus.handleInput?.('\x1b[D')
    refreshedFocus.handleInput?.('\r')
    refreshedFocus.handleInput?.('\x1b[B')
    refreshedFocus.handleInput?.('\r')
    expect(f.events).toEqual([
      { kind: 'value-change', controlId: 'mode', value: 'review' },
      { kind: 'submit', controlId: 'profile', values: { mode: 'review' } },
      { kind: 'value-change', controlId: 'mode', value: 'direct' },
      { kind: 'submit', controlId: 'profile', values: { mode: 'direct' } },
    ])
  })

  it('consumes Alt+Enter in single-line and secret fields', () => {
    const editors = new Map<string, BlueEditor>()
    const f = fixture({
      resolveTextEditor: controlId => {
        let editor = editors.get(controlId)
        if (editor === undefined) {
          editor = createTestEditor()
          editors.set(controlId, editor)
        }
        return editor
      },
    })
    const result = compiled(ui.form({ id: 'credentials', fields: [
      { kind: 'input', id: 'name', label: 'Name', value: 'Blue' },
      { kind: 'secret', id: 'token', label: 'Token', value: 'secret' },
    ] }), f.options)
    const focus = result.focusTarget!
    focus.focused = true

    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b\r')
    focus.handleInput?.('\x1b[13;3u')
    expect(editors.get('name')?.getExpandedText()).toBe('Blue')
    focus.handleInput?.('\x1b[13u')
    expect(editors.get('name')?.focused).toBe(false)

    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b\r')
    focus.handleInput?.('\x1b[13;3u')
    expect(editors.get('token')?.getExpandedText()).toBe('secret')
    focus.handleInput?.('\n')
    expect(editors.get('token')?.focused).toBe(false)
    expect(f.events).toEqual([
      { kind: 'value-change', controlId: 'name', value: 'Blue' },
      { kind: 'value-change', controlId: 'token', value: 'secret' },
    ])
  })

  it('does not leave the active field when another editor submits late', () => {
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const { options, events } = fixture({ components: localComponents })
    const result = compiled(ui.form({ id: 'late-submit', fields: [
      { kind: 'input', id: 'first', label: 'First', value: 'one' },
      { kind: 'input', id: 'second', label: 'Second', value: 'two' },
    ] }), options)
    const focus = result.focusTarget!
    focus.focused = true
    result.component.render(60)
    expect(editors).toHaveLength(2)
    const lateSubmit = editors[0]!.onSubmit!

    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    result.component.render(60)
    expect(editors[1]!.focused).toBe(true)

    lateSubmit('late-one')
    const rows = result.component.render(60).join('\n')
    expect(rows).toContain('→ Second: two')
    expect(editors[1]!.focused).toBe(true)
    expect(events).toEqual([{ kind: 'value-change', controlId: 'first', value: 'late-one' }])
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
    focus.handleInput?.('\x1b[C')
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.('\x1b[D')
    focus.handleInput?.(' ')
    focus.focused = false
    focus.focused = true
    expect(focus.render(80).join('')).not.toContain('Really delete?')
    focus.handleInput?.(' ')
    expect(events).toEqual([])
    focus.handleInput?.(' ')
    expect(events).toEqual([])
    focus.handleInput?.('\r')
    expect(events).toEqual([{ kind: 'activate', controlId: 'delete' }])
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.(' ')
    expect(events.at(-1)).toEqual({ kind: 'activate', controlId: 'keep' })
  })

  it('routes direction keys within the active pattern while Tab crosses groups', () => {
    const { options, events } = fixture()
    const tree = ui.stack.column([
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'disabled', label: 'Disabled', disabled: true }, { id: 'b', label: 'B' }] }),
      ui.list({ id: 'list', selectedIds: [], items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }),
      ui.actions({ id: 'actions', items: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }] }),
    ])
    const focus = compiled(tree, options).focusTarget!
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
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

  it('uses rendered geometry for non-wrapping movement across control groups', () => {
    const f = fixture()
    const grid = compiled(ui.stack.column([
      ui.stack.row([
        ui.actions({ id: 'top-left', items: [{ id: 'a', label: 'A' }] }),
        ui.actions({ id: 'top-right', items: [{ id: 'b', label: 'B' }] }),
      ]),
      ui.stack.row([
        ui.actions({ id: 'bottom-left', items: [{ id: 'c', label: 'C' }] }),
        ui.actions({ id: 'bottom-right', items: [{ id: 'd', label: 'D' }] }),
      ]),
    ]), f.options).focusTarget!
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'a' })
    grid.handleInput?.('\x1b[C')
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'b' })
    grid.handleInput?.('\x1b[B')
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'd' })
    grid.handleInput?.('\x1b[D')
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'c' })
    grid.handleInput?.('\x1b[A')
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'a' })
    grid.handleInput?.('\x1b[A')
    expect(grid.captureFocusIdentity?.()).toMatchObject({ controlId: 'a' })

    const main = compiled(ui.actions({ id: 'vertical', items: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] }), fixture({ screenMode: 'main' }).options).focusTarget!
    main.handleInput?.('\x1b[B')
    main.handleInput?.('\r')
    expect(main.captureFocusIdentity?.()).toMatchObject({ controlId: 'second' })

    const clippedFixture = fixture()
    clippedFixture.viewport.rows = 1
    const clipped = compiled(ui.stack.column([
      ui.actions({ id: 'visible', items: [{ id: 'visible', label: 'Visible' }] }),
      ui.actions({ id: 'clipped', items: [{ id: 'clipped', label: 'Clipped' }] }),
    ]), clippedFixture.options).focusTarget!
    clipped.handleInput?.('\x1b[B')
    expect(clipped.captureFocusIdentity?.()).toMatchObject({ controlId: 'visible' })
    expect(clipped.restoreFocusIdentity?.({ controlId: 'clipped' })).toBe(true)
    clipped.handleInput?.('\x1b[B')
    expect(clipped.captureFocusIdentity?.()).toMatchObject({ controlId: 'clipped' })
  })

  it('pages long lists without wrapping', () => {
    const { options, viewport } = fixture()
    viewport.rows = 4
    const focus = compiled(ui.list({
      id: 'items',
      selectedIds: [],
      items: Array.from({ length: 20 }, (_, index) => ({ id: String(index), label: `Item ${String(index)}` })),
    }), options).focusTarget!
    focus.handleInput?.('\x1b[6~')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ itemId: '3' })
    focus.handleInput?.('\x1b[5~')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ itemId: '0' })
    focus.handleInput?.('\x1b[F')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ itemId: '19' })
    focus.handleInput?.('\x1b[H')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ itemId: '0' })

    const multiple = compiled(ui.list({
      id: 'multiple', mode: 'multiple', selectedIds: [],
      items: Array.from({ length: 12 }, (_, index) => ({ id: String(index), label: `Item ${String(index)}` })),
    }), options).focusTarget!
    multiple.handleInput?.('\x1b[H')
    multiple.handleInput?.('\x1b[6~')
    expect(multiple.captureFocusIdentity?.()).toMatchObject({ itemId: '3' })
  })

  it('climbs nested tabs one layer at a time before dismissing', () => {
    const escaped = vi.fn()
    const result = compiledSurface(ui.stack.column([
      ui.tabs({ id: 'outer', activeId: 'one', items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }),
      ui.tabs({ id: 'inner', activeId: 'alpha', items: [{ id: 'alpha', label: 'Alpha' }, { id: 'beta', label: 'Beta' }] }),
      ui.actions({ id: 'content', items: [{ id: 'run', label: 'Run' }] }),
    ]), fixture({ onUnhandledEscape: escaped }).options)
    const focus = result.focusTarget!
    focus.handleInput?.('\x1b[D')
    focus.handleInput?.('\t')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'outer', itemId: 'one' })
    focus.handleInput?.('\r')
    focus.handleInput?.('\r')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'run', tabControlId: 'inner' })
    focus.handleInput?.('\x1b')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'inner', itemId: 'alpha' })
    focus.handleInput?.('\x1b')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'outer', itemId: 'one' })
    focus.handleInput?.('\x1b')
    expect(escaped).toHaveBeenCalledOnce()

    expect(focus.restoreFocusIdentity?.({ controlId: 'run', tabControlId: 'inner' })).toBe(true)
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'run', tabControlId: 'inner' })
    expect(focus.restoreFocusIdentity?.({ controlId: 'missing' })).toBe(false)
    result.surfaceRuntime.deactivate()
    focus.focused = true
    expect(focus.captureFocusIdentity?.()).toBeUndefined()
    expect(focus.restoreFocusIdentity?.({ controlId: 'run' })).toBe(false)
  })

  it('keeps invalid text and select fields active on Tab', () => {
    const focus = compiled(ui.stack.column([
      ui.form({ id: 'text-form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '', error: 'Required' }] }),
      ui.form({ id: 'select-form', fields: [{ kind: 'select', id: 'mode', label: 'Mode', value: null, error: 'Required', options: [{ id: 'a', label: 'A' }] }] }),
      ui.actions({ id: 'actions', items: [{ id: 'save', label: 'Save' }] }),
    ]), fixture().options).focusTarget!
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'name' })
    focus.handleInput?.('\x1b')
    expect(focus.restoreFocusIdentity?.({ controlId: 'mode' })).toBe(true)
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'mode' })
  })

  it('uses Tab between groups, arrows within groups, and remembers each group item', () => {
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const { options, events } = fixture({ components: localComponents })
    const focus = compiled(ui.stack.column([
      ui.tabs({ id: 'tabs', activeId: 'editor', items: [{ id: 'editor', label: 'Editor' }, { id: 'snapshot', label: 'Snapshot' }] }),
      ui.form({ id: 'profile', fields: [
        { kind: 'input', id: 'name', label: 'Name', value: 'Director' },
        { kind: 'textarea', id: 'notes', label: 'Notes', value: 'Move the cursor' },
        { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
      ] }),
      ui.actions({ id: 'commands', items: [{ id: 'close', label: 'Close' }, { id: 'reset', label: 'Reset', intent: 'primary' }] }),
    ]), options).focusTarget!
    focus.focused = true
    focus.render(80)
    expect(editors.every(editor => editor.focused === false)).toBe(true)

    focus.handleInput?.('\r')
    expect(focus.render(80).join('\n')).toContain('→ Name:')
    focus.handleInput?.('\x1b[B')
    expect(focus.render(80).join('\n')).toContain('→ Notes:')
    focus.handleInput?.('\r')
    focus.render(80)
    expect(editors[1]!.focused).toBe(true)
    focus.handleInput?.('\x1b')
    focus.render(80)
    expect(editors[1]!.focused).toBe(false)

    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[Z')
    focus.handleInput?.('\r')
    expect(events).toEqual([
      { kind: 'value-change', controlId: 'enabled', value: true },
      { kind: 'activate', controlId: 'reset' },
      { kind: 'value-change', controlId: 'enabled', value: false },
    ])

    focus.handleInput?.('\x1b[A')
    focus.handleInput?.('!')
    focus.handleInput?.('\t')
    focus.handleInput?.('\x1b[Z')
    const returned = focus.render(80).join('\n')
    expect(returned).toContain('→ Notes:')
    expect(editors[1]!.focused).toBe(false)
    expect(events.at(-1)).toEqual({ kind: 'value-change', controlId: 'notes', value: 'Move the cursor!' })
  })

  it('keeps group item memory across a persistent-runtime reorder', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const f = fixture()
    const tabs = ui.tabs({ id: 'views', activeId: 'summary', items: [
      { id: 'summary', label: 'Summary' },
      { id: 'details', label: 'Details' },
    ] })
    const form = ui.form({ id: 'profile', fields: [
      { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
      { kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
        { id: 'dark', label: 'Dark' },
        { id: 'light', label: 'Light' },
      ] },
    ] })
    const actions = ui.actions({ id: 'commands', items: [
      { id: 'save', label: 'Save', intent: 'primary' },
      { id: 'cancel', label: 'Cancel' },
    ] })
    const first = compileBlueUiSurfaceNode(ui.stack.column([tabs, form, actions]), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const stale = first.value.focusTarget!
    stale.handleInput?.('\x1b[C')
    stale.handleInput?.('\r')
    expect(stale.restoreFocusIdentity?.({ controlId: 'theme' })).toBe(true)
    stale.handleInput?.('\r')
    stale.handleInput?.('\x1b[C')
    stale.handleInput?.('\r')
    stale.handleInput?.('\t')
    expect(stale.restoreFocusIdentity?.({ controlId: 'cancel' })).toBe(true)
    expect(stale.captureFocusIdentity?.()).toMatchObject({ controlId: 'cancel' })

    const reordered = compileBlueUiSurfaceNode(ui.stack.column([tabs, actions, form]), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(reordered.ok).toBe(true)
    if (!reordered.ok) throw new Error(reordered.message)
    const focus = reordered.value.focusTarget!
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'cancel' })
    focus.handleInput?.('\x1b[Z')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'theme' })
    focus.handleInput?.('\x1b[Z')
    expect(focus.captureFocusIdentity?.()).toMatchObject({ controlId: 'cancel' })
    focus.handleInput?.('\r')
    expect(f.events).toEqual([
      { kind: 'tab-change', controlId: 'views', tabId: 'details' },
      { kind: 'value-change', controlId: 'theme', value: 'light' },
      { kind: 'activate', controlId: 'cancel' },
    ])
    stale.handleInput?.('\r')
    expect(f.events).toHaveLength(3)
  })

  it('forgets removed focus and editing even when the removal generation never renders', () => {
    const runtime = new BlueUiSurfaceRuntime()
    const editors: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        editors.push(editor)
        return editor
      },
    } as BlueComponents
    const f = fixture({ components: localComponents })
    const form = ui.form({ id: 'profile', fields: [
      { kind: 'input', id: 'name', label: 'Name', value: 'Blue' },
      { kind: 'textarea', id: 'notes', label: 'Notes', value: 'N!' },
    ] })
    const actions = ui.actions({ id: 'commands', items: [{ id: 'close', label: 'Close' }] })
    const first = compileBlueUiSurfaceNode(ui.stack.column([form, actions]), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'external',
    })
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.message)
    const firstFocus = first.value.focusTarget!
    firstFocus.focused = true
    first.value.component.render(80)
    firstFocus.handleInput?.('\x1b[B')
    firstFocus.handleInput?.('!')
    expect(editors[1]!.focused).toBe(true)

    const removed = compileBlueUiSurfaceNode(actions, {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(removed.ok).toBe(true)
    if (!removed.ok) throw new Error(removed.message)
    expect(editors[1]!.focused).toBe(false)

    const restored = compileBlueUiSurfaceNode(ui.stack.column([form, actions]), {
      ...f.options,
      surfaceRuntime: runtime,
      refreshMode: 'internal',
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) throw new Error(restored.message)
    const focus = restored.value.focusTarget!
    focus.focused = true
    focus.handleInput?.('\t')
    const rows = restored.value.component.render(80).join('\n')
    expect(rows).toContain('→ Name:')
    expect(rows).not.toContain('→ Notes:')
    expect(editors[1]!.focused).toBe(false)
  })

  it('separates form navigation from text editing and select value changes', () => {
    const editor = createTestEditor()
    editor.handleInput = vi.fn(editor.handleInput)
    const escapes: string[] = []
    const f = fixture({
      resolveTextEditor: () => editor,
      onUnhandledEscape: () => escapes.push('escape'),
    })
    const result = compiled(ui.form({ id: 'profile', fields: [
      { kind: 'input', id: 'name', label: 'Name', value: 'Blue' },
      { kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
        { id: 'dark', label: 'Dark' },
        { id: 'light', label: 'Light' },
      ] },
      { kind: 'toggle', id: 'enabled', label: 'Enabled', value: false },
    ] }), f.options)
    const focus = result.focusTarget!
    focus.focused = true
    focus.render(60)
    expect(editor.focused).toBe(false)

    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\x1b[C')
    expect(result.component.render(60).join('\n')).toContain('→ Theme: Dark')
    focus.handleInput?.('\r')
    expect(result.component.render(60).join('\n')).toContain('→ Theme: ‹ Dark ›')
    focus.handleInput?.('\x1b[C')
    expect(result.component.render(60).join('\n')).toContain('→ Theme: ‹ Light ›')
    focus.handleInput?.('\x1b[A')
    expect(result.component.render(60).join('\n')).toContain('→ Theme: ‹ Light ›')
    focus.handleInput?.('\x1b')
    expect(result.component.render(60).join('\n')).toContain('→ Theme: Dark')
    expect(escapes).toEqual([])
    focus.handleInput?.('\x1b[A')
    expect(result.component.render(60).join('\n')).toContain('→ Name: Blue')
    focus.handleInput?.('\x1b[C')
    expect(editor.handleInput).not.toHaveBeenCalledWith('\x1b[C')

    focus.handleInput?.('\r')
    focus.render(60)
    expect(editor.focused).toBe(true)
    focus.handleInput?.('\x1b')
    focus.render(60)
    expect(editor.focused).toBe(false)
    expect(escapes).toEqual([])
    focus.handleInput?.('\x1b')
    expect(escapes).toEqual(['escape'])

    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.render(60)
    expect(editor.focused).toBe(false)
    expect(result.component.render(60).join('\n')).toContain('→ Name: Blue')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[C')
    focus.handleInput?.('\r')
    expect(f.events).toEqual([
      { kind: 'value-change', controlId: 'name', value: 'Blue' },
      { kind: 'value-change', controlId: 'theme', value: 'light' },
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
    focus.handleInput?.(' ')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\x1b[B')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
    focus.handleInput?.('\t')
    focus.handleInput?.('\r')
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
    tabs.focusTarget!.handleInput?.('\x1b[C')
    const tabRow = tabs.component.render(40).join('')
    expect(tabRow).toContain('‹ Active ›')
    expect(tabRow).toContain(`${CURSOR_MARKER} Focused`)

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

    expect(compileBlueUiSurfaceNode({ kind: 'not-blue' }, {
      ...fixture().options,
      surfaceRuntime: new BlueUiSurfaceRuntime(),
      refreshMode: 'external',
    })).toMatchObject({ ok: false, code: 'BLUE_INVALID_CONTRIBUTION' })
  })
})

describe('compileBlueUiSurfaceNode contextual hints', () => {
  function focusedHint(value: unknown, inputs: readonly string[] = [], overrides: Partial<BlueUiCompilerOptions> = {}, width = 120): string {
    const result = compiledSurface(value, fixture(overrides).options)
    const focus = result.focusTarget!
    focus.focused = true
    for (const input of inputs) focus.handleInput?.(input)
    return focus.render(width).at(-1) ?? ''
  }

  it('keeps hints on focused persistent plugin surfaces only', () => {
    const action = ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] })
    const f = fixture()
    const persistent = compiledSurface(action, f.options)
    expect(persistent.component.render(80)).toHaveLength(1)
    persistent.focusTarget!.focused = true
    expect(persistent.component.render(80).at(-1)).toBe('  Enter run')

    const lane = compiledSurface(ui.surface({ chrome: 'lane', child: action }), fixture().options)
    lane.focusTarget!.focused = true
    expect(lane.component.render(80).at(-1)).toBe('  Enter run')

    const ordinary = compiled(action, f.options)
    ordinary.focusTarget!.focused = true
    expect(ordinary.component.render(80)).toHaveLength(1)
    expect(ordinary.component.render(80).join('')).not.toContain('Enter run')

    const passive = compiledSurface(ui.text('passive'), f.options)
    expect(passive.focusTarget).toBeNull()
    expect(passive.component.render(80)).toEqual(['passive'])

    const editor = createTestEditor()
    editor.setText('draft')
    const shell = compiledEditorShell({ kind: 'editor-control' }, editor).result
    shell.focusTarget.focused = true
    expect(shell.component.render(80).join('\n')).not.toContain('Enter finish')

    expect(compiledStatus(ui.text('status')).component.render(80)).toEqual(['status'])

    const replacement = compileBlueUiSurfaceNode(ui.text('replacement'), {
      ...f.options,
      surfaceRuntime: persistent.surfaceRuntime,
      refreshMode: 'external',
    })
    expect(replacement.ok).toBe(true)
    expect(persistent.component.render(80)).toEqual([])
  })

  it('derives every navigation and activation hint from the active control state', () => {
    expect(focusedHint(ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }), [], { onUnhandledEscape: () => {} }))
      .toBe('  ←→ tabs · Enter open · Esc close')
    expect(focusedHint(ui.list({ id: 'list', selectedIds: [], items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })))
      .toBe('  ↑↓←→ options · Enter choose')
    expect(focusedHint(ui.loader({ message: 'Working', cancelActionId: 'cancel' })))
      .toBe('  Enter cancel')
    expect(focusedHint(ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '' }] })))
      .toBe('  Enter edit')
    expect(focusedHint(ui.form({ id: 'form', fields: [{ kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [{ id: 'dark', label: 'Dark' }] }] })))
      .toBe('  Enter adjust')
    expect(focusedHint(ui.form({ id: 'form', fields: [{ kind: 'toggle', id: 'enabled', label: 'Enabled', value: false }] })))
      .toBe('  Space/Enter toggle')
    expect(focusedHint(ui.form({ id: 'form', fields: [], submitActionId: 'Save' })))
      .toBe('  Enter submit')
    expect(focusedHint(ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] })))
      .toBe('  Enter run')

    const groups = ui.stack.column([
      ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }, { id: 'stop', label: 'Stop' }] }),
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }] }),
    ])
    expect(focusedHint(groups)).toBe('  ↑↓←→ actions · Enter run · Tab/Shift-Tab groups')

    const scrollGroups = ui.stack.column([
      ui.scroll(ui.text('abcdefgh')),
      ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] }),
    ])
    expect(focusedHint(scrollGroups, [], {
      screenMode: 'main', maxLeafRows: 2, leafRowWindowPath: '$.0.scroll', onUnhandledEscape: () => {},
    })).toBe('  ↑↓/PgUp/PgDn scroll · Tab/Shift-Tab groups · Esc back')
  })

  it('keeps tab and multiple-list activation aligned with their hints', () => {
    const f = fixture()
    const result = compiledSurface(ui.stack.column([
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }),
      ui.list({ id: 'list', mode: 'multiple', selectedIds: [], items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }),
    ]), f.options)
    const focus = result.focusTarget!
    focus.focused = true

    expect(focus.render(120).at(-1)).toBe('  ←→ tabs · Enter open')
    focus.handleInput?.(' ')
    expect(f.events).toEqual([])
    focus.handleInput?.('\r')
    expect(f.events).toEqual([])

    expect(focus.render(120).at(-1)).toBe('  ↑↓←→ options · Space / Enter toggle / confirm · Tab/Shift-Tab groups')
    focus.handleInput?.('\r')
    expect(f.events).toEqual([{ kind: 'selection-change', controlId: 'list', value: [] }])
    focus.handleInput?.(' ')
    expect(f.events.at(-1)).toEqual({ kind: 'selection-change', controlId: 'list', value: ['a'] })
  })

  it('switches hints for text editing, select adjustment, and confirmation', () => {
    const input = ui.form({ id: 'form', fields: [{ kind: 'input', id: 'name', label: 'Name', value: '' }] })
    expect(focusedHint(input, ['\r'])).toBe('  Enter finish · Esc leave')
    const editingLayout = compiledSurface(input, fixture().options)
    editingLayout.focusTarget!.focused = true
    editingLayout.focusTarget!.handleInput?.('\r')
    expect(layout(editingLayout.component as Component, 40, 3).lines.join('')).toContain(CURSOR_MARKER)

    const textareaGroups = ui.stack.column([
      ui.form({ id: 'form', fields: [{ kind: 'textarea', id: 'notes', label: 'Notes', value: '' }] }),
      ui.actions({ id: 'commands', items: [{ id: 'save', label: 'Save' }] }),
    ])
    expect(focusedHint(textareaGroups, ['\r']))
      .toBe('  Enter finish · Alt+Enter newline · Esc leave')

    const select = ui.form({ id: 'form', fields: [{ kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
      { id: 'dark', label: 'Dark' },
      { id: 'disabled', label: 'Disabled', disabled: true },
      { id: 'light', label: 'Light' },
    ] }] })
    expect(focusedHint(select, ['\r'])).toBe('  ←→ options · Enter apply · Esc cancel')

    const fixedSelect = ui.form({ id: 'form', fields: [{ kind: 'select', id: 'theme', label: 'Theme', value: 'dark', options: [
      { id: 'dark', label: 'Dark' },
      { id: 'disabled', label: 'Disabled', disabled: true },
    ] }] })
    expect(focusedHint(fixedSelect, ['\r'])).toBe('  Enter apply · Esc cancel')

    const selectGroups = ui.stack.column([
      select,
      ui.actions({ id: 'commands', items: [{ id: 'save', label: 'Save' }] }),
    ])
    expect(focusedHint(selectGroups, ['\r']))
      .toBe('  ←→ options · Enter apply · Esc cancel')

    const confirm = ui.actions({ id: 'commands', items: [{ id: 'delete', label: 'Delete', confirm: 'Delete?' }] })
    expect(focusedHint(confirm, ['\r'])).toBe('  Enter confirm · Esc cancel')
  })

  it('filters unavailable controls and degrades through complete width-safe tokens', () => {
    const f = fixture({ onUnhandledEscape: () => {} })
    const tree = ui.stack.column([
      ui.actions({ id: 'commands', items: [
        { id: 'run', label: 'Run' },
        { id: 'disabled', label: 'Disabled', disabled: true },
        { id: 'busy', label: 'Busy', busy: true },
      ] }),
      ui.child(ui.list({ id: 'hidden', selectedIds: [], items: [{ id: 'item', label: 'Item' }] }), { when: { minWidth: 100 } }),
    ])
    const result = compiledSurface(tree, f.options)
    result.focusTarget!.focused = true
    expect(result.component.render(80).at(-1)).toBe('  Enter run · Esc close')
    f.viewport.columns = 120
    expect(result.component.render(120).at(-1)).toBe('  ↑↓←→ actions · Enter run · Tab/Shift-Tab groups')

    const wideTree = ui.stack.column([
      ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }, { id: 'stop', label: 'Stop' }] }),
      ui.tabs({ id: 'tabs', activeId: 'a', items: [{ id: 'a', label: 'A' }] }),
    ])
    const widths = compiledSurface(wideTree, fixture({ onUnhandledEscape: () => {} }).options)
    widths.focusTarget!.focused = true
    expect(widths.component.render(80).at(-1)).toBe('  ↑↓←→ actions · Enter run · Tab/Shift-Tab groups')
    expect(widths.component.render(40).at(-1)).toBe('  ↑↓←→ · Enter · Tab')
    expect(widths.component.render(18).at(-1)).toBe('  ↑↓←→ · Enter')
    expect(widths.component.render(8).at(-1)).toBe('  Enter')
    expect(widths.component.render(6).join('\n')).not.toContain('Ent')

    const ansiColors = new Proxy({ logoGradient: [identity] }, {
      get: (target, key) => key === 'logoGradient'
        ? target.logoGradient
        : key === 'textMuted' ? (value: string) => `\u001b[2m${value}\u001b[22m` : identity,
    }) as BlueSemanticColors
    const ansi = compiledSurface(wideTree, fixture({ colors: ansiColors, onUnhandledEscape: () => {} }).options)
    ansi.focusTarget!.focused = true
    const ansiHint = ansi.component.render(40).at(-1)!
    expect(ansiHint).toContain('\u001b[2m')
    expect(visibleWidth(ansiHint)).toBeLessThanOrEqual(40)
  })

  it('merges semantic extras by id and contains hint provider and translator failures', () => {
    const action = ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] })
    expect(focusedHint(action, [], {
      contextHints: {
        translate: key => {
          if (key === 'fallback') throw new Error('translator unavailable')
          return `translated:${key}`
        },
        extra: () => [
          { id: '', keys: 'ignored' },
          { id: 'ignored', keys: '' },
          { id: 'activate', keys: 'Ctrl+R', label: 'refresh', compact: 'R', priority: 110 },
          { id: 'activate', keys: 'Ctrl+L', label: 'launch', priority: 105 },
          { id: 'fallback', keys: 'F', label: 'fallback' },
        ],
      },
    })).toBe('  Ctrl+L translated:launch · F fallback')

    expect(focusedHint(action, [], {
      contextHints: { extra: () => { throw new Error('hint provider unavailable') } },
    })).toBe('  Enter run')

    expect(focusedHint(action, [], {
      contextHints: {
        suppressAuto: true,
        extra: () => [
          { id: 'confirm', keys: 'C', label: 'confirm', priority: 90 },
          { id: 'first', keys: 'F', priority: 80 },
          { id: 'second', keys: 'S', priority: 80 },
        ],
      },
    })).toBe('  F · S · C confirm')
  })

  it('supports automatic-hint suppression and focusable controller-only surfaces', () => {
    const action = ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] })
    expect(focusedHint(action, [], {
      contextHints: {
        suppressAuto: true,
        extra: () => [{ id: 'custom', keys: 'R', label: 'run' }],
      },
    })).toBe('  R run')
    const suppressed = compiledSurface(action, fixture({ contextHints: { suppressAuto: true } }).options)
    suppressed.focusTarget!.focused = true
    expect(suppressed.component.render(40)).toHaveLength(1)
    expect(suppressed.component.render(40).join('')).not.toContain('Enter run')

    const official = compiled(ui.text('Details'), fixture({
      contextHints: { enabled: true, focusWithoutControls: true },
      onUnhandledEscape: () => {},
    }).options)
    expect(official.focusTarget).not.toBeNull()
    official.focusTarget!.focused = true
    expect(official.component.render(40)).toEqual(['Details', '  Esc close'])

    const passive = compiledSurface(ui.text('Details'), fixture({
      contextHints: { focusWithoutControls: true },
      onUnhandledEscape: () => {},
    }).options)
    expect(passive.focusTarget).not.toBeNull()
    passive.focusTarget!.focused = true
    expect(passive.component.render(40)).toEqual(['Details', '  Esc close'])
  })

  it('keeps the hint inside overlay chrome in direct and height-bounded layout renders', () => {
    const overlay = compiledSurface(ui.surface({
      chrome: 'overlay',
      title: 'Details',
      padding: 1,
      child: ui.actions({ id: 'commands', items: [{ id: 'run', label: 'Run' }] }),
    }), fixture({ getViewport: () => ({ columns: 20, rows: 4 }), onUnhandledEscape: () => {} }).options)
    overlay.focusTarget!.focused = true

    const direct = overlay.component.render(20).map(stripTerminalSequences)
    expect(direct).toHaveLength(4)
    expect(direct.at(-2)).toMatch(/^│\s+Enter · Esc\s+│$/u)
    expect(direct.at(-1)).toBe('╰──────────────────╯')

    const frame = layout(overlay.component as Component, 20, 4).lines.map(stripTerminalSequences)
    expect(frame).toHaveLength(4)
    expect(frame.at(-2)).toMatch(/^│\s+Enter · Esc\s+│$/u)
    expect(frame.at(-1)).toBe('╰──────────────────╯')
    for (const width of SCAN_WIDTHS) {
      expectLinesFit('context hints direct', overlay.component.render(width), width)
      expectLinesFit('context hints layout', layout(overlay.component as Component, width, 4).lines, width)
    }
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

  it('restores pooled form editor focus after responsive dry runs', () => {
    const shell = {
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'editor-control' } },
        {
          node: ui.form({ id: 'profile', fields: [{ kind: 'input', id: 'name', label: 'Name', value: 'Blue' }] }),
          when: { minWidth: 60 },
        },
      ],
    }
    const pooled: BlueEditor[] = []
    const localComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        pooled.push(editor)
        return editor
      },
    } as BlueComponents
    const current = compiledEditorShell(shell, createTestEditor(), { components: localComponents })
    current.result.focusTarget.focused = true
    current.result.component.render(80)
    current.result.focusTarget.handleInput?.('\t')
    current.result.focusTarget.handleInput?.('\r')
    current.result.component.render(80)
    expect(pooled).toHaveLength(1)
    expect(pooled[0]!.focused).toBe(true)

    current.viewport.columns = 40
    current.result.component.renderChecked(40, { dryRun: true })
    expect(pooled[0]!.focused).toBe(true)
    current.viewport.columns = 80
    current.result.component.renderChecked(80, { dryRun: true })
    expect(pooled[0]!.focused).toBe(true)
    current.result.component.render(80)
    expect(pooled[0]!.focused).toBe(true)

    const emptyRuntime = new BlueUiSurfaceRuntime()
    const restoreEmptyFocus = emptyRuntime.checkpointEditorFocus()
    restoreEmptyFocus()
    restoreEmptyFocus()

    const createdDuringDryRun: BlueEditor[] = []
    const lateComponents = {
      ...components,
      createEditor: () => {
        const editor = createTestEditor()
        createdDuringDryRun.push(editor)
        return editor
      },
    } as BlueComponents
    const late = compiledEditorShell(shell, createTestEditor(), { components: lateComponents })
    late.viewport.columns = 40
    late.result.focusTarget.focused = true
    late.result.component.render(40)
    expect(createdDuringDryRun).toEqual([])
    late.viewport.columns = 80
    late.result.component.renderChecked(80, { dryRun: true })
    expect(createdDuringDryRun).toHaveLength(1)
    expect(createdDuringDryRun[0]!.focused).toBe(false)

    const resolved = createTestEditor()
    resolved.focused = true
    const resolvedLate = compiledEditorShell(shell, createTestEditor(), {
      resolveTextEditor: () => resolved,
    })
    resolvedLate.viewport.columns = 40
    resolvedLate.result.component.render(40)
    resolvedLate.viewport.columns = 80
    resolvedLate.result.component.renderChecked(80, { dryRun: true })
    expect(resolved.focused).toBe(true)

    const shared = createTestEditor()
    shared.focused = true
    const sharedResolver = compiledEditorShell({
      kind: 'stack',
      direction: 'column',
      children: [
        { node: { kind: 'editor-control' } },
        { node: ui.form({ id: 'shared', fields: [
          { kind: 'input', id: 'name', label: 'Name', value: 'Blue' },
          { kind: 'input', id: 'alias', label: 'Alias', value: 'Dsh' },
        ] }) },
      ],
    }, createTestEditor(), { resolveTextEditor: () => shared })
    sharedResolver.result.component.renderChecked(80, { dryRun: true })
    expect(shared.focused).toBe(true)
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
