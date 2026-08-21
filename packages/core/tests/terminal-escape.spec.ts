/**
 * Tests for the OSC 52 clipboard-copy escape emitter: the pure sequence
 * builder (plain and tmux-wrapped arms, the tmux detection default) and
 * the injectable-process write path (TTY gate, write failure containment).
 */

import { describe, expect, it } from 'vitest'
import { buildClipboardOsc52, emitClipboardOsc52, type BlueEscapeProcess } from '../src/terminal-escape.ts'

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

  it('wraps the sequence in the tmux DCS passthrough with doubled ESC bytes', () => {
    const sequence = buildClipboardOsc52('hi', true)
    const inner = `\x1b]52;c;${Buffer.from('hi', 'utf8').toString('base64')}\x07`
    expect(sequence).toBe(`\x1bPtmux;${inner.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`)
    // The wrapper opens with a single DCS start and closes with ST.
    expect(sequence.startsWith('\x1bPtmux;')).toBe(true)
    expect(sequence.endsWith('\x1b\\')).toBe(true)
  })

  it('encodes multi-byte text as UTF-8 before base64', () => {
    const sequence = buildClipboardOsc52('你好', false)
    expect(sequence).toBe(`\x1b]52;c;${Buffer.from('你好', 'utf8').toString('base64')}\x07`)
  })

  it('defaults the tmux arm from $TMUX', () => {
    const saved = process.env.TMUX
    try {
      delete process.env.TMUX
      expect(buildClipboardOsc52('x')).not.toContain('Ptmux;')
      process.env.TMUX = '/tmp/tmux-1000/default,123,0'
      expect(buildClipboardOsc52('x')).toContain('Ptmux;')
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
