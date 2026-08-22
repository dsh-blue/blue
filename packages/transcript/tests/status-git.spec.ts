/**
 * `blue-status-git` plugin: the git-badge footer entry. The git invocation
 * and the TTL clock are faked for behavior specs (badge composition, TTL
 * cadences, session rebinding); `formatGitBadge` is asserted pure; the
 * default runner is exercised against real temporary directories (a true
 * repository, a non-repository, and a missing cwd) like the editor-plus
 * default-executor specs.
 */

import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../src/status-git.ts'
import type { GitBadgeStatus } from '../src/status-git.ts'
import { asAgent, bootStatusPlugin, fakeAgent } from './status-fakes.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'


registerTempDirCleanup()

/** The fake epoch every spec starts from — past both TTLs, like Date.now(). */
const T0 = 100_000

/** Restore the real git invocation and clock after every spec. */
afterEach(() => {
  git.setGitCommandRunner(undefined)
  git.setGitClock(undefined)
})

/** A scripted git invocation: every call records itself and replays `out`. */
function scriptedGit(out: Record<string, string | null>): {
  calls: string[][]
  runner: git.GitCommandRunner
} {
  const calls: string[][] = []
  return {
    calls,
    runner: (args) => {
      calls.push([...args])
      const key = args.join(' ')
      return key in out ? out[key]! : null
    },
  }
}

/** A full badge fact set for terse specs. */
function facts(overrides: Partial<GitBadgeStatus> = {}): GitBadgeStatus {
  return { branch: 'main', dirty: false, ahead: 0, behind: 0, diffAdded: 0, diffDeleted: 0, ...overrides }
}

describe('formatGitBadge', () => {
  it('renders the bare branch for a clean synced tree', () => {
    expect(git.formatGitBadge(facts())).toBe('main')
  })

  it('renders diff counts, the dirty fallback, and the sync markers', () => {
    expect(git.formatGitBadge(facts({ diffAdded: 12, diffDeleted: 3 }))).toBe('main [+12 -3]')
    expect(git.formatGitBadge(facts({ dirty: true }))).toBe('main [±]')
    expect(git.formatGitBadge(facts({ ahead: 2 }))).toBe('main [↑2]')
    expect(git.formatGitBadge(facts({ behind: 4 }))).toBe('main [↓4]')
    expect(git.formatGitBadge(facts({ ahead: 1, behind: 2 }))).toBe('main [↑1↓2]')
    expect(git.formatGitBadge(facts({ dirty: true, diffAdded: 1, diffDeleted: 2, ahead: 3 })))
      .toBe('main [+1 -2 ↑3]')
  })
})

describe('blue-status-git', () => {
  it('shows the probed badge at priority 10 in the muted tier', async () => {
    const { runner } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': '## main\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const muted = (text: string): string => `[Mu]${text}[/Mu]`
    const harness = await bootStatusPlugin(git, null, { colors: { muted } })
    expect(harness.entry.id).toBe('blue.status.git')
    expect(harness.entry.priority).toBe(10)
    expect(harness.entry.render(80)).toBe('[Mu]main[/Mu]')
    await harness.dispose()
  })

  it('renders nothing outside a git repository', async () => {
    const { runner } = scriptedGit({ 'branch --show-current': null })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git, fakeAgent([], { cwd: '/elsewhere' }))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('renders nothing for a blank branch dump either', async () => {
    // An empty stdout — detached HEAD with no '-b', say — is as good as no
    // repository: the cache keeps the null branch and never probes status.
    const { runner, calls } = scriptedGit({ 'branch --show-current': '' })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(80)).toBe('')
    expect(calls).toHaveLength(1)
    await harness.dispose()
  })

  it('reads one-sided sync markers and unparsable numstat lines as zero', async () => {
    // Ahead-only and behind-only upstream headers, plus a numstat line with
    // no tab columns: the missing side parses as zero and the garbage line
    // contributes nothing.
    const { runner } = scriptedGit({
      'branch --show-current': 'ahead-only',
      'status --porcelain -b': '## ahead-only...origin/ahead-only [ahead 2]\n M x\n',
      'diff --numstat HEAD --': 'garbage\n1\t1\tx\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const ahead = await bootStatusPlugin(git)
    expect(ahead.entry.render(80)).toBe('ahead-only [+1 -1 ↑2]')
    await ahead.dispose()

    const { runner: behindRunner } = scriptedGit({
      'branch --show-current': 'behind-only',
      'status --porcelain -b': '## behind-only...origin/behind-only [behind 3]\n',
    })
    git.setGitCommandRunner(behindRunner)
    git.setGitClock(() => T0)
    const behind = await bootStatusPlugin(git)
    expect(behind.entry.render(80)).toBe('behind-only [↓3]')
    await behind.dispose()
  })

  it('falls back to the dirty marker when the numstat probe fails', async () => {
    // Dirty tree but a failed diff probe: the counts degrade to zero while
    // the dirty flag survives, so the badge carries the bare ±.
    const { runner } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': '## main\n M x\n',
      'diff --numstat HEAD --': null,
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(80)).toBe('main [±]')
    await harness.dispose()
  })

  it('composes the badge from the probed status and numstat dumps', async () => {
    const { runner, calls } = scriptedGit({
      'branch --show-current': 'trunk',
      'status --porcelain -b': '## trunk...origin/trunk [ahead 2, behind 1]\n M src/a.ts\n?? b.ts\n',
      'diff --numstat HEAD --': '3\t1\tsrc/a.ts\n-\t-\tlogo.png\n0\t2\tgone.ts\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(80)).toBe('trunk [+3 -3 ↑2↓1]')
    // The numstat probe runs only because the tree is dirty.
    expect(calls.map(args => args.join(' '))).toEqual([
      'branch --show-current',
      'status --porcelain -b',
      'diff --numstat HEAD --',
    ])
    await harness.dispose()
  })

  it('skips the numstat probe on a clean tree and reads no sync markers', async () => {
    const { runner, calls } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': '## main...origin/main\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(80)).toBe('main')
    expect(calls.map(args => args.join(' '))).toEqual([
      'branch --show-current',
      'status --porcelain -b',
    ])
    await harness.dispose()
  })

  it('re-probes each slot only after its TTL expires', async () => {
    const { runner, calls } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': '## main\n M x\n',
      'diff --numstat HEAD --': '1\t1\tx\n',
    })
    git.setGitCommandRunner(runner)
    let now = T0
    git.setGitClock(() => now)
    const harness = await bootStatusPlugin(git)

    harness.entry.render(80)
    expect(calls).toHaveLength(3)

    // Inside both TTLs: nothing re-probes.
    now += git.BRANCH_TTL_MS - 1
    harness.entry.render(80)
    expect(calls).toHaveLength(3)

    // Past the branch TTL (5s) but inside the status TTL (15s): branch only.
    now = T0 + git.BRANCH_TTL_MS
    harness.entry.render(80)
    expect(calls.map(args => args.join(' '))).toEqual([
      'branch --show-current',
      'status --porcelain -b',
      'diff --numstat HEAD --',
      'branch --show-current',
    ])

    // Past the status TTL: everything re-probes.
    now = T0 + git.STATUS_TTL_MS
    harness.entry.render(80)
    expect(calls).toHaveLength(7)
    await harness.dispose()
  })

  it('re-probes on the cadence even across renders far apart', async () => {
    // A failed status probe degrades to the bare branch, not to nothing.
    const { runner, calls } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': null,
    })
    git.setGitCommandRunner(runner)
    let now = T0
    git.setGitClock(() => now)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(80)).toBe('main')

    now += git.STATUS_TTL_MS
    expect(harness.entry.render(80)).toBe('main')
    expect(calls.map(args => args.join(' '))).toEqual([
      'branch --show-current',
      'status --porcelain -b',
      'branch --show-current',
      'status --porcelain -b',
    ])
    await harness.dispose()
  })

  it('rebuilds the cache for the new session cwd on blue/session-changed', async () => {
    const dumps: Record<string, string | null> = {
      'branch --show-current': 'alpha',
      'status --porcelain -b': '## alpha\n',
    }
    const cwds: string[] = []
    git.setGitCommandRunner((args, cwd) => {
      cwds.push(cwd)
      const key = args.join(' ')
      return key in dumps ? dumps[key]! : null
    })
    git.setGitClock(() => T0)
    const first = fakeAgent([], { cwd: '/repo-a' })
    const { ctx, screen, entry, dispose } = await bootStatusPlugin(git, first)
    expect(entry.render(80)).toBe('alpha')
    const baseline = screen.renderRequests.length

    dumps['branch --show-current'] = 'beta'
    ctx.emit('blue/session-changed', asAgent(fakeAgent([], { cwd: '/repo-b' })))
    // The rebuilt cache probes lazily: the next render drives it.
    expect(entry.render(80)).toBe('beta')
    expect(cwds.at(-1)).toBe('/repo-b')
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // An unchanged probe result still requests its one redraw per switch; a
    // session without a header cwd falls back to the process cwd.
    ctx.emit('blue/session-changed', asAgent(fakeAgent([])))
    expect(entry.render(80)).toBe('beta')
    expect(cwds.at(-1)).toBe(process.cwd())
    expect(screen.renderRequests.length).toBe(baseline + 2)
    await dispose()
  })

  it('truncates a long badge to the offered budget', async () => {
    const { runner } = scriptedGit({
      'branch --show-current': 'feature/a-rather-long-branch-name',
      'status --porcelain -b': '## feature/a-rather-long-branch-name [ahead 1]\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(10)).toBe('feature\x1b[0m...\x1b[0m')
    await harness.dispose()
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const { runner } = scriptedGit({
      'branch --show-current': 'main',
      'status --porcelain -b': '## main\n',
    })
    git.setGitCommandRunner(runner)
    git.setGitClock(() => T0)
    const harness = await bootStatusPlugin(git)
    expect(harness.registry.entries).toHaveLength(1)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })

  it('default runner reads the branch of a real repository', async () => {
    const dir = mkdtempTracked('dsh-blue-git-')
    execFileSync('git', ['init', '-b', 'trunk', dir])
    const harness = await bootStatusPlugin(git, fakeAgent([], { cwd: dir }))
    expect(harness.entry.render(80)).toBe('trunk')
    await harness.dispose()
  })

  it('default runner degrades to empty outside a repository', async () => {
    const dir = mkdtempTracked('dsh-blue-nogit-')
    const harness = await bootStatusPlugin(git, fakeAgent([], { cwd: dir }))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('default runner degrades to empty for a missing cwd', async () => {
    const harness = await bootStatusPlugin(git, fakeAgent([], { cwd: join(tmpdir(), 'dsh-blue-missing-cwd') }))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })
})

