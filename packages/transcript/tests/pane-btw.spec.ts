/**
 * `blue-pane-btw` plugin: the side-question pane and its `/btw` command.
 * Covers the command's error branches (no session, creation failure), the
 * seeded side-agent creation, the streaming/finalize reply rendering with
 * the thinking row, dismissal and single-slot replacement, the row cap and
 * width rules, and the unloaded-mid-creation guard.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import * as btw from '../src/pane-btw.ts'
import {
  assistantEvent,
  reasoningDelta,
  resetSeq,
  textDelta,
  userEvent,
} from './helpers.ts'
import { bootPanePlugin, type PaneFakeCommands, type PanePluginHarness } from './pane-fakes.ts'
import { asAgent, fakeAgent, type FakeAgent } from './status-fakes.ts'

/** Structural stand-in for the side agent the fake `agents` factory returns. */
interface FakeSideAgent {
  id: SessionId
  status: 'idle' | 'running'
  options: { model?: string }
  session: { events: SessionEvent[], header: { cwd?: string } }
  followups: UserMessage[]
  followup(message: UserMessage): void
}

/** One fake side agent plus its handle and disposal count. */
interface FakeSide {
  agent: FakeSideAgent
  handle: AgentHandle
  disposed: number
}

/** Build one fake side agent/handle pair for a creation request. */
function makeSide(options: CreateAgentOptions): FakeSide {
  const agent: FakeSideAgent = {
    id: options.sessionId,
    status: 'running',
    options: {},
    session: { events: [], header: {} },
    followups: [],
    followup(message) {
      this.followups.push(message)
    },
  }
  const side = {
    agent,
    disposed: 0,
  } as FakeSide
  side.handle = {
    agent: agent as unknown as Agent,
    dispose: () => {
      side.disposed += 1
      return Promise.resolve()
    },
  }
  return side
}

/** Fake `agents` registry: records creations; can fail or hold the next one. */
class FakeAgents {
  readonly creates: CreateAgentOptions[] = []
  readonly sides: FakeSide[] = []
  failure: unknown
  hold = false
  private pendingResolve: (() => void) | undefined

  get pending(): boolean {
    return this.pendingResolve !== undefined
  }

  create(options: CreateAgentOptions): Promise<AgentHandle> {
    this.creates.push(options)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const side = makeSide(options)
    this.sides.push(side)
    if (this.hold) {
      return new Promise((resolve) => {
        this.pendingResolve = () => resolve(side.handle)
      })
    }
    return Promise.resolve(side.handle)
  }

  /** Fulfill the held creation. */
  resolvePending(): void {
    const resolve = this.pendingResolve
    this.pendingResolve = undefined
    resolve?.()
  }
}

/**
 * Boot the plugin with the fake registry provided as `agents`.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param agents - the fake registry.
 */
async function boot(current: FakeAgent | null, agents: FakeAgents): Promise<PanePluginHarness> {
  return bootPanePlugin(btw, current, { agents })
}

/** Invoke `/btw` with the given raw input. */
function run(commands: PaneFakeCommands, rawInput: string): Promise<unknown> {
  return Promise.resolve(commands.run('btw', rawInput))
}

describe('blue-pane-btw', () => {
  it('registers the /btw command and mounts a closed pane', async () => {
    const agents = new FakeAgents()
    const { screen, commands, dispose } = await boot(fakeAgent([]), agents)
    expect(btw.name).toBe('blue-pane-btw')
    const definition = commands.definitions.get('btw')
    expect(definition?.description).toBe('Ask a side question in a forked session')
    expect(definition?.input).toEqual({ hint: '<question>' })
    expect(screen.bottomChildren).toHaveLength(1)
    expect(screen.paneLines()).toEqual([])
    await dispose()
    expect(commands.definitions.size).toBe(0)
    expect(screen.bottomChildren).toHaveLength(0)
  })

  it('errors without an active session', async () => {
    const agents = new FakeAgents()
    const { commands, dispose } = await boot(null, agents)
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'no active session for a side question',
    })
    expect(agents.creates).toHaveLength(0)
    await dispose()
  })

  it('reports creation failures, Error or not', async () => {
    const agents = new FakeAgents()
    const { commands, screen, dispose } = await boot(fakeAgent([]), agents)
    agents.failure = new Error('no adapter')
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'could not start the side session: no adapter',
    })
    agents.failure = 'plain rejection'
    expect(await run(commands, 'hello')).toEqual({
      kind: 'error',
      text: 'could not start the side session: plain rejection',
    })
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })

  it('asks a seeded side question, streams, finalizes, and settles', async () => {
    resetSeq()
    const current = fakeAgent([userEvent('parent work')], { cwd: '/repo' })
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(current, agents)

    expect(await run(commands, 'what is x?')).toEqual({ kind: 'success', text: 'asked the side question' })
    const options = agents.creates[0]!
    expect(String(options.sessionId)).toMatch(/^btw-/)
    expect(options.seed).toBe(current.session.events)
    expect(options.meta).toEqual({ cwd: '/repo', parentSession: current.id, seedLength: 1 })

    const side = agents.sides[0]!
    expect(side.agent.followups).toHaveLength(1)
    expect(side.agent.followups[0]!.content).toEqual([{ type: 'text', text: 'what is x?' }])
    expect(side.agent.followups[0]!.source).toEqual({ kind: 'user' })
    expect(screen.paneLines()).toEqual(['› what is x?', 'thinking…'])

    // Text deltas accumulate; other sessions, reasoning deltas, and
    // non-assistant events are ignored.
    const session = side.agent.session as unknown as Session
    ctx.emit('session/event', session, textDelta(1, 1, 'x is '))
    ctx.emit('session/event', session, textDelta(1, 1, 'a letter'))
    expect(screen.paneLines()).toEqual(['› what is x?', 'x is a letter', 'thinking…'])
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', fakeAgent([]).session as unknown as Session, textDelta(1, 1, 'stray'))
    ctx.emit('session/event', session, reasoningDelta(1, 1, 'hmm'))
    ctx.emit('session/event', session, userEvent('echo'))
    expect(screen.renderRequests.length).toBe(baseline)

    // The finalize rewrites the accumulation authoritatively, dropping
    // non-text blocks.
    ctx.emit('session/event', session, assistantEvent(1, 1, [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'x is the 24th letter' },
    ]))
    expect(screen.paneLines()).toEqual(['› what is x?', 'x is the 24th letter', 'thinking…'])

    // Only the side agent's own idle flip settles the thinking row.
    ctx.emit('agent/status', { agent: asAgent(fakeAgent([])), status: 'idle' })
    ctx.emit('agent/status', { agent: side.handle.agent, status: 'running' })
    expect(screen.paneLines()).toHaveLength(3)
    ctx.emit('agent/status', { agent: side.handle.agent, status: 'idle' })
    expect(screen.paneLines()).toEqual(['› what is x?', 'x is the 24th letter'])

    // Unloading disposes the live side agent.
    await dispose()
    expect(side.disposed).toBe(1)
  })

  it('hands the side agent the parent route as agentOptions', async () => {
    resetSeq()
    const current = fakeAgent([], { provider: 'mock', model: 'mock-1' })
    const agents = new FakeAgents()
    const { commands, dispose } = await boot(current, agents)
    await run(commands, 'q?')
    expect(agents.creates[0]!.agentOptions).toEqual({ provider: 'mock', model: 'mock-1' })
    await dispose()
  })

  it('dismisses with bare /btw and refuses a second dismiss', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    expect(screen.paneLines()).toEqual(['› first?', 'thinking…'])

    expect(await run(commands, '')).toEqual({ kind: 'success', text: 'dismissed the side question' })
    expect(side.disposed).toBe(1)
    expect(screen.paneLines()).toEqual([])

    // The dismissed agent's subscriptions are unbound.
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', side.agent.session as unknown as Session, textDelta(1, 1, 'late'))
    ctx.emit('agent/status', { agent: side.handle.agent, status: 'idle' })
    expect(screen.renderRequests.length).toBe(baseline)

    expect(await run(commands, '   ')).toEqual({ kind: 'error', text: 'no side question is open' })
    await dispose()
  })

  it('replaces the open side question on a new /btw', async () => {
    resetSeq()
    const current = fakeAgent([userEvent('parent work')])
    const agents = new FakeAgents()
    const { commands, screen, dispose } = await boot(current, agents)
    await run(commands, 'first?')
    expect(await run(commands, 'second?')).toEqual({ kind: 'success', text: 'asked the side question' })

    expect(agents.creates).toHaveLength(2)
    expect(agents.sides[0]!.disposed).toBe(1)
    // A session without a header cwd falls back to the process cwd.
    expect(agents.creates[1]!.meta).toEqual({
      cwd: process.cwd(),
      parentSession: current.id,
      seedLength: 1,
    })
    expect(agents.sides[1]!.agent.followups[0]!.content).toEqual([{ type: 'text', text: 'second?' }])
    expect(screen.paneLines()).toEqual(['› second?', 'thinking…'])
    await dispose()
  })

  it('disposes the fresh handle when the fiber unloaded mid-creation', async () => {
    resetSeq()
    const agents = new FakeAgents()
    agents.hold = true
    const { commands, dispose } = await boot(fakeAgent([]), agents)
    const pending = run(commands, 'late?')
    await vi.waitFor(() => {
      expect(agents.pending).toBe(true)
    })
    await dispose()
    agents.resolvePending()
    expect(await pending).toEqual({ kind: 'error', text: 'the side-question plugin was unloaded' })
    expect(agents.sides[0]!.disposed).toBe(1)
  })

  it('caps the pane at the latest rows and honors the width rules', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.agent.session as unknown as Session

    // Rows truncate to the viewport; below the minimum the pane hides.
    const pane = screen.bottomChildren[0]!
    expect(pane.render(8)).toEqual(['› q?', 'thinking…'])
    expect(pane.render(3)).toEqual([])
    pane.invalidate()
    expect(pane.render(8)).toEqual(['› q?', 'thinking…'])

    const long = Array.from({ length: 25 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    // Question + 25 reply rows + thinking = 27 rows; only the latest 20 show.
    const lines = screen.paneLines()
    expect(lines).toHaveLength(btw.BTW_MAX_LINES)
    expect(lines[0]).toBe('line7')
    expect(lines.at(-1)).toBe('thinking…')

    // A narrow viewport truncates each row.
    expect(pane.render(8).at(-1)).toBe('thinking…')
    await dispose()
  })
})
