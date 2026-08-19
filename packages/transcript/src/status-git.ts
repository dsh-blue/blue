/**
 * `blue-status-git` plugin: enhancement footer entry showing a rich git
 * badge — `branch [+N -M ↑a ↓b]`, the kimi footer port — in the `muted` tier
 * at priority 10. The bracket carries the working-tree diff counts (dirty
 * tree only, from `git diff --numstat HEAD`), a bare `±` when dirty without
 * counts, and the ahead/behind sync against the upstream (from
 * `git status --porcelain -b`); a clean synced tree shows the bare branch.
 * The probe data flows through a TTL cache (branch 5 s, status 15 s, the
 * kimi cadences) refreshed lazily inside `render` — Blue's redraws are
 * event-driven, so a branch switch lands on the next redraw of any kind
 * (typing, streaming, the tips ticker's 10 s beat) rather than on a watcher.
 * The working directory comes from the current session's durable header
 * (`header.cwd`), falling back to `process.cwd()`, and a session switch
 * rebuilds the cache for the new cwd. Outside a git repository (or on any
 * probe failure) the entry renders '' and occupies nothing. The git
 * invocation and the clock are module-level replaceable so tests inject
 * fakes (the `editor-plus` runner precedent).
 *
 * @module @deepseek-ai/dsh-blue-transcript/status-git
 */

import { spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@deepseek-ai/dsh-blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-git'

/** Services required before the git entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/** Branch probe cadence in milliseconds. */
export const BRANCH_TTL_MS = 5_000

/** Working-tree status probe cadence in milliseconds. */
export const STATUS_TTL_MS = 15_000

/** How long one git invocation may take before it is abandoned. */
const SPAWN_TIMEOUT_MS = 500

/** The `## ahead N, behind M` header of `git status --porcelain -b`. */
const AHEAD_BEHIND_RE = /\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/

/** The git facts behind the badge. */
export interface GitBadgeStatus {
  /** Checked-out branch name. */
  readonly branch: string
  /** Whether the working tree or index carries any change. */
  readonly dirty: boolean
  /** Commits on the branch not on its upstream. */
  readonly ahead: number
  /** Commits on the upstream not on the branch. */
  readonly behind: number
  /** Added lines under `HEAD` (dirty tree only). */
  readonly diffAdded: number
  /** Deleted lines under `HEAD` (dirty tree only). */
  readonly diffDeleted: number
}

/**
 * One git invocation: runs `git` with `args` in `cwd`, returning trimmed
 * stdout or null when the command fails, times out, or the binary is
 * missing — every probe degrades to "nothing to show".
 */
export type GitCommandRunner = (args: readonly string[], cwd: string) => string | null

/**
 * The default invocation: synchronous with a short timeout and ignored
 * stdin/stderr, so a hung or chatty git can neither block nor pollute the
 * UI beyond the cap.
 */
const defaultGitCommandRunner: GitCommandRunner = (args, cwd) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.error !== undefined || result.status !== 0) return null
  return result.stdout
}

let gitCommandRunner: GitCommandRunner = defaultGitCommandRunner

/**
 * Replace the git invocation (tests inject a fake here).
 * @param runner - the replacement, or `undefined` to restore the default.
 */
export function setGitCommandRunner(runner: GitCommandRunner | undefined): void {
  gitCommandRunner = runner ?? defaultGitCommandRunner
}

/** The wall clock the TTL cache reads; replaceable in tests. */
export type GitClock = () => number

const defaultGitClock: GitClock = () => Date.now()

let gitClock: GitClock = defaultGitClock

/**
 * Replace the TTL clock (tests inject a fake here).
 * @param clock - the replacement, or `undefined` to restore the default.
 */
export function setGitClock(clock: GitClock | undefined): void {
  gitClock = clock ?? defaultGitClock
}

/**
 * One numstat count: `-` (binary) and anything unparsable counts as nothing.
 * @param value - the count column of one numstat line.
 * @returns the parsed count, never negative.
 */
function parseNumstatCount(value: string | undefined): number {
  if (value === undefined || value === '-') return 0
  const count = Number.parseInt(value, 10)
  return Number.isFinite(count) && count > 0 ? count : 0
}

/**
 * Read the working-tree facts off a `git status --porcelain -b` dump.
 * @param output - the command's stdout.
 * @returns dirty/ahead/behind; every field zero on an empty dump.
 */
function readStatusDump(output: string): Pick<GitBadgeStatus, 'dirty' | 'ahead' | 'behind'> {
  let dirty = false
  let ahead = 0
  let behind = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('## ')) {
      const match = AHEAD_BEHIND_RE.exec(line)
      if (match) {
        ahead = Number.parseInt(match[1] ?? '0', 10) || 0
        behind = Number.parseInt(match[2] ?? '0', 10) || 0
      }
    } else if (line.trim().length > 0) {
      dirty = true
    }
  }
  return { dirty, ahead, behind }
}

/**
 * Read the diff counts off a `git diff --numstat HEAD` dump.
 * @param output - the command's stdout.
 * @returns the summed added/deleted lines.
 */
function readNumstatDump(output: string): { added: number, deleted: number } {
  let added = 0
  let deleted = 0
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [addedText, deletedText] = line.split('\t')
    added += parseNumstatCount(addedText)
    deleted += parseNumstatCount(deletedText)
  }
  return { added, deleted }
}

/** One cache's branch and status slots, with their fetch stamps. */
interface CacheSlots {
  branch: { value: string | null, fetchedAt: number }
  status: { value: Pick<GitBadgeStatus, 'dirty' | 'ahead' | 'behind' | 'diffAdded' | 'diffDeleted'>, fetchedAt: number }
}

/** A TTL-cached git badge reader for one working directory. */
export interface GitBadgeCache {
  /**
   * The current facts, probing whatever its TTL expired.
   * @returns the facts, or null outside a repository.
   */
  getStatus(): GitBadgeStatus | null
}

/**
 * Build the TTL cache for one working directory.
 * @param cwd - the directory the probes run in.
 * @returns the cache; `getStatus` yields null until a branch resolves.
 */
export function createGitBadgeCache(cwd: string): GitBadgeCache {
  let slots: CacheSlots = {
    branch: { value: null, fetchedAt: 0 },
    status: {
      value: { dirty: false, ahead: 0, behind: 0, diffAdded: 0, diffDeleted: 0 },
      fetchedAt: 0,
    },
  }

  const probeStatus = (fetchedAt: number): CacheSlots['status'] => {
    const output = gitCommandRunner(['status', '--porcelain', '-b'], cwd)
    if (output === null) {
      return { value: { dirty: false, ahead: 0, behind: 0, diffAdded: 0, diffDeleted: 0 }, fetchedAt }
    }
    const base = readStatusDump(output)
    const diff = base.dirty
      ? readNumstatDump(gitCommandRunner(['diff', '--numstat', 'HEAD', '--'], cwd) ?? '')
      : { added: 0, deleted: 0 }
    return { value: { ...base, diffAdded: diff.added, diffDeleted: diff.deleted }, fetchedAt }
  }

  return {
    getStatus: () => {
      const now = gitClock()
      if (now - slots.branch.fetchedAt >= BRANCH_TTL_MS) {
        const output = gitCommandRunner(['branch', '--show-current'], cwd)
        slots.branch = {
          value: output === null ? null : output.trim() === '' ? null : output.trim(),
          fetchedAt: now,
        }
      }
      if (slots.branch.value === null) return null

      if (now - slots.status.fetchedAt >= STATUS_TTL_MS) {
        slots.status = probeStatus(now)
      }
      return { branch: slots.branch.value, ...slots.status.value }
    },
  }
}

/**
 * Render the badge text: `branch [+N -M ↑a ↓b]`.
 * @param status - the git facts.
 * @returns the badge (one style-free line; the entry paints it).
 */
export function formatGitBadge(status: GitBadgeStatus): string {
  const parts: string[] = []
  if (status.diffAdded > 0) parts.push(`+${String(status.diffAdded)}`)
  if (status.diffDeleted > 0) parts.push(`-${String(status.diffDeleted)}`)
  if (parts.length === 0 && status.dirty) parts.push('±')
  let sync = ''
  if (status.ahead > 0) sync += `↑${String(status.ahead)}`
  if (status.behind > 0) sync += `↓${String(status.behind)}`
  if (sync !== '') parts.push(sync)
  return parts.length === 0 ? status.branch : `${status.branch} [${parts.join(' ')}]`
}

/**
 * Register the git entry. Builds the cache for the current session's cwd on
 * load and rebuilds it on every `'blue/session-changed'`; the badge itself
 * re-reads the cache (refreshing whatever expired) each time the shell lays
 * the entry out.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  let cache = createGitBadgeCache(
    ctx.get('blueSession')?.current?.session.header.cwd ?? process.cwd(),
  )

  ctx.on('blue/session-changed', (agent) => {
    cache = createGitBadgeCache(agent.session.header.cwd ?? process.cwd())
    ctx.blueScreen.requestRender()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.git',
    priority: 10,
    render(width: number): string {
      const status = cache.getStatus()
      if (status === null) return ''
      return colors.muted(components.truncateToWidth(formatGitBadge(status), width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
