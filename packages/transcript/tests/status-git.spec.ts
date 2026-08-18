/**
 * `blue-status-git` plugin: the git-branch footer entry. The probe runner is
 * faked for behavior specs; the default runner is exercised against real
 * temporary directories (a true repository, a non-repository, and a missing
 * cwd) like the editor-plus default-executor specs.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as git from '../src/status-git.ts'
import {
  asAgent,
  bootStatusPlugin,
  fakeAgent,
  type StatusPluginHarness,
} from './status-fakes.ts'

afterEach(() => {
  git.setGitBranchRunner(undefined)
})

/**
 * Boot the plugin with the default runner against a session rooted at `cwd`.
 * @param cwd - the session header cwd to probe.
 */
async function bootWithDefaultRunner(cwd: string): Promise<StatusPluginHarness> {
  git.setGitBranchRunner(undefined)
  return bootStatusPlugin(git, fakeAgent([], { cwd }))
}

describe('blue-status-git', () => {
  it('shows the probed branch at priority 10', async () => {
    const cwds: string[] = []
    git.setGitBranchRunner((cwd) => {
      cwds.push(cwd)
      return 'main'
    })
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.id).toBe('blue.status.git')
    expect(harness.entry.priority).toBe(10)
    expect(harness.entry.render(80)).toBe('main')
    // No session: the probe falls back to the process cwd.
    expect(cwds).toEqual([process.cwd()])
    await harness.dispose()
  })

  it('renders nothing outside a git repository', async () => {
    git.setGitBranchRunner(() => '')
    const harness = await bootStatusPlugin(git, fakeAgent([], { cwd: '/elsewhere' }))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('recomputes from the new session cwd on blue/session-changed', async () => {
    const branches: Record<string, string> = { '/repo-a': 'alpha', '/repo-b': 'beta' }
    const cwds: string[] = []
    git.setGitBranchRunner((cwd) => {
      cwds.push(cwd)
      return branches[cwd] ?? ''
    })
    const first = fakeAgent([], { cwd: '/repo-a' })
    const { ctx, screen, entry, dispose } = await bootStatusPlugin(git, first)
    expect(entry.render(80)).toBe('alpha')
    const baseline = screen.renderRequests.length

    ctx.emit('blue/session-changed', asAgent(fakeAgent([], { cwd: '/repo-b' })))
    expect(cwds.at(-1)).toBe('/repo-b')
    expect(entry.render(80)).toBe('beta')
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // A switch landing on no branch clears the entry and redraws once.
    ctx.emit('blue/session-changed', asAgent(fakeAgent([], { cwd: '/repo-c' })))
    expect(entry.render(80)).toBe('')
    expect(screen.renderRequests.length).toBe(baseline + 2)

    // An unchanged probe result requests no redraw; a session without a
    // header cwd falls back to the process cwd.
    ctx.emit('blue/session-changed', asAgent(fakeAgent([])))
    expect(cwds.at(-1)).toBe(process.cwd())
    expect(screen.renderRequests.length).toBe(baseline + 2)
    await dispose()
  })

  it('truncates long branch names to the offered budget', async () => {
    git.setGitBranchRunner(() => 'feature/a-rather-long-branch-name')
    const harness = await bootStatusPlugin(git)
    expect(harness.entry.render(10)).toBe('feature...')
    await harness.dispose()
  })

  it('unregisters the entry when the fiber unloads', async () => {
    git.setGitBranchRunner(() => 'main')
    const harness = await bootStatusPlugin(git)
    expect(harness.registry.entries).toHaveLength(1)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })

  it('default runner reads the branch of a real repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-git-'))
    execFileSync('git', ['init', '-b', 'trunk', dir])
    const harness = await bootWithDefaultRunner(dir)
    expect(harness.entry.render(80)).toBe('trunk')
    await harness.dispose()
  })

  it('default runner degrades to empty outside a repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-nogit-'))
    const harness = await bootWithDefaultRunner(dir)
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('default runner degrades to empty for a missing cwd', async () => {
    const harness = await bootWithDefaultRunner(join(tmpdir(), 'dsh-blue-missing-cwd'))
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })
})
