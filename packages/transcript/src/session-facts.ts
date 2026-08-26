/**
 * Renderer-neutral bridge from the official conversation-facts projection to
 * status and dock consumers. It owns only the current renderer-neutral session
 * snapshot and immutable whole-value facts; it never receives an Agent or
 * Session and never scans a Harness event log.
 *
 * @module @dsh-blue/blue-transcript/session-facts
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueRegistration, BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type {
  BlueChildSessionProjectionSnapshot,
  BlueSessionProjectionReader,
} from '@dsh-blue/blue-app'
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
  private session: BlueSessionSnapshot | null = null
  private facts: ConversationFacts = initialConversationFacts()
  private title: string | undefined
  private readonly listeners = new Set<(facts: ConversationFacts) => void>()
  private readonly titleListeners = new Set<(title: string | undefined) => void>()
  private readonly sessionListeners = new Set<(session: BlueSessionSnapshot | null) => void>()
  private readonly childListeners = new Set<(children: readonly ChildSessionFacts[]) => void>()
  private readonly children = new Map<string, ChildSessionFacts>()
  private readonly offProjection: (() => void) | undefined
  private readonly offChildProjection: (() => void) | undefined
  private readonly sessionRegistration: BlueRegistration | undefined

  constructor(ctx: Context) {
    super(ctx, 'blueSessionFacts')
    const projections = ctx.get('blueSessionProjections') as BlueSessionProjectionReader | undefined
    this.offProjection = projections?.subscribe((key, value) => {
      if (key === 'blueConversationFacts' && isFacts(value)) this.publish(value)
      if (key === 'title' && isTitle(value)) this.publishTitle(value ?? undefined)
    })
    this.offChildProjection = projections?.subscribeChildren(child => {
      if (child.key === 'blueConversationFacts' && isFacts(child.value)) this.publishChild(child)
    })
    this.sessionRegistration = ctx.get('blueSessionReader')?.subscribe(next => this.attach(next))
  }

  /** Current facts; the returned object is projection-owned readonly data. */
  get current(): ConversationFacts {
    return this.facts
  }

  /** Current official session title, when the title projection is available. */
  get currentTitle(): string | undefined {
    return this.title
  }

  /** Current renderer-neutral session snapshot. */
  get currentSession(): BlueSessionSnapshot | null {
    return this.session
  }

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

  /** Subscribe to current-session identity, cwd, status, and model changes. */
  subscribeSession(listener: (session: BlueSessionSnapshot | null) => void): () => void {
    this.sessionListeners.add(listener)
    listener(this.session)
    return () => this.sessionListeners.delete(listener)
  }

  /** Subscribe to projection-backed child-session run facts for the active parent. */
  subscribeChildren(listener: (children: readonly ChildSessionFacts[]) => void): () => void {
    this.childListeners.add(listener)
    listener(this.childrenForCurrentSession())
    return () => this.childListeners.delete(listener)
  }

  /** Attach the service to a renderer-neutral current-session snapshot. */
  attach(session: BlueSessionSnapshot | null): void {
    const switched = this.session?.id !== session?.id
    this.session = session
    for (const listener of this.sessionListeners) listener(session)
    if (!switched) return

    this.children.clear()
    const projections = this.ctx.get('blueSessionProjections') as BlueSessionProjectionReader | undefined
    const facts = session === null ? undefined : projections?.current('blueConversationFacts')?.value
    this.publish(isFacts(facts) ? facts : initialConversationFacts())
    const title = session === null ? undefined : projections?.current('title')?.value
    this.publishTitle(isTitle(title) ? title ?? undefined : undefined)
    for (const child of projections?.children('blueConversationFacts') ?? []) {
      if (isFacts(child.value)) this.children.set(child.id, projectChildSessionFacts(child.id, child.value))
    }
    this.publishChildren()
  }

  dispose(): void {
    this.offProjection?.()
    this.offChildProjection?.()
    this.sessionRegistration?.dispose()
    this.listeners.clear()
    this.titleListeners.clear()
    this.sessionListeners.clear()
    this.childListeners.clear()
    this.children.clear()
    this.session = null
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

  private publishChild(child: BlueChildSessionProjectionSnapshot): void {
    this.children.set(child.id, projectChildSessionFacts(child.id, child.value as ConversationFacts))
    this.publishChildren()
  }

  private publishChildren(): void {
    const children = this.childrenForCurrentSession()
    for (const listener of this.childListeners) listener(children)
  }

  private childrenForCurrentSession(): readonly ChildSessionFacts[] {
    return [...this.children.values()]
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
