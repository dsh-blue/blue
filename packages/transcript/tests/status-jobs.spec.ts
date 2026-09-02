/** Native jobs status contribution behavior.
 * @module @dsh-blue/blue-transcript/tests/status-jobs
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { describe, expect, it, vi } from 'vitest'
import * as jobs from '../src/status-jobs.ts'
import { bootStatusPlugin, COLORS, fakeAgent } from './status-fakes.ts'

function job(id: string, status: JobSnapshot['status']): JobSnapshot {
  return { id: JobId(id), kind: 'bash', label: id, status, startedAt: 1, reported: false }
}

function fakeJobs(initial: readonly JobSnapshot[] = []) {
  let rows = [...initial]
  let throwOnList: unknown
  const listeners = new Set<(owner: Agent | undefined) => void>()
  const service = {
    list: vi.fn(() => {
      if (throwOnList !== undefined) throw throwOnList
      return [...rows]
    }),
    onJobsChanged(listener: (owner: Agent | undefined) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    service,
    listenerCount: () => listeners.size,
    publish(next: readonly JobSnapshot[], owner?: Agent) {
      rows = [...next]
      for (const listener of listeners) listener(owner)
    },
    fail(error: unknown) { throwOnList = error },
  }
}

describe('liveJobCount', () => {
  it('counts only running and stopping jobs', () => {
    expect(jobs.liveJobCount([])).toBe(0)
    expect(jobs.liveJobCount([
      job('a', 'running'), job('b', 'stopping'), job('c', 'completed'), job('d', 'killed'), job('e', 'failed'),
    ])).toBe(2)
  })
})

describe('blue-status-jobs', () => {
  it('tracks the exact current Agent and only refreshes visible count changes', async () => {
    const current = fakeAgent([])
    const foreign = fakeAgent([]) as unknown as Agent
    const registry = fakeJobs()
    const accent = (text: string): string => `[Ac]${text}[/Ac]`
    const harness = await bootStatusPlugin(jobs, current, {
      colors: { ...COLORS, primary: accent },
      services: {
        jobs: registry.service,
        blueCurrentAgent: {
          current: () => current as unknown as Agent,
          subscribe(listener: (agent: Agent | null, revision: number) => void) {
            listener(current as unknown as Agent, 0)
            return () => {}
          },
        },
      },
    })
    expect(harness.entry.id).toBe('')
    registry.publish([job('a', 'running')], foreign)
    expect(harness.entry.id).toBe('')
    registry.publish([job('a', 'running')], current as unknown as Agent)
    expect(harness.entry.id).toBe('blue.status.jobs')
    expect(harness.entry.priority).toBe(3)
    expect(harness.entry.render(80)).toBe('[Ac]⏵ 1 jobs[/Ac]')
    const baseline = harness.screen.renderRequests.length
    registry.publish([job('a', 'running'), job('done', 'completed')])
    expect(harness.screen.renderRequests.length).toBe(baseline)
    registry.publish([job('a', 'running'), job('b', 'stopping')])
    expect(harness.entry.render(80)).toBe('[Ac]⏵ 2 jobs[/Ac]')
    registry.publish([job('a', 'completed')])
    expect(harness.entry.id).toBe('')
    await harness.dispose()
    expect(registry.listenerCount()).toBe(0)
  })

  it('contains list failures and treats a missing current Agent as empty', async () => {
    const registry = fakeJobs([job('a', 'running')])
    registry.fail(new Error('registry offline'))
    const harness = await bootStatusPlugin(jobs, null, {
      services: {
        jobs: registry.service,
        blueCurrentAgent: {
          current: () => null,
          subscribe(listener: (agent: Agent | null, revision: number) => void) {
            listener(null, 0)
            return () => {}
          },
        },
      },
    })
    expect(harness.entry.id).toBe('')
    await harness.dispose()

    const current = fakeAgent([])
    registry.fail('registry string failure')
    const failing = await bootStatusPlugin(jobs, current, {
      services: {
        jobs: registry.service,
        blueCurrentAgent: {
          current: () => current as unknown as Agent,
          subscribe(listener: (agent: Agent | null, revision: number) => void) {
            listener(current as unknown as Agent, 0)
            return () => {}
          },
        },
      },
    })
    expect(failing.entry.id).toBe('')
    await failing.dispose()

    registry.fail(new Error('registry offline'))
    const errorFailure = await bootStatusPlugin(jobs, current, {
      services: {
        jobs: registry.service,
        blueCurrentAgent: {
          current: () => current as unknown as Agent,
          subscribe(listener: (agent: Agent | null, revision: number) => void) {
            listener(current as unknown as Agent, 0)
            return () => {}
          },
        },
      },
    })
    expect(errorFailure.entry.id).toBe('')
    await errorFailure.dispose()
  })
})
