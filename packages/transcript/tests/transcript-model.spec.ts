import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen, BlueSemanticColors } from '@dsh-blue/blue-core'
import type { TranscriptEntryModel, TranscriptModel } from '@dsh-blue/blue-frontend'
import { appendTranscriptView, createTranscriptModel, TRANSCRIPT_MODEL_WINDOW, TranscriptModelComponent, TranscriptModelService, type TranscriptModelRenderer } from '../src/transcript-model.ts'
import { DEFAULT_TRANSCRIPT_PRESENTATION, TranscriptPresentationPolicy } from '../src/presentation-policy.ts'
import { setThinkingTimers } from '../src/thinking.ts'
import { fakeBlueComponents } from './helpers.ts'
import { COLORS } from './status-fakes.ts'

function fixture() { const children: BlueComponent[] = []; const screen = { addChild: (component: BlueComponent) => { children.push(component); return () => { const index = children.indexOf(component); if (index >= 0) children.splice(index, 1) } }, contentChanged: () => false, requestRender: () => {} } as unknown as BlueScreen; return { screen, children } }
const model = (id: string, entries = [{ kind: 'text' as const, text: 'entry' }]): TranscriptModel => ({ kind: 'transcript', id, entries })

const semanticEntries = (): TranscriptEntryModel[] => [
  {
    kind: 'transcript-user', id: 'user', seq: 1, turn: 1, text: 'user text', images: [
      { attachmentId: 'image-1', mediaType: 'image/png', bytes: 12, width: 4, height: 3 },
      { attachmentId: 'image-2', mediaType: 'image/jpeg', bytes: 20, width: 8, height: 6, name: 'plot.jpg', originalDimensions: { width: 16, height: 12 } },
    ],
  },
  { kind: 'transcript-assistant', id: 'assistant', seq: 2, turn: 1, step: 0, text: 'assistant text', streaming: false },
  { kind: 'transcript-thinking', id: 'thinking', seq: 3, turn: 1, step: 0, text: 'thinking text', streaming: false },
  {
    kind: 'transcript-tool', id: 'tool-result', seq: 4, turn: 1, step: 0, callId: 'call-1', name: 'read', arguments: '{}', startedAt: 100,
    result: { text: 'result summary', fullText: 'result full', isError: false, endedAt: 120 },
  },
  {
    kind: 'transcript-tool', id: 'tool-text', seq: 5, turn: 1, step: 0, callId: 'call-2', name: 'bash', arguments: '{"command":"pwd"}', startedAt: 130,
    result: { text: 'text only', isError: false, endedAt: 140 },
  },
  { kind: 'transcript-tool', id: 'tool-pending', seq: 6, turn: 1, step: 0, callId: 'call-3', name: 'custom', arguments: '{bad', startedAt: 150 },
  {
    kind: 'transcript-tool', id: 'tool-presented', seq: 7, turn: 1, step: 0, callId: 'call-4', name: 'read', arguments: '{}', startedAt: 160,
    presentation: { kind: 'tool', id: 'presentation', name: 'read', call: { kind: 'text', text: 'call view' }, result: { kind: 'text', text: 'result view' } },
  },
  { kind: 'transcript-error', id: 'error-code', seq: 8, turn: 1, message: 'down', code: 'HTTP_404' },
  { kind: 'transcript-error', id: 'error', seq: 9, turn: 1, message: 'unknown' },
  { kind: 'transcript-interrupted', id: 'interrupted', seq: 10, turn: 1 },
]

function renderer(
  requestRender = () => {},
  presentation?: TranscriptPresentationPolicy,
): TranscriptModelRenderer {
  return {
    colors: COLORS as BlueSemanticColors,
    components: fakeBlueComponents(),
    images: () => ({}),
    requestRender,
    ...(presentation === undefined ? {} : { presentation }),
  }
}

afterEach(() => {
  setThinkingTimers(undefined)
})

describe('TranscriptModelService', () => {
  it('mounts dynamic entries and refreshes plain rows', () => { const ctx = new Context(); const f = fixture(); const service = new TranscriptModelService(ctx, f.screen); let current = model('one'); const dispose = service.register(() => current); const component = f.children[0] as TranscriptModelComponent; expect(component.render(20)).toEqual(['entry']); current = model('one', [{ kind: 'fields', fields: [{ label: 'a', value: 'b' }] }]); service.refresh('one'); expect((f.children[0] as TranscriptModelComponent).render(20)).toEqual(['a: b']); expect(service.list()).toHaveLength(1); service.refresh('missing'); dispose(); dispose(); expect(component.render(20)).toEqual([]); service.refresh('one') })
  it('handles absent, duplicate, late attach and unload', () => { const ctx = new Context(); const service = new TranscriptModelService(ctx); const absent = service.register(() => null); expect(absent).toBeTypeOf('function'); absent(); const late = service.register(model('late')); expect(service.list()).toHaveLength(1); const f = fixture(); service.attach(f.screen); expect(f.children).toHaveLength(1); expect(() => service.register(model('late'))).toThrow(/already registered/); late(); service.register(model('active')); expect(f.children).toHaveLength(1); service.dispose(); expect(f.children).toHaveLength(0) })
  it('renders null and nested view shapes safely', () => { expect(new TranscriptModelComponent(() => null).render(10)).toEqual([]); const c = new TranscriptModelComponent(() => model('nested', [{ kind: 'sections', sections: [{ title: 's', body: { kind: 'code', code: 'abcdef' } }] }])); expect(c.render(3)).toEqual(['s', 'abc', 'def']); c.invalidate() })
  it('renders a statically registered model and disposes its mounted child', () => { const f = fixture(); const service = new TranscriptModelService(new Context(), f.screen); service.register(model('static')); expect((f.children[0] as TranscriptModelComponent).render(20)).toEqual(['entry']); service.dispose(); expect(f.children).toHaveLength(0) })
  it('bounds the rendered entry window and cleans up on reattach', () => { const entries = Array.from({ length: TRANSCRIPT_MODEL_WINDOW + 3 }, (_, index) => ({ kind: 'text' as const, text: String(index) })); const component = new TranscriptModelComponent(() => model('bounded', entries)); const rows = component.render(20); expect(rows).toHaveLength(TRANSCRIPT_MODEL_WINDOW); expect(rows[0]).toBe('3'); const first = fixture(); const second = fixture(); const service = new TranscriptModelService(new Context(), first.screen); service.register(model('reattach')); service.attach(second.screen); expect(first.children).toHaveLength(0); expect(second.children).toHaveLength(1); service.dispose() })
  it('builds immutable replay/live fixtures without folding session events', () => { const replay = createTranscriptModel('session', [{ kind: 'text', text: 'user' }, { kind: 'code', code: 'assistant' }]); expect(replay.streaming).toBeUndefined(); expect(Object.isFrozen(replay.entries)).toBe(true); const live = appendTranscriptView(replay, { kind: 'text', text: 'stream' }, true); expect(live.streaming).toBe(true); expect(live.entries).toHaveLength(3); const settled = appendTranscriptView(live, { kind: 'text', text: 'done' }, false); expect(settled.streaming).toBe(false); expect(replay.entries).toHaveLength(2) })

  it('renders every semantic entry through the plain capability fallback', () => {
    const component = new TranscriptModelComponent(() => model('plain', semanticEntries()))
    component.setExpanded(true)
    const rows = component.render(80)
    expect(rows).toEqual(expect.arrayContaining([
      'user text',
      'assistant text',
      'thinking text',
      'result full',
      'text only',
      'custom({bad)',
      'read',
      'down (HTTP_404)',
      'unknown',
      'Interrupted',
    ]))
    component.setExpanded(true)
    component.invalidate()
    component.dispose()
  })

  it('summarizes envelope results and pending arguments in the plain fallback', () => {
    const envelope = '<path>src/a.ts</path>\n<type>file</type>\n<content>\n1: x\n\n(Showing lines 1-1 of 9. Use offset=2 to continue.)\n</content>'
    const entries: TranscriptEntryModel[] = [
      {
        kind: 'transcript-tool', id: 'enveloped', seq: 1, turn: 1, step: 0, callId: 'c1', name: 'read', arguments: '{}', startedAt: 1,
        result: { text: envelope, isError: false, endedAt: 2 },
      },
      { kind: 'transcript-tool', id: 'argish', seq: 2, turn: 1, step: 0, callId: 'c2', name: 'write', arguments: '{"file_path":"a.ts"}', startedAt: 3 },
    ]
    const rows = new TranscriptModelComponent(() => model('plain', entries)).render(80)
    expect(rows).toContain('src/a.ts · lines 1-1 of 9')
    expect(rows).toContain('write')
    expect(rows).toContain('  file_path: a.ts')
  })

  it('renders read groups through the tree component with tools-category expansion', () => {
    const groupEntry: TranscriptEntryModel = {
      kind: 'transcript-read-group', id: 'read-group:r1', seq: 4, turn: 1, step: 0,
      reads: [
        { callId: 'r1', seq: 4, turn: 1, step: 0, path: 'src/a.ts', range: { first: 1, last: 3 }, totalLines: 9, state: 'ok', previewLines: [{ number: 1, text: 'first line' }] },
        { callId: 'r2', seq: 5, turn: 1, step: 0, path: 'src/a.ts', requestedRange: { first: 4, last: 6 }, state: 'pending' },
        { callId: 'r3', seq: 6, turn: 1, step: 0, path: 'gone.ts', state: 'error', error: 'file not found' },
      ],
    }
    const collapsedRows = new TranscriptModelComponent(() => model('reads', [groupEntry]), renderer()).render(80)
    expect(collapsedRows.join('\n')).toContain('Reading 2 files')
    expect(collapsedRows.join('\n')).toContain('├─ src/a.ts')
    expect(collapsedRows.join('\n')).toContain('└─ gone.ts')
    expect(collapsedRows.join('\n')).not.toContain('first line')

    const expanded = new TranscriptModelComponent(() => model('reads', [groupEntry]), renderer())
    expanded.setExpanded(true)
    const expandedText = expanded.render(80).join('\n')
    expect(expandedText).toContain('first line')
    expect(expandedText).toContain('1  first line')

    const plain = new TranscriptModelComponent(() => model('reads', [groupEntry])).render(80).join('\n')
    expect(plain).toContain('Read 3 calls: src/a.ts, gone.ts')
    const plainSingle = new TranscriptModelComponent(() => model('reads', [{
      kind: 'transcript-read-group', id: 'read-group:solo', seq: 1, turn: 1, step: 0,
      reads: [{ callId: 'solo', seq: 1, turn: 1, step: 0, path: 'solo.ts', state: 'ok' }],
    }])).render(80).join('\n')
    expect(plainSingle).toContain('Read 1 call: solo.ts')
    const plainPathless = new TranscriptModelComponent(() => model('reads', [{
      kind: 'transcript-read-group', id: 'read-group:none', seq: 1, turn: 1, step: 0,
      reads: [{ callId: 'none', seq: 1, turn: 1, step: 0, state: 'ok' }],
    }])).render(80).join('\n')
    expect(plainPathless).toContain('Read 1 call')
    expect(plainPathless).not.toContain(':')
  })

  it('reconciles semantic renderer components, forwards expansion, and disposes retired entries', () => {
    let current = model('semantic', semanticEntries())
    const requestRender = vi.fn()
    const component = new TranscriptModelComponent(() => current, renderer(requestRender))
    component.setExpanded(true)
    const first = component.render(80)
    expect(first.some(row => row.includes('user text'))).toBe(true)
    expect(first.some(row => row.includes('assistant text'))).toBe(true)
    expect(first.some(row => row.includes('thinking text'))).toBe(true)
    expect(first.some(row => row.includes('result full'))).toBe(true)
    expect(first.some(row => row.includes('result view'))).toBe(true)
    expect(first.some(row => row.includes('Used') && row.includes('read'))).toBe(true)
    expect(first.some(row => row.includes('Ran a command'))).toBe(true)
    expect(first.some(row => row.includes('request failed'))).toBe(true)
    expect(first.some(row => row.includes('interrupted'))).toBe(true)

    expect(component.render(80)).toBe(first)
    component.setExpanded(false)
    expect(component.render(80)).not.toBe(first)
    component.invalidate()
    const entries = semanticEntries()
    entries[1] = { kind: 'transcript-assistant', id: 'assistant', seq: 2, turn: 1, step: 0, text: 'changed answer', streaming: false }
    current = model('semantic', [entries[1]!, entries[2]!, { kind: 'text', text: 'plain tail' }])
    const changed = component.render(80)
    expect(changed.some(row => row.includes('changed answer'))).toBe(true)
    expect(changed.some(row => row.includes('plain tail'))).toBe(true)
    component.dispose()
    expect(component.render(80)).toEqual(changed)
    current = null as never
    expect(component.render(80)).toEqual([])
  })

  it('reuses aggregate rows for one streaming model identity and rerenders a replacement', () => {
    let current = createTranscriptModel('streaming', semanticEntries(), true)
    const component = new TranscriptModelComponent(() => current, renderer())
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    current = appendTranscriptView(current, { kind: 'text', text: 'fresh stream data' }, true)
    const next = component.render(80)
    expect(next).not.toBe(first)
    expect(next.at(-1)).toContain('fresh stream data')
    component.dispose()
  })

  it('invalidates streaming aggregate rows when a thinking spinner advances', () => {
    let tick: (() => void) | undefined
    setThinkingTimers({
      setInterval: (callback) => {
        tick = callback
        return 1 as unknown as ReturnType<typeof setInterval>
      },
      clearInterval: () => {},
    })
    const requestRender = vi.fn()
    const current = createTranscriptModel('thinking-stream', [{
      kind: 'transcript-thinking', id: 'thinking-stream', seq: 1, turn: 1, step: 0, text: 'live', streaming: true,
    }], true)
    const component = new TranscriptModelComponent(() => current, renderer(requestRender))
    const first = component.render(80)

    tick?.()
    const next = component.render(80)
    expect(requestRender).toHaveBeenCalledOnce()
    expect(next).not.toBe(first)
    expect(next.join('\n')).toContain('⠙')
    component.dispose()
  })

  it('applies tree-local turn windows and recent Ctrl-O expansion', () => {
    const policy = new TranscriptPresentationPolicy()
    policy.apply({ windowTurns: 2, expandTurns: 1 })
    const entries: TranscriptEntryModel[] = [
      { kind: 'transcript-assistant', id: 'old', seq: 1, turn: 1, step: 0, text: 'old answer', streaming: false },
      { kind: 'transcript-thinking', id: 'middle', seq: 2, turn: 2, step: 0, text: 'middle one\nmiddle two\nmiddle three\nmiddle four', streaming: false },
      { kind: 'transcript-thinking', id: 'new', seq: 3, turn: 3, step: 0, text: 'new one\nnew two\nnew three\nnew four', streaming: false },
    ]
    const scoped = new TranscriptModelComponent(() => model('scoped', entries), renderer(() => {}, policy))
    scoped.setExpanded(true)
    const scopedText = scoped.render(80).join('\n')

    expect(scopedText).not.toContain('old answer')
    expect(scopedText).not.toContain('middle four')
    expect(scopedText).toContain('new four')
    expect(scopedText).toContain('ctrl+o to expand')

    const otherTree = new TranscriptModelComponent(() => model('default', entries), renderer())
    otherTree.setExpanded(true)
    const otherText = otherTree.render(80).join('\n')
    expect(otherText).toContain('old answer')
    expect(otherText).toContain('middle four')
  })

  it('reports model presence and tail-follow state across attach, refresh, unregister, and dispose', () => {
    const ctx = new Context()
    const changed: boolean[] = []
    ctx.on('blue/transcript-content-changed', paused => changed.push(paused))
    const presence: boolean[] = []
    const service = new TranscriptModelService(ctx, undefined, { onPresenceChanged: present => presence.push(present) })
    expect(service.hasModels()).toBe(false)
    service.refresh('missing')
    const first = service.register(model('first'))
    const second = service.register(model('second'))
    expect(service.hasModels()).toBe(true)
    service.refresh('first')
    const f = fixture()
    let paused = true
    f.screen.contentChanged = () => paused
    service.attach(f.screen)
    service.setExpanded(true)
    service.refresh('first')
    paused = false
    service.refresh('second')
    expect(changed).toEqual([true, false])
    first()
    expect(presence).toEqual([true])
    second()
    expect(presence).toEqual([true, false])
    service.dispose()

    const active = new TranscriptModelService(new Context(), f.screen, { onPresenceChanged: present => presence.push(present) })
    active.register(model('active'))
    active.dispose()
    expect(presence.slice(-2)).toEqual([true, false])
  })

  it('reports the shipped presentation policy without a renderer', () => {
    const service = new TranscriptModelService(new Context())
    expect(service.presentationPolicy()).toEqual(DEFAULT_TRANSCRIPT_PRESENTATION)
  })
})
