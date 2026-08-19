/**
 * Tests for the `blue-commands` plugin over the real command runtime:
 * `/quit` exit requests, `/resume`/`/new`/`/fork` event emission, the
 * `/sessions` picker overlay, the `/help` overlay, and disposal.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import type {} from '@deepseek-ai/dsh-blue-app'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeScreen } from './fakes.ts'

async function mount(options: {
  appExit?: (code: number) => void
  agentStatus?: 'idle' | 'running'
  attach?: boolean
  persistence?: { list(signal?: AbortSignal): Promise<SessionHeader[]> }
} = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  components: FakeBlueComponents
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen, components } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  if (options.appExit !== undefined) ctx.provide('appExit', options.appExit)
  const session = ctx.sessions.create(SessionId('commands-spec'))
  const agent = { id: session.id, session, status: options.agentStatus ?? 'idle' } as unknown as Agent
  if (options.attach !== false) ctx.provide('blueSession', { current: agent })
  if (options.persistence !== undefined) {
    ctx.provide('sessionPersistence', options.persistence as unknown as SessionPersistence)
  }
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, screen, components, agent, fiber }
}

const signal = (): AbortSignal => new AbortController().signal

function header(id: string, createdAt: number, cwd?: string): SessionHeader {
  return { version: 1, id: SessionId(id), createdAt, ...cwd === undefined ? {} : { cwd } }
}

/** The overlay component of the last shown overlay. */
function overlay(screen: FakeScreen): { handleInput(data: string): void } {
  const entry = screen.overlays.at(-1)
  if (entry === undefined) throw new Error('no overlay shown')
  return entry.component as { handleInput(data: string): void }
}

describe('blue-commands plugin', () => {
  it('/quit requests exit through the launcher appExit hook', async () => {
    const exit = vi.fn()
    const { ctx, agent } = await mount({ appExit: exit })
    const execution = await ctx.commands.execute(agent, '/quit', signal())
    expect(exit).toHaveBeenCalledWith(0)
    expect(execution?.result).toEqual({ kind: 'success' })
  })

  it('/quit reports an error when the launcher provided no appExit', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/quit', signal())
    const result = execution?.result
    expect(result?.kind).toBe('error')
    if (result?.kind === 'error') expect(result.text).toContain('appExit')
  })

  it('/resume emits blue/request-resume with the trimmed session id', async () => {
    const { ctx, agent } = await mount()
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    const execution = await ctx.commands.execute(agent, '/resume  abc-123 ', signal())
    expect(onResume).toHaveBeenCalledWith('abc-123')
    expect(execution?.result).toEqual({ kind: 'success', text: 'resuming session abc-123' })
  })

  it('/resume without an id returns a usage error', async () => {
    const { ctx, agent } = await mount()
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    const execution = await ctx.commands.execute(agent, '/resume', signal())
    expect(onResume).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'error', text: 'usage: /resume <session-id>' })
  })

  it('/new emits blue/request-new', async () => {
    const { ctx, agent } = await mount()
    const onNew = vi.fn()
    ctx.on('blue/request-new', onNew)
    const execution = await ctx.commands.execute(agent, '/new', signal())
    expect(onNew).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'starting a new session' })
  })

  it('/fork emits blue/request-fork while the current session is idle', async () => {
    const { ctx, agent } = await mount()
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', signal())
    expect(onFork).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'forking the current session' })
  })

  it('/fork refuses while the current session is running', async () => {
    const { ctx, agent } = await mount({ agentStatus: 'running' })
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', signal())
    expect(onFork).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'error', text: 'cannot fork while the agent is running' })
  })

  it('/fork still emits when no session is attached (the app layer refuses)', async () => {
    const { ctx, agent } = await mount({ attach: false })
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', signal())
    expect(onFork).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'forking the current session' })
  })

  it('/sessions errors when session persistence is unavailable', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'session persistence is unavailable' })
  })

  it('/sessions reports a listing failure as an error', async () => {
    const { ctx, agent } = await mount({
      persistence: { list: () => Promise.reject(new Error('disk gone')) },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'could not list sessions: disk gone' })
  })

  it('/sessions reports a non-Error listing failure as an error', async () => {
    const { ctx, agent } = await mount({
      persistence: { list: () => Promise.reject('plain failure') },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'could not list sessions: plain failure' })
  })

  it('/sessions answers "no sessions" for an empty listing', async () => {
    const { ctx, screen, agent } = await mount({ persistence: { list: () => Promise.resolve([]) } })
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'no sessions' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('/sessions lists sessions newest-first, marking the live one', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([
          header('s-old', 1_000, '/old'),
          header(String(agent.id), 3_000, '/live'),
          header('s-mid', 2_000),
        ]),
      },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    // The framed picker: rules, title with the key hint, and rows carrying
    // the `❯ ` pointer plus the `← current` badge on the live session.
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows[0]).toBe('^' + '─'.repeat(60) + '^')
    expect(rows[1]).toBe('^Sessions^ _esc cancel · ↵ resume_')
    expect(rows[2]).toContain(`❯ ${agent.id} · 1970-01-01 00:00 · /live  ← current`)
    expect(rows[3]).toContain('s-mid · 1970-01-01 00:00 · ')
    expect(rows[4]).toContain('s-old · 1970-01-01 00:00 · /old')
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/sessions emits blue/request-resume when another session is picked', async () => {
    const notice = vi.fn()
    const { ctx, screen, components, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-other', 2_000, '/other'), header(String(agent.id), 3_000, '/live')]) },
    })
    setSharedEditor({ editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onResume = vi.fn()
      ctx.on('blue/request-resume', onResume)
      await ctx.commands.execute(agent, '/sessions', signal())
      overlay(screen).handleInput(KEY.down)
      overlay(screen).handleInput(KEY.enter)
      expect(screen.overlays[0]?.hidden).toBe(true)
      expect(onResume).toHaveBeenCalledWith('s-other')
      expect(notice).toHaveBeenCalledWith('resuming session s-other')
    } finally {
      clearSharedEditor()
    }
  })

  it('/sessions flashes an error notice when the live session is picked', async () => {
    const notice = vi.fn()
    const { ctx, screen, components, agent } = await mount({
      persistence: { list: () => Promise.resolve([header(String(agent.id), 3_000, '/live')]) },
    })
    setSharedEditor({ editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onResume = vi.fn()
      ctx.on('blue/request-resume', onResume)
      await ctx.commands.execute(agent, '/sessions', signal())
      overlay(screen).handleInput(KEY.enter)
      expect(screen.overlays[0]?.hidden).toBe(true)
      expect(onResume).not.toHaveBeenCalled()
      expect(notice).toHaveBeenCalledWith('!already the current session!')
    } finally {
      clearSharedEditor()
    }
  })

  it('/sessions shows no overlay when the fiber unloads while the listing is in flight', async () => {
    const gate = Promise.withResolvers<SessionHeader[]>()
    const { ctx, screen, agent, fiber } = await mount({
      persistence: { list: () => gate.promise },
    })
    const pending = ctx.commands.execute(agent, '/sessions', signal())
    await fiber.dispose()
    gate.resolve([header('s-late', 1_000)])
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('/sessions errors when the Blue display services are not mounted', async () => {
    // A bare context without the Blue services: persistence alone is present.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header('s-one', 1_000)]),
    } as unknown as SessionPersistence)
    const session = ctx.sessions.create(SessionId('commands-bare'))
    const agent = { id: session.id, session } as unknown as Agent
    await ctx.plugin(commandsPlugin)
    const execution = await ctx.commands.execute(agent, '/sessions', signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'session picker is unavailable: the Blue screen is not mounted',
    })
    await ctx.fiber.dispose()
  })

  it('/help lists the registered commands and key bindings in an overlay', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/help', signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    // The framed HelpPanel: primary rules, ` help ` title with the key
    // hint, and the two aligned sections. The sections overflow the ten-row
    // window, so a `showing` line replaces the tail.
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows[0]).toBe('^' + '─'.repeat(80) + '^')
    expect(rows[1]).toBe('^ help^ _· Esc / Enter / q to cancel · ↑↓ scroll_')
    expect(rows[3]).toBe('  #Commands#')
    // The runtime lists commands alphabetically; labels padEnd inside the
    // primary span with the description muted behind two spaces.
    expect(rows[4]).toBe('    ^/fork    ^  ~Fork the current session into a new one~')
    expect(rows.some(row => row.includes('^/quit    ^  ~Exit Blue~'))).toBe(true)
    expect(rows.some(row => row.includes('_ showing 1-10 of 18_'))).toBe(true)
    // Scrolling down reaches the Keys section with the two-column layout.
    for (let i = 0; i < 9; i += 1) overlay(screen).handleInput(KEY.down)
    const scrolled = screen.overlays[0]?.component.render(80) ?? []
    expect(scrolled.some(row => row.includes('  #Keys#'))).toBe(true)
    expect(scrolled.some(row => row.includes('?enter   ?  ~Submit input / confirm selection~'))).toBe(true)
    expect(scrolled.some(row => row.includes('_ showing 9-18 of 18_'))).toBe(true)
    screen.overlays[0]?.component.invalidate()
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/help falls back to the action id when a binding has no description', async () => {
    const { ctx, screen, agent } = await mount()
    const keymap = ctx.get('blueKeymap')
    const unregister = keymap?.register([{ id: 'spec.custom', keys: 'f9' }])
    await ctx.commands.execute(agent, '/help', signal())
    // The f9 row is the last key binding, beyond the first window.
    for (let i = 0; i < 9; i += 1) overlay(screen).handleInput(KEY.down)
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows.some(row => row.includes('f9') && row.includes('~spec.custom~'))).toBe(true)
    unregister?.()
    overlay(screen).handleInput(KEY.escape)
  })

  it('/help closes on Enter and on q as well', async () => {
    const { ctx, screen, agent } = await mount()
    await ctx.commands.execute(agent, '/help', signal())
    overlay(screen).handleInput(KEY.enter)
    expect(screen.overlays[0]?.hidden).toBe(true)
    await ctx.commands.execute(agent, '/help', signal())
    overlay(screen).handleInput('q')
    expect(screen.overlays[1]?.hidden).toBe(true)
    // An unrelated key keeps the overlay open.
    await ctx.commands.execute(agent, '/help', signal())
    overlay(screen).handleInput('x')
    expect(screen.overlays[2]?.hidden).toBe(false)
    overlay(screen).handleInput(KEY.escape)
  })

  it('/help truncates rows to the render width', async () => {
    const { ctx, screen, components, agent } = await mount()
    await ctx.commands.execute(agent, '/help', signal())
    const rows = screen.overlays[0]?.component.render(10) ?? []
    // The overlay's own truncation (headings, two-column rows, and the
    // showing tail) keeps every content row inside the width; the frame's
    // title and rules are width-exact by construction. The fake theme's
    // markers add two columns per styled row, so the invariant allows the
    // inflation (the real theme's SGR is zero-width).
    expect(rows.slice(2, -1).every(row => components.visibleWidth(row) <= 12)).toBe(true)
    overlay(screen).handleInput(KEY.escape)
  })

  it('/help errors when the Blue display services are not mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('commands-bare-help'))
    const agent = { id: session.id, session } as unknown as Agent
    await ctx.plugin(commandsPlugin)
    const execution = await ctx.commands.execute(agent, '/help', signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'help is unavailable: the Blue screen is not mounted',
    })
    await ctx.fiber.dispose()
  })

  it('unregisters every command when the fiber disposes', async () => {
    const { ctx, agent, fiber } = await mount({ appExit: () => {} })
    for (const name of ['quit', 'resume', 'new', 'fork', 'sessions', 'help', 'theme']) {
      expect(ctx.commands.find(agent, name)).toBeDefined()
    }
    await fiber.dispose()
    for (const name of ['quit', 'resume', 'new', 'fork', 'sessions', 'help', 'theme']) {
      expect(ctx.commands.find(agent, name)).toBeUndefined()
    }
  })
})
