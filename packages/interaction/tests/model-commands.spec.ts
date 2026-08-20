/**
 * The model-family commands over the real command runtime and the plugin
 * wiring: `/model` picker and direct switch, `/effort` selector and direct
 * level, the commit path's session-only/persist split, the alias relation,
 * and the unload guard.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentDefaultModelConfig } from '@deepseek-ai/dsh-agent-default-model'
import type { BlueModelSelectionRef } from '@dsh-blue/blue-app'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { canonicalOf } from '../src/command-meta.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

/** The notices the shared editor received. */
let notices: string[] = []

afterEach(() => {
  clearSharedEditor()
  notices = []
})

/** A mutable stand-in for the app's three-tier selection handle. */
function fakeModelRef(selection: ModelSelection): { ref: BlueModelSelectionRef, writes: ModelSelection[] } {
  const writes: ModelSelection[] = []
  const state = { current: selection }
  const ref = {
    get current() { return state.current },
    set current(next: ModelSelection) {
      state.current = next
      writes.push(next)
    },
    assembled: undefined,
  } as BlueModelSelectionRef
  return { ref, writes }
}

/** The fake llm catalog: providers → models, with per-model metadata. */
interface FakeCatalog {
  providers?: { id: string, name: string }[]
  configurable?: { provider: string, displayName: string }[]
  discovered?: { id: string, contextWindow?: number }[]
  models?: Record<string, { id: string, name: string }[]>
  /** Return a rejected metadata promise for these model ids. */
  failInfoFor?: string[]
  /** Throw the catalog listing for these provider ids. */
  failListFor?: string[]
  reasoning?: { efforts: { id: string, name: string }[], defaultEffort: string } | null
}

function fakeLlm(catalog: FakeCatalog = {}): LlmRuntime {
  const models = catalog.models ?? {
    mock: [
      { id: 'mock', name: 'Mock' },
      { id: 'mock-pro', name: 'Mock Pro' },
    ],
  }
  return {
    listProviders: () => catalog.providers ?? [{ id: 'mock', name: 'Mock' }],
    listConfigurableProviders: () => (catalog.configurable ?? [
      { provider: 'anthropic', displayName: 'Anthropic' },
    ]).map(entry => ({
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', entry.provider],
      declared: false,
    })),
    discoverModels: async () => [...catalog.discovered ?? []],
    listModels: async (provider: string) => {
      if (catalog.failListFor?.includes(provider)) throw new Error('catalog down')
      return [...models[provider] ?? []]
    },
    resolveModelInfo: async (provider: string, model: string) => {
      if (catalog.failInfoFor?.includes(model)) throw new Error('no metadata')
      return {
        provider,
        id: model,
        name: model,
        ...(catalog.reasoning === null ? {} : {
          context: { contextWindow: 65536 },
          reasoning: catalog.reasoning ?? {
            efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
            defaultEffort: 'high',
          },
        }),
      }
    },
  } as unknown as LlmRuntime
}

async function mount(options: {
  catalog?: FakeCatalog
  attach?: boolean
  modelRef?: BlueModelSelectionRef
  defaults?: { selection: ModelSelection, saveError?: Error } | false
  headerConfig?: { provider: string, model: string }
  llm?: LlmRuntime
  display?: boolean
} = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  agent: Agent
  modelRef: BlueModelSelectionRef
  writes: ModelSelection[]
  saveSelection: ReturnType<typeof vi.fn>
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  ctx.provide('llm', options.llm ?? fakeLlm(options.catalog))
  const session = ctx.sessions.create(SessionId('model-spec'))
  if (options.headerConfig !== undefined) {
    // The cache-warning branch reads the session's durable request header.
    ;(session as unknown as { requestHeader: () => unknown }).requestHeader
      = () => ({ config: options.headerConfig })
  }
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  const fake = fakeModelRef({ provider: 'mock', model: 'mock' })
  const modelRef = options.modelRef ?? fake.ref
  const writes = options.modelRef === undefined ? fake.writes : []
  const saveSelection = vi.fn(() => options.defaults?.saveError === undefined
    ? Promise.resolve()
    : Promise.reject(options.defaults.saveError))
  if (options.defaults !== false) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => options.defaults?.selection ?? { provider: 'mock', model: 'mock' },
      saveSelection,
    } as unknown as AgentDefaultModelConfig)
  }
  if (options.attach !== false) {
    ctx.provide('blueSession', { current: agent, modelRef })
  }
  setSharedEditor({
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: (text: string) => { notices.push(text) },
  })
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, screen, agent, modelRef, writes, saveSelection, fiber }
}

const signal = (): AbortSignal => new AbortController().signal

/** The overlay component of the last shown overlay. */
function overlay(screen: FakeScreen): { handleInput(data: string): void } {
  const entry = screen.overlays[screen.overlays.length - 1]
  expect(entry).toBeDefined()
  return entry!.component as unknown as { handleInput(data: string): void }
}

describe('model-family commands', () => {
  it('registers /model and /effort with the thinking alias', async () => {
    const { ctx, agent } = await mount()
    const names = ctx.commands.list(agent).map(command => command.name)
    expect(names).toContain('model')
    expect(names).toContain('effort')
    expect(names).toContain('provider')
    expect(canonicalOf('thinking')).toBe('effort')
    expect(ctx.commands.find(agent, 'model')?.input?.hint).toBe('[name]')
    expect(ctx.commands.find(agent, 'provider')?.input?.hint).toBe('[list | switch <provider> | add]')
  })

  it('unregisters both commands and the alias on unload', async () => {
    const { ctx, agent, fiber } = await mount()
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'model')).toBeUndefined()
    expect(ctx.commands.find(agent, 'effort')).toBeUndefined()
    expect(ctx.commands.find(agent, 'provider')).toBeUndefined()
    expect(canonicalOf('thinking')).toBeUndefined()
  })

  it('/model guards: no session and no selection handle', async () => {
    const { ctx, agent } = await mount({ attach: false })
    expect((await ctx.commands.execute(agent, '/model', signal()))?.result)
      .toEqual({ kind: 'error', text: 'no session is live yet' })

    const handleless = fakeBlueContext()
    await handleless.ctx.plugin(SessionStore)
    await handleless.ctx.plugin(CommandRuntime)
    handleless.ctx.provide('llm', fakeLlm())
    const bareSession = handleless.ctx.sessions.create(SessionId('handleless'))
    const bareAgent = { id: bareSession.id, session: bareSession, status: 'idle' } as unknown as Agent
    handleless.ctx.provide('blueSession', { current: bareAgent, modelRef: undefined })
    await handleless.ctx.plugin(commandsPlugin)
    expect((await handleless.ctx.commands.execute(bareAgent, '/model', signal()))?.result)
      .toEqual({ kind: 'error', text: 'model selection is unavailable for this session' })
  })

  it('/model reports the llm guard before anything else', async () => {
    // A tree whose llm provide never happened: every command answers the
    // service guard before touching the catalog.
    const bare = fakeBlueContext()
    await bare.ctx.plugin(SessionStore)
    await bare.ctx.plugin(CommandRuntime)
    const session = bare.ctx.sessions.create(SessionId('no-llm'))
    const bareAgent = { id: session.id, session, status: 'idle' } as unknown as Agent
    const fake = fakeModelRef({ provider: 'mock', model: 'mock' })
    bare.ctx.provide('blueSession', { current: bareAgent, modelRef: fake.ref })
    bare.ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'mock', model: 'mock' }),
      saveSelection: vi.fn(),
    } as unknown as AgentDefaultModelConfig)
    await bare.ctx.plugin(commandsPlugin)
    expect((await bare.ctx.commands.execute(bareAgent, '/model', signal()))?.result)
      .toEqual({ kind: 'error', text: 'the llm service is unavailable' })
  })

  it('/model opens the picker with metadata, current badge, and segment control', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/model', signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const rows = overlay(screen).render?.(80) ?? []
    const currentRow = rows.find(row => row.includes('← current'))
    expect(currentRow).toBeDefined()
    expect(currentRow).toContain('_· ctx 64k_')
    expect(rows.some(row => row.includes('Mock Pro'))).toBe(true)
    const caption = rows.find(row => row.includes('Thinking  (←→ to switch)'))
    expect(caption).toBeDefined()
    expect((rows[rows.indexOf(caption ?? '') + 1] ?? '')).toContain('[ High ]')
  })

  it('/model shows the cache warning row when the session already has a request header', async () => {
    const { ctx, screen, agent } = await mount({
      headerConfig: { provider: 'mock', model: 'mock' },
    })
    await ctx.commands.execute(agent, '/model', signal())
    const rows = overlay(screen).render?.(80) ?? []
    expect(rows.some(row => row.includes('?  switching models starts a fresh prompt cache?'))).toBe(true)
  })

  it('/model degrades rows whose metadata lookup fails', async () => {
    const { ctx, screen, agent } = await mount({ catalog: { failInfoFor: ['mock-pro'] } })
    await ctx.commands.execute(agent, '/model', signal())
    const rows = overlay(screen).render?.(80) ?? []
    const proRow = rows.find(row => row.includes('Mock Pro'))
    expect(proRow).toBeDefined()
    expect(proRow).not.toContain('ctx')
  })

  it('/model skips providers whose catalog listing fails', async () => {
    const { ctx, agent } = await mount({
      catalog: {
        providers: [{ id: 'mock', name: 'Mock' }, { id: 'broken', name: 'Broken' }],
        failListFor: ['broken'],
      },
    })
    const execution = await ctx.commands.execute(agent, '/model mock-pro', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'Switched to mock-pro (mock)' })
  })

  it('/model answers "no models" for an empty catalog and unknown ids', async () => {
    const empty = await mount({ catalog: { providers: [], models: {} } })
    // Restore one provider for the mount, then exercise the empty catalog
    // through a context whose only provider's listing fails.
    const execution = await empty.ctx.commands.execute(empty.agent, '/model', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'no models advertised for the configured providers',
    })

    const unknown = await mount()
    expect((await unknown.ctx.commands.execute(unknown.agent, '/model nope', signal()))?.result)
      .toEqual({ kind: 'error', text: 'unknown model: nope' })
  })

  it('/model prefers the live provider on an ambiguous id and lists candidates otherwise', async () => {
    const ambiguous = await mount({
      catalog: {
        providers: [{ id: 'mock', name: 'Mock' }, { id: 'other', name: 'Other' }],
        models: {
          mock: [{ id: 'shared', name: 'Shared' }],
          other: [{ id: 'shared', name: 'Shared' }],
        },
      },
    })
    const execution = await ambiguous.ctx.commands.execute(ambiguous.agent, '/model shared', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'Switched to shared (mock)' })
  })

  it('/model picker commits on Enter with the segment draft and persists the default', async () => {
    const { ctx, screen, agent, writes, saveSelection } = await mount()
    await ctx.commands.execute(agent, '/model', signal())
    // The current row's draft already sits at the model default (`high`);
    // committing it directly is the kimi untouched-draft behavior.
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(writes).toEqual([{ provider: 'mock', model: 'mock', reasoningEffort: 'high' as never }])
    expect(saveSelection).toHaveBeenCalledWith({ provider: 'mock', model: 'mock', reasoningEffort: 'high' as never })
    expect(notices[0]).toBe('Thinking set to high')
  })

  it('/model picker commits session-only with Alt+S and skips the default write', async () => {
    const { ctx, screen, agent, writes, saveSelection } = await mount()
    await ctx.commands.execute(agent, '/model', signal())
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.altS)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(writes).toEqual([{ provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' as never }])
    expect(saveSelection).not.toHaveBeenCalled()
    expect(notices[0]).toBe('Switched to mock-pro (mock) · thinking high · session only')
  })

  it('/model direct switch skips the save when the default already matches', async () => {
    const { ctx, agent, saveSelection } = await mount({
      defaults: { selection: { provider: 'mock', model: 'mock-pro' } },
    })
    const execution = await ctx.commands.execute(agent, '/model mock-pro', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'Switched to mock-pro (mock)' })
    expect(saveSelection).not.toHaveBeenCalled()
  })

  it('/model surfaces a failed default save and works without the default service', async () => {
    const failing = await mount({
      defaults: { selection: { provider: 'mock', model: 'mock' }, saveError: new Error('disk full') },
    })
    const execution = await failing.ctx.commands.execute(failing.agent, '/model mock-pro', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Switched to mock-pro (mock) — failed to save default: disk full',
    })
  })

  it('/effort guards: no reasoning metadata and resolve failure', async () => {
    const plain = await mount({ catalog: { reasoning: null } })
    expect((await plain.ctx.commands.execute(plain.agent, '/effort', signal()))?.result)
      .toEqual({ kind: 'error', text: 'the current model exposes no reasoning efforts' })
    expect((await plain.ctx.commands.execute(plain.agent, '/effort low', signal()))?.result)
      .toEqual({ kind: 'error', text: 'the current model exposes no reasoning efforts' })

    const broken = await mount({ catalog: { failInfoFor: ['mock'] } })
    expect((await broken.ctx.commands.execute(broken.agent, '/effort', signal()))?.result)
      .toEqual({ kind: 'error', text: 'could not resolve the current model: no metadata' })
  })

  it('/effort opens the segment selector seeded at the live effort', async () => {
    const { ctx, screen, agent, writes } = await mount()
    await ctx.commands.execute(agent, '/effort', signal())
    const rows = overlay(screen).render?.(60) ?? []
    const segmentRow = rows.find(row => row.includes('Default') || row.includes('[ '))
    expect(segmentRow).toBeDefined()
    overlay(screen).handleInput(KEY.left)
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    // No live effort → the `Default` segment starts active; Left wraps to
    // the last segment (`high`).
    expect(writes[0]).toMatchObject({ reasoningEffort: 'high' as never })
  })

  it('/effort direct: valid level, default, and the invalid-level listing', async () => {
    const { ctx, agent, writes } = await mount()
    const execution = await ctx.commands.execute(agent, '/effort low', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'Thinking set to low' })
    expect(writes[0]).toMatchObject({ reasoningEffort: 'low' as never })

    const back = await ctx.commands.execute(agent, '/effort default', signal())
    expect(back?.result).toEqual({ kind: 'success', text: 'Thinking set to provider default' })

    const bogus = await ctx.commands.execute(agent, '/effort bogus', signal())
    expect(bogus?.result).toEqual({
      kind: 'error',
      text: 'unsupported thinking effort "bogus" for mock: available: default, low, high',
    })
  })

  it('/model answers "Already using" when nothing changes', async () => {
    const preset = fakeModelRef({ provider: 'mock', model: 'mock', reasoningEffort: 'high' as never })
    const { ctx, agent } = await mount({ modelRef: preset.ref })
    const execution = await ctx.commands.execute(agent, '/effort high', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'Already using mock (mock)' })
  })

  it('/model works without the default-model service and says so', async () => {
    const { ctx, agent } = await mount({ defaults: false })
    const execution = await ctx.commands.execute(agent, '/model mock-pro', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Switched to mock-pro (mock) — default not saved: no default-model service',
    })
  })

  it('/model reports an ambiguity the live provider cannot resolve', async () => {
    const { ctx, agent } = await mount({
      catalog: {
        providers: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }],
        models: {
          alpha: [{ id: 'shared', name: 'Shared' }],
          beta: [{ id: 'shared', name: 'Shared' }],
        },
      },
    })
    const execution = await ctx.commands.execute(agent, '/model shared', signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'ambiguous model id: shared (alpha/shared, beta/shared)',
    })
  })

  it('/model and /effort report the missing display services', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('llm', fakeLlm())
    const session = ctx.sessions.create(SessionId('no-display'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    const fake = fakeModelRef({ provider: 'mock', model: 'mock' })
    ctx.provide('blueSession', { current: agent, modelRef: fake.ref })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'mock', model: 'mock' }),
      saveSelection: vi.fn(),
    } as unknown as AgentDefaultModelConfig)
    await ctx.plugin(commandsPlugin)
    expect((await ctx.commands.execute(agent, '/model', signal()))?.result)
      .toEqual({ kind: 'error', text: 'model picker is unavailable: the Blue screen is not mounted' })
    expect((await ctx.commands.execute(agent, '/effort', signal()))?.result)
      .toEqual({ kind: 'error', text: 'effort selector is unavailable: the Blue screen is not mounted' })
    await ctx.fiber.dispose()
  })

  it('/effort guards: no session and no llm service', async () => {
    const { ctx, agent } = await mount({ attach: false })
    expect((await ctx.commands.execute(agent, '/effort', signal()))?.result)
      .toEqual({ kind: 'error', text: 'no session is live yet' })
    await ctx.fiber.dispose()

  })

  it('/effort guards the llm service before resolving', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('effort-no-llm'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    const fake = fakeModelRef({ provider: 'mock', model: 'mock' })
    ctx.provide('blueSession', { current: agent, modelRef: fake.ref })
    await ctx.plugin(commandsPlugin)
    expect((await ctx.commands.execute(agent, '/effort', signal()))?.result)
      .toEqual({ kind: 'error', text: 'the llm service is unavailable' })
    await ctx.fiber.dispose()
  })

  it('cancels the pickers with Escape without committing', async () => {
    const { ctx, screen, agent, writes } = await mount()
    await ctx.commands.execute(agent, '/model', signal())
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[screen.overlays.length - 1]?.hidden).toBe(true)
    await ctx.commands.execute(agent, '/effort', signal())
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[screen.overlays.length - 1]?.hidden).toBe(true)
    expect(writes).toEqual([])
    expect(notices).toEqual([])
  })

  it('returns quietly when the tree unloads while the catalog is in flight', async () => {
    let release: (models: { id: string, name: string }[]) => void = () => {}
    const gate = new Promise<void>(resolve => { release = () => resolve([{ id: 'mock', name: 'Mock' }]) })
    const llm = {
      listProviders: () => [{ id: 'mock', name: 'Mock' }],
      listModels: async () => { await gate; return [{ id: 'mock', name: 'Mock' }] },
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
    } as unknown as LlmRuntime
    const { ctx, agent, screen, fiber } = await mount({ llm })
    const pending = ctx.commands.execute(agent, '/model', signal())
    await fiber.dispose()
    release([])
    expect((await pending)?.result).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('returns quietly when the tree unloads while the model metadata is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const llm = {
      listProviders: () => [{ id: 'mock', name: 'Mock' }],
      listModels: async () => [{ id: 'mock', name: 'Mock' }],
      resolveModelInfo: async () => { await gate; return {} },
    } as unknown as LlmRuntime
    const { ctx, agent, screen, fiber } = await mount({ llm })
    const pending = ctx.commands.execute(agent, '/effort', signal())
    await fiber.dispose()
    release()
    expect((await pending)?.result).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('/model falls back to the model id for an unnamed catalog entry', async () => {
    const { ctx, screen, agent } = await mount({
      catalog: { models: { mock: [{ id: 'mock', name: '' }] } },
    })
    await ctx.commands.execute(agent, '/model', signal())
    const rows = overlay(screen).render?.(60) ?? []
    expect(rows.some(row => row.includes('mock'))).toBe(true)
  })

  it('/model commits an effort-less pick without the effort key', async () => {
    const { ctx, screen, agent, writes } = await mount({ catalog: { reasoning: null } })
    await ctx.commands.execute(agent, '/model', signal())
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    expect('reasoningEffort' in (writes[0] ?? {})).toBe(false)
  })

  it('/model and /effort suppress the notice when the tree unloaded before the commit', async () => {
    const { ctx, screen, agent, writes, fiber } = await mount()
    await ctx.commands.execute(agent, '/model', signal())
    await ctx.commands.execute(agent, '/effort', signal())
    await fiber.dispose()
    // The panels stay mounted on the fake screen; their commits still write
    // the selection but no longer reach for the shared editor.
    const modelEntry = screen.overlays.find(entry => !entry.hidden)
    ;(modelEntry!.component as unknown as { handleInput(d: string): void }).handleInput(KEY.enter)
    overlay(screen).handleInput(KEY.enter)
    // Both panels commit their selections; neither reaches the editor.
    await vi.waitFor(() => { expect(writes).toHaveLength(2) })
    expect(notices).toEqual([])
  })

  it('pickers seed from a live effort', async () => {
    const preset = fakeModelRef({ provider: 'mock', model: 'mock', reasoningEffort: 'low' as never })
    const { ctx, screen, agent } = await mount({ modelRef: preset.ref })
    await ctx.commands.execute(agent, '/model', signal())
    const rows = overlay(screen).render?.(80) ?? []
    const segmentRow = rows[rows.findIndex(r => r.includes('Thinking  (←→ to switch)')) + 1] ?? ''
    expect(segmentRow).toContain('[ Low ]')
    await ctx.commands.execute(agent, '/effort', signal())
    const effortRows = overlay(screen).render?.(60) ?? []
    const effortSegments = effortRows.find(r => r.includes('[ Low ]') || r.includes('[ Default ]'))
    expect(effortSegments).toContain('[ Low ]')
  })

  it('/effort panel commits the default segment directly', async () => {
    const { ctx, screen, agent, writes } = await mount()
    await ctx.commands.execute(agent, '/effort', signal())
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(writes).toHaveLength(1) })
    expect('reasoningEffort' in (writes[0] ?? {})).toBe(false)
  })

  it('stringifies a non-Error default-save failure', async () => {
    const { ctx, agent } = await mount({
      defaults: { selection: { provider: 'mock', model: 'mock' }, saveError: 'plain failure' as never },
    })
    const execution = await ctx.commands.execute(agent, '/model mock-pro', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'Switched to mock-pro (mock) — failed to save default: plain failure',
    })
  })

  it('/provider opens the panel with active, dormant, and CTA rows', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/provider', signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const rows = overlay(screen).render?.(80) ?? []
    const active = rows.find(row => row.includes('Mock')) ?? ''
    expect(active).toContain('(mock)')
    expect(active).toContain('← current')
    const dormant = rows.find(row => row.includes('Anthropic')) ?? ''
    expect(dormant).toContain('_ · not configured_')
    expect(rows.some(row => row.includes('+ Add provider'))).toBe(true)
  })

  it('/provider panel: dormant Enter flashes the pointer, active Enter opens the scoped picker', async () => {
    const { ctx, screen, agent } = await mount()
    await ctx.commands.execute(agent, '/provider', signal())
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(notices[0]).toContain('!provider "anthropic" is not configured — add it with /provider add!')
    await ctx.commands.execute(agent, '/provider', signal())
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => {
      const rows = screen.overlays[screen.overlays.length - 1]?.component.render?.(60) ?? []
      expect(rows.some(row => row.includes('Select a model · mock'))).toBe(true)
    })
  })

  it('/provider switch resolves by id or name and opens the scoped picker', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/provider switch mock', signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const scoped = screen.overlays[0]?.component.render?.(60) ?? []
    expect(scoped.some(row => row.includes('Select a model · mock'))).toBe(true)

    const unknown = await mount()
    expect((await unknown.ctx.commands.execute(unknown.agent, '/provider switch nope', signal()))?.result)
      .toEqual({ kind: 'error', text: 'unknown provider: nope (registered: mock)' })
    const usage = await mount()
    expect((await usage.ctx.commands.execute(usage.agent, '/provider switch', signal()))?.result)
      .toEqual({ kind: 'error', text: 'usage: /provider switch <name>' })
    const bogus = await mount()
    expect((await bogus.ctx.commands.execute(bogus.agent, '/provider bogus', signal()))?.result)
      .toEqual({ kind: 'error', text: 'usage: /provider [list | switch <name> | add]' })
  })

  it('/provider add answers the host-services guard without settings', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/provider add', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'provider configuration requires the host settings, credentials, and llm services',
    })
  })

  it('/provider switch scopes the catalog and answers the empty case', async () => {
    const { ctx, agent } = await mount({
      catalog: {
        providers: [{ id: 'mock', name: 'Mock' }, { id: 'other', name: 'Other' }],
        models: { mock: [{ id: 'mock', name: 'Mock' }], other: [] },
      },
    })
    const execution = await ctx.commands.execute(agent, '/provider switch other', signal())
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'provider "other" advertises no models',
    })
  })

  it('/provider panel without a session flashes the picker guard through Enter', async () => {
    const { ctx, screen, agent } = await mount({ attach: false })
    await ctx.commands.execute(agent, '/provider', signal())
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(notices[0]).toContain('no session is live yet')
  })

  it('/provider guards the llm and display services', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('provider-no-llm'))
    const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
    await ctx.plugin(commandsPlugin)
    expect((await ctx.commands.execute(agent, '/provider', signal()))?.result)
      .toEqual({ kind: 'error', text: 'the llm service is unavailable' })
    await ctx.fiber.dispose()

    const bare = new Context()
    await bare.plugin(SessionStore)
    await bare.plugin(CommandRuntime)
    bare.provide('llm', fakeLlm())
    const bareSession = bare.sessions.create(SessionId('provider-no-display'))
    const bareAgent = { id: bareSession.id, session: bareSession, status: 'idle' } as unknown as Agent
    await bare.plugin(commandsPlugin)
    expect((await bare.commands.execute(bareAgent, '/provider', signal()))?.result)
      .toEqual({ kind: 'error', text: 'provider picker is unavailable: the Blue screen is not mounted' })
    expect((await bare.commands.execute(bareAgent, '/provider add', signal()))?.result)
      .toEqual({ kind: 'error', text: 'provider wizard is unavailable: the Blue screen is not mounted' })
    await bare.fiber.dispose()
  })

  it('/provider falls back to the route id for an unnamed provider', async () => {
    const { ctx, screen, agent } = await mount({
      catalog: { providers: [{ id: 'x', name: '' }] },
    })
    await ctx.commands.execute(agent, '/provider', signal())
    const rows = overlay(screen).render?.(60) ?? []
    expect(rows.some(row => row.includes('(x)'))).toBe(true)
  })

  it('/provider CTA runs the wizard; Escape closes the panel quietly', async () => {
    const { ctx, screen, agent } = await mount()
    await ctx.commands.execute(agent, '/provider', signal())
    // Rows: mock (active), anthropic (dormant), then the CTA.
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(notices[0]).toContain('provider configuration requires')

    const noticesBefore = notices.length
    await ctx.commands.execute(agent, '/provider', signal())
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[screen.overlays.length - 1]?.hidden).toBe(true)
    expect(notices.length).toBe(noticesBefore)
  })

  it('/provider switch returns quietly when the tree unloads mid-catalog', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const llm = {
      listProviders: () => [{ id: 'mock', name: 'Mock' }],
      listModels: async () => { await gate; return [{ id: 'mock', name: 'Mock' }] },
      resolveModelInfo: async (provider: string, model: string) => ({ provider, id: model, name: model }),
    } as unknown as LlmRuntime
    const { ctx, agent, fiber } = await mount({ llm })
    const pending = ctx.commands.execute(agent, '/provider switch mock', signal())
    await fiber.dispose()
    release()
    expect((await pending)?.result).toEqual({ kind: 'success' })
  })

  it('/provider CTA suppresses the wizard outcome when the tree unloaded', async () => {
    const { ctx, screen, agent, fiber } = await mount()
    await ctx.commands.execute(agent, '/provider', signal())
    await fiber.dispose()
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(notices).toEqual([])
  })

  it('/effort session-only leaves the default untouched', async () => {
    const { ctx, screen, agent, saveSelection } = await mount()
    await ctx.commands.execute(agent, '/effort', signal())
    overlay(screen).handleInput(KEY.right)
    overlay(screen).handleInput(KEY.altS)
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(saveSelection).not.toHaveBeenCalled()
    expect(notices[0]).toContain('session only')
  })
})
