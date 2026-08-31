/**
 * The app-owned `blueJobs` facade: capability absence, owner-fenced live
 * snapshots through the harness-adapter bridge, sorting, and the session
 * commit republication hook.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { HarnessJobsSource } from '@dsh-blue/blue-harness-adapter'
import { installJobsService } from '../src/jobs.ts'
import type { BlueJobsSnapshot } from '../src/types.ts'

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const agent = { id: 'a1' } as unknown as Agent
const otherAgent = { id: 'a2' } as unknown as Agent
const snap = (id: string, overrides: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id: id as JobId,
  kind: 'bash',
  label: `label-${id}`,
  status: 'running',
  startedAt: 100,
  reported: false,
  ...overrides,
})

/** A fake registry with a caller record and a manual change emitter. */
function fakeRegistry(rows: JobSnapshot[] = []) {
  let jobs = [...rows]
  const callers: (Agent | undefined)[] = []
  const listeners = new Set<(owner: Agent | undefined) => void>()
  const registry: HarnessJobsSource = {
    list: vi.fn((caller?: Agent) => { callers.push(caller); return [...jobs] }),
    get: vi.fn((id: JobId) => {
      const found = jobs.find(job => job.id === id)
      if (found === undefined) throw new Error(`unknown job ${id}`)
      return found
    }),
    read: vi.fn((id: JobId) => ({ text: `output of ${id}`, snapshot: snap(id, { status: 'completed', finishedAt: 200 }) })),
    kill: vi.fn((_id: JobId) => 'requested' as const),
    onJobsChanged: (listener: (owner: Agent | undefined) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  return {
    registry,
    callers,
    setJobs: (next: JobSnapshot[]) => { jobs = [...next] },
    changed: (owner: Agent | undefined) => { for (const listener of listeners) listener(owner) },
  }
}

/** Install the service on a plugin fiber of a fresh context and collect its publications. */
async function install(options: { jobs?: ReturnType<typeof fakeRegistry> } = {}) {
  const ctx = new Context()
  let current: Agent | undefined = agent
  let publish!: () => void
  const app = await ctx.plugin({
    name: 'fake-app-jobs',
    apply: (appCtx: Context) => { publish = installJobsService(appCtx, () => current).publish },
  })
  const snapshots: BlueJobsSnapshot[] = []
  const registration = ctx.blueJobs.subscribe(snapshot => snapshots.push(snapshot))
  let provider: Awaited<ReturnType<Context['plugin']>> | undefined
  if (options.jobs !== undefined) {
    const jobs = options.jobs
    provider = await ctx.plugin({
      name: 'fake-jobs',
      apply: (providerCtx: Context) => { providerCtx.provide('jobs', jobs.registry as never) },
    })
  }
  await settle()
  return { ctx, app, publish, snapshots, registration, provider, setAgent: (next: Agent | undefined) => { current = next } }
}

describe('installJobsService', () => {
  it('publishes an unavailable snapshot on hosts without a jobs service', async () => {
    const { ctx, app, snapshots } = await install()
    expect(ctx.blueJobs.current()).toEqual({ available: false, jobs: [] })
    expect(snapshots).toEqual([{ available: false, jobs: [] }])
    expect(ctx.blueJobs.killJob('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'background jobs are unavailable on this host' })
    expect(ctx.blueJobs.readJobOutput('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    await app.dispose()
  })
  it('publishes the sorted visible set when the host provides jobs', async () => {
    const fake = fakeRegistry([
      snap('bash-1', { status: 'completed', startedAt: 10, finishedAt: 50 }),
      snap('bash-2', { startedAt: 30 }),
      snap('bash-3', { status: 'failed', startedAt: 20, finishedAt: 90, detail: 'exit code: 3' }),
      snap('bash-4', { status: 'stopping', startedAt: 5 }),
      snap('bash-5', { status: 'killed', startedAt: 40 }),
      // A settled job without finishedAt falls back to startedAt on both
      // sides of the comparator.
      snap('bash-6', { status: 'killed', startedAt: 45 }),
    ])
    const { ctx, app, provider, snapshots } = await install({ jobs: fake })
    expect(ctx.blueJobs.current().available).toBe(true)
    expect(ctx.blueJobs.current().jobs.map(job => job.id)).toEqual(['bash-4', 'bash-2', 'bash-3', 'bash-1', 'bash-6', 'bash-5'])
    expect(ctx.blueJobs.current().jobs[2]).toMatchObject({ detail: 'exit code: 3', finishedAt: 90 })
    expect(Object.isFrozen(ctx.blueJobs.current().jobs)).toBe(true)
    expect(snapshots.length).toBeGreaterThan(1)
    expect(fake.callers).toContain(agent)
    await provider?.dispose()
    await app.dispose()
  })
  it('republishes on registry change events and follows the current caller', async () => {
    const fake = fakeRegistry([snap('bash-1')])
    const { ctx, app, provider, publish, setAgent, snapshots } = await install({ jobs: fake })
    fake.setJobs([snap('bash-1'), snap('bash-2', { startedAt: 150 })])
    fake.changed(agent)
    expect(ctx.blueJobs.current().jobs.map(job => job.id)).toEqual(['bash-1', 'bash-2'])
    // A change to another owner's set does not republish.
    const before = snapshots.length
    fake.changed(otherAgent)
    expect(snapshots.length).toBe(before)
    // The commit-point hook re-lists under the new session's caller.
    setAgent(otherAgent)
    publish()
    expect(fake.callers.at(-1)).toBe(otherAgent)
    await provider?.dispose()
    await app.dispose()
  })
  it('keeps the last good snapshot and warns when a list fails', async () => {
    const fake = fakeRegistry([snap('bash-1')])
    const { ctx, app, provider } = await install({ jobs: fake })
    const good = ctx.blueJobs.current()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    vi.mocked(fake.registry.list).mockImplementationOnce(() => { throw new Error('registry down') })
    fake.changed(agent)
    expect(warn).toHaveBeenCalledWith('blue-app: could not list background jobs: registry down')
    expect(ctx.blueJobs.current()).toBe(good)
    warn.mockRestore()
    await provider?.dispose()
    await app.dispose()
  })
  it('flips back to unavailable when the jobs provider unloads', async () => {
    const fake = fakeRegistry([snap('bash-1')])
    const { ctx, app, provider, snapshots } = await install({ jobs: fake })
    expect(ctx.blueJobs.current().available).toBe(true)
    await provider?.dispose()
    await settle()
    expect(ctx.blueJobs.current()).toEqual({ available: false, jobs: [] })
    expect(snapshots.at(-1)).toEqual({ available: false, jobs: [] })
    expect(ctx.blueJobs.killJob('bash-1')).toMatchObject({ ok: false, code: 'BLUE_CAPABILITY_ABSENT' })
    await app.dispose()
  })
  it('forwards kill and output reads with the fenced caller and maps failures', async () => {
    const fake = fakeRegistry([snap('bash-1')])
    const { ctx, app, provider } = await install({ jobs: fake })
    expect(ctx.blueJobs.killJob('bash-1')).toEqual({ ok: true, value: 'requested' })
    expect(fake.registry.kill).toHaveBeenCalledWith('bash-1', agent, 'killed from the Blue /jobs panel')
    const output = ctx.blueJobs.readJobOutput('bash-1')
    expect(output).toMatchObject({ ok: true, value: { text: 'output of bash-1', job: { id: 'bash-1', status: 'completed', finishedAt: 200 } } })
    vi.mocked(fake.registry.kill).mockImplementationOnce(() => { throw new Error('unknown job') })
    expect(ctx.blueJobs.killJob('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown job' })
    vi.mocked(fake.registry.read).mockImplementationOnce(() => { throw new Error('foreign job') })
    expect(ctx.blueJobs.readJobOutput('bash-9')).toMatchObject({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'foreign job' })
    await provider?.dispose()
    await app.dispose()
  })
  it('stops notifying disposed subscriptions and cleans up with the app fiber', async () => {
    const fake = fakeRegistry()
    const { app, provider, registration, snapshots } = await install({ jobs: fake })
    const before = snapshots.length
    registration.dispose()
    registration.dispose()
    expect(registration.disposed).toBe(true)
    fake.changed(agent)
    expect(snapshots.length).toBe(before)
    await app.dispose()
    fake.changed(agent)
    expect(snapshots.length).toBe(before)
    await provider?.dispose()
  })
})
