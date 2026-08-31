/**
 * Session-facts bridge lifecycle and projection-source guards.
 *
 * @module @dsh-blue/blue-transcript/tests/session-facts
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { GoalPhase, GoalProjection } from '@deepseek-ai/dsh-goal'
import { initialConversationFacts } from '../../conversation/src/facts.ts'
import { projectChildSessionFacts, SessionFactsService } from '../src/session-facts.ts'

/** Build a valid `goal` projection value at the given phase. */
function goalProjection(phase: GoalPhase, message?: string): GoalProjection {
  return {
    goal: {
      id: 'goal-1' as GoalProjection['goal']['id'],
      revision: 3,
      objective: 'ship the badge',
      phase,
      ...(message === undefined ? {} : { blockedReason: { code: 'tests-red', message } }),
      maxGoalRounds: 8,
    },
    roundsStarted: 2,
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('SessionFactsService', () => {
  it('binds renderer-neutral sessions, replays facts and children, publishes changes, and disposes', () => {
    const facts = { ...initialConversationFacts(), model: 'm' }
    const activeGoal = goalProjection('active')
    const blockedGoal = goalProjection('blocked', 'tests are red')
    let listener: ((key: string, value: unknown, seq: number) => void) | undefined
    let childListener: ((child: { id: string, key: string, value: unknown, asOfSeq: number }) => void) | undefined
    let sessionListener: ((session: { id: string, cwd: string, status: 'idle', mode: 'normal' } | null) => void) | undefined
    let values: Record<string, unknown> = { blueConversationFacts: facts, title: 'first', goal: activeGoal }
    const projections = {
      current: (key: string) => ({ asOfSeq: 1, value: values[key] }),
      subscribe: (next: typeof listener) => { listener = next; return () => { listener = undefined } },
      children: () => [
        { id: 'child-1', asOfSeq: 1, value: { ...facts, promptText: 'child' } },
        { id: 'malformed', asOfSeq: 1, value: { phase: 'bad' } },
      ],
      subscribeChildren: (next: typeof childListener) => { childListener = next; return () => { childListener = undefined } },
    }
    const reader = {
      current: () => null,
      subscribe: (next: typeof sessionListener) => {
        sessionListener = next
        next?.(null)
        let disposed = false
        return { get disposed() { return disposed }, dispose() { disposed = true; sessionListener = undefined } }
      },
    }
    const ctx = new Context()
    ctx.reflect.provide('blueSessionProjections', projections)
    ctx.reflect.provide('blueSessionReader', reader)
    const service = new SessionFactsService(ctx)
    const seen: string[] = []
    const titles: Array<string | undefined> = []
    const goals: Array<GoalProjection | null> = []
    const sessions: Array<string | undefined> = []
    const children: string[][] = []
    const off = service.subscribe(next => { if (next.model !== undefined) seen.push(next.model) })
    const offTitle = service.subscribeTitle(title => titles.push(title))
    const offGoal = service.subscribeGoal(goal => goals.push(goal))
    const offSession = service.subscribeSession(session => sessions.push(session?.id))
    const offChildren = service.subscribeChildren(next => children.push(next.map(child => child.id)))
    sessionListener?.({ id: 's', cwd: '/tmp', status: 'idle', mode: 'normal' })
    service.attach({ id: 's', cwd: '/tmp', status: 'idle', mode: 'normal' })
    expect(service.current).toEqual(facts)
    expect(service.currentGoal).toEqual(activeGoal)
    expect(service.currentSession?.cwd).toBe('/tmp')
    listener?.('other', facts, 1)
    listener?.('blueConversationFacts', { phase: 'bad' }, 2)
    listener?.('blueConversationFacts', { ...facts, model: 'next' }, 3)
    listener?.('title', 'second', 4)
    listener?.('title', null, 5)
    listener?.('title', 42, 6)
    listener?.('goal', { phase: 'bad' }, 7)
    listener?.('goal', blockedGoal, 8)
    listener?.('goal', blockedGoal, 9)
    listener?.('goal', null, 10)
    childListener?.({ id: 'child-2', key: 'other', value: facts, asOfSeq: 2 })
    childListener?.({ id: 'child-2', key: 'blueConversationFacts', value: { phase: 'bad' }, asOfSeq: 3 })
    childListener?.({ id: 'child-2', key: 'blueConversationFacts', value: facts, asOfSeq: 4 })
    expect(seen).toEqual(['m', 'next'])
    expect(titles).toEqual([undefined, 'first', 'second', undefined])
    expect(goals).toEqual([null, activeGoal, blockedGoal, null])
    expect(sessions).toEqual([undefined, 's', 's'])
    expect(children.at(-1)).toEqual(['child-1', 'child-2'])
    off()
    offTitle()
    offGoal()
    offSession()
    offChildren()
    values = {}
    service.attach(null)
    expect(service.current).toEqual(initialConversationFacts())
    expect(service.currentTitle).toBeUndefined()
    expect(service.currentGoal).toBeNull()
    service.dispose()
    expect(listener).toBeUndefined()
    expect(childListener).toBeUndefined()
    expect(sessionListener).toBeUndefined()
  })

  it('rejects malformed goal projection values shape by shape', () => {
    let listener: ((key: string, value: unknown, seq: number) => void) | undefined
    const projections = {
      current: () => ({ asOfSeq: 1, value: undefined }),
      subscribe: (next: typeof listener) => { listener = next; return () => { listener = undefined } },
      children: () => [],
      subscribeChildren: () => () => {},
    }
    const ctx = new Context()
    ctx.reflect.provide('blueSessionProjections', projections)
    ctx.reflect.provide('blueSessionReader', {
      current: () => null,
      subscribe: () => ({ disposed: false, dispose() {} }),
    })
    const service = new SessionFactsService(ctx)
    const goals: Array<GoalProjection | null> = []
    service.subscribeGoal(goal => goals.push(goal))
    const valid = goalProjection('active')
    const validBlocked = goalProjection('blocked', 'tests are red')
    const malformed: unknown[] = [
      42,
      { ...valid, roundsStarted: '2' },
      { ...valid, createdAt: '1000' },
      { ...valid, updatedAt: undefined },
      { ...valid, goal: null },
      { ...valid, goal: 'goal' },
      { ...valid, goal: { ...valid.goal, id: 7 } },
      { ...valid, goal: { ...valid.goal, revision: '3' } },
      { ...valid, goal: { ...valid.goal, objective: 9 } },
      { ...valid, goal: { ...valid.goal, phase: 'exploding' } },
      { ...valid, goal: { ...valid.goal, maxGoalRounds: '8' } },
      { ...valid, goal: { ...valid.goal, blockedReason: null } },
      { ...valid, goal: { ...valid.goal, blockedReason: 'red' } },
      { ...valid, goal: { ...valid.goal, blockedReason: { message: 'red' } } },
      { ...valid, goal: { ...valid.goal, blockedReason: { code: 'tests-red' } } },
    ]
    let seq = 0
    for (const value of malformed) {
      seq += 1
      listener?.('goal', value, seq)
    }
    expect(goals).toEqual([null])
    seq += 1
    listener?.('goal', valid, seq)
    seq += 1
    listener?.('goal', validBlocked, seq)
    expect(goals).toEqual([null, valid, validBlocked])
    expect(service.currentGoal).toEqual(validBlocked)
    service.dispose()
  })

  it('projects every child activity and optional metadata shape', () => {
    const base = initialConversationFacts()
    expect(projectChildSessionFacts('tool', {
      ...base, active: true, phase: 'tool', activity: { kind: 'tool' }, reasoningEffort: 'high',
    })).toMatchObject({ id: 'tool', phase: 'running', activity: 'Using tool', effort: 'high' })
    expect(projectChildSessionFacts('reasoning', {
      ...base, active: true, phase: 'thinking', activity: { kind: 'reasoning' },
    })).toMatchObject({ phase: 'running', activity: 'Thinking…' })
    expect(projectChildSessionFacts('text', {
      ...base, active: true, phase: 'composing', activity: { kind: 'text' },
    })).toMatchObject({ phase: 'running', activity: 'Writing…' })
    expect(projectChildSessionFacts('starting', {
      ...base, active: true, phase: 'waiting',
    })).toMatchObject({ phase: 'waiting', activity: 'Starting…' })
    expect(projectChildSessionFacts('done', base)).toEqual({
      id: 'done', phase: 'completed', tokens: 0, toolCount: 0,
    })
  })

  it('starts from the current reader snapshot and degrades without projections', () => {
    const ctx = new Context()
    ctx.reflect.provide('blueSessionReader', {
      current: () => ({ id: 'agent', cwd: '/tmp', status: 'idle', mode: 'normal' }),
      subscribe: (listener: (session: { id: string, cwd: string, status: 'idle', mode: 'normal' }) => void) => {
        listener({ id: 'agent', cwd: '/tmp', status: 'idle', mode: 'normal' })
        return { disposed: false, dispose() {} }
      },
    })
    const service = new SessionFactsService(ctx)
    expect(service.currentSession).toMatchObject({ id: 'agent', cwd: '/tmp' })
    service.attach({ id: 'missing', cwd: '/tmp', status: 'idle', mode: 'normal' })
    expect(service.current).toEqual(initialConversationFacts())
    expect(service.currentGoal).toBeNull()
    service.dispose()
  })
})
