/**
 * The shell's process seams: every side effect the launcher performs —
 * probing the global host, reading the profile and the shell's own
 * manifest, spawning the calibration install and the booted child,
 * writing output, exiting — goes through the `cliInternals` object, the
 * `internals` seam pattern `@deepseek-ai/dsh-cmdline` established and the
 * updater family (D52) reused. The per-file coverage gate makes the seam
 * load-bearing: specs replace a field, drive a branch, restore it.
 *
 * Two spawn shapes exist because the two uses differ: a one-shot capture
 * (the calibration install — its output is translated into a one-line
 * verdict, never streamed) and an inherit child (the booted dsh — it owns
 * the TTY for the whole session, so no timeout ladder applies; the
 * session's lifetime is the child's business, not the shell's).
 *
 * @module @dsh-blue/blue-cli/internals
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'

/** Options every spawn shape accepts. */
export interface SpawnOptions {
  /** Working directory for the child. */
  cwd?: string
  /** Extra environment entries layered over the process environment. */
  env?: Record<string, string>
  /** Hard deadline for the one-shot shape; on expiry the child gets SIGTERM, then SIGKILL. */
  timeoutMs?: number
  /** Grace between SIGTERM and SIGKILL (default 5s; tests tighten it). */
  killGraceMs?: number
}

/** The outcome of a spawn, whatever way it ended. */
export interface SpawnOutcome {
  /** Exit code, or `null` when the child died to a signal. */
  code: number | null
  /** Terminating signal, when there was one. */
  signal: string | null
  /** Captured stdout (one-shot shape) or `''` (inherit shape). */
  stdout: string
  /** Captured stderr (one-shot shape) or `''` (inherit shape). */
  stderr: string
  /** Whether the timeout ladder killed the child (one-shot shape). */
  timedOut: boolean
  /** Spawn failure (e.g. ENOENT for a missing binary); success leaves it unset. */
  spawnError?: string
}

/** The shell's process seams; specs replace fields and restore them. */
export interface CliInternals {
  /** The process environment (`DSH_HOME` is read here). */
  env: Record<string, string | undefined>
  /** The running Node binary. */
  execPath: string
  /** The process platform — the win32 branches are seam-tested (CI runs ubuntu only). */
  platform: string
  /** The user's home directory. */
  homedir(): string
  /** Read a UTF-8 file, `undefined` when missing or unreadable. */
  readTextFile(path: string): string | undefined
  /** Spawn, capture both pipes, enforce the kill ladder on timeout. */
  spawnOnce(cmd: string, args: readonly string[], opts?: SpawnOptions): Promise<SpawnOutcome>
  /** Spawn with inherited stdio and no deadline; resolves on child exit. */
  spawnInherit(cmd: string, args: readonly string[], opts?: SpawnOptions): Promise<SpawnOutcome>
  /** Write to the shell's stdout. */
  stdout(text: string): void
  /** Write to the shell's stderr. */
  stderr(text: string): void
  /** Exit the process (the seam keeps `main` testable). */
  exit(code: number): void
}

/** Layer child env entries over the process environment. */
function childEnv(extra: Record<string, string> | undefined): Record<string, string | undefined> | undefined {
  if (extra === undefined) return undefined
  return { ...process.env, ...extra }
}

/** The default SIGTERM→SIGKILL grace (the install scripts' posture). */
const DEFAULT_KILL_GRACE_MS = 5000

/** The default seam bindings: the real process. */
export const cliInternals: CliInternals = {
  env: process.env,
  execPath: process.execPath,
  platform: process.platform,
  homedir: osHomedir,
  readTextFile(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  spawnOnce(cmd, args, opts = {}) {
    const graceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
    return new Promise(resolve => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(cmd, args, { cwd: opts.cwd, env: childEnv(opts.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: String(error) })
        return
      }
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let killTimer: ReturnType<typeof setTimeout> | undefined
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      child.stdout?.on('data', chunk => { stdout += String(chunk) })
      child.stderr?.on('data', chunk => { stderr += String(chunk) })
      const clearTimers = (): void => {
        if (killTimer !== undefined) clearTimeout(killTimer)
        if (graceTimer !== undefined) clearTimeout(graceTimer)
      }
      if (opts.timeoutMs !== undefined) {
        killTimer = setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          graceTimer = setTimeout(() => child.kill('SIGKILL'), graceMs)
        }, opts.timeoutMs)
      }
      child.on('error', error => {
        clearTimers()
        resolve({ code: null, signal: null, stdout, stderr, timedOut, spawnError: String(error) })
      })
      child.on('close', (code, signal) => {
        clearTimers()
        resolve({ code, signal, stdout, stderr: timedOut ? `${stderr}\nblue: install timed out` : stderr, timedOut })
      })
    })
  },
  spawnInherit(cmd, args, opts = {}) {
    return new Promise(resolve => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(cmd, args, { cwd: opts.cwd, env: childEnv(opts.env), stdio: 'inherit', windowsHide: true })
      } catch (error) {
        resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: String(error) })
        return
      }
      child.on('error', error => {
        resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: String(error) })
      })
      child.on('close', (code, signal) => {
        resolve({ code, signal, stdout: '', stderr: '', timedOut: false })
      })
    })
  },
  // Direct references, not wrappers: the seam stays patchable while the
  // default bindings carry no body of their own to cover — a default
  // `exit` wrapper could never run under vitest without killing the run.
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
  exit: process.exit,
}
