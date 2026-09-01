/**
 * Renderer-neutral bridge from the official conversation-facts projection to
 * status and dock consumers. It owns only the current renderer-neutral session
 * Agent selection and immutable whole-value projection facts.
 *
 * @module @dsh-blue/blue-transcript/session-facts
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title/types'
import type { ConversationFacts } from '@dsh-blue/blue-conversation'
import { initialConversationFacts } from '@dsh-blue/blue-conversation'

/** Renderer-neutral facts for one admitted child session. */
export interface ChildSessionFacts {
  readonly id: string
  readonly promptText?: string | undefined
  readonly phase: 'waiting' | 'running' | 'completed' | 'failed'
  readonly tokens: number
  readonly toolCount: number
  readonly activity?: string | undefined
  readonly model?: string | undefined
  readonly effort?: string | undefined
  readonly endedAt?: number | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context { blueSessionFacts: SessionFactsService }
}

/** Session-scoped facts bridge for status and dock model producers. */
export class SessionFactsService extends Service {
  private agent: Agent | null = null
  private facts: ConversationFacts = initialConversationFacts()
  private title: string | undefined
  private readonly listeners = new Set<(facts: ConversationFacts) => void>()
  private readonly titleListeners = new Set<(title: string | undefined) => void>()
  private readonly agentListeners = new Set<(agent: Agent | null) => void>()
  private readonly childListeners = new Set<(children: readonly ChildSessionFacts[]) => void>()
  private readonly children = new Map<string, ChildSessionFacts>()
  private readonly offProjection: () => void
  private readonly offAgent: () => void

  constructor(ctx: Context) {
    super(ctx, 'blueSessionFacts')
    this.offProjection = ctx.sessionProjections.onChanged((session, key, value) => {
      if (session === this.agent?.session) {
        if (key === 'blueConversationFacts' && isFacts(value)) this.publish(value)
        if (key === 'title' && isTitle(value)) this.publishTitle(value ?? undefined)
        return
      }
      if (key === 'blueConversationFacts' && this.isDirectChild(session) && isFacts(value)) {
        this.publishChild(String(session.id), value)
      }
    })
    this.offAgent = ctx.blueCurrentAgent.subscribe(next => { this.attach(next) })
  }

  /** Current facts; the returned object is projection-owned readonly data. */
  get current(): ConversationFacts {
    return this.facts
  }

  /** Current official session title, when the title projection is available. */
  get currentTitle(): string | undefined {
    return this.title
  }

  /** Current raw dsh Agent selected by Blue. */
  get currentAgent(): Agent | null { return this.agent }

  /** Subscribe to whole-value changes; the current value is delivered first. */
  subscribe(listener: (facts: ConversationFacts) => void): () => void {
    this.listeners.add(listener)
    listener(this.facts)
    return () => this.listeners.delete(listener)
  }

  /** Subscribe to title-projection changes; the current value is delivered first. */
  subscribeTitle(listener: (title: string | undefined) => void): () => void {
    this.titleListeners.add(listener)
    listener(this.title)
    return () => this.titleListeners.delete(listener)
  }

  /** Subscribe to exact current-Agent changes. */
  subscribeAgent(listener: (agent: Agent | null) => void): () => void {
    this.agentListeners.add(listener)
    listener(this.agent)
    return () => this.agentListeners.delete(listener)
  }

  /** Subscribe to projection-backed child-session run facts for the active parent. */
  subscribeChildren(listener: (children: readonly ChildSessionFacts[]) => void): () => void {
    this.childListeners.add(listener)
    listener(this.childrenForCurrentSession())
    return () => this.childListeners.delete(listener)
  }

  /** Attach the service to the exact selected Agent. */
  attach(agent: Agent | null): void {
    const switched = this.agent !== agent
    this.agent = agent
    for (const listener of this.agentListeners) listener(agent)
    if (!switched) return

    this.children.clear()
    const snapshot = agent === null
      ? undefined
      : this.ctx.sessionProjections.snapshot(agent.session, ['blueConversationFacts', 'title'])
    const facts = snapshot?.values.blueConversationFacts
    this.publish(isFacts(facts) ? facts : initialConversationFacts())
    const title = snapshot?.values.title
    this.publishTitle(isTitle(title) ? title ?? undefined : undefined)
    for (const child of this.directChildren()) {
      const childFacts = this.ctx.sessionProjections.snapshot(child, ['blueConversationFacts']).values.blueConversationFacts
      if (isFacts(childFacts)) this.children.set(String(child.id), projectChildSessionFacts(String(child.id), childFacts))
    }
    this.publishChildren()
  }

  dispose(): void {
    this.offProjection()
    this.offAgent()
    this.listeners.clear()
    this.titleListeners.clear()
    this.agentListeners.clear()
    this.childListeners.clear()
    this.children.clear()
    this.agent = null
    this.facts = initialConversationFacts()
    this.title = undefined
  }

  private publish(next: ConversationFacts): void {
    this.facts = next
    for (const listener of this.listeners) listener(next)
  }

  private publishTitle(next: string | undefined): void {
    if (next === this.title) return
    this.title = next
    for (const listener of this.titleListeners) listener(next)
  }

  private publishChild(id: string, facts: ConversationFacts): void {
    this.children.set(id, projectChildSessionFacts(id, facts))
    this.publishChildren()
  }

  private publishChildren(): void {
    const children = this.childrenForCurrentSession()
    for (const listener of this.childListeners) listener(children)
  }

  private childrenForCurrentSession(): readonly ChildSessionFacts[] {
    return [...this.children.values()]
  }

  private directChildren(): readonly Session[] {
    const parent = this.agent
    if (parent === null) return []
    return [...this.ctx.sessions.list()].filter(session => this.isDirectChild(session))
  }

  private isDirectChild(session: Session): boolean {
    const parent = this.agent
    return parent !== null
      && session.header.origin === 'subagent'
      && session.header.parentSession === parent.id
  }
}

/** Convert one child session's official facts to renderer-neutral card facts. */
export function projectChildSessionFacts(id: string, facts: ConversationFacts): ChildSessionFacts {
  const phase = facts.active
    ? facts.phase === 'waiting' ? 'waiting' : 'running'
    : facts.runOutcome ?? 'completed'
  const marker = facts.activity
  const activity = marker?.kind === 'tool'
    ? `Using ${marker.name ?? 'tool'}`
    : marker?.kind === 'reasoning'
      ? 'Thinking…'
      : marker?.kind === 'text' ? 'Writing…' : facts.active ? 'Starting…' : undefined
  return {
    id, phase, tokens: facts.epochTokens ?? 0, toolCount: facts.epochToolCount ?? 0,
    ...(facts.promptText === undefined ? {} : { promptText: facts.promptText }),
    ...(activity === undefined ? {} : { activity }),
    ...(facts.model === undefined ? {} : { model: facts.model }),
    ...(facts.reasoningEffort === undefined ? {} : { effort: facts.reasoningEffort }),
    ...(facts.endedAt === undefined ? {} : { endedAt: facts.endedAt }),
  }
}

function isFacts(value: unknown): value is ConversationFacts {
  if (value === null || typeof value !== 'object') return false
  const row = value as { phase?: unknown, active?: unknown, turn?: unknown, flowDownChars?: unknown, todos?: unknown, contextTokens?: unknown, agentCalls?: unknown }
  return (row.phase === 'idle' || row.phase === 'waiting' || row.phase === 'thinking' || row.phase === 'composing' || row.phase === 'tool')
    && typeof row.active === 'boolean'
    && typeof row.turn === 'number'
    && typeof row.flowDownChars === 'number'
    && Array.isArray(row.todos)
    && typeof row.contextTokens === 'number'
    && Array.isArray(row.agentCalls)
}

function isTitle(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
