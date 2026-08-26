/**
 * `blue-status-title` plugin: the folded session-title footer entry — the
 * first-band right-cluster placement in the retired tips slot (priority 30,
 * muted tier), the fold read through the structural title service, the
 * refresh triggers (load, session switches incl. the null broadcast,
 * current-session events), the foreign-session filter, the
 * empty-while-untitled hide, the width truncation, and the fiber unload.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import * as statusTitle from '../src/status-title.ts'
import { asAgent, bootStatusPlugin, COLORS, fakeAgent, type FakeAgent } from './status-fakes.ts'

/** Log accepted titles into a fresh fake agent's session event log. */
function titledAgent(titles: string[]): FakeAgent {
  const agent = fakeAgent([])
  for (const title of titles) {
    agent.session.events.push({ type: 'session/title', data: { title } } as unknown as SessionEvent)
  }
  return agent
}

/** The structural title-service fake: folds the last logged title. */
function titleService() {
  return {
    get: vi.fn((session: { events: { type: string, data?: { title?: string } }[] }) => {
      const event = [...session.events].reverse().find(item => item.type === 'session/title')
      return event?.data?.title === undefined ? undefined : { title: event.data.title }
    }),
  }
}

describe('blue-status-title', () => {
  it('renders the folded title at priority 30, band 1 right cluster (the retired tips slot), muted tier', async () => {
    const muted = (text: string): string => `[Mu]${text}[/Mu]`
    const harness = await bootStatusPlugin(statusTitle, titledAgent(['fix the login bug']), {
      colors: { ...COLORS, muted },
      services: { sessionTitle: titleService() },
    })
    expect(harness.entry.id).toBe('blue.status.title')
    expect(harness.entry.priority).toBe(30)
    expect(harness.entry.row).toBeUndefined()
    expect(harness.entry.align).toBe('right')
    expect(harness.entry.render(80)).toBe('[Mu]fix the login bug[/Mu]')
    await harness.dispose()
  })

  it('hides while untitled, on a thin host, or without a session', async () => {
    const untitled = await bootStatusPlugin(statusTitle, fakeAgent([]), {
      services: { sessionTitle: titleService() },
    })
    expect(untitled.entry.render(80)).toBe('')
    await untitled.dispose()

    const thinHost = await bootStatusPlugin(statusTitle, titledAgent(['titled but no service']), {
      titleProjection: false,
    })
    expect(thinHost.entry.render(80)).toBe('')
    await thinHost.dispose()

    const noSession = await bootStatusPlugin(statusTitle, null, {
      services: { sessionTitle: titleService() },
    })
    expect(noSession.entry.render(80)).toBe('')
    await noSession.dispose()
  })

  it('re-folds on session switches, hides on the null broadcast, dedupes redraws', async () => {
    const harness = await bootStatusPlugin(statusTitle, titledAgent(['first']), {
      services: { sessionTitle: titleService() },
    })
    const baseline = harness.screen.renderRequests.length

    harness.ctx.emit('test/session-changed', asAgent(titledAgent(['second'])))
    expect(harness.entry.render(80)).toBe('second')
    expect(harness.screen.renderRequests.length).toBe(baseline + 1)

    // An unchanged fold requests no redraw.
    harness.ctx.emit('test/session-changed', asAgent(titledAgent(['second'])))
    expect(harness.screen.renderRequests.length).toBe(baseline + 1)

    harness.ctx.emit('test/session-changed', null as never)
    expect(harness.entry.render(80)).toBe('')
    await harness.dispose()
  })

  it('refreshes on the current session events and ignores foreign sessions', async () => {
    const agent = titledAgent(['first'])
    const harness = await bootStatusPlugin(statusTitle, agent, {
      services: { sessionTitle: titleService() },
    })
    harness.ctx.emit('session/event', titledAgent(['foreign']).session as never, {
      type: 'session/title', data: { title: 'foreign' },
    } as never)
    expect(harness.entry.render(80)).toBe('first')

    agent.session.events.push({ type: 'session/title', data: { title: 'second' } } as unknown as SessionEvent)
    harness.ctx.emit('session/event', agent.session as never, {
      type: 'session/title', data: { title: 'second' },
    } as never)
    expect(harness.entry.render(80)).toBe('second')
    await harness.dispose()
  })

  it('truncates to the offered width budget', async () => {
    const harness = await bootStatusPlugin(statusTitle, titledAgent(['fix the login timeout bug']), {
      services: { sessionTitle: titleService() },
    })
    expect(harness.entry.render(10)).toBe('fix the\x1b[0m...\x1b[0m')
    await harness.dispose()
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const harness = await bootStatusPlugin(statusTitle, titledAgent(['x']), {
      services: { sessionTitle: titleService() },
    })
    expect(harness.models.list()).toHaveLength(1)
    await harness.dispose()
    expect(harness.models.list()).toHaveLength(0)
  })
})
