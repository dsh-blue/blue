/**
 * Tracked temp directories for specs (the 2026-08-20 /tmp inode fix): the
 * suites boot real harness session stores and profile fixtures inside
 * mkdtemp roots, and one full run without cleanup leaks every one of them —
 * a tmpfs filled to its inode cap within days of daily test runs.
 * `mkdtempTracked` registers each root it creates; a spec file opts into
 * eager cleanup with `registerTempDirCleanup()` (an afterAll), and a
 * process-exit hook sweeps whatever a run abandoned mid-file. Only a kill
 * -9 leaks, bounded to that run's directories.
 *
 * The canonical copy lives in core's tests (the repo's per-package test
 * doubles stay self-contained; this one is shared verbatim by relative
 * import, the same cross-package pattern the bundle e2e uses).
 *
 * @module blue-core-tests/temp-dir
 */

import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

/** Roots created this worker has not yet removed. */
const tracked = new Set<string>()
/** Whether the exit-hook safety net is installed (once per worker). */
let exitHookInstalled = false

/**
 * Reopen permission-stripped directories before removal: specs chmod a
 * `locked` fixture to 0o000, and the recursive rmSync cannot even list it.
 * The walk chmods each directory before descending (reading a directory
 * needs r+x); symlinks are never followed.
 * @param root - the tracked root to unlock.
 */
function unlockTree(root: string): void {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() ?? ''
    try {
      chmodSync(dir, 0o700)
    } catch {
      continue
    }
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(join(dir, entry.name))
    }
  }
}

/** Best-effort recursive removal of every tracked root. */
function removeTracked(): void {
  for (const dir of tracked) {
    try {
      unlockTree(dir)
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Best effort: a busy file leaks rather than fails the run.
    }
  }
  tracked.clear()
}

/**
 * Opt the current spec file into eager cleanup: removes the file's tracked
 * roots in an afterAll. The process-exit hook is installed regardless, so
 * a spec that forgets this call still leaks nothing past the worker's exit.
 */
export function registerTempDirCleanup(): void {
  afterAll(() => {
    removeTracked()
  })
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', removeTracked)
  }
}

/**
 * Create a tracked temp root: `mkdtempSync(join(tmpdir(), prefix))` that
 * registers itself for removal.
 * @param prefix - the tmpdir prefix, conventionally ending in a dash.
 * @returns the absolute path of the new root.
 */
export function mkdtempTracked(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tracked.add(dir)
  return dir
}
