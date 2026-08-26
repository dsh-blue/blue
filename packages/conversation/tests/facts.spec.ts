/**
 * Facts projection coverage: replay/live parity, usage and mode transitions,
 * subagent call pairing, schema validation, and Cordis lifecycle ownership.
 *
 * @module @dsh-blue/blue-conversation/tests/facts
 */

import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionStore, type SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import * as conversation from '../src/index.ts'
import {
  conversationFactsProjectionDefinition,
  conversationFactsSchema,
  foldConversationFacts,
  initialConversationFacts,
} from '../src/facts.ts'

let seq = 0

function event(type: SessionEvent['type'], data: unknown, time = 1_700_000_000_000 + seq): SessionEvent {
  const result = { type, seq, time, data } as unknown as SessionEvent
  seq += 1
  return result
}

function toolResult(callId: string, content: unknown[], isError = false): unknown {
  return {
    turn: 1,
    step: 0,
    message: {
      content: [{ type: 'tool-result', toolCallId: callId, content, isError }],
    },
  }
}

describe('blueConversationFacts projection', () => {
  it('invalidates persisted version-1 checkpoints after the child-run facts expansion', () => {
    expect(conversationFactsProjectionDefinition.stateVersion).toBe(2)
  })

  it('folds lifecycle, streaming, usage, todos, request metadata, and agents', () => {
    seq = 0
    let state = initialConversationFacts()
    const unchanged = foldConversationFacts(state, event('user/message', {}))
    expect(unchanged).toBe(state)
    state = foldConversationFacts(state, event('turn/start', { turn: 1 }))
    expect(state).toMatchObject({ phase: 'waiting', active: true, turn: 1, flowDownChars: 0 })
    state = foldConversationFacts(state, event('step/start', { turn: 1, step: 0 }))
    state = foldConversationFacts(state, event('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: 'think' } }))
    state = foldConversationFacts(state, event('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'answer' } }))
    expect(foldConversationFacts(state, event('assistant/chunk', { turn: 1, step: 0, chunk: { type: 'audio-delta', text: '' } }))).toBe(state)
    expect(state).toMatchObject({ phase: 'composing', flowDownChars: 11 })
    const beforeMessage = state
    expect(foldConversationFacts(state, event('assistant/message', { usage: undefined }))).toBe(beforeMessage)
    state = foldConversationFacts(state, event('assistant/message', { usage: { inputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 3 } }))
    expect(state.contextTokens).toBe(15)
    state = foldConversationFacts(state, event('assistant/message', { usage: { inputTokens: 4 } }))
    expect(state.contextTokens).toBe(4)
    state = foldConversationFacts(state, event('request/context', { contextWindow: 32 }))
    state = foldConversationFacts(state, event('request/header', { header: { config: { model: 'm', provider: 'p', reasoningEffort: 'high' } } }))
    state = foldConversationFacts(state, event('todo/write', { todos: [{ content: 'ship', status: 'pending' }] }))
    expect(state).toMatchObject({ contextWindow: 32, model: 'm', provider: 'p', reasoningEffort: 'high', todos: [{ content: 'ship' }] })
    state = foldConversationFacts(state, event('tool/call', { turn: 1, step: 0, callId: 'agent-1', name: 'subagent', arguments: '{}', }, 88))
    state = foldConversationFacts(state, event('tool/call', { turn: 1, step: 0, callId: 'agent-2', name: 'subagent_fork', arguments: '{}' }, 89))
    state = foldConversationFacts(state, event('tool/call', { turn: 1, step: 0, callId: 'plain', name: 'read', arguments: '{}' }))
    expect(state).toMatchObject({ phase: 'tool', epochToolCount: 3 })
    state = foldConversationFacts(state, event('tool/result', toolResult('agent-1', [{ type: 'text', text: 'done' }, { type: 'json', value: 1 }], true), 99))
    expect(state.agentCalls[0]).toMatchObject({ callId: 'agent-1', result: { text: 'done', isError: true, endedAt: 99 } })
    state = foldConversationFacts(state, event('tool/result', toolResult('agent-1', [{ type: 'text', text: 'ok' }]), 100))
    expect(state.agentCalls[0]?.result).toMatchObject({ text: 'ok', isError: false, endedAt: 100 })
    const unchangedResult = foldConversationFacts(state, event('tool/result', toolResult('missing', [{ type: 'text', text: 'ignored' }])))
    expect(unchangedResult).toBe(state)
    state = foldConversationFacts(state, event('step/end', { turn: 1, step: 0 }))
    state = foldConversationFacts(state, event('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(state).toMatchObject({ phase: 'idle', active: false, turn: 1 })
  })

  it('guards malformed tool results and validates the wire value', () => {
    const state = initialConversationFacts()
    const legacy = { ...state }
    delete legacy.epochToolCount
    expect(foldConversationFacts(legacy, event('tool/call', {
      turn: 1, step: 0, callId: 'legacy', name: 'read', arguments: '{}',
    })).epochToolCount).toBe(1)
    expect(foldConversationFacts(legacy, event('tool/call', {
      turn: 1, step: 0, callId: 'legacy-agent', name: 'subagent', arguments: '{}',
    })).epochToolCount).toBe(1)
    expect(foldConversationFacts(state, event('tool/result', { message: { content: [] } }))).toBe(state)
    expect(foldConversationFacts(state, event('tool/result', { message: { content: [{ type: 'text', content: [] }] } }))).toBe(state)
    expect(conversationFactsSchema.safeParse(state).success).toBe(true)
    expect(conversationFactsSchema.safeParse({ ...state, phase: 'bad' }).success).toBe(false)
    expect(conversationFactsProjectionDefinition.wire.view({ ...state, todos: [{ content: 'x', status: 'pending' }] })).toEqual({ ...state, todos: [{ content: 'x', status: 'pending' }] })
  })

  it('replays and publishes facts through the official registry, then unloads', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('facts-spec'))
    session.append('turn/start', { turn: 2 })
    session.append('request/header', { header: { config: { model: 'replay', provider: 'mock' } } })
    const fiber = await ctx.plugin(conversation)
    expect(ctx.sessionProjections.snapshot(session).values.blueConversationFacts).toMatchObject({ model: 'replay', provider: 'mock', turn: 2 })
    const changed: number[] = []
    const off = ctx.sessionProjections.onChanged((target, key, _value, nextSeq) => {
      if (target === session && key === 'blueConversationFacts') changed.push(nextSeq)
    })
    session.append('assistant/chunk', { turn: 2, step: 0, chunk: { type: 'text-delta', index: 0, text: 'live' } })
    expect(changed).toEqual([2])
    off()
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values.blueConversationFacts).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
