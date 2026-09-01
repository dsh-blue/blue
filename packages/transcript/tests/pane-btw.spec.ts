/**
 * `blue-pane-btw` plugin: the side-question pane and its `/btw` command.
 * Covers the command's error branches (no session, creation failure), the
 * seeded side-agent creation, the streaming/finalize reply rendering with
 * the thinking row, dismissal and single-slot replacement, the editor
 * splice (`'blue/editor-connected-above'` emissions), canonical pane content,
 * and the unloaded-mid-creation guard. Core separately owns pane allocation,
 * chrome, narrow behavior, and scroll mechanics.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as btw from '../src/pane-btw.ts'
import {
  assistantEvent,
  reasoningDelta,
  resetSeq,
  textDelta,
  userEvent,
} from './helpers.ts'
import { bootPanePlugin, type PaneFakeCommands, type PanePluginHarness } from './pane-fakes.ts'
import { fakeAgent, type FakeAgent } from './status-fakes.ts'

/** One opaque fake side session plus its action handle and captures. */
interface FakeSide {
  projectionSession: { events: SessionEvent[] }
  handle: AgentHandle
  followups: string[]
  disposed: number
}

/** Build one fake side-session action handle. */
function makeSide(seed: SessionEvent[] = []): FakeSide {
  const side = {
    projectionSession: { events: [...seed] },
    followups: [],
    disposed: 0,
  } as FakeSide
  side.handle = {
    agent: {
      session: side.projectionSession,
      status: 'running',
      followup: (message: { readonly content?: readonly { readonly type: string, readonly text?: string }[] }) => {
        side.followups.push(message.content?.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n') ?? '')
      },
    },
    dispose: () => {
      side.disposed += 1
      return Promise.resolve()
    },
  } as unknown as AgentHandle
  return side
}

/** Fake native agents service: records creations; can fail or hold the next one. */
class FakeAgents {
  readonly creates: true[] = []
  readonly sides: FakeSide[] = []
  failure: unknown
  available = true
  hold = false
  seed: SessionEvent[] = []
  ctx?: Context
  setup?: (ctx: Context) => Promise<void>
  agentOptions?: { readonly reasoningEffort?: string }
  private pendingResolve: (() => void) | undefined

  get pending(): boolean {
    return this.pendingResolve !== undefined
  }

  create(request?: {
    readonly setup?: (ctx: Context) => Promise<void>
    readonly agentOptions?: { readonly reasoningEffort?: string }
  }): Promise<AgentHandle | undefined> {
    if (!this.available) return Promise.resolve(undefined)
    this.setup = request?.setup
    this.agentOptions = request?.agentOptions
    this.creates.push(true)
    if (this.failure !== undefined) return Promise.reject(this.failure)
    const side = makeSide(this.seed)
    this.sides.push(side)
    if (this.hold) {
      return new Promise((resolve) => {
        this.pendingResolve = () => resolve(side.handle)
      })
    }
    return Promise.resolve(side.handle)
  }

  /** Publish one admitted status transition to a side handle. */
  emitStatus(side: FakeSide, status: 'running' | 'idle'): void {
    ;(side.handle.agent as { status: string }).status = status
    this.ctx?.emit('agent/status', { agent: side.handle.agent, status })
  }

  /** Fulfill the held creation. */
  resolvePending(): void {
    const resolve = this.pendingResolve
    this.pendingResolve = undefined
    resolve?.()
  }
}

/**
 * Boot the plugin with the fake app-owned action service.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param actions - the fake side-session actions.
 */
async function boot(current: FakeAgent | null, actions: FakeAgents): Promise<PanePluginHarness> {
  actions.available = current !== null
  const harness = await bootPanePlugin(btw, current, { agents: actions })
  actions.ctx = harness.ctx
  return harness
}

/** Invoke `/btw` with the given raw input. */
function run(commands: PaneFakeCommands, rawInput: string): Promise<unknown> {
  return Promise.resolve(commands.run('btw', rawInput))
}

/** Strip canonical surface chrome and padding from the fake render. */
function content(lines: readonly string[]): string[] {
  return lines
    .map(line => line.trim())
    .map(line => line.replace(/^[\u2800-\u28ff]\s+/u, ''))
    .filter(line => line !== '' && !/^[┌└─]+(?: BTW )?[─┐┘]*$/u.test(line) && line !== 'Esc close')
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

  it('asks through the app action, streams the projection, finalizes, and settles', async () => {
    resetSeq()
    const current = fakeAgent([userEvent('parent work')], { cwd: '/repo' })
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(current, agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)

    expect(await run(commands, 'what is x?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(splice).toHaveBeenLastCalledWith(true, true)
    expect(agents.creates).toHaveLength(1)
    const side = agents.sides[0]!
    expect(side.followups).toEqual(['what is x?'])
    expect(content(screen.paneLines())).toEqual(['> what is x?', 'thinking...'])

    // Text deltas accumulate; other sessions, reasoning deltas, and
    // non-assistant events are ignored.
    const session = side.projectionSession
    ctx.emit('session/event', session, textDelta(1, 1, 'x is '))
    ctx.emit('session/event', session, textDelta(1, 1, 'a letter'))
    expect(content(screen.paneLines())).toEqual(['> what is x?', 'x is a letter', 'thinking...'])
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', fakeAgent([]).session as never, textDelta(1, 1, 'stray'))
    ctx.emit('session/event', session, reasoningDelta(1, 1, 'hmm'))
    ctx.emit('session/event', session, userEvent('echo'))
    expect(screen.renderRequests.length).toBe(baseline)

    // The finalize rewrites the accumulation authoritatively, dropping
    // non-text blocks.
    ctx.emit('session/event', session, assistantEvent(1, 1, [
      { type: 'reasoning', text: 'hidden' },
      { type: 'text', text: 'x is the 24th letter' },
    ]))
    expect(content(screen.paneLines())).toEqual(['> what is x?', 'x is the 24th letter', 'thinking...'])

    // The app-owned handle admits only this side session's status changes.
    agents.emitStatus(side, 'running')
    expect(content(screen.paneLines())).toEqual(['> what is x?', 'x is the 24th letter', 'thinking...'])
    agents.emitStatus(side, 'idle')
    expect(content(screen.paneLines())).toEqual(['> what is x?', 'x is the 24th letter'])

    // Unloading disposes the live side agent and releases the editor splice.
    await dispose()
    expect(side.disposed).toBe(1)
    expect(splice).toHaveBeenLastCalledWith(false)
  })

  it('does not paint inherited fork replies into a new question', async () => {
    resetSeq()
    const inherited = [
      userEvent('old question'),
      assistantEvent(1, 1, [{ type: 'text', text: 'old answer' }]),
    ]
    const agents = new FakeAgents()
    agents.seed = inherited
    const { ctx, commands, screen, dispose } = await boot(fakeAgent(inherited), agents)

    expect(await run(commands, 'new question')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(content(screen.paneLines())).toEqual(['> new question', 'thinking...'])

    const session = agents.sides[0]!.projectionSession
    ctx.emit('session/event', session, reasoningDelta(2, 1, 'working'))
    expect(content(screen.paneLines())).toEqual(['> new question', 'thinking...'])
    ctx.emit('session/event', session, textDelta(2, 1, 'new answer'))
    expect(content(screen.paneLines())).toEqual(['> new question', 'new answer', 'thinking...'])
    await dispose()
  })

  it('drops the editor splice while a dialog occupies the slot and re-asserts on return', async () => {
    resetSeq()
    const current = fakeAgent([], { cwd: '/repo' })
    const agents = new FakeAgents()
    const { ctx, commands, dispose } = await boot(current, agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)

    expect(await run(commands, 'q?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(splice).toHaveBeenLastCalledWith(true, true)

    // A dialog taking the editor slot releases the splice claim: the flag
    // would otherwise point at an off-tree editor.
    ctx.emit('blue/editor-slot-swapped', true)
    expect(splice).toHaveBeenLastCalledWith(false)
    // The editor returning re-asserts the claim with the live busy flag.
    ctx.emit('blue/editor-slot-swapped', false)
    expect(splice).toHaveBeenLastCalledWith(true, true)

    // Once dismissed, a slot round-trip re-asserts nothing.
    await run(commands, '')
    const calls = splice.mock.calls.length
    ctx.emit('blue/editor-slot-swapped', true)
    ctx.emit('blue/editor-slot-swapped', false)
    expect(splice.mock.calls.length).toBe(calls)
    expect(splice).toHaveBeenLastCalledWith(false)
    await dispose()
  })

  it('dismisses with bare /btw and refuses a second dismiss', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    expect(content(screen.paneLines())).toEqual(['> first?', 'thinking...'])

    expect(await run(commands, '')).toEqual({ kind: 'success', text: 'dismissed the side question' })
    expect(side.disposed).toBe(1)
    expect(splice).toHaveBeenLastCalledWith(false)
    expect(screen.paneLines()).toEqual([])

    // The dismissed agent's subscriptions are unbound.
    const baseline = screen.renderRequests.length
    ctx.emit('session/event', side.projectionSession as never, textDelta(1, 1, 'late'))
    agents.emitStatus(side, 'idle')
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
    expect(agents.sides[1]!.followups).toEqual(['second?'])
    expect(content(screen.paneLines())).toEqual(['> second?', 'thinking...'])
    await dispose()
  })

  it('replaces the visible answer while side creation is still pending', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'first?')
    const first = agents.sides[0]!
    ctx.emit('session/event', first.projectionSession, textDelta(1, 1, 'old answer'))
    agents.emitStatus(first, 'idle')
    expect(content(screen.paneLines())).toEqual(['> first?', 'old answer'])

    agents.hold = true
    const pending = run(commands, 'second?')
    await vi.waitFor(() => {
      expect(agents.pending).toBe(true)
    })
    expect(content(screen.paneLines())).toEqual(['> second?', 'thinking...'])

    agents.resolvePending()
    expect(await pending).toEqual({ kind: 'success', text: 'asked the side question' })
    await dispose()
  })

  it('settles a side question on an explicit idle status event', async () => {
    const agents = new FakeAgents()
    const harness = await boot(fakeAgent([]), agents)
    const splice: unknown[] = []
    harness.ctx.on('blue/editor-connected-above', (...args: unknown[]) => { splice.push(args) })
    expect(await run(harness.commands, 'status settle?')).toEqual({ kind: 'success', text: 'asked the side question' })
    const side = agents.sides[0]!
    agents.emitStatus(side, 'idle')
    expect(splice.at(-1)).toEqual([true, false])
    agents.emitStatus(side, 'running')
    await harness.dispose()
  })

  it('ignores an invalid side-session projection shape', async () => {
    const agents = new FakeAgents()
    let snapshots = 0
    const harness = await bootPanePlugin(btw, fakeAgent([]), {
      agents,
      sessionProjections: {
        snapshot: () => ({ asOfSeq: 0, values: { blueConversation: snapshots++ === 0 ? null : {} } }),
        onChanged: () => () => {},
      },
    })
    agents.ctx = harness.ctx
    expect(await run(harness.commands, 'invalid projection?')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(await run(harness.commands, 'invalid projection again?')).toEqual({ kind: 'success', text: 'asked the side question' })
    await harness.dispose()
  })

  it('forwards the latest preset, optional effort, setup callback, and ignores unrelated events', async () => {
    const agents = new FakeAgents()
    const mountPreset = vi.fn(() => Promise.resolve())
    const current = fakeAgent([{
      type: 'agent-preset/selected',
      seq: 1,
      time: 1,
      data: { agentPreset: 'minimal' },
    } as SessionEvent])
    const harness = await bootPanePlugin(btw, current, {
      agents,
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'mock', model: 'mock', reasoningEffort: 'high' }),
      },
      agentPresets: { mount: mountPreset },
    })
    agents.ctx = harness.ctx
    expect(await run(harness.commands, 'inspect this')).toEqual({ kind: 'success', text: 'asked the side question' })
    expect(agents.agentOptions).toMatchObject({ reasoningEffort: 'high' })
    await agents.setup?.(harness.ctx)
    expect(mountPreset).toHaveBeenCalledWith(harness.ctx, 'minimal')
    harness.ctx.emit('agent/status', { agent: {} as never, status: 'idle' })
    harness.ctx.emit('blue/btw-command', 'unknown' as never)
    await harness.dispose()
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

  it('publishes long replies through the canonical tail-following scroll node', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    screen.rows = 40
    await run(commands, 'q?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    const long = Array.from({ length: 15 }, (_, index) => `line${index + 1}`).join('\n')
    ctx.emit('session/event', session, assistantEvent(1, 1, [{ type: 'text', text: long }]))
    const rows = content(screen.paneLines())
    expect(rows[0]).toBe('> q?')
    expect(rows).toContain('line1')
    expect(rows).toContain('line15')
    expect(rows.at(-1)).toBe('thinking...')
    await dispose()
  })

  it('continues the side conversation on submit while idle', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    const session = side.projectionSession
    // The first turn settles; the busy flag flips with it.
    ctx.emit('session/event', session, textDelta(1, 1, 'first reply'))
    agents.emitStatus(side, 'idle')
    expect(splice).toHaveBeenLastCalledWith(true, false)
    expect(side.followups).toHaveLength(1)

    // The editor routes the next Enter here: a second turn appends to the
    // SAME side agent (no second creation), and the busy flag returns.
    ctx.emit('blue/btw-command', 'submit', 'and then?')
    expect(agents.creates).toHaveLength(1)
    expect(splice).toHaveBeenLastCalledWith(true, true)
    expect(side.followups).toEqual(['first?', 'and then?'])
    // The first turn settled before the submit, so its thinking row is gone;
    // the canonical divider separates the two turns.
    expect(content(screen.paneLines())).toEqual(['> first?', 'first reply', '> and then?', 'thinking...'])

    // Reasoning starts the new run but must not copy the previous assistant
    // entry into the new turn while no second answer exists yet.
    ctx.emit('session/event', session, reasoningDelta(2, 1, 'working'))
    expect(content(screen.paneLines())).toEqual(['> first?', 'first reply', '> and then?', 'thinking...'])

    ctx.emit('session/event', session, assistantEvent(2, 1, [{ type: 'text', text: 'second reply' }]))
    agents.emitStatus(side, 'idle')
    expect(content(screen.paneLines())).toEqual(['> first?', 'first reply', '> and then?', 'second reply'])
    await dispose()
  })

  it('ignores a submit while the side agent is still answering', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    await run(commands, 'first?')
    const side = agents.sides[0]!
    const baseline = side.followups.length
    const renderBaseline = screen.renderRequests.length

    ctx.emit('blue/btw-command', 'submit', 'ignored')
    expect(side.followups).toHaveLength(baseline)
    expect(screen.renderRequests.length).toBe(renderBaseline)
    // The pane still shows the first turn only.
    expect(content(screen.paneLines())).toEqual(['> first?', 'thinking...'])
    await dispose()
  })

  it('ignores submit commands with no text or while closed', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const baseline = screen.renderRequests.length
    ctx.emit('blue/btw-command', 'submit', '')
    ctx.emit('blue/btw-command', 'submit')
    expect(screen.renderRequests.length).toBe(baseline)

    await run(commands, 'q?')
    const side = agents.sides[0]!
    ctx.emit('blue/btw-command', 'submit', '   ')
    expect(side.followups).toHaveLength(1)
    await dispose()
  })

  it('closes through the close command after canonical narrow rendering', async () => {
    resetSeq()
    const agents = new FakeAgents()
    const { ctx, commands, screen, dispose } = await boot(fakeAgent([]), agents)
    const splice = vi.fn()
    ctx.on('blue/editor-connected-above', splice)
    await run(commands, 'q?')
    const side = agents.sides[0]!

    const pane = screen.bottomChildren[0]!
    expect(pane.render(5).length).toBeGreaterThan(0)
    expect(pane.render(10).length).toBeGreaterThan(0)
    pane.invalidate()
    expect(pane.render(10).length).toBeGreaterThan(0)

    ctx.emit('blue/btw-command', 'close')
    await vi.waitFor(() => {
      expect(side.disposed).toBe(1)
    })
    // The splice release lands on the dismiss continuation's microtask.
    await vi.waitFor(() => {
      expect(splice).toHaveBeenLastCalledWith(false)
    })
    expect(screen.paneLines()).toEqual([])
    await dispose()
  })
})
