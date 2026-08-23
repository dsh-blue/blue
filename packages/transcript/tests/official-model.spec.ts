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

function sourceFixture(initial: ConversationProjection | unknown = projection(), initialSeq = 0) {
  const session = { id: 'session-1' }
  const other = { id: 'session-2' }
  let snapshotValue = initial
  let snapshotSeq = initialSeq
  let changed: ((session: unknown, key: string, value: unknown, seq: number) => void) | undefined
  const off = vi.fn()
  const source: ConversationProjectionSource = {
    snapshot: vi.fn(() => ({ asOfSeq: snapshotSeq, values: { blueConversation: snapshotValue } })),
    onChanged: vi.fn(listener => {
      changed = listener
      return off
    }),
  }
  return {
    session,
    other,
    source,
    off,
    set(value: unknown, seq: number) {
      snapshotValue = value
      snapshotSeq = seq
    },
    emit(target: unknown, key: string, value: unknown, seq: number) {
      changed?.(target, key, value, seq)
    },
  }
}

describe('official conversation model mapping', () => {
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
      presentation: { call: { kind: 'text', text: 'missing' } },
    })

    const failed = conversationTranscriptModel(projection([
      transcriptTool({
        result: { content: [{ type: 'text', text: 'failure' }], text: 'failure', isError: true, endedAt: 200 },
      }),
    ]), toolSource())
    expect(failed.entries[0]).toMatchObject({
      presentation: { result: { kind: 'text', text: 'failure', tone: 'danger' } },
    })
  })
})

describe('OfficialConversationModelSource', () => {
  it('publishes baseline and live whole values while rejecting stale, malformed, and foreign changes', () => {
    const f = sourceFixture(projection([
      { kind: 'assistant', id: 'a-1', seq: 1, turn: 0, step: 0, text: 'baseline', streaming: false },
    ]), 4)
    const published: string[] = []
    const source = new OfficialConversationModelSource(f.source, toolSource(), model => {
      const entry = model.entries[0]
      published.push(entry?.kind === 'transcript-assistant' ? entry.text : 'empty')
    })
    source.attach({ id: 'session-1', session: f.session })
    expect(source.snapshot().entries[0]).toMatchObject({ text: 'baseline' })
    expect(published).toEqual(['baseline'])

    f.emit(f.other, 'blueConversation', projection(), 5)
    f.emit(f.session, 'other', projection(), 5)
    f.emit(f.session, 'blueConversation', projection(), 4)
    f.emit(f.session, 'blueConversation', { entries: 'bad', streaming: false }, 5)
    expect(published).toEqual(['baseline'])

    f.emit(f.session, 'blueConversation', projection([
      { kind: 'assistant', id: 'a-2', seq: 5, turn: 0, step: 0, text: 'live', streaming: true },
    ], true), 6)
    expect(source.snapshot().streaming).toBe(true)
    expect(published).toEqual(['baseline', 'live'])

    f.set({ entries: 'bad', streaming: false }, 7)
    source.attach({ id: 'session-2', session: f.other })
    expect(source.snapshot().entries).toEqual([])
    source.attach(undefined)
    expect(published.at(-1)).toBe('empty')
    source.dispose()
    source.dispose()
    f.emit(f.other, 'blueConversation', projection(), 8)
    expect(f.off).toHaveBeenCalledOnce()
  })
})

describe('official conversation plugin', () => {
  it('registers one Fiber-owned model and follows structurally valid session bindings', () => {
    const f = sourceFixture(projection(), 0)
    const refresh = vi.fn()
    const unregister = vi.fn()
    const cleanups: Array<() => void> = []
    let registered: (() => unknown) | undefined
    let sessionChanged: ((agent: unknown) => void) | undefined
    const ctx = {
      sessionProjections: f.source,
      tools: toolSource(),
      blueTranscriptModels: {
        refresh,
        register(source: () => unknown) {
          registered = source
          return unregister
        },
      },
      blueSession: { current: { id: 'session-1', session: f.session } },
      effect(effect: () => () => void) {
        const cleanup = effect()
        cleanups.push(cleanup)
        return cleanup
      },
      on(_event: string, listener: (agent: unknown) => void) {
        sessionChanged = listener
        return () => { sessionChanged = undefined }
      },
    }

    apply(ctx as never)
    expect(name).toBe('blue-transcript-official')
    expect(inject).toEqual(['blueConversationProjection', 'sessionProjections', 'blueTranscriptModels', 'blueSession', 'tools'])
    expect(registered?.()).toMatchObject({ id: 'official-conversation' })
    expect(refresh).toHaveBeenCalledWith('official-conversation')

    sessionChanged?.(null)
    sessionChanged?.({ id: 4, session: {} })
    sessionChanged?.({ id: 'missing-session' })
    sessionChanged?.({ id: 'session-2', session: f.other })
    expect(f.source.snapshot).toHaveBeenCalledTimes(2)
    for (const cleanup of cleanups.reverse()) cleanup()
    expect(unregister).toHaveBeenCalledOnce()
    expect(f.off).toHaveBeenCalledOnce()
  })
})
