/** Native current-Agent and session-projection coverage for SessionFactsService.
 * @module @dsh-blue/blue-transcript/tests/session-facts
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { initialConversationFacts } from '../../conversation/src/facts.ts'
import { projectChildSessionFacts, SessionFactsService } from '../src/session-facts.ts'

class ProjectionFake {
  private readonly values = new Map<Session, Record<string, unknown>>()
  private readonly listeners = new Set<(session: Session, key: string, value: unknown, seq: number) => void>()

  set(session: Session, values: Record<string, unknown>): void { this.values.set(session, values) }

  snapshot(session: Session, keys?: readonly string[]): { readonly asOfSeq: number, readonly values: Record<string, unknown> } {
    const source = this.values.get(session) ?? {}
    return {
      asOfSeq: 1,
      values: keys === undefined ? { ...source } : Object.fromEntries(keys.map(key => [key, source[key]])),
    }
  }

  onChanged(listener: (session: Session, key: string, value: unknown, seq: number) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(session: Session, key: string, value: unknown, seq = 2): void {
    this.values.set(session, { ...this.values.get(session), [key]: value })
    for (const listener of this.listeners) listener(session, key, value, seq)
  }

  get listenerCount(): number { return this.listeners.size }
}

function session(id: string, header: Record<string, unknown> = {}): Session {
  return { id, header } as unknown as Session
}

function agent(value: Session): Agent {
  return { id: value.id, session: value } as unknown as Agent
}

describe('SessionFactsService', () => {
  it('replays and follows native projections for the exact Agent and its direct children', () => {
    const ctx = new Context()
    const parentSession = session('parent')
    const childSession = session('child', { origin: 'subagent', parentSession: 'parent' })
    const invalidChild = session('invalid-child', { origin: 'subagent', parentSession: 'parent' })
    const unrelated = session('other-child', { origin: 'subagent', parentSession: 'other' })
    const current = agent(parentSession)
    const projections = new ProjectionFake()
    const parentFacts = { ...initialConversationFacts(), model: 'm' }
    const childFacts = { ...initialConversationFacts(), promptText: 'delegate', active: true, phase: 'tool' as const }
    projections.set(parentSession, { blueConversationFacts: parentFacts, title: 'first' })
    projections.set(childSession, { blueConversationFacts: childFacts })
    projections.set(invalidChild, { blueConversationFacts: { phase: 'invalid' } })
    let selected: Agent | null = current
    const agentListeners = new Set<(value: Agent | null, revision: number) => void>()
    ctx.reflect.provide('sessionProjections', projections)
    ctx.reflect.provide('sessions', { list: () => [parentSession, childSession, invalidChild, unrelated] })
    ctx.reflect.provide('blueCurrentAgent', {
      current: () => selected,
      revision: () => 0,
      subscribe(listener: (value: Agent | null, revision: number) => void) {
        agentListeners.add(listener)
        listener(selected, 0)
        return () => { agentListeners.delete(listener) }
      },
    })

    const service = new SessionFactsService(ctx)
    const models: Array<string | undefined> = []
    const titles: Array<string | undefined> = []
    const agents: Array<Agent | null> = []
    const children: string[][] = []
    service.subscribe(facts => models.push(facts.model))
    const offTitle = service.subscribeTitle(title => titles.push(title))
    service.subscribeAgent(value => agents.push(value))
    const offChildren = service.subscribeChildren(value => children.push(value.map(row => row.id)))

    expect(service.current).toEqual(parentFacts)
    expect(service.currentTitle).toBe('first')
    expect(service.currentAgent).toBe(current)
    expect(children.at(-1)).toEqual(['child'])

    projections.emit(unrelated, 'blueConversationFacts', { ...parentFacts, model: 'ignored' })
    projections.emit(parentSession, 'other', parentFacts)
    projections.emit(parentSession, 'blueConversationFacts', { phase: 'bad' })
    projections.emit(parentSession, 'blueConversationFacts', { ...parentFacts, model: 'next' })
    projections.emit(parentSession, 'title', 'second')
    projections.emit(parentSession, 'title', null)
    projections.emit(childSession, 'blueConversationFacts', { ...childFacts, model: 'child-model' })
    expect(models).toEqual(['m', 'next'])
    expect(titles).toEqual(['first', 'second', undefined])
    expect(children.at(-1)).toEqual(['child'])

    const untitledSession = session('untitled')
    const untitled = agent(untitledSession)
    projections.set(untitledSession, { blueConversationFacts: parentFacts, title: null })
    selected = untitled
    for (const listener of agentListeners) listener(untitled, 1)
    expect(service.currentTitle).toBeUndefined()

    selected = null
    for (const listener of agentListeners) listener(null, 1)
    expect(service.current).toEqual(initialConversationFacts())
    expect(service.currentTitle).toBeUndefined()
    expect(service.currentAgent).toBeNull()
    expect(agents).toEqual([current, untitled, null])
    expect(children.at(-1)).toEqual([])

    offTitle()
    offChildren()
    service.dispose()
    expect(projections.listenerCount).toBe(0)
    expect(agentListeners.size).toBe(0)
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
})
