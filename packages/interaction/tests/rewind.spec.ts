/** Tests for the pure single-level rewind projection. */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
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
