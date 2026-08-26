/** Projection-backed child-agent correlation and lifecycle coverage. */

import { describe, expect, it } from 'vitest'
import {
  childIdOfResult,
  childLiveSnapshot,
  correlateChild,
  trackChildAgentModels,
} from '../src/child-agent-model.ts'
import type { ChildSessionFacts } from '../src/session-facts.ts'
import type { TranscriptToolItem } from '../src/types.ts'

const child: ChildSessionFacts = {
  id: '9f5c4086a0674b55b621c3eaf8b88c0e', promptText: 'survey', phase: 'running',
  tokens: 125, toolCount: 2, activity: 'Using read', model: 'deepseek-v4', effort: 'high',
}

function member(partial: Partial<TranscriptToolItem> = {}): TranscriptToolItem {
  return {
    kind: 'tool', seq: 1, turn: 1, step: 1, callId: 'c1', name: 'subagent',
    arguments: '{"prompt":"survey"}', parsedArguments: { prompt: 'survey' }, startedAt: 1,
    result: { text: 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', isError: false, endedAt: 2 },
    ...partial,
  }
}

describe('child agent model', () => {
  it('correlates exact acknowledgement ids before prompt fallback', () => {
    expect(childIdOfResult(member())).toBe(child.id)
    expect(childIdOfResult(member({ result: undefined }))).toBeUndefined()
    expect(correlateChild(child, member())).toBe(true)
    expect(correlateChild({ ...child, id: 'other' }, member())).toBe(false)
    const fork = member({ result: { text: 'started background subagent job subagent-1', isError: false, endedAt: 2 } })
    expect(correlateChild(child, fork)).toBe(true)
    expect(correlateChild({ ...child, promptText: undefined }, fork)).toBe(false)
    expect(correlateChild(child, member({ result: fork.result, parsedArguments: null }))).toBe(false)
  })

  it('maps every projected field into the agent-card snapshot', () => {
    expect(childLiveSnapshot(child)).toEqual({
      phase: 'running', tokens: 125, toolCount: 2, activity: 'Using read', model: 'deepseek-v4', effort: 'high',
    })
    expect(childLiveSnapshot({ ...child, phase: 'completed', tokens: 0, activity: undefined, endedAt: 10 }))
      .toEqual({ phase: 'completed', toolCount: 2, model: 'deepseek-v4', effort: 'high', endedAt: 10 })
  })

  it('tracks immutable child snapshots and releases the subscription', () => {
    let publish: ((children: readonly ChildSessionFacts[]) => void) | undefined
    let disposed = false
    const facts = {
      subscribeChildren: (listener: typeof publish) => {
        publish = listener
        listener?.([])
        return () => { disposed = true }
      },
    }
    let changes = 0
    const tracker = trackChildAgentModels(facts as never, () => { changes += 1 })
    expect(tracker.snapshot(member())).toBeUndefined()
    publish?.([child])
    expect(tracker.snapshot(member())).toMatchObject({ phase: 'running', tokens: 125 })
    tracker.dispose()
    expect(disposed).toBe(true)
    expect(changes).toBe(2)
  })
})
