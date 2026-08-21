/**
 * Tests for the S26 clipboard write pipeline (`clipboard-write.ts`): the
 * default writer probing real platform tools through a PATH-injected fake
 * bin (the paste-image spec's pattern), the failure chain and its error
 * classification, and the injectable writer hook.
 */

import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clipboardToolsFor, copyTextToClipboard, setClipboardTextWriter } from '../src/clipboard-write.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()

describe('clipboardToolsFor', () => {
  it('lists the platform tools in probe order', () => {
    expect(clipboardToolsFor('linux')).toEqual([
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
    ])
    expect(clipboardToolsFor('darwin')).toEqual([['pbcopy', []]])
    expect(clipboardToolsFor('win32')).toEqual([['clip.exe', []]])
    // Any other platform falls back to the Linux pair.
    expect(clipboardToolsFor('freebsd' as NodeJS.Platform)).toEqual([
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
    ])
  })
})

describe('default clipboard text writer', () => {
  const savedPath = process.env.PATH

  afterEach(() => {
    process.env.PATH = savedPath
    setClipboardTextWriter(undefined)
  })

  /**
   * Put the fake bin ahead of the real PATH: the tool scripts call `cat`,
   * which resolves through the child's PATH snapshot (the paste-image
   * pattern uses only shell builtins, so it can replace PATH outright).
   */
  function prependBin(bin: string): void {
    process.env.PATH = `${bin}:${savedPath}`
  }

  /** A fake bin with `wl-copy` and `xclip` scripts capturing stdin to files. */
  function fakeBin(opts: {
    wlCopy?: string
    xclip?: string
  }): string {
    const bin = mkdtempTracked('blue-clipboard-bin-')
    const wlCopy = opts.wlCopy
    if (wlCopy !== undefined) {
      writeFileSync(join(bin, 'wl-copy'), wlCopy)
      chmodSync(join(bin, 'wl-copy'), 0o755)
    }
    const xclip = opts.xclip
    if (xclip !== undefined) {
      writeFileSync(join(bin, 'xclip'), xclip)
      chmodSync(join(bin, 'xclip'), 0o755)
    }
    return bin
  }

  /** A tool script that captures stdin into `$CAPTURE` and exits `$CODE`. */
  function captureScript(envFile: string): string {
    return `#!/bin/sh\ncat > ${envFile}\nexit 0\n`
  }

  it('probes wl-copy then xclip through the real tools', async () => {
    const wlCapture = mkdtempTracked('blue-clipboard-wl-')
    const bin = fakeBin({
      wlCopy: captureScript(join(wlCapture, 'copied.txt')),
      xclip: captureScript(join(mkdtempTracked('blue-clipboard-xc-'), 'copied.txt')),
    })
    prependBin(bin)
    await copyTextToClipboard('hello clipboard')
    expect(readFileSync(join(wlCapture, 'copied.txt'), 'utf8')).toBe('hello clipboard')
    rmSync(bin, { recursive: true, force: true })
  })

  it('falls back to xclip when wl-copy fails with a message', async () => {
    const xcCapture = mkdtempTracked('blue-clipboard-xc-')
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n echo "wayland gone" >&2\n exit 3\n',
      xclip: captureScript(join(xcCapture, 'copied.txt')),
    })
    prependBin(bin)
    await copyTextToClipboard('via xclip')
    expect(readFileSync(join(xcCapture, 'copied.txt'), 'utf8')).toBe('via xclip')
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects with the last tool failure when both tools fail', async () => {
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n echo "no display" >&2\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('lost')).rejects.toThrow('xclip exited with code 2: no display')
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects without a stderr tail when the failure carries none', async () => {
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('lost')).rejects.toThrow('xclip exited with code 2')
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects with the spawn error when no tool exists on PATH', async () => {
    const empty = mkdtempTracked('blue-clipboard-empty-')
    process.env.PATH = empty
    await expect(copyTextToClipboard('lost')).rejects.toBeInstanceOf(Error)
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('copyTextToClipboard with an injected writer', () => {
  afterEach(() => {
    setClipboardTextWriter(undefined)
  })

  it('routes through the injected writer and restores the default', async () => {
    const received: string[] = []
    setClipboardTextWriter(async text => {
      received.push(text)
    })
    await copyTextToClipboard('injected')
    expect(received).toEqual(['injected'])
    // Restoring the default makes the next call probe the real tools again;
    // with an empty PATH that now fails loud instead of reaching the fake.
    setClipboardTextWriter(undefined)
    const empty = mkdtempTracked('blue-clipboard-restore-')
    process.env.PATH = empty
    await expect(copyTextToClipboard('real')).rejects.toBeInstanceOf(Error)
    rmSync(empty, { recursive: true, force: true })
  })

  it('propagates the injected writer failure', async () => {
    setClipboardTextWriter(async () => {
      throw new Error('clipboard daemon down')
    })
    await expect(copyTextToClipboard('x')).rejects.toThrow('clipboard daemon down')
  })
})
