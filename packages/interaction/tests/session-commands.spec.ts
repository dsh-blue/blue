/**
 * Unit tests for the session-info family: the pure section builders
 * (`/status`, `/context`, the shared context section, `/version`'s notice),
 * and the three commands over the real command runtime — panel mount,
 * close, and the no-session / no-display guards.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import {
  buildContextSection,
  buildStatusSections,
  buildUsageSections,
  formatCreated,
  registerSessionCommands,
  versionNotice,
} from '../src/session-commands.ts'
import { BLUE_VERSION } from '@dsh-blue/blue-transcript/banner-content'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

afterEach(() => {
  clearSharedEditor()
})

/** The notices the shared editor received. */
function sharedEditor(): { notices: string[] } {
  const notices: string[] = []
  setSharedEditor({
    editor: { focused: false, render: () => [], invalidate: () => {} } as never,
    submitPrompt: () => {},
    notice: (text: string) => { notices.push(text) },
  })
  return { notices }
}

/** Strip SGR and the fake palette's marker characters so assertions read visible text. */
function plain(rows: readonly string[]): readonly string[] {
  return rows.map(row => row.replace(/\x1b\[[0-9;]*m/g, '').replace(/[~^#]/g, ''))
}

describe('formatCreated', () => {
  it('formats the epoch as a fixed UTC stamp and degrades bad input', () => {
    expect(formatCreated(Date.UTC(2026, 7, 21, 8, 15))).toBe('2026-08-21 08:15 UTC')
    expect(formatCreated(Number.NaN)).toBe('unknown UTC')
  })
})

describe('versionNotice', () => {
  it('carries the banner constant, the harness line, and the live model', () => {
    expect(versionNotice()).toBe(`Blue v${BLUE_VERSION} · dsh rc.7`)
    expect(versionNotice({ provider: 'deepseek', model: 'deepseek-chat', effort: 'high' }))
      .toBe(`Blue v${BLUE_VERSION} · dsh rc.7 · deepseek-chat (deepseek) · thinking high`)
  })
})

describe('buildContextSection', () => {
  it('renders the severity bar with percent and counts', () => {
    const section = buildContextSection({ used: 2048, window: 8192 })
    expect(section.heading).toBe('Context window')
    expect(section.rows[0]!.segments[0]).toEqual({ text: `${'█'.repeat(5)}${'░'.repeat(15)}`, style: 'success' })
    expect(section.rows[0]!.segments[1]).toEqual({ text: '  25%' })
    expect(section.rows[0]!.segments[2]).toEqual({ text: '  2k / 8k', style: 'muted' })
  })

  it('escalates the severity color past the kimi thresholds', () => {
    const warn = buildContextSection({ used: 5000, window: 8192 })
    expect(warn.rows[0]!.segments[0]!.style).toBe('warning')
    const danger = buildContextSection({ used: 8000, window: 8192 })
    expect(danger.rows[0]!.segments[0]!.style).toBe('error')
  })

  it('waits when the window is known but no request reported, and degrades without one', () => {
    expect(buildContextSection({ window: 8192 }).rows[0]!.segments[0]!.style).toBe('muted')
    expect(buildContextSection({ used: 100 }).rows[0]!.segments[0]!.style).toBe('muted')
    expect(buildContextSection({}).rows[0]!.segments[0]!.text).toBe('not advertised for the current model')
  })
})

describe('buildStatusSections', () => {
  it('lists the session header, counts, agent state, model, and version', () => {
    const sections = buildStatusSections({
      header: { id: 'spec-session', cwd: '/tmp/spec', createdAt: Date.UTC(2026, 7, 21, 8, 15) },
      turns: 3,
      steps: 7,
      agentStatus: 'idle',
      model: { provider: 'deepseek', model: 'deepseek-chat', effort: 'high' },
      context: { used: 4096, window: 8192 },
    })
    expect(sections.map(section => section.heading)).toEqual(['Session', 'Model', 'Context window'])
    expect(sections[0]!.rows.map(row => row.label)).toEqual(['id', 'cwd', 'created', 'turns', 'agent'])
    expect(sections[0]!.rows[3]!.segments).toEqual([
      { text: '3' },
      { text: ' · 7 steps', style: 'muted' },
    ])
    expect(sections[1]!.rows[0]!.segments).toEqual([
      { text: 'deepseek-chat (deepseek)' },
      { text: ' · thinking high', style: 'muted' },
    ])
    expect(sections[1]!.rows[1]!.segments).toEqual([
      { text: `Blue v${BLUE_VERSION}` },
      { text: ' · dsh rc.7', style: 'muted' },
    ])
  })

  it('substitutes the unknown cwd and omits the effort tail', () => {
    const sections = buildStatusSections({
      header: { id: 's', createdAt: 0 },
      turns: 0,
      steps: 0,
      agentStatus: 'running',
      model: { provider: 'p', model: 'm' },
      context: {},
    })
    expect(sections[0]!.rows[1]!.segments).toEqual([{ text: '(unknown)' }])
    expect(sections[1]!.rows[0]!.segments).toEqual([{ text: 'm (p)' }])
  })
})

describe('buildUsageSections', () => {
  it('lists the four buckets, the total, and the context bar', () => {
    const sections = buildUsageSections({
      buckets: { input: 1536, cacheRead: 61440, cacheWrite: 7168, output: 9216 },
      context: { used: 4096, window: 8192 },
    })
    expect(sections.map(section => section.heading)).toEqual(['Session usage', 'Context window'])
    const rows = sections[0]!.rows
    expect(rows.map(row => row.segments[0]!.text)).toEqual(['1.5k', '60k', '7k', '9k', '77.5k'])
    expect(rows.at(-1)!.label).toBe('total')
  })

  it('shows the waiting row when nothing was recorded', () => {
    const sections = buildUsageSections({ buckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, context: {} })
    expect(sections[0]!.rows).toEqual([
      { label: 'tokens', segments: [{ text: 'no provider usage recorded yet', style: 'muted' }] },
    ])
  })
})

interface MountOptions {
  attach?: boolean
  /** Provide the four display services (fakeBlueContext always does). */
  display?: boolean
  modelRef?: { current: { provider: string, model: string, reasoningEffort?: string } }
  seed?: 'usage' | 'header'
}

async function mount(options: MountOptions = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const base = options.display === false ? { ctx: new Context() } : fakeBlueContext()
  const { ctx } = base
  const screen = 'screen' in base ? base.screen : undefined
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('status-spec'), { meta: { cwd: '/tmp/spec' } })
  if (options.seed === 'usage') {
    session.append('request/context', { provider: 'mock', model: 'mock', contextWindow: 8192 })
    session.append('turn/start', { turn: 0 })
    session.append('step/start', { turn: 0, step: 0 })
    session.append('assistant/message', {
      turn: 0,
      step: 0,
      message: {
        id: 'm1' as never,
        role: 'assistant',
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
      usage: { inputTokens: 1536, outputTokens: 9216, cacheReadTokens: 61440 },
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 0, step: 0 })
    session.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
  }
  if (options.seed === 'header') {
    session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock-pro', reasoningEffort: 'high' as never } },
      reason: 'initial',
    })
  }
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  if (options.attach !== false) {
    ctx.provide('blueSession', { current: agent, modelRef: options.modelRef })
  }
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, screen: screen as FakeScreen, agent, fiber }
}

async function run(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, new AbortController().signal)
  return execution?.result
}

describe('registerSessionCommands', () => {
  it('registers the three commands on the runtime', async () => {
    const { ctx, agent } = await mount()
    const names = ctx.commands.list().map(command => command.name)
    expect(names).toContain('status')
    expect(names).toContain('context')
    expect(names).toContain('version')
    await run(ctx, agent, '/version')
  })

  it('mounts the /status panel over the session facts and closes on Escape', async () => {
    const { ctx, screen, agent } = await mount({
      modelRef: { current: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' as never } },
      seed: 'usage',
    })
    const result = await run(ctx, agent, '/status')
    expect(result).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    expect(overlay.hidden).toBe(false)
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('status'))).toBe(true)
    expect(rows.some(row => row.includes('status-spec'))).toBe(true)
    expect(rows.some(row => row.includes('/tmp/spec'))).toBe(true)
    expect(rows.some(row => row.includes('UTC'))).toBe(true)
    expect(rows.some(row => row.includes('1 · 1 steps'))).toBe(true)
    expect(rows.some(row => row.includes('deepseek-chat (deepseek)'))).toBe(true)
    expect(rows.some(row => row.includes(`Blue v${BLUE_VERSION}`))).toBe(true)
    expect(rows.some(row => row.includes('61.5k / 8k'))).toBe(true)
    overlay.component.handleInput?.('\x1b')
    expect(overlay.hidden).toBe(true)
  })

  it('mounts the /context panel over the folded buckets (no projection seam)', async () => {
    const { ctx, screen, agent } = await mount({ seed: 'usage' })
    const result = await run(ctx, agent, '/context')
    expect(result).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('1.5k'))).toBe(true)
    expect(rows.some(row => row.includes('60k'))).toBe(true)
    expect(rows.some(row => row.includes('9k'))).toBe(true)
    expect(rows.some(row => row.includes('70.5k'))).toBe(true)
    expect(rows.some(row => row.includes('61.5k / 8k'))).toBe(true)
    overlay.component.handleInput?.('q')
    expect(overlay.hidden).toBe(true)
  })

  it('reads the projection snapshot when the seam is composed', async () => {
    const { ctx, screen, agent } = await mount()
    ctx.provide('sessionProjections', {
      snapshot: () => ({
        values: {
          tokenUsage: { uncachedInputTokens: 30, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 7 },
          contextPressure: { projectedTokens: 4224, contextWindow: 8192 },
          sessionStats: { turns: 2, steps: 5, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
        },
      }),
    })
    await run(ctx, agent, '/context')
    const usageRows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(usageRows.some(row => row.includes('144'))).toBe(true)
    await run(ctx, agent, '/status')
    const statusRows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(statusRows.some(row => row.includes('2 · 5 steps'))).toBe(true)
  })

  it('falls back to the request header when no modelRef is published', async () => {
    const { ctx, screen, agent } = await mount({ seed: 'header' })
    const result = await run(ctx, agent, '/status')
    expect(result).toEqual({ kind: 'success' })
    let rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('mock-pro (mock) · thinking high'))).toBe(true)
    // A later header without an effort drops the tail (the latest wins).
    agent.session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock-pro' } },
      reason: 'change',
    })
    await run(ctx, agent, '/status')
    rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('mock-pro (mock)'))).toBe(true)
  })

  it('shows the placeholder model row when neither source answers', async () => {
    const { ctx, screen, agent } = await mount()
    await run(ctx, agent, '/status')
    const rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('not set'))).toBe(true)
  })

  it('flashes the /version notice and works with no session live', async () => {
    const { notices } = sharedEditor()
    const { ctx, agent } = await mount({
      modelRef: { current: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    const result = await run(ctx, agent, '/version')
    expect(result).toEqual({
      kind: 'success',
      text: `Blue v${BLUE_VERSION} · dsh rc.7 · deepseek-chat (deepseek)`,
    })
    expect(notices).toEqual([])
    const bare = await mount({ attach: false })
    const noSession = await bare.ctx.commands.execute(bare.agent, '/version', new AbortController().signal)
    expect(noSession?.result).toEqual({ kind: 'success', text: `Blue v${BLUE_VERSION} · dsh rc.7` })
  })

  it('guards /status and /usage with an error when no session is live', async () => {
    const { ctx, agent } = await mount({ attach: false })
    const status = await run(ctx, agent, '/status')
    expect(status).toEqual({ kind: 'error', text: 'no session is live yet' })
    const usage = await run(ctx, agent, '/context')
    expect(usage).toEqual({ kind: 'error', text: 'no session is live yet' })
    // A published-but-empty slot (the app driver before its first agent)
    // answers the same guard.
    ctx.provide('blueSession', { current: null })
    const empty = await run(ctx, agent, '/status')
    expect(empty).toEqual({ kind: 'error', text: 'no session is live yet' })
    const emptyUsage = await run(ctx, agent, '/context')
    expect(emptyUsage).toEqual({ kind: 'error', text: 'no session is live yet' })
    const emptyVersion = await run(ctx, agent, '/version')
    expect(emptyVersion).toEqual({ kind: 'success', text: `Blue v${BLUE_VERSION} · dsh rc.7` })
  })

  it('guards /status and /usage with an error when the display services are missing', async () => {
    const { ctx, agent } = await mount({ display: false })
    const status = await run(ctx, agent, '/status')
    expect(status).toEqual({ kind: 'error', text: 'status panel is unavailable: the Blue screen is not mounted' })
    const usage = await run(ctx, agent, '/context')
    expect(usage).toEqual({ kind: 'error', text: 'context panel is unavailable: the Blue screen is not mounted' })
  })

  it('unregisters with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    const stop = registerSessionCommands(ctx)
    expect(ctx.commands.list().some(command => command.name === 'status')).toBe(true)
    stop()
    expect(ctx.commands.list().some(command => command.name === 'status')).toBe(false)
  })
})
