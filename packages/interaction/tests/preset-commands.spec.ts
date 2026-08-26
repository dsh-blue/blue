/**
 * Unit tests for the `/preset` command family: the pure row builder
 * (roster order, current badge, broken rows), and the command over the
 * real command runtime — the guard chain (roster/session/idle/blank), the
 * bare picker (mount, badge seeding, blocked selects, the re-dispatch
 * write path), the direct switch (event pairing, error shapes), and the
 * unload flag.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { buildPresetRows, type PresetRow } from '../src/preset-commands.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

describe('buildPresetRows', () => {
  it('sorts by roster order then id, unordered after ordered, and badges the current entry', () => {
    const rows = buildPresetRows([
      { id: 'cordis', trust: 'system', order: 4 },
      { id: 'standard', trust: 'system', order: 1, name: 'Standard' },
      { id: 'beta', trust: 'system' },
      { id: 'minimal', trust: 'system', order: 3 },
      { id: 'alpha', trust: 'system' },
    ], 'minimal')
    expect(rows.map(row => row.value)).toEqual(['standard', 'minimal', 'cordis', 'alpha', 'beta'])
    expect(rows.map(row => row.label)).toEqual(['Standard', 'minimal', 'cordis', 'alpha', 'beta'])
    expect(rows[1]!.badge).toBe('← current')
    expect(rows.filter(row => row.badge !== undefined)).toHaveLength(1)
  })

  it('disables broken rows with their reason, and passes descriptions through', () => {
    const rows = buildPresetRows([
      { id: 'broken', trust: 'user', broken: 'composition failed the entry-list audit' },
      { id: 'ok', trust: 'system', description: 'The full coding agent' },
    ], undefined)
    expect(rows[0]).toEqual({
      value: 'broken',
      label: 'broken',
      description: 'composition failed the entry-list audit',
      disabled: true,
    })
    expect(rows[1]!.description).toBe('The full coding agent')
  })
})

describe('registerPresetCommands', () => {
  /** The fake roster's knobs. */
  interface RosterOptions {
    presets?: PresetRow[]
    current?: string
    /** `list` rejects with this instead of answering. */
    listError?: unknown
  }

  /** Build the fake roster recording every call. */
  function fakeRoster(options: RosterOptions) {
    const calls: { recompose: [Context, string][], listed: number } = { recompose: [], listed: 0 }
    const roster = {
      list: async (): Promise<PresetRow[]> => {
        calls.listed += 1
        if (options.listError !== undefined) throw options.listError
        return [...(options.presets ?? [])]
      },
      recompose: async (agentCtx: Context, id: string): Promise<{ id: string }> => {
        calls.recompose.push([agentCtx, id])
        return { id }
      },
      composedPreset: (_agentCtx: Context): string | undefined => options.current,
    }
    return { roster, calls }
  }

  /** Mount the command plugin over the fake services. */
  async function mount(options: {
    attach?: boolean
    display?: boolean
    agentStatus?: string
    started?: boolean
    roster?: RosterOptions
    deferredList?: boolean
    /** Provide no roster service at all (the host composes none). */
    noRoster?: boolean
  } = {}): Promise<{
    ctx: Context
    screen: FakeScreen
    agent: Agent
    fiber: { dispose(): Promise<void> }
    roster: ReturnType<typeof fakeRoster>['roster']
    calls: ReturnType<typeof fakeRoster>['calls']
    notices: string[]
    resolveList: (presets: PresetRow[]) => void
  }> {
    const base = fakeBlueContext({ display: options.display })
    const { ctx } = base
    const screen = base.screen
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('preset-spec'))
    if (options.started === true) session.append('turn/start', { turn: 0 })
    const agent = {
      id: session.id,
      session,
      status: options.agentStatus ?? 'idle',
      ctx: new Context(),
    } as unknown as Agent
    if (options.attach !== false) {
      ctx.provide('testSession', { current: agent })
    }
    // The deferred-list gate: the resolver lands only when the handler calls
    // list(), so the returned callable must read through the holder, never a
    // destructured copy of the placeholder.
    const listGate: { resolve: (presets: PresetRow[]) => void } = { resolve: () => {} }
    let roster: ReturnType<typeof fakeRoster>['roster']
    if (options.noRoster === true) {
      roster = fakeRoster({}).roster
    } else if (options.deferredList === true) {
      roster = {
        list: () => new Promise<PresetRow[]>(resolve => { listGate.resolve = resolve }),
        recompose: async (_agentCtx: Context, id: string) => ({ id }),
        composedPreset: () => undefined,
      }
    } else {
      const built = fakeRoster(options.roster ?? {})
      roster = built.roster
      // Keep the caller's `calls` handle wired to the shared object.
      ;(mount as { lastCalls?: unknown }).lastCalls = built.calls
    }
    if (options.noRoster !== true) {
      ctx.provide('agentPresets', roster)
    }
    const notices: string[] = []
    setSharedEditor(ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: (text: string) => { notices.push(text) },
    })
    const fiber = await ctx.plugin(commandsPlugin)
    return {
      ctx,
      screen: screen as FakeScreen,
      agent,
      fiber,
      roster,
      calls: (mount as { lastCalls?: ReturnType<typeof fakeRoster>['calls'] }).lastCalls!,
      notices,
      resolveList: (presets: PresetRow[]) => { listGate.resolve(presets) },
    }
  }

  async function run(ctx: Context, agent: Agent, line: string) {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    return execution?.result
  }

  /** The topmost overlay's panel. */
  function top(screen: FakeScreen) {
    const overlay = screen.overlays.at(-1)
    if (overlay === undefined) throw new Error('no panel mounted')
    return overlay
  }

  it('registers the command on the runtime', async () => {
    const { ctx, agent } = await mount()
    expect(ctx.commands.list().map(command => command.name)).toContain('preset')
    // The named path reaches the switch core over the fake roster.
    expect(await run(ctx, agent, '/preset standard')).toEqual({ kind: 'success', text: 'preset standard' })
  })

  it('unloading the command fiber removes the registration', async () => {
    const { ctx } = await mount()
    const commands = ctx.commands
    await ctx.fiber.dispose()
    expect(commands.list().map(command => command.name)).not.toContain('preset')
  })

  it('refuses without a live session', async () => {
    const { ctx, agent } = await mount({ attach: false })
    expect(await run(ctx, agent, '/preset standard')).toEqual({ kind: 'error', text: 'no session is live yet' })
  })

  it('refuses when the host composes no roster', async () => {
    const { ctx, agent } = await mount({ noRoster: true })
    expect(await run(ctx, agent, '/preset'))
      .toEqual({ kind: 'error', text: 'agent presets are unavailable: the host composes no roster' })
  })

  it('refuses while the agent is running', async () => {
    const { ctx, agent } = await mount({ agentStatus: 'running' })
    expect(await run(ctx, agent, '/preset standard'))
      .toEqual({ kind: 'error', text: 'cannot switch presets while the agent is running' })
  })

  it('refuses once the session has started a turn, standalone events notwithstanding', async () => {
    const { ctx, agent, calls } = await mount({ started: true, roster: { presets: [{ id: 'standard', trust: 'system' }] } })
    expect(await run(ctx, agent, '/preset standard')).toEqual({
      kind: 'error',
      text: 'cannot switch presets: this session has already started (blank sessions only)',
    })
    expect(calls.recompose).toEqual([])
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')).toEqual([])
  })

  it('reports a failing roster read for the bare command, Error and non-Error shapes', async () => {
    const errorCase = await mount({ roster: { listError: new Error('roots unreadable') } })
    expect(await run(errorCase.ctx, errorCase.agent, '/preset'))
      .toEqual({ kind: 'error', text: 'could not list presets: roots unreadable' })
    const bareCase = await mount({ roster: { listError: 'roots missing' } })
    expect(await run(bareCase.ctx, bareCase.agent, '/preset'))
      .toEqual({ kind: 'error', text: 'could not list presets: roots missing' })
  })

  it('shows no picker when the fiber unloads while the listing is in flight', async () => {
    const { ctx, agent, fiber, resolveList, screen } = await mount({ deferredList: true })
    const pending = run(ctx, agent, '/preset')
    await fiber.dispose()
    resolveList([{ id: 'standard', trust: 'system' }])
    expect(await pending).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('answers a notice for an empty roster', async () => {
    const { ctx, agent } = await mount({ roster: { presets: [] } })
    expect(await run(ctx, agent, '/preset')).toEqual({ kind: 'success', text: 'no presets composed' })
  })

  it('refuses the picker without the display services', async () => {
    const { ctx, agent } = await mount({ display: false, roster: { presets: [{ id: 'standard', trust: 'system' }] } })
    expect(await run(ctx, agent, '/preset'))
      .toEqual({ kind: 'error', text: 'preset picker is unavailable: the Blue screen is not mounted' })
  })

  it('opens the picker over the roster with the current badge seeding the cursor, and cancels clean', async () => {
    const { ctx, screen, agent } = await mount({
      roster: {
        current: 'minimal',
        presets: [
          { id: 'standard', trust: 'system', order: 1, description: 'The full coding agent' },
          { id: 'minimal', trust: 'system', order: 3, description: 'Two tools, fixed prompt' },
          { id: 'broken', trust: 'user', order: 5, broken: 'composition failed the entry-list audit' },
        ],
      },
    })
    expect(await run(ctx, agent, '/preset')).toEqual({ kind: 'success' })
    const lines = top(screen).component.render(80)
    expect(lines.join('\n')).toContain('Presets')
    expect(lines.join('\n')).toContain('standard')
    expect(lines.join('\n')).toContain('minimal')
    expect(lines.join('\n')).toContain('The full coding agent')
    const currentRow = lines.find(line => line.includes('← current')) ?? ''
    expect(currentRow).toContain('minimal')
    top(screen).component.handleInput(KEY.escape)
    expect(top(screen).hidden).toBe(true)
  })

  it('switches through the picker: the select re-dispatches the write path with the event appended', async () => {
    const { ctx, screen, agent, calls, notices } = await mount({
      roster: {
        presets: [
          { id: 'standard', trust: 'system', order: 1 },
          { id: 'beta', trust: 'system', order: 2 },
        ],
      },
    })
    expect(await run(ctx, agent, '/preset')).toEqual({ kind: 'success' })
    // The cursor starts on the head row (standard); step down to beta.
    top(screen).component.handleInput(KEY.down)
    top(screen).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toContain('preset beta') })
    expect(top(screen).hidden).toBe(true)
    expect(calls.recompose).toEqual([[agent.ctx, 'beta']])
    const selected = agent.session.events.filter(event => event.type === 'agent-preset/selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.data).toEqual({ agentPreset: 'beta' })
    // The re-dispatch is the same write path as a typed line: the bare
    // invocation and the explicit one both log command/run (name + args).
    const runs = agent.session.events.filter(event => event.type === 'command/run')
    expect(runs.map(event => ({ name: event.data.name, args: event.data.args }))).toEqual([
      { name: 'preset', args: '' },
      { name: 'preset', args: ' beta' },
    ])
  })

  it('paints a warning for a blocked select on a broken row without switching', async () => {
    const { ctx, screen, agent, calls, notices } = await mount({
      roster: {
        presets: [
          { id: 'standard', trust: 'system', order: 1 },
          { id: 'broken', trust: 'user', order: 2, broken: 'composition failed the entry-list audit' },
        ],
      },
    })
    expect(await run(ctx, agent, '/preset')).toEqual({ kind: 'success' })
    top(screen).component.handleInput(KEY.down)
    top(screen).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices.join('\n')).toContain('composition failed the entry-list audit') })
    expect(calls.recompose).toEqual([])
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')).toEqual([])
  })

  it('switches directly by name, pairing the event, and stays legal while blank', async () => {
    const { ctx, agent, calls } = await mount({
      roster: { presets: [{ id: 'standard', trust: 'system', order: 1 }, { id: 'beta', trust: 'system', order: 2 }] },
    })
    expect(await run(ctx, agent, '/preset beta')).toEqual({ kind: 'success', text: 'preset beta' })
    // A second switch while still blank is legal: command/run never opens a turn.
    expect(await run(ctx, agent, '/preset standard')).toEqual({ kind: 'success', text: 'preset standard' })
    expect(calls.recompose.map(call => call[1])).toEqual(['beta', 'standard'])
    const selected = agent.session.events.filter(event => event.type === 'agent-preset/selected')
    expect(selected.map(event => (event.data as { agentPreset: string }).agentPreset)).toEqual(['beta', 'standard'])
  })

  it('surfaces the roster\'s failure text for unknown and broken targets, Error and non-Error', async () => {
    const failing = await mount({})
    ;(failing.roster as { recompose: unknown }).recompose = async () => {
      throw new Error('unknown preset nope, available: standard, beta')
    }
    expect(await run(failing.ctx, failing.agent, '/preset nope'))
      .toEqual({ kind: 'error', text: 'unknown preset nope, available: standard, beta' })

    const bare = await mount({})
    ;(bare.roster as { recompose: unknown }).recompose = async () => {
      throw 'mount exploded'
    }
    expect(await run(bare.ctx, bare.agent, '/preset broken')).toEqual({ kind: 'error', text: 'mount exploded' })
  })

  it('paints a failed switch from the picker in error red through the dispatch write path', async () => {
    const { ctx, agent, screen, notices } = await mount({
      roster: { presets: [{ id: 'standard', trust: 'system' }, { id: 'beta', trust: 'system' }] },
    })
    // The switch fails only once dispatched: the picker itself mounts fine.
    ;(ctx.get('agentPresets') as { recompose: unknown }).recompose = async () => {
      throw new Error('unknown preset beta, available: standard')
    }
    await run(ctx, agent, '/preset')
    top(screen).component.handleInput(KEY.down)
    top(screen).component.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toContain('!unknown preset beta, available: standard!') })
  })

  it('logs Error and non-Error picker dispatch rejections', async () => {
    for (const failure of [new Error('dispatch exploded'), 'raw dispatch failure']) {
      const mounted = await mount({ roster: { presets: [{ id: 'standard', trust: 'system' }] } })
      const warn = vi.spyOn(mounted.ctx.logger, 'warn').mockImplementation(() => {})
      ;(mounted.ctx.blueSessionActions as unknown as { executeCommand: () => Promise<never> }).executeCommand
        = async () => { throw failure }
      await run(mounted.ctx, mounted.agent, '/preset')
      top(mounted.screen).component.handleInput(KEY.enter)
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(failure instanceof Error ? failure.message : failure))
      })
      warn.mockRestore()
    }
  })
})
