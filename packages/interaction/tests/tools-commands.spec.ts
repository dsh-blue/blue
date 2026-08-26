/**
 * Unit tests for the `/tools` command family: the pure builders (the
 * first-sentence brief, the display-line wrapping, the picker rows, the
 * defensive parameter extraction, the detail sections), and the command
 * over the real command runtime — picker mount, the stacked detail panel
 * with Escape walking back, the empty catalog, and the guard chain.
 */

import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import {
  buildToolDetailSections,
  buildToolPickerRows,
  firstSentence,
  readParameters,
  wrapLines,
} from '../src/tools-commands.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#!?]/g, ''))
}

/** One schema fixture; `parameters` defaults to an empty object schema. */
function tool(name: string, description = '', parameters?: Record<string, unknown>): ToolSchema {
  return { name, description, parameters: parameters ?? { type: 'object', properties: {} } }
}

describe('firstSentence', () => {
  it('takes the first non-empty line, cut after its first sentence end', () => {
    expect(firstSentence('Run a command. Use it for everything else.\nSecond line.'))
      .toBe('Run a command.')
    expect(firstSentence('\n\n  Run a command  \n* bullet body')).toBe('Run a command')
    // CJK sentence ends cut too.
    expect(firstSentence('运行命令。更多说明。')).toBe('运行命令。')
  })

  it('answers an empty string for a textless description', () => {
    expect(firstSentence('')).toBe('')
    expect(firstSentence('\n \n')).toBe('')
  })
})

describe('wrapLines', () => {
  it('keeps short lines verbatim and drops empty ones', () => {
    expect(wrapLines('one\ntwo\n\n  \nthree')).toEqual(['one', 'two', 'three'])
  })

  it('word-wraps a line past the budget on space boundaries', () => {
    const wrapped = wrapLines(`${'word '.repeat(20)}end`)
    expect(wrapped.length).toBeGreaterThan(1)
    for (const line of wrapped) expect(line.length).toBeLessThanOrEqual(64)
    expect(wrapped.at(-1)!.endsWith('end')).toBe(true)
    // A single word longer than the budget stays one line (the panel's
    // width truncation is the backstop, never a mid-word cut here).
    expect(wrapLines('x'.repeat(100))).toEqual(['x'.repeat(100)])
  })
})

describe('buildToolPickerRows', () => {
  it('lists name-sorted rows with the first sentence, omitting empty briefs', () => {
    const rows = buildToolPickerRows([
      tool('bash', 'Run a command.\nLong body follows.'),
      tool('edit'),
      tool('mcp__demo__get', 'Fetch one item from demo.\nRate limited.'),
    ])
    expect(rows.map(row => row.value)).toEqual(['bash', 'edit', 'mcp__demo__get'])
    expect(rows[0]).toEqual({ value: 'bash', label: 'bash', description: 'Run a command.' })
    expect(rows[1]).toEqual({ value: 'edit', label: 'edit' })
    expect(rows[2]!.description).toBe('Fetch one item from demo.')
  })
})

describe('readParameters', () => {
  it('extracts type, description, and the required marking in property order', () => {
    const facts = readParameters({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path.\nMore.' },
        force: { type: 'boolean' },
        legacy: {},
      },
      required: ['path', 'legacy'],
    })
    expect(facts).toEqual([
      { name: 'path', type: 'string', description: 'The file path.', required: true },
      { name: 'force', type: 'boolean', description: '', required: false },
      { name: 'legacy', type: 'any', description: '', required: true },
    ])
  })

  it('answers undefined for absent, non-object, or empty shapes', () => {
    expect(readParameters(undefined)).toBeUndefined()
    expect(readParameters({ type: 'object' })).toBeUndefined()
    expect(readParameters({ properties: 'nope' as unknown as Record<string, unknown> })).toBeUndefined()
    expect(readParameters({ properties: {} })).toBeUndefined()
    expect(readParameters({ properties: { broken: 'scalar' as unknown as object } })).toBeUndefined()
    expect(readParameters({ required: 'path', properties: { path: { type: 'string' } } } as unknown as Record<string, unknown>))
      .toEqual([{ name: 'path', type: 'string', description: '', required: false }])
  })
})

describe('buildToolDetailSections', () => {
  it('shows the identity rows with the MCP server, wrapped description, and parameters', () => {
    const sections = buildToolDetailSections(tool(
      'mcp__demo__get',
      'Fetch one item from the demo server.\nArguments:\n* id — the item id',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The item id' },
          verbose: { type: 'boolean' },
        },
        required: ['id'],
      },
    ))
    expect(sections.map(section => section.heading)).toEqual(['Tool', 'Description', 'Parameters (2)'])
    expect(sections[0]!.rows).toEqual([
      { label: 'name', segments: [{ text: 'mcp__demo__get' }] },
      { label: 'server', segments: [{ text: 'demo' }] },
    ])
    expect(sections[1]!.rows.map(row => row.segments[0]!.text))
      .toEqual(['Fetch one item from the demo server.', 'Arguments:', '* id — the item id'])
    expect(sections[2]!.rows).toEqual([
      {
        label: 'id',
        segments: [
          { text: 'string', style: 'muted' },
          { text: ' — The item id' },
          { text: ' · required', style: 'warning' },
        ],
      },
      {
        label: 'verbose',
        segments: [{ text: 'boolean', style: 'muted' }],
      },
    ])
  })

  it('omits the server row for builtin tools and marks absent text and parameters muted', () => {
    const sections = buildToolDetailSections(tool('edit'))
    expect(sections[0]!.rows).toEqual([{ label: 'name', segments: [{ text: 'edit' }] }])
    expect(sections[1]!.rows).toEqual([{ label: '', segments: [{ text: '(no description)', style: 'muted' }] }])
    expect(sections[2]).toEqual({
      heading: 'Parameters',
      rows: [{ label: '', segments: [{ text: '(no parameters)', style: 'muted' }] }],
    })
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
    const base = fakeBlueContext({ display: options.display })
    const { ctx } = base
    const screen = base.screen
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('tools-spec'), { meta: { cwd: '/tmp/spec' } })
    const agent = { id: session.id, session, status: 'idle', ctx: new Context() } as unknown as Agent
    if (options.attach !== false) {
      ctx.provide('testSession', { current: agent })
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

  it('opens the picker, stacks the detail on Enter, and Escape walks back twice', async () => {
    const { ctx, screen, agent } = await mount({
      schemas: () => [
        tool('spec_probe', 'Probe the catalog.', 'arguments follow', {
          type: 'object',
          properties: { target: { type: 'string', description: 'What to probe' } },
          required: ['target'],
        }),
        tool('mcp__demo__get', 'Fetch one item.'),
      ],
    })
    expect(await run(ctx, agent, '/tools')).toEqual({ kind: 'success' })
    // The picker: name-sorted rows with their briefs (mcp sorts first).
    const picker = screen.overlays.at(-1)!
    expect(picker.hidden).toBe(false)
    let rows = plain(picker.component.render(100))
    expect(rows.some(row => row.includes('mcp__demo__get') && row.includes('Fetch one item.'))).toBe(true)
    expect(rows.some(row => row.includes('spec_probe') && row.includes('Probe the catalog.'))).toBe(true)
    // Enter on the head row opens the detail panel stacked above the picker.
    picker.component.handleInput(KEY.enter)
    const detail = screen.overlays.at(-1)!
    expect(detail).not.toBe(picker)
    rows = plain((detail.component as InfoPanel).render(100))
    expect(rows.some(row => row.includes('name'))).toBe(true)
    expect(rows.some(row => row.includes('mcp__demo__get'))).toBe(true)
    expect(rows.some(row => row.includes('server'))).toBe(true)
    expect(rows.some(row => row.includes('Fetch one item.'))).toBe(true)
    // Escape pops the detail back onto the picker (the hidden detail
    // record stays in the array — the visible top is the picker), a
    // second Escape closes it.
    detail.component.handleInput(KEY.escape)
    expect(screen.overlays.filter(entry => !entry.hidden).at(-1)).toBe(picker)
    picker.component.handleInput(KEY.escape)
    expect(picker.hidden).toBe(true)
  })

  it('shows the read-only empty panel for an empty catalog, closing on Escape', async () => {
    const { ctx, screen, agent } = await mount({ schemas: () => [] })
    expect(await run(ctx, agent, '/tools')).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('no tools visible to this session'))).toBe(true)
    overlay.component.handleInput(KEY.escape)
    expect(overlay.hidden).toBe(true)
  })

  it('enumerates through the preset standing key when the agent runs on a roster composition', async () => {
    const scopes: unknown[] = []
    const { ctx, agent } = await mount({
      schemas: scope => {
        scopes.push(scope)
        return [tool('bash', 'Run a command')]
      },
      roster: { current: 'alpha' },
    })
    expect(await run(ctx, agent, '/tools')).toEqual({ kind: 'success' })
    expect(scopes).toEqual([undefined, STANDING_KEY])
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
