/** Native current-goal status contribution behavior.
 * @module @dsh-blue/blue-transcript/tests/status-goal
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalPhase, GoalView } from '@deepseek-ai/dsh-goal'
import { describe, expect, it, vi } from 'vitest'
import * as goalStatus from '../src/status-goal.ts'
import { bootStatusPlugin, fakeAgent, type FakeFactsService } from './status-fakes.ts'

function goal(phase: GoalPhase, options: { rounds?: number, max?: number, activation?: GoalView['activation'] } = {}): GoalView {
  return {
    id: 'goal-1' as GoalView['id'],
    revision: 3,
    objective: 'ship the footer',
    phase,
    ...(phase === 'blocked' ? { blockedReason: { code: 'tests-red', message: 'tests are red' } } : {}),
    maxGoalRounds: options.max ?? 8,
    roundsStarted: options.rounds ?? 2,
    createdAt: 1_000,
    updatedAt: 2_000,
    activation: options.activation ?? 'armed',
  }
}

function currentAgentService(initial: Agent | null) {
  let current = initial
  const listeners = new Set<(agent: Agent | null, revision: number) => void>()
  return {
    service: {
      current: () => current,
      revision: () => 0,
      subscribe(listener: (agent: Agent | null, revision: number) => void) {
        listeners.add(listener)
        listener(current, 0)
        return () => { listeners.delete(listener) }
      },
    },
    listenerCount: () => listeners.size,
    switchTo(agent: Agent | null) {
      current = agent
      for (const listener of listeners) listener(agent, 1)
    },
  }
}

describe('goalStatusText', () => {
  it('formats the bounded phase, round, and activation summary', () => {
    expect(goalStatus.goalStatusText(undefined)).toBe('')
    expect(goalStatus.goalStatusText(goal('active'))).toBe('Goal active · 2/8 · armed')
  })
})

describe('blue-status-goal', () => {
  it('tracks only the exact current Agent across durable and activation changes', async () => {
    const first = fakeAgent([]) as unknown as Agent
    const second = fakeAgent([]) as unknown as Agent
    const foreign = fakeAgent([]) as unknown as Agent
    const selected = currentAgentService(first)
    const views = new Map<Agent, GoalView>()
    const get = vi.fn((agent: Agent) => views.get(agent))
    const harness = await bootStatusPlugin(goalStatus, first as never, {
      services: { blueCurrentAgent: selected.service, goals: { get } },
    })
    expect(harness.entry.id).toBe('')
    expect(get).toHaveBeenLastCalledWith(first)

    views.set(first, goal('active'))
    harness.ctx.emit('goal/changed', { agent: foreign } as never)
    expect(harness.entry.id).toBe('')
    harness.ctx.emit('goal/changed', { agent: first } as never)
    expect(harness.entry.id).toBe('blue.status.goal')
    expect(harness.entry.priority).toBe(2)
    expect(harness.entry.render(80)).toBe('Goal active · 2/8 · armed')
    expect(harness.entry.render(5)).toBe('')

    const baseline = harness.screen.renderRequests.length
    harness.ctx.emit('goal/changed', { agent: first } as never)
    expect(harness.screen.renderRequests.length).toBe(baseline)

    views.set(first, goal('paused', { rounds: 4, max: 12, activation: 'disarmed' }))
    ;(harness.ctx.get('blueSessionFacts') as FakeFactsService).setGoal(null)
    expect(harness.entry.render(80)).toBe('Goal paused · 4/12 · disarmed')
    views.set(first, goal('blocked'))
    harness.ctx.emit('goal/changed', { agent: first } as never)
    expect(harness.entry.render(80)).toBe('Goal blocked · 2/8 · armed')
    views.set(first, goal('complete', { activation: 'disarmed' }))
    harness.ctx.emit('goal/changed', { agent: first } as never)
    expect(harness.entry.render(80)).toBe('Goal complete · 2/8 · disarmed')

    views.set(first, goal('active', { activation: 'armed' }))
    harness.ctx.emit('agent/session-start', { agent: foreign } as never)
    expect(harness.entry.render(80)).toBe('Goal complete · 2/8 · disarmed')
    harness.ctx.emit('agent/session-start', { agent: first } as never)
    expect(harness.entry.render(80)).toBe('Goal active · 2/8 · armed')

    views.set(second, goal('paused', { rounds: 1, activation: 'disarmed' }))
    selected.switchTo(second)
    expect(get).toHaveBeenLastCalledWith(second)
    expect(harness.entry.render(80)).toBe('Goal paused · 1/8 · disarmed')
    selected.switchTo(null)
    expect(harness.entry.id).toBe('')
    await harness.dispose()
    expect(selected.listenerCount()).toBe(0)
  })

  it('contains native read failures and skips the registry without a current Agent', async () => {
    const current = fakeAgent([]) as unknown as Agent
    const errorGet = vi.fn(() => { throw new Error('goal registry offline') })
    const first = await bootStatusPlugin(goalStatus, current as never, {
      services: { blueCurrentAgent: currentAgentService(current).service, goals: { get: errorGet } },
    })
    expect(first.entry.id).toBe('')
    await first.dispose()

    const stringGet = vi.fn(() => { throw 'goal string failure' })
    const second = await bootStatusPlugin(goalStatus, current as never, {
      services: { blueCurrentAgent: currentAgentService(current).service, goals: { get: stringGet } },
    })
    expect(second.entry.id).toBe('')
    await second.dispose()

    const absentGet = vi.fn()
    const absent = await bootStatusPlugin(goalStatus, null, {
      services: { blueCurrentAgent: currentAgentService(null).service, goals: { get: absentGet } },
    })
    expect(absent.entry.id).toBe('')
    expect(absentGet).not.toHaveBeenCalled()
    await absent.dispose()
  })
})
