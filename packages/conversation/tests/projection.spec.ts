import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  MessageId,
  type AssistantMessage,
  type ContentBlock,
  type ToolResultMessage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  SessionStore,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import * as conversationPlugin from '../src/index.ts'
import {
  conversationProjectionDefinition,
  conversationProjectionSchema,
  conversationProjectionStateSchema,
  foldConversationProjection,
  initialConversationState,
} from '../src/projection.ts'
import type { ConversationProjectionState } from '../src/types.ts'

let nextSeq = 0

beforeEach(() => {
  nextSeq = 0
})

function event<T extends SessionEvent['type']>(
  type: T,
  data: SessionEvent<T>['data'],
  options: { readonly append?: boolean, readonly replace?: boolean, readonly time?: number } = {},
): SessionEvent<T> {
  const seq = nextSeq
  nextSeq += 1
  return {
    type,
    seq,
    time: options.time ?? 1_700_000_000_000 + seq,
    data,
    ...(options.append ? { surfaceOp: 'append' } : {}),
    ...(options.replace ? { surfaceOp: { op: 'replace', start: 0, end: 0 } } : {}),
  } as SessionEvent<T>
}

function userMessage(text: string, content: readonly ContentBlock[] = [], source: UserMessage['source'] = { kind: 'user' }): UserMessage {
  return {
    id: MessageId(`user-${String(nextSeq)}`),
    role: 'user',
    content: [{ type: 'text', text }, ...content],
    source,
  }
}

function assistantMessage(content: readonly ContentBlock[]): AssistantMessage {
  return {
    id: MessageId(`assistant-${String(nextSeq)}`),
    role: 'assistant',
    content: [...content],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  }
}

function toolResultMessage(callId: string, content: readonly ContentBlock[], isError = false): ToolResultMessage {
  return {
    id: MessageId(`result-${String(nextSeq)}`),
    role: 'user',
    content: [{ type: 'tool-result', toolCallId: CallId(callId), content: [...content], isError }],
    source: { kind: 'tool', callId: CallId(callId) },
  }
}

function fold(events: readonly SessionEvent[]) {
  return events.reduce(foldConversationProjection, initialConversationState())
}

describe('blueConversation projection', () => {
  it('converges streaming chunks on authoritative assistant messages and pairs tool results', () => {
    const events: SessionEvent[] = [
      event('turn/start', { turn: 2 }),
      event('user/message', userMessage('hello'), { append: true }),
      event('step/start', { turn: 2, step: 0 }),
      event('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '  ' } }),
      event('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } }),
      event('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'text-delta', index: 1, text: 'draft' } }),
      event('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'text-delta', index: 1, text: ' answer' } }),
      event('assistant/message', {
        turn: 2,
        step: 0,
        message: assistantMessage([
          { type: 'reasoning', text: 'final thought' },
          { type: 'text', text: 'final answer' },
        ]),
      }, { append: true }),
      event('tool/call', { turn: 2, step: 0, callId: CallId('call-1'), name: 'read', arguments: '{"path":"a"}' }, { time: 100 }),
      event('tool/result', {
        turn: 2,
        step: 0,
        message: toolResultMessage('call-1', [{ type: 'text', text: 'line one' }]),
        meta: 'presented result',
      }, { append: true, time: 160 }),
      event('tool/call', { turn: 2, step: 0, callId: CallId('todo-1'), name: 'todo_write', arguments: '{}' }),
      event('tool/call', { turn: 2, step: 0, callId: CallId('agent-1'), name: 'subagent_fork', arguments: '{}' }),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
    ]

    const state = fold(events)
    expect(state.active).toBe(false)
    expect(state.pendingReasoning).toBe('')
    expect(state.entries).toMatchObject([
      { kind: 'user', turn: 2, text: 'hello', images: [] },
      { kind: 'thinking', turn: 2, step: 0, text: 'final thought', streaming: false },
      { kind: 'assistant', turn: 2, step: 0, text: 'final answer', streaming: false },
      {
        kind: 'tool',
        callId: 'call-1',
        channel: 'transcript',
        startedAt: 100,
        result: { text: 'presented result', isError: false, endedAt: 160 },
      },
      { kind: 'tool', callId: 'todo-1', channel: 'todo' },
      { kind: 'tool', callId: 'agent-1', channel: 'agents' },
    ])
    expect(conversationProjectionDefinition.wire.view(state)).toEqual({ entries: state.entries, streaming: false })
  })

  it('uses append-origin human rows and preserves durable image references', () => {
    const image = {
      type: 'image' as const,
      attachment: {
        attachmentId: 'image-1' as never,
        mediaType: 'image/png' as const,
        bytes: 12,
        width: 4,
        height: 3,
        name: 'plot.png',
        originalDimensions: { width: 8, height: 6 },
      },
    }
    const state = fold([
      event('turn/start', { turn: 1 }),
      event('user/message', userMessage('', [image, {
        type: 'image',
        attachment: {
          attachmentId: 'image-2' as never,
          mediaType: 'image/png',
          bytes: 12,
          width: 4,
          height: 3,
        },
      }]), { append: true }),
      event('user/message', userMessage(''), { append: true }),
      event('user/message', userMessage('replacement'), { replace: true }),
      event('user/message', userMessage('plugin', [], { kind: 'plugin', plugin: 'spec' } as UserMessage['source']), { append: true }),
      event('assistant/message', { turn: 1, step: 0, message: assistantMessage([{ type: 'text', text: 'hidden' }]) }, { replace: true }),
      event('assistant/message', { turn: 1, step: 0, message: assistantMessage([{ type: 'image', attachment: image.attachment }]) }, { append: true }),
    ])
    expect(state.entries).toHaveLength(2)
    expect(state.entries[0]).toEqual(expect.objectContaining({
      kind: 'user',
      text: '[image]\n[image]',
      images: [{
        attachmentId: 'image-1',
        mediaType: 'image/png',
        bytes: 12,
        width: 4,
        height: 3,
        name: 'plot.png',
        originalDimensions: { width: 8, height: 6 },
      }, {
        attachmentId: 'image-2', mediaType: 'image/png', bytes: 12, width: 4, height: 3,
      }],
    }))
    expect(state.entries[1]).toEqual(expect.objectContaining({ kind: 'assistant', text: '[image]' }))
  })

  it('handles unpaired failures, interruptions, and rejects finalized or interrupted late chunks', () => {
    let state = fold([
      event('turn/start', { turn: 3 }),
      event('step/start', { turn: 3, step: 0 }),
      event('assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', index: 0, text: 'partial' } }),
      event('assistant/message', { turn: 3, step: 0, message: assistantMessage([{ type: 'text', text: 'done' }]) }, { append: true }),
    ])
    const finalized = state
    state = foldConversationProjection(state, event('assistant/chunk', { turn: 3, step: 0, chunk: { type: 'text-delta', index: 0, text: 'late' } }))
    expect(state).toBe(finalized)

    state = foldConversationProjection(state, event('tool/result', {
      turn: 3,
      step: 1,
      message: toolResultMessage('orphan', [{ type: 'text', text: 'bad' }], true),
      error: { name: 'ToolError', code: 'E_TOOL' },
      meta: { details: true },
    }, { append: true, time: 220 }))
    expect(state.entries.at(-1)).toMatchObject({
      kind: 'tool',
      callId: 'orphan',
      name: 'tool',
      result: { text: 'bad', isError: true, endedAt: 220, meta: { details: true } },
    })
    const replacementResult = foldConversationProjection(state, event('tool/result', {
      turn: 3,
      step: 1,
      message: toolResultMessage('orphan', [{ type: 'text', text: 'replacement' }]),
    }, { replace: true }))
    expect(replacementResult).toBe(state)

    state = foldConversationProjection(state, event('turn/end', {
      turn: 3,
      reason: { kind: 'aborted', reason: { kind: 'user' } },
    }))
    const interrupted = state
    state = foldConversationProjection(state, event('assistant/chunk', { turn: 3, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: 'late' } }))
    expect(state).toBe(interrupted)
    state = foldConversationProjection(state, event('turn/end', {
      turn: 3,
      reason: { kind: 'interrupted' },
    }))
    expect(state).toStrictEqual(interrupted)

    state = foldConversationProjection(state, event('turn/start', { turn: 4 }))
    state = foldConversationProjection(state, event('turn/end', {
      turn: 4,
      reason: { kind: 'error', error: { message: 'endpoint down', code: 'HTTP_404' } },
    }))
    state = foldConversationProjection(state, event('turn/start', { turn: 5 }))
    state = foldConversationProjection(state, event('turn/end', {
      turn: 5,
      reason: { kind: 'error', error: { message: 'unknown', code: '' } },
    }))
    expect(state.entries.slice(-2)).toMatchObject([
      { kind: 'error', turn: 4, message: 'endpoint down', code: 'HTTP_404' },
      { kind: 'error', turn: 5, message: 'unknown' },
    ])
  })

  it('settles incomplete steps, ignores unrelated chunks, and validates checkpoints', () => {
    let state = initialConversationState()
    const unrelated = event('request/context', { provider: 'mock', model: 'mock' })
    expect(foldConversationProjection(state, unrelated)).toBe(state)
    state = foldConversationProjection(state, event('turn/start', { turn: 7 }))
    state = foldConversationProjection(state, event('step/start', { turn: 7, step: 0 }))
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 7,
      step: 0,
      chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
    }))
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 7,
      step: 0,
      chunk: { type: 'reasoning-delta', index: 0, text: ' ' },
    }))
    const beforeWhitespace = state
    expect(state.pendingReasoning).toBe(' ')
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 7,
      step: 0,
      chunk: { type: 'text-delta', index: 0, text: '' },
    }))
    state = foldConversationProjection(state, event('step/start', { turn: 7, step: 1 }))
    expect(state.streamingStep).toBeNull()
    expect(state.pendingReasoning).toBe('')
    expect(state.entries).toMatchObject([{ kind: 'assistant', text: '', streaming: false }])
    expect(beforeWhitespace.streamingStep).toBe('7:0')

    expect(conversationProjectionSchema.safeParse({ entries: state.entries, streaming: true }).success).toBe(true)
    expect(conversationProjectionSchema.safeParse({ entries: [], streaming: 'yes' }).success).toBe(false)
    expect(conversationProjectionStateSchema.safeParse(state).success).toBe(true)
    expect(conversationProjectionStateSchema.safeParse({ ...state, finalizedSteps: [1] }).success).toBe(false)
    expect(conversationProjectionDefinition.stateVersion).toBe(1)
  })

  it('covers final-only replay, mid-stream settling, nested result text, and defensive restored ids', () => {
    let state = fold([
      event('turn/start', { turn: 8 }),
      event('assistant/message', {
        turn: 8,
        step: 0,
        message: assistantMessage([{ type: 'reasoning', text: 'replayed thought' }]),
      }, { append: true }),
      event('assistant/message', {
        turn: 8,
        step: 1,
        message: assistantMessage([{ type: 'text', text: 'replayed answer' }]),
      }, { append: true }),
    ])
    expect(state.entries).toMatchObject([
      { kind: 'thinking', text: 'replayed thought', streaming: false },
      { kind: 'assistant', text: 'replayed answer', streaming: false },
    ])
    const finalized = state
    state = foldConversationProjection(state, event('assistant/message', {
      turn: 8,
      step: 1,
      message: assistantMessage([{ type: 'text', text: 'duplicate' }]),
    }, { append: true }))
    expect(state).toBe(finalized)

    state = foldConversationProjection(state, event('turn/start', { turn: 9 }))
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 9, step: 0, chunk: { type: 'text-delta', index: 0, text: 'answer first' },
    }))
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 9, step: 0, chunk: { type: 'reasoning-delta', index: 1, text: 'thought after' },
    }))
    state = foldConversationProjection(state, event('assistant/chunk', {
      turn: 9, step: 0, chunk: { type: 'reasoning-delta', index: 1, text: ' continued' },
    }))
    state = foldConversationProjection(state, event('step/start', { turn: 9, step: 1 }))
    expect(state.entries.slice(-2)).toMatchObject([
      { kind: 'thinking', text: 'thought after continued', streaming: false },
      { kind: 'assistant', text: 'answer first', streaming: false },
    ])

    state = foldConversationProjection(state, event('tool/result', {
      turn: 9,
      step: 1,
      message: toolResultMessage('nested', [{
        type: 'tool-result',
        toolCallId: CallId('inner'),
        content: [{ type: 'text', text: 'nested text' }],
        isError: false,
      }]),
    }, { append: true }))
    expect(state.entries.at(-1)).toMatchObject({ kind: 'tool', result: { text: 'nested text' } })
    expect(conversationProjectionStateSchema.safeParse(state).success).toBe(true)

    const crossed: ConversationProjectionState = {
      ...initialConversationState(),
      entries: [
        { kind: 'assistant', id: 'assistant-id', seq: 1, turn: 1, step: 0, text: 'a', streaming: true },
        { kind: 'thinking', id: 'thinking-id', seq: 2, turn: 1, step: 0, text: 't', streaming: true },
      ],
      streamingStep: '1:0',
      streamingThinkingId: 'assistant-id',
      streamingAssistantId: 'thinking-id',
    }
    const crossedReasoning = foldConversationProjection(crossed, event('assistant/chunk', {
      turn: 1, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: 'ignored kind' },
    }))
    expect(crossedReasoning.entries).toEqual(crossed.entries)
    const crossedText = foldConversationProjection(crossed, event('assistant/chunk', {
      turn: 1, step: 0, chunk: { type: 'text-delta', index: 0, text: 'ignored kind' },
    }))
    expect(crossedText.entries).toEqual(crossed.entries)
    const settled = foldConversationProjection(crossed, event('step/start', { turn: 1, step: 1 }))
    expect(settled.streamingThinkingId).toBeNull()
    expect(settled.streamingAssistantId).toBeNull()

    const missing: ConversationProjectionState = {
      ...crossed,
      streamingThinkingId: 'missing-thinking',
      streamingAssistantId: 'missing-assistant',
    }
    expect(foldConversationProjection(missing, event('step/start', { turn: 1, step: 2 })).entries).toEqual(missing.entries)

    const crossedFinal = foldConversationProjection(crossed, event('assistant/message', {
      turn: 1,
      step: 0,
      message: assistantMessage([{ type: 'reasoning', text: 'final t' }, { type: 'text', text: 'final a' }]),
    }, { append: true }))
    expect(crossedFinal.finalizedSteps).toContain('1:0')

    let answerFirst = foldConversationProjection(initialConversationState(), event('assistant/chunk', {
      turn: 10, step: 0, chunk: { type: 'text-delta', index: 0, text: 'draft' },
    }))
    answerFirst = foldConversationProjection(answerFirst, event('assistant/message', {
      turn: 10,
      step: 0,
      message: assistantMessage([{ type: 'reasoning', text: 'insert before answer' }, { type: 'text', text: 'final' }]),
    }, { append: true }))
    expect(answerFirst.entries.map(entry => entry.kind)).toEqual(['thinking', 'assistant'])

    const badToolPair: ConversationProjectionState = {
      ...initialConversationState(),
      entries: [{ kind: 'assistant', id: 'not-a-tool', seq: 1, turn: 1, step: 0, text: 'a', streaming: false }],
      toolEntryIds: { paired: 'not-a-tool' },
    }
    const unchangedPair = foldConversationProjection(badToolPair, event('tool/result', {
      turn: 1,
      step: 0,
      message: toolResultMessage('paired', [{ type: 'text', text: 'result' }]),
    }, { append: true }))
    expect(unchangedPair.entries).toEqual(badToolPair.entries)
  })
})

describe('SessionProjectionRegistry integration', () => {
  it('replays, checkpoints, restores, drives live changes, and removes the capability on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('conversation-spec'))
    session.append('turn/start', { turn: 0 })
    session.append('user/message', userMessage('replayed'), { surfaceOp: 'append' })

    const fiber = await ctx.plugin(conversationPlugin)
    expect(ctx.blueConversationProjection).toEqual({ key: 'blueConversation' })
    expect(ctx.sessionProjections.snapshot(session)).toMatchObject({
      asOfSeq: 1,
      values: { blueConversation: { entries: [{ kind: 'user', text: 'replayed' }], streaming: true } },
    })
    const changes: number[] = []
    const off = ctx.sessionProjections.onChanged((changedSession, key, _value, seq) => {
      if (changedSession === session && key === 'blueConversation') changes.push(seq)
    })
    session.append('step/start', { turn: 0, step: 0 })
    session.append('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'live' } })
    expect(changes).toEqual([2, 3])

    const checkpoint = ctx.sessionProjections.checkpoint(session)
    expect(checkpoint.blueConversation).toMatchObject({ ver: 1, seq: 3 })
    expect(ctx.sessionProjections.viewCheckpoint(checkpoint)).toMatchObject({
      blueConversation: { entries: expect.arrayContaining([expect.objectContaining({ kind: 'assistant', text: 'live' })]) },
    })
    const floor = ctx.sessionProjections.restoreFloor(checkpoint)
    expect(floor).toBe(3)
    const restored = ctx.sessionProjections.restore(checkpoint, session.events.filter(row => row.seq >= floor!), floor!)
    expect(restored.snapshot).toEqual(ctx.sessionProjections.snapshot(session))
    expect(ctx.sessionProjections.stateOf(session, 'blueConversation')).toBeDefined()

    off()
    await fiber.dispose()
    expect(ctx.get('blueConversationProjection')).toBeUndefined()
    expect(ctx.sessionProjections.snapshot(session)).toEqual({ asOfSeq: 3, values: {} })
    await ctx.fiber.dispose()
  })
})
