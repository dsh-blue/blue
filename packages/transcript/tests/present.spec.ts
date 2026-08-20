/**
 * The pure present resolvers: argument parsing plus the contained
 * presenter-call matrix (unknown tool, no presenter, decline, throw, happy).
 */

import { describe, expect, it } from 'vitest'
import { isReadItem, parseToolArguments, resolveCallView, resolveResultView, type ToolPresentationSource } from '../src/present.ts'
import type { TranscriptToolItem } from '../src/types.ts'

/** A registry stub whose `get` returns the prearranged runtime (or nothing). */
function tools(get: (name: string) => unknown): ToolPresentationSource {
  return { get } as ToolPresentationSource
}

describe('isReadItem', () => {
  function readItem(view: TranscriptToolItem['view']): TranscriptToolItem {
    return { kind: 'tool', seq: 1, callId: 'c1', name: 'read', arguments: '{}', view }
  }

  it('marks the pending read call view (generic card, read kind)', () => {
    expect(isReadItem(readItem({ card: 'generic', title: 'Read x', kind: 'read' }))).toBe(true)
  })

  it('marks the completed ReadResultView', () => {
    expect(isReadItem(readItem({
      card: 'read', path: 'x', offset: 1, lines: [], totalLines: 0,
    }))).toBe(true)
  })

  it('rejects other generic kinds and view-less items', () => {
    expect(isReadItem(readItem({ card: 'generic', title: 'Search', kind: 'search' }))).toBe(false)
    expect(isReadItem(readItem(undefined))).toBe(false)
  })

  it('defends against a malformed view missing the card tag', () => {
    expect(isReadItem(readItem({ title: 'x' } as never))).toBe(false)
  })
})

describe('parseToolArguments', () => {
  it('parses valid JSON', () => {
    expect(parseToolArguments('{"command":"ls"}')).toEqual({ command: 'ls' })
    expect(parseToolArguments('[]')).toEqual([])
  })

  it('returns undefined for invalid JSON', () => {
    expect(parseToolArguments('{"command":')).toBeUndefined()
    expect(parseToolArguments('')).toBeUndefined()
  })
})

describe('resolveCallView', () => {
  const view = { card: 'terminal' } as never

  it('returns undefined for an unknown tool', () => {
    const source = tools(() => undefined)
    expect(resolveCallView(source, 'nope', {})).toBeUndefined()
  })

  it('returns undefined when the tool declares no presenter', () => {
    const source = tools(() => ({}))
    expect(resolveCallView(source, 'bash', {})).toBeUndefined()
  })

  it('returns undefined when the presenter declines', () => {
    const source = tools(() => ({ presentCall: () => undefined }))
    expect(resolveCallView(source, 'bash', {})).toBeUndefined()
  })

  it('returns undefined when the presenter throws', () => {
    const source = tools(() => ({ presentCall: () => { throw new Error('boom') } }))
    expect(resolveCallView(source, 'bash', {})).toBeUndefined()
  })

  it('returns the presenter view on the happy path', () => {
    const source = tools(() => ({ presentCall: () => view }))
    expect(resolveCallView(source, 'bash', { command: 'ls' })).toBe(view)
  })
})

describe('resolveResultView', () => {
  const result = { content: [], isError: false } as never
  const view = { card: 'diff' } as never

  it('returns undefined for an unknown tool', () => {
    const source = tools(() => undefined)
    expect(resolveResultView(source, 'nope', {}, result)).toBeUndefined()
  })

  it('returns undefined when the tool declares no presenter', () => {
    const source = tools(() => ({}))
    expect(resolveResultView(source, 'edit', {}, result)).toBeUndefined()
  })

  it('returns undefined when the presenter declines', () => {
    const source = tools(() => ({ presentResult: () => undefined }))
    expect(resolveResultView(source, 'edit', {}, result)).toBeUndefined()
  })

  it('returns undefined when the presenter throws', () => {
    const source = tools(() => ({ presentResult: () => { throw new Error('boom') } }))
    expect(resolveResultView(source, 'edit', {}, result)).toBeUndefined()
  })

  it('returns the presenter view on the happy path', () => {
    const source = tools(() => ({ presentResult: (_args: unknown, got: unknown) => (got === result ? view : undefined) }))
    expect(resolveResultView(source, 'edit', {}, result)).toBe(view)
  })
})
