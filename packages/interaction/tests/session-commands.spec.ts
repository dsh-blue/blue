/**
 * Unit tests for the session-info family: the pure section builders
 * (`/status`, `/context`, the shared context section, `/version`'s notice),
 * and the three commands over the real command runtime — panel mount,
 * close, and the no-session / no-display guards.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type { InfoPanel } from '../src/info-panel.ts'
import type { FrontendPanel } from '../src/frontend-panel.ts'
import { clearSharedEditor } from '../src/editor-instance.ts'
import {
  buildCompositionSection,
  buildContextSection,
  buildStatusSections,
  buildUsageSections,
  formatCreated,
  buildVersionSections,
  buildChangelogSections,
  registerSessionCommands,
} from '../src/session-commands.ts'
import { BLUE_VERSION } from '@dsh-blue/blue-transcript/banner-content'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

afterEach(() => {
  clearSharedEditor()
})


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

describe('buildVersionSections', () => {
  it('lists the Blue and harness release lines', () => {
    const sections = buildVersionSections()
    expect(sections.map(section => section.heading)).toEqual(['Version'])
    expect(sections[0]!.rows).toEqual([
      { label: 'blue', segments: [{ text: `v${BLUE_VERSION}` }] },
      { label: 'harness', segments: [{ text: '0.1.1-rc.2' }] },
    ])
  })

  it('uses a profile-local display identity without changing the release constant', () => {
    const displayVersion = `${BLUE_VERSION}+frontend-runtime.test`
    expect(buildVersionSections(displayVersion)[0]!.rows[0]).toEqual({
      label: 'blue',
      segments: [{ text: `v${displayVersion}` }],
    })
    expect(BLUE_VERSION).toBe('0.1.0-rc.8')
  })
})

describe('buildChangelogSections', () => {
  it('wraps highlights, marks the current release, and includes known issues', () => {
    const sections = buildChangelogSections([
      {
        version: BLUE_VERSION,
        summary: 'short summary',
        highlights: ['one short highlight', 'this highlight contains enough words to wrap across the fixed detail width while retaining its continuation indentation'],
        knownIssues: ['one known issue'],
      },
      {
        version: '0.0.0',
        summary: 'older summary',
        highlights: [],
        knownIssues: [],
      },
    ])
    expect(sections.map(section => section.heading)).toEqual([`v${BLUE_VERSION} · current`, 'v0.0.0'])
    expect(sections[0]!.rows.map(row => row.label)).toEqual(['', 'Highlights', '', '', '', 'Known issues', ''])
    expect(sections[0]!.rows[2]!.segments[0]).toEqual({ text: '• one short highlight', style: 'textMuted' })
    expect(sections[0]!.rows[4]!.segments[0]!.text.startsWith('  ')).toBe(true)
    expect(sections[0]!.rows[6]!.segments[0]).toEqual({ text: '• one known issue', style: 'warning' })
    expect(sections[1]!.rows).toEqual([
      { label: '', segments: [{ text: 'older summary', style: 'muted' }] },
      { label: 'Highlights', segments: [] },
    ])
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
      { text: ' · dsh 0.1.1-rc.2', style: 'muted' },
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

describe('buildCompositionSection', () => {
  /** The section over the canonical shares: 25/12.5/12.5/50 of 8192. */
  function canonical() {
    return buildCompositionSection({
      breakdown: { system: 2048, tools: 1024, messages: 1024 },
      window: 8192,
      model: 'deepseek-chat (deepseek)',
      occupancy: { used: 4096, window: 8192 },
    })!
  }

  it('renders the CC grid with the annotations riding its right edge', () => {
    const section = canonical()
    expect(section.heading).toBe('Context usage (heuristic)')
    // 160 cells over eight rows: forty █ (two rows), twenty ▓, twenty ▒,
    // eighty ░ (four rows).
    expect(section.rows[0]!.segments).toEqual([
      { text: '█'.repeat(20), style: 'muted' },
      { text: '  ' },
      { text: 'deepseek-chat (deepseek)' },
    ])
    expect(section.rows[1]!.segments).toEqual([
      { text: '█'.repeat(20), style: 'muted' },
      { text: '  ' },
      { text: '4k/8k' },
      { text: ' tokens (50%)', style: 'muted' },
    ])
    expect(section.rows[2]!.segments).toEqual([
      { text: '▓'.repeat(20), style: 'primary' },
      { text: '  ' },
    ])
    expect(section.rows[3]!.segments).toEqual([
      { text: '▒'.repeat(20), style: 'accent' },
      { text: '  ' },
      { text: 'Estimated usage by category', style: 'textMuted' },
    ])
    expect(section.rows[4]!.segments).toEqual([
      { text: '░'.repeat(20), style: 'textMuted' },
      { text: '  ' },
      { text: '█ ', style: 'muted' },
      { text: 'System prompt: ' },
      { text: '2k tokens (25.0%)', style: 'muted' },
    ])
    expect(section.rows[5]!.segments.at(-1)).toEqual({ text: '1k tokens (12.5%)', style: 'muted' })
    expect(section.rows[7]!.segments).toEqual([
      { text: '░'.repeat(20), style: 'textMuted' },
      { text: '  ' },
      { text: '░ ', style: 'textMuted' },
      { text: 'Free space: ' },
      { text: '4k (50.0%)', style: 'muted' },
    ])
  })

  it('guarantees a non-zero category one grid cell and one-decimal shares', () => {
    const section = buildCompositionSection({
      breakdown: { system: 100, tools: 0, messages: 0 },
      window: 1000000,
      model: 'm (p)',
      occupancy: { used: 100, window: 1000000 },
    })!
    // One █ cell opens the grid; the legend reads an honest 0.0%.
    expect(section.rows[0]!.segments[0]).toEqual({ text: '█', style: 'muted' })
    expect(section.rows[4]!.segments.at(-1)).toEqual({ text: '100 tokens (0.0%)', style: 'muted' })
  })

  it('drops the grid, shares, and free row without a window', () => {
    const section = buildCompositionSection({
      breakdown: { system: 100, tools: 200, messages: 300 },
      model: 'm (p)',
      occupancy: {},
    })!
    expect(section.rows).toHaveLength(7)
    expect(section.rows[0]!.segments).toEqual([{ text: 'm (p)' }])
    expect(section.rows[1]!.segments).toEqual([{ text: 'no context window advertised', style: 'muted' }])
    expect(section.rows[4]!.segments).toEqual([
      { text: '█ ', style: 'muted' },
      { text: 'System prompt: ' },
      { text: '100', style: 'muted' },
    ])
  })

  it('clamps the free remainder at zero when the heuristic overshoots', () => {
    const section = buildCompositionSection({
      breakdown: { system: 5000, tools: 2000, messages: 2000 },
      window: 8192,
      model: 'm (p)',
      occupancy: { used: 9000, window: 8192 },
    })!
    expect(section.rows.at(-1)!.segments.at(-1)).toEqual({ text: '0 (0.0%)', style: 'muted' })
  })

  it('omits the section without a breakdown', () => {
    expect(buildCompositionSection({
      window: 8192,
      model: 'm (p)',
      occupancy: {},
    })).toBeUndefined()
  })

  it('joins the /context panel, replacing the occupancy bar; the bar answers without it', () => {
    const withBreakdown = buildUsageSections(
      { buckets: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5 }, context: { used: 10, window: 8192 } },
      'mock (mock)',
      { system: 100, tools: 0, messages: 0 },
    )
    expect(withBreakdown.map(section => section.heading))
      .toEqual(['Session usage', 'Context usage (heuristic)'])
    const without = buildUsageSections(
      { buckets: { input: 10, cacheRead: 0, cacheWrite: 0, output: 5 }, context: { used: 10, window: 8192 } },
      'mock (mock)',
    )
    expect(without.map(section => section.heading)).toEqual(['Session usage', 'Context window'])
  })
})

interface MountOptions {
  attach?: boolean
  /** Provide the four display services (fakeBlueContext always does). */
  display?: boolean
  modelRef?: { current: { provider: string, model: string, reasoningEffort?: string } }
  seed?: 'usage' | 'header'
  displayVersion?: string
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
  const fiber = await ctx.plugin(commandsPlugin, { displayVersion: options.displayVersion })
  return { ctx, screen: screen as FakeScreen, agent, fiber }
}

async function run(ctx: Context, agent: Agent, line: string) {
  const execution = await ctx.commands.execute(agent, line, [], new AbortController().signal)
  return execution?.result
}

describe('registerSessionCommands', () => {
  it('registers the three commands on the runtime', async () => {
    const { ctx, agent } = await mount()
    const names = ctx.commands.list().map(command => command.name)
    expect(names).toContain('status')
    expect(names).toContain('context')
    expect(names).toContain('version')
    expect(names).toContain('changelog')
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

  it('mounts /context over the folded buckets with a window absent', async () => {
    const { ctx, screen, agent } = await mount({ seed: 'usage' })
    // A projection host whose pressure lacks a window: the composition
    // wiring takes the no-window branch (grid and shares dropped).
    ctx.provide('sessionProjections', {
      snapshot: () => ({
        values: {
          tokenUsage: { uncachedInputTokens: 1536, outputTokens: 9216, cacheReadTokens: 61440, cacheWriteTokens: 7168 },
          contextBreakdown: { systemTokens: 100, toolsTokens: 0, messageTokens: 0 },
        },
      }),
    })
    await run(ctx, agent, '/context')
    const rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes('total'))).toBe(true)
    expect(rows.some(row => row.includes('Estimated usage by category'))).toBe(true)
    expect(rows.some(row => row.includes('no context window advertised'))).toBe(true)
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

  it('prefers the renderer-neutral context model and falls back when it unloads', async () => {
    const { ctx, screen, agent } = await mount({ seed: 'usage' })
    const execute = vi.fn(async () => ({ ok: true }))
    const unsubscribe = vi.fn()
    const feature = {
      model: { panel: { kind: 'panel', mode: 'info', title: 'Context', view: { kind: 'text', text: 'official context projection' }, submit: { kind: 'context.refresh', sessionId: 'status-spec' } } },
      subscribe: (listener: () => void) => { listener(); return unsubscribe },
      execute,
    }
    ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('blueContextFeature', feature)
    expect(await run(ctx, agent, '/context')).toEqual({ kind: 'success' })
    const projected = screen.overlays.at(-1)!.component as FrontendPanel
    expect(plain(projected.render(80)).some(row => row.includes('official context projection'))).toBe(true)
    projected.handleInput('\r')
    await Promise.resolve()
    expect(execute).toHaveBeenCalledWith({ kind: 'context.refresh', sessionId: 'status-spec' })
    feature.model = undefined as never
    expect(plain(projected.render(80)).some(row => row.includes('context unavailable'))).toBe(true)
    projected.handleInput('\x1b')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(await run(ctx, agent, '/context')).toEqual({ kind: 'success' })
    expect(screen.overlays.at(-1)!.component).toBeInstanceOf(Object)
    expect(screen.overlays.at(-1)!.component.constructor.name).toBe('InfoPanel')
  })

  it('reads the projection snapshot when the seam is composed', async () => {
    const { ctx, screen, agent } = await mount()
    ctx.provide('sessionProjections', {
      snapshot: () => ({
        values: {
          tokenUsage: { uncachedInputTokens: 30, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 7 },
          contextPressure: { projectedTokens: 4224, contextWindow: 8192 },
          contextBreakdown: { systemTokens: 100, toolsTokens: 0, messageTokens: 0 },
          sessionStats: { turns: 2, steps: 5, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
        },
      }),
    })
    await run(ctx, agent, '/context')
    const windowless = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    // The composition section rides the contextBreakdown projection over
    // the advertised window: the grid renders and the legend shows shares.
    // The 17-row panel overflows the sixteen-row window, so the legend
    // lands after one page down.
    const panel = screen.overlays.at(-1)!.component as InfoPanel
    // The headline sits behind the textMuted marker (wrapped in `_`),
    // which plain() strips — the SGR-only strip keeps it findable.
    expect(windowless.some(row => row.includes('4.1k'))).toBe(true)
    panel.handleInput('\x1b[6~')
    // textMuted wraps its text in `_`, which plain() strips — compare on
    // the SGR-only-stripped rows so the muted markers survive.
    const legendRows = panel.render(80).map(row => row.replace(/\x1b\[[0-9;]*m/g, ''))
    expect(legendRows.some(row => row.includes('Estimated usage by category'))).toBe(true)
    expect(legendRows.some(row => row.includes('System prompt:'))).toBe(true)
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

  it('opens the /version panel over the release lines and closes on Escape', async () => {
    const { ctx, screen, agent } = await mount({
      modelRef: { current: { provider: 'deepseek', model: 'deepseek-chat' } },
    })
    const result = await run(ctx, agent, '/version')
    expect(result).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    const rows = plain((overlay.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes(`v${BLUE_VERSION}`))).toBe(true)
    expect(rows.some(row => row.includes('harness'))).toBe(true)
    // The panel is version-only: no model section even with a live session.
    expect(rows.some(row => row.includes('deepseek-chat'))).toBe(false)
    overlay.component.handleInput?.('\x1b')
    expect(overlay.hidden).toBe(true)
  })

  it('shows the same profile-local identity in /status and /version', async () => {
    const displayVersion = `${BLUE_VERSION}+frontend-runtime.test`
    const { ctx, screen, agent } = await mount({ displayVersion })
    await run(ctx, agent, '/status')
    const statusRows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(100))
    expect(statusRows.some(row => row.includes(`Blue v${displayVersion}`))).toBe(true)
    await run(ctx, agent, '/version')
    const versionRows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(100))
    expect(versionRows.some(row => row.includes(`v${displayVersion}`))).toBe(true)
  })

  it('opens the /version panel on an empty slot too', async () => {
    const { ctx, screen, agent } = await mount({ attach: false })
    const result = await run(ctx, agent, '/version')
    expect(result).toEqual({ kind: 'success' })
    const rows = plain((screen.overlays.at(-1)!.component as InfoPanel).render(80))
    expect(rows.some(row => row.includes(`v${BLUE_VERSION}`))).toBe(true)
    expect(rows.some(row => row.includes('harness'))).toBe(true)
  })

  it('opens the embedded /changelog panel and closes it', async () => {
    const { ctx, screen, agent } = await mount()
    expect(await run(ctx, agent, '/changelog')).toEqual({ kind: 'success' })
    const overlay = screen.overlays.at(-1)!
    const rows = plain((overlay.component as InfoPanel).render(100))
    expect(rows.some(row => row.includes('changelog'))).toBe(true)
    expect(rows.some(row => row.includes('Execution traces'))).toBe(true)
    overlay.component.handleInput?.('\x1b')
    expect(overlay.hidden).toBe(true)
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
    // /version needs no live session — the panel opens with the version
    // section alone.
    const emptyVersion = await run(ctx, agent, '/version')
    expect(emptyVersion).toEqual({ kind: 'success' })
  })

  it('guards /status, /context, and /version when the display services are missing', async () => {
    const { ctx, agent } = await mount({ display: false })
    const status = await run(ctx, agent, '/status')
    expect(status).toEqual({ kind: 'error', text: 'status panel is unavailable: the Blue screen is not mounted' })
    const usage = await run(ctx, agent, '/context')
    expect(usage).toEqual({ kind: 'error', text: 'context panel is unavailable: the Blue screen is not mounted' })
    const version = await run(ctx, agent, '/version')
    expect(version).toEqual({ kind: 'error', text: 'version panel is unavailable: the Blue screen is not mounted' })
    const changelog = await run(ctx, agent, '/changelog')
    expect(changelog).toEqual({ kind: 'error', text: 'changelog panel is unavailable: the Blue screen is not mounted' })
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
