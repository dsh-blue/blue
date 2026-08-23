/**
 * The shell-output sanitizer over the control-sequence families it strips:
 * CSI, OSC, single-ESC, and C0 controls — with `\n`/`\t` preserved and the
 * non-string/never-throw contracts pinned.
 */

import { describe, expect, it } from 'vitest'
import { sanitizeShellOutput } from '../src/shell-sanitize.ts'

describe('sanitizeShellOutput', () => {
  it('passes plain text through unchanged', () => {
    expect(sanitizeShellOutput('hello\nworld')).toBe('hello\nworld')
  })

  it('keeps tabs and newlines, dropping the rest of the C0 controls', () => {
    expect(sanitizeShellOutput('a\tb\nc\rd\x00e\x07f')).toBe('a\tb\ncdef')
  })

  it('strips CSI sequences (colors, cursor moves, private modes)', () => {
    // The color codes vanish; the colored text is content and stays.
    expect(sanitizeShellOutput('a\x1b[31mred\x1b[0mb')).toBe('aredb')
    expect(sanitizeShellOutput('\x1b[?1049h\x1b[2J\x1b[H')).toBe('')
    expect(sanitizeShellOutput('x\x1b[1;5H')).toBe('x')
  })

  it('strips OSC sequences terminated by BEL or ESC\\', () => {
    expect(sanitizeShellOutput('a\x1b]0;title\x07b')).toBe('ab')
    expect(sanitizeShellOutput('a\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\b')).toBe('alinkb')
  })

  it('strips single-ESC sequences (charset, save/restore cursor, reset)', () => {
    expect(sanitizeShellOutput('a\x1b7b\x1b8c')).toBe('abc')
    expect(sanitizeShellOutput('a\x1bcb')).toBe('ab')
  })

  it('strips a trailing lone ESC and an ESC plus one character', () => {
    // A lone ESC at the end is a C0 control; ESC followed by a printable
    // character is itself a single-ESC sequence (charset/keypad selection).
    expect(sanitizeShellOutput('a\x1b')).toBe('a')
    expect(sanitizeShellOutput('a\x1bb')).toBe('a')
  })

  it('returns an empty string for non-string input', () => {
    expect(sanitizeShellOutput(undefined)).toBe('')
    expect(sanitizeShellOutput(null)).toBe('')
    expect(sanitizeShellOutput(42)).toBe('')
  })

  it('passes an empty string through', () => {
    expect(sanitizeShellOutput('')).toBe('')
  })
})
