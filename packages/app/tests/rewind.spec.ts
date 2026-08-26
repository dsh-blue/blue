/** Tests for the app-owned renderer-neutral rewind projection. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { messagePreview, rewindCandidates } from '../src/rewind.ts'

const event = (type: string, seq: number, data: unknown = {}): SessionEvent =>
  ({ type, seq, time: seq + 100, data } as unknown as SessionEvent)

const user = (seq: number, text: string, source: string = 'user'): SessionEvent => event(
  'user/message',
  seq,
  { content: [{ type: 'text', text }], source: { kind: source } },
)

describe('rewindCandidates', () => {
  it('returns direct user turns newest first with assistant previews', () => {
    const rows = rewindCandidates([
      event('turn/start', 0, { turn: 1 }),
      user(1, 'first\nrequest'),
      event('assistant/message', 2, { message: { content: [{ type: 'text', text: 'first answer' }] } }),
      event('turn/end', 3),
      event('turn/start', 4, { turn: 2 }),
      user(5, 'second request'),
      event('user/message', 6, { content: [{ type: 'text', text: 'injected' }], source: { kind: 'agent' } }),
    ])
    expect(rows).toEqual([
      { turn: 2, boundarySeq: 4, prompt: 'second request', time: 105 },
      { turn: 1, boundarySeq: 0, prompt: 'first request', response: 'first answer', time: 101 },
    ])
    expect(Object.isFrozen(rows)).toBe(true)
    expect(Object.isFrozen(rows[0])).toBe(true)
  })

  it('handles empty content and a final user message', () => {
    const rows = rewindCandidates([
      user(0, ''),
      event('assistant/message', 1, { message: { content: [{ type: 'reasoning', text: 'hidden' }] } }),
    ])
    expect(rows[0]?.prompt).toBe('(empty prompt)')
    expect(rows[0]?.response).toBeUndefined()
    expect(messagePreview({})).toBe('')
  })

  it('collapses direct messages claimed by one turn', () => {
    const rows = rewindCandidates([
      event('turn/start', 0, { turn: 3 }),
      user(1, 'queued one'),
      user(2, 'queued two'),
      event('assistant/message', 3, { message: { content: [{ type: 'text', text: 'combined answer' }] } }),
    ])
    expect(rows).toEqual([{
      turn: 3,
      boundarySeq: 0,
      prompt: 'queued one · queued two',
      response: 'combined answer',
      time: 101,
    }])
  })

  it('collapses an empty batched message without inventing a response', () => {
    expect(rewindCandidates([
      event('turn/start', 0, { turn: 4 }),
      user(1, 'queued one'),
      user(2, ''),
    ])).toEqual([{
      turn: 4,
      boundarySeq: 0,
      prompt: 'queued one · (empty prompt)',
      time: 101,
    }])
  })
})
