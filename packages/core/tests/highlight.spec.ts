/**
 * `highlightCodeLines`: the markdown `highlightCode` hook's backend —
 * language gating, red-scope resetting, and the never-change-line-count
 * contract including the throw fallback.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('cli-highlight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cli-highlight')>()
  return { ...actual, highlight: vi.fn(actual.highlight) }
})

import { highlight } from 'cli-highlight'

import { highlightCodeLines } from '../src/highlight.ts'
import type { BlueColorFn } from '../src/types.ts'

const base: BlueColorFn = (text) => `«base:${text}»`

describe('highlightCodeLines', () => {
  it('returns the raw split for unknown, empty, or missing languages', () => {
    expect(highlightCodeLines('a\nb', 'notalang', base)).toEqual(['a', 'b'])
    expect(highlightCodeLines('a\nb', undefined, base)).toEqual(['a', 'b'])
    expect(highlightCodeLines('a\nb', '', base)).toEqual(['a', 'b'])
    expect(highlightCodeLines('a\nb', '   ', base)).toEqual(['a', 'b'])
  })

  it('highlights a known language, normalizing case and whitespace, without changing the line count', () => {
    const code = 'const x = 1\n// note'
    const lines = highlightCodeLines(code, '  JS ', base)
    expect(lines).toHaveLength(code.split('\n').length)
    expect(lines.join('\n')).toContain('const')
  })

  it('resets the red scopes to the palette base and keeps illegals on', () => {
    vi.mocked(highlight).mockClear()
    highlightCodeLines('a', 'js', base)
    expect(highlight).toHaveBeenCalledWith('a', {
      language: 'js',
      ignoreIllegals: true,
      theme: { default: base, string: base, regexp: base, deletion: base },
    })
  })

  it('falls back to the raw split when the highlighter throws', () => {
    vi.mocked(highlight).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(highlightCodeLines('a\nb', 'js', base)).toEqual(['a', 'b'])
  })
})
