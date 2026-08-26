/**
 * Alternate-screen protection against writes that bypass the renderer.
 * Out-of-band stdout/stderr still reach the terminal, then a forced frame
 * restores cells around the renderer-owned hardware cursor.
 *
 * @module @dsh-blue/blue-core/output-recovery
 */

import type { Terminal } from '@earendil-works/pi-tui'

/** The writable face used by process stdout/stderr and source-plane fakes. */
export interface AmbientOutputStream {
  write: NodeJS.WriteStream['write']
}

/** Pair of process output streams guarded while alternate-screen owns them. */
export interface AmbientOutput {
  readonly stdout: AmbientOutputStream
  readonly stderr: AmbientOutputStream
}

/** Reversible ownership handle for alternate-screen output recovery. */
export interface OutputRecovery {
  /** Install the stream guards. Idempotent. */
  activate(): void
  /** Restore the original streams while the terminal is released. */
  deactivate(): void
}

/**
 * Guard ambient writes while preserving renderer-owned terminal writes.
 * External output is deliberately written first: command-line hosts retain
 * their stdout/stderr contract, and the forced repaint repairs the alternate
 * screen on the next tick.
 * @param terminal - renderer terminal whose writes must not trigger recovery.
 * @param output - ambient stdout/stderr streams shared by host plugins.
 * @param repaint - forced frame request after an out-of-band write.
 * @returns an idempotent activate/deactivate handle.
 */
export function createOutputRecovery(
  terminal: Pick<Terminal, 'write'>,
  output: AmbientOutput,
  repaint: () => void,
): OutputRecovery {
  const terminalWrite = terminal.write
  const stdoutWrite = output.stdout.write
  const stderrWrite = output.stderr.write
  let active = false
  let rendererWriteDepth = 0

  const guardedTerminalWrite: Terminal['write'] = function (data: string): void {
    rendererWriteDepth += 1
    try {
      terminalWrite.call(terminal, data)
    } finally {
      rendererWriteDepth -= 1
    }
  }

  const guard = (stream: AmbientOutputStream, original: NodeJS.WriteStream['write']): NodeJS.WriteStream['write'] => {
    return function (...args: Parameters<NodeJS.WriteStream['write']>): boolean {
      const written = Reflect.apply(original, stream, args) as boolean
      if (rendererWriteDepth === 0) repaint()
      return written
    } as NodeJS.WriteStream['write']
  }
  const guardedStdoutWrite = guard(output.stdout, stdoutWrite)
  const guardedStderrWrite = guard(output.stderr, stderrWrite)

  return {
    activate() {
      if (active) return
      active = true
      terminal.write = guardedTerminalWrite
      output.stdout.write = guardedStdoutWrite
      output.stderr.write = guardedStderrWrite
    },
    deactivate() {
      if (!active) return
      active = false
      if (terminal.write === guardedTerminalWrite) terminal.write = terminalWrite
      if (output.stdout.write === guardedStdoutWrite) output.stdout.write = stdoutWrite
      if (output.stderr.write === guardedStderrWrite) output.stderr.write = stderrWrite
    },
  }
}
