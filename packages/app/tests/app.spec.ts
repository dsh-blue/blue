/**
 * The Blue app driver: startup create/resume, blueSession publication, the
 * session-changed broadcast, and `/resume` switching over fake core services.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import { apply, Config, internals } from '../src/index.ts'

const originalStderr = internals.stderr
afterEach(() => { internals.stderr = originalStderr })

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
 * @returns the fake agent scope.
 */
function recordingAgentCtx(recorded: Recorded): Context {
  return {
    on: (event: string) => {
      recorded.listeners.push(event)
      return () => {}
    },
  } as never
}

/** Build an owned handle for a fake Agent that records its teardown and prompts. */
function makeHandle(id: string, recorded: Recorded, disposeError?: Error): AgentHandle {
  const agent = {
    id,
    status: 'idle',
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
} = {}): Bench {
  const ctx = new Context()
  let err = ''
  internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
  const exits: number[] = []
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  const recorded: Recorded = { created: [], resumed: [], resumeOptions: [], disposed: [], followups: [], setups: 0, listeners: [] }
  let resumeError: Error | undefined
  if (options.agents !== false) {
    ctx.provide('agents', {
      create: async (createOptions: CreateAgentOptions) => {
        if (options.createError !== undefined) throw options.createError
        recorded.created.push(createOptions)
        await createOptions.setup?.(recordingAgentCtx(recorded))
        recorded.setups += 1
        return makeHandle(`agent-${recorded.created.length}`, recorded, options.createDisposeError)
      },
      resume: async (resumeOptions: ResumeAgentOptions) => {
        if (resumeError !== undefined) throw resumeError
        recorded.resumed.push(String(resumeOptions.resumeSessionId))
        recorded.resumeOptions.push(resumeOptions)
        await resumeOptions.setup?.(recordingAgentCtx(recorded))
        return makeHandle(`resumed-${String(resumeOptions.resumeSessionId)}`, recorded)
      },
    } as never)
  }
  if (options.defaultModel !== false) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'test-provider', model: 'test-model' }),
    } as never)
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

  it('validates config: both launch values are optional strings', () => {
    expect(new Config({})).toEqual({})
    expect(new Config({ task: 'x', resume: 'y' })).toEqual({ task: 'x', resume: 'y' })
    expect(() => new Config({ task: 1 } as never)).toThrow()
  })
})
