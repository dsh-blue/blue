/**
 * `blue-status-jobs` plugin: the live background-job count entry.
 * `liveJobCount` is asserted pure; the entry spec covers the appear/disappear
 * transitions, the accent tier, priority 3, change-only refreshes, and the
 * fiber unload.
 */

import { describe, expect, it } from 'vitest'
import type { BlueJob, BlueJobsService, BlueJobsSnapshot } from '@dsh-blue/blue-app'
import * as jobs from '../src/status-jobs.ts'
import { bootStatusPlugin, COLORS } from './status-fakes.ts'

const job = (id: string, status: BlueJob['status']): BlueJob => ({ id, kind: 'bash', label: id, status, startedAt: 1 })

/** Structural `blueJobs` fake with a mutable snapshot. */
function fakeBlueJobs(initial: BlueJob[] = []) {
  let snapshot: BlueJobsSnapshot = Object.freeze({ available: true, jobs: Object.freeze(initial) })
  const listeners = new Set<(next: BlueJobsSnapshot) => void>()
  const service: BlueJobsService = {
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot)
      let disposed = false
      return { get disposed() { return disposed }, dispose: () => { if (!disposed) { disposed = true; listeners.delete(listener) } } }
    },
    killJob: () => ({ ok: true, value: 'requested' as const }),
    readJobOutput: () => ({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'out of scope for the status entry' }),
  }
  return {
    service,
    publish(next: BlueJob[], available = true) {
      snapshot = Object.freeze({ available, jobs: Object.freeze(next) })
      for (const listener of listeners) listener(snapshot)
    },
  }
}

describe('liveJobCount', () => {
  it('counts only running and stopping jobs', () => {
    expect(jobs.liveJobCount({ available: true, jobs: [] })).toBe(0)
    expect(jobs.liveJobCount({
      available: true,
      jobs: [job('a', 'running'), job('b', 'stopping'), job('c', 'completed'), job('d', 'killed'), job('e', 'failed')],
    })).toBe(2)
    expect(jobs.liveJobCount({ available: false, jobs: [] })).toBe(0)
  })
})

describe('blue-status-jobs', () => {
  it('stays hidden without live jobs and appears in the accent tier at priority 3', async () => {
    const accent = (text: string): string => `[Ac]${text}[/Ac]`
    const fake = fakeBlueJobs()
    const harness = await bootStatusPlugin(jobs, null, {
      // The accent tone paints through the primary color slot.
      colors: { ...COLORS, primary: accent },
      services: { blueJobs: fake.service },
    })
    expect(harness.entry.id).toBe('')
    fake.publish([job('npm test', 'running')])
    expect(harness.entry.id).toBe('blue.status.jobs')
    expect(harness.entry.priority).toBe(3)
    expect(harness.entry.render(80)).toBe('[Ac]⏵ 1 jobs[/Ac]')
    fake.publish([job('a', 'running'), job('b', 'stopping'), job('c', 'completed')])
    expect(harness.entry.render(80)).toBe('[Ac]⏵ 2 jobs[/Ac]')
    await harness.dispose()
  })

  it('disappears when the last live job settles and when the host loses the capability', async () => {
    const fake = fakeBlueJobs([job('a', 'running')])
    const harness = await bootStatusPlugin(jobs, null, { services: { blueJobs: fake.service } })
    expect(harness.entry.render(80)).toBe('⏵ 1 jobs')
    fake.publish([job('a', 'completed')])
    expect(harness.entry.id).toBe('')
    fake.publish([job('b', 'running')], false)
    expect(harness.entry.render(80)).toBe('⏵ 1 jobs')
    await harness.dispose()
  })

  it('requests a redraw only when the rendered count changes', async () => {
    const fake = fakeBlueJobs([job('a', 'running')])
    const harness = await bootStatusPlugin(jobs, null, { services: { blueJobs: fake.service } })
    const baseline = harness.screen.renderRequests.length
    // Same live count: a settled-job arrival changes nothing visible.
    fake.publish([job('a', 'running'), job('b', 'completed')])
    expect(harness.screen.renderRequests.length).toBe(baseline)
    fake.publish([job('a', 'running'), job('b', 'running')])
    expect(harness.screen.renderRequests.length).toBe(baseline + 1)
    await harness.dispose()
  })

  it('unregisters the entry and stops listening on unload', async () => {
    const fake = fakeBlueJobs([job('a', 'running')])
    const harness = await bootStatusPlugin(jobs, null, { services: { blueJobs: fake.service } })
    expect(harness.entry.render(80)).toBe('⏵ 1 jobs')
    await harness.dispose()
    expect(harness.models.list().find(model => model.id === 'blue.status.jobs')).toBeUndefined()
    fake.publish([job('a', 'running'), job('b', 'running')])
    expect(harness.models.list().find(model => model.id === 'blue.status.jobs')).toBeUndefined()
  })
})
