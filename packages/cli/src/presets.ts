/**
 * The creative-preset overlay (S39): Blue ships its own retargeted `cordis`
 * preset (packages/cli/presets/cordis/ — same id, same display name, Blue
 * authoring guidance instead of the browser-client one) and syncs it over
 * the NESTED host's shipped copy at every boot. The nested host is the
 * shell's own pinned dependency, so the overwrite can never touch another
 * dsh installation on the machine — the Web deployment's creative mode is
 * a different physical tree. Config-based shadowing is impossible by
 * upstream design: the dsh launcher overwrites the roster's `roots` with
 * the shipped root as its final overlay, and the shared user root both
 * sorts after it and leaks into every profile on the machine.
 *
 * The roster's discovery re-reads its roots on every call and a changed
 * composition simply opens a new generation for future sessions, so a
 * pre-boot file sync races nothing. A failed sync (a root-owned global
 * prefix) degrades to the host's shipped creative mode for that boot —
 * the warning line says so — and a nested-host reinstall self-heals on
 * the next boot.
 *
 * @module @dsh-blue/blue-cli/presets
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cliInternals, type PresetSyncResult } from './internals.ts'

/**
 * Sync Blue's creative-mode payload over the nested host's shipped `cordis`
 * preset, idempotently (the stamp inside `syncPresetTree` skips a tree that
 * already carries this version's payload).
 * @param version - the shell's own version — the stamp's human half, so a
 *   shell upgrade re-syncs even over an identical-looking tree.
 * @returns the sync outcome; `{ error }` never refuses the boot.
 */
export function syncCreativePreset(version: string): PresetSyncResult {
  const manifestPath = cliInternals.resolveNestedDshManifest()
  if (manifestPath === undefined) return { error: 'the pinned @deepseek-ai/dsh host is missing' }
  // src/ and lib/ both sit one level under the package root, so the payload
  // resolves identically in the source plane (specs) and the packed shell.
  const sourceDir = fileURLToPath(new URL('../presets/cordis/', import.meta.url))
  const targetDir = join(dirname(manifestPath), 'config', 'agent-presets', 'cordis')
  return cliInternals.syncPresetTree(sourceDir, targetDir, `blue-cli ${version}`)
}
