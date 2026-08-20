/**
 * The mode-family command over the real command runtime and session log:
 * `/yolo` explicit and bare toggles (the bare-off re-dispatch and the
 * command/run records it leaves), the fold-consistent argument semantics,
 * the plan exit on yolo-on, the Shift+Tab cycle order (via a stub `/plan`
 * standing in for the upstream command), the no-session and
 * plan-absent-degraded cycles, the session-switch/late-activation restore,
 * and the deferred plan/yolo exclusivity watcher.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { canonicalOf } from '../src/command-meta.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { cycleMode } from '../src/mode-commands.ts'
import { setYolo, yoloActive } from '../src/mode-state.ts'
import { fakeBlueContext } from './fakes.ts'

/** The notices the shared editor received. */
let notices: string[] = []

afterEach(() => {
  clearSharedEditor()
  notices = []
})

/** The mutable state the fake plan-mode controller reports. */
interface FakePlanMode {
  state: { active: boolean, pending?: boolean }
  set: ReturnType<typeof vi.fn>
}

function fakePlanMode(state: { active: boolean, pending?: boolean }): FakePlanMode {
  return { state, set: vi.fn(() => 'committed') }
}

interface MountOptions {
  attach?: boolean
  planMode?: FakePlanMode
  planCommand?: boolean
  /** Seed the session log before the plugin mounts. */
  seed?: string[]
}

async function mount(options: MountOptions = {}): Promise<{
  ctx: Context
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('mode-spec'))
  if (options.planMode !== undefined) {
    ctx.provide('planMode', { get: () => ({ ...options.planMode!.state }), set: options.planMode!.set })
  }
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  for (const args of options.seed ?? []) {
    session.append('command/run', { commandId: `seed-${args}`, name: 'yolo', args })
  }
  if (options.attach !== false) {
    ctx.provide('blueSession', { current: agent, modelRef: undefined })
  }
  if (options.planCommand === true) {
    ctx.commands.register({
      name: 'plan',
      description: 'stub standing in for the upstream command',
      handler: () => ({ kind: 'success' as const }),
    })
  }
  setSharedEditor({
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: (text: string) => { notices.push(text) },
  })
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, agent, fiber }
}

const signal = (): AbortSignal => new AbortController().signal

/** The args of every recorded /yolo run, in log order. */
function yoloRuns(agent: Agent): string[] {
  return agent.session.events
    .filter((event) => event.type === 'command/run' && event.data.name === 'yolo')
    .map((event) => (event.type === 'command/run' ? event.data.args : undefined))
}

describe('/yolo', () => {
  it('registers with the hint and the /yes alias', async () => {
    const { ctx, agent } = await mount()
    const listed = ctx.commands.list(agent).find(command => command.name === 'yolo')
    expect(listed?.input?.hint).toBe('[on|off]')
    expect(listed?.description).toContain('auto-approval')
    expect(canonicalOf('yes')).toBe('yolo')
  })

  it('bare toggle on: one run record with empty args, state on', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/yolo', signal())
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect(execution?.result.kind === 'success' && execution.result.text).toContain('yolo on')
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([''])
  })

  it('bare toggle off: re-dispatches the explicit form, folding off', async () => {
    const { ctx, agent } = await mount()
    await ctx.commands.execute(agent, '/yolo', signal())
    const execution = await ctx.commands.execute(agent, '/yolo', signal())
    expect(execution?.result.kind === 'success' && execution.result.text).toContain('yolo off')
    expect(yoloActive(agent)).toBe(false)
    // The bare record folds on; the explicit follow-up record disambiguates.
    expect(yoloRuns(agent)).toEqual(['', '', ' off'])
  })

  it('explicit off records the off argument directly', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    await ctx.commands.execute(agent, '/yolo off', signal())
    expect(yoloActive(agent)).toBe(false)
    expect(yoloRuns(agent)).toEqual([' off'])
  })

  it("any other non-empty argument means on (fold-consistent, no usage error)", async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/yolo blah', signal())
    expect(execution?.result).toMatchObject({ kind: 'success' })
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([' blah'])
  })

  it('turning on leaves plan first through the controller', async () => {
    const planMode = fakePlanMode({ active: true })
    const { ctx, agent } = await mount({ planMode })
    await ctx.commands.execute(agent, '/yolo on', signal())
    expect(yoloActive(agent)).toBe(true)
    expect(planMode.set).toHaveBeenCalledWith(agent, false)
  })

  it('turning on succeeds without a composed plan mode', async () => {
    const { ctx, agent } = await mount()
    await ctx.commands.execute(agent, '/yolo on', signal())
    expect(yoloActive(agent)).toBe(true)
  })

  it('the bare-off re-dispatch surfaces one notice and the fallback guard', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    const original = ctx.commands.execute.bind(ctx.commands)
    let calls = 0
    const spy = vi.spyOn(ctx.commands, 'execute').mockImplementation((dispatchAgent, line, dispatchSignal) => {
      calls += 1
      // The second call is the in-handler re-dispatch: report the command
      // gone (the registration vanished mid-toggle).
      if (calls === 2) return Promise.resolve(undefined)
      return original(dispatchAgent, line, dispatchSignal)
    })
    const execution = await ctx.commands.execute(agent, '/yolo', signal())
    spy.mockRestore()
    expect(execution?.result).toEqual({ kind: 'error', text: 'failed to turn yolo off' })
    expect(yoloRuns(agent)).toEqual([''])
  })
})

describe('cycleMode', () => {
  it('normal → plan: dispatches the upstream /plan command', async () => {
    const planMode = fakePlanMode({ active: false })
    const { ctx, agent } = await mount({ planMode, planCommand: true })
    await cycleMode(ctx)
    const planRuns = agent.session.events
      .filter((event) => event.type === 'command/run' && event.data.name === 'plan')
    expect(planRuns).toHaveLength(1)
    expect(yoloActive(agent)).toBe(false)
  })

  it('plan → yolo: exits plan and turns yolo on', async () => {
    const planMode = fakePlanMode({ active: true })
    const { ctx, agent } = await mount({ planMode, planCommand: true })
    await cycleMode(ctx)
    expect(planMode.set).toHaveBeenCalledWith(agent, false)
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([' on'])
  })

  it('yolo → normal: dispatches the explicit off', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    await cycleMode(ctx)
    expect(yoloActive(agent)).toBe(false)
    expect(yoloRuns(agent)).toEqual([' off'])
    expect(notices.some(text => text.includes('yolo off'))).toBe(true)
  })

  it('without a live session the cycle only notices', async () => {
    const { ctx } = await mount({ attach: false })
    await cycleMode(ctx)
    expect(notices).toEqual(['no session is live yet'])
  })

  it('degrades to the two-state cycle when plan mode is not composed', async () => {
    const { ctx, agent } = await mount()
    await cycleMode(ctx)
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([' on'])
    await cycleMode(ctx)
    expect(yoloActive(agent)).toBe(false)
    expect(yoloRuns(agent)).toEqual([' on', ' off'])
  })

  it('surfaces a dispatched error result through the error paint', async () => {
    const planMode = fakePlanMode({ active: false })
    const { ctx, agent } = await mount({ planMode })
    ctx.commands.register({
      name: 'plan',
      description: 'stub standing in for the upstream command',
      handler: () => ({ kind: 'error' as const, text: 'plan unavailable' }),
    })
    await cycleMode(ctx)
    expect(notices).toContain('!plan unavailable!')
    expect(yoloActive(agent)).toBe(false)
  })

  it('an unknown cycle target surfaces nothing (the command vanished)', async () => {
    // No /plan stub registered: the dispatch resolves undefined.
    const planMode = fakePlanMode({ active: false })
    const { ctx, agent } = await mount({ planMode })
    await cycleMode(ctx)
    expect(yoloRuns(agent)).toEqual([])
    expect(notices).toEqual([])
  })

  it('a dispatch failure warns instead of throwing', async () => {
    const { ctx } = await mount()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    // A string rejection exercises describe()'s non-Error side.
    const spy = vi.spyOn(ctx.commands, 'execute').mockRejectedValueOnce('append failed')
    await expect(cycleMode(ctx)).resolves.toBeUndefined()
    spy.mockRestore()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('append failed'))
    warn.mockRestore()
  })
})

describe('session restore', () => {
  it('a session with logged yolo-on restores on mount (late activation)', async () => {
    const { agent } = await mount({ seed: [''] })
    expect(yoloActive(agent)).toBe(true)
  })

  it('a logged off (or nothing) stays off', async () => {
    const { agent } = await mount({ seed: [' off'] })
    expect(yoloActive(agent)).toBe(false)
  })

  it('blue/session-changed restores the next agent from its log', async () => {
    const { ctx, agent } = await mount()
    const session = ctx.sessions.create(SessionId('mode-spec-next'))
    session.append('command/run', { commandId: 'next-0', name: 'yolo', args: '' })
    const next = { id: session.id, session, status: 'idle' } as unknown as Agent
    ctx.emit('blue/session-changed', next)
    expect(yoloActive(next)).toBe(true)
    expect(yoloActive(agent)).toBe(false)
  })
})

describe('the plan/yolo exclusivity watcher', () => {
  it('a committed plan entry turns yolo off after the append settles', async () => {
    const { agent } = await mount()
    setYolo(agent, true)
    agent.session.append('plan/mode', { active: true })
    await vi.waitFor(() => { expect(yoloActive(agent)).toBe(false) })
    expect(yoloRuns(agent)).toEqual([' off'])
    expect(notices.some(text => text.includes('yolo off'))).toBe(true)
  })

  it('a plan exit event leaves yolo alone', async () => {
    const { agent } = await mount()
    setYolo(agent, true)
    agent.session.append('plan/mode', { active: false })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([])
  })

  it('a plan entry on another session leaves yolo alone', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    const other = ctx.sessions.create(SessionId('mode-spec-other'))
    other.append('plan/mode', { active: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([])
  })

  it('a plan entry with yolo already off dispatches nothing', async () => {
    const { agent } = await mount()
    agent.session.append('plan/mode', { active: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(yoloRuns(agent)).toEqual([])
  })

  it('a vanished command surfaces no exclusivity notice', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    const spy = vi.spyOn(ctx.commands, 'execute').mockResolvedValueOnce(undefined)
    agent.session.append('plan/mode', { active: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    spy.mockRestore()
    expect(notices).toEqual([])
  })

  it('a failed exclusivity dispatch warns instead of throwing', async () => {
    const { ctx, agent } = await mount()
    setYolo(agent, true)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const spy = vi.spyOn(ctx.commands, 'execute').mockRejectedValueOnce(new Error('append failed'))
    agent.session.append('plan/mode', { active: true })
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('append failed')) })
    spy.mockRestore()
    warn.mockRestore()
  })

  it('unloading the command fiber removes the watcher', async () => {
    const { agent, fiber } = await mount()
    setYolo(agent, true)
    await fiber.dispose()
    agent.session.append('plan/mode', { active: true })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(yoloActive(agent)).toBe(true)
    expect(yoloRuns(agent)).toEqual([])
  })
})
