/**
 * Tests for the terminal escape emitters: the OSC 52 clipboard-copy
 * sequence (pure builder with plain and bare-tmux arms, the tmux detection
 * default, and the injectable-process write path with its TTY
 * gate and write-failure containment) and the OSC 0 window-title sequence
 * (sanitization, the code-point cap, and the sequence shape).
 */

import { describe, expect, it } from 'vitest'
import {
  buildClipboardOsc52,
  buildTitleOsc0,
  emitClipboardOsc52,
  sanitizeTitleText,
  TITLE_MAX_CHARS,
  type BlueEscapeProcess,
} from '../src/terminal-escape.ts'

/** A process fake recording stdout writes; can be non-TTY or throwing. */
function fakeProc(opts: { tty?: boolean, throwOnWrite?: boolean } = {}): BlueEscapeProcess & { written: string[] } {
  const written: string[] = []
  return {
    written,
    stdout: {
      ...(opts.tty === false ? {} : { isTTY: true }),
      write(chunk: string): void {
        if (opts.throwOnWrite === true) throw new Error('stream destroyed')
        written.push(chunk)
      },
    },
  }
}

describe('buildClipboardOsc52', () => {
  it('builds the plain sequence with a base64 payload', () => {
    const sequence = buildClipboardOsc52('hi', false)
    expect(sequence).toBe(`\x1b]52;c;${Buffer.from('hi', 'utf8').toString('base64')}\x07`)
  })

  it('keeps the sequence bare inside tmux so set-clipboard can consume it', () => {
    const sequence = buildClipboardOsc52('hi', true)
    expect(sequence).toBe(`\x1b]52;c;${Buffer.from('hi', 'utf8').toString('base64')}\x07`)
    expect(sequence).not.toContain('\x1bPtmux;')
  })

  it('encodes multi-byte text as UTF-8 before base64', () => {
    const sequence = buildClipboardOsc52('你好', false)
    expect(sequence).toBe(`\x1b]52;c;${Buffer.from('你好', 'utf8').toString('base64')}\x07`)
  })

  it('keeps the default output bare when $TMUX is set', () => {
    const saved = process.env.TMUX
    try {
      delete process.env.TMUX
      const expected = `\x1b]52;c;${Buffer.from('x', 'utf8').toString('base64')}\x07`
      expect(buildClipboardOsc52('x')).toBe(expected)
      process.env.TMUX = '/tmp/tmux-1000/default,123,0'
      expect(buildClipboardOsc52('x')).toBe(expected)
    } finally {
      if (saved === undefined) {
        delete process.env.TMUX
      } else {
        process.env.TMUX = saved
      }
    }
  })
})

describe('emitClipboardOsc52', () => {
  it('writes the sequence to a TTY stdout', () => {
    const proc = fakeProc()
    expect(emitClipboardOsc52('hi', proc)).toBe(true)
    expect(proc.written).toEqual([`\x1b]52;c;${Buffer.from('hi', 'utf8').toString('base64')}\x07`])
  })

  it('declines without writing when stdout is not a terminal', () => {
    const proc = fakeProc({ tty: false })
    expect(emitClipboardOsc52('hi', proc)).toBe(false)
    expect(proc.written).toEqual([])
  })

  it('contains a write failure as a false result', () => {
    const proc = fakeProc({ throwOnWrite: true })
    expect(emitClipboardOsc52('hi', proc)).toBe(false)
  })
})

describe('sanitizeTitleText', () => {
  it('strips C0 and C1 control characters, including ESC and BEL', () => {
    expect(sanitizeTitleText('a\x1b]52;c;b3Nk\x07b')).toBe('a]52;c;b3Nkb')
    expect(sanitizeTitleText('x\x00\x08\x0b\x7f\x9by')).toBe('xy')
  })

  it('strips directional and invisible controls that can spoof a title', () => {
    expect(sanitizeTitleText('a\u200Bb\u200Ec\u202Ed\uFEFFe')).toBe('abcde')
  })

  it('collapses whitespace runs and trims, but keeps inner spaces', () => {
    expect(sanitizeTitleText('  fix   the \n login \t bug ')).toBe('fix the login bug')
    expect(sanitizeTitleText('\u00A0\u3000wide nbsp\u00A0')).toBe('wide nbsp')
  })

  it('returns an empty string for control-only input', () => {
    expect(sanitizeTitleText('\x1b\x07\x00\u200B \n')).toBe('')
  })
})

describe('buildTitleOsc0', () => {
  it('builds the OSC 0 sequence with a BEL terminator', () => {
    expect(buildTitleOsc0('fix the login bug')).toBe('\x1b]0;fix the login bug\x07')
  })

  it('caps the payload at TITLE_MAX_CHARS code points, not splitting one', () => {
    const cjk = '重构认证模块的登录超时缺陷与限流保护方案讨论'.repeat(2)
    const sequence = buildTitleOsc0(cjk)
    const payload = sequence.slice('\x1b]0;'.length, -'\x07'.length)
    expect([...payload]).toHaveLength(TITLE_MAX_CHARS)
    expect(payload).toBe([...sanitizeTitleText(cjk)].slice(0, TITLE_MAX_CHARS).join(''))
  })

  it('sanitizes before capping, so an injected sequence cannot escape the slot', () => {
    const sequence = buildTitleOsc0('evil\x1b]0;pwned\x07title')
    expect(sequence).toBe('\x1b]0;evil]0;pwnedtitle\x07')
    // One OSC opener and one BEL in the whole sequence.
    expect(sequence.match(/\x1b\]/gu)).toHaveLength(1)
    expect(sequence.match(/\x07/gu)).toHaveLength(1)
  })

  it('builds an empty-payload sequence for empty input', () => {
    expect(buildTitleOsc0('   \x1b ')).toBe('\x1b]0;\x07')
  })
})
