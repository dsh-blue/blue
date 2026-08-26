/**
 * Session-facts bridge lifecycle and projection-source guards.
 *
 * @module @dsh-blue/blue-transcript/tests/session-facts
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { initialConversationFacts } from '../../conversation/src/facts.ts'
import { projectChildSessionFacts, SessionFactsService } from '../src/session-facts.ts'

describe('SessionFactsService', () => {
  it('binds renderer-neutral sessions, replays facts and children, publishes changes, and disposes', () => {
    const facts = { ...initialConversationFacts(), model: 'm' }
    let listener: ((key: string, value: unknown, seq: number) => void) | undefined
    let childListener: ((child: { id: string, key: string, value: unknown, asOfSeq: number }) => void) | undefined
    let sessionListener: ((session: { id: string, cwd: string, status: 'idle', mode: 'normal' } | null) => void) | undefined
    let values: Record<string, unknown> = { blueConversationFacts: facts, title: 'first' }
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
    const sessions: Array<string | undefined> = []
    const children: string[][] = []
    const off = service.subscribe(next => { if (next.model !== undefined) seen.push(next.model) })
    const offTitle = service.subscribeTitle(title => titles.push(title))
    const offSession = service.subscribeSession(session => sessions.push(session?.id))
    const offChildren = service.subscribeChildren(next => children.push(next.map(child => child.id)))
    sessionListener?.({ id: 's', cwd: '/tmp', status: 'idle', mode: 'normal' })
    service.attach({ id: 's', cwd: '/tmp', status: 'idle', mode: 'normal' })
    expect(service.current).toEqual(facts)
    expect(service.currentSession?.cwd).toBe('/tmp')
    listener?.('other', facts, 1)
    listener?.('blueConversationFacts', { phase: 'bad' }, 2)
    listener?.('blueConversationFacts', { ...facts, model: 'next' }, 3)
    listener?.('title', 'second', 4)
    listener?.('title', null, 5)
    listener?.('title', 42, 6)
    childListener?.({ id: 'child-2', key: 'other', value: facts, asOfSeq: 2 })
    childListener?.({ id: 'child-2', key: 'blueConversationFacts', value: { phase: 'bad' }, asOfSeq: 3 })
    childListener?.({ id: 'child-2', key: 'blueConversationFacts', value: facts, asOfSeq: 4 })
    expect(seen).toEqual(['m', 'next'])
    expect(titles).toEqual([undefined, 'first', 'second', undefined])
    expect(sessions).toEqual([undefined, 's', 's'])
    expect(children.at(-1)).toEqual(['child-1', 'child-2'])
    off()
    offTitle()
    offSession()
    offChildren()
    values = {}
    service.attach(null)
    expect(service.current).toEqual(initialConversationFacts())
    expect(service.currentTitle).toBeUndefined()
    service.dispose()
    expect(listener).toBeUndefined()
    expect(childListener).toBeUndefined()
    expect(sessionListener).toBeUndefined()
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
    service.dispose()
  })
})
