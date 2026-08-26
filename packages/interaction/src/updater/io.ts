/**
 * The updater's process seams (D52): every side effect the update family
 * performs — subprocesses, registry fetches, filesystem reads, clocks,
 * environment — goes through the `updaterInternals` object, the
 * `internals` seam pattern `@deepseek-ai/dsh-cmdline` established. The
 * per-file coverage gate makes the seam load-bearing: specs replace a
 * field, drive a branch, restore it. Two spawn shapes exist because the
 * two uses differ: a one-shot capture (version probes, installs, the
 * import sweep) and an interactive child whose output streams while the
 * caller still writes stdin (the pipe-stdio boot smoke, which must send
 * `/quit` only after the boot marker appears).
 *
 * @module @dsh-blue/blue-interaction/updater/io
 */

import { spawn } from 'node:child_process'
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir as osHomedir } from 'node:os'
import { dirname } from 'node:path'

/** Options every spawn shape accepts. */
export interface SpawnOptions {
  /** Working directory for the child. */
  cwd?: string
  /** Extra environment entries layered over the process environment. */
  env?: Record<string, string>
  /** Hard deadline; on expiry the child gets SIGTERM, then SIGKILL. */
  timeoutMs?: number
  /** Grace between SIGTERM and SIGKILL (default 5s; tests tighten it). */
  killGraceMs?: number
  /** Input written to stdin immediately after spawn. */
  input?: string
}

/** The outcome of a one-shot spawn, whatever way it ended. */
export interface SpawnOutcome {
  /** Exit code, or `null` when the child died to a signal. */
  code: number | null
  /** Terminating signal, when there was one. */
  signal: string | null
  /** Captured stdout. */
  stdout: string
  /** Captured stderr. */
  stderr: string
  /** Whether the timeout ladder killed the child. */
  timedOut: boolean
  /** Spawn failure (e.g. ENOENT for a missing binary); success leaves it unset. */
  spawnError?: string
}

/** An interactive child: streamed output, live stdin, caller-owned deadline. */
export interface InteractiveChild {
  /** Write to the child's stdin. */
  write(data: string): void
  /** Output accumulated so far (raw stdout then stderr appended). */
  output(): string
  /** Resolves exactly once when the child exits, however it exits. */
  exited: Promise<SpawnOutcome>
  /** SIGTERM now, SIGKILL after the grace; safe to call after exit. */
  kill(): void
}

/** The default SIGTERM→SIGKILL grace, matching install-dev.sh's posture. */
const DEFAULT_KILL_GRACE_MS = 5000

/** Layer child env entries over the process environment. */
function childEnv(extra: Record<string, string> | undefined): Record<string, string | undefined> | undefined {
  if (extra === undefined) return undefined
  return { ...process.env, ...extra }
}

/** Spawn, capture both pipes, feed optional stdin, enforce the kill ladder. */
function defaultSpawnOnce(cmd: string, args: readonly string[], opts: SpawnOptions = {}): Promise<SpawnOutcome> {
  const graceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: childEnv(opts.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const outcome: SpawnOutcome = { code: null, signal: null, stdout: '', stderr: '', timedOut: false }
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      if (killTimer !== undefined) clearTimeout(killTimer)
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      resolve(outcome)
    }
    child.stdout?.on('data', chunk => {
      outcome.stdout += String(chunk)
    })
    child.stderr?.on('data', chunk => {
      outcome.stderr += String(chunk)
    })
    child.on('error', error => {
      outcome.spawnError = error.message
      finish()
    })
    child.on('close', (code, signal) => {
      outcome.code = code
      outcome.signal = signal
      finish()
    })
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input)
      child.stdin?.end()
    }
    if (opts.timeoutMs !== undefined) {
      killTimer = setTimeout(() => {
        outcome.timedOut = true
        child.kill('SIGTERM')
        graceTimer = setTimeout(() => child.kill('SIGKILL'), graceMs)
      }, opts.timeoutMs)
    }
  })
}

/** Spawn with live pipes the boot smoke drives interactively. */
function defaultSpawnInteractive(cmd: string, args: readonly string[], opts: SpawnOptions = {}): InteractiveChild {
  const graceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: childEnv(opts.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  let settled = false
  const outcome: SpawnOutcome = { code: null, signal: null, stdout: '', stderr: '', timedOut: false }
  const exited = new Promise<SpawnOutcome>(resolve => {
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    child.stdout?.on('data', chunk => {
      const text = String(chunk)
      output += text
      outcome.stdout += text
    })
    child.stderr?.on('data', chunk => {
      const text = String(chunk)
      output += text
      outcome.stderr += text
    })
    child.on('error', error => {
      outcome.spawnError = error.message
      finish()
    })
    child.on('close', (code, signal) => {
      outcome.code = code
      outcome.signal = signal
      finish()
    })
  })
  return {
    write: data => {
      child.stdin?.write(data)
    },
    output: () => output,
    exited,
    kill: () => {
      outcome.timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), graceMs)
    },
  }
}

/** Fetch a URL as text, rejecting on any non-OK answer or timeout. */
async function defaultFetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  return response.text()
}

/** The process seams. Specs replace fields and restore them after. */
export const updaterInternals = {
  /** One-shot captured spawn. */
  spawnOnce: defaultSpawnOnce,
  /** Interactive spawn for the boot smoke. */
  spawnInteractive: defaultSpawnInteractive,
  /** HTTP GET as text; rejects on failure. */
  fetchText: defaultFetchText,
  /** Delay; specs substitute an instant resolve. */
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
  /** Wall clock in milliseconds. */
  now: (): number => Date.now(),
  /** Read a text file, `undefined` when missing (never throws). */
  readTextFile: (path: string): string | undefined => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return undefined
    }
  },
  /** Write a text file, creating parent directories. */
  writeTextFile: (path: string, data: string): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, data)
  },
  /** Append to a text file, creating parent directories. */
  appendTextFile: (path: string, data: string): void => {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, data)
  },
  /** Copy a file (overwrite allowed), creating the target's directory. */
  copyFile: (from: string, to: string): void => {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  },
  /** Create a directory (and parents). */
  ensureDir: (path: string): void => {
    mkdirSync(path, { recursive: true })
  },
  /** List a directory, `undefined` when missing. */
  listDir: (path: string): string[] | undefined => {
    try {
      return readdirSync(path)
    } catch {
      return undefined
    }
  },
  /** Remove a file; absent is a no-op. */
  removeFile: (path: string): void => {
    rmSync(path, { force: true })
  },
  /** Remove a directory tree; absent is a no-op. */
  removeDir: (path: string): void => {
    rmSync(path, { recursive: true, force: true })
  },
  /** Rename (move) a file or directory. */
  rename: (from: string, to: string): void => {
    renameSync(from, to)
  },
  /** The home directory (seamed for profile-root tests). */
  homedir: (): string => osHomedir(),
  /** The environment the updater reads (`DSH_BIN`, `DSH_HOME`). */
  env: process.env,
}

/**
 * Strip writer-level control wrappers and ANSI so marker matching reads
 * rows (the smoke-lib `cleanOutput` contract, ported for the boot smoke).
 * @param value - raw terminal output.
 * @returns the cleaned text.
 */
export function cleanOutput(value: string): string {
  return value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\]8;;[^\x07]*\x07/g, '')
    .replace(/\r/g, '')
}

