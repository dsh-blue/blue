/** Tests for the pure single-level rewind projection. */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { messagePreview, rewindCandidates } from '../src/rewind.ts'
import { flattenSessionTree } from '../src/session-tree.ts'

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

  it('collapses a batch of direct messages claimed by one turn', () => {
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
})

describe('flattenSessionTree', () => {
  const date = (value: number): string => `d${value}`
  const header = (id: string, createdAt: number, parentSession?: string) => ({
    version: 0,
    id: SessionId(id),
    createdAt,
    ...(parentSession === undefined ? {} : { parentSession: SessionId(parentSession) }),
  })

  it('renders roots, children, titles, and the current badge data', () => {
    const rows = flattenSessionTree([
      header('root', 1),
      header('child', 3, 'root'),
      header('orphan', 2, 'missing'),
      header('tie', 2),
    ], new Map([['root', 'Root title']]), 'child', date)
    expect(rows.map(row => row.label)).toEqual(['tie · d2', 'orphan · d2', 'Root title', '└─ child'])
    expect(rows[3]?.current).toBe(true)
    expect(rows[3]?.description).toBe('child · d3')
  })

  it('promotes cyclic and self-parented records without looping', () => {
    const rows = flattenSessionTree([
      header('a', 3, 'b'),
      header('b', 2, 'a'),
      header('self', 1, 'self'),
    ], new Map(), undefined, date)
    expect(rows.map(row => row.value)).toEqual(['self', 'a', 'b'])
  })
})
