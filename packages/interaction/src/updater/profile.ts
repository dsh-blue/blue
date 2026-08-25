/**
 * Profile facts and snapshots for the updater (D52): a dsh profile is a
 * self-contained pnpm workspace under `$DSH_HOME/profiles/<name>` —
 * package.json, pnpm-lock.yaml, cordis.patch.yml, node_modules. The
 * updater reads its facts (which specs, which versions, any `link:`
 * pollution), snapshots the three manifest files before a swap, and
 * restores them on rollback. The profile *name* is a launcher-level
 * flag the app tree cannot see through `cmdlineArgs` (it carries only
 * the inner arguments), so — exactly like the exit epitaph — the
 * updater scans `process.argv` itself; the app package cannot share its
 * copy without a new exports subpath, and adding one is the S30
 * incident family.
 *
 * @module @dsh-blue/blue-interaction/updater/profile
 */

import { join } from 'node:path'
import { updaterInternals } from './io.ts'

/** The profile manifest files a snapshot preserves. */
const SNAPSHOT_FILES = ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml'] as const

/** The backup directory inside the profile (dies with `rm -rf` of it). */
export const BACKUP_DIRNAME = '.blue-update-backup'

/** What the updater needs to know about an installed profile. */
export interface ProfileFacts {
  /** The parsed profile package.json, `undefined` when missing/broken. */
  readonly manifest: Readonly<Record<string, unknown>> | undefined
  /** Dependency/devDependency specs by package name. */
  readonly specs: Readonly<Record<string, string>>
  /** Installed version by package name; absent when not installed. */
  readonly installed: Readonly<Record<string, string | undefined>>
  /** Package names whose spec is a `link:`/`file:` lane violation. */
  readonly linked: readonly string[]
}

/**
 * The profile name the launcher flags name — the same scan the exit
 * epitaph performs (`packages/app/src/exit-epitaph.ts`); a private copy
 * by design, see the module header.
 * @param argv - the process arguments (launcher flags stay in place).
 * @returns the profile, defaulting to `blue`.
 */
export function profileNameFromArgv(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg !== undefined && arg.startsWith('--profile=')) return arg.slice('--profile='.length)
    if (arg === '--profile') {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-')) return next
    }
  }
  return 'blue'
}

/** `$DSH_HOME` (default `~/.dsh`) — the attachments module's resolution. */
export function dshHome(): string {
  const home = updaterInternals.env.DSH_HOME
  return home !== undefined && home !== '' ? home : join(updaterInternals.homedir(), '.dsh')
}

/** The profile workspace root. */
export function profileRoot(profile: string): string {
  return join(dshHome(), 'profiles', profile)
}

/**
 * Resolve the dsh CLI binary: `$DSH_BIN`, else the first `dsh` on PATH
 * (the smoke scripts' discovery order, minus the workspace branch a user
 * install never has).
 * @returns the binary path, or `undefined` when neither resolves.
 */
export async function findDshBin(): Promise<string | undefined> {
  const fromEnv = updaterInternals.env.DSH_BIN
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const outcome = await updaterInternals.spawnOnce('sh', ['-c', 'command -v dsh'], {
    timeoutMs: 5_000,
  })
  if (outcome.spawnError !== undefined || outcome.code !== 0) return undefined
  const path = outcome.stdout.trim()
  return path === '' ? undefined : path
}

/**
 * Read a profile's facts: manifest, specs, installed versions, and the
 * lane violations. Missing files read as absent — pre-flight turns each
 * shape into a verdict.
 * @param root - the profile workspace root.
 * @returns the profile facts.
 */
export function readProfileFacts(root: string): ProfileFacts {
  const manifestText = updaterInternals.readTextFile(join(root, 'package.json'))
  let manifest: Record<string, unknown> | undefined
  let specs: Record<string, string> = {}
  const linked: string[] = []
  if (manifestText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(manifestText)
      if (typeof parsed === 'object' && parsed !== null) {
        manifest = parsed as Record<string, unknown>
        for (const key of ['dependencies', 'devDependencies'] as const) {
          const block = manifest[key]
          if (typeof block !== 'object' || block === null) continue
          for (const [name, spec] of Object.entries(block as Record<string, unknown>)) {
            if (typeof spec !== 'string') continue
            specs = { ...specs, [name]: spec }
            if (/^(link|file):/.test(spec)) linked.push(name)
          }
        }
      }
    } catch {
      manifest = undefined
    }
  }
  // The installed set is discovered, not hardcoded: releases grow the
  // set (rc.2 shipped five packages, blue-api joins later), and the
  // consistency gates judge against the target release's own set.
  const installed: Record<string, string | undefined> = {}
  const scope = join(root, 'node_modules', '@dsh-blue')
  for (const entry of updaterInternals.listDir(scope) ?? []) {
    installed[`@dsh-blue/${entry}`] = readInstalledVersion(join(scope, entry, 'package.json'))
  }
  return { manifest, specs, installed, linked }
}

/** Read one installed package's version through the fs seam. */
function readInstalledVersion(manifestPath: string): string | undefined {
  const text = updaterInternals.readTextFile(manifestPath)
  if (text === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const version = (parsed as Record<string, unknown>).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/** The snapshot's bookkeeping, written beside the preserved files. */
export interface SnapshotManifest {
  /** The version the profile ran before the swap. */
  readonly fromVersion: string
  /** The version the swap attempted. */
  readonly toVersion: string
  /** When the snapshot was taken, epoch milliseconds. */
  readonly createdAt: number
  /** Which of the manifest files existed and were preserved. */
  readonly files: readonly string[]
}

/** Where a profile's update backup lives. */
export function backupDir(root: string): string {
  return join(root, BACKUP_DIRNAME)
}

/**
 * Snapshot the profile's manifest files into `.blue-update-backup/`
 * (overwriting any previous snapshot — one slot, the newest), recording
 * the swap intent beside them. The write is atomic by construction: the
 * snapshot assembles in a `<backup>.tmp` staging sibling and renames into
 * place, so a kill mid-snapshot leaves either the old intact backup or a
 * recognizable staging dir (cleaned at the next snapshot's start).
 * @param root - the profile workspace root.
 * @param manifest - the swap bookkeeping to persist; the `files` list is
 * rewritten with what this snapshot actually preserved.
 */
export function snapshotProfile(root: string, manifest: SnapshotManifest): void {
  const backup = backupDir(root)
  const staging = `${backup}.tmp`
  updaterInternals.removeDir(staging)
  updaterInternals.ensureDir(staging)
  const preserved: string[] = []
  for (const file of SNAPSHOT_FILES) {
    const source = join(root, file)
    if (updaterInternals.readTextFile(source) === undefined) continue
    updaterInternals.copyFile(source, join(staging, file))
    preserved.push(file)
  }
  updaterInternals.writeTextFile(join(staging, 'manifest.json'), `${JSON.stringify({ ...manifest, files: preserved }, null, 2)}\n`)
  updaterInternals.removeDir(backup)
  updaterInternals.rename(staging, backup)
}

/**
 * Restore the snapshotted manifest files over the profile root. Entries
 * naming files the snapshot never preserved (a corrupted manifest) are
 * skipped rather than fatal — the rollback is best-effort by design.
 * @param root - the profile workspace root.
 * @returns `true` when a snapshot existed and was restored.
 */
export function restoreSnapshot(root: string): boolean {
  const backup = backupDir(root)
  const manifestText = updaterInternals.readTextFile(join(backup, 'manifest.json'))
  if (manifestText === undefined) return false
  let files: unknown
  try {
    files = (JSON.parse(manifestText) as Record<string, unknown>).files
  } catch {
    return false
  }
  if (!Array.isArray(files)) return false
  for (const file of files) {
    if (typeof file !== 'string') continue
    const source = join(backup, file)
    if (updaterInternals.readTextFile(source) === undefined) continue
    updaterInternals.copyFile(source, join(root, file))
  }
  return true
}

/** The update log's soft cap, and the tail kept when the cap trips. */
const LOG_CAP_BYTES = 256 * 1024
const LOG_KEEP_BYTES = 64 * 1024

/**
 * Append a line to the profile's update log (created on first write). The
 * log is bounded: past 256 KB the existing content is cut to its last
 * ~64 KB under a one-line truncation marker before the append.
 * @param root - the profile workspace root.
 * @param line - the text to append (newline added).
 */
export function appendUpdateLog(root: string, line: string): void {
  const path = join(backupDir(root), 'update.log')
  const existing = updaterInternals.readTextFile(path)
  if (existing !== undefined && existing.length > LOG_CAP_BYTES) {
    const tail = existing.slice(existing.length - LOG_KEEP_BYTES)
    updaterInternals.writeTextFile(path, `… log truncated …\n${tail}`)
  }
  updaterInternals.appendTextFile(path, `${line}\n`)
}

