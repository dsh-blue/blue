/** Tests for transcript-compatible grouping of assistant stream chunks. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventRecord } from '@deepseek-ai/dsh-session-query'
import { aggregateTraceItems } from '../src/trace-aggregate.ts'

const sessionId = 'trace' as never

function record(seq: number, type: string): SessionEventRecord {
  return { sessionId, seq, time: seq, type, surface: 'current' }
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { seq, time: seq, type, data } as unknown as SessionEvent
}

describe('aggregateTraceItems', () => {
  it('merges reasoning and text deltas per turn and step', () => {
    const records = [
      record(1, 'assistant/chunk'), record(2, 'assistant/chunk'),
      record(3, 'assistant/chunk'), record(4, 'assistant/chunk'),
      record(5, 'assistant/message'), record(6, 'assistant/chunk'),
    ]
    const events = [
      event(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'No' } }),
      event(2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: ' need' } }),
      event(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'answer' } }),
      event(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: ' now' } }),
      event(5, 'assistant/message', { turn: 1, step: 1, message: { content: [] } }),
      event(6, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'ignored' } }),
    ]
    expect(aggregateTraceItems(records, events)).toMatchObject([
      { seq: 1, lastSeq: 2, eventSeqs: [1, 2], title: 'Thinking', summary: 'No need' },
      { seq: 3, lastSeq: 4, eventSeqs: [3, 4], title: 'Assistant draft', summary: 'answer now' },
      { seq: 5, lastSeq: 5, eventSeqs: [5] },
    ])
  })

  it('keeps unknown and unpaired records as individual items', () => {
    const records = [record(1, 'custom/event'), record(2, 'assistant/chunk')]
    const events = [event(1, 'custom/event', { value: 1 })]
    const items = aggregateTraceItems(records, events)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ seq: 1, summary: '{"value":1}' })
    expect(items[1]).toMatchObject({ seq: 2, summary: '' })
  })

  it('ignores unsupported stream chunk kinds', () => {
    const records = [record(1, 'assistant/chunk')]
    const events = [event(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } })]
    expect(aggregateTraceItems(records, events)).toEqual([])
  })
})
