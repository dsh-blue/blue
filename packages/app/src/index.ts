/**
 * @dsh-blue/blue-app — the Blue terminal UI application driver. The
 * bundle patch rides over dsh-base; the startup provider parses the launch
 * values, and this driver creates or resumes the Agent once the Loader
 * settles, publishes renderer-neutral readers and actions, answers the
 * `'blue/request-resume'`/`'blue/request-new'`/`'blue/request-fork'`/
 * `'blue/request-rewind'`
 * switches for the interaction layer's session commands, and arms the
 * exit epitaph (D47) that the process 'exit' hook flushes after the
 * teardown — the saved session id and its resume command.
 *
 * @module @dsh-blue/blue-app
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentSetup, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  BlueRegistration,
  BlueResult,
  BlueSessionReader,
  BlueSessionSnapshot,
} from '@dsh-blue/blue-api'
// Empty type imports carry the loader Context merge for the settlement await,
// the cmdline Context merge for the appExit host value, and the
// agent-presets merges: the optional `agentPresets` roster service plus the
// `agent-preset/selected` SessionEventMap member the fold below narrows on.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-skill'
import { armExitEpitaph, epitaphFor, profileFromArgv } from './exit-epitaph.ts'
import { createModelSelectionRef } from './model-ref.ts'
import { foldYolo } from './mode.ts'
import { createBlueRequestController } from './request-lifecycle.ts'
import { installRetractionService } from './retraction.ts'
import { rewindCandidates } from './rewind.ts'
import { isBalancedRewindSeed } from './rewind-seed.ts'
import { sessionDetails } from './session-details.ts'
import { installSessionTitleCadence } from './title-cadence.ts'
import type { BlueModelSelectionRef } from './model-ref.ts'
import type {
  BlueChildSessionProjectionSnapshot,
  BlueSessionActions,
  BlueSessionCommand,
  BlueSessionCommandExecution,
  BlueSessionPreset,
  BlueSessionModelSelection,
  BlueSessionModeState,
  BlueSessionProjectionReader,
  BlueSessionSkill,
  BlueSessionToolSchema,
  BlueSideSessionStatus,
} from './types.ts'

export type {
  BlueRetractionService,
  BluePromptBlock,
  BluePromptReceipt,
  BlueQueuedMessage,
  BlueRewindCandidate,
  BlueSessionActions,
  BlueChildSessionProjectionSnapshot,
  BlueSessionCommand,
  BlueSessionCommandExecution,
  BlueSessionCompositionFacts,
  BlueSessionContextFacts,
  BlueSessionDetails,
  BlueSessionModelSelection,
  BlueSessionModeState,
  BlueSessionPreset,
  BlueSessionProjectionReader,
  BlueSessionProjectionSnapshot,
  BlueSessionSkill,
  BlueSessionSkillSnapshot,
  BlueSessionTokenBuckets,
  BlueSessionToolCatalog,
  BlueSessionToolSchema,
  BlueSideSession,
  BlueSideSessionStatus,
  BlueTurnRetraction,
} from './types.ts'
export type { BlueModelSelectionRef } from './model-ref.ts'
export { createBlueRequestController, type BlueRequestController } from './request-lifecycle.ts'
export type { BlueRequestLifecycle, BlueRequestRef, BlueRequestState } from '@dsh-blue/blue-api'

/** Stable Cordis plugin name. */
export const name = 'blue-app'

/** Core services required before the session can start; `blueScreen` keeps the terminal up before the driver runs. */
export const inject = ['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']

/** Plugin config: the launch values resolved from this app's injected provider service. */
export interface Config {
  /** The task to send immediately after the Agent starts; absent opens the UI idle. */
  task?: string
  /** The persisted session id to resume; absent creates a fresh session. */
  resume?: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
  resume: z.string(),
})

/** Process-facing effects: the diagnostic stream plus the launcher's bounded exit request. */
interface BlueIo {
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the driver writes diagnostics to; tests substitute a capture. */
export const internals: { stderr: BlueIo['stderr'] } = {
  stderr: process.stderr,
}

/** Render one failure reason for a diagnostic line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Structured success result at the app's renderer-neutral action boundary. */
function success<T>(value: T): BlueResult<T> {
  return { ok: true, value }
}

/** Structured current-session absence result at the app action boundary. */
function unavailable<T = void>(): BlueResult<T> {
  return { ok: false, code: 'BLUE_SESSION_UNAVAILABLE', message: 'No Blue session is active' }
}

/** Visible text carried by one queued user message. */
function messageText(message: { readonly content: readonly { readonly type: string, readonly text?: string }[] }): string {
  return message.content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n')
}

/** Official projection registry face consumed only inside the app boundary. */
interface SessionProjectionSource {
  snapshot(session: unknown): { readonly asOfSeq: number, readonly values: Readonly<Record<string, unknown>> }
  onChanged(listener: (session: unknown, key: string, value: unknown, seq: number) => void): () => void
}

/** Structural child-session catalog retained inside the app boundary. */
interface SessionCatalogSource {
  list(): Iterable<{
    readonly id: unknown
    readonly header: { readonly origin?: unknown, readonly parentSession?: unknown }
  }>
}

/** Optional official control surface for continuable subagents. */
interface SubagentControlSource {
  interrupt(targetSessionId: SessionId, authority: { readonly kind: 'ancestor', readonly agent: Agent }): void
}

/** Official command registry face consumed only inside the app boundary. */
interface SessionCommandSource {
  list(agent: unknown): readonly { readonly name: string, readonly description?: string, readonly input?: { readonly hint?: string } }[]
  execute(agent: unknown, line: string, images: readonly never[], signal: AbortSignal): Promise<BlueSessionCommandExecution | undefined>
}

/** Effective-permission projection face consumed only inside the app boundary. */
interface PermissionPresetSource {
  current(events: readonly SessionEvent[]): string
}

/** Upstream plan controller face kept inside the app boundary. */
interface PlanModeSource {
  get(agent: unknown): { readonly active: boolean, readonly pending?: boolean }
  set(agent: unknown, active: boolean): unknown
}

/** Optional preset roster operations retained inside the app boundary. */
interface PresetRosterSource {
  list(): Promise<readonly BlueSessionPreset[]>
  recompose(agentCtx: Context, id: string): Promise<{ readonly id: string }>
  composedPreset(agentCtx: Context): string | undefined
  standingKeyFor(id?: string): Promise<object>
}

/** Host tool-registry face retained inside the app boundary. */
interface ToolRegistrySource {
  schemas(scope?: unknown): readonly {
    readonly name: string
    readonly description: string
    readonly parameters?: Record<string, unknown>
  }[]
}

/** Host skill-registry face retained inside the app boundary. */
interface SkillRegistrySource {
  snapshot(options: { readonly cwd?: string, readonly scope: unknown }): Promise<{
    readonly complete: boolean
    readonly skills: readonly {
      readonly name: string
      readonly description: string
      readonly whenToUse?: string
      readonly source: string
      readonly invocation: { readonly modelInvocable: boolean, readonly userInvocable: boolean }
    }[]
  }>
}

/** Copy one host tool schema into the renderer-neutral boundary shape. */
function copyToolSchema(schema: ReturnType<ToolRegistrySource['schemas']>[number]): BlueSessionToolSchema {
  return {
    name: schema.name,
    description: schema.description,
    ...(schema.parameters === undefined ? {} : { parameters: structuredClone(schema.parameters) }),
  }
}

/** Copy one host skill summary into the renderer-neutral boundary shape. */
function copySkill(skill: Awaited<ReturnType<SkillRegistrySource['snapshot']>>['skills'][number]): BlueSessionSkill {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
    source: skill.source,
    invocation: {
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
    },
  }
}

/** Receives the selection reference an Agent setup creates; read at the switch's commit point. */
interface SelectionHolder {
  selection?: BlueModelSelectionRef
}

/** The session facts the preset fold reads; the Agent's own session satisfies it. */
interface PresetBearingSession {
  readonly header: { readonly agentPreset?: string }
  readonly events: readonly SessionEvent[]
}

/**
 * The preset a session's own record names: the newest `agent-preset/selected`
 * event wins over the header's creation-time value (the upstream
 * `resolveSessionPreset` rule, folded locally so the roster stays an optional
 * composition — a host without it never loads this package at runtime).
 * @param session - the session whose log and header name the preset.
 * @returns the preset id the session runs, or `undefined` for the roster default.
 */
function sessionPreset(session: PresetBearingSession): string | undefined {
  let preset: string | undefined
  for (const event of session.events) {
    if (event.type === 'agent-preset/selected') preset = event.data.agentPreset
  }
  return preset ?? session.header.agentPreset
}

/**
 * The Agent setup every create/resume path shares: the model-selection
 * install, then the preset mount. The selection reference resolves three
 * tiers on read — an in-session pick, the session log's last request header,
 * then the process default — so a resumed session keeps the model it was
 * already using while a fresh one starts from the default;
 * `installModelSelection` snapshots that merged read when a step enters
 * prompt assembly, so a switch lands on the next request.
 *
 * The mount is the thin-host half of the S28 migration — the bundle patch
 * disables the base's global agent-plane rows, so joining an agent to its
 * preset's standing composition is what gives it a tool surface at all. The
 * roster is a bundle-level optional: a composition without one (the row
 * stripped, or Blue mounted into a host that keeps its own agent plane)
 * skips the mount and the agent reads whatever the global layer offers,
 * exactly as before the migration. A resumed or forked session re-mounts
 * the composition its own log names, so a `/preset` switch outlives the
 * process (the upstream composeAgent precedent).
 * @param host - the driver's plugin context, where the roster is probed.
 * @param defaultModel - the default-model service supplying the fallback tier.
 * @param holder - receives the created reference for the commit-point publication.
 * @returns the Agent setup for every create/resume path.
 */
function agentSetup(host: Context, defaultModel: AgentDefaultModelConfig, holder: SelectionHolder): AgentSetup {
  return async (agentCtx) => {
    const agent = agentCtx.agent
    if (agent === undefined) throw new Error('blue-app: agent setup ran without a scoped agent')
    const selection = createModelSelectionRef(agent, defaultModel)
    installModelSelection(agentCtx, selection)
    holder.selection = selection
    const roster = host.get('agentPresets')
    if (roster === undefined) return
    await roster.mount(agentCtx, sessionPreset(agent.session))
  }
}

/**
 * Build the Agent-creation options shared by startup creation and the
 * `'blue/request-new'`/`'blue/request-fork'` switches: a fresh session id,
 * the current working directory, and the default model's provider/model
 * with the shared agent setup. Fork callers spread the result and override
 * `meta`/`seed` with the lineage fields.
 * @param host - the driver's plugin context, carried to the shared setup.
 * @param defaultModel - the default-model service supplying provider/model.
 * @param holder - receives the selection reference the setup creates.
 * @returns the creation options for a fresh session.
 */
function createOptions(host: Context, defaultModel: AgentDefaultModelConfig, holder: SelectionHolder): CreateAgentOptions {
  const selection = defaultModel.currentSelection()
  return {
    sessionId: SessionId(`session-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: agentSetup(host, defaultModel, holder),
  }
}

/**
 * Mount the Blue application driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated launch config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('blue-app: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: BlueIo = { stderr: internals.stderr, exit }
  const session: { current: Agent | null; modelRef: BlueModelSelectionRef | undefined } = { current: null, modelRef: undefined }
  const offTitleCadence = installSessionTitleCadence(ctx, () => session.current?.session)
  ctx.effect(() => offTitleCadence)
  const requests = createBlueRequestController(ctx)
  const yoloByAgent = new WeakMap<object, boolean>()
  const sessionListeners = new Set<(snapshot: BlueSessionSnapshot | null) => void>()
  const projectionListeners = new Set<(key: string, value: unknown, seq: number) => void>()
  const childProjectionListeners = new Set<(child: BlueChildSessionProjectionSnapshot & { readonly key: string }) => void>()
  const modeState = (): BlueSessionModeState | undefined => {
    const active = session.current
    if (active === null) return undefined
    if (yoloByAgent.get(active) === true) return { mode: 'yolo', pending: false }
    const planMode = ctx.get('planMode') as unknown as PlanModeSource | undefined
    if (planMode === undefined) return { mode: 'normal', pending: false }
    const state = planMode.get(active)
    if (state.pending === true) return { mode: 'plan', pending: true }
    return { mode: state.active ? 'plan' : 'normal', pending: false }
  }
  const snapshot = (): BlueSessionSnapshot | null => {
    const active = session.current
    if (active === null) return null
    const selection = session.modelRef?.current
    return {
      id: String(active.id),
      cwd: active.session.header.cwd ?? process.cwd(),
      status: active.status === 'running' ? 'running' : 'idle',
      // An active session always produces a mode state; the optional return is
      // only for callers that ask while no session is committed.
      mode: modeState()!.mode,
      /* v8 ignore next -- commitSwitch publishes a model ref with every active Agent. */
      ...(selection === undefined ? {} : {
        model: {
          id: selection.model,
          provider: selection.provider,
          ...(selection.reasoningEffort === undefined ? {} : { effort: selection.reasoningEffort }),
        },
      }),
    }
  }
  const publishSession = (): void => {
    const value = snapshot()
    for (const listener of sessionListeners) listener(value)
  }
  /** Live subagent descendants whose durable lineage starts at `root`. */
  const descendantsOf = (root: Agent): readonly Agent[] => {
    const lineage = new Set([String(root.id)])
    const remaining = new Set(ctx.agents.list().filter(candidate => candidate !== root))
    const descendants: Agent[] = []
    let found = true
    while (found) {
      found = false
      for (const candidate of remaining) {
        const header = candidate.session.header
        if (header.origin !== 'subagent' || header.parentSession === undefined || !lineage.has(String(header.parentSession))) continue
        remaining.delete(candidate)
        lineage.add(String(candidate.id))
        descendants.push(candidate)
        found = true
      }
    }
    return descendants
  }
  /** Interrupt the current request and any detached continuable descendants. */
  const interruptActive = (active: Agent): BlueResult => {
    let interrupted = false
    if (active.status === 'running') {
      requests.interrupt()
      active.cancel({ kind: 'user' })
      interrupted = true
    }
    const descendants = descendantsOf(active).filter(candidate => candidate.status === 'running')
    const subagents = ctx.get('subagents') as unknown as SubagentControlSource | undefined
    if (descendants.length > 0 && subagents === undefined) {
      return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'Subagent interruption is unavailable' }
    }
    let controlError: unknown
    for (const descendant of descendants) {
      try {
        subagents!.interrupt(descendant.id, { kind: 'ancestor', agent: active })
        interrupted = true
      } catch (error) {
        controlError ??= error
      }
    }
    if (controlError !== undefined) {
      return { ok: false, code: 'BLUE_ACTION_REJECTED', message: describe(controlError) }
    }
    return interrupted
      ? success(undefined)
      : { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'No active request or running subagent' }
  }
  let queueChangeScheduled = false
  /** Publish one coalesced queue notification after the host mutation settles. */
  const scheduleQueueChanged = (agent: Agent): void => {
    if (agent !== session.current || queueChangeScheduled) return
    queueChangeScheduled = true
    queueMicrotask(() => {
      queueChangeScheduled = false
      if (agent === session.current) ctx.emit('blue/queue-changed')
    })
  }
  const sessionReader: BlueSessionReader = {
    current: snapshot,
    subscribe(listener): BlueRegistration {
      sessionListeners.add(listener)
      listener(snapshot())
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          sessionListeners.delete(listener)
        },
      }
    },
    async request(action): Promise<BlueResult> {
      const active = session.current
      if (active === null) return unavailable()
      if (action.kind === 'interrupt') {
        return interruptActive(active)
      }
      const message = createUserMessage({ content: [{ type: 'text', text: action.text }], source: { kind: 'user' } })
      if (action.kind === 'followup') active.followup(message)
      else active.steer(message)
      return success(undefined)
    },
  }
  ctx.provide('blueSessionReader', sessionReader)

  const projectionSource = ctx.get('sessionProjections') as SessionProjectionSource | undefined
  const childSessions = (): readonly { readonly id: string, readonly session: unknown }[] => {
    const active = session.current
    const sessions = ctx.get('sessions') as unknown as SessionCatalogSource | undefined
    if (active === null || sessions === undefined) return []
    const parentId = String(active.id)
    return [...sessions.list()].flatMap(candidate =>
      candidate.header.origin === 'subagent'
        && String(candidate.header.parentSession) === parentId
        && typeof candidate.id === 'string'
        ? [{ id: candidate.id, session: candidate }]
        : [],
    )
  }
  const sessionProjections: BlueSessionProjectionReader = {
    current(key) {
      const active = session.current
      if (active === null || projectionSource === undefined) return undefined
      const value = projectionSource.snapshot(active.session)
      return { asOfSeq: value.asOfSeq, value: value.values[key] }
    },
    currentMany(keys) {
      const active = session.current
      if (active === null || projectionSource === undefined) return undefined
      const snapshot = projectionSource.snapshot(active.session)
      return {
        asOfSeq: snapshot.asOfSeq,
        values: Object.fromEntries(keys.map(key => [key, snapshot.values[key]])),
      }
    },
    subscribe(listener) {
      projectionListeners.add(listener)
      return () => { projectionListeners.delete(listener) }
    },
    children(key) {
      if (projectionSource === undefined) return []
      return childSessions().map(child => {
        const snapshot = projectionSource.snapshot(child.session)
        return { id: child.id, asOfSeq: snapshot.asOfSeq, value: snapshot.values[key] }
      })
    },
    subscribeChildren(listener) {
      childProjectionListeners.add(listener)
      return () => { childProjectionListeners.delete(listener) }
    },
  }
  ctx.provide('blueSessionProjections', sessionProjections)
  const offProjection = projectionSource?.onChanged((eventSession, key, value, seq) => {
    if (eventSession === session.current?.session) {
      for (const listener of projectionListeners) listener(key, value, seq)
      return
    }
    const child = childSessions().find(candidate => candidate.session === eventSession)
    if (child === undefined) return
    const snapshot = { id: child.id, key, value, asOfSeq: seq }
    for (const listener of childProjectionListeners) listener(snapshot)
  })

  const sessionActions: BlueSessionActions = {
    followup(blocks) {
      const active = session.current
      if (active === null) return unavailable()
      const message = createUserMessage({ content: [...blocks] as ContentBlock[], source: { kind: 'user' } })
      active.followup(message)
      return success({ messageId: String(message.id) })
    },
    steer(blocks) {
      const active = session.current
      if (active === null) return unavailable()
      const message = createUserMessage({ content: [...blocks] as ContentBlock[], source: { kind: 'user' } })
      active.steer(message)
      return success({ messageId: String(message.id) })
    },
    interrupt() {
      const active = session.current
      if (active === null) return unavailable()
      return interruptActive(active)
    },
    queued() {
      const active = session.current
      if (active === null) return []
      const rows = [
        ...active.inbox.nextTurn.map(message => ({ id: String(message.id), target: 'turn' as const, text: messageText(message) })),
        ...active.inbox.nextStep.map(message => ({ id: String(message.id), target: 'step' as const, text: messageText(message) })),
      ]
      return Object.freeze(rows)
    },
    async flush() {
      const active = session.current
      if (active === null) return unavailable()
      await ctx.get('sessions')?.flush(active.session)
      return success(undefined)
    },
    rewindCandidates() {
      const active = session.current
      return active === null ? [] : rewindCandidates(active.session.events)
    },
    commands() {
      const active = session.current
      const commands = ctx.get('commands') as unknown as SessionCommandSource | undefined
      if (active === null || commands === undefined) return []
      return commands.list(active).map((command): BlueSessionCommand => ({
        name: command.name,
        ...(command.description === undefined ? {} : { description: command.description }),
        ...(command.input?.hint === undefined ? {} : { inputHint: command.input.hint }),
      }))
    },
    executeCommand(line, signal = new AbortController().signal) {
      const active = session.current
      const commands = ctx.get('commands') as unknown as SessionCommandSource | undefined
      return active === null || commands === undefined
        ? Promise.resolve(undefined)
        : commands.execute(active, line, [], signal)
    },
    modeState,
    planModeAvailable() {
      return ctx.get('planMode') !== undefined
    },
    setYolo(active) {
      const agent = session.current
      if (agent === null) return unavailable()
      const planMode = ctx.get('planMode') as unknown as PlanModeSource | undefined
      if (active && typeof planMode?.set === 'function') planMode.set(agent, false)
      yoloByAgent.set(agent, active)
      publishSession()
      return success(undefined)
    },
    permissionPreset() {
      const active = session.current
      const presets = ctx.get('permissionPresets') as unknown as PermissionPresetSource | undefined
      return active === null || presets === undefined ? undefined : presets.current(active.session.events)
    },
    sessionDetails() {
      const active = session.current
      if (active === null) return undefined
      const projection = projectionSource?.snapshot(active.session).values
      return sessionDetails(active, sessionActions.modelSelection(), projection)
    },
    modelSelection() {
      const current = session.modelRef?.current
      if (current === undefined) return undefined
      return {
        provider: current.provider,
        model: current.model,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
      }
    },
    hasRequestHeader() {
      return session.current?.session.requestHeader() !== undefined
    },
    selectModel(selection: BlueSessionModelSelection) {
      const ref = session.modelRef
      if (session.current === null || ref === undefined) return unavailable()
      const previous = ref.current
      ref.current = {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort as never }),
      }
      ctx.emit('blue/model-changed')
      publishSession()
      return success({
        provider: previous.provider,
        model: previous.model,
        ...(previous.reasoningEffort === undefined ? {} : { reasoningEffort: previous.reasoningEffort }),
      })
    },
    isCurrentAgent(candidate) {
      return session.current !== null && candidate === session.current
    },
    steerCurrentAgent(candidate, text) {
      const active = session.current
      if (active === null || candidate !== active) return unavailable()
      active.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      return success(undefined)
    },
    async presets() {
      const roster = ctx.get('agentPresets') as unknown as PresetRosterSource | undefined
      if (roster === undefined) {
        return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'agent presets are unavailable: the host composes no roster' }
      }
      try {
        const rows = await roster.list()
        return success(rows.map(row => ({
          id: row.id,
          trust: row.trust,
          ...(row.name === undefined ? {} : { name: row.name }),
          ...(row.description === undefined ? {} : { description: row.description }),
          ...(row.order === undefined ? {} : { order: row.order }),
          ...(row.broken === undefined ? {} : { broken: row.broken }),
        })))
      } catch (error) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: `could not list presets: ${describe(error)}` }
      }
    },
    currentPreset() {
      const active = session.current
      const roster = ctx.get('agentPresets') as unknown as PresetRosterSource | undefined
      return active === null || roster === undefined ? undefined : roster.composedPreset(active.ctx)
    },
    async selectPreset(id) {
      const active = session.current
      if (active === null) return unavailable()
      const roster = ctx.get('agentPresets') as unknown as PresetRosterSource | undefined
      if (roster === undefined) {
        return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'agent presets are unavailable: the host composes no roster' }
      }
      if (active.status !== 'idle') {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'cannot switch presets while the agent is running' }
      }
      if (active.session.events.some(event => event.type === 'turn/start')) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'cannot switch presets: this session has already started (blank sessions only)' }
      }
      try {
        const preset = await roster.recompose(active.ctx, id)
        if (session.current !== active) {
          return { ok: false, code: 'BLUE_ABORTED', message: 'the active session changed before the preset switch completed' }
        }
        active.session.append('agent-preset/selected', { agentPreset: preset.id })
        return success(`preset ${preset.id}`)
      } catch (error) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: describe(error) }
      }
    },
    async toolCatalog() {
      const tools = ctx.get('tools') as unknown as ToolRegistrySource | undefined
      if (tools === undefined) {
        return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'tool registry is unavailable: the host composes no tools service' }
      }
      const registered = tools.schemas().map(copyToolSchema)
      const active = session.current
      if (active === null) return success({ sessionLive: false, registered, visible: registered })
      let scope: object | undefined
      const roster = ctx.get('agentPresets') as unknown as PresetRosterSource | undefined
      try {
        const current = roster?.composedPreset(active.ctx)
        if (roster !== undefined && current !== undefined) scope = await roster.standingKeyFor(current)
      } catch (error) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: `could not resolve the preset composition: ${describe(error)}` }
      }
      if (session.current !== active) {
        return { ok: false, code: 'BLUE_ABORTED', message: 'the active session changed before the tool catalog completed' }
      }
      return success({
        sessionLive: true,
        registered,
        visible: scope === undefined ? registered : tools.schemas(scope).map(copyToolSchema),
      })
    },
    async skillSnapshot() {
      const active = session.current
      if (active === null) return unavailable()
      const skills = ctx.get('skills') as unknown as SkillRegistrySource | undefined
      if (skills === undefined) {
        return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'the host composes no skills service' }
      }
      try {
        const cwd = active.session.header.cwd
        const value = await skills.snapshot({
          ...(cwd === undefined ? {} : { cwd }),
          scope: active,
        })
        if (session.current !== active) {
          return { ok: false, code: 'BLUE_ABORTED', message: 'the active session changed before the skill snapshot completed' }
        }
        return success({ complete: value.complete, skills: value.skills.map(copySkill) })
      } catch (error) {
        return { ok: false, code: 'BLUE_ACTION_REJECTED', message: describe(error) }
      }
    },
    subscribeSkillChanges(listener) {
      const off = ctx.on('skills/change', listener)
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          off()
        },
      }
    },
    async createSideSession() {
      const active = session.current
      if (active === null) return undefined
      const seed = active.session.events
      const handle = await ctx.agents.create({
        sessionId: SessionId(`btw-${randomUUID()}`),
        seed,
        agentOptions: {
          ...active.options.provider === undefined ? {} : { provider: active.options.provider },
          ...active.options.model === undefined ? {} : { model: active.options.model },
        },
        meta: {
          cwd: active.session.header.cwd ?? process.cwd(),
          parentSession: active.id,
          seedLength: seed.length,
        },
      })
      const listeners = new Set<(status: BlueSideSessionStatus) => void>()
      const offStatus = ctx.on('agent/status', payload => {
        if (payload.agent !== handle.agent || (payload.status !== 'running' && payload.status !== 'idle')) return
        for (const listener of listeners) listener(payload.status)
      })
      let disposed = false
      return {
        projectionSession: handle.agent.session,
        followup(text) {
          handle.agent.followup(createUserMessage({
            content: [{ type: 'text', text }],
            source: { kind: 'user' },
          }))
        },
        subscribeStatus(listener) {
          if (disposed) return () => {}
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        async dispose() {
          if (disposed) return
          disposed = true
          offStatus()
          listeners.clear()
          await handle.dispose()
        },
      }
    },
  }
  ctx.provide('blueSessionActions', sessionActions)
  ctx.on('agent/status', payload => {
    if (payload.agent === session.current) publishSession()
  })
  const inboxChanged = (payload: { readonly agent: Agent }): void => {
    scheduleQueueChanged(payload.agent)
  }
  ctx.on('agent/inbox/inserted', inboxChanged)
  ctx.on('agent/inbox/claimed', inboxChanged)
  ctx.on('agent/inbox/discarded', inboxChanged)
  ctx.on('commands/change', publishSession)
  ctx.effect(() => () => {
    offProjection?.()
    sessionListeners.clear()
    projectionListeners.clear()
    childProjectionListeners.clear()
  })
  installRetractionService(
    ctx,
    /* v8 ignore next -- retraction.spec covers the injected current-Agent reader; app wiring is declarative */
    () => session.current,
    requests,
    /* v8 ignore next -- retraction.spec covers the injected diagnostic sink; app wiring is declarative */
    message => { io.stderr.write(`dsh: ${message}\n`) },
  )
  ctx.on('session/event', (eventSession, event) => {
    if (eventSession !== session.current?.session) return
    if (event.type === 'plan/mode') {
      publishSession()
      if (event.data.active && session.current !== null && yoloByAgent.get(session.current) === true) {
        queueMicrotask(() => {
          void sessionActions.executeCommand('/yolo off').then((execution) => {
            const text = execution?.result.text
            if (text !== undefined) ctx.emit('blue/mode-notice', text)
          }, (error: unknown) => {
            ctx.logger.warn(`yolo exclusivity dispatch failed: ${describe(error)}`)
          })
        })
      }
    }
    const ref = requests.active()
    if (ref === undefined || event.type !== 'turn/end') return
    const reason = event.data.reason.kind
    requests.transition(ref,
      reason === 'aborted' || reason === 'interrupted' ? 'interrupted' : reason === 'error' ? 'failed' : 'completed',
      reason,
    )
  })
  // The exit epitaph (D47): arm on tree dispose — every deliberate exit
  // path funnels through the launcher's dispose-then-exit, and the
  // process 'exit' hook flushes strictly after the screen restore and the
  // persistence flush (the base rows unload after this fiber). The
  // session object survives the fiber unload, so the closure read stays
  // valid; a session with no events has nothing to resume and arms
  // nothing.
  ctx.effect(() => () => {
    const active = session.current
    armExitEpitaph(active !== null && active.session.events.length > 0
      ? epitaphFor(String(active.id), profileFromArgv(process.argv))
      : undefined)
  })
  let current: AgentHandle | undefined
  // Session operations serialize on this chain so a `/resume` issued while
  // startup (or another switch) is in flight cannot interleave two resumes.
  // Every operation reports its own failure; the trailing catch is the last
  // resort that keeps one wedged operation from blocking the queue.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (operation: () => Promise<void>): void => {
    chain = chain.then(operation).catch((error: unknown) => {
      io.stderr.write(`dsh: ${describe(error)}\n`)
    })
  }

  // The shared commit point of every create/resume switch: dispose the
  // previous Agent (if any), then publish the new renderer-neutral snapshot.
  // A failed switch never reaches here, so the live session stays untouched.
  const commitSwitch = async (next: AgentHandle, holder: SelectionHolder): Promise<void> => {
    const previous = current
    current = next
    if (previous !== undefined) await previous.dispose()
    session.current = next.agent
    session.modelRef = holder.selection
    yoloByAgent.set(next.agent, foldYolo(next.agent.session.events))
    requests.commitSession()
    publishSession()
  }

  enqueue(async () => {
    // Loader siblings mount concurrently. Await the complete application
    // before creating an Agent so its scoped tools and adapters are not
    // half-composed.
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    // Early process shutdown can dispose the tree while settlement is pending.
    if (agents === undefined || defaultModel === undefined) return
    const holder: SelectionHolder = {}
    let handle: AgentHandle
    try {
      if (config.resume !== undefined) {
        handle = await agents.resume({
          resumeSessionId: SessionId(config.resume),
          setup: agentSetup(ctx, defaultModel, holder),
        })
      } else {
        handle = await agents.create(createOptions(ctx, defaultModel, holder))
      }
    } catch (error) {
      // Startup has no live session to fall back to; fail the launch.
      io.stderr.write(`dsh: ${describe(error)}\n`)
      io.exit(1)
      return
    }
    await commitSwitch(handle, holder)
    if (config.task !== undefined) {
      requests.begin('main')
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: config.task }],
        source: { kind: 'user' },
      }))
    }
  })

  ctx.on('blue/request-resume', (sessionId: string) => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        // Resume before disposing: a failed switch keeps the live session.
        next = await agents.resume({
          resumeSessionId: SessionId(sessionId),
          setup: agentSetup(ctx, defaultModel, holder),
        })
      } catch (error) {
        io.stderr.write(`dsh: could not resume session ${sessionId}: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })

  ctx.on('blue/request-new', () => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        // Create before disposing: a failed switch keeps the live session.
        next = await agents.create(createOptions(ctx, defaultModel, holder))
      } catch (error) {
        io.stderr.write(`dsh: could not start a new session: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })

  ctx.on('blue/request-fork', () => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const active = session.current
      if (active === null) {
        io.stderr.write('dsh: no live session to fork\n')
        return
      }
      if (active.status !== 'idle') {
        io.stderr.write(`dsh: cannot fork session ${String(active.id)} while it is ${active.status}\n`)
        return
      }
      // The fork inherits the parent's full event log as its seed prefix.
      const seed = active.session.events
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        next = await agents.create({
          ...createOptions(ctx, defaultModel, holder),
          meta: {
            cwd: active.session.header.cwd ?? process.cwd(),
            parentSession: active.id,
            seedLength: seed.length,
          },
          seed,
        })
      } catch (error) {
        io.stderr.write(`dsh: could not fork session ${String(active.id)}: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })

  ctx.on('blue/request-rewind', (sessionId: string, boundarySeq: number) => {
    enqueue(async () => {
      const agents = ctx.get('agents')
      const defaultModel = ctx.get('agentDefaultModel')
      if (agents === undefined || defaultModel === undefined) return
      const active = session.current
      if (active === null) {
        io.stderr.write('dsh: no live session to rewind\n')
        return
      }
      if (String(active.id) !== sessionId) {
        io.stderr.write(`dsh: rewind request is stale for session ${sessionId}\n`)
        return
      }
      if (active.status !== 'idle') {
        io.stderr.write(`dsh: cannot rewind session ${String(active.id)} while it is ${active.status}\n`)
        return
      }
      const events = active.session.events
      if (!isBalancedRewindSeed(events, boundarySeq)) {
        io.stderr.write(`dsh: cannot rewind session ${String(active.id)} at event boundary ${String(boundarySeq)}\n`)
        return
      }
      const seed = events.slice(0, boundarySeq)
      const holder: SelectionHolder = {}
      let next: AgentHandle
      try {
        next = await agents.create({
          ...createOptions(ctx, defaultModel, holder),
          meta: {
            cwd: active.session.header.cwd ?? process.cwd(),
            parentSession: active.id,
            seedLength: seed.length,
          },
          seed,
        })
      } catch (error) {
        io.stderr.write(`dsh: could not rewind session ${String(active.id)}: ${describe(error)}\n`)
        return
      }
      await commitSwitch(next, holder)
    })
  })
}
