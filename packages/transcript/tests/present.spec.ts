/**
 * The pure present resolvers: argument parsing plus the contained
 * presenter-call matrix (unknown tool, no presenter, decline, throw, happy).
 */

import { describe, expect, it } from 'vitest'
import { parseToolArguments, resolveCallView, resolveResultView, summarizeToolCall, type ToolPresentationSource } from '../src/present.ts'

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

describe('summarizeToolCall', () => {
  it('renders object arguments as key/value lines under the tool name', () => {
    expect(summarizeToolCall('read', '{"file_path":"src/a.ts","limit":100}')).toBe('read\n  file_path: src/a.ts\n  limit: 100')
  })

  it('caps pairs, flattens values, and counts the dropped tail', () => {
    const args = JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`k${String(index)}`, index])))
    expect(summarizeToolCall('probe', args)).toBe(
      'probe\n  k0: 0\n  k1: 1\n  k2: 2\n  k3: 3\n  k4: 4\n  k5: 5\n  … +2 more',
    )
    const long = JSON.stringify({ command: 'a\nb'.repeat(30) })
    expect(summarizeToolCall('bash', long)).not.toContain('\nb')
    expect(summarizeToolCall('probe', JSON.stringify({ flag: true, nested: { deep: [1, 2] } }))).toContain('flag: true')
    expect(summarizeToolCall('probe', JSON.stringify({ nested: { deep: [1, 2] } }))).toContain('nested: {"deep":[1,2]}')
  })

  it('keeps the inline form for non-object and unparseable arguments', () => {
    expect(summarizeToolCall('probe', '"just-a-string"')).toBe('probe("just-a-string")')
    expect(summarizeToolCall('probe', '[1,2]')).toBe('probe([1,2])')
    expect(summarizeToolCall('probe', 'not json')).toBe('probe(not json)')
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
