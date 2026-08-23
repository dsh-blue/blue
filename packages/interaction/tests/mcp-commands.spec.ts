/**
 * Unit tests for the `/mcp` command: the pure builders (the picker rows
 * with their attention-first ordering and honest trailing rows, the
 * per-server panel rows with the config pseudo-row, the config detail
 * sections with their status caveats and redacted connection facts, the
 * empty state), and the command over the real command runtime — the
 * three-level stack, Escape walking back, and the guard chain.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { clearSharedEditor } from '../src/editor-instance.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import {
  buildConfigSections,
  buildServerPanelRows,
  buildServerPickerRows,
  emptyMcpSections,
} from '../src/mcp-commands.ts'
import type { McpCatalog, McpServerView } from '../src/mcp-servers.ts'
import { FIBER_ACTIVE, FIBER_FAILED, MCP_CLIENT_MODULE } from '../src/mcp-servers.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

afterEach(() => {
  clearSharedEditor()
})

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#!?]/g, ''))
}

/** One schema fixture. */
function tool(name: string, description = ''): ToolSchema {
  return { name, description, parameters: { type: 'object', properties: {} } }
}

/** One server view fixture: a synced stdio server with one visible tool. */
function view(over: Partial<McpServerView> = {}): McpServerView {
  return {
    entryId: 'mcp-github',
    serverName: 'github',
    transport: 'stdio',
    endpoint: 'npx -y server-github',
    cwd: undefined,
    envKeys: [],
    headerKeys: [],
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
    disabled: false,
    fiberState: FIBER_ACTIVE,
    status: 'synced',
    registeredCount: 1,
    toolsVisible: [tool('mcp__github__create_issue', 'Create one issue.')],
    ...over,
  }
}

/** One catalog fixture. */
function catalog(servers: readonly McpServerView[], orphanCount = 0, sessionLive = true): McpCatalog {
  return { servers, orphanCount, sessionLive }
}

describe('buildServerPickerRows', () => {
  it('orders attention-first, then by name', () => {
    const rows = buildServerPickerRows(catalog([
      view({ entryId: 'a', serverName: 'zippy', status: 'synced' }),
      view({ entryId: 'b', serverName: 'alpha', status: 'synced' }),
      view({ entryId: 'c', serverName: 'late', status: 'failed', fiberState: FIBER_FAILED, registeredCount: 0, toolsVisible: [] }),
      view({ entryId: 'd', serverName: 'bare', status: 'no-tools', registeredCount: 0, toolsVisible: [] }),
    ]))
    expect(rows.map(row => row.value)).toEqual(['c', 'd', 'b', 'a'])
    expect(rows[0]!.description).toBe('stdio · failed · no tools registered')
    expect(rows[1]!.description).toBe('stdio · no tools · no tools registered')
    expect(rows[2]!.description).toBe('stdio · synced · 1 tool')
  })

  it('counts singular and plural, and splits the two views when they diverge', () => {
    const rows = buildServerPickerRows(catalog([
      view({ entryId: 'one', serverName: 'one', registeredCount: 1, toolsVisible: [tool('mcp__one__a')] }),
      view({
        entryId: 'two',
        serverName: 'two',
        status: 'restricted',
        registeredCount: 2,
        toolsVisible: [],
      }),
    ]))
    expect(rows[0]!.description).toBe('stdio · restricted · 0 of 2 tools visible')
    expect(rows[1]!.description).toBe('stdio · synced · 1 tool')
  })

  it('appends the no-session and orphan note rows when honest', () => {
    const quiet = buildServerPickerRows(catalog([view()], 0, false))
    expect(quiet.at(-1)).toMatchObject({ value: '__no_session__', disabled: true })
    const orphans = buildServerPickerRows(catalog([view()], 1))
    expect(orphans.at(-1)).toMatchObject({ value: '__orphans__', disabled: true, label: '(1 mcp__ tool)' })
    expect(buildServerPickerRows(catalog([view()], 2)).at(-1)!.label).toBe('(2 mcp__ tools)')
  })
})

describe('buildServerPanelRows', () => {
  it('leads with the config row, then raw-named tools with briefs', () => {
    const rows = buildServerPanelRows(view({
      toolsVisible: [tool('mcp__github__create_issue', 'Create one issue.'), tool('mcp__github__search')],
    }))
    expect(rows[0]).toEqual({ value: '__server_config__', label: 'server config', description: 'transport · endpoint · policy' })
    expect(rows[1]).toEqual({ value: 'mcp__github__create_issue', label: 'create_issue', description: 'Create one issue.' })
    expect(rows[2]).toEqual({ value: 'mcp__github__search', label: 'search' })
  })

  it('adds the honest blocked row for empty and restricted servers', () => {
    const empty = buildServerPanelRows(view({ status: 'no-tools', registeredCount: 0, toolsVisible: [] }))
    expect(empty.at(-1)).toMatchObject({ value: '__no_tools__', disabled: true })
    const restricted = buildServerPanelRows(view({
      status: 'restricted',
      registeredCount: 3,
      toolsVisible: [tool('mcp__github__create_issue')],
    }))
    expect(restricted.at(-1)).toMatchObject({ value: '__restricted__', label: '(2 more registered)', disabled: true })
  })
})

describe('buildConfigSections', () => {
  it('renders status, counts, connection facts, and the resolved policy', () => {
    const sections = buildConfigSections(view({
      envKeys: ['GITHUB_TOKEN'],
      cwd: '/srv',
    }), catalog([view()]))
    const flat = sections.flatMap(section => section.rows.map(row =>
      `${section.heading} ${row.label} ${row.segments.map(segment => segment.text).join('')}`))
    expect(flat.some(line => line.includes('Status status synced'))).toBe(true)
    expect(flat.some(line => line.includes('registered 1'))).toBe(true)
    expect(flat.some(line => line.includes('visible 1'))).toBe(true)
    expect(flat.some(line => line.includes('command npx -y server-github'))).toBe(true)
    expect(flat.some(line => line.includes('cwd /srv'))).toBe(true)
    expect(flat.some(line => line.includes('env keys GITHUB_TOKEN'))).toBe(true)
    expect(flat.some(line => line.includes('header keys (none)'))).toBe(true)
    expect(flat.some(line => line.includes('tool timeout 60000 ms'))).toBe(true)
    expect(flat.some(line => line.includes('fail on startup error false'))).toBe(true)
    expect(flat.some(line => line.includes('enabled · 500 ms → 30000 ms backoff · max 10 attempts'))).toBe(true)
    expect(flat.some(line => line.includes('dsh-blue.dev'))).toBe(true)
    // The secret-bearing values never render — only the key list.
    expect(flat.every(line => !line.includes('secret'))).toBe(true)
  })

  it('switches the endpoint label for HTTP and notes a missing session', () => {
    const sections = buildConfigSections(view({
      transport: 'streamable-http',
      endpoint: 'http://localhost:3000/mcp',
      headerKeys: ['Authorization'],
      failOnStartupError: true,
    }), catalog([view()], 0, false))
    const flat = sections.flatMap(section => section.rows.map(row =>
      `${row.label} ${row.segments.map(segment => segment.text).join('')}`))
    expect(flat.some(line => line.includes('url http://localhost:3000/mcp'))).toBe(true)
    expect(flat.some(line => line.includes('header keys Authorization'))).toBe(true)
    expect(flat.some(line => line.includes('fail on startup error true'))).toBe(true)
    expect(flat.some(line => line.includes('visible — (no live session)'))).toBe(true)
  })

  it('carries the caveat line per honest status and omits absent policy rows', () => {
    const caveat = (server: McpServerView): string | undefined =>
      buildConfigSections(server, catalog([server]))
        .find(section => section.heading === 'Status')!
        .rows.find(row => row.label === 'note')
        ?.segments.at(-1)?.text
    expect(caveat(view({ status: 'no-tools', registeredCount: 0, toolsVisible: [] })))
      .toBe('no tools registered — connecting, contained startup failure, or reconnects exhausted; reload the plugin or restart the host')
    expect(caveat(view({ status: 'restricted', registeredCount: 2, toolsVisible: [] })))
      .toBe('tools registered but not visible to this session — a preset restriction, not a dead server')
    expect(caveat(view({ status: 'failed' }))).toBe('the entry failed to start — see the host logs')
    expect(caveat(view({ status: 'reloading' }))).toBe('the entry is being swapped (HMR) — reopen the panel')
    expect(caveat(view({ status: 'disabled' }))).toBe('the entry is disabled in the composition')
    expect(caveat(view({ status: 'starting' }))).toBeUndefined()
    expect(caveat(view())).toBeUndefined()
    // Absent policy facts omit their rows instead of inventing values.
    const policyRows = (server: McpServerView) => buildConfigSections(server, catalog([server]))
      .find(section => section.heading === 'Policy')!.rows
    const lean = policyRows(view({ toolCallTimeoutMs: undefined, failOnStartupError: undefined, reconnect: undefined }))
    expect(lean.map(row => row.label)).toEqual(['reconnect'])
    expect(lean[0]!.segments.at(-1)!.text).toBe('(not resolved)')
    expect(policyRows(view({ reconnect: { enabled: false, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 } }))
      .find(row => row.label === 'reconnect')!.segments[0]!.text).toBe('disabled')
  })
})

describe('emptyMcpSections', () => {
  it('guides to the profile patch, noting orphaned tools when present', () => {
    const flat = emptyMcpSections(catalog([], 0)).flatMap(section => section.rows)
    expect(flat[0]!.segments[0]!.text).toBe('no MCP servers are declared')
    expect(flat[1]!.segments[0]!.text).toContain('dsh-blue.dev')
    expect(emptyMcpSections(catalog([], 1))[0]!.rows.at(-1)!.segments[0]!.text)
      .toBe('(1 mcp__ tool visible but undeclared)')
    expect(emptyMcpSections(catalog([], 2))[0]!.rows.at(-1)!.segments[0]!.text)
      .toBe('(2 mcp__ tools visible but undeclared)')
  })
})

describe('registerMcpCommands', () => {
  /** The stdio entry config one connected fixture server normalizes to. */
  const ENTRY_CONFIG = {
    transport: 'stdio',
    serverName: 'github',
    command: 'npx',
    args: ['-y', 'server-github'],
    env: { GITHUB_TOKEN: 'secret-value' },
    cwd: '',
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
  }

  /** Build a loader-entry fake. */
  function entry(over: { readonly id?: string, readonly name?: string, readonly state?: number, readonly disabled?: boolean } = {}): Entry {
    return {
      id: over.id ?? 'mcp-github',
      options: { name: over.name ?? MCP_CLIENT_MODULE, config: ENTRY_CONFIG },
      fiber: { config: ENTRY_CONFIG, state: over.state ?? FIBER_ACTIVE },
      disabled: over.disabled ?? false,
    } as unknown as Entry
  }

  /** Mount the command plugin over the fake services. */
  async function mount(options: {
    readonly display?: boolean
    readonly entries?: readonly Entry[]
    readonly global?: readonly ToolSchema[]
    readonly scoped?: readonly ToolSchema[]
    readonly session?: boolean
    readonly dropLoader?: boolean
    readonly rosterError?: unknown
  } = {}): Promise<{ ctx: Context, screen: FakeScreen, agent: Agent }> {
    const base = options.display === false ? { ctx: new Context() } : fakeBlueContext()
    const { ctx } = base
    const screen = 'screen' in base ? base.screen : undefined
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('mcp-spec'), { meta: { cwd: '/tmp/spec' } })
    const agent = { id: session.id, session, status: 'idle', ctx: new Context() } as unknown as Agent
    if (options.session !== false) {
      ctx.provide('blueSession', { current: agent })
      // The roster fake routes the scoped read through a standing key, so
      // the two views (global health / scoped visibility) genuinely diverge
      // when a case passes an explicit scoped list.
      ctx.provide('agentPresets', {
        composedPreset: () => 'e2e',
        standingKeyFor: () => options.rosterError === undefined
          ? Promise.resolve({ standing: true })
          : Promise.reject(options.rosterError),
      } as never)
    }
    ctx.provide('tools', {
      schemas: (scope?: unknown) => scope === undefined
        ? options.global ?? []
        : options.scoped ?? options.global ?? [],
    } as never)
    if (options.dropLoader !== true) {
      const entries = options.entries ?? []
      ctx.provide('loader', { entries: function* () { yield* entries } } as never)
    }
    await ctx.plugin(commandsPlugin)
    return { ctx, screen: screen as FakeScreen, agent }
  }

  async function run(ctx: Context, agent: Agent, line: string) {
    const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
    return execution?.result
  }

  it('registers the command on the runtime', async () => {
    const { ctx, agent } = await mount()
    expect(ctx.commands.list().map(command => command.name)).toContain('mcp')
    await run(ctx, agent, '/mcp')
  })

  it('walks the three-level stack and Escape climbs back', async () => {
    const { ctx, screen, agent } = await mount({
      entries: [entry()],
      global: [
        tool('mcp__github__create_issue', 'Create one issue.', ),
        tool('mcp__github__search', 'Search everything.'),
      ],
    })
    expect(await run(ctx, agent, '/mcp')).toEqual({ kind: 'success' })
    // L1: the server picker.
    const picker = screen.overlays.at(-1)!
    expect(picker.hidden).toBe(false)
    let rows = plain(picker.component.render(100))
    expect(rows.some(row => row.includes('github'))).toBe(true)
    expect(rows.some(row => row.includes('synced') && row.includes('2 tools'))).toBe(true)
    // L2: the per-server panel (config pseudo-row first, raw tool names).
    picker.component.handleInput(KEY.enter)
    const serverPanel = screen.overlays.at(-1)!
    expect(serverPanel).not.toBe(picker)
    rows = plain(serverPanel.component.render(100))
    expect(rows.some(row => row.includes('server config'))).toBe(true)
    expect(rows.some(row => row.includes('create_issue'))).toBe(true)
    expect(rows.some(row => row.includes('Create one issue.'))).toBe(true)
    // L3a: the config detail on the head row — redacted env keys only.
    serverPanel.component.handleInput(KEY.enter)
    const configDetail = screen.overlays.at(-1)! as { component: InfoPanel }
    rows = plain(configDetail.component.render(100))
    expect(rows.some(row => row.includes('GITHUB_TOKEN'))).toBe(true)
    expect(rows.every(row => !row.includes('secret-value'))).toBe(true)
    expect(rows.some(row => row.includes('npx -y server-github'))).toBe(true)
    // Escape walks back one level at a time (restored panels stay in the
    // overlay array hidden — the visible top is what climbs back).
    configDetail.component.handleInput(KEY.escape)
    expect(screen.overlays.filter(overlay => !overlay.hidden).at(-1)).toBe(serverPanel)
    // L3b: the tool schema detail on the first tool row.
    serverPanel.component.handleInput(KEY.down)
    serverPanel.component.handleInput(KEY.enter)
    const toolDetail = screen.overlays.at(-1)! as { component: InfoPanel }
    rows = plain(toolDetail.component.render(100))
    expect(rows.some(row => row.includes('mcp__github__create_issue'))).toBe(true)
    expect(rows.some(row => row.includes('Parameters'))).toBe(true)
    toolDetail.component.handleInput(KEY.escape)
    expect(screen.overlays.filter(overlay => !overlay.hidden).at(-1)).toBe(serverPanel)
    serverPanel.component.handleInput(KEY.escape)
    expect(screen.overlays.filter(overlay => !overlay.hidden).at(-1)).toBe(picker)
  })

  it('shows the restricted blocked row when the session view diverges', async () => {
    const { ctx, screen, agent } = await mount({
      entries: [entry()],
      global: [tool('mcp__github__create_issue'), tool('mcp__github__search')],
      scoped: [],
    })
    await run(ctx, agent, '/mcp')
    const picker = screen.overlays.at(-1)!
    expect(plain(picker.component.render(100)).some(row => row.includes('restricted'))).toBe(true)
    picker.component.handleInput(KEY.enter)
    const serverPanel = screen.overlays.at(-1)!
    expect(plain(serverPanel.component.render(100)).some(row => row.includes('2 more registered'))).toBe(true)
  })

  it('mounts the guidance panel for an empty catalog, noting orphan tools', async () => {
    const { ctx, screen, agent } = await mount({
      entries: [],
      global: [tool('mcp__ghost__haunt')],
    })
    await run(ctx, agent, '/mcp')
    const empty = screen.overlays.at(-1)! as { component: InfoPanel }
    const rows = plain(empty.component.render(100))
    expect(rows.some(row => row.includes('no MCP servers are declared'))).toBe(true)
    expect(rows.some(row => row.includes('dsh-blue.dev'))).toBe(true)
    expect(rows.some(row => row.includes('1 mcp__ tool visible but undeclared'))).toBe(true)
  })

  it('appends the no-session note row without a live agent', async () => {
    const { ctx, screen, agent } = await mount({ entries: [entry()], session: false, global: [tool('mcp__github__search')] })
    await run(ctx, agent, '/mcp')
    const picker = screen.overlays.at(-1)!
    expect(plain(picker.component.render(100)).some(row => row.includes('no live session'))).toBe(true)
  })

  it('guards the unmounted screen and the missing loader', async () => {
    const bare = await mount({ display: false })
    expect(await run(bare.ctx, bare.agent, '/mcp')).toMatchObject({
      kind: 'error',
      text: 'mcp panel is unavailable: the Blue screen is not mounted',
    })
    const unhosted = await mount({ dropLoader: true })
    expect(await run(unhosted.ctx, unhosted.agent, '/mcp')).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('could not read the MCP catalog'),
    })
    // A non-Error rejection still renders as its string form.
    const crashed = await mount({ rosterError: 'plain roster failure' })
    expect(await run(crashed.ctx, crashed.agent, '/mcp')).toMatchObject({
      kind: 'error',
      text: 'could not read the MCP catalog: plain roster failure',
    })
  })
})
