/**
 * The streaming-phase tracker: the event → phase mapping behind the
 * activity pane's mode machine, including the invisible-reasoning guard,
 * the residual-phase rule on `assistant/message`, and `turn/end` settling
 * idle.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { StreamingPhaseTracker } from '../src/phase.ts'
import {
  assistantEvent,
  event,
  reasoningDelta,
  resetSeq,
  stepStart,
  textDelta,
  toolCallEvent,
  toolResultEvent,
  turnEnd,
  turnStart,
  userEvent,
} from './helpers.ts'

beforeEach(() => {
  resetSeq()
})

/** Drive one tracker through the events; returns the changed phases seen. */
function phases(events: readonly SessionEvent[]): (string | null)[] {
  const tracker = new StreamingPhaseTracker()
  return events.map(e => tracker.apply(e))
}

describe('StreamingPhaseTracker', () => {
  it('starts waiting and maps the turn lifecycle', () => {
    const tracker = new StreamingPhaseTracker()
    expect(tracker.current).toBe('waiting')
    // A fresh tracker already reads waiting, so the turn/step begins that
    // precede any generation change nothing.
    expect(phases([
      turnStart(1),
      stepStart(1, 1),
    ])).toEqual([null, null])
  })

  it('maps human input, tool results, and tool calls', () => {
    const seen = phases([
      userEvent('go'),
      toolCallEvent(1, 1, 'c1', 'bash', '{}'),
      toolResultEvent(1, 1, 'c1', 'out'),
    ])
    expect(seen).toEqual([null, 'tool', 'waiting'])
  })

  it('maps reasoning to thinking and text to composing', () => {
    const seen = phases([
      reasoningDelta(1, 1, 'hmm'),
      textDelta(1, 1, 'answer'),
    ])
    expect(seen).toEqual(['thinking', 'composing'])
  })

  it('keeps the current phase while streamed reasoning stays invisible', () => {
    const tracker = new StreamingPhaseTracker()
    tracker.apply(turnStart(1))
    // Encrypted or whitespace-only reasoning must not blank the pane.
    expect(tracker.apply(reasoningDelta(1, 1, ' '))).toBeNull()
    expect(tracker.current).toBe('waiting')
    expect(tracker.apply(reasoningDelta(1, 1, 'real'))).toBe('thinking')
    // Once thinking, later whitespace deltas keep it.
    expect(tracker.apply(reasoningDelta(1, 1, ' '))).toBeNull()
    expect(tracker.current).toBe('thinking')
    // A new step resets the buffer: its invisible reasoning waits again.
    tracker.apply(stepStart(1, 2))
    expect(tracker.apply(reasoningDelta(1, 2, ' '))).toBeNull()
    expect(tracker.current).toBe('waiting')
  })

  it('maps streamed tool-call arguments to tool', () => {
    const seen = phases([
      event('assistant/chunk', {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'c1' as never, name: 'bash', argumentsDelta: '{}' },
      }),
    ])
    expect(seen).toEqual(['tool'])
  })

  it('keeps the residual phase on assistant/message and settles idle on turn/end', () => {
    const tracker = new StreamingPhaseTracker()
    tracker.apply(textDelta(1, 1, 'answering'))
    // Message completion keeps composing (kimi: no transition) until the
    // next event decides.
    expect(tracker.apply(assistantEvent(1, 1, [{ type: 'text', text: 'done' }]))).toBeNull()
    expect(tracker.current).toBe('composing')
    expect(tracker.apply(turnEnd(1))).toBe('idle')
  })

  it('ignores phase-less events', () => {
    const seen = phases([
      event('step/end', { turn: 1, step: 1 }),
      event('todo/write', { todos: [] }),
      event('request/header', {} as never),
    ])
    expect(seen).toEqual([null, null, null])
  })
})
