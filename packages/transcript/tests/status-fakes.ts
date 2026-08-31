/**
 * Shared fakes for the status-entry plugin specs: identity colors, a
 * render-request-recording screen, a structural `blueStatus` registry, a
 * structural Agent whose session carries the durable header and the request
 * header fold, and a boot helper driving one plugin module through a real
 * Cordis context (services via `ctx.reflect.provide`, as in plugin.spec).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type {
  BlueComponent,
  BlueOverlayHandle,
  BlueScreen,
} from '@dsh-blue/blue-core'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { GoalChangeMeta, GoalProjection } from '@deepseek-ai/dsh-goal'
import { foldConversationFacts, initialConversationFacts, type ConversationFacts } from '../../conversation/src/facts.ts'
import { projectChildSessionFacts, type ChildSessionFacts } from '../src/session-facts.ts'
import { compileBlueStatusNode } from '../../core/src/ui-compiler.ts'
import { BlueStatusEntryService } from '../src/status-model.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors so rendered assertions see structure, not escape codes. */
const id = (text: string): string => text
export const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
  logoGradient: [],
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Records render requests; mounting methods are out of scope here. */
export class StatusFakeScreen implements BlueScreen {
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  readonly rows = 24

  addChild(): () => void {
    throw new Error('fake addChild is out of scope for status plugin tests')
  }

  addBottomChild(_component: BlueComponent): () => void {
    return () => {}
  }

  removeChild(): void {}

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('fake showOverlay is out of scope for status plugin tests')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }

  /** S31 seam: pass-through; the status suites never suspend the screen. */
  suspend<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  /** Title writes recorded for the OSC-mirror assertions, if any. */
  readonly titles: string[] = []

  setTitle(title: string): void {
    this.titles.push(title)
  }
}

/** Status-model facade retained for concise producer assertions. */
export interface StatusEntryView {
  readonly id: string
  readonly priority: number
  readonly align: 'left' | 'right' | undefined
  readonly row: 1 | 2 | undefined
  render(width: number): string
}

/** Structural stand-in for the parts of `Session` the status plugins read. */
export interface FakeSession {
  events: SessionEvent[]
  header: { cwd?: string }
  requestHeader(): { config: { model: string } } | undefined
  requestContext(): { contextWindow?: number } | undefined
}

/** Structural stand-in for the real `Agent`; cast at the typed emit sites. */
export interface FakeAgent {
  id: SessionId
  status: 'idle' | 'running'
  options: { provider?: string, model?: string }
  session: FakeSession
}

/**
 * Reduce one durable `goal/change` payload to the `goal` projection value the
 * real registry would publish: the clear tombstone maps to null, every
 * snapshot change carries its own counters.
 * @param meta - the durable goal change payload.
 * @returns the projection value after the change.
 */
export function goalFromChange(meta: GoalChangeMeta): GoalProjection | null {
  if (meta.operation === 'clear') return null
  return { goal: meta.goal, roundsStarted: meta.roundsStarted, createdAt: meta.createdAt, updatedAt: meta.updatedAt }
}

/** Projection-shaped facts feed used by source-plane status/pane fixtures. */
export class FakeFactsService {
  private agent: FakeAgent | null = null
  private binding: FakeSession | undefined
  private session: BlueSessionSnapshot | null = null
  private value: ConversationFacts = initialConversationFacts()
  private title: string | undefined
  private goal: GoalProjection | null = null
  private readonly listeners = new Set<(facts: ConversationFacts) => void>()
  private readonly titleListeners = new Set<(title: string | undefined) => void>()
  private readonly goalListeners = new Set<(goal: GoalProjection | null) => void>()
  private readonly sessionListeners = new Set<(session: BlueSessionSnapshot | null) => void>()
  private readonly childStates = new Map<string, { parentId: string, facts: ConversationFacts }>()
  private readonly childListeners = new Set<(facts: readonly ChildSessionFacts[]) => void>()

  constructor(private readonly ctx: Context, current: FakeAgent | null, private readonly titleProjection = true) {
    this.attach(current)
    ctx.on('test/session-changed', next => {
      const agent = next === null ? null : next as unknown as FakeAgent
      this.attach(agent)
    })
    ctx.on('session/event', (session, event) => {
      if (session === this.binding) {
        if (this.titleProjection && event.type === 'session/title') {
          this.title = event.data.title
          this.publishTitle()
        }
        if (event.type === 'goal/change') {
          this.goal = goalFromChange(event.data)
          this.publishGoal()
        }
        const next = foldConversationFacts(this.value, event)
        if (next !== this.value) this.value = next
        this.publish()
        const sessionSnapshot = this.snapshot(this.agent)
        if (JSON.stringify(sessionSnapshot) !== JSON.stringify(this.session)) {
          this.session = sessionSnapshot
          this.publishSession()
        }
      }
      const child = session as unknown as { id?: unknown, header?: { origin?: unknown, parentSession?: unknown } }
      if (typeof child.id !== 'string' || child.header?.origin !== 'subagent' || typeof child.header.parentSession !== 'string') return
      const current = this.childStates.get(child.id)?.facts ?? initialConversationFacts()
      this.childStates.set(child.id, { parentId: child.header.parentSession, facts: foldConversationFacts(current, event) })
      this.publishChildren(child.header.parentSession)
    })
    ctx.on('agent/status', payload => {
      const row = payload as { readonly agent?: { readonly session?: unknown }, readonly status?: unknown }
      if (row.agent?.session !== this.binding) return
      if (row.status === 'running' || row.status === 'idle') {
        this.session = this.session === null ? null : { ...this.session, status: row.status }
        this.publishSession()
      }
      if (row.status === 'running' && (!this.value.active || this.value.phase === 'idle')) {
        this.value = { ...this.value, active: true, phase: 'waiting' }
        this.publish()
      }
    })
  }

  get current(): ConversationFacts { return this.value }

  get currentTitle(): string | undefined { return this.title }

  get currentGoal(): GoalProjection | null { return this.goal }

  get currentSession(): BlueSessionSnapshot | null { return this.session }

  subscribe(listener: (facts: ConversationFacts) => void): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => this.listeners.delete(listener)
  }

  subscribeTitle(listener: (title: string | undefined) => void): () => void {
    this.titleListeners.add(listener)
    listener(this.title)
    return () => this.titleListeners.delete(listener)
  }

  subscribeGoal(listener: (goal: GoalProjection | null) => void): () => void {
    this.goalListeners.add(listener)
    listener(this.goal)
    return () => this.goalListeners.delete(listener)
  }

  subscribeSession(listener: (session: BlueSessionSnapshot | null) => void): () => void {
    this.sessionListeners.add(listener)
    listener(this.session)
    return () => this.sessionListeners.delete(listener)
  }

  subscribeChildren(listener: (facts: readonly ChildSessionFacts[]) => void): () => void {
    this.childListeners.add(listener)
    listener(this.children())
    return () => this.childListeners.delete(listener)
  }

  private attach(agent: FakeAgent | null): void {
    this.agent = agent
    this.binding = agent?.session
    this.session = this.snapshot(agent)
    this.publishSession()
    const titleEvent = agent?.session.events.findLast((event): event is SessionEvent<'session/title'> => event.type === 'session/title')
    this.title = this.titleProjection ? titleEvent?.data.title : undefined
    const goalEvent = agent?.session.events.findLast((event): event is SessionEvent<'goal/change'> => event.type === 'goal/change')
    this.goal = goalEvent === undefined ? null : goalFromChange(goalEvent.data)
    this.value = agent === null ? initialConversationFacts() : agent.session.events.reduce(foldConversationFacts, {
      ...initialConversationFacts(),
      ...(agent.options?.provider === undefined ? {} : { provider: agent.options.provider }),
      ...(typeof agent.session.requestContext === 'function' && agent.session.requestContext()?.contextWindow === undefined ? {} : typeof agent.session.requestContext === 'function' ? { contextWindow: agent.session.requestContext()!.contextWindow } : {}),
      ...(agent.status === 'running' ? { active: true, phase: 'waiting' as const } : {}),
    })
    this.publish()
    this.publishTitle()
    this.publishGoal()
  }

  private snapshot(agent: FakeAgent | null): BlueSessionSnapshot | null {
    if (agent === null) return null
    const session = agent.session as FakeSession & { readonly id?: unknown }
    const options = agent.options ?? {}
    const selectedModel = session.requestHeader?.()?.config.model ?? options.model
    return {
      revision: 1,
      sessionEpoch: 1,
      id: String(session.id ?? agent.id),
      cwd: session.header.cwd ?? process.cwd(),
      status: agent.status === 'running' ? 'running' : 'idle',
      mode: 'normal',
      ...(selectedModel === undefined ? {} : {
        model: { id: selectedModel, ...(options.provider === undefined ? {} : { provider: options.provider }) },
      }),
    }
  }

  private publish(): void { for (const listener of this.listeners) listener(this.value) }

  private publishTitle(): void { for (const listener of this.titleListeners) listener(this.title) }

  private publishGoal(): void { for (const listener of this.goalListeners) listener(this.goal) }

  private publishSession(): void { for (const listener of this.sessionListeners) listener(this.session) }

  private publishChildren(parentId: string): void {
    if (parentId !== this.session?.id) return
    const children = this.children()
    for (const listener of this.childListeners) listener(children)
  }

  private children(): readonly ChildSessionFacts[] {
    return [...this.childStates].filter(([, child]) => child.parentId === this.session?.id)
      .map(([id, child]) => projectChildSessionFacts(id, child.facts))
  }
}

let agentCounter = 0

/**
 * A fake agent whose session is a plain event-log object.
 * @param events - the session's event snapshot.
 * @param options - agent options (model/provider fallbacks) and the durable
 *   header cwd / request-header model the plugins may prefer.
 */
export function fakeAgent(
  events: SessionEvent[],
  options: {
    model?: string
    provider?: string
    cwd?: string
    headerModel?: string
    contextWindow?: number
  } = {},
): FakeAgent {
  agentCounter += 1
  const header: { cwd?: string } = {}
  if (options.cwd !== undefined) header.cwd = options.cwd
  const agentOptions: { provider?: string, model?: string } = {}
  if (options.model !== undefined) agentOptions.model = options.model
  if (options.provider !== undefined) agentOptions.provider = options.provider
  const headerModel = options.headerModel
  const requestContext = options.contextWindow === undefined
    ? undefined
    : (): { contextWindow?: number } => ({ contextWindow: options.contextWindow })
  return {
    id: SessionId(`fake-agent-${agentCounter}`),
    status: 'idle',
    options: agentOptions,
    session: {
      events,
      header,
      requestHeader: () => (headerModel === undefined ? undefined : { config: { model: headerModel } }),
      requestContext: () => requestContext?.(),
    },
  }
}

/** Narrow a fake to the app-owned event payload type. */
export function asAgent(fake: FakeAgent): Agent {
  return fake as unknown as Agent
}

/** A plugin module shape accepted by `ctx.plugin`. */
export interface StatusPluginModule {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
}

export interface StatusPluginHarness {
  ctx: Context
  screen: StatusFakeScreen
  entry: StatusEntryView
  models: BlueStatusEntryService
  dispose(): Promise<void>
}

/**
 * Boot one status-entry plugin on a fresh root context with every service it
 * injects faked.
 * @param plugin - the plugin module under test.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param options - overrides; a custom color table observes the tier a
 *   plugin paints its text in, and `services` provides extra structural
 *   services (e.g. the title fold) beyond the standard set.
 */
export async function bootStatusPlugin(
  plugin: StatusPluginModule,
  current: FakeAgent | null = null,
  options: {
    colors?: Record<string, (text: string) => string>
    services?: Record<string, unknown>
    titleProjection?: boolean
  } = {},
): Promise<StatusPluginHarness> {
  const ctx = new Context()
  const screen = new StatusFakeScreen()
  const colors = { ...COLORS, ...options.colors }
  const statusModels = new BlueStatusEntryService(ctx, screen)
  const components = fakeBlueComponents()
  const facts = new FakeFactsService(ctx, current, options.titleProjection ?? true)
  const serviceNames: Record<string, unknown> = {
    blueSessionFacts: facts,
    blueScreen: screen,
    blueTheme: { colors },
    blueComponents: components,
    blueSession: { current: current === null ? null : asAgent(current) },
    ...options.services,
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }
  const fiber = await ctx.plugin(plugin)
  if (current !== null) ctx.emit('test/session-binding-changed', { id: String(current.id), session: current.session, cwd: current.session.header.cwd })
  const currentModel = () => statusModels.list().find(model => model.visible)
  const entry: StatusEntryView = {
    get id() { return currentModel()?.id ?? '' },
    get priority() { return currentModel()?.priority ?? 0 },
    get align() { return currentModel()?.band === 'right' ? 'right' : currentModel() === undefined ? undefined : 'left' },
    get row() { return currentModel()?.row },
    render: width => {
      const model = currentModel()
      if (model === undefined || width <= 0) return ''
      const result = compileBlueStatusNode(model.node, {
        components,
        colors,
        getViewport: () => ({ columns: width, rows: 1 }),
        screenMode: 'main',
      })
      const rendered = result.ok ? result.value.component.renderStatus(width) : result.errorComponent.renderStatus(width)
      if (model.overflow === 'hide' && rendered.overflowed) return ''
      return rendered.rows[0] ?? ''
    },
  }
  return {
    ctx,
    screen,
    entry,
    models: statusModels,
    dispose: () => fiber.dispose(),
  }
}
