/**
 * OSC 11 background probe (reply/timeout/parse-failure paths, raw-mode and
 * listener restore), luminance classification, and the `blueTerminalInfo`
 * service snapshot.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BlueTerminalInfoService,
  backgroundFromRgb,
  probeTerminalBackground,
  type BlueProbeProcess,
} from '../src/terminal-info.ts'

interface FakeProc {
  proc: BlueProbeProcess
  rawModes: boolean[]
  written: string[]
  reply(data: string): void
  listenerCount(): number
}

/** A recording BlueProbeProcess; `reply` simulates terminal answers. */
function fakeProc(options?: { rawMode?: boolean }): FakeProc {
  const listeners = new Set<(data: Buffer) => void>()
  const rawModes: boolean[] = []
  const written: string[] = []
  const stdin: BlueProbeProcess['stdin'] = {
    on: (_event, listener) => {
      listeners.add(listener)
    },
    removeListener: (_event, listener) => {
      listeners.delete(listener)
    },
  }
  if (options?.rawMode !== false) {
    stdin.setRawMode = (raw) => {
      rawModes.push(raw)
    }
  }
  return {
    proc: { stdin, stdout: { write: data => written.push(data) } },
    rawModes,
    written,
    reply(data) {
      for (const listener of listeners) listener(Buffer.from(data, 'utf8'))
    },
    listenerCount: () => listeners.size,
  }
}

describe('probeTerminalBackground', () => {
  it('resolves the parsed color when the terminal replies', async () => {
    const fake = fakeProc()
    const probe = probeTerminalBackground(fake.proc, 1000)
    expect(fake.written).toEqual(['\x1b]11;?\x07'])
    expect(fake.rawModes).toEqual([true])
    fake.reply('\x1b]11;rgb:ffff/ffff/ffff\x07\x1b\\')
    await expect(probe).resolves.toEqual({ r: 255, g: 255, b: 255 })
    expect(fake.rawModes).toEqual([true, false])
    expect(fake.listenerCount()).toBe(0)
  })

  it('waits for the terminator when the reply arrives split across chunks', async () => {
    const fake = fakeProc()
    const probe = probeTerminalBackground(fake.proc, 1000)
    fake.reply('noise')
    fake.reply('\x1b]11;rgb:0000/')
    fake.reply('0000/0000\x07')
    await expect(probe).resolves.toEqual({ r: 0, g: 0, b: 0 })
  })

  it('accepts an ST-terminated hex reply', async () => {
    const fake = fakeProc()
    const probe = probeTerminalBackground(fake.proc, 1000)
    fake.reply('\x1b]11;#102030')
    fake.reply('\x1b\\')
    await expect(probe).resolves.toEqual({ r: 16, g: 32, b: 48 })
  })

  it('resolves undefined when the reply fails to parse', async () => {
    const fake = fakeProc()
    const probe = probeTerminalBackground(fake.proc, 1000)
    fake.reply('\x1b]11;not-a-color\x07')
    await expect(probe).resolves.toBeUndefined()
    expect(fake.rawModes).toEqual([true, false])
    expect(fake.listenerCount()).toBe(0)
  })

  it('resolves undefined on timeout and restores the terminal state', async () => {
    const fake = fakeProc()
    await expect(probeTerminalBackground(fake.proc, 10)).resolves.toBeUndefined()
    expect(fake.rawModes).toEqual([true, false])
    expect(fake.listenerCount()).toBe(0)
  })

  it('settles once: a late reply after the timeout is ignored', async () => {
    const fake = fakeProc()
    const probe = probeTerminalBackground(fake.proc, 10)
    await expect(probe).resolves.toBeUndefined()
    fake.reply('\x1b]11;#ffffff\x07')
    await expect(probe).resolves.toBeUndefined()
  })

  it('works without raw-mode support (non-TTY stdin)', async () => {
    const fake = fakeProc({ rawMode: false })
    const probe = probeTerminalBackground(fake.proc, 1000)
    fake.reply('\x1b]11;#000000\x07')
    await expect(probe).resolves.toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('backgroundFromRgb', () => {
  it('classifies by relative luminance against the mid-gray threshold', () => {
    expect(backgroundFromRgb({ r: 0, g: 0, b: 0 })).toBe('dark')
    expect(backgroundFromRgb({ r: 255, g: 255, b: 255 })).toBe('light')
    expect(backgroundFromRgb({ r: 127, g: 127, b: 127 })).toBe('dark')
    expect(backgroundFromRgb({ r: 128, g: 128, b: 128 })).toBe('light')
    expect(backgroundFromRgb(undefined)).toBeUndefined()
  })
})

describe('BlueTerminalInfoService', () => {
  it('registers a frozen fact snapshot and unregisters with the fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(BlueTerminalInfoService, { background: 'light', kittyKeyboard: true })
    await fiber
    const info = ctx.blueTerminalInfo
    expect(info).toBeInstanceOf(BlueTerminalInfoService)
    expect(info.background).toBe('light')
    expect(info.kittyKeyboard).toBe(true)
    expect(Object.isFrozen(info)).toBe(true)
    await fiber.dispose()
    expect(ctx.get('blueTerminalInfo')).toBeUndefined()
  })
})
