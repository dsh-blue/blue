import { describe, expect, it, vi } from 'vitest'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { ConversationProjection, ConversationToolEntry } from '@dsh-blue/blue-conversation'
import {
  apply,
  conversationTranscriptModel,
  inject,
  name,
  OfficialConversationModelSource,
  type ConversationProjectionSource,
} from '../src/official-model.ts'
import type { ToolPresentationSource } from '../src/present.ts'

function projection(entries: ConversationProjection['entries'] = [], streaming = false): ConversationProjection {
  return { entries, streaming }
}

function toolSource(options: { readonly throws?: boolean } = {}): ToolPresentationSource {
  return {
    get(name: string) {
      if (options.throws) throw new Error('registry down')
      if (name !== 'read') return undefined
      return {
        presentCall: (args: unknown) => ({ card: 'generic', title: 'Reading', rawInput: args }),
        presentResult: (_args: unknown, result: { readonly isError: boolean }) => ({
          card: 'generic',
          title: result.isError ? 'Failed' : 'Read',
          content: [{ type: 'text', text: 'presented' }],
        }),
      } as never
    },
  } as Pick<ToolRuntime, 'get'>
}

function transcriptTool(overrides: Partial<ConversationToolEntry> = {}): ConversationToolEntry {
  return {
    kind: 'tool',
    id: 'tool-1',
    seq: 4,
    turn: 1,
    step: 0,
    callId: 'call-1',
    name: 'read',
    arguments: '{"path":"a.txt"}',
    startedAt: 100,
    channel: 'transcript',
    ...overrides,
  }
}

/** A presenter vocabulary that declares reads: `kind: 'read'` calls and read result cards from meta. */
function readSource(): ToolPresentationSource {
  return {
    get(name: string) {
      if (name !== 'read') return undefined
      return {
        presentCall: () => ({ card: 'generic', title: 'Read a.txt', kind: 'read' }),
        presentResult: (_args: unknown, result: { readonly isError: boolean; readonly meta?: unknown }) => {
          if (result.isError) return undefined
          const meta = result.meta as { readonly path: string; readonly offset: number; readonly lines: readonly { readonly number: number; readonly text: string }[]; readonly totalLines: number } | undefined
          if (meta === undefined) return undefined
          return { card: 'read', path: meta.path, offset: meta.offset, lines: meta.lines, totalLines: meta.totalLines }
        },
      } as never
    },
  } as Pick<ToolRuntime, 'get'>
}

interface ReadMeta { readonly path: string; readonly offset: number; readonly lines: readonly { readonly number: number; readonly text: string }[]; readonly totalLines: number }

function readResult(meta: ReadMeta | undefined, isError = false): ConversationToolEntry['result'] {
  return {
    content: [{ type: 'text', text: isError ? 'File not found: nope.txt' : 'raw' }],
    text: isError ? 'File not found: nope.txt' : 'raw',
    isError,
    endedAt: 180,
    ...(meta === undefined ? {} : { meta }),
  }
}

function sourceFixture(initial: ConversationProjection | unknown = projection(), initialSeq = 0) {
  let snapshotValue = initial
  let snapshotSeq = initialSeq
  let changed: ((key: string, value: unknown, seq: number) => void) | undefined
  const off = vi.fn()
  const source: ConversationProjectionSource = {
    current: vi.fn(() => ({ asOfSeq: snapshotSeq, value: snapshotValue })),
    subscribe: vi.fn(listener => {
      changed = listener
      return off
    }),
  }
  return {
    source,
    off,
    set(value: unknown, seq: number) {
      snapshotValue = value
      snapshotSeq = seq
    },
    emit(key: string, value: unknown, seq: number) {
      changed?.(key, value, seq)
    },
  }
}

describe('official conversation model mapping', () => {
  it('bounds conversion before freezing a long projection', () => {
    const entries = Array.from({ length: 203 }, (_, index) => ({
      kind: 'assistant' as const,
      id: `assistant-${String(index)}`,
      seq: index,
      turn: index,
      step: 0,
      text: `answer ${String(index)}`,
      streaming: false,
    }))
    const model = conversationTranscriptModel(projection(entries), toolSource())
    expect(model.entries).toHaveLength(200)
    expect(model.entries[0]).toMatchObject({ id: 'assistant-3' })
  })

  it('maps every semantic entry and filters tool-owned dock channels', () => {
    const model = conversationTranscriptModel(projection([
      {
        kind: 'user', id: 'user-1', seq: 1, turn: 1, text: 'hello', images: [{
          attachmentId: 'image-1', mediaType: 'image/png', bytes: 12, width: 4, height: 3,
          name: 'plot.png', originalDimensions: { width: 8, height: 6 },
        }, {
          attachmentId: 'image-2', mediaType: 'image/jpeg', bytes: 8, width: 2, height: 2,
        }],
      },
      { kind: 'assistant', id: 'assistant-1', seq: 2, turn: 1, step: 0, text: 'answer', streaming: true },
      { kind: 'thinking', id: 'thinking-1', seq: 3, turn: 1, step: 0, text: 'thought', streaming: false },
      transcriptTool({
        result: {
          content: [{ type: 'text', text: 'raw' }],
          text: 'raw',
          isError: false,
          endedAt: 180,
          meta: { path: 'a.txt' },
        },
      }),
      transcriptTool({ id: 'todo-1', callId: 'todo-1', channel: 'todo' }),
      transcriptTool({ id: 'agent-1', callId: 'agent-1', channel: 'agents' }),
      { kind: 'error', id: 'error-1', seq: 7, turn: 1, message: 'down', code: 'HTTP_404' },
      { kind: 'error', id: 'error-2', seq: 8, turn: 1, message: 'unknown' },
      { kind: 'interrupted', id: 'cut-1', seq: 9, turn: 1 },
    ], true), toolSource())

    expect(model.streaming).toBe(true)
    expect(model.entries).toHaveLength(7)
    expect(model.entries).toMatchObject([
      { kind: 'transcript-user', text: 'hello', images: [
        { name: 'plot.png', originalDimensions: { width: 8, height: 6 } },
        { attachmentId: 'image-2', mediaType: 'image/jpeg' },
      ] },
      { kind: 'transcript-assistant', text: 'answer', streaming: true },
      { kind: 'transcript-thinking', text: 'thought', streaming: false },
      {
        kind: 'transcript-tool',
        result: { text: 'raw', fullText: 'raw', isError: false, endedAt: 180 },
        presentation: { kind: 'tool', call: { kind: 'sections' }, result: { kind: 'sections' } },
      },
      { kind: 'transcript-error', message: 'down', code: 'HTTP_404' },
      { kind: 'transcript-error', message: 'unknown' },
      { kind: 'transcript-interrupted' },
    ])
    expect(Object.isFrozen(model)).toBe(true)
  })

  it('falls back safely when arguments, registry, or presenters are absent', () => {
    const pending = conversationTranscriptModel(projection([
      transcriptTool({ arguments: '{bad', name: 'missing' }),
    ]), toolSource({ throws: true }))
    expect(pending.entries[0]).toMatchObject({
      kind: 'transcript-tool',
    })
    expect((pending.entries[0] as { presentation?: unknown }).presentation).toBeUndefined()

    const failed = conversationTranscriptModel(projection([
      transcriptTool({
        result: { content: [{ type: 'text', text: 'failure' }], text: 'failure', isError: true, endedAt: 200 },
      }),
    ]), toolSource())
    expect(failed.entries[0]).toMatchObject({
      presentation: { result: { kind: 'text', text: 'failure', tone: 'danger' } },
    })

    const resultOnly = conversationTranscriptModel(projection([
      transcriptTool({
        result: { content: [{ type: 'text', text: 'done' }], text: 'done', isError: false, endedAt: 210 },
      }),
    ]), {
      get: () => ({
        presentResult: () => ({ card: 'generic', title: 'Result only' }),
      } as never),
    } as ToolPresentationSource)
    expect(resultOnly.entries[0]).toMatchObject({
      presentation: { call: { kind: 'text', text: 'read' }, result: { kind: 'sections' } },
    })
  })

  it('groups consecutive reads, transparently across thinking, into one entry per run', () => {
    const window = (path: string, offset: number, count: number, total: number): ReadMeta => ({
      path,
      offset,
      lines: Array.from({ length: count }, (_, index) => ({ number: offset + index, text: `${path} line ${String(offset + index)}` })),
      totalLines: total,
    })
    const model = conversationTranscriptModel(projection([
      { kind: 'assistant', id: 'assistant-1', seq: 1, turn: 1, step: 0, text: 'looking', streaming: false },
      transcriptTool({ id: 'r1', callId: 'c-r1', seq: 2, arguments: '{"file_path":"src/a.ts","offset":1,"limit":100}', result: readResult(window('src/a.ts', 1, 100, 342)) }),
      { kind: 'thinking', id: 'thinking-1', seq: 3, turn: 1, step: 1, text: 'considering', streaming: false },
      transcriptTool({ id: 'r2', callId: 'c-r2', seq: 4, arguments: '{"file_path":"src/a.ts","offset":101,"limit":120}', result: readResult(window('src/a.ts', 101, 120, 342)) }),
      transcriptTool({ id: 'r3', callId: 'c-r3', seq: 5, arguments: '{"file_path":"missing.txt"}', result: readResult(undefined, true) }),
    ]), readSource())

    expect(model.entries).toHaveLength(3)
    expect(model.entries[0]).toMatchObject({ kind: 'transcript-assistant', text: 'looking' })
    expect(model.entries[1]).toMatchObject({ kind: 'transcript-thinking', text: 'considering' })
    const group = model.entries[2] as { kind: string; id: string; reads: unknown[] }
    expect(group).toMatchObject({ kind: 'transcript-read-group', id: 'read-group:r1', seq: 2, turn: 1, step: 0 })
    expect(group.reads).toHaveLength(3)
    expect(Object.isFrozen(group)).toBe(true)
  })

  it('breaks runs on content, other tools, other turns, and invisible channels keep runs intact', () => {
    const reads = (): ConversationProjection['entries'] => [
      transcriptTool({ id: 'r1', callId: 'c1', seq: 1 }),
      transcriptTool({ id: 'r2', callId: 'c2', seq: 2 }),
    ]
    const kinds = conversationTranscriptModel(projection([
      transcriptTool({ id: 'r1', callId: 'c1', seq: 1 }),
      { kind: 'user', id: 'u1', seq: 2, turn: 2, text: 'more', images: [] },
      transcriptTool({ id: 'r2', callId: 'c2', seq: 3, turn: 2 }),
    ]), readSource())
    expect(kinds.entries.map(entry => entry.kind)).toEqual(['transcript-read-group', 'transcript-user', 'transcript-read-group'])

    const crossTool = conversationTranscriptModel(projection([
      transcriptTool({ id: 'r1', callId: 'c1', seq: 1 }),
      transcriptTool({ id: 'b1', callId: 'c9', seq: 2, name: 'bash', arguments: '{"command":"ls"}' }),
      transcriptTool({ id: 'r2', callId: 'c2', seq: 3 }),
    ]), readSource())
    expect(crossTool.entries.map(entry => entry.kind)).toEqual(['transcript-read-group', 'transcript-tool', 'transcript-read-group'])

    const crossTurn = conversationTranscriptModel(projection(reads().map((entry, index) => (
      index === 0 ? entry : { ...entry, turn: 2 }
    ))), readSource())
    expect(crossTurn.entries.map(entry => entry.kind)).toEqual(['transcript-read-group', 'transcript-read-group'])

    const invisible = conversationTranscriptModel(projection([
      transcriptTool({ id: 'r1', callId: 'c1', seq: 1 }),
      transcriptTool({ id: 'todo-1', callId: 't1', seq: 2, channel: 'todo' }),
      transcriptTool({ id: 'agent-1', callId: 'a1', seq: 3, channel: 'agents' }),
      transcriptTool({ id: 'r2', callId: 'c2', seq: 4 }),
    ]), readSource())
    expect(invisible.entries.map(entry => entry.kind)).toEqual(['transcript-read-group'])

    const single = conversationTranscriptModel(projection([transcriptTool({ id: 'r9', callId: 'c9', seq: 9 })]), readSource())
    expect(single.entries).toHaveLength(1)
    expect(single.entries[0]).toMatchObject({ kind: 'transcript-read-group' })

    // A presenter that never claims read keeps the plain tool card (the
    // legacy-fixture contract: no vocabulary, no grouping).
    const legacy = conversationTranscriptModel(projection(reads()), toolSource())
    expect(legacy.entries.map(entry => entry.kind)).toEqual(['transcript-tool', 'transcript-tool'])
  })

  it('derives read facts from arguments and result views, bounding previews', () => {
    const lines = Array.from({ length: 8 }, (_, index) => ({ number: 101 + index, text: `l${String(index)}` }))
    const model = conversationTranscriptModel(projection([
      transcriptTool({
        id: 'rich', callId: 'c-rich', seq: 2, arguments: '{"file_path":"big.ts","offset":101,"limit":8}',
        result: readResult({ path: 'big.ts', offset: 101, lines, totalLines: 400 }),
      }),
      transcriptTool({
        id: 'pending', callId: 'c-pending', seq: 3, arguments: '{"file_path":"next.ts","offset":5,"limit":30}',
      }),
      transcriptTool({
        id: 'metaless', callId: 'c-metaless', seq: 4, arguments: '{"file_path":"old.txt"}',
        result: { content: [{ type: 'text', text: 'ok' }], text: 'ok', isError: false, endedAt: 1 },
      }),
      transcriptTool({
        id: 'noargs', callId: 'c-noargs', seq: 5, arguments: '{bad',
        result: readResult(undefined, true),
      }),
    ]), readSource())
    const group = model.entries[0] as unknown as { reads: Array<Record<string, unknown>> }
    expect(group.reads[0]).toMatchObject({
      callId: 'c-rich', path: 'big.ts', requestedRange: { first: 101, last: 108 }, range: { first: 101, last: 108 },
      totalLines: 400, state: 'ok', previewLines: { length: 5 },
    })
    expect((group.reads[0]!['previewLines'] as Array<{ number: number }>)[0]).toMatchObject({ number: 101 })
    expect(group.reads[1]).toMatchObject({ callId: 'c-pending', path: 'next.ts', state: 'pending', requestedRange: { first: 5, last: 34 } })
    expect(group.reads[1]!['previewLines']).toBeUndefined()
    expect(group.reads[2]).toMatchObject({ callId: 'c-metaless', path: 'old.txt', state: 'ok' })
    expect(group.reads[2]!['range']).toBeUndefined()
    expect(group.reads[3]).toMatchObject({ callId: 'c-noargs', state: 'error', error: 'File not found: nope.txt' })
    expect(group.reads[3]!['path']).toBeUndefined()
  })

  it('falls back to the view path and the stock error line', () => {
    const model = conversationTranscriptModel(projection([
      transcriptTool({
        id: 'viewpath', callId: 'c-viewpath', seq: 1, arguments: '{}',
        result: readResult({ path: 'from-view.ts', offset: 2, lines: [{ number: 2, text: 'x' }], totalLines: 2 }),
      }),
      transcriptTool({
        id: 'blank', callId: 'c-blank', seq: 2, arguments: '{"file_path":"b.txt"}',
        result: { content: [{ type: 'text', text: '\n  \n' }], text: '\n  \n', isError: true, endedAt: 9 },
      }),
    ]), readSource())
    const group = model.entries[0] as unknown as { reads: Array<Record<string, unknown>> }
    expect(group.reads[0]).toMatchObject({ callId: 'c-viewpath', path: 'from-view.ts', range: { first: 2, last: 2 } })
    expect(group.reads[1]).toMatchObject({ callId: 'c-blank', state: 'error', error: 'read failed' })
  })
})

describe('OfficialConversationModelSource', () => {
  it('publishes baseline and live whole values while rejecting stale and malformed changes', () => {
    const f = sourceFixture(projection([
      { kind: 'assistant', id: 'a-1', seq: 1, turn: 0, step: 0, text: 'baseline', streaming: false },
    ]), 4)
    const published: string[] = []
    const source = new OfficialConversationModelSource(f.source, toolSource(), model => {
      const entry = model.entries[0]
      published.push(entry?.kind === 'transcript-assistant' ? entry.text : 'empty')
    })
    source.attach(true)
    expect(source.snapshot().entries[0]).toMatchObject({ text: 'baseline' })
    expect(published).toEqual(['baseline'])

    f.emit('other', projection(), 5)
    f.emit('blueConversation', projection(), 4)
    f.emit('blueConversation', { entries: 'bad', streaming: false }, 5)
    expect(published).toEqual(['baseline'])

    f.emit('blueConversation', projection([
      { kind: 'assistant', id: 'a-2', seq: 5, turn: 0, step: 0, text: 'live', streaming: true },
    ], true), 6)
    expect(source.snapshot().streaming).toBe(true)
    expect(published).toEqual(['baseline', 'live'])

    f.set({ entries: 'bad', streaming: false }, 7)
    source.attach(true)
    expect(source.snapshot().entries).toEqual([])
    source.attach(false)
    expect(published.at(-1)).toBe('empty')
    source.dispose()
    source.dispose()
    f.emit('blueConversation', projection(), 8)
    expect(f.off).toHaveBeenCalledOnce()
  })

  it('accepts a projection snapshot without sequence metadata', () => {
    const fixture = sourceFixture(projection(), 4)
    fixture.source.current = vi.fn(() => ({ value: projection([
      { kind: 'assistant', id: 'a-1', seq: 1, turn: 0, step: 0, text: 'baseline', streaming: false },
    ]) }) as never)
    const source = new OfficialConversationModelSource(fixture.source, toolSource(), () => undefined)
    source.attach(true)
    expect(source.snapshot().entries[0]).toMatchObject({ text: 'baseline' })
    source.dispose()
  })
})

describe('official conversation plugin', () => {
  it('registers one Fiber-owned model and follows structurally valid session bindings', () => {
    const f = sourceFixture(projection(), 0)
    const refresh = vi.fn()
    const unregister = vi.fn()
    const cleanups: Array<() => void> = []
    let registered: (() => unknown) | undefined
    let sessionChanged: ((session: { readonly id: string } | null) => void) | undefined
    let registrationDisposed = false
    const ctx = {
      blueSessionProjections: f.source,
      tools: toolSource(),
      blueTranscriptModels: {
        refresh,
        register(source: () => unknown) {
          registered = source
          return unregister
        },
      },
      blueSessionReader: {
        subscribe(listener: typeof sessionChanged) {
          sessionChanged = listener
          listener?.({ id: 'session-1' })
          return { get disposed() { return registrationDisposed }, dispose() { registrationDisposed = true; sessionChanged = undefined } }
        },
      },
      effect(effect: () => () => void) {
        const cleanup = effect()
        cleanups.push(cleanup)
        return cleanup
      },
    }

    apply(ctx as never)
    expect(name).toBe('blue-transcript-official')
    expect(inject).toEqual(['blueConversationProjection', 'blueSessionProjections', 'blueSessionReader', 'blueTranscriptModels', 'tools'])
    expect(registered?.()).toMatchObject({ id: 'official-conversation' })
    expect(refresh).toHaveBeenCalledWith('official-conversation')

    sessionChanged?.(null)
    sessionChanged?.({ id: 'session-2' })
    expect(f.source.current).toHaveBeenCalledTimes(2)
    for (const cleanup of cleanups.reverse()) cleanup()
    expect(unregister).toHaveBeenCalledOnce()
    expect(f.off).toHaveBeenCalledOnce()
    expect(registrationDisposed).toBe(true)
  })
})
