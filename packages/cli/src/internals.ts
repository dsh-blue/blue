/**
 * The shell's process seams: every side effect the launcher performs —
 * resolving the nested host, reading the profile and the shell's own
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
import { createHash } from 'node:crypto'
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir as osHomedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

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

/** The outcome of one creative-preset tree sync (S39). */
export type PresetSyncResult = 'fresh' | 'synced' | { error: string }

/** The shell's process seams; specs replace fields and restore them. */
export interface CliInternals {
  /** The process environment (`DSH_HOME` is read here). */
  env: Record<string, string | undefined>
  /** The running Node binary (children run `node <entry>`). */
  execPath: string
  /** The process platform — the win32 branches are seam-tested (CI runs ubuntu only). */
  platform: string
  /** The user's home directory. */
  homedir(): string
  /** Read a UTF-8 file, `undefined` when missing or unreadable. */
  readTextFile(path: string): string | undefined
  /**
   * Resolve the nested `@deepseek-ai/dsh` manifest (the D50 decision-4
   * plan-A host — pinned as this package's own dependency, never PATH
   * discovery), `undefined` when the install is broken.
   */
  resolveNestedDshManifest(): string | undefined
  /**
   * Sync a preset payload tree over a target directory (the S39 creative
   * preset over the nested host's shipped `cordis`): skip when the stamp
   * file beside the target already matches the payload's content hash,
   * otherwise replace the tree wholesale (clearing files the payload no
   * longer carries) and rewrite the stamp. Any filesystem failure comes
   * back as `{ error }` — the caller degrades, never refuses the boot.
   */
  syncPresetTree(sourceDir: string, targetDir: string, stamp: string): PresetSyncResult
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

/**
 * Resolve one package manifest from this module's resolution roots,
 * `undefined` when the specifier resolves nowhere. The default
 * `resolveNestedDshManifest` seam delegates here; the helper takes the
 * specifier so the failure branch is drivable.
 */
export function resolvePackageManifest(specifier: string): string | undefined {
  try {
    return createRequire(import.meta.url).resolve(specifier)
  } catch {
    return undefined
  }
}

/** The stamp filename beside a synced preset tree (S39). */
const PRESET_STAMP = '.blue-cordis.stamp'

/**
 * Hash one payload tree: the caller's stamp string, then every file's
 * relative path and content in sorted order. Throws when the source cannot
 * be walked — the sync's `{ error }` branch.
 */
function hashPresetTree(sourceDir: string, stamp: string): string {
  const digest = createHash('sha256')
  digest.update(stamp)
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
      } else {
        digest.update(relative(sourceDir, path))
        digest.update(readFileSync(path))
      }
    }
  }
  walk(sourceDir)
  return digest.digest('hex')
}

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
  resolveNestedDshManifest(): string | undefined {
    return resolvePackageManifest('@deepseek-ai/dsh/package.json')
  },
  syncPresetTree(sourceDir, targetDir, stamp): PresetSyncResult {
    try {
      const want = hashPresetTree(sourceDir, stamp)
      const stampPath = join(dirname(targetDir), PRESET_STAMP)
      let current: string | undefined
      try {
        current = readFileSync(stampPath, 'utf8')
      } catch {
        current = undefined
      }
      if (current === want) return 'fresh'
      rmSync(targetDir, { recursive: true, force: true })
      cpSync(sourceDir, targetDir, { recursive: true })
      writeFileSync(stampPath, want)
      return 'synced'
    } catch (error) {
      // node fs failures are always Error instances; the String half is the
      // defensive form for a foreign throw.
      return { error: error instanceof Error ? error.message : /* v8 ignore next */ String(error) }
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

