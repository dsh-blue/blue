/**
 * Tests for the `blue-commands` plugin over the real command runtime:
 * `/quit` exit requests, `/sessions <id>` resume emission / `/new`/`/fork`
 * event emission, the `/sessions` picker overlay, the `/help` overlay, and
 * disposal.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { canonicalOf } from '../src/command-meta.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import type {} from '@dsh-blue/blue-app'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeScreen } from './fakes.ts'

/** The structural slice of `sessionQuery` the `/sessions` titles read. */
interface TitleQueryFake {
  readTitleSnapshots(
    sessionIds: readonly { toString(): string }[],
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<
    | { sessionId: { toString(): string }, status: 'fulfilled', value: { title?: { title: string } } }
    | { sessionId: { toString(): string }, status: 'rejected', reason: unknown }
  >>
}

async function mount(options: {
  appExit?: (code: number) => void
  agentStatus?: 'idle' | 'running'
  attach?: boolean
  persistence?: { list(signal?: AbortSignal): Promise<SessionHeader[]> }
  sessionQuery?: TitleQueryFake
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
  if (options.attach !== false) ctx.provide('blueSession', { current: agent, modelRef: undefined })
  if (options.persistence !== undefined) {
    ctx.provide('sessionPersistence', options.persistence as unknown as SessionPersistence)
  }
  if (options.sessionQuery !== undefined) {
    ctx.provide('sessionQuery', options.sessionQuery as unknown as SessionQueryEngine)
  }
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, screen, components, agent, fiber }
}

const signal = (): AbortSignal => new AbortController().signal

/** The cwd the picker scopes to: the test runner's own directory. */
const HERE = process.cwd()

function header(id: string, createdAt: number, cwd?: string): SessionHeader {
  return { version: 1, id: SessionId(id), createdAt, ...cwd === undefined ? {} : { cwd } }
}

/** A fulfilled batch-title result for `readTitleSnapshots` fakes. */
function titled(id: string, title?: string): {
  sessionId: { toString(): string }
  status: 'fulfilled'
  value: { title?: { title: string } }
} {
  return {
    sessionId: SessionId(id),
    status: 'fulfilled',
    ...title === undefined ? {} : { value: { title: { title } } },
  }
}

/** A rejected batch-title result for `readTitleSnapshots` fakes. */
function rejected(id: string): {
  sessionId: { toString(): string }
  status: 'rejected'
  reason: string
} {
  return { sessionId: SessionId(id), status: 'rejected', reason: 'log unreadable' }
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
    const execution = await ctx.commands.execute(agent, '/quit', [], signal())
    expect(exit).toHaveBeenCalledWith(0)
    expect(execution?.result).toEqual({ kind: 'success' })
  })

  it('/quit reports an error when the launcher provided no appExit', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/quit', [], signal())
    const result = execution?.result
    expect(result?.kind).toBe('error')
    if (result?.kind === 'error') expect(result.text).toContain('appExit')
  })

  it('/q and /exit are aliases of /quit, not registered commands (kimi style)', async () => {
    const { ctx, agent } = await mount({ appExit: () => {} })
    // The alias relation lives in the Blue-side metadata registry, and only
    // `/quit` is a real registration: the input layer rewrites an alias line
    // before dispatch, so the harness registry stays canonical-only.
    expect(canonicalOf('q')).toBe('quit')
    expect(canonicalOf('exit')).toBe('quit')
    expect(canonicalOf('quit')).toBeUndefined()
    expect(ctx.commands.find(agent, 'q')).toBeUndefined()
    expect(ctx.commands.find(agent, 'exit')).toBeUndefined()
    expect(await ctx.commands.execute(agent, '/q', [], signal())).toBeUndefined()
  })

  it('/sessions <id> emits blue/request-resume with the trimmed id', async () => {
    const { ctx, agent } = await mount()
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    const execution = await ctx.commands.execute(agent, '/sessions  abc-123 ', [], signal())
    expect(onResume).toHaveBeenCalledWith('abc-123')
    expect(execution?.result).toEqual({ kind: 'success', text: 'resuming session abc-123' })
  })

  it('/sessions without an id opens the picker, and /resume is its alias', async () => {
    const { ctx, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s1', 1, HERE)]) },
    })
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    // Bare /sessions is the picker path — it opens the overlay and never
    // emits the resume request.
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    expect(onResume).not.toHaveBeenCalled()
    // The alias rewrites to /sessions with the id argument intact.
    expect(canonicalOf('resume')).toBe('sessions')
  })

  it('/new emits blue/request-new', async () => {
    const { ctx, agent } = await mount()
    const onNew = vi.fn()
    ctx.on('blue/request-new', onNew)
    const execution = await ctx.commands.execute(agent, '/new', [], signal())
    expect(onNew).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'starting a new session' })
  })

  it('/clear is the /new alias, not a registration', async () => {
    const { ctx, agent } = await mount()
    // The S27 alias relation: the input layer rewrites `/clear` to `/new`
    // before dispatch (kimi's one-command-two-names rule), so the harness
    // registry stays canonical-only and the session log records /new.
    expect(canonicalOf('clear')).toBe('new')
    expect(ctx.commands.find(agent, 'clear')).toBeUndefined()
    expect(await ctx.commands.execute(agent, '/clear', [], signal())).toBeUndefined()
    const onNew = vi.fn()
    ctx.on('blue/request-new', onNew)
    const rewritten = await ctx.commands.execute(agent, '/new', [], signal())
    expect(onNew).toHaveBeenCalledOnce()
    expect(rewritten?.result).toEqual({ kind: 'success', text: 'starting a new session' })
  })

  it('/fork emits blue/request-fork while the current session is idle', async () => {
    const { ctx, agent } = await mount()
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', [], signal())
    expect(onFork).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'forking the current session' })
  })

  it('/fork refuses while the current session is running', async () => {
    const { ctx, agent } = await mount({ agentStatus: 'running' })
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', [], signal())
    expect(onFork).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'error', text: 'cannot fork while the agent is running' })
  })

  it('/fork still emits when no session is attached (the app layer refuses)', async () => {
    const { ctx, agent } = await mount({ attach: false })
    const onFork = vi.fn()
    ctx.on('blue/request-fork', onFork)
    const execution = await ctx.commands.execute(agent, '/fork', [], signal())
    expect(onFork).toHaveBeenCalledOnce()
    expect(execution?.result).toEqual({ kind: 'success', text: 'forking the current session' })
  })

  it('/sessions errors when session persistence is unavailable', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'session persistence is unavailable' })
  })

  it('/sessions reports a listing failure as an error', async () => {
    const { ctx, agent } = await mount({
      persistence: { list: () => Promise.reject(new Error('disk gone')) },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'could not list sessions: disk gone' })
  })

  it('/sessions reports a non-Error listing failure as an error', async () => {
    const { ctx, agent } = await mount({
      persistence: { list: () => Promise.reject('plain failure') },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'error', text: 'could not list sessions: plain failure' })
  })

  it('/sessions answers "no sessions in this directory" for an empty or all-foreign listing', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-away', 1_000, '/elsewhere'), header('s-bare', 2_000)]) },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success', text: 'no sessions in this directory' })
    expect(screen.overlays).toHaveLength(0)
    const empty = await mount({ persistence: { list: () => Promise.resolve([]) } })
    const bare = await empty.ctx.commands.execute(empty.agent, '/sessions', [], signal())
    expect(bare?.result).toEqual({ kind: 'success', text: 'no sessions in this directory' })
  })

  it('/sessions scopes to this cwd, lists newest-first, and marks the live one', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([
          header('s-old', 1_000, HERE),
          header(String(agent.id), 3_000, HERE),
          header('s-mid', 2_000, HERE),
          header('s-away', 9_000, '/elsewhere'),
          header('s-bare', 8_000),
        ]),
      },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    // The framed picker: rules, the filtered title hint, and the untitled
    // rows (`id · date`, the constant cwd dropped — D46) with the `❯ `
    // pointer plus the `← current` badge on the live session. The foreign
    // and cwd-less rows never render.
    const rows = screen.overlays[0]?.component.render(72) ?? []
    expect(rows[0]).toBe('^' + '─'.repeat(72) + '^')
    expect(rows[1]).toBe('^  Sessions^ _· type to search · esc cancel · ↵ resume_')
    expect(rows[2]).toContain(`❯ ${agent.id} · 1970-01-01 00:00  ← current`)
    expect(rows[3]).toContain('s-mid · 1970-01-01 00:00')
    expect(rows[4]).toContain('s-old · 1970-01-01 00:00')
    expect(rows.some(row => row.includes('s-away'))).toBe(false)
    expect(rows.some(row => row.includes('s-bare'))).toBe(false)
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/sessions leads titled rows with the title and demotes the id to the description', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([
          header('s-fix', 3_000, HERE),
          header(String(agent.id), 2_000, HERE),
          header('s-plain', 1_000, HERE),
        ]),
      },
      sessionQuery: {
        readTitleSnapshots: async () => [
          titled('s-fix', 'Fix the questionnaire width crash'),
          titled(String(agent.id), 'Kimi-style welcome banner'),
          rejected('s-plain'),
        ],
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    const rows = screen.overlays[0]?.component.render(88) ?? []
    expect(rows[2]).toContain('❯ Fix the questionnaire width crash')
    expect(rows[2]).toContain('— s-fix · 1970-01-01 00:00')
    // The live session (older than s-fix) is second, led by its title with
    // the current badge; a rejected observation degrades to the id form.
    expect(rows[3]).toContain('Kimi-style welcome banner')
    expect(rows[3]).toContain(`— ${agent.id} · 1970-01-01 00:00`)
    expect(rows[3]).toContain('← current')
    expect(rows[4]).toContain('s-plain · 1970-01-01 00:00')
    expect(rows[4]).not.toContain('—')
  })

  it('/sessions opens with the id form when no sessionQuery is mounted', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-one', 1_000, HERE)]) },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows[2]).toContain('s-one · 1970-01-01 00:00')
  })

  it('/sessions resolves titles only for the newest sessions under the limit', async () => {
    const requested: string[] = []
    const { ctx, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([
          header('s-new', 3_000, HERE),
          header('s-old', 1_000, HERE),
        ]),
      },
      sessionQuery: {
        readTitleSnapshots: async ids => {
          requested.push(...ids.map(String))
          return []
        },
      },
    })
    commandsPlugin.setSessionTitleLimit(1)
    try {
      expect(commandsPlugin.currentSessionTitleLimit()).toBe(1)
      await ctx.commands.execute(agent, '/sessions', [], signal())
      // Newest-first: only the newest id is worth a full-log parse when
      // the cap is 1; the older row keeps the id form.
      expect(requested).toEqual(['s-new'])
    } finally {
      commandsPlugin.setSessionTitleLimit(undefined)
    }
    expect(commandsPlugin.currentSessionTitleLimit()).toBe(commandsPlugin.DEFAULT_SESSION_TITLE_LIMIT)
  })

  it('/sessions degrades to the id form when the whole title batch fails', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([header('s-one', 1_000, HERE), header('s-two', 2_000, HERE)]),
      },
      sessionQuery: {
        readTitleSnapshots: async () => {
          throw new Error('persistence backend gone')
        },
      },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows[2]).toContain('s-two · 1970-01-01 00:00')
    expect(rows[3]).toContain('s-one · 1970-01-01 00:00')
  })

  it('/sessions filters rows by the typed query and clears it before cancelling', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([header('s-fix', 2_000, HERE), header('s-banner', 1_000, HERE)]),
      },
      sessionQuery: {
        readTitleSnapshots: async () => [titled('s-fix', 'Fix width crash'), titled('s-banner', 'Banner rework')],
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    const panel = overlay(screen)
    for (const char of 'Banner') panel.handleInput(char)
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows.some(row => row.includes('Banner rework'))).toBe(true)
    expect(rows.some(row => row.includes('Fix width crash'))).toBe(false)
    // Escape clears the query first; only the second press cancels.
    panel.handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).not.toBe(true)
    panel.handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/sessions emits blue/request-resume when another session is picked', async () => {
    const notice = vi.fn()
    const { ctx, screen, components, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-other', 2_000, HERE), header(String(agent.id), 3_000, HERE)]) },
    })
    setSharedEditor({ editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onResume = vi.fn()
      ctx.on('blue/request-resume', onResume)
      await ctx.commands.execute(agent, '/sessions', [], signal())
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
      persistence: { list: () => Promise.resolve([header(String(agent.id), 3_000, HERE)]) },
    })
    setSharedEditor({ editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onResume = vi.fn()
      ctx.on('blue/request-resume', onResume)
      await ctx.commands.execute(agent, '/sessions', [], signal())
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
    const pending = ctx.commands.execute(agent, '/sessions', [], signal())
    await fiber.dispose()
    gate.resolve([header('s-late', 1_000, HERE)])
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success' })
    expect(screen.overlays).toHaveLength(0)
  })

  it('/sessions shows no overlay when the fiber unloads while titles resolve', async () => {
    const gate = Promise.withResolvers<ReadonlyArray<{ sessionId: { toString(): string }, status: 'fulfilled', value: { title?: { title: string } } }>>()
    const { ctx, screen, agent, fiber } = await mount({
      persistence: { list: () => Promise.resolve([header('s-late', 1_000, HERE)]) },
      sessionQuery: { readTitleSnapshots: () => gate.promise },
    })
    const pending = ctx.commands.execute(agent, '/sessions', [], signal())
    await fiber.dispose()
    gate.resolve([])
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
      list: () => Promise.resolve([header('s-one', 1_000, process.cwd())]),
    } as unknown as SessionPersistence)
    const session = ctx.sessions.create(SessionId('commands-bare'))
    const agent = { id: session.id, session } as unknown as Agent
    await ctx.plugin(commandsPlugin)
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'session picker is unavailable: the Blue screen is not mounted',
    })
    await ctx.fiber.dispose()
  })

  it('/help lists the registered commands and key bindings in an overlay', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/help', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    // The framed HelpPanel: primary rules, ` help ` title with the key
    // hint, and the two aligned sections. The sections overflow the ten-row
    // window, so a `showing` line replaces the tail.
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows[0]).toBe('^' + '─'.repeat(80) + '^')
    expect(rows[1]).toBe('^  help^ _· Esc / Enter / q to cancel · ↑↓ scroll_')
    expect(rows[3]).toBe('  #Commands#')
    // The runtime lists commands alphabetically (`/context` leads since
    // the S25 rename); labels padEnd inside the primary span with the
    // description muted behind two spaces. The longest label is the
    // aliased `/effort (/thinking)` (18 columns), which widens the whole
    // column.
    expect(rows[4]).toBe('    ^/context           ^  ~Show token usage and the context window~')
    expect(rows.some(row => row.includes('^/effort (/thinking)^  ~Switch the thinking effort of the current model~'))).toBe(true)
    expect(rows.some(row => row.includes('^/quit (/q, /exit)  ^  ~Exit Blue~'))).toBe(true)
    // 38 rows since S30 added alt+m and S31 added ctrl+g to the key list
    // and S34 added /mcp to the command list (37 at S31, 36 at S30, 34 at
    // S28).
    expect(rows.some(row => row.includes('_ showing 1-16 of 38_'))).toBe(true)
    // Scrolling down reaches the Keys section with the two-column layout.
    for (let i = 0; i < 10; i += 1) overlay(screen).handleInput(KEY.down)
    const scrolled = screen.overlays[0]?.component.render(80) ?? []
    expect(scrolled.some(row => row.includes('  #Keys#'))).toBe(true)
    // Key labels padEnd to the longest label — `backspace` (9) since S13.
    expect(scrolled.some(row => row.includes('?enter    ?  ~Submit input / confirm selection~'))).toBe(true)
    expect(scrolled.some(row => row.includes('_ showing 11-26 of 38_'))).toBe(true)
    screen.overlays[0]?.component.invalidate()
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/help falls back to the action id when a binding has no description', async () => {
    const { ctx, screen, agent } = await mount()
    const keymap = ctx.get('blueKeymap')
    const unregister = keymap?.register([{ id: 'spec.custom', keys: 'f9' }])
    await ctx.commands.execute(agent, '/help', [], signal())
    // The f9 row is the last key binding, beyond the first window; extra
    // downs clamp at the scroll floor (23 clears the S30+S31+S34-extended
    // list: 38 rows minus the 16-row window plus one).
    for (let i = 0; i < 23; i += 1) overlay(screen).handleInput(KEY.down)
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows.some(row => row.includes('f9') && row.includes('~spec.custom~'))).toBe(true)
    unregister?.()
    overlay(screen).handleInput(KEY.escape)
  })

  it('/help closes on Enter and on q as well', async () => {
    const { ctx, screen, agent } = await mount()
    await ctx.commands.execute(agent, '/help', [], signal())
    overlay(screen).handleInput(KEY.enter)
    expect(screen.overlays[0]?.hidden).toBe(true)
    await ctx.commands.execute(agent, '/help', [], signal())
    overlay(screen).handleInput('q')
    expect(screen.overlays[1]?.hidden).toBe(true)
    // An unrelated key keeps the overlay open.
    await ctx.commands.execute(agent, '/help', [], signal())
    overlay(screen).handleInput('x')
    expect(screen.overlays[2]?.hidden).toBe(false)
    overlay(screen).handleInput(KEY.escape)
  })

  it('/help truncates rows to the render width', async () => {
    const { ctx, screen, components, agent } = await mount()
    await ctx.commands.execute(agent, '/help', [], signal())
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
    const execution = await ctx.commands.execute(agent, '/help', [], signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'help is unavailable: the Blue screen is not mounted',
    })
    await ctx.fiber.dispose()
  })

  it('unregisters every command when the fiber disposes', async () => {
    const { ctx, agent, fiber } = await mount({ appExit: () => {} })
    for (const name of ['quit', 'new', 'fork', 'sessions', 'help', 'theme']) {
      expect(ctx.commands.find(agent, name)).toBeDefined()
    }
    await fiber.dispose()
    for (const name of ['quit', 'new', 'fork', 'sessions', 'help', 'theme']) {
      expect(ctx.commands.find(agent, name)).toBeUndefined()
    }
    // The alias metadata follows the fiber: the relation is gone too, so a
    // later mount can re-register it without tripping the conflict guard.
    expect(canonicalOf('q')).toBeUndefined()
    expect(canonicalOf('exit')).toBeUndefined()
  })
})
