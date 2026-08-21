/**
 * Unit tests for the `/tools` command family: the pure section builder
 * (built-in bucket, MCP grouping, ordering, description collapsing), and
 * the command over the real command runtime — panel mount, close, and the
 * no-session / no-display / no-service guards.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import { clearSharedEditor } from '../src/editor-instance.ts'
import { buildToolsSections } from '../src/tools-commands.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

afterEach(() => {
  clearSharedEditor()
})

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#]/g, ''))
}

/** One schema fixture, description optional. */
function tool(name: string, description = ''): ToolSchema {
  return { name, description, parameters: { type: 'object' } }
}

describe('buildToolsSections', () => {
  it('buckets built-in tools into one name-sorted section with counts', () => {
    const sections = buildToolsSections([tool('bash', 'Run a command'), tool('edit', 'Edit a file')])
    expect(sections).toHaveLength(1)
    expect(sections[0]!.heading).toBe('Tools (2)')
    expect(sections[0]!.rows).toEqual([
      { label: 'bash', segments: [{ text: 'Run a command' }] },
      { label: 'edit', segments: [{ text: 'Edit a file' }] },
    ])
  })

  it('answers a single muted section for an empty catalog', () => {
    const sections = buildToolsSections([])
    expect(sections).toEqual([{
      heading: 'tools',
      rows: [{ label: 'none', segments: [{ text: 'no tools visible to this session', style: 'muted' }] }],
    }])
  })

  it('groups mcp__ tools per server after the built-in section, servers sorted', () => {
    const sections = buildToolsSections([
      tool('bash', 'Run a command'),
      tool('mcp__zeta__get', 'zeta get'),
      tool('mcp__demo__list_items', 'demo list'),
      tool('mcp__demo__get', 'demo get'),
    ])
    expect(sections.map(section => section.heading)).toEqual(['Tools (1)', 'MCP · demo (2)', 'MCP · zeta (1)'])
    expect(sections[1]!.rows.map(row => row.label)).toEqual(['mcp__demo__get', 'mcp__demo__list_items'])
    expect(sections[2]!.rows.map(row => row.label)).toEqual(['mcp__zeta__get'])
  })

  it('answers MCP-only catalogs and a bare mcp__ name with no raw segment', () => {
    // No built-in tools: no Tools section, only the server sections.
    const only = buildToolsSections([tool('mcp__demo__get', 'demo get')])
    expect(only.map(section => section.heading)).toEqual(['MCP · demo (1)'])
    // `mcp__lonely` has no second `__`: the whole tail is the server name.
    const bare = buildToolsSections([tool('mcp__lonely', 'tailless')])
    expect(bare.map(section => section.heading)).toEqual(['MCP · lonely (1)'])
    expect(bare[0]!.rows[0]!.label).toBe('mcp__lonely')
  })

  it('collapses multiline descriptions and marks empty ones muted', () => {
    const sections = buildToolsSections([
      tool('multi', 'line one\nline two\nline three'),
      tool('silent'),
    ])
    expect(sections[0]!.rows).toEqual([
      { label: 'multi', segments: [{ text: 'line one line two line three' }] },
      { label: 'silent', segments: [{ text: '(no description)', style: 'muted' }] },
    ])
  })
})

describe('registerToolsCommands', () => {
  /** One fake standing key, identity-compared against what `schemas` receives. */
  const STANDING_KEY = { agentPreset: 'alpha' }

  /** Mount the command plugin over the fake services; `schemas` is the recorded probe. */
  async function mount(options: {
    attach?: boolean
    display?: boolean
    schemas?: (scope?: unknown) => ToolSchema[]
    /** Provide the roster fake answering `composedPreset`/`standingKeyFor`. */
    roster?: { current?: string, key?: Promise<unknown>, keyError?: unknown }
  } = {}): Promise<{ ctx: Context, screen: FakeScreen, agent: Agent, fiber: { dispose(): Promise<void> } }> {
    const base = options.display === false ? { ctx: new Context() } : fakeBlueContext()
    const { ctx } = base
    const screen = 'screen' in base ? base.screen : undefined
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('tools-spec'), { meta: { cwd: '/tmp/spec' } })
    const agent = { id: session.id, session, status: 'idle', ctx: new Context() } as unknown as Agent
    if (options.attach !== false) {
      ctx.provide('blueSession', { current: agent })
    }
    if (options.schemas !== undefined) {
      ctx.provide('tools', { schemas: options.schemas } as never)
    }
    if (options.roster !== undefined) {
      ctx.provide('agentPresets', {
        composedPreset: () => options.roster!.current,
        standingKeyFor: async () => {
          if (options.roster!.keyError !== undefined) throw options.roster!.keyError
          return options.roster!.key ?? Promise.resolve(STANDING_KEY)
        },
      } as never)
    }
    const fiber = await ctx.plugin(commandsPlugin)
    return { ctx, screen: screen as FakeScreen, agent, fiber }
  }

  async function run(ctx: Context, agent: Agent, line: string) {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    return execution?.result
  }

  it('registers the command on the runtime', async () => {
    const { ctx, agent } = await mount({ schemas: () => [] })
    expect(ctx.commands.list().map(command => command.name)).toContain('tools')
    await run(ctx, agent, '/tools')
  })

  it('enumerates through the preset standing key when the agent runs on a roster composition', async () => {
    const scopes: unknown[] = []
    const { ctx, screen, agent } = await mount({
      schemas: scope => {
        scopes.push(scope)
        return [tool('bash', 'Run a command')]
      },
      roster: { current: 'alpha' },
    })
    expect(await run(ctx, agent, '/tools')).toEqual({ kind: 'success' })
    expect(scopes).toEqual([STANDING_KEY])
    const rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('Tools (1)'))).toBe(true)
  })

  it('falls back to the global view when the roster is absent or binds nothing', async () => {
    const scopes: unknown[] = []
    const noRoster = await mount({ schemas: scope => { scopes.push(scope); return [] } })
    await run(noRoster.ctx, noRoster.agent, '/tools')
    const unbound = await mount({
      schemas: scope => { scopes.push(scope); return [] },
      roster: { current: undefined },
    })
    await run(unbound.ctx, unbound.agent, '/tools')
    expect(scopes).toEqual([undefined, undefined])
  })

  it('reports a failing standing-key resolution', async () => {
    const { ctx, agent } = await mount({
      schemas: () => [],
      roster: { current: 'alpha', keyError: new Error('composition unreadable') },
    })
    expect(await run(ctx, agent, '/tools'))
      .toEqual({ kind: 'error', text: 'could not resolve the preset composition: composition unreadable' })
    const bare = await mount({
      schemas: () => [],
      roster: { current: 'alpha', keyError: 'roots missing' },
    })
    expect(await run(bare.ctx, bare.agent, '/tools'))
      .toEqual({ kind: 'error', text: 'could not resolve the preset composition: roots missing' })
  })

  it('shows no panel when the fiber unloads while the standing key resolves', async () => {
    const gate = Promise.withResolvers<unknown>()
    const { ctx, agent, screen, fiber } = await mount({
      schemas: () => [],
      roster: { current: 'alpha', key: gate.promise },
    })
    const pending = run(ctx, agent, '/tools')
    await fiber.dispose()
    gate.resolve(STANDING_KEY)
    expect(await pending).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('mounts the panel over the scoped catalog and closes on Escape', async () => {
    const { ctx, screen, agent } = await mount({
      schemas: () => [tool('bash', 'Run a command'), tool('mcp__demo__get', 'demo get')],
    })
    const result = await run(ctx, agent, '/tools')
    expect(result).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    expect(overlay.hidden).toBe(false)
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('Tools (1)'))).toBe(true)
    expect(rows.some(row => row.includes('bash'))).toBe(true)
    expect(rows.some(row => row.includes('Run a command'))).toBe(true)
    expect(rows.some(row => row.includes('MCP · demo (1)'))).toBe(true)
    expect(rows.some(row => row.includes('mcp__demo__get'))).toBe(true)
    overlay.component.handleInput?.('\x1b')
    expect(overlay.hidden).toBe(true)
  })

  it('refuses without a live session', async () => {
    const { ctx, agent } = await mount({ attach: false, schemas: () => [] })
    expect(await run(ctx, agent, '/tools')).toEqual({ kind: 'error', text: 'no session is live yet' })
  })

  it('refuses without the display services', async () => {
    const { ctx, agent } = await mount({ display: false, schemas: () => [] })
    expect(await run(ctx, agent, '/tools'))
      .toEqual({ kind: 'error', text: 'tools panel is unavailable: the Blue screen is not mounted' })
  })

  it('refuses without a tool registry', async () => {
    const { ctx, agent } = await mount()
    expect(await run(ctx, agent, '/tools'))
      .toEqual({ kind: 'error', text: 'tool registry is unavailable: the host composes no tools service' })
  })

  it('unloading the command fiber removes the registration', async () => {
    const { ctx } = await mount({ schemas: () => [] })
    // Hold the runtime: ctx.commands resolves undefined once the tree is gone.
    const commands = ctx.commands
    await ctx.fiber.dispose()
    expect(commands.list().map(command => command.name)).not.toContain('tools')
  })
})
