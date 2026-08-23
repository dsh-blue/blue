/**
 * Tests for the S26 clipboard write pipeline (`clipboard-write.ts`): the
 * default writer probing real platform tools through a PATH-injected fake
 * bin (the paste-image spec's pattern), the failure chain and its error
 * classification, and the injectable writer hook.
 */

import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clipboardToolsFor, copyTextToClipboard, setClipboardOsc52Emitter, setClipboardTextWriter } from '../src/clipboard-write.ts'
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

  let osc52Emitted: string[]

  beforeEach(() => {
    osc52Emitted = []
    // Records the call but declines, so the rejection tests below see the
    // plain tool failures; the osc52-fallback tests override with `true`.
    setClipboardOsc52Emitter(text => {
      osc52Emitted.push(text)
      return false
    })
  })

  afterEach(() => {
    process.env.PATH = savedPath
    setClipboardTextWriter(undefined)
    setClipboardOsc52Emitter(undefined)
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
    await expect(copyTextToClipboard('hello clipboard')).resolves.toBe('native')
    expect(readFileSync(join(wlCapture, 'copied.txt'), 'utf8')).toBe('hello clipboard')
    // The OSC 52 leg went out first (belt and suspenders, kimi's order).
    expect(osc52Emitted).toEqual(['hello clipboard'])
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

  it('rejects with the aggregate failure when both tools fail', async () => {
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n echo "no display" >&2\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow('no clipboard tool is available (wl-copy exited with code 1, xclip exited with code 2: no display)')
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects without a stderr tail when the failure carries none', async () => {
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow('no clipboard tool is available (wl-copy exited with code 1, xclip exited with code 2)')
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects with "not installed" when no tool exists on PATH', async () => {
    const empty = mkdtempTracked('blue-clipboard-empty-')
    process.env.PATH = empty
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow('no clipboard tool is available (wl-copy not installed, xclip not installed)')
    rmSync(empty, { recursive: true, force: true })
  })

  it('resolves the unverified osc52 method when every tool fails but the escape was emitted', async () => {
    setClipboardOsc52Emitter(text => {
      osc52Emitted.push(text)
      return true
    })
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('over ssh')).resolves.toBe('osc52')
    expect(osc52Emitted).toEqual(['over ssh'])
    rmSync(bin, { recursive: true, force: true })
  })

  it('rejects when the emitter declined (no TTY) and the tools failed', async () => {
    setClipboardOsc52Emitter(() => false)
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n exit 1\n',
      xclip: '#!/bin/sh\n exit 2\n',
    })
    prependBin(bin)
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow('no clipboard tool is available (wl-copy exited with code 1, xclip exited with code 2)')
    rmSync(bin, { recursive: true, force: true })
  })

  it('mixes an installed-but-failing tool with a missing one', async () => {
    const bin = fakeBin({
      wlCopy: '#!/bin/sh\n echo "wayland down" >&2\n exit 3\n',
      // No xclip script: replacing PATH outright (the scripts exec no
      // external commands) makes the second probe a true ENOENT — a
      // prepended bin would fall through to any real xclip on the host.
    })
    process.env.PATH = bin
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow('no clipboard tool is available (wl-copy exited with code 3: wayland down, xclip not installed)')
    rmSync(bin, { recursive: true, force: true })
  })

  it('classifies a spawn error with a code other than ENOENT as its raw message', async () => {
    const bin = mkdtempTracked('blue-clipboard-eacces-')
    // Present but not executable: spawn fails with EACCES, which carries a
    // `code` that is not ENOENT — the message survives verbatim. The PATH is
    // replaced outright (not prepended): libuv's PATH search skips entries
    // that fail with EACCES and keeps searching, so a prepended fake would
    // leak through to the machine's real wl-copy/xclip whenever they are
    // installed (observed 2026-08-22 after installing wl-clipboard).
    writeFileSync(join(bin, 'wl-copy'), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, 'wl-copy'), 0o644)
    const xclip = join(bin, 'xclip')
    writeFileSync(xclip, '#!/bin/sh\nexit 0\n')
    chmodSync(xclip, 0o644)
    // Replace PATH outright, not prepend: libuv's PATH scan skips the 644
    // (non-executable) candidates and falls through to any real wl-copy/
    // xclip further down PATH — a desktop host has both, so a prepended
    // bin turns the probe into the real tools (the "mixes" case below
    // documents the same trap). Neither script execs an external command,
    // so no PATH tail is needed.
    process.env.PATH = bin
    await expect(copyTextToClipboard('lost'))
      .rejects.toThrow(/no clipboard tool is available \(wl-copy spawn EACCES, xclip spawn EACCES\)|wl-copy EACCES/)
    rmSync(bin, { recursive: true, force: true })
  })
})

describe('copyTextToClipboard with an injected writer', () => {
  afterEach(() => {
    setClipboardTextWriter(undefined)
    setClipboardOsc52Emitter(undefined)
  })

  it('routes through the injected writer and restores the default', async () => {
    const received: string[] = []
    setClipboardTextWriter(async text => {
      received.push(text)
    })
    // Keep the default writer's osc52 leg quiet for this suite's asserts;
    // the emit-first ordering is covered in the default-writer suite.
    setClipboardOsc52Emitter(() => false)
    await expect(copyTextToClipboard('injected')).resolves.toBe('native')
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
    setClipboardOsc52Emitter(() => false)
    setClipboardTextWriter(async () => {
      throw new Error('clipboard daemon down')
    })
    await expect(copyTextToClipboard('x')).rejects.toThrow('clipboard daemon down')
  })

  it('returns osc52 when the injected writer fails and the emitter answered', async () => {
    setClipboardOsc52Emitter(() => true)
    setClipboardTextWriter(async () => {
      throw new Error('clipboard daemon down')
    })
    await expect(copyTextToClipboard('x')).resolves.toBe('osc52')
  })
})
