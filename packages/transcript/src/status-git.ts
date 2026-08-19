/**
 * `blue-status-git` plugin: enhancement footer entry showing the current
 * git branch (muted, priority 10). The branch is probed once per session
 * attach — the working directory comes from the current session's durable
 * header (`header.cwd`), falling back to `process.cwd()` — with no fs
 * watching, so a branch switch mid-session shows on the next session change,
 * not live. Outside a git repository (or on any probe failure) the entry
 * renders '' and occupies nothing. The probe runs through a module-level
 * replaceable runner so tests inject a fake (the `editor-plus` precedent).
 *
 * @module @dsh-blue/blue-transcript/status-git
 */

import { spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-git'

/** Services required before the git entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/**
 * Probes the checked-out branch of the repository at `cwd`; '' when there is
 * none to show (not a repository, detached HEAD, any probe failure).
 */
export type GitBranchRunner = (cwd: string) => string

/**
 * The default probe: `git branch --show-current`. The timeout and ignored
 * stdin/stderr keep a hung or chatty git from blocking or polluting the UI;
 * a missing binary, a timeout, and a nonzero exit all degrade to ''.
 */
const defaultGitBranchRunner: GitBranchRunner = (cwd) => {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd,
    encoding: 'utf8',
    timeout: 1000,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.error !== undefined || result.status !== 0) return ''
  return result.stdout.trim()
}

let gitBranchRunner: GitBranchRunner = defaultGitBranchRunner

/**
 * Replace the git branch probe (tests inject a fake here).
 * @param runner - the replacement, or `undefined` to restore the default.
 */
export function setGitBranchRunner(runner: GitBranchRunner | undefined): void {
  gitBranchRunner = runner ?? defaultGitBranchRunner
}

/**
 * Register the git entry. Recomputes the branch on load and on every
 * `'blue/session-changed'`; a redraw is requested only when the branch text
 * actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  let branch = gitBranchRunner(ctx.get('blueSession')?.current?.session.header.cwd ?? process.cwd())

  ctx.on('blue/session-changed', (agent) => {
    const next = gitBranchRunner(agent.session.header.cwd ?? process.cwd())
    if (next === branch) return
    branch = next
    screen.requestRender()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.git',
    priority: 10,
    render(width: number): string {
      if (branch === '') return ''
      return colors.muted(components.truncateToWidth(branch, width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
