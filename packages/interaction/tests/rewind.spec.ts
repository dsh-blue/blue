/** Tests for the pure single-level rewind projection. */

import { describe, expect, it } from 'vitest'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { rewindCandidates } from '../src/rewind.ts'
import { createSessionTree } from '../src/session-tree.ts'

describe('createSessionTree', () => {
  const date = (value: number): string => `d${value}`
  const header = (id: string, createdAt: number, parentSession?: string) => ({
    version: 0,
    id: SessionId(id),
    createdAt,
    ...(parentSession === undefined ? {} : { parentSession: SessionId(parentSession) }),
  })

  it('reveals only the current lineage until a branch is explicitly expanded', () => {
    const tree = createSessionTree([
      header('root', 1),
      header('child', 3, 'root'),
      header('sibling', 2, 'root'),
      header('orphan', 2, 'missing'),
      header('tie', 2),
    ], new Map([['root', 'Root title']]), 'child', date)
    const initial = tree.rows()
    expect(initial.map(row => row.value)).toEqual(['tie', 'orphan', 'root', 'child'])
    expect(initial.map(row => row.label)).toEqual([
      '  tie · d2',
      '  orphan · d2',
      '▿ Root title',
      '└─   child',
    ])
    expect(initial[3]?.current).toBe(true)
    expect(initial[3]?.description).toBe('child · d3')

    tree.toggle('root')
    expect(tree.rows().map(row => row.value)).toEqual(['tie', 'orphan', 'root', 'child', 'sibling'])
    expect(tree.rows()[2]?.label).toBe('▾ Root title')
    tree.toggle('root')
    expect(tree.rows().map(row => row.value)).toEqual(['tie', 'orphan', 'root'])
    expect(tree.rows()[2]?.label).toBe('▸ Root title')
    tree.toggle('child')
    expect(tree.rows().map(row => row.value)).toEqual(['tie', 'orphan', 'root'])
  })

  it('reveals collapsed descendants for search without changing disclosure', () => {
    const tree = createSessionTree([
      header('root', 1),
      header('hidden', 2, 'root'),
    ], new Map(), undefined, date)
    expect(tree.rows().map(row => row.value)).toEqual(['root'])
    expect(tree.rows(true).map(row => row.value)).toEqual(['root', 'hidden'])
    expect(tree.rows().map(row => row.value)).toEqual(['root'])
  })

  it('promotes cyclic and self-parented records without looping', () => {
    const tree = createSessionTree([
      header('a', 3, 'b'),
      header('b', 2, 'a'),
      header('self', 1, 'self'),
    ], new Map(), 'a', date)
    expect(tree.rows().map(row => row.value)).toEqual(['self', 'a', 'b'])
    tree.toggle('a')
    expect(tree.rows().map(row => row.value)).toEqual(['self', 'a', 'b'])
  })
})

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: 1_700_000_000_000 + seq, data } as SessionEvent
}

function user(seq: number, text: string | undefined, kind = 'user'): SessionEvent {
  return event('user/message', seq, {
    id: MessageId(`user-${String(seq)}`),
    role: 'user',
    source: { kind },
    ...(text === undefined ? {} : { content: [{ type: 'image' }, { type: 'text', text }] }),
  })
}

function assistant(seq: number, text: string | undefined): SessionEvent {
  return event('assistant/message', seq, {
    turn: 1,
    step: 0,
    message: {
      id: MessageId(`assistant-${String(seq)}`),
      role: 'assistant',
      source: { kind: 'model', provider: 'mock', model: 'mock' },
      content: text === undefined ? [{ type: 'image' }] : [{ type: 'text', text }],
    },
  })
}

describe('rewindCandidates', () => {
  it('returns newest-first direct-user boundaries with response previews', () => {
    const events = [
      undefined,
      user(0, 'plugin context', 'plugin'),
      event('turn/start', 1, { turn: 1 }),
      user(2, undefined),
      assistant(3, 'first\nresponse'),
      event('tool/call', 4, {}),
      user(5, 'second\tprompt'),
      assistant(6, undefined),
      assistant(7, 'second response'),
      user(8, undefined),
      event('turn/start', 9, { turn: 2 }),
      user(10, 'latest prompt'),
    ] as unknown as SessionEvent[]

    expect(rewindCandidates(events)).toEqual([
      { turn: 2, boundarySeq: 9, prompt: 'latest prompt' },
      { turn: 1, boundarySeq: 1, prompt: '(empty prompt) / second prompt / (empty prompt)', response: 'second response' },
    ])
  })

  it('handles logs without message content', () => {
    expect(rewindCandidates([
      event('turn/start', 0, { turn: 1 }),
      user(1, undefined),
    ])).toEqual([{ turn: 1, boundarySeq: 0, prompt: '(empty prompt)' }])
  })
})
