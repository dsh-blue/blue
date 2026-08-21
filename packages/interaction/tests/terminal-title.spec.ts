/**
 * The session-title terminal mirror (`blue-terminal-title`): the
 * product-name fallback while nothing is attached or titled, the fold read
 * through the structural title service, the session-switch and
 * current-session event triggers, the foreign-session filter, and the
 * write dedupe.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as terminalTitle from '../src/terminal-title.ts'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

/** One logged title event, the slice of `SessionEvent` the fold reads. */
interface FakeTitleEvent {
  type: 'session/title'
  data: { title: string }
}

/** The fake session: an identity token plus a foldable event log. */
interface FakeSession {
  events: FakeTitleEvent[]
}

/**
 * A fake agent carrying one fake session; `session/event` emissions route
 * by this exact object.
 */
function fakeAgent(titles: string[] = []): { agent: Agent, session: FakeSession } {
  const session: FakeSession = {
    events: titles.map(title => ({ type: 'session/title', data: { title } })),
  }
  const agent = { id: 'terminal-title-spec', session, status: 'idle' } as unknown as Agent
  return { agent, session }
}

/**
 * The structural title-service fake: folds the last `session/title` event
 * of the session it is handed, exactly like the harness service's log fold.
 */
function fakeTitleService() {
  return {
    get: vi.fn((session: FakeSession) => {
      const event = [...session.events].reverse().find(item => item.type === 'session/title')
      return event === undefined ? undefined : { title: event.data.title }
    }),
  }
}

/** Boot the mirror with an optional attached agent and title service. */
async function boot(options: { agent?: Agent | null, service?: object | null } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  session: { current: Agent | null }
}> {
  const { ctx, screen } = fakeBlueContext()
  // Providing null models the thin host (the service never mounted).
  if (options.service !== null) ctx.provide('sessionTitle', options.service ?? fakeTitleService())
  // The real app updates `blueSession.current` before broadcasting the
  // switch event; the fake mirrors that contract by staying mutable.
  const session = { current: options.agent === undefined ? null : options.agent }
  ctx.provide('blueSession', session)
  await ctx.plugin(terminalTitle)
  return { ctx, screen, session }
}

describe('blue-terminal-title', () => {
  it('mirrors the product name while nothing is attached', async () => {
    const { screen } = await boot()
    expect(screen.titles).toEqual(['blue'])
  })

  it('mirrors the folded title once a session is attached', async () => {
    const { agent } = fakeAgent(['fix the login bug'])
    const { screen } = await boot({ agent })
    expect(screen.titles).toEqual(['fix the login bug'])
  })

  it('falls back to the product name on a thin host without the service', async () => {
    const { agent } = fakeAgent(['fix the login bug'])
    const { screen } = await boot({ agent, service: null })
    expect(screen.titles).toEqual(['blue'])
  })

  it('falls back to the product name while the session is untitled', async () => {
    const { agent } = fakeAgent([])
    const { screen } = await boot({ agent })
    expect(screen.titles).toEqual(['blue'])
  })

  it('re-emits on the current session title events, deduped', async () => {
    const { agent, session } = fakeAgent(['first'])
    const { ctx, screen } = await boot({ agent })
    expect(screen.titles).toEqual(['first'])

    // An unrelated event with an unchanged fold writes nothing.
    ctx.emit('session/event', session as never, { type: 'user/message' } as never)
    expect(screen.titles).toEqual(['first'])

    session.events.push({ type: 'session/title', data: { title: 'second' } })
    ctx.emit('session/event', session as never, { type: 'session/title' } as never)
    expect(screen.titles).toEqual(['first', 'second'])
  })

  it('ignores events from a session that is not the attached one', async () => {
    const { agent } = fakeAgent(['first'])
    const { ctx, screen } = await boot({ agent })
    const foreign = fakeAgent(['foreign'])
    ctx.emit('session/event', foreign.session as never, { type: 'session/title' } as never)
    expect(screen.titles).toEqual(['first'])
  })

  it('re-folds on session switches in both directions', async () => {
    const first = fakeAgent(['first'])
    const second = fakeAgent(['second'])
    const { ctx, screen, session } = await boot({ agent: first.agent })
    session.current = second.agent
    ctx.emit('blue/session-changed', second.agent)
    expect(screen.titles).toEqual(['first', 'second'])
    session.current = null
    ctx.emit('blue/session-changed', null)
    expect(screen.titles).toEqual(['first', 'second', 'blue'])
  })
})
