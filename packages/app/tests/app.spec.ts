/**
 * The Blue app driver: startup create/resume, blueSession publication, the
 * session-changed broadcast, `/resume`/`/new`/`/fork` switching, and the
 * exit epitaph (D47) over fake core services.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
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
  const agent = {
    id,
    status: 'idle',
    session: {
      events: presetSeed?.events ?? [{ type: 'user/message' }, { type: 'assistant/message' }],
      header: presetSeed?.header === undefined ? {} : { agentPreset: presetSeed.header },
      requestHeader: () => (headerConfig === undefined ? undefined : { config: headerConfig }),
    },
    followup: (message: unknown) => { recorded.followups.push([id, message]) },
  } as unknown as Agent
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
  changes: Agent[]
  exits: number[]
  err(): string
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
} = {}): Bench {
  const ctx = new Context()
  let err = ''
  internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
  const exits: number[] = []
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  const recorded: Recorded = { created: [], resumed: [], resumeOptions: [], disposed: [], followups: [], setups: 0, listeners: [] }
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
  const changes: Agent[] = []
  ctx.on('blue/session-changed', (agent) => { changes.push(agent) })
  apply(ctx, config)
  return {
    ctx,
    recorded,
    changes,
    exits,
    err: () => err,
    setResumeError: (error) => { resumeError = error },
    setCreateError: (error) => { createError = error },
  }
}

describe('blue app driver', () => {
  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, {}) }).toThrow('must provide ctx.appExit')
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
    const agent = test.ctx.blueSession.current
    expect(agent).not.toBeNull()
    expect(test.changes).toEqual([agent])
    const [id, message] = test.recorded.followups[0]!
    expect(id).toBe('agent-1')
    expect(message).toMatchObject({
      content: [{ type: 'text', text: 'fix the build' }],
      source: { kind: 'user' },
    })
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('publishes the model-selection handle with the Agent, reading the default tier', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const modelRef = test.ctx.blueSession.modelRef
    expect(modelRef).toBeDefined()
    expect(modelRef!.current).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(modelRef!.assembled).toBeUndefined()
    await test.ctx.fiber.dispose()
  })

  it('fails the launch when the agent setup runs without a scoped agent', async () => {
    const ctx = new Context()
    let err = ''
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exits: number[] = []
    ctx.provide('appExit', (code: number) => { exits.push(code) })
    const recorded: Recorded = { created: [], resumed: [], resumeOptions: [], disposed: [], followups: [], setups: 0, listeners: [] }
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
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    // The header tier answers: the resumed session keeps the model it was
    // already using (the process default is test-provider/test-model).
    expect(test.ctx.blueSession.modelRef!.current)
      .toEqual({ provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' })
    await test.ctx.fiber.dispose()
  })

  it('moves modelRef to the switched Agent and back to the default tier on /new', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.modelRef!
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    const second = test.ctx.blueSession.modelRef!
    expect(second).not.toBe(first)
    // The fresh Agent has no logged header, so the new reference reads the
    // default tier.
    expect(second.current).toEqual({ provider: 'test-provider', model: 'test-model' })
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session\'s modelRef when a requested resume fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const live = test.ctx.blueSession.modelRef
    test.setResumeError(new Error('no such session'))
    test.ctx.emit('blue/request-resume', 'gone')
    await vi.waitFor(() => { expect(test.err()).toContain('could not resume session gone') })
    expect(test.ctx.blueSession.modelRef).toBe(live)
    await test.ctx.fiber.dispose()
  })

  it('opens idle without a task', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    expect(test.recorded.created).toHaveLength(1)
    expect(test.recorded.followups).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('resumes the requested session instead of creating one', async () => {
    const test = bench({ resume: 'abc123' })
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    expect(test.recorded.created).toEqual([])
    expect(test.recorded.resumed).toEqual(['abc123'])
    // Startup resume carries the same model-selection setup as creation.
    expect(test.recorded.resumeOptions[0]!.setup).toBeDefined()
    expect(test.recorded.listeners).toEqual(['system-prompt/assemble', 'agent/request'])
    expect(test.changes).toEqual([test.ctx.blueSession.current])
    await test.ctx.fiber.dispose()
  })

  it('exits 1 with the diagnostic when startup creation fails', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    expect(test.err()).toBe('dsh: factory exploded\n')
    expect(test.ctx.blueSession.current).toBeNull()
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
    expect(test.ctx.blueSession.current).toBeNull()
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
    await vi.waitFor(() => { expect(test.ctx.blueSession.current?.id).toBe('resumed-xyz789') })
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toEqual([test.ctx.blueSession.current])
    await test.ctx.fiber.dispose()
  })

  it('switches sessions on blue/request-resume: resume, dispose, publish', async () => {    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current
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
    const next = test.ctx.blueSession.current
    expect(next).not.toBe(first)
    expect(test.changes[1]).toBe(next)
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session when a requested resume fails', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current
    test.setResumeError(new Error('no such session'))
    test.ctx.emit('blue/request-resume', 'gone')
    await vi.waitFor(() => { expect(test.err()).toContain('could not resume session gone: no such session') })
    expect(test.ctx.blueSession.current).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('keeps the queue alive when disposing the previous Agent fails', async () => {
    const test = bench({}, { createDisposeError: new Error('dispose blew up') })
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    test.ctx.emit('blue/request-resume', 'xyz789')
    await vi.waitFor(() => { expect(test.err()).toContain('dispose blew up') })
    // The switch never committed; a later successful resume still runs.
    test.ctx.emit('blue/request-resume', 'abc123')
    await vi.waitFor(() => { expect(test.recorded.resumed).toEqual(['xyz789', 'abc123']) })
    await vi.waitFor(() => { expect(test.ctx.blueSession.current?.id).toBe('resumed-abc123') })
    await test.ctx.fiber.dispose()
  })

  it('starts a fresh session on blue/request-new: create, dispose, publish', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current
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
    const next = test.ctx.blueSession.current
    expect(next?.id).toBe('agent-2')
    expect(next).not.toBe(first)
    expect(test.changes[1]).toBe(next)
    await test.ctx.fiber.dispose()
  })

  it('creates without a dispose on blue/request-new when startup never produced an Agent', async () => {
    const test = bench({}, { createError: new Error('factory exploded') })
    await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
    test.setCreateError(undefined)
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.ctx.blueSession.current?.id).toBe('agent-1') })
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toEqual([test.ctx.blueSession.current])
    await test.ctx.fiber.dispose()
  })

  it('keeps the live session when a requested new session fails to create', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current
    test.setCreateError(new Error('factory busy'))
    test.ctx.emit('blue/request-new')
    await vi.waitFor(() => { expect(test.err()).toContain('could not start a new session: factory busy') })
    expect(test.ctx.blueSession.current).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('forks the live session on blue/request-fork with seed and lineage', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current!
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
    const next = test.ctx.blueSession.current
    expect(next?.id).toBe('agent-2')
    expect(test.changes[1]).toBe(next)
    await test.ctx.fiber.dispose()
  })

  it('inherits the session header cwd when forking', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current!
    ;(first.session.header as { cwd?: string }).cwd = '/tmp/fork-cwd'
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.changes).toHaveLength(2) })
    expect(test.recorded.created[1]!.meta).toMatchObject({ cwd: '/tmp/fork-cwd' })
    await test.ctx.fiber.dispose()
  })

  it('refuses to fork while the live Agent is running', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current!
    ;(first as unknown as { status: string }).status = 'running'
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.err()).toContain('cannot fork session agent-1 while it is running') })
    expect(test.recorded.created).toHaveLength(1)
    expect(test.ctx.blueSession.current).toBe(first)
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
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    const first = test.ctx.blueSession.current
    test.setCreateError(new Error('factory busy'))
    test.ctx.emit('blue/request-fork')
    await vi.waitFor(() => { expect(test.err()).toContain('could not fork session agent-1: factory busy') })
    expect(test.ctx.blueSession.current).toBe(first)
    expect(test.recorded.disposed).toEqual([])
    expect(test.changes).toHaveLength(1)
    expect(test.exits).toEqual([])
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
      await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
      expect(test.exits).toEqual([])
      expect(test.err()).toBe('')
      await test.ctx.fiber.dispose()
    })

    it('mounts the roster default when the fresh session names no preset', async () => {
      const mount = vi.fn(async () => 'standard')
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
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
      await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
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
      await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
      expect(mount.mock.calls[0]![1]).toBe('code')
      await test.ctx.fiber.dispose()
    })

    it('mounts through the /new switch with the same setup', async () => {
      const mount = vi.fn(async () => 'standard')
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
      test.ctx.emit('blue/request-new')
      await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(2) })
      await test.ctx.fiber.dispose()
    })

    it('fails the launch when the mount rejects', async () => {
      const mount = vi.fn(async () => { throw new Error('preset root unreadable') })
      const test = bench({}, { roster: { mount } })
      await vi.waitFor(() => { expect(test.exits).toEqual([1]) })
      expect(test.err()).toContain('preset root unreadable')
      expect(test.ctx.blueSession.current).toBeNull()
      await test.ctx.fiber.dispose()
    })
  })
})

describe('exit epitaph (D47)', () => {
  it('arms on tree dispose with the live session id and the default profile', async () => {
    const test = bench({})
    await vi.waitFor(() => { expect(test.ctx.blueSession.current).not.toBeNull() })
    expect(armedEpitaph()).toBeUndefined()
    await test.ctx.fiber.dispose()
    // The fake handle's id and the test argv (no --profile) name the line.
    expect(armedEpitaph()).toBe(epitaphFor('agent-1', 'blue'))
  })

  it('arms nothing for a session without events and for no session at all', async () => {
    const eventless = bench({}, { sessionEvents: [] })
    await vi.waitFor(() => { expect(eventless.ctx.blueSession.current).not.toBeNull() })
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
