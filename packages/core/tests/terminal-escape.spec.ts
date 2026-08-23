/**
 * Tests for the terminal escape emitters and selection clipboard routing:
 * direct OSC 52 outside tmux, tmux-native `load-buffer -w -` with truthful
 * child-process outcomes, and the OSC 0 window-title sequence (sanitization,
 * the code-point cap, and the sequence shape).
 */

import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildClipboardOsc52,
  buildTitleOsc0,
  copySelectionText,
  emitClipboardOsc52,
  loadTmuxClipboard,
  sanitizeTitleText,
  TITLE_MAX_CHARS,
  type BlueEscapeProcess,
} from '../src/terminal-escape.ts'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

interface FakeChild extends EventEmitter {
  readonly stdin: EventEmitter & { end: ReturnType<typeof vi.fn> }
}

/** Child-process fake exposing the three events the tmux writer owns. */
function fakeChild(end: (text: string) => void = () => {}): FakeChild {
  const child = new EventEmitter() as FakeChild
  const stdin = new EventEmitter() as FakeChild['stdin']
  stdin.end = vi.fn(end)
  Object.defineProperty(child, 'stdin', { value: stdin })
  return child
}

afterEach(() => {
  vi.mocked(spawn).mockReset()
})

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

  it('keeps the pure sequence bare when a compatibility caller passes tmux', () => {
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

describe('loadTmuxClipboard', () => {
  it('writes the text to tmux stdin and resolves on a zero exit', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)

    const result = loadTmuxClipboard('hello tmux')
    expect(spawn).toHaveBeenCalledWith('tmux', ['load-buffer', '-w', '-'], {
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 3000,
    })
    expect(child.stdin.end).toHaveBeenCalledWith('hello tmux')
    child.emit('close', 0)

    await expect(result).resolves.toBe(true)
  })

  it('reports nonzero, process, stdin, and synchronous failures', async () => {
    const nonzero = fakeChild()
    vi.mocked(spawn).mockReturnValueOnce(nonzero as never)
    const nonzeroResult = loadTmuxClipboard('x')
    nonzero.emit('close', 1)
    await expect(nonzeroResult).resolves.toBe(false)

    const processError = fakeChild()
    vi.mocked(spawn).mockReturnValueOnce(processError as never)
    const processResult = loadTmuxClipboard('x')
    processError.emit('error', new Error('tmux missing'))
    processError.emit('close', null)
    await expect(processResult).resolves.toBe(false)

    const stdinError = fakeChild()
    vi.mocked(spawn).mockReturnValueOnce(stdinError as never)
    const stdinResult = loadTmuxClipboard('x')
    stdinError.stdin.emit('error', new Error('pipe closed'))
    await expect(stdinResult).resolves.toBe(false)

    vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('spawn failed') })
    await expect(loadTmuxClipboard('x')).resolves.toBe(false)

    const writeError = fakeChild(() => { throw new Error('write failed') })
    vi.mocked(spawn).mockReturnValueOnce(writeError as never)
    await expect(loadTmuxClipboard('x')).resolves.toBe(false)
  })
})

describe('copySelectionText', () => {
  it('uses direct OSC 52 outside tmux', async () => {
    const written: string[] = []
    await expect(copySelectionText('hi', { write: chunk => written.push(chunk) }, false)).resolves.toBe(true)
    expect(written).toEqual([buildClipboardOsc52('hi', false)])
  })

  it('reports a direct terminal write failure', async () => {
    await expect(copySelectionText('hi', { write: () => { throw new Error('closed') } }, false)).resolves.toBe(false)
  })

  it('uses tmux load-buffer instead of writing OSC 52 inside tmux', async () => {
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    const terminal = { write: vi.fn() }

    const result = copySelectionText('hi', terminal, true)
    child.emit('close', 0)

    await expect(result).resolves.toBe(true)
    expect(terminal.write).not.toHaveBeenCalled()
  })

  it('detects tmux from the environment by default', async () => {
    const savedTmux = process.env.TMUX
    const child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    try {
      process.env.TMUX = '/tmp/tmux-1000/default,123,0'
      const result = copySelectionText('hi', { write: vi.fn() })
      child.emit('close', 0)
      await expect(result).resolves.toBe(true)
    } finally {
      if (savedTmux === undefined) delete process.env.TMUX
      else process.env.TMUX = savedTmux
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
