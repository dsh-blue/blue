/**
 * The Blue app driver: startup create/resume, renderer-neutral session
 * publication, `/resume`/`/new`/`/fork` switching, and the exit epitaph
 * (D47) over fake core services.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import { apply, Config, internals } from '../src/index.ts'
import {
  armExitEpitaph,
  armedEpitaph,
  epitaphFor,
  profileFromArgv,
  setExitEpitaphWriter,
  writeArmedEpitaph,
} from '../src/exit-epitaph.ts'

const originalStderr = internals.stderr
afterEach(() => {
  internals.stderr = originalStderr
  // The epitaph slot is process-global; an armed leftover would print at
  // the vitest process's own exit.
  armExitEpitaph(undefined)
})

/** What the fake core services recorded. */
interface Recorded {
  created: CreateAgentOptions[]
  resumed: string[]
  resumeOptions: ResumeAgentOptions[]
  disposed: string[]
  followups: [string, unknown][]
  steers: [string, unknown][]
  cancels: [string, unknown][]
  appends: [string, unknown][]
  agents: Agent[]
  setups: number
  listeners: string[]
}

/**
 * A minimal unpublished-agent scope that records the waterfall listeners a
 * setup installs — the observable effect of `installModelSelection` on the
 * agent context.
 * @param recorded - the capture sink.
 * @param agent - the scoped Agent the setup reads (`ctx.agent`).
 * @returns the fake agent scope.
 */
function recordingAgentCtx(recorded: Recorded, agent?: Agent): Context {
  return {
    agent,
    on: (event: string) => {
      recorded.listeners.push(event)
      return () => {}
    },
  } as never
}

/** The request-header config a fake Agent's session reports, if any. */
interface FakeHeaderConfig {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Build an owned handle for a fake Agent that records its teardown and prompts. */
function makeHandle(
  id: string,
  recorded: Recorded,
  disposeError?: Error,
  headerConfig?: FakeHeaderConfig,
  presetSeed?: { events?: unknown[]; header?: string },
): AgentHandle {
  const events = [...(presetSeed?.events ?? [{ type: 'user/message' }, { type: 'assistant/message' }])]
  const inbox = {
    nextTurn: [] as unknown[],
    nextStep: [] as unknown[],
    remove: vi.fn(() => true),
  }
  const agent = {
    id,
    status: 'idle',
    options: {},
    ctx: new Context(),
    inbox,
    session: {
      events,
      header: presetSeed?.header === undefined ? {} : { agentPreset: presetSeed.header },
      requestHeader: () => (headerConfig === undefined ? undefined : { config: headerConfig }),
      requestContext: () => undefined,
      append: (type: string, data: unknown) => {
        recorded.appends.push([type, data])
        events.push({ type, data })
      },
    },
    followup: (message: unknown) => { recorded.followups.push([id, message]) },
    steer: (message: unknown) => { recorded.steers.push([id, message]) },
    cancel: (reason: unknown) => { recorded.cancels.push([id, reason]) },
  } as unknown as Agent
  recorded.agents.push(agent)
  return {
    agent,
    dispose: () => {
      recorded.disposed.push(id)
      return disposeError === undefined ? Promise.resolve() : Promise.reject(disposeError)
    },
  }
}

/** A mounted driver plus its fakes and captures. */
interface Bench {
  ctx: Context
  recorded: Recorded
  changes: BlueSessionSnapshot[]
  exits: number[]
  err(): string
  /** Resolve the private active Agent through the public snapshot identity. */
  current(): Agent | null
  /** Swap the resume behavior mid-test (e.g. to fail a `/resume` switch). */
  setResumeError(error: Error): void
  /** Swap the create behavior mid-test (e.g. to fail a `/new` or `/fork` switch). */
  setCreateError(error: unknown): void
}

/**
 * Mount the driver over fake core services.
 * @param config - the validated launch config.
 * @param options - service provisioning and failure injection.
 * @returns the bench.
 */
function bench(config: Config, options: {
  agents?: boolean
  defaultModel?: boolean
  createError?: unknown
  createDisposeError?: Error
  /** The request header the resumed fake Agent reports (the header tier's input). */
  resumeHeaderConfig?: FakeHeaderConfig
  /** The request header the created fake Agent reports (the header tier's input). */
  createHeaderConfig?: FakeHeaderConfig
  /** The preset roster the driver probes; absent means no roster composed. */
  roster?: { mount: ReturnType<typeof vi.fn> }
  /** The fake Agents' session events, seeding the preset fold (create and resume). */
  sessionEvents?: unknown[]
  /** The fake Agents' creation-header preset, seeding the preset fold. */
  headerAgentPreset?: string
  /** Additional host services that must exist before the app captures them. */
  setupContext?: (ctx: Context) => void
} = {}): Bench {
  const ctx = new Context()
  let err = ''
  internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
  const exits: number[] = []
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  const recorded: Recorded = {
    created: [],
    resumed: [],
    resumeOptions: [],
    disposed: [],
    followups: [],
    steers: [],
    cancels: [],
    appends: [],
    agents: [],
    setups: 0,
    listeners: [],
  }
  const presetSeed = { events: options.sessionEvents, header: options.headerAgentPreset }
  let resumeError: Error | undefined
  let createError = options.createError
  if (options.agents !== false) {
    ctx.provide('agents', {
      create: async (createOptions: CreateAgentOptions) => {
        if (createError !== undefined) throw createError
        recorded.created.push(createOptions)
        const handle = makeHandle(
          `agent-${recorded.created.length}`,
          recorded,
          options.createDisposeError,
          options.createHeaderConfig,
          presetSeed,
        )
        await createOptions.setup?.(recordingAgentCtx(recorded, handle.agent))
        recorded.setups += 1
        return handle
      },
      resume: async (resumeOptions: ResumeAgentOptions) => {
        if (resumeError !== undefined) throw resumeError
        recorded.resumed.push(String(resumeOptions.resumeSessionId))
        recorded.resumeOptions.push(resumeOptions)
        const handle = makeHandle(
          `resumed-${String(resumeOptions.resumeSessionId)}`,
          recorded,
          undefined,
          options.resumeHeaderConfig,
          presetSeed,
        )
        await resumeOptions.setup?.(recordingAgentCtx(recorded, handle.agent))
        return handle
      },
      list: () => [...recorded.agents],
      get: (id: string) => recorded.agents.find(agent => String(agent.id) === String(id)),
    } as never)
  }
  if (options.defaultModel !== false) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    } as never)
  }
  if (options.roster !== undefined) {
    ctx.provide('agentPresets', options.roster as never)
  }
  options.setupContext?.(ctx)
  apply(ctx, config)
  const changes: BlueSessionSnapshot[] = []
  ctx.blueSessionReader.subscribe(snapshot => {
    if (snapshot !== null) changes.push(snapshot)
  })
  return {
    ctx,
    recorded,
    changes,
    exits,
    err: () => err,
    current: () => {
      const id = ctx.blueSessionReader.current()?.id
      return id === undefined ? null : recorded.agents.findLast(agent => String(agent.id) === id) ?? null
    },
    setResumeError: (error) => { resumeError = error },
    setCreateError: (error) => { createError = error },
  }
}

describe('blue app driver', () => {
  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
  })

  it('binds the tool-presentation scope to the active agent at the commit point', async () => {
    let active: object | undefined
    const test = bench({ task: 'scope the cards' }, {
      setupContext: ctx => {
        ctx.provide('tools', {
          get: (name: string, scope?: unknown) => scope === active ? { presentCall: () => ({ card: 'generic', title: name }) } : undefined,
          schemas: () => [],
        })
      },
    })
    await vi.waitFor(() => { expect(test.recorded.followups).toHaveLength(1) })
    // No tools registry means the seam resolves nothing, not a crash.
    const bare = bench({})
    await vi.waitFor(() => { expect(bare.current()).not.toBeNull() })
    expect(bare.ctx.blueToolPresentations.get('probe')).toBeUndefined()

    // The commit point bound the active Agent: presenters resolve through
    // the scoped view only while that exact object is the viewing scope.
    active = test.current()
    expect(active).not.toBeUndefined()
    expect(test.ctx.blueToolPresentations.get('probe')).toMatchObject({ presentCall: expect.any(Function) })
    test.ctx.blueToolPresentations.bind(undefined)
    expect(test.ctx.blueToolPresentations.get('probe')).toBeUndefined()
    test.ctx.blueToolPresentations.bind(active!)
    expect(test.ctx.blueToolPresentations.get('probe')).toMatchObject({ presentCall: expect.any(Function) })
  })

  it('creates an Agent with the default model, publishes it, and sends the task', async () => {
    const test = bench({ task: 'fix the build' })
    await vi.waitFor(() => { expect(test.recorded.followups).toHaveLength(1) })
    expect(test.recorded.created).toHaveLength(1)
    const created = test.recorded.created[0]!
    expect(String(created.sessionId)).toMatch(/^session-/)
    expect(created.meta).toEqual({ cwd: process.cwd() })
    expect(created.agentOptions).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(test.recorded.setups).toBe(1)
    expect(test.recorded.listeners).toEqual(['system-prompt/assemble', 'agent/request'])
    const agent = test.current()
    expect(agent).not.toBeNull()
    expect(test.changes.map(change => change.id)).toEqual([agent?.id])
    const [id, message] = test.recorded.followups[0]!
    expect(id).toBe('agent-1')
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'fix the build' }],
      source: { kind: 'user' },
    })
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('projects rewind candidates through the app-owned action boundary', async () => {
    const test = bench({}, { sessionEvents: [
      { type: 'turn/start', seq: 0, time: 100, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        time: 101,
        data: { content: [{ type: 'text', text: 'rewind here' }], source: { kind: 'user' } },
      },
    ] })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(test.ctx.blueSessionActions.rewindCandidates()).toEqual([{
      turn: 1,
      boundarySeq: 0,
      prompt: 'rewind here',
      time: 101,
    }])
    await test.ctx.fiber.dispose()
  })

  it('owns seeded side-session creation, follow-up, status, and disposal', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const parent = test.current()!
    ;(parent as unknown as { options: { provider?: string, model?: string } }).options = {
      provider: 'mock',
      model: 'mock-1',
    }
    ;(parent.session.header as { cwd?: string }).cwd = '/repo'

    const side = await test.ctx.blueSessionActions.createSideSession()
    expect(side).toBeDefined()
    expect(test.recorded.created).toHaveLength(2)
    const options = test.recorded.created[1]!
    expect(String(options.sessionId)).toMatch(/^btw-/)
    expect(options.seed).toBe(parent.session.events)
    expect(options.meta).toEqual({ cwd: '/repo', parentSession: parent.id, seedLength: 2 })
    expect(options.agentOptions).toEqual({ provider: 'mock', model: 'mock-1' })
    const sideAgent = test.recorded.agents[1]!
    expect(side!.projectionSession).toBe(sideAgent.session)

    side!.followup('what is x?')
    expect(test.recorded.followups.at(-1)).toMatchObject([
      'agent-2',
      { content: [{ type: 'text', text: 'what is x?' }], source: { kind: 'user' } },
    ])

    const statuses: string[] = []
    const off = side!.subscribeStatus(status => { statuses.push(status) })
    test.ctx.emit('agent/status', { agent: parent, status: 'running' })
    test.ctx.emit('agent/status', { agent: sideAgent, status: 'queued' } as never)
    test.ctx.emit('agent/status', { agent: sideAgent, status: 'running' })
    test.ctx.emit('agent/status', { agent: sideAgent, status: 'idle' })
    expect(statuses).toEqual(['running', 'idle'])
    off()
    test.ctx.emit('agent/status', { agent: sideAgent, status: 'running' })
    expect(statuses).toEqual(['running', 'idle'])

    await side!.dispose()
    await side!.dispose()
    expect(test.recorded.disposed).toEqual(['agent-2'])
    side!.subscribeStatus(() => { throw new Error('disposed handle subscribed') })()
    await test.ctx.fiber.dispose()
  })

  it('keeps side-session unavailability and creation failure inside the app boundary', async () => {
    const unavailable = bench({}, { createError: new Error('startup failed') })
    await vi.waitFor(() => { expect(unavailable.exits).toEqual([1]) })
    await expect(unavailable.ctx.blueSessionActions.createSideSession()).resolves.toBeUndefined()
    await unavailable.ctx.fiber.dispose()

    const failing = bench({})
    await vi.waitFor(() => { expect(failing.current()).not.toBeNull() })
    const parent = failing.current()
    failing.setCreateError(new Error('side factory busy'))
    await expect(failing.ctx.blueSessionActions.createSideSession()).rejects.toThrow('side factory busy')
    expect(failing.current()).toBe(parent)
    await failing.ctx.fiber.dispose()
  })

  it('omits absent parent route fields and falls back to the process cwd for side sessions', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const parent = test.current()!
    ;(parent as unknown as { options: { provider?: string, model?: string } }).options = {}
    const side = await test.ctx.blueSessionActions.createSideSession()
    expect(side).toBeDefined()
    expect(test.recorded.created[1]!.agentOptions).toEqual({})
    expect(test.recorded.created[1]!.meta).toEqual({
      cwd: process.cwd(),
      parentSession: parent.id,
      seedLength: parent.session.events.length,
    })
    await side!.dispose()
    await test.ctx.fiber.dispose()
  })

  it('publishes the default model tier through the session reader', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(test.ctx.blueSessionReader.current()?.model)
      .toEqual({ provider: 'test-provider', id: 'test-model' })
    await test.ctx.fiber.dispose()
  })

  it('returns structured unavailable results and owns reader registrations without a live session', async () => {
    const test = bench({}, { createError: new Error('startup failed') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })

    const snapshots: Array<BlueSessionSnapshot | null> = []
    const registration = test.ctx.blueSessionReader.subscribe(snapshot => { snapshots.push(snapshot) })
    expect(snapshots).toEqual([null])
    expect(registration.disposed).toBe(false)
    registration.dispose()
    registration.dispose()
    expect(registration.disposed).toBe(true)

    await expect(test.ctx.blueSessionReader.request({ kind: 'followup', text: 'later' })).resolves.toMatchObject({
      ok: false,
      code: 'BLUE_SESSION_UNAVAILABLE',
    })
    expect(test.ctx.blueSessionProjections.current('status')).toBeUndefined()
    expect(test.ctx.blueSessionProjections.currentMany(['status'])).toBeUndefined()
    expect(test.ctx.blueSessionProjections.children('status')).toEqual([])
    const offProjection = test.ctx.blueSessionProjections.subscribe(() => {})
    const offChildren = test.ctx.blueSessionProjections.subscribeChildren(() => {})
    offProjection()
    offChildren()

    const actions = test.ctx.blueSessionActions
    expect(actions.followup([{ type: 'text', text: 'x' }])).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.steer([{ type: 'text', text: 'x' }])).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.interrupt()).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.queued()).toEqual([])
    await expect(actions.flush()).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.rewindCandidates()).toEqual([])
    expect(actions.commands()).toEqual([])
    await expect(actions.executeCommand('/help')).resolves.toBeUndefined()
    expect(actions.modeState()).toBeUndefined()
    expect(actions.setYolo(true)).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.permissionPreset()).toBeUndefined()
    expect(actions.sessionDetails()).toBeUndefined()
    expect(actions.modelSelection()).toBeUndefined()
    expect(actions.hasRequestHeader()).toBe(false)
    expect(actions.selectModel({ provider: 'p', model: 'm' })).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(actions.isCurrentAgent({})).toBe(false)
    expect(actions.steerCurrentAgent({}, 'no')).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    await expect(actions.presets()).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' })
    expect(actions.currentPreset()).toBeUndefined()
    await expect(actions.selectPreset('standard')).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    await expect(actions.toolCatalog()).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' })
    await expect(actions.skillSnapshot()).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    await expect(actions.createSideSession()).resolves.toBeUndefined()

    const skillChanges = vi.fn()
    const skillRegistration = actions.subscribeSkillChanges(skillChanges)
    expect(skillRegistration.disposed).toBe(false)
    test.ctx.emit('skills/change')
    expect(skillChanges).toHaveBeenCalledOnce()
    skillRegistration.dispose()
    skillRegistration.dispose()
    expect(skillRegistration.disposed).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('projects and executes the active reader/action surface without leaking the Agent', async () => {
    const flush = vi.fn(async () => {})
    const execute = vi.fn(async () => ({ result: { kind: 'success' as const, text: 'done' } }))
    const plan = { active: false, pending: false }
    const setPlan = vi.fn()
    const test = bench({}, {
      createHeaderConfig: { provider: 'header-provider', model: 'header-model' },
      setupContext(ctx) {
        ctx.provide('sessions', { list: () => [], flush } as never)
        ctx.provide('commands', {
          list: () => [
            { name: 'plain' },
            { name: 'full', description: 'desc', input: { hint: '<arg>' } },
          ],
          execute,
        } as never)
        ctx.provide('permissionPresets', { current: () => 'trusted' } as never)
        ctx.provide('planMode', { get: () => plan, set: setPlan } as never)
      },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const agent = test.current()!
    const inbox = agent.inbox as unknown as {
      nextTurn: unknown[]
      nextStep: unknown[]
    }
    const events = agent.session.events as unknown as unknown[]
    events.splice(0)
    Object.assign(agent.session.header, { id: 'header-id', cwd: '/repo', createdAt: 12 })
    ;(agent.session as unknown as { requestContext(): { contextWindow: number } }).requestContext = () => ({ contextWindow: 8192 })

    expect(test.ctx.blueSessionActions.commands()).toEqual([
      { name: 'plain' },
      { name: 'full', description: 'desc', inputHint: '<arg>' },
    ])
    await expect(test.ctx.blueSessionActions.executeCommand('/full x')).resolves.toEqual({
      result: { kind: 'success', text: 'done' },
    })
    expect(test.ctx.blueSessionActions.planModeAvailable()).toBe(true)
    expect(test.ctx.blueSessionActions.modeState()).toEqual({ mode: 'normal', pending: false })
    plan.active = true
    expect(test.ctx.blueSessionActions.modeState()).toEqual({ mode: 'plan', pending: false })
    plan.pending = true
    expect(test.ctx.blueSessionActions.modeState()).toEqual({ mode: 'plan', pending: true })
    expect(test.ctx.blueSessionActions.permissionPreset()).toBe('trusted')
    expect(test.ctx.blueSessionActions.sessionDetails()).toMatchObject({
      header: { id: 'header-id', cwd: '/repo', createdAt: 12 },
      status: 'idle',
    })

    const readerFollowup = await test.ctx.blueSessionReader.request({ kind: 'followup', text: 'reader followup' })
    const readerSteer = await test.ctx.blueSessionReader.request({ kind: 'steer', text: 'reader steer' })
    expect(readerFollowup.ok).toBe(true)
    expect(readerSteer.ok).toBe(true)
    expect(test.recorded.followups.at(-1)?.[1]).toMatchObject({ content: [{ text: 'reader followup' }] })
    expect(test.recorded.steers.at(-1)?.[1]).toMatchObject({ content: [{ text: 'reader steer' }] })
    await expect(test.ctx.blueSessionReader.request({ kind: 'interrupt' })).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED' })

    expect(test.ctx.blueSessionActions.followup([{ type: 'text', text: 'action followup' }]).ok).toBe(true)
    expect(test.ctx.blueSessionActions.steer([{ type: 'text', text: 'action steer' }]).ok).toBe(true)
    expect(test.ctx.blueSessionActions.interrupt()).toMatchObject({ code: 'BLUE_ACTION_REJECTED' })
    ;(agent as unknown as { status: string }).status = 'running'
    await expect(test.ctx.blueSessionReader.request({ kind: 'interrupt' })).resolves.toEqual({ ok: true, value: undefined })
    expect(test.ctx.blueSessionActions.interrupt()).toEqual({ ok: true, value: undefined })
    expect(test.recorded.cancels).toHaveLength(2)
    expect(test.ctx.blueSessionReader.current()).toMatchObject({ status: 'running' })
    ;(agent as unknown as { status: string }).status = 'idle'

    inbox.nextTurn.push({ id: 'empty', content: [{ type: 'image' }] })
    expect(test.ctx.blueSessionActions.queued()).toEqual([{ id: 'empty', target: 'turn', text: '' }])
    inbox.nextTurn.splice(0, 1, { id: 'turn', content: [{ type: 'text', text: 'turn text' }] })
    inbox.nextStep.push({ id: 'step', content: [{ type: 'text', text: 'step text' }, { type: 'text', text: 'two' }] })
    expect(test.ctx.blueSessionActions.queued()).toEqual([
      { id: 'turn', target: 'turn', text: 'turn text' },
      { id: 'step', target: 'step', text: 'step text\ntwo' },
    ])
    await expect(test.ctx.blueSessionActions.flush()).resolves.toEqual({ ok: true, value: undefined })
    expect(flush).toHaveBeenCalledWith(agent.session)

    expect(test.ctx.blueSessionActions.modelSelection()).toEqual({ provider: 'header-provider', model: 'header-model' })
    expect(test.ctx.blueSessionActions.hasRequestHeader()).toBe(true)
    expect(test.ctx.blueSessionActions.selectModel({ provider: 'next', model: 'model', reasoningEffort: 'high' })).toEqual({
      ok: true,
      value: { provider: 'header-provider', model: 'header-model' },
    })
    expect(test.ctx.blueSessionActions.modelSelection()).toEqual({
      provider: 'next',
      model: 'model',
      reasoningEffort: 'high',
    })
    expect(test.ctx.blueSessionActions.selectModel({ provider: 'plain', model: 'model' })).toEqual({
      ok: true,
      value: { provider: 'next', model: 'model', reasoningEffort: 'high' },
    })
    expect(test.ctx.blueSessionActions.modelSelection()).toEqual({ provider: 'plain', model: 'model' })
    expect(test.ctx.blueSessionActions.isCurrentAgent(agent)).toBe(true)
    expect(test.ctx.blueSessionActions.steerCurrentAgent({}, 'stale')).toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    expect(test.ctx.blueSessionActions.steerCurrentAgent(agent, 'accepted')).toEqual({ ok: true, value: undefined })

    expect(test.ctx.blueSessionActions.setYolo(true)).toEqual({ ok: true, value: undefined })
    expect(setPlan).toHaveBeenCalledWith(agent, false)
    expect(test.ctx.blueSessionActions.modeState()).toEqual({ mode: 'yolo', pending: false })
    const notices: string[] = []
    test.ctx.on('blue/mode-notice', text => { notices.push(text) })
    test.ctx.emit('session/event', agent.session, {
      type: 'plan/mode',
      seq: 1,
      time: 0,
      data: { active: true },
    } as never)
    await vi.waitFor(() => { expect(notices).toEqual(['done']) })
    expect(execute).toHaveBeenCalledWith(agent, '/yolo off', [], expect.any(AbortSignal))

    const warn = vi.spyOn(test.ctx.logger, 'warn').mockImplementation(() => {})
    execute.mockRejectedValueOnce(new Error('mode command failed'))
    test.ctx.emit('session/event', agent.session, {
      type: 'plan/mode',
      seq: 2,
      time: 0,
      data: { active: true },
    } as never)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('mode command failed')) })
    expect(test.ctx.blueSessionActions.setYolo(false)).toEqual({ ok: true, value: undefined })
    execute.mockResolvedValueOnce({ result: { kind: 'success' } })
    expect(test.ctx.blueSessionActions.setYolo(true)).toEqual({ ok: true, value: undefined })
    test.ctx.emit('session/event', agent.session, {
      type: 'plan/mode',
      seq: 3,
      time: 0,
      data: { active: true },
    } as never)
    await vi.waitFor(() => { expect(execute).toHaveBeenCalledTimes(4) })
    expect(notices).toEqual(['done'])
    expect(test.ctx.blueSessionActions.setYolo(false)).toEqual({ ok: true, value: undefined })
    test.ctx.emit('session/event', agent.session, {
      type: 'plan/mode',
      seq: 4,
      time: 0,
      data: { active: false },
    } as never)
    plan.pending = false
    plan.active = false

    const beforeChanges = test.changes.length
    const queueChanges = vi.fn()
    test.ctx.on('blue/queue-changed', queueChanges)
    test.ctx.emit('agent/status', { agent, status: 'idle' } as never)
    test.ctx.emit('agent/inbox/inserted', { agent } as never)
    test.ctx.emit('agent/inbox/claimed', { agent } as never)
    test.ctx.emit('agent/inbox/discarded', { agent } as never)
    test.ctx.emit('agent/inbox/inserted', { agent: {} } as never)
    test.ctx.emit('commands/change')
    expect(test.changes.length).toBe(beforeChanges + 2)
    expect(queueChanges).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(queueChanges).toHaveBeenCalledOnce()
    expect(test.changes.length).toBe(beforeChanges + 2)
    test.ctx.emit('session/event', {}, { type: 'turn/start', data: { turn: 1 } } as never)
    expect(test.ctx.blueRetractions.tryRetract('missing')).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it('interrupts all running continuable descendants while the active parent is idle', async () => {
    const interrupt = vi.fn()
    const test = bench({}, {
      setupContext(ctx) {
        ctx.provide('subagents', { interrupt } as never)
      },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const parent = test.current()!
    // Insert the grandchild first so lineage discovery needs a second pass.
    const grandchild = makeHandle('continuable-grandchild', test.recorded).agent
    Object.assign(grandchild.session.header, {
      origin: 'subagent',
      parentSession: 'continuable-child',
    })
    ;(grandchild as unknown as { status: string }).status = 'running'
    const child = makeHandle('continuable-child', test.recorded).agent
    Object.assign(child.session.header, {
      origin: 'subagent',
      parentSession: parent.id,
    })
    ;(child as unknown as { status: string }).status = 'running'
    const unrelated = makeHandle('unrelated', test.recorded).agent
    Object.assign(unrelated.session.header, { origin: 'subagent', parentSession: 'another-parent' })
    ;(unrelated as unknown as { status: string }).status = 'running'

    expect(test.ctx.blueSessionActions.interrupt()).toEqual({ ok: true, value: undefined })
    expect(test.recorded.cancels).toEqual([])
    expect(interrupt).toHaveBeenCalledTimes(2)
    expect(interrupt).toHaveBeenCalledWith(child.id, { kind: 'ancestor', agent: parent })
    expect(interrupt).toHaveBeenCalledWith(grandchild.id, { kind: 'ancestor', agent: parent })

    await test.ctx.fiber.dispose()
  })

  it('reports missing or rejected subagent interruption instead of claiming success', async () => {
    const absent = bench({}, {})
    await vi.waitFor(() => { expect(absent.current()).not.toBeNull() })
    const absentParent = absent.current()!
    const absentChild = makeHandle('uncontrolled-child', absent.recorded).agent
    Object.assign(absentChild.session.header, { origin: 'subagent', parentSession: absentParent.id })
    ;(absentChild as unknown as { status: string }).status = 'running'
    expect(absent.ctx.blueSessionActions.interrupt()).toMatchObject({
      code: 'BLUE_CAPABILITY_ABSENT',
      message: 'Subagent interruption is unavailable',
    })
    await absent.ctx.fiber.dispose()

    const interrupt = vi.fn((id: string) => {
      if (id === 'rejected-child') throw new Error('control denied')
    })
    const rejected = bench({}, {
      setupContext(ctx) {
        ctx.provide('subagents', { interrupt } as never)
      },
    })
    await vi.waitFor(() => { expect(rejected.current()).not.toBeNull() })
    const rejectedParent = rejected.current()!
    for (const id of ['rejected-child', 'accepted-child']) {
      const child = makeHandle(id, rejected.recorded).agent
      Object.assign(child.session.header, { origin: 'subagent', parentSession: rejectedParent.id })
      ;(child as unknown as { status: string }).status = 'running'
    }
    expect(rejected.ctx.blueSessionActions.interrupt()).toMatchObject({
      code: 'BLUE_ACTION_REJECTED',
      message: 'control denied',
    })
    expect(interrupt).toHaveBeenCalledTimes(2)

    await rejected.ctx.fiber.dispose()
  })

  it('drops a queued inbox notification after its session is replaced', async () => {
    const test = bench({}, {})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const previous = test.current()!
    const queueChanges = vi.fn()
    test.ctx.on('blue/queue-changed', queueChanges)
    let scheduled: VoidFunction | undefined
    const microtask = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      scheduled = callback
    })

    test.ctx.emit('agent/inbox/inserted', { agent: previous } as never)
    expect(scheduled).toBeTypeOf('function')
    microtask.mockRestore()
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.current()).not.toBe(previous) })
    scheduled?.()
    expect(queueChanges).not.toHaveBeenCalled()

    await test.ctx.fiber.dispose()
  })

  it('publishes current and direct-child projection cuts and rejects unrelated changes', async () => {
    let changed: ((session: unknown, key: string, value: unknown, seq: number) => void) | undefined
    const childSession = { header: { origin: 'subagent', parentSession: 'agent-1' } }
    const child = { id: 'child-1', ...childSession }
    const test = bench({}, {
      setupContext(ctx) {
        ctx.provide('sessionProjections', {
          snapshot: (session: unknown) => session === child
            ? { asOfSeq: 4, values: { todo: 'child' } }
            : { asOfSeq: 3, values: { todo: 'parent', activity: 'busy' } },
          onChanged: (listener: typeof changed) => { changed = listener; return vi.fn() },
        } as never)
        ctx.provide('sessions', {
          list: () => [
            { id: 'ordinary', header: {} },
            { id: 'wrong-parent', header: { origin: 'subagent', parentSession: 'other' } },
            { id: 3, header: { origin: 'subagent', parentSession: 'agent-1' } },
            child,
          ],
          flush: async () => {},
        } as never)
      },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(test.ctx.blueSessionProjections.current('todo')).toEqual({ asOfSeq: 3, value: 'parent' })
    expect(test.ctx.blueSessionProjections.currentMany(['todo', 'activity'])).toEqual({
      asOfSeq: 3,
      values: { todo: 'parent', activity: 'busy' },
    })
    expect(test.ctx.blueSessionProjections.children('todo')).toEqual([{ id: 'child-1', asOfSeq: 4, value: 'child' }])

    const parentChanges: unknown[] = []
    const childChanges: unknown[] = []
    const offParent = test.ctx.blueSessionProjections.subscribe((...args) => { parentChanges.push(args) })
    const offChild = test.ctx.blueSessionProjections.subscribeChildren(value => { childChanges.push(value) })
    changed?.(test.current()!.session, 'todo', 'next', 5)
    changed?.({}, 'todo', 'ignored', 6)
    changed?.(child, 'todo', 'child-next', 7)
    expect(parentChanges).toEqual([['todo', 'next', 5]])
    expect(childChanges).toEqual([{ id: 'child-1', key: 'todo', value: 'child-next', asOfSeq: 7 }])
    offParent()
    offChild()
    changed?.(test.current()!.session, 'todo', 'late', 8)
    changed?.(child, 'todo', 'late', 8)
    expect(parentChanges).toHaveLength(1)
    expect(childChanges).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('degrades optional active-session capabilities without pending the tree', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const actions = test.ctx.blueSessionActions
    expect(test.ctx.blueSessionProjections.current('missing')).toBeUndefined()
    expect(test.ctx.blueSessionProjections.currentMany(['missing'])).toBeUndefined()
    expect(test.ctx.blueSessionProjections.children('missing')).toEqual([])
    expect(actions.planModeAvailable()).toBe(false)
    expect(actions.currentPreset()).toBeUndefined()
    await expect(actions.selectPreset('standard')).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' })
    await expect(actions.toolCatalog()).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' })
    test.ctx.provide('tools', { schemas: () => [{ name: 'host', description: 'host tool' }] } as never)
    await expect(actions.toolCatalog()).resolves.toEqual({
      ok: true,
      value: {
        sessionLive: true,
        registered: [{ name: 'host', description: 'host tool' }],
        visible: [{ name: 'host', description: 'host tool' }],
      },
    })
    await expect(actions.skillSnapshot()).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' })
    expect(actions.commands()).toEqual([])
    await expect(actions.executeCommand('/missing')).resolves.toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('copies preset, tool, and skill capability data and reports failures and stale results', async () => {
    const list = vi.fn(async () => [
      { id: 'plain', trust: 'builtin' as const },
      { id: 'full', trust: 'user' as const, name: 'Full', description: 'desc', order: 2, broken: 'warning' },
    ])
    const recompose = vi.fn(async (_ctx: Context, id: string) => ({ id }))
    const composedPreset = vi.fn(() => 'full' as string | undefined)
    const standingKeyFor = vi.fn(async () => ({ scope: 'full' }))
    const schemas = vi.fn((scope?: unknown) => scope === undefined
      ? [
          { name: 'plain', description: 'plain tool' },
          { name: 'configured', description: 'configured tool', parameters: { type: 'object' } },
        ]
      : [{ name: 'visible', description: 'visible tool' }])
    const skillSnapshot = vi.fn(async () => ({
      complete: true,
      skills: [
        {
          name: 'plain',
          description: 'plain skill',
          source: 'builtin',
          invocation: { modelInvocable: true, userInvocable: false },
        },
        {
          name: 'guided',
          description: 'guided skill',
          whenToUse: 'when asked',
          source: 'user',
          invocation: { modelInvocable: false, userInvocable: true },
        },
      ],
    }))
    const roster = { mount: vi.fn(async () => 'full'), list, recompose, composedPreset, standingKeyFor }
    const test = bench({}, {
      roster,
      setupContext(ctx) {
        ctx.provide('tools', { schemas } as never)
        ctx.provide('skills', { snapshot: skillSnapshot } as never)
      },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const actions = test.ctx.blueSessionActions

    await expect(actions.presets()).resolves.toEqual({
      ok: true,
      value: [
        { id: 'plain', trust: 'builtin' },
        { id: 'full', trust: 'user', name: 'Full', description: 'desc', order: 2, broken: 'warning' },
      ],
    })
    expect(actions.currentPreset()).toBe('full')
    await expect(actions.selectPreset('plain')).resolves.toEqual({ ok: true, value: 'preset plain' })
    expect(test.recorded.appends.at(-1)).toEqual(['agent-preset/selected', { agentPreset: 'plain' }])

    ;(test.current() as unknown as { status: string }).status = 'running'
    await expect(actions.selectPreset('full')).resolves.toMatchObject({ message: 'cannot switch presets while the agent is running' })
    ;(test.current() as unknown as { status: string }).status = 'idle'
    ;(test.current()!.session.events as unknown as unknown[]).push({ type: 'turn/start' })
    await expect(actions.selectPreset('full')).resolves.toMatchObject({ message: expect.stringContaining('already started') })
    ;(test.current()!.session.events as unknown as unknown[]).splice(0)
    recompose.mockRejectedValueOnce(new Error('recompose failed'))
    await expect(actions.selectPreset('full')).resolves.toMatchObject({ message: 'recompose failed' })

    await expect(actions.toolCatalog()).resolves.toEqual({
      ok: true,
      value: {
        sessionLive: true,
        registered: [
          { name: 'plain', description: 'plain tool' },
          { name: 'configured', description: 'configured tool', parameters: { type: 'object' } },
        ],
        visible: [{ name: 'visible', description: 'visible tool' }],
      },
    })
    standingKeyFor.mockRejectedValueOnce(new Error('scope failed'))
    await expect(actions.toolCatalog()).resolves.toMatchObject({ message: 'could not resolve the preset composition: scope failed' })

    Object.assign(test.current()!.session.header, { cwd: '/skills' })
    await expect(actions.skillSnapshot()).resolves.toEqual({
      ok: true,
      value: {
        complete: true,
        skills: [
          {
            name: 'plain',
            description: 'plain skill',
            source: 'builtin',
            invocation: { modelInvocable: true, userInvocable: false },
          },
          {
            name: 'guided',
            description: 'guided skill',
            whenToUse: 'when asked',
            source: 'user',
            invocation: { modelInvocable: false, userInvocable: true },
          },
        ],
      },
    })
    expect(skillSnapshot).toHaveBeenCalledWith({ cwd: '/skills', scope: test.current() })
    skillSnapshot.mockRejectedValueOnce('skills failed')
    await expect(actions.skillSnapshot()).resolves.toMatchObject({ message: 'skills failed' })
    list.mockRejectedValueOnce(new Error('list failed'))
    await expect(actions.presets()).resolves.toMatchObject({ message: 'could not list presets: list failed' })
    await test.ctx.fiber.dispose()
  })

  it('rejects preset, tool, and skill completions after a session switch', async () => {
    let resolvePreset: ((value: { id: string }) => void) | undefined
    let resolveScope: ((value: object) => void) | undefined
    let resolveSkills: ((value: { complete: boolean, skills: never[] }) => void) | undefined
    const roster = {
      mount: vi.fn(async () => 'standard'),
      list: vi.fn(async () => []),
      recompose: vi.fn(() => new Promise<{ id: string }>(resolve => { resolvePreset = resolve })),
      composedPreset: vi.fn(() => 'standard'),
      standingKeyFor: vi.fn(() => new Promise<object>(resolve => { resolveScope = resolve })),
    }
    const test = bench({}, {
      roster,
      setupContext(ctx) {
        ctx.provide('tools', { schemas: () => [] } as never)
        ctx.provide('skills', {
          snapshot: () => new Promise<{ complete: boolean, skills: never[] }>(resolve => { resolveSkills = resolve }),
        } as never)
      },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })

    const preset = test.ctx.blueSessionActions.selectPreset('code')
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    resolvePreset?.({ id: 'code' })
    await expect(preset).resolves.toMatchObject({ code: 'BLUE_ABORTED' })

    const tools = test.ctx.blueSessionActions.toolCatalog()
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(3) })
    resolveScope?.({})
    await expect(tools).resolves.toMatchObject({ code: 'BLUE_ABORTED' })

    const skills = test.ctx.blueSessionActions.skillSnapshot()
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(4) })
    resolveSkills?.({ complete: true, skills: [] })
    await expect(skills).resolves.toMatchObject({ code: 'BLUE_ABORTED' })
    await test.ctx.fiber.dispose()
  })

  it('returns a host tool catalog without a live session', async () => {
    const test = bench({}, {
      createError: new Error('startup failed'),
      setupContext(ctx) {
        ctx.provide('tools', { schemas: () => [{ name: 'host', description: 'host tool' }] } as never)
        ctx.provide('sessionProjections', {
          snapshot: () => ({ asOfSeq: 0, values: {} }),
          onChanged: () => () => {},
        } as never)
        ctx.provide('sessions', { list: () => [], flush: async () => {} } as never)
      },
    })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    expect(test.ctx.blueSessionProjections.current('x')).toBeUndefined()
    expect(test.ctx.blueSessionProjections.currentMany(['x'])).toBeUndefined()
    expect(test.ctx.blueSessionProjections.children('x')).toEqual([])
    await expect(test.ctx.blueSessionActions.toolCatalog()).resolves.toEqual({
      ok: true,
      value: {
        sessionLive: false,
        registered: [{ name: 'host', description: 'host tool' }],
        visible: [{ name: 'host', description: 'host tool' }],
      },
    })
    await test.ctx.fiber.dispose()
  })

  it('fails the launch when the agent setup runs without a scoped agent', async () => {
    const ctx = new Context()
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    const recorded: Recorded = {
      created: [],
      resumed: [],
      resumeOptions: [],
      disposed: [],
      followups: [],
      steers: [],
      cancels: [],
      appends: [],
      agents: [],
      setups: 0,
      listeners: [],
    }
    ctx.provide('agents', {
      create: async (createOptions: CreateAgentOptions) => {
        // No scoped agent on the fake context: the setup must fail loud.
        await createOptions.setup?.(recordingAgentCtx(recorded))
        throw new Error('unreachable: the setup should have thrown')
      },
    } as never)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'p', model: 'm' }),
    } as never)
    apply(ctx, {})
    await vi.waitFor(() => { expect(exits).toEqual([1]) })
    expect(err).toContain('blue-app: agent setup ran without a scoped agent')
    await ctx.fiber.dispose()
  })

  it('resumes onto the session header\'s model, not the process default', async () => {
    const test = bench({ resume: 'abc123' }, {
      resumeHeaderConfig: { provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' },
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    // The header tier answers: the resumed session keeps the model it was
    // already using (the process default is test-provider/test-model).
    expect(test.ctx.blueSessionReader.current()?.model)
      .toEqual({ provider: 'mock', id: 'mock-pro', effort: 'high' })
    await test.ctx.fiber.dispose()
  })

  it('moves the reader to the switched Agent and restores the default model tier on /new', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.ctx.blueSessionReader.current()
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    const second = test.ctx.blueSessionReader.current()
    expect(second?.id).not.toBe(first?.id)
    // The fresh Agent has no logged header, so the new reference reads the
    // default tier.
    expect(second?.model).toEqual({ provider: 'test-provider', id: 'test-model' })
    await test.ctx.fiber.dispose()
  })

  it('keeps the live reader snapshot when a requested resume fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const live = test.ctx.blueSessionReader.current()
    test.setResumeError(new Error('no such session'))
    test.ctx.emit('blue/request-resume', 'gone')
    await vi.waitFor(() => { expect(test.err()).toContain('could not resume session gone') })
    expect(test.ctx.blueSessionReader.current()).toEqual(live)
    await test.ctx.fiber.dispose()
  })

  it('opens idle without a task', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(test.recorded.created).toHaveLength(1)
    expect(test.recorded.followups).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('maps every host turn close reason onto the request lifecycle', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const session = test.current()!.session
    const states: string[] = []
    test.ctx.on('blue/request-state-changed', lifecycle => { states.push(lifecycle.state) })
    const reasons = [
      { kind: 'aborted' },
      { kind: 'interrupted' },
      { kind: 'error', error: { message: 'boom' } },
      { kind: 'completed' },
    ] as const
    for (const reason of reasons) {
      test.ctx.blueRequests.begin()
      test.ctx.emit('session/event', session, {
        type: 'turn/end',
        seq: states.length + 1,
        time: 0,
        data: { turn: states.length + 1, reason },
      } as never)
    }
    expect(states.filter(state => state !== 'started')).toEqual([
      'interrupted',
      'interrupted',
      'failed',
      'completed',
    ])
    await test.ctx.fiber.dispose()
  })

  it('resumes the requested session instead of creating one', async () => {
    const test = bench({ resume: 'abc123' })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(test.recorded.created).toEqual([])
    expect(test.recorded.resumed).toEqual(['abc123'])
    // Startup resume carries the same model-selection setup as creation.
    expect(test.recorded.resumeOptions[0]!.setup).toBeDefined()
    expect(test.recorded.listeners).toEqual(['system-prompt/assemble', 'agent/request'])
    expect(test.changes.map(change => change.id)).toEqual([test.current()?.id])
    await test.ctx.fiber.dispose()
  })

  it('exits 1 with the diagnostic when startup creation fails', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    expect(test.err()).toBe('dsh: factory exploded\n')
    expect(test.current()).toBeNull()
    expect(test.changes).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('stringifies a non-Error startup failure', async () => {
    const test = bench({}, { createError: 'factory exploded' })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    expect(test.err()).toBe('dsh: factory exploded\n')
    await test.ctx.fiber.dispose()
  })

  it('stays silent when the tree lost its Agent services during settlement', async () => {
    const test = bench({}, { agents: false, defaultModel: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.exits).toEqual([])
    expect(test.err()).toBe('')
    expect(test.current()).toBeNull()
    // A late `/resume` against the same service-less tree is a no-op too.
    test.ctx.emit('blue/request-resume', 'abc123')
    test.ctx.emit('blue/request-new')
    test.ctx.emit('blue/request-fork')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.exits).toEqual([])
    expect(test.err()).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('stays silent when only the default model service is gone', async () => {
    const test = bench({}, { defaultModel: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.recorded.created).toEqual([])
    expect(test.exits).toEqual([])
    expect(test.err()).toBe('')
    // A `/resume` switch cannot compose model selection either; it is a no-op.
    test.ctx.emit('blue/request-resume', 'abc123')
    test.ctx.emit('blue/request-new')
    test.ctx.emit('blue/request-fork')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(test.recorded.resumed).toEqual([])
    expect(test.exits).toEqual([])
    expect(test.err()).toBe('')
    await test.ctx.fiber.dispose()
  })

  it('resumes without a dispose when startup never produced an Agent', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    test.ctx.emit('blue/request-resume', 'xyz789')
    await vi.waitFor(() => { expect(test.recorded.resumed).toEqual(['xyz789']) })
    await vi.waitFor(() => { expect(test.current()?.id).toBe('resumed-xyz789') })
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes.map(change => change.id)).toEqual([test.current()?.id])
    await test.ctx.fiber.dispose()
  })

  it('switches sessions on blue/request-resume: resume, dispose, publish', async () => {    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()
    test.ctx.emit('blue/request-resume', 'xyz789')
    await vi.waitFor(() => { expect(test.recorded.resumed).toEqual(['xyz789']) })
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    expect(test.recorded.disposed).toEqual(['agent-1'])
    // The `/resume` switch also wires model selection onto the resumed Agent.
    expect(test.recorded.resumeOptions[0]!.setup).toBeDefined()
    expect(test.recorded.listeners).toEqual([
      'system-prompt/assemble', 'agent/request',
      'system-prompt/assemble', 'agent/request',
    ])
    const next = test.current()
    expect(next).not.toBe(first)
    expect(test.changes[1]?.id).toBe(next?.id)
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session when a requested resume fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()
    test.setResumeError(new Error('no such session'))
    test.ctx.emit('blue/request-resume', 'gone')
    await vi.waitFor(() => { expect(test.err()).toContain('could not resume session gone: no such session') })
    expect(test.current()).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('keeps the queue alive when disposing the previous Agent fails', async () => {
    const test = bench({}, { createDisposeError: new Error('dispose blew up') })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    test.ctx.emit('blue/request-resume', 'xyz789')
    await vi.waitFor(() => { expect(test.err()).toContain('dispose blew up') })
    // The switch never committed; a later successful resume still runs.
    test.ctx.emit('blue/request-resume', 'abc123')
    await vi.waitFor(() => { expect(test.recorded.resumed).toEqual(['xyz789', 'abc123']) })
    await vi.waitFor(() => { expect(test.current()?.id).toBe('resumed-abc123') })
    await test.ctx.fiber.dispose()
  })

  it('starts a fresh session on blue/request-new: create, dispose, publish', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    expect(test.recorded.created).toHaveLength(2)
    // The `/new` switch creates with the same parameters as startup creation.
    const created = test.recorded.created[1]!
    expect(String(created.sessionId)).toMatch(/^session-/)
    expect(created.meta).toEqual({ cwd: process.cwd() })
    expect(created.agentOptions).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(created.setup).toBeDefined()
    expect(test.recorded.disposed).toEqual(['agent-1'])
    const next = test.current()
    expect(next?.id).toBe('agent-2')
    expect(next).not.toBe(first)
    expect(test.changes[1]?.id).toBe(next?.id)
    await test.ctx.fiber.dispose()
  })

  it('creates without a dispose on blue/request-new when startup never produced an Agent', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    test.setCreateError(undefined)
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.current()?.id).toBe('agent-1') })
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes.map(change => change.id)).toEqual([test.current()?.id])
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session when a requested new session fails to create', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()
    test.setCreateError(new Error('factory busy'))
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.err()).toContain('could not start a new session: factory busy') })
    expect(test.current()).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('forks the live session on blue/request-fork with seed and lineage', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()!
    const seed = first.session.events
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    expect(test.recorded.created).toHaveLength(2)
    const forked = test.recorded.created[1]!
    expect(String(forked.sessionId)).toMatch(/^session-/)
    // The full parent event prefix is the seed; the header cwd falls back to
    // the process cwd when the fake session header carries none.
    expect(forked.seed).toBe(seed)
    expect(forked.meta).toEqual({
      cwd: process.cwd(),
      parentSession: first.id,
      seedLength: seed.length,
    })
    expect(forked.agentOptions).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(forked.setup).toBeDefined()
    expect(test.recorded.disposed).toEqual(['agent-1'])
    const next = test.current()
    expect(next?.id).toBe('agent-2')
    expect(test.changes[1]?.id).toBe(next?.id)
    await test.ctx.fiber.dispose()
  })

  it('inherits the session header cwd when forking', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()!
    ;(first.session.header as { cwd?: string }).cwd = '/tmp/fork-cwd'
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    expect(test.recorded.created[1]!.meta).toMatchObject({ cwd: '/tmp/fork-cwd' })
    await test.ctx.fiber.dispose()
  })

  it('refuses to fork while the live Agent is running', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()!
    ;(first as unknown as { status: string }).status = 'running'
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.err()).toContain('cannot fork session agent-1 while it is running') })
    expect(test.recorded.created).toHaveLength(1)
    expect(test.current()).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('refuses to fork when no session is live', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.err()).toContain('no live session to fork') })
    expect(test.recorded.created).toEqual([])
    expect(test.changes).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session when a fork creation fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()
    test.setCreateError(new Error('factory busy'))
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.err()).toContain('could not fork session agent-1: factory busy') })
    expect(test.current()).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('creates a rewind child from the requested complete prefix', async () => {
    const test = bench({}, {
      sessionEvents: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      ],
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()!
    test.ctx.emit('blue/request-rewind', String(first.id), 0)
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    const created = test.recorded.created[1]!
    expect(created.seed).toEqual([])
    expect(created.meta).toEqual({ cwd: process.cwd(), parentSession: first.id, seedLength: 0 })
    expect(test.current()?.id).toBe('agent-2')
    await test.ctx.fiber.dispose()
  })

  it('rejects stale, unbalanced, and running rewind requests', async () => {
    const test = bench({}, {
      sessionEvents: [{ type: 'turn/start', data: { turn: 1 } }],
    })
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const first = test.current()!
    test.ctx.emit('blue/request-rewind', 'other-session', 0)
    await vi.waitFor(() => { expect(test.err()).toContain('rewind request is stale') })
    test.ctx.emit('blue/request-rewind', String(first.id), first.session.events.length)
    await vi.waitFor(() => { expect(test.err()).toContain('cannot rewind session') })
    ;(first as unknown as { status: string }).status = 'running'
    test.ctx.emit('blue/request-rewind', String(first.id), 0)
    await vi.waitFor(() => { expect(test.err()).toContain('while it is running') })
    expect(test.recorded.created).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('refuses rewind without a live session or its injected services', async () => {
    const failed = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(failed.exits).toEqual([1]) })
    failed.ctx.emit('blue/request-rewind', 'missing', 0)
    await vi.waitFor(() => { expect(failed.err()).toContain('no live session to rewind') })
    await failed.ctx.fiber.dispose()

    const missingService = bench({}, { agents: false })
    missingService.ctx.emit('blue/request-rewind', 'missing', 0)
    await vi.waitFor(() => { expect(missingService.recorded.created).toEqual([]) })
    await missingService.ctx.fiber.dispose()
  })

  it('keeps the parent session when rewind creation fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    const parent = test.current()!
    test.setCreateError(new Error('rewind factory busy'))
    test.ctx.emit('blue/request-rewind', String(parent.id), 0)
    await vi.waitFor(() => { expect(test.err()).toContain('could not rewind session agent-1: rewind factory busy') })
    expect(test.current()).toBe(parent)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('validates config: both launch values are optional strings', () => {
    expect(new Config({})).toEqual({})
    expect(new Config({ task: 'x', resume: 'y' })).toEqual({ task: 'x', resume: 'y' })
    expect(() => new Config({ task: 1 } as never)).toThrow()
  })

  describe('preset mount (thin-host migration)', () => {
    it('creates without mounting when no roster is composed', async () => {
      // The default bench provisions no roster: every other test in this file
      // exercises this path, asserted here explicitly for the migration.
      const test = bench({})
      await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
      expect(test.exits).toEqual([])
      expect(test.err()).toBe('')
      await test.ctx.fiber.dispose()
    })

    it('mounts the roster default when the fresh session names no preset', async () => {
      const mount = vi.fn(async () => 'standard')
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
      expect(mount).toHaveBeenCalledTimes(1)
      // The setup's own agent context is the mount target; the fresh session's
      // log and header name nothing, so the roster default resolves (undefined id).
      expect(mount.mock.calls[0]![1]).toBeUndefined()
      await test.ctx.fiber.dispose()
    })

    it('re-mounts the preset the session log names, the header losing', async () => {
      const mount = vi.fn(async () => 'minimal')
      const test = bench({ resume: 'abc123' }, {
        roster: { mount },
        headerAgentPreset: 'standard',
        sessionEvents: [
          { type: 'user/message' },
          { type: 'agent-preset/selected', data: { agentPreset: 'standard' } },
          { type: 'agent-preset/selected', data: { agentPreset: 'minimal' } },
        ],
      })
      await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
      // The newest selection wins over the creation header.
      expect(mount).toHaveBeenCalledTimes(1)
      expect(mount.mock.calls[0]![1]).toBe('minimal')
      await test.ctx.fiber.dispose()
    })

    it('falls back to the creation header when the log has no selection', async () => {
      const mount = vi.fn(async () => 'code')
      const test = bench({ resume: 'abc123' }, {
        roster: { mount },
        headerAgentPreset: 'code',
        sessionEvents: [{ type: 'user/message' }],
      })
      await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
      expect(mount.mock.calls[0]![1]).toBe('code')
      await test.ctx.fiber.dispose()
    })

    it('mounts through the /new switch with the same setup', async () => {
      const mount = vi.fn(async () => 'standard')
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
      test.ctx.emit('blue/request-new')
      await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(2) })
      await test.ctx.fiber.dispose()
    })

    it('fails the launch when the mount rejects', async () => {
      const mount = vi.fn(async () => { throw new Error('preset root unreadable') })
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
      expect(test.err()).toContain('preset root unreadable')
      expect(test.current()).toBeNull()
      await test.ctx.fiber.dispose()
    })
  })
})

describe('exit epitaph (D47)', () => {
  it('arms on tree dispose with the live session id and the default profile', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.current()).not.toBeNull() })
    expect(armedEpitaph()).toBeUndefined()
    await test.ctx.fiber.dispose()
    // The fake handle's id and the test argv (no --profile) name the line.
    expect(armedEpitaph()).toBe(epitaphFor('agent-1', 'blue'))
  })

  it('arms nothing for a session without events and for no session at all', async () => {
    const eventless = bench({}, { sessionEvents: [] })
    await vi.waitFor(() => { expect(eventless.current()).not.toBeNull() })
    await eventless.ctx.fiber.dispose()
    expect(armedEpitaph()).toBeUndefined()
    // No agents service mounted: the startup chain returns early and the
    // session reference stays null through dispose.
    const bare = bench({}, { agents: false })
    await bare.ctx.fiber.dispose()
    expect(armedEpitaph()).toBeUndefined()
  })

  it('flushes the armed text through the writer and skips when unarmed', () => {
    const written: string[] = []
    setExitEpitaphWriter(text => { written.push(text) })
    try {
      armExitEpitaph('farewell')
      writeArmedEpitaph()
      expect(written).toEqual(['farewell'])
      armExitEpitaph(undefined)
      writeArmedEpitaph()
      expect(written).toEqual(['farewell'])
    } finally {
      setExitEpitaphWriter(undefined)
    }
  })

  it('restores the plain synchronous stdout writer on an undefined seam', () => {
    setExitEpitaphWriter(undefined)
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      armExitEpitaph('to stdout')
      writeArmedEpitaph()
      expect(write).toHaveBeenCalledWith('to stdout')
    } finally {
      write.mockRestore()
    }
  })

  it('keeps a single slot: the latest arm wins (HMR remounts)', () => {
    armExitEpitaph('first')
    armExitEpitaph('second')
    expect(armedEpitaph()).toBe('second')
  })

  it('reads the profile from both launcher flag forms, defaulting to blue', () => {
    expect(profileFromArgv(['dsh'])).toBe('blue')
    expect(profileFromArgv(['dsh', '--profile', 'tui', '--resume', 'x'])).toBe('tui')
    expect(profileFromArgv(['dsh', '--profile=cc-tui'])).toBe('cc-tui')
    // A flag-shaped follower is not a profile name.
    expect(profileFromArgv(['dsh', '--profile', '--resume', 'x'])).toBe('blue')
    expect(profileFromArgv(['dsh', '--profile'])).toBe('blue')
  })

  it('puts the resume command on its own line for a triple-click copy', () => {
    expect(epitaphFor('session-abc', 'blue')).toBe(
      'blue · session saved · resume with:\ndsh --profile blue --resume session-abc\n',
    )
  })
})
