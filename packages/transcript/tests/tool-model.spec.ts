import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { ToolPresentationModel } from '@dsh-blue/blue-frontend'
import { createToolPresentationModel, toolCallView, toolResultView, BlueModelToolService, ToolModelComponent } from '../src/tool-model.ts'

function screenFixture() {
  const children: BlueComponent[] = []; const renders: number[] = []
  const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index >= 0) children.splice(index, 1) } }, requestRender: () => { renders.push(1) } } as unknown as BlueScreen
  return { screen, children, renders }
}
const tool = (id: string, expanded = true): ToolPresentationModel => ({ kind: 'tool', id, name: id, call: { kind: 'text', text: 'call' }, result: { kind: 'text', text: 'result' }, expanded })

describe('BlueModelToolService', () => {
  it('mounts dynamic tools and renders call/result plain fallback', () => {
    const ctx = new Context(); const fixture = screenFixture(); const service = new BlueModelToolService(ctx); service.attach(fixture.screen); let current = tool('one'); const dispose = service.register(() => current); const component = fixture.children[0] as ToolModelComponent; expect(component.render(10)).toEqual(['result']); component.setExpanded(false); expect(component.render(10)).toEqual(['call']); component.setExpanded(true); expect(component.render(10)).toEqual(['result']); component.setExpanded(false); current = tool('one', false); service.refresh('one'); service.refresh('missing'); expect(fixture.children).toHaveLength(1); expect((fixture.children[0] as ToolModelComponent).render(10)).toEqual(['call']); expect(service.list()).toHaveLength(1); dispose(); dispose(); expect(component.render(10)).toEqual([])
  })
  it('handles absent, duplicate, late attach, collapsed and unload', () => {
    const ctx = new Context(); const service = new BlueModelToolService(ctx); const absent = service.register(() => null); absent(); const late = service.register(tool('late')); expect(service.list()).toHaveLength(1); const fixture = screenFixture(); service.attach(fixture.screen); expect(fixture.children).toHaveLength(1); expect(() => service.register(tool('late'))).toThrow(/already registered/); const hidden = service.register(tool('hidden', false)); hidden(); late(); service.register(tool('active')); expect(fixture.children).toHaveLength(1); service.dispose(); expect(fixture.children).toHaveLength(0)
  })
  it('renders missing views and invalidates safely', () => { const empty = new ToolModelComponent(() => ({ kind: 'tool', id: 'empty', name: 'empty' })); expect(empty.render(10)).toEqual([]); empty.invalidate(); const none = new ToolModelComponent(() => null); expect(none.render(10)).toEqual([]); none.invalidate() })
  it('falls back to the call view when expanded without a result', () => {
    const component = new ToolModelComponent(() => ({
      kind: 'tool', id: 'call-only', name: 'call-only', expanded: true,
      call: { kind: 'text', text: 'pending call' },
    }))
    expect(component.render(20)).toEqual(['pending call'])
  })
  it('bounds both collapsed and expanded presenter output', () => {
    const rows = Array.from({ length: 220 }, (_, index) => `row ${String(index)}`).join('\n')
    const component = new ToolModelComponent(() => ({
      kind: 'tool', id: 'bounded', name: 'bounded',
      call: { kind: 'code', code: rows }, result: { kind: 'code', code: rows },
    }))
    const collapsed = component.render(40)
    expect(collapsed).toHaveLength(12)
    expect(collapsed.at(-1)).toContain('ctrl+o to expand')
    component.setExpanded(true)
    const expanded = component.render(40)
    expect(expanded).toHaveLength(200)
    expect(expanded.at(-1)).toContain('more lines')
  })
  it('renders a statically registered model through the mounted closure', () => { const ctx = new Context(); const fixture = screenFixture(); const service = new BlueModelToolService(ctx, fixture.screen); service.register(tool('static')); expect((fixture.children[0] as ToolModelComponent).render(10)).toEqual(['result']); service.dispose() })
  it('cleans the previous screen when reattached', () => { const first = screenFixture(); const second = screenFixture(); const service = new BlueModelToolService(new Context(), first.screen); service.register(tool('reattach')); service.attach(second.screen); expect(first.children).toHaveLength(0); expect(second.children).toHaveLength(1); service.dispose() })
})

describe('canonical tool presentation builder', () => {
  it('maps generic, terminal, and diff call metadata', () => {
    const generic = toolCallView({ card: 'generic', title: 'Read', rawInput: { path: 'a.ts' }, content: [{ type: 'text', text: 'body' }] })
    expect(generic).toMatchObject({ kind: 'sections', sections: [{ title: 'Read', body: { text: 'body' } }] })
    expect(toolCallView({ card: 'generic', title: 'Raw', rawInput: { path: 'a.ts' } })).toMatchObject({ sections: [{ body: { text: expect.stringContaining('a.ts') } }] })
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic
    expect(toolCallView({ card: 'generic', title: 'Cycle', rawInput: cyclic })).toMatchObject({ sections: [{ body: { text: '[object Object]' } }] })
    expect(toolCallView({ card: 'generic', title: 'Symbol', rawInput: Symbol('x') })).toMatchObject({ sections: [{ body: { text: 'Symbol(x)' } }] })
    expect(toolCallView({ card: 'generic', title: 'String', rawInput: 'literal' })).toMatchObject({ sections: [{ body: { text: 'literal' } }] })
    expect(toolCallView({ card: 'terminal', title: 'pnpm test', description: 'Tests', cwd: '/repo' })).toMatchObject({ kind: 'sections', sections: [{ title: 'Tests' }, { title: 'Command', body: { kind: 'code' } }] })
    expect((toolCallView({ card: 'terminal', title: 'pnpm test', description: 'Tests' }) as { sections: readonly unknown[] }).sections[0]).toMatchObject({ title: 'Tests', body: { text: '' } })
    expect(toolCallView({ card: 'terminal', title: 'pwd' })).toMatchObject({ sections: [{ title: 'Command' }] })
    expect(toolCallView({ card: 'diff', title: 'Write', diffs: [{ path: 'a.ts', oldText: 'old', newText: 'new' }] })).toMatchObject({ sections: [{ title: 'a.ts', body: { kind: 'diff', before: 'old', after: 'new' } }] })
    expect(toolCallView({ card: 'diff', title: 'Write', diffs: [] })).toMatchObject({ sections: [{ title: 'Write', body: { text: '(no changes)' } }] })
  })

  it('maps every official result view and generic fallback', () => {
    const content = [{ type: 'text' as const, text: 'text' }, { type: 'reasoning' as const, text: 'reason' }, { type: 'image' as const, attachment: {} as never }, { type: 'tool-call' as const, id: 'c' as never, name: 'read', arguments: '{}' }, { type: 'tool-result' as const, toolCallId: 'c' as never, content: [], isError: false }, { type: 'future' }] as never
    expect(toolResultView({ card: 'generic', title: 'Done', content }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'Done', body: { text: expect.stringContaining('[future]') } }] })
    expect(toolResultView({ card: 'generic' }, { content: [{ type: 'text', text: 'raw' }], isError: false }, 'tool')).toMatchObject({ sections: [{ title: 'tool', body: { text: 'raw' } }] })
    expect(toolResultView({ card: 'terminal', title: 'Shell', output: 'ok', exitCode: 0 }, undefined, 'tool')).toMatchObject({ sections: [{ body: { code: 'ok' } }, { body: { text: 'exit 0' } }] })
    expect(toolResultView({ card: 'terminal', signal: 'SIGTERM' }, undefined, 'tool')).toMatchObject({ sections: [{ body: { code: '(no output)' } }, { body: { text: 'signal SIGTERM' } }] })
    expect(toolResultView({ card: 'terminal' }, undefined, 'tool')).toMatchObject({ sections: [{}, { body: { text: 'complete' } }] })
    expect(toolResultView({ card: 'diff', diffs: [{ path: 'new.ts', oldText: null, newText: 'new' }] }, undefined, 'tool')).toMatchObject({ sections: [{ body: { before: '', after: 'new' } }] })
    expect(toolResultView({ card: 'search', shape: 'paths', paths: ['a.ts'], truncated: false, total: 1 }, undefined, 'tool')).toMatchObject({ kind: 'list', selectedId: 'path-0' })
    expect(toolResultView({ card: 'search', shape: 'paths', paths: [], truncated: false, total: 0 }, undefined, 'tool')).toMatchObject({ kind: 'list', items: [] })
    expect(toolResultView({ card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 2, line: 'hit' }] }], truncated: false, total: 1 }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'a.ts', body: { code: '2: hit' } }] })
    expect(toolResultView({ card: 'search', shape: 'matches', title: 'Search', files: [], truncated: false, total: 0 }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'Search', body: { text: '(no matches)' } }] })
    expect(toolResultView({ card: 'search', shape: 'matches', files: [], truncated: false, total: 0 }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'tool', body: { text: '(no matches)' } }] })
    expect(toolResultView({ card: 'read', path: 'a.ts', offset: 1, lines: [{ number: 1, text: 'const x = 1' }], totalLines: 1, lang: 'ts' }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'a.ts', body: { language: 'ts' } }] })
    expect(toolResultView({ card: 'read', title: 'Read', path: 'a', offset: 1, lines: [], totalLines: 0 }, undefined, 'tool')).toMatchObject({ sections: [{ title: 'Read', body: { code: '' } }] })
    expect(toolResultView({ card: 'web', kind: 'fetch', url: 'https://example.com', statusCode: 200, truncated: true }, undefined, 'tool')).toMatchObject({ fields: [{ value: 'https://example.com' }, { value: '200' }, { value: 'yes' }] })
    expect(toolResultView({ card: 'web', kind: 'fetch', url: 'x', statusCode: 204, truncated: false }, undefined, 'tool')).toMatchObject({ fields: [{}, {}, { value: 'no' }] })
    expect(toolResultView({ card: 'web', kind: 'search', sources: [{ url: 'u', title: 'Title', snippet: 'Snippet' }, { url: 'v' }], truncated: false }, undefined, 'tool')).toMatchObject({ items: [{ label: 'Title', detail: 'Snippet' }, { label: 'v', detail: 'v' }] })
    expect(toolResultView(undefined, { content: [], isError: false }, 'tool')).toEqual({ kind: 'text', text: '(no output)' })
    expect(toolResultView(undefined, { content: [{ type: 'text', text: 'failed' }], isError: true }, 'tool')).toEqual({ kind: 'text', text: 'failed', tone: 'danger' })
  })

  it('summarizes XML-envelope fallbacks and formats inlined tool-call arguments', () => {
    const envelope = '<path>src/a.ts</path>\n<type>file</type>\n<content>\n1: x\n\n(Showing lines 1-1 of 9. Use offset=2 to continue.)\n</content>'
    expect(toolResultView(undefined, { content: [{ type: 'text', text: envelope }], isError: false }, 'read'))
      .toEqual({ kind: 'text', text: 'src/a.ts · lines 1-1 of 9' })
    expect(toolResultView(undefined, { content: [{ type: 'text', text: envelope }], isError: true }, 'read'))
      .toEqual({ kind: 'text', text: 'src/a.ts · lines 1-1 of 9', tone: 'danger' })
    const blocks = [{ type: 'tool-call' as const, id: 'c' as never, name: 'read', arguments: '{"file_path":"a.ts","limit":5}' }, { type: 'text' as const, text: 'tail' }] as never
    expect(toolResultView({ card: 'generic', title: 'Nested', content: blocks }, undefined, 'tool'))
      .toMatchObject({ sections: [{ title: 'Nested', body: { text: 'read\n  file_path: a.ts\n  limit: 5\ntail' } }] })
  })

  it('creates a deeply frozen model with structured toggle action', () => {
    const model = createToolPresentationModel({ id: 'c1', name: 'read', call: { card: 'generic', title: 'Read' }, result: { card: 'read', path: 'a', offset: 1, lines: [], totalLines: 0 }, outcome: { content: [], isError: false }, expanded: false })
    expect(model).toMatchObject({ id: 'c1', expanded: false, action: { kind: 'tool.toggle', id: 'c1' } }); expect(Object.isFrozen(model)).toBe(true); expect(Object.isFrozen(model.call)).toBe(true)
    const plain = createToolPresentationModel({ id: 'c2', name: 'unknown' }); expect(plain.call).toEqual({ kind: 'text', text: 'unknown' }); expect(plain.result).toBeUndefined()
  })
})
