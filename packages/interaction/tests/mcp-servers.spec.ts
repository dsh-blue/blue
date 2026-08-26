/**
 * Unit tests for the `/mcp` read layer: the secret-key redaction, the
 * status derivation table (fiber state × registered/visible counts), and
 * the collector's join — loader entries against the two registry views
 * (global = health, session scope = callable), the orphan count, the
 * no-session degradation, and the raw-config fallbacks.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import {
  collectMcpServers,
  deriveMcpStatus,
  FIBER_ACTIVE,
  FIBER_DISPOSED,
  FIBER_FAILED,
  FIBER_LOADING,
  FIBER_PENDING,
  FIBER_UNLOADING,
  MCP_CLIENT_MODULE,
  readSecretKeys,
} from '../src/mcp-servers.ts'

/** A tool schema carrying only what the read layer joins on. */
function tool(name: string): ToolSchema {
  return { name, description: '' }
}

/** Build a loader-entry fake with the structural fields the reader touches. */
function entry(over: {
  readonly id?: string
  readonly name?: string
  readonly config?: unknown
  readonly fiberConfig?: unknown
  readonly state?: number
  readonly disabled?: boolean
}): Entry {
  return {
    id: over.id ?? 'mcp-entry',
    options: { name: over.name ?? MCP_CLIENT_MODULE, config: over.config ?? {} },
    ...(over.fiberConfig === undefined && over.state === undefined
      ? { fiber: undefined }
      : { fiber: { config: over.fiberConfig ?? {}, state: over.state ?? FIBER_ACTIVE } }),
    disabled: over.disabled ?? false,
  } as unknown as Entry
}

/** The stdio config shape dsh-mcp-client normalizes to. */
const STDIO_CONFIG = {
  transport: 'stdio',
  serverName: 'github',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: 'secret-value', B_FLAG: 'x' },
  cwd: '',
  toolCallTimeoutMs: 90_000,
  failOnStartupError: false,
  reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
}

/** Provide a context with the four services the collector reads. */
function collectContext(over: {
  readonly entries?: readonly Entry[]
  readonly global?: readonly ToolSchema[]
  readonly scoped?: readonly ToolSchema[]
  readonly session?: boolean
  readonly roster?: boolean
  readonly drop?: 'loader' | 'tools'
}): Context {
  const ctx = new Context()
  let agentCtx: Context | undefined
  if (over.drop !== 'loader') {
    const entries = over.entries ?? []
    ctx.provide('loader', { entries: function* () { yield* entries } } as never)
  }
  if (over.drop !== 'tools') {
    // The scoped view defaults to the global list: the common session sees
    // its server's tools; restriction cases pass an explicit scoped list.
    ctx.provide('tools', {
      schemas: (scope?: unknown) => (scope === undefined ? over.global ?? [] : over.scoped ?? over.global ?? []),
    } as never)
  }
  if (over.session !== false) {
    agentCtx = new Context()
    ctx.provide('testSession', { current: { ctx: agentCtx } } as never)
    if (over.roster !== false) {
      const scope = { scope: true }
      ctx.provide('agentPresets', {
        composedPreset: () => 'standard',
        standingKeyFor: () => Promise.resolve(scope),
      } as never)
    }
  }
  ctx.provide('blueSessionActions', {
    async toolCatalog() {
      const tools = ctx.get('tools') as unknown as { schemas(scope?: unknown): readonly ToolSchema[] } | undefined
      if (tools === undefined) {
        return { ok: false as const, code: 'BLUE_CAPABILITY_ABSENT' as const, message: 'tool registry is unavailable: the host composes no tools service' }
      }
      const registered = tools.schemas()
      if (agentCtx === undefined) return { ok: true as const, value: { sessionLive: false, registered, visible: registered } }
      const roster = ctx.get('agentPresets') as unknown as {
        composedPreset(scope: Context): string | undefined
        standingKeyFor(id: string): Promise<unknown>
      } | undefined
      try {
        const preset = roster?.composedPreset(agentCtx)
        const scope = preset === undefined ? undefined : await roster?.standingKeyFor(preset)
        return { ok: true as const, value: { sessionLive: true, registered, visible: scope === undefined ? registered : tools.schemas(scope) } }
      } catch (error) {
        return { ok: false as const, code: 'BLUE_ACTION_REJECTED' as const, message: `could not resolve the preset composition: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  } as never)
  return ctx
}

describe('readSecretKeys', () => {
  it('reads a record as its sorted key list, values never', () => {
    expect(readSecretKeys({ B_FLAG: 'x', GITHUB_TOKEN: 'secret' })).toEqual(['B_FLAG', 'GITHUB_TOKEN'])
  })

  it('returns an empty list for every non-record shape', () => {
    expect(readSecretKeys(undefined)).toEqual([])
    expect(readSecretKeys(null)).toEqual([])
    expect(readSecretKeys(['A'])).toEqual([])
    expect(readSecretKeys('A')).toEqual([])
  })
})

describe('deriveMcpStatus', () => {
  const facts = (over: Partial<Parameters<typeof deriveMcpStatus>[0]> = {}) => ({
    disabled: false,
    fiberState: FIBER_ACTIVE,
    registeredCount: 1,
    visibleCount: 1,
    ...over,
  })

  it('disabled wins over every other signal', () => {
    expect(deriveMcpStatus(facts({ disabled: true, fiberState: FIBER_FAILED, registeredCount: 0 }))).toBe('disabled')
  })

  it('a failed fiber is failed regardless of tools', () => {
    expect(deriveMcpStatus(facts({ fiberState: FIBER_FAILED }))).toBe('failed')
  })

  it('unload and dispose read as mid-reload (the HMR swap window)', () => {
    expect(deriveMcpStatus(facts({ fiberState: FIBER_UNLOADING }))).toBe('reloading')
    expect(deriveMcpStatus(facts({ fiberState: FIBER_DISPOSED }))).toBe('reloading')
  })

  it('ACTIVE with registered tools splits on session visibility', () => {
    expect(deriveMcpStatus(facts({ visibleCount: 2 }))).toBe('synced')
    expect(deriveMcpStatus(facts({ visibleCount: 0 }))).toBe('restricted')
  })

  it('ACTIVE with nothing registered is the ambiguous no-tools state', () => {
    expect(deriveMcpStatus(facts({ registeredCount: 0, visibleCount: 0 }))).toBe('no-tools')
  })

  it('pending, loading, missing, and unknown fibers all read as starting', () => {
    expect(deriveMcpStatus(facts({ fiberState: FIBER_PENDING }))).toBe('starting')
    expect(deriveMcpStatus(facts({ fiberState: FIBER_LOADING }))).toBe('starting')
    expect(deriveMcpStatus(facts({ fiberState: undefined }))).toBe('starting')
    expect(deriveMcpStatus(facts({ fiberState: 99 }))).toBe('starting')
  })
})

describe('collectMcpServers', () => {
  it('reads a normalized stdio config with redacted env and resolved policy', async () => {
    const ctx = collectContext({
      entries: [entry({ id: 'mcp-github', fiberConfig: STDIO_CONFIG })],
      global: [tool('mcp__github__create_issue'), tool('mcp__github__search')],
    })
    const catalog = await collectMcpServers(ctx)
    expect(catalog.sessionLive).toBe(true)
    expect(catalog.orphanCount).toBe(0)
    expect(catalog.servers).toHaveLength(1)
    const server = catalog.servers[0]!
    expect(server).toMatchObject({
      entryId: 'mcp-github',
      serverName: 'github',
      transport: 'stdio',
      endpoint: 'npx -y @modelcontextprotocol/server-github',
      envKeys: ['B_FLAG', 'GITHUB_TOKEN'],
      headerKeys: [],
      cwd: undefined,
      toolCallTimeoutMs: 90_000,
      failOnStartupError: false,
      reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
      status: 'synced',
      registeredCount: 2,
    })
    expect(server.toolsVisible.map(schema => schema.name)).toEqual([
      'mcp__github__create_issue',
      'mcp__github__search',
    ])
  })

  it('reads a streamable-http config with redacted headers', async () => {
    const ctx = collectContext({
      entries: [entry({
        fiberConfig: {
          transport: 'streamable-http',
          serverName: 'web',
          url: 'http://localhost:3000/mcp',
          headers: { Authorization: 'Bearer secret' },
          toolCallTimeoutMs: 60_000,
          failOnStartupError: true,
          reconnect: { enabled: false, initialDelayMs: 1, maxDelayMs: 2, maxAttempts: 3 },
        },
      })],
      global: [tool('mcp__web__search')],
    })
    const server = (await collectMcpServers(ctx)).servers[0]!
    expect(server.endpoint).toBe('http://localhost:3000/mcp')
    expect(server.headerKeys).toEqual(['Authorization'])
    expect(server.envKeys).toEqual([])
    expect(server.failOnStartupError).toBe(true)
  })

  it('joins the two views: restricted reads registered-but-not-visible', async () => {
    const ctx = collectContext({
      entries: [entry({ fiberConfig: { ...STDIO_CONFIG, serverName: 'limited' } })],
      global: [tool('mcp__limited__one'), tool('mcp__limited__two')],
      scoped: [],
    })
    const server = (await collectMcpServers(ctx)).servers[0]!
    expect(server.status).toBe('restricted')
    expect(server.registeredCount).toBe(2)
    expect(server.toolsVisible).toEqual([])
  })

  it('counts orphans and ignores non-mcp and unmatched tools', async () => {
    const ctx = collectContext({
      entries: [entry({ fiberConfig: { ...STDIO_CONFIG, serverName: 'known' } })],
      global: [
        tool('spec_probe'),
        tool('mcp__known__one'),
        tool('mcp__other__two'),
        tool('mcp__nobody'),
      ],
    })
    const catalog = await collectMcpServers(ctx)
    expect(catalog.orphanCount).toBe(2)
    expect(catalog.servers[0]!.registeredCount).toBe(1)
  })

  it('degrades to the global view with a session flag when no agent is live', async () => {
    const ctx = collectContext({
      entries: [entry({ fiberConfig: STDIO_CONFIG })],
      global: [tool('mcp__github__create_issue')],
      session: false,
    })
    const catalog = await collectMcpServers(ctx)
    expect(catalog.sessionLive).toBe(false)
    expect(catalog.servers[0]!.toolsVisible).toHaveLength(1)
  })

  it('falls back to the raw options config for a never-started entry', async () => {
    const ctx = collectContext({
      entries: [entry({ config: STDIO_CONFIG, fiberConfig: undefined, state: undefined })],
    })
    const server = (await collectMcpServers(ctx)).servers[0]!
    expect(server.serverName).toBe('github')
    expect(server.status).toBe('starting')
    expect(server.toolsVisible).toEqual([])
  })

  it('labels a failed entry and falls back to the entry id without a serverName', async () => {
    const ctx = collectContext({
      entries: [
        entry({ id: 'broken', fiberConfig: {}, state: FIBER_FAILED }),
        entry({ id: 'odd', fiberConfig: { transport: 'weird' } }),
      ],
    })
    const servers = (await collectMcpServers(ctx)).servers
    expect(servers[0]).toMatchObject({ serverName: 'broken', status: 'failed', transport: 'unknown' })
    expect(servers[1]).toMatchObject({
      serverName: 'odd',
      status: 'no-tools',
      transport: 'weird',
      endpoint: '(no command)',
    })
  })

  it('marks a disabled entry', async () => {
    const ctx = collectContext({
      entries: [entry({ fiberConfig: STDIO_CONFIG, disabled: true })],
      global: [tool('mcp__github__create_issue')],
    })
    const server = (await collectMcpServers(ctx)).servers[0]!
    expect(server.status).toBe('disabled')
    // A disabled server's tools are not registered; the join stays honest.
    expect(server.registeredCount).toBe(1)
  })

  it('shares the namespace count across duplicate serverName rows', async () => {
    const ctx = collectContext({
      entries: [
        entry({ id: 'first', fiberConfig: STDIO_CONFIG }),
        entry({ id: 'second', fiberConfig: STDIO_CONFIG, state: FIBER_FAILED }),
      ],
      global: [tool('mcp__github__create_issue')],
    })
    const servers = (await collectMcpServers(ctx)).servers
    expect(servers.map(server => server.status)).toEqual(['synced', 'failed'])
    expect(servers.every(server => server.registeredCount === 1)).toBe(true)
  })

  it('shows a set cwd and a partial reconnect as absent', async () => {
    const ctx = collectContext({
      entries: [entry({
        fiberConfig: {
          ...STDIO_CONFIG,
          cwd: '/srv',
          reconnect: { enabled: true, initialDelayMs: 500 },
        },
      })],
    })
    const server = (await collectMcpServers(ctx)).servers[0]!
    expect(server.cwd).toBe('/srv')
    expect(server.reconnect).toBeUndefined()
  })

  it('rejects when the host composes no loader or tools service', async () => {
    await expect(collectMcpServers(collectContext({ drop: 'loader' }))).rejects.toThrow(/loader/)
    await expect(collectMcpServers(collectContext({ drop: 'tools' }))).rejects.toThrow(/tools/)
  })

  it('propagates roster failures to the caller', async () => {
    const ctx = collectContext({ entries: [], global: [] })
    ctx.set('agentPresets', {
      composedPreset: () => 'standard',
      standingKeyFor: () => Promise.reject(new Error('roster boom')),
    } as never)
    await expect(collectMcpServers(ctx)).rejects.toThrow('roster boom')
  })

  it('ignores non-mcp entries and covers the endpoint fallbacks', async () => {
    const ctx = collectContext({
      entries: [
        entry({ id: 'other-plugin', name: '@deepseek-ai/dsh-elsewhere', config: {} }),
        entry({ fiberConfig: { ...STDIO_CONFIG, args: 'not-an-array' } }),
        entry({ fiberConfig: { ...STDIO_CONFIG, serverName: 'bare', args: [] } }),
        entry({ fiberConfig: { transport: 'streamable-http', serverName: 'noaddr' } }),
        entry({ id: 'nonrecord', fiberConfig: 'garbage', state: FIBER_ACTIVE }),
      ],
    })
    const servers = (await collectMcpServers(ctx)).servers
    expect(servers.map(server => server.serverName)).toEqual(['github', 'bare', 'noaddr', 'nonrecord'])
    expect(servers[0]!.endpoint).toBe('npx')
    expect(servers[1]!.endpoint).toBe('npx')
    expect(servers[2]!.endpoint).toBe('(no url)')
    expect(servers[3]).toMatchObject({ transport: 'unknown', endpoint: '(no command)', status: 'no-tools' })
  })

  it('resolves the global view when the host composes no roster', async () => {
    const ctx = collectContext({
      entries: [entry({ fiberConfig: STDIO_CONFIG })],
      global: [tool('mcp__github__create_issue')],
      roster: false,
    })
    const catalog = await collectMcpServers(ctx)
    expect(catalog.sessionLive).toBe(true)
    expect(catalog.servers[0]!.toolsVisible).toHaveLength(1)
  })
})
