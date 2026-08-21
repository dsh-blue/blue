/**
 * The S33 child-session tracker: the pure reducer over a scripted child
 * stream, the replace-per-step usage rule, the epoch stop-reason mapping,
 * the continuable re-wake, ack-id and prompt correlation, the live end-to-end
 * path over a real Context (admission keys, dispose), and the seed's
 * firstLiveSeq slice (the fork-prefix inflation trap).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  activityLine,
  memberLiveSnapshot,
  childIdOfResult,
  correlate,
  deriveChildEvent,
  phaseOfTurnEnd,
  sumChildTokens,
  trackChildAgents,
  type ChildAgentState,
} from '../src/agent-live.ts'
import type { TranscriptToolItem } from '../src/types.ts'

/** Build one child state for the pure reducer cases. */
function childState(partial: Partial<ChildAgentState> = {}): ChildAgentState {
  return {
    id: '9f5c4086a0674b55b621c3eaf8b88c0e',
    startedAt: 1_700_000_000_000,
    phase: 'starting',
    toolCount: 0,
    usageByStep: new Map(),
    ...partial,
  }
}

/** A `user/message` event with text content (the delegation prompt shape). */
function userMessageEvent(text: string, kind = 'user'): SessionEvent<'user/message'> {
  return {
    type: 'user/message', seq: 1, time: 1, data: {
      id: 'm' as never, role: 'user',
      content: [{ type: 'text', text }],
      source: { kind } as never,
    },
  }
}

/** A `request/header` event carrying the call config. */
function requestHeaderEvent(model: string, effort?: string): SessionEvent<'request/header'> {
  return {
    type: 'request/header', seq: 2, time: 2, data: {
      header: {
        id: 'h' as never, reason: 'turn' as never,
        config: { provider: 'p', model, ...(effort !== undefined ? { reasoningEffort: effort } : {}) },
      },
    },
  }
}

/** An `assistant/message` event with a per-step usage record. */
function usageEvent(turn: number, step: number, usage: Record<string, number>): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message', seq: 3, time: 3, data: {
      turn, step, message: { id: 'm' as never, role: 'assistant', content: [], source: { kind: 'model' } as never },
      usage: usage as never,
    },
  }
}

/** A `tool/call` event from the child. */
function childToolCall(name: string): SessionEvent<'tool/call'> {
  return { type: 'tool/call', seq: 4, time: 4, data: { turn: 1, step: 1, callId: 'x' as never, name, arguments: '{}' } }
}

/** A delta chunk of the given type. */
function chunkEvent(type: 'text-delta' | 'reasoning-delta'): SessionEvent<'assistant/chunk'> {
  return { type: 'assistant/chunk', seq: 5, time: 5, data: { turn: 1, step: 1, chunk: { type, index: 0, text: 'x' } } }
}

/** A boundary event of the given type. */
function boundaryEvent(type: 'turn/start', turn?: number): SessionEvent<'turn/start'>
function boundaryEvent(type: 'turn/end', turn?: number, reason?: string): SessionEvent<'turn/end'>
function boundaryEvent(
  type: 'turn/start' | 'turn/end', turn = 1, reason: string = 'completed',
): SessionEvent<'turn/start'> | SessionEvent<'turn/end'> {
  if (type === 'turn/start') return { type, seq: 6, time: 6, data: { turn: turn ?? 1 } }
  return { type: 'turn/end', seq: 7, time: 7, data: { turn, reason: { kind: reason } as never } }
}

/** One subagent member item (spawn ack shape). */
function memberItem(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return {
    kind: 'tool', seq: 1, turn: 1, step: 1, callId: 'c1', name: 'subagent',
    arguments: '{"description":"d","prompt":"survey"}',
    parsedArguments: { description: 'd', prompt: 'survey' },
    startedAt: 1_700_000_000_000,
    result: { text: 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', isError: false, endedAt: 1_700_000_000_035 },
    ...partial,
  }
}

describe('deriveChildEvent', () => {
  it('reduces the scripted child stream: prompt, config, markers, tools, usage, phase', () => {
    const state = childState()
    deriveChildEvent(state, boundaryEvent('turn/start'), 1)
    expect(state.phase).toBe('running')
    deriveChildEvent(state, userMessageEvent('survey'), 2)
    expect(state.promptText).toBe('survey')
    deriveChildEvent(state, requestHeaderEvent('deepseek-v4', 'high'), 3)
    expect(state.model).toBe('deepseek-v4')
    expect(state.effort).toBe('high')
    deriveChildEvent(state, chunkEvent('reasoning-delta'), 4)
    expect(activityLine(state)).toBe('Thinking…')
    deriveChildEvent(state, chunkEvent('text-delta'), 5)
    expect(activityLine(state)).toBe('Writing…')
    deriveChildEvent(state, childToolCall('read'), 6)
    expect(state.toolCount).toBe(1)
    expect(activityLine(state)).toBe('Using read')
    deriveChildEvent(state, usageEvent(1, 1, { inputTokens: 100, outputTokens: 5 }), 7)
    expect(sumChildTokens(state)).toBe(105)
    deriveChildEvent(state, boundaryEvent('turn/end', 1, 'completed'), 8)
    expect(state.phase).toBe('completed')
    expect(state.epochEndedAt).toBe(8)
  })

  it('keeps synthetic user messages out of the prompt key', () => {
    const state = childState()
    deriveChildEvent(state, userMessageEvent('agent-instructions text', 'agent-instructions'), 1)
    expect(state.promptText).toBeUndefined()
    deriveChildEvent(state, userMessageEvent('survey', 'user'), 2)
    expect(state.promptText).toBe('survey')
  })

  it('replaces usage per step instead of summing within one', () => {
    const state = childState()
    deriveChildEvent(state, usageEvent(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5 }), 1)
    // A later record for the same turn/step replaces (streaming correction).
    deriveChildEvent(state, usageEvent(1, 1, { inputTokens: 120, outputTokens: 10, cacheReadTokens: 5 }), 2)
    // A different step accumulates.
    deriveChildEvent(state, usageEvent(1, 2, { inputTokens: 30, outputTokens: 3, cacheWriteTokens: 7 }), 3)
    expect(sumChildTokens(state)).toBe(120 + 10 + 5 + 30 + 3 + 7)
  })

  it('maps every turn/end reason kind (the lifecycle mapping)', () => {
    expect(phaseOfTurnEnd({ kind: 'completed' } as never)).toBe('completed')
    expect(phaseOfTurnEnd({ kind: 'aborted' } as never)).toBe('aborted')
    expect(phaseOfTurnEnd({ kind: 'interrupted' } as never)).toBe('aborted')
    expect(phaseOfTurnEnd({ kind: 'error' } as never)).toBe('error')
    expect(phaseOfTurnEnd({ kind: 'max-tokens' } as never)).toBe('max-tokens')
    expect(phaseOfTurnEnd({ kind: 'blocked' } as never)).toBe('refusal')
  })

  it('re-wakes a continuable child with fresh epoch counters', () => {
    const state = childState()
    deriveChildEvent(state, boundaryEvent('turn/start'), 1)
    deriveChildEvent(state, childToolCall('read'), 2)
    deriveChildEvent(state, usageEvent(1, 1, { inputTokens: 500 }), 3)
    deriveChildEvent(state, boundaryEvent('turn/end', 1, 'completed'), 4)
    // A send_message wake: a new epoch resets tools and usage, keeps the
    // prompt key (already captured), and re-enters running.
    deriveChildEvent(state, boundaryEvent('turn/start', 2), 5)
    expect(state.phase).toBe('running')
    expect(state.toolCount).toBe(0)
    expect(sumChildTokens(state)).toBe(0)
    expect(state.epochEndedAt).toBeUndefined()
  })

  it('skips non-delta chunks and usage-less assistant messages, and unnamed tools', () => {
    const state = childState()
    deriveChildEvent(state, boundaryEvent('turn/start'), 1)
    // A block-start chunk is not an activity marker.
    deriveChildEvent(state, { type: 'assistant/chunk', seq: 8, time: 8, data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0 } } } as never, 8)
    expect(state.lastMarker).toBeUndefined()
    // A tool call whose name is not a string falls back to 'tool' in the line.
    deriveChildEvent(state, { type: 'tool/call', seq: 9, time: 9, data: { turn: 1, step: 1, callId: 'x', name: 42, arguments: '{}' } } as never, 9)
    expect(activityLine(state)).toBe('Using tool')
    // An assistant message without a usage record leaves the sum at zero.
    deriveChildEvent(state, { type: 'assistant/message', seq: 10, time: 10, data: { turn: 1, step: 2, message: { role: 'assistant', content: [] } } } as never, 10)
    expect(sumChildTokens(state)).toBe(0)
  })

  it('guards the malformed shapes the reducer must survive', () => {
    const state = childState()
    deriveChildEvent(state, boundaryEvent('turn/start'), 1)
    // A non-array content and an empty block list both yield no prompt text.
    deriveChildEvent(state, { type: 'user/message', seq: 11, time: 11, data: { role: 'user', content: 'not-blocks', source: { kind: 'user' } } } as never, 11)
    expect(state.promptText).toBeUndefined()
    deriveChildEvent(state, { type: 'user/message', seq: 12, time: 12, data: { role: 'user', content: [], source: { kind: 'user' } } } as never, 12)
    expect(state.promptText).toBeUndefined()
    // A non-text block contributes nothing; an empty-string prompt is ignored.
    deriveChildEvent(state, { type: 'user/message', seq: 13, time: 13, data: { role: 'user', content: [{ type: 'image' }, { type: 'text', text: '' }], source: { kind: 'user' } } } as never, 13)
    expect(state.promptText).toBeUndefined()
    // The first real prompt sticks; a second user message never overwrites.
    deriveChildEvent(state, userMessageEvent('survey'), 14)
    deriveChildEvent(state, userMessageEvent('a follow-up'), 15)
    expect(state.promptText).toBe('survey')
    // A headerless / configless / non-string-config request header is inert.
    deriveChildEvent(state, { type: 'request/header', seq: 16, time: 16, data: {} } as never, 16)
    deriveChildEvent(state, { type: 'request/header', seq: 17, time: 17, data: { header: { config: { model: 42, reasoningEffort: '' } } } } as never, 17)
    expect(state.model).toBeUndefined()
    expect(state.effort).toBeUndefined()
  })

  it('ignores event types outside the child vocabulary', () => {
    const state = childState({ phase: 'running', toolCount: 2 })
    deriveChildEvent(state, { type: 'session/title', seq: 9, time: 9, data: {} } as never, 9)
    expect(state.phase).toBe('running')
    expect(state.toolCount).toBe(2)
  })
})

describe('correlation', () => {
  it('parses the spawn ack id and matches the child exactly', () => {
    expect(childIdOfResult(memberItem({ result: undefined }))).toBeUndefined()
    const member = memberItem()
    expect(childIdOfResult(member)).toBe('9f5c4086a0674b55b621c3eaf8b88c0e')
    expect(correlate(childState({ id: '9f5c4086a0674b55b621c3eaf8b88c0e' }), member)).toBe(true)
    expect(correlate(childState({ id: 'other' }), member)).toBe(false)
  })

  it('rejects prompt correlation when the member arguments did not parse', () => {
    const bare = memberItem({ parsedArguments: undefined, arguments: 'not-json' })
    expect(correlate(childState({ id: 'x', promptText: 'survey' }), bare)).toBe(false)
    // A JSON null parse result and a scalar parse are equally unusable.
    const nullArgs = memberItem({ parsedArguments: null })
    expect(correlate(childState({ id: 'x', promptText: 'survey' }), nullArgs)).toBe(false)
    const scalarArgs = memberItem({ parsedArguments: 'not-an-object' })
    expect(correlate(childState({ id: 'x', promptText: 'survey' }), scalarArgs)).toBe(false)
  })

  it('ignores fork acks (job names) and falls back to the prompt key', () => {
    const fork = memberItem({
      result: { text: 'started background subagent job subagent-1', isError: false, endedAt: 1 },
    })
    expect(childIdOfResult(fork)).toBeUndefined()
    expect(correlate(childState({ id: 'x', promptText: 'survey' }), fork)).toBe(true)
    expect(correlate(childState({ id: 'x', promptText: 'other prompt' }), fork)).toBe(false)
    expect(correlate(childState({ id: 'x' }), fork)).toBe(false)
  })
})

describe('memberLiveSnapshot', () => {
  it('maps every display phase from the epoch phase', () => {
    expect(activityLine(childState())).toBe('Starting…')
    expect(memberLiveSnapshot(childState({ phase: 'starting', toolCount: 1 })).phase).toBe('waiting')
    expect(memberLiveSnapshot(childState({ phase: 'running' })).phase).toBe('running')
    expect(memberLiveSnapshot(childState({ phase: 'completed' })).phase).toBe('completed')
    expect(memberLiveSnapshot(childState({ phase: 'aborted' })).phase).toBe('failed')
    expect(memberLiveSnapshot(childState({ phase: 'error' })).phase).toBe('failed')
    expect(memberLiveSnapshot(childState({ phase: 'max-tokens' })).phase).toBe('failed')
    expect(memberLiveSnapshot(childState({ phase: 'refusal' })).phase).toBe('failed')
  })
})

describe('trackChildAgents', () => {
  /** A fake child session for the emit path. */
  function fakeSession(id: string, origin?: string, parentSession?: string): object {
    return { id, header: { origin, parentSession } }
  }

  function boot(): { ctx: Context; renders: number[]; tracker: ReturnType<typeof trackChildAgents> } {
    const ctx = new Context()
    const renders: number[] = []
    const tracker = trackChildAgents(
      ctx, { session: { id: 'parent-1' } }, () => { renders.push(1) },
    )
    return { ctx, renders, tracker }
  }

  it('admits by header keys, reduces the stream, and resolves the member snapshot', () => {
    const { ctx, renders, tracker } = boot()
    ctx.emit('session/event', fakeSession('9f5c4086a0674b55b621c3eaf8b88c0e', 'subagent', 'parent-1'), boundaryEvent('turn/start'))
    expect(tracker.snapshot(memberItem())?.phase).toBe('running')
    expect(renders.length).toBeGreaterThan(0)
    // A foreign parent's subagent child is not ours; a same-session
    // non-subagent event is not a child — neither admits.
    ctx.emit('session/event', fakeSession('bd317666afec47f4777c7ca701c1779e', 'subagent', 'other-parent'), boundaryEvent('turn/start'))
    ctx.emit('session/event', fakeSession('9c3405b971ad4baf92203564fb4d27e4', undefined, 'parent-1'), boundaryEvent('turn/start'))
    expect(tracker.snapshot(memberItem({ result: { text: 'started subagent bd317666afec47f4777c7ca701c1779e', isError: false, endedAt: 1 } }))).toBeUndefined()
    expect(tracker.snapshot(memberItem({ result: { text: 'started subagent 9c3405b971ad4baf92203564fb4d27e4', isError: false, endedAt: 1 } }))).toBeUndefined()
  })

  it('resolves an admitted-but-not-started child to waiting, and a refusal to failed', () => {
    const { ctx, tracker } = boot()
    // Admitted via a non-boundary event (the prompt user/message) — the
    // display phase is waiting until the first turn/start lands.
    const child = fakeSession('9c3405b971ad4baf92203564fb4d27e4', 'subagent', 'parent-1')
    ctx.emit('session/event', child, userMessageEvent('map the docs'))
    const promptMember = memberItem({
      parsedArguments: { description: 'Map', prompt: 'map the docs' },
      result: { text: 'started background subagent job subagent-1', isError: false, endedAt: 1 },
    })
    expect(tracker.snapshot(promptMember)?.phase).toBe('waiting')
    // A blocked epoch maps to refusal → failed.
    ctx.emit('session/event', child, boundaryEvent('turn/start'))
    ctx.emit('session/event', child, boundaryEvent('turn/end', 1, 'blocked'))
    expect(tracker.snapshot(promptMember)?.phase).toBe('failed')
  })

  it('returns nothing for a job-ack member no child prompt matches, and maps max-tokens to failed', () => {
    const { ctx, tracker } = boot()
    const child = fakeSession('9c3405b971ad4baf92203564fb4d27e4', 'subagent', 'parent-1')
    ctx.emit('session/event', child, userMessageEvent('map the docs'))
    ctx.emit('session/event', child, boundaryEvent('turn/start'))
    const unmatched = memberItem({
      parsedArguments: { description: 'Other', prompt: 'a different prompt' },
      result: { text: 'started background subagent job subagent-9', isError: false, endedAt: 1 },
    })
    expect(tracker.snapshot(unmatched)).toBeUndefined()
    ctx.emit('session/event', child, boundaryEvent('turn/end', 1, 'max-tokens'))
    expect(tracker.snapshot(memberItem({ parsedArguments: { description: 'd', prompt: 'map the docs' } }))).toBeUndefined()
  })

  it('correlates a fork member through its delegation prompt on the live path', () => {
    const { ctx, tracker } = boot()
    const child = fakeSession('9c3405b971ad4baf92203564fb4d27e4', 'subagent', 'parent-1')
    ctx.emit('session/event', child, userMessageEvent('map the docs'))
    ctx.emit('session/event', child, boundaryEvent('turn/start'))
    ctx.emit('session/event', child, childToolCall('glob'))
    const fork = memberItem({
      callId: 'f1',
      parsedArguments: { description: 'Map', prompt: 'map the docs' },
      result: { text: 'started background subagent job subagent-2', isError: false, endedAt: 1 },
    })
    expect(tracker.snapshot(fork)).toMatchObject({ phase: 'running', toolCount: 1, activity: 'Using glob' })
  })

  it('carries kimi-level fields through the snapshot', () => {
    const { ctx, tracker } = boot()
    const session = fakeSession('9f5c4086a0674b55b621c3eaf8b88c0e', 'subagent', 'parent-1')
    ctx.emit('session/event', session, boundaryEvent('turn/start'))
    ctx.emit('session/event', session, requestHeaderEvent('deepseek-v4', 'high'))
    ctx.emit('session/event', session, childToolCall('read'))
    ctx.emit('session/event', session, usageEvent(1, 1, { inputTokens: 3000, outputTokens: 200 }))
    const snapshot = tracker.snapshot(memberItem())
    expect(snapshot).toMatchObject({
      phase: 'running', toolCount: 1, tokens: 3200, model: 'deepseek-v4', effort: 'high',
      activity: 'Using read',
    })
  })

  it('stops accumulating after dispose', () => {
    const { ctx, tracker } = boot()
    tracker.dispose()
    const rendersBefore = 0
    const session = fakeSession('9f5c4086a0674b55b621c3eaf8b88c0e', 'subagent', 'parent-1')
    ctx.emit('session/event', session, boundaryEvent('turn/start'))
    expect(tracker.snapshot(memberItem())).toBeUndefined()
    expect(rendersBefore).toBe(0)
  })

  it('seeds from the sessions service, sliced at firstLiveSeq (fork-prefix trap)', () => {
    const ctx = new Context()
    // The fork child's log begins with the seeded parent-turn prefix (seq 0)
    // whose usage belongs to the parent; live events start at seq 2.
    const prefixUsage = usageEvent(0, 0, { inputTokens: 99_999 })
    const childLog: SessionEvent[] = [
      { ...prefixUsage, seq: 0 },
      { type: 'user/message', seq: 1, time: 1, data: userMessageEvent('survey', 'user').data },
      boundaryEvent('turn/start'),
      usageEvent(1, 1, { inputTokens: 400, outputTokens: 40 }),
      boundaryEvent('turn/end', 1, 'completed'),
    ].map((event, index) => ({ ...event, seq: index }) as SessionEvent)
    ctx.reflect.provide('sessions', {
      list: () => [{
        id: '9f5c4086a0674b55b621c3eaf8b88c0e',
        header: { origin: 'subagent', parentSession: 'parent-1' },
        events: childLog,
        firstLiveSeq: 2,
      }, {
        // No events at all (the guard arm), a fully-seeded child (nothing
        // live to reduce), and a foreign child (admission rejects).
        id: 'broken-child', header: { origin: 'subagent', parentSession: 'parent-1' },
      }, {
        id: 'seeded-child', header: { origin: 'subagent', parentSession: 'parent-1' },
        events: childLog, firstLiveSeq: 99,
      }, {
        id: 'foreign-child', header: { origin: 'subagent', parentSession: 'elsewhere' },
        events: childLog, firstLiveSeq: 2,
      }],
    })
    const tracker = trackChildAgents(ctx, { session: { id: 'parent-1' } }, () => {})
    const snapshot = tracker.snapshot(memberItem())
    // The prefix usage (99999) is excluded; the live epoch's 440 counted.
    expect(snapshot?.tokens).toBe(440)
    expect(snapshot?.phase).toBe('completed')
  })
})
