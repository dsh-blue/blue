/**
 * The pure present resolvers: argument parsing plus the contained
 * presenter-call matrix (unknown tool, no presenter, decline, throw, happy).
 */

import { describe, expect, it } from 'vitest'
import { parseToolArguments, resolveCallView, resolveResultView, type ToolPresentationSource } from '../src/present.ts'

/** A registry stub whose `get` returns the prearranged runtime (or nothing). */
function tools(get: (name: string) => unknown): ToolPresentationSource {
  return { get } as ToolPresentationSource
}

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
