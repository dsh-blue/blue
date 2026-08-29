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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type SessionPersistence from '@deepseek-ai/dsh-session-persistence'
import type SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import * as commandsPlugin from '../src/commands-plugin.ts'
import { rewindCandidates } from '../../app/src/rewind.ts'
import { clearSharedEditor, EditorHostService, setSharedEditor } from '../src/editor-instance.ts'
import type {} from '@dsh-blue/blue-app'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeScreen } from './fakes.ts'
import { InteractionStateService } from '../src/runtime-state.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'
import { BlueLocaleService } from '../../frontend/src/locale.ts'
import { INTERACTION_LOCALE } from '../src/locale.ts'

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
  locale?: 'en' | 'zh'
} = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  components: FakeBlueComponents
  agent: Agent
  fiber: { dispose(): Promise<void> }
  locale: BlueLocaleService | undefined
}> {
  const { ctx, screen, components } = fakeBlueContext()
  const locale = options.locale === undefined
    ? undefined
    : new BlueLocaleService(ctx, { systemLocale: options.locale })
  locale?.register('interaction', INTERACTION_LOCALE)
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  if (options.appExit !== undefined) ctx.provide('appExit', options.appExit)
  const session = ctx.sessions.create(SessionId('commands-spec'))
  const agent = { id: session.id, session, status: options.agentStatus ?? 'idle' } as unknown as Agent
  if (options.attach !== false) ctx.provide('testSession', { current: agent, modelRef: undefined })
  if (options.persistence !== undefined) {
    ctx.provide('sessionPersistence', options.persistence as unknown as SessionPersistence)
  }
  if (options.sessionQuery !== undefined) {
    ctx.provide('sessionQuery', options.sessionQuery as unknown as SessionQueryEngine)
  }
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, screen, components, agent, fiber, locale }
}

const signal = (): AbortSignal => new AbortController().signal

/** Provide the app-owned seams without mounting any Blue renderer services. */
function provideAppBoundary(ctx: Context): void {
  const active = (): Agent | null => ctx.get('testSession')?.current ?? null
  ctx.provide('blueSessionReader', {
    current: () => {
      const agent = active()
      return agent === null ? null : {
        id: String(agent.id),
        cwd: agent.session.header.cwd ?? process.cwd(),
        status: agent.status === 'running' ? 'running' : 'idle',
        mode: 'normal',
      }
    },
    subscribe: () => ({ disposed: false, dispose() {} }),
    request: async () => ({ ok: false, code: 'BLUE_SESSION_UNAVAILABLE', message: 'not used' }),
  })
  ctx.provide('blueSessionActions', {
    commands: () => {
      const agent = active()
      return agent === null ? [] : ctx.commands.list(agent)
    },
    rewindCandidates: () => {
      const agent = active()
      return agent === null ? [] : rewindCandidates(agent.session.events)
    },
  } as never)
  ctx.provide('blueSessionProjections', {
    current: () => undefined,
    currentMany: () => undefined,
    subscribe: () => () => {},
    children: () => [],
    subscribeChildren: () => () => {},
  })
  ctx.provide('blueSkillsCatalog', {
    userInvocable: () => [],
    refresh: () => Promise.resolve(),
    setForTest: () => {},
  } as never)
}

/** The cwd the picker scopes to: the test runner's own directory. */
const HERE = process.cwd()

function header(id: string, createdAt: number, cwd?: string, parentSession?: string): SessionHeader {
  return {
    version: 1,
    id: SessionId(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
    ...parentSession === undefined ? {} : { parentSession: SessionId(parentSession) },
  }
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
    expect(ctx.blueInteractionState.aliases.canonicalOf('q')).toBe('quit')
    expect(ctx.blueInteractionState.aliases.canonicalOf('exit')).toBe('quit')
    expect(ctx.blueInteractionState.aliases.canonicalOf('quit')).toBeUndefined()
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
    expect(ctx.blueInteractionState.aliases.canonicalOf('resume')).toBe('sessions')
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
    expect(ctx.blueInteractionState.aliases.canonicalOf('clear')).toBe('new')
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

  it('/rewind opens direct user turns and emits the selected safe boundary', async () => {
    const notice = vi.fn()
    const { ctx, screen, components, agent } = await mount()
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'fix the login flow' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('assistant/message', {
      turn: 1,
      step: 0,
      message: {
        id: 'rewind-answer' as never,
        role: 'assistant',
        content: [{ type: 'text', text: 'login flow fixed' }],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      },
    }, { surfaceOp: 'append' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    setSharedEditor(ctx, { editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onRewind = vi.fn()
      ctx.on('blue/request-rewind', onRewind)
      const execution = await ctx.commands.execute(agent, '/rewind', [], signal())
      expect(execution?.result).toEqual({ kind: 'success' })
      const rows = screen.overlays[0]?.component.render(72) ?? []
      expect(rows.some(row => row.includes('Rewind current session'))).toBe(true)
      expect(rows.some(row => row.includes('Turn 1 · fix the login flow'))).toBe(true)
      expect(rows.some(row => row.includes('login flow fixed'))).toBe(true)
      expect(rows.some(row => row.includes('The original session stays available'))).toBe(true)
      overlay(screen).handleInput(KEY.enter)
      expect(onRewind).toHaveBeenCalledWith(String(agent.id), 0)
      expect(notice).toHaveBeenCalledWith('creating rewind branch...')
    } finally {
      clearSharedEditor(ctx)
    }
  })

  it('/rewind handles unavailable, running, empty, and cancelled states', async () => {
    const detached = await mount({ attach: false })
    expect((await detached.ctx.commands.execute(detached.agent, '/rewind', [], signal()))?.result)
      .toEqual({ kind: 'error', text: 'no active session' })
    const running = await mount({ agentStatus: 'running' })
    expect((await running.ctx.commands.execute(running.agent, '/rewind', [], signal()))?.result)
      .toEqual({ kind: 'error', text: 'cannot rewind while the agent is running' })
    const empty = await mount()
    expect((await empty.ctx.commands.execute(empty.agent, '/rewind', [], signal()))?.result)
      .toEqual({ kind: 'success', text: 'no user turns to rewind' })
    empty.agent.session.append('turn/start', { turn: 1 })
    empty.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'cancel me' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await empty.ctx.commands.execute(empty.agent, '/rewind', [], signal())
    overlay(empty.screen).handleInput(KEY.escape)
    expect(empty.screen.overlays[0]?.hidden).toBe(true)
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
    expect(rows.some(row => row.includes('Sessions'))).toBe(true)
    expect(rows.some(row => row.includes('type to search') && row.includes('space toggle branch'))).toBe(true)
    expect(rows.some(row => row.includes(`${agent.id} · 1970-01-01 00:00`) && row.includes('← current'))).toBe(true)
    expect(rows.some(row => row.includes('s-mid · 1970-01-01 00:00'))).toBe(true)
    expect(rows.some(row => row.includes('s-old · 1970-01-01 00:00'))).toBe(true)
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
    expect(rows.some(row => row.includes('Fix the questionnaire width crash') && row.includes('— s-fix · 1970-01-01 00:00'))).toBe(true)
    // The live session (older than s-fix) is second, led by its title with
    // the current badge; a rejected observation degrades to the id form.
    expect(rows.some(row => row.includes('Kimi-style welcome banner') && row.includes(`— ${agent.id} · 1970-01-01 00:00`) && row.includes('← current'))).toBe(true)
    const plainRow = rows.find(row => row.includes('s-plain · 1970-01-01 00:00'))
    expect(plainRow).toBeDefined()
    expect(plainRow).not.toContain('—')
  })

  it('/sessions renders persisted parentSession lineage as a tree', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: {
        list: () => Promise.resolve([
          header('root', 1_000, HERE),
          header('child-a', 3_000, HERE, 'root'),
          header('child-b', 2_000, HERE, 'root'),
        ]),
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    const collapsed = screen.overlays[0]?.component.render(90) ?? []
    expect(collapsed.some(row => row.includes('space toggle branch'))).toBe(true)
    expect(collapsed.some(row => row.includes('▸ root · 1970-01-01 00:00'))).toBe(true)
    expect(collapsed.some(row => row.includes('child-a'))).toBe(false)
    overlay(screen).handleInput(KEY.space)
    const expanded = screen.overlays[0]?.component.render(90) ?? []
    expect(expanded.some(row => row.includes('▾ root · 1970-01-01 00:00'))).toBe(true)
    expect(expanded.some(row => row.includes('├─   child-a'))).toBe(true)
    expect(expanded.some(row => row.includes('└─   child-b'))).toBe(true)
  })

  it('/sessions opens with the id form when no sessionQuery is mounted', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-one', 1_000, HERE)]) },
    })
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows.some(row => row.includes('s-one · 1970-01-01 00:00'))).toBe(true)
  })

  it('/sessions works without a currently attached Blue session', async () => {
    const { ctx, screen, agent } = await mount({
      attach: false,
      persistence: { list: () => Promise.resolve([header('s-one', 1_000, HERE)]) },
    })
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    await ctx.commands.execute(agent, '/sessions', [], signal())
    overlay(screen).handleInput(KEY.enter)
    expect(onResume).toHaveBeenCalledWith('s-one')
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
    expect(rows.some(row => row.includes('s-two · 1970-01-01 00:00'))).toBe(true)
    expect(rows.some(row => row.includes('s-one · 1970-01-01 00:00'))).toBe(true)
  })

  it('/sessions keeps the skeleton when title hydration returns malformed data', async () => {
    const { ctx, screen, agent } = await mount({
      persistence: { list: () => Promise.resolve([header('s-one', 1_000, HERE)]) },
      sessionQuery: {
        readTitleSnapshots: async () => undefined as never,
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    await Promise.resolve()
    const rows = screen.overlays[0]?.component.render(60) ?? []
    expect(rows.some(row => row.includes('s-one · 1970-01-01 00:00'))).toBe(true)
  })

  it('/sessions hydrates only the visible title page as the cursor advances', async () => {
    const headers = Array.from({ length: 10 }, (_, index) => header(`s-${index}`, 10_000 - index, HERE))
    const calls: string[][] = []
    const secondPage = Promise.withResolvers<ReadonlyArray<ReturnType<typeof titled>>>()
    const { ctx, screen, agent } = await mount({
      persistence: { list: () => Promise.resolve(headers) },
      sessionQuery: {
        readTitleSnapshots: async ids => {
          calls.push(ids.map(String))
          if (calls.length === 2) return secondPage.promise
          return ids.map(id => titled(String(id), `Title ${String(id)}`))
        },
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(calls).toEqual([
      headers.slice(0, 8).map(item => String(item.id)),
      headers.slice(8).map(item => String(item.id)),
    ])
    const panel = overlay(screen)
    for (let index = 0; index < 6; index += 1) panel.handleInput(KEY.down)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(headers.slice(8).map(item => String(item.id)))
    secondPage.resolve(headers.slice(8).map(item => titled(String(item.id), `Title ${String(item.id)}`)))
    await vi.waitFor(() => expect(panel.render(80).some(row => row.includes('Title s-8'))).toBe(true))
    const rows = panel.render(80)
    expect(rows.some(row => row.includes('Title s-8'))).toBe(true)
  })

  it('/sessions drops a late page hydration after the picker fiber unloads', async () => {
    const headers = Array.from({ length: 10 }, (_, index) => header(`late-${index}`, 10_000 - index, HERE))
    const gate = Promise.withResolvers<ReadonlyArray<ReturnType<typeof titled>>>()
    let call = 0
    const { ctx, screen, agent, fiber } = await mount({
      persistence: { list: () => Promise.resolve(headers) },
      sessionQuery: {
        readTitleSnapshots: async ids => {
          call += 1
          if (call === 2) return gate.promise
          return ids.map(id => titled(String(id), `Title ${String(id)}`))
        },
      },
    })
    await ctx.commands.execute(agent, '/sessions', [], signal())
    const panel = overlay(screen)
    for (let index = 0; index < 8; index += 1) panel.handleInput(KEY.down)
    await fiber.dispose()
    gate.resolve([])
    await Promise.resolve()
    expect(screen.overlays).toHaveLength(1)
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
    setSharedEditor(ctx, { editor: components.createEditor(), submitPrompt: () => {}, notice })
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
      clearSharedEditor(ctx)
    }
  })

  it('/sessions flashes an error notice when the live session is picked', async () => {
    const notice = vi.fn()
    const { ctx, screen, components, agent } = await mount({
      persistence: { list: () => Promise.resolve([header(String(agent.id), 3_000, HERE)]) },
    })
    setSharedEditor(ctx, { editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const onResume = vi.fn()
      ctx.on('blue/request-resume', onResume)
      await ctx.commands.execute(agent, '/sessions', [], signal())
      overlay(screen).handleInput(KEY.enter)
      expect(screen.overlays[0]?.hidden).toBe(true)
      expect(onResume).not.toHaveBeenCalled()
      expect(notice).toHaveBeenCalledWith('!already the current session!')
    } finally {
      clearSharedEditor(ctx)
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

  it('/sessions waits for first-page title hydration and ignores a late result after unload', async () => {
    const gate = Promise.withResolvers<ReadonlyArray<{ sessionId: { toString(): string }, status: 'fulfilled', value: { title?: { title: string } } }>>()
    const { ctx, screen, agent, fiber } = await mount({
      persistence: { list: () => Promise.resolve([header('s-late', 1_000, HERE)]) },
      sessionQuery: { readTitleSnapshots: () => gate.promise },
    })
    const pending = ctx.commands.execute(agent, '/sessions', [], signal())
    await Promise.resolve()
    expect(screen.overlays).toHaveLength(0)
    await fiber.dispose()
    gate.resolve([])
    const execution = await pending
    expect(execution?.result).toEqual({ kind: 'success' })
    // The fake screen does not model the editor-slot disposer; the important
    // contract here is that the late title continuation is harmless after the
    // owning fiber has unloaded.
    await Promise.resolve()
    expect(screen.overlays).toHaveLength(0)
  })

  it('/sessions errors when the Blue display services are not mounted', async () => {
    // A bare context without the Blue services: persistence alone is present.
    const ctx = new Context()
    new InteractionStateService(ctx, DEFAULT_SETTINGS)
    new EditorHostService(ctx)
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([header('s-one', 1_000, process.cwd())]),
    } as unknown as SessionPersistence)
    const session = ctx.sessions.create(SessionId('commands-bare'))
    const agent = { id: session.id, session } as unknown as Agent
    provideAppBoundary(ctx)
    await ctx.plugin(commandsPlugin)
    const execution = await ctx.commands.execute(agent, '/sessions', [], signal())
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'session picker is unavailable: the Blue screen is not mounted',
    })
    ;(agent as unknown as { status: string }).status = 'idle'
    ctx.provide('testSession', { current: agent, modelRef: undefined })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'rewind without a screen' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect((await ctx.commands.execute(agent, '/rewind', [], signal()))?.result).toEqual({
      kind: 'error',
      text: 'rewind is unavailable: the Blue screen is not mounted',
    })
    await ctx.fiber.dispose()
  })

  it('/help lists the registered commands and key bindings in an overlay', async () => {
    const { ctx, screen, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/help', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    // The canonical Help surface owns chrome and semantic rows. The sections
    // overflow the window, so a `showing` line replaces the tail.
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows.join('\n')).toContain('help')
    expect(rows.join('\n')).toContain('Commands')
    expect(rows.join('\n')).toContain('/changelog')
    expect(rows.join('\n')).toContain('/context')
    expect(rows.join('\n')).toContain('/effort (/thinking)')
    expect(rows.join('\n')).toContain('/plugin')
    // 45 rows including the marketplace `/plugin` command.
    expect(rows.some(row => row.includes('showing 1-16 of'))).toBe(true)
    // Scrolling down reaches the Keys section with the two-column layout.
    for (let i = 0; i < 21; i += 1) overlay(screen).handleInput(KEY.down)
    const scrolled = screen.overlays[0]?.component.render(80) ?? []
    expect(scrolled.some(row => row.includes('Keys'))).toBe(true)
    // The keys section remains reachable after the command list grows.
    expect(scrolled.some(row => row.includes('enter') && row.includes('Submit input'))).toBe(true)
    screen.overlays[0]?.component.invalidate()
    overlay(screen).handleInput(KEY.escape)
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('/help consumes the renderer-neutral command model projection when available', async () => {
    const { ctx, screen, agent, fiber } = await mount()
    ctx.provide('blueCommandModels', { list: () => [{ kind: 'command', id: 'command.status', label: '/status', description: 'projected status', enabled: true }, { kind: 'command', id: 'command.version', label: '/version', enabled: true }] })
    const execution = await ctx.commands.execute(agent, '/help', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    expect(screen.overlays[0]?.component.render(80).some(row => row.includes('projected status'))).toBe(true)
    await fiber.dispose()
  })

  it('/help switches language in place while preserving the open overlay', async () => {
    const { ctx, screen, agent, locale } = await mount({ locale: 'en' })
    await ctx.commands.execute(agent, '/help', [], signal())
    const open = screen.overlays[0]!.component
    expect(open.render(80).join('\n')).toContain('Commands')
    open.handleInput(KEY.down)

    locale!.setPreference('zh')
    expect(screen.overlays[0]!.component).toBe(open)
    const localized = open.render(80).join('\n')
    expect(localized).toContain('帮助')
    expect(localized).toContain('命令')
    expect(localized).toContain('显示第')
    open.handleInput(KEY.escape)
  })

  it('/help renders an empty description for a fallback command without one', async () => {
    const { ctx, screen, agent } = await mount()
    ;(ctx.blueSessionActions as unknown as { commands: () => readonly { name: string }[] }).commands
      = () => [{ name: 'bare' }]
    await ctx.commands.execute(agent, '/help', [], signal())
    expect(screen.overlays[0]?.component.render(80).some(row => row.includes('/bare'))).toBe(true)
  })

  it('/help falls back to the action id when a binding has no description', async () => {
    const { ctx, screen, agent } = await mount()
    const keymap = ctx.get('blueKeymap')
    const unregister = keymap?.register([{ id: 'spec.custom', keys: 'f9' }])
    await ctx.commands.execute(agent, '/help', [], signal())
    // The f9 row is the last key binding, beyond the first window; extra
    // Downs clamp at the scroll floor; use a generous count so additions to
    // the command/key roster do not hide the final binding.
    for (let i = 0; i < 50; i += 1) overlay(screen).handleInput(KEY.down)
    const rows = screen.overlays[0]?.component.render(80) ?? []
    expect(rows.join('\n')).toContain('f9')
    expect(rows.join('\n')).toContain('spec.custom')
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
    new InteractionStateService(ctx, DEFAULT_SETTINGS)
    await ctx.plugin(SessionStore)
    await ctx.plugin(CommandRuntime)
    const session = ctx.sessions.create(SessionId('commands-bare-help'))
    const agent = { id: session.id, session } as unknown as Agent
    provideAppBoundary(ctx)
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
    expect(ctx.blueInteractionState.aliases.canonicalOf('q')).toBeUndefined()
    expect(ctx.blueInteractionState.aliases.canonicalOf('exit')).toBeUndefined()
  })

  it('/plugin lists the official marketplace and is disposable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plugins: [{ id: 'blue-doudizhu', version: '0.1.0' }] }), { status: 200 })))
    const { ctx, agent, fiber } = await mount({ appExit: () => {} })
    expect((await ctx.commands.execute(agent, '/plugin list', [], signal()))?.result).toMatchObject({ kind: 'success', text: 'blue-doudizhu@0.1.0' })
    await fiber.dispose()
    vi.unstubAllGlobals()
  })

  it('/plugin opens the installed and available management panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plugins: [
      { id: 'blue-doudizhu', package: '@dsh-blue/blue-doudizhu', version: '1.0.0', title: { en: 'Doudizhu' } },
    ] }), { status: 200 })))
    const { ctx, screen, agent } = await mount({ appExit: () => {} })
    const execution = await ctx.commands.execute(agent, '/plugin', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const panel = screen.overlays.at(-1)?.component as { render(width: number): string[], handleInput(data: string): void }
    expect(panel.render(100).join('\n')).toContain('‹ Installed ›')
    expect(panel.render(100).join('\n')).toContain('Available')
    panel.handleInput(KEY.right)
    expect(panel.render(100).join('\n')).toContain('‹ Available ›')
  })

  it('/plugin shows a loading notice while marketplace data is pending', async () => {
    const gate = Promise.withResolvers<Response>()
    vi.stubGlobal('fetch', vi.fn(() => gate.promise))
    const notice = vi.fn()
    const { ctx, components, agent } = await mount({ appExit: () => {} })
    setSharedEditor(ctx, { editor: components.createEditor(), submitPrompt: () => {}, notice })
    try {
      const pending = ctx.commands.execute(agent, '/plugin', [], signal())
      await vi.waitFor(() => { expect(notice).toHaveBeenCalledWith('loading plugins...') })
      gate.resolve(new Response(JSON.stringify({ plugins: [] }), { status: 200 }))
      await expect(pending).resolves.toMatchObject({ result: { kind: 'success' } })
      expect(notice.mock.calls.map(call => call[0])).toEqual(['loading plugins...', ''])
    } finally {
      clearSharedEditor(ctx)
    }
  })

  it('does not expose Blue runtime dependencies as marketplace plugins', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plugins: [
      { id: 'market-plugin', package: '@scope/market-plugin', version: '1.0.0', title: { en: 'Market plugin' } },
    ] }), { status: 200 })))
    const { ctx, screen, agent } = await mount({ appExit: () => {} })
    const execution = await ctx.commands.execute(agent, '/plugin', [], signal())
    expect(execution?.result).toEqual({ kind: 'success' })
    const panel = screen.overlays.at(-1)?.component as { render(width: number): string[] }
    const output = panel.render(100).join('\n')
    expect(output).toContain('0 installed · 1 available')
    expect(output).not.toContain('@dsh-blue/blue')
  })
})
