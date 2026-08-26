/**
 * Alternate-screen ambient-output recovery ownership and write routing.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@earendil-works/pi-tui'
import { createOutputRecovery, type AmbientOutputStream } from '../src/output-recovery.ts'

class RecordingStream implements AmbientOutputStream {
  readonly chunks: string[] = []

  write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): boolean => {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
    if (typeof encodingOrCallback === 'function') encodingOrCallback()
    callback?.()
    return true
  }) as NodeJS.WriteStream['write']
}

describe('createOutputRecovery', () => {
  it('repaints after ambient writes but excludes renderer terminal writes', () => {
    const stdout = new RecordingStream()
    const stderr = new RecordingStream()
    const terminal = {
      write(data: string) { stdout.write(data) },
    } satisfies Pick<Terminal, 'write'>
    const originalTerminalWrite = terminal.write
    const originalStdoutWrite = stdout.write
    const originalStderrWrite = stderr.write
    const repaint = vi.fn()
    const recovery = createOutputRecovery(terminal, { stdout, stderr }, repaint)

    recovery.activate()
    recovery.activate()
    terminal.write('renderer frame')
    expect(repaint).not.toHaveBeenCalled()

    const callback = vi.fn()
    expect(stdout.write('host json', callback)).toBe(true)
    stderr.write(Buffer.from('host error'))
    expect(callback).toHaveBeenCalledOnce()
    expect(repaint).toHaveBeenCalledTimes(2)
    expect(stdout.chunks).toEqual(['renderer frame', 'host json'])
    expect(stderr.chunks).toEqual(['host error'])

    recovery.deactivate()
    recovery.deactivate()
    expect(terminal.write).toBe(originalTerminalWrite)
    expect(stdout.write).toBe(originalStdoutWrite)
    expect(stderr.write).toBe(originalStderrWrite)
    stdout.write('after release')
    expect(repaint).toHaveBeenCalledTimes(2)
  })

  it('does not overwrite a stream method replaced by another owner', () => {
    const stdout = new RecordingStream()
    const stderr = new RecordingStream()
    const terminal = { write: (_data: string) => {} } satisfies Pick<Terminal, 'write'>
    const recovery = createOutputRecovery(terminal, { stdout, stderr }, () => {})
    recovery.activate()
    const terminalReplacement = (_data: string): void => {}
    const stdoutReplacement = (() => true) as NodeJS.WriteStream['write']
    const stderrReplacement = (() => true) as NodeJS.WriteStream['write']
    terminal.write = terminalReplacement
    stdout.write = stdoutReplacement
    stderr.write = stderrReplacement

    recovery.deactivate()
    expect(terminal.write).toBe(terminalReplacement)
    expect(stdout.write).toBe(stdoutReplacement)
    expect(stderr.write).toBe(stderrReplacement)
  })

  it('releases renderer-write depth when the underlying terminal throws', () => {
    const stdout = new RecordingStream()
    const stderr = new RecordingStream()
    const terminal = {
      write: (_data: string) => { throw new Error('terminal failed') },
    } satisfies Pick<Terminal, 'write'>
    const repaint = vi.fn()
    const recovery = createOutputRecovery(terminal, { stdout, stderr }, repaint)
    recovery.activate()

    expect(() => terminal.write('frame')).toThrow('terminal failed')
    stdout.write('external after failure')
    expect(repaint).toHaveBeenCalledOnce()
    recovery.deactivate()
  })
})
