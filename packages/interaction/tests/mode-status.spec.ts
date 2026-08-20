/**
 * The mode badge unit: the four renders (normal hidden, plan accent, the
 * pending ellipsis, yolo warning), the yolo-over-plan transient rule, the
 * plan-absent degradation, re-derivation on session switches and the
 * current session's events (redraw only on change), truncation, and the
 * effect-bound registration.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as modeStatus from '../src/mode-status.ts'
import type { BlueStatusEntry } from '@dsh-blue/blue-transcript'
import { setYolo } from '../src/mode-state.ts'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

/** The mutable controller state the fake reports, per agent. */
type PlanState = { active: boolean, pending?: boolean }

interface MountOptions {
  /** `false` composes no plan mode at all. */
  plan?: false | PlanState
}

async function mount(options: MountOptions = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  agent: Agent
  entries: BlueStatusEntry[]
  registered: () => boolean
  setPlan: (agent: Agent, state: PlanState | undefined) => void
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const entries: BlueStatusEntry[] = []
  ctx.provide('blueStatus', {
    register: (entry: BlueStatusEntry) => {
      entries.push(entry)
      return () => {
        const at = entries.indexOf(entry)
        if (at >= 0) entries.splice(at, 1)
      }
    },
  })
  const planStates = new Map<Agent, PlanState>()
  if (options.plan !== false) {
    ctx.provide('planMode', {
      get: (agent: Agent) => ({ active: false, ...planStates.get(agent) }),
    })
  }
  const session = ctx.sessions.create(SessionId('mode-status-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  if (options.plan !== undefined && options.plan !== false) {
    planStates.set(agent, options.plan)
  }
  ctx.provide('blueSession', { current: agent, modelRef: undefined })
  const fiber = await ctx.plugin(modeStatus)
  return {
    ctx,
    screen,
    agent,
    entries,
    registered: () => entries.length > 0,
    setPlan: (target, state) => {
      if (state === undefined) planStates.delete(target)
      else planStates.set(target, state)
    },
    fiber,
  }
}

/** The registered badge entry. */
function badge(entries: BlueStatusEntry[]): BlueStatusEntry {
  const entry = entries.find(item => item.id === 'blue.status.mode')
  if (entry === undefined) throw new Error('mode badge not registered')
  return entry
}

/** A minimal agent shell over a fresh session. */
function freshAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

describe('blue-status-mode', () => {
  it('registers at priority 2 and follows the controller state', async () => {
    const { entries, setPlan, agent } = await mount({ plan: { active: false } })
    const entry = badge(entries)
    expect(entry.priority).toBe(2)
    expect(entry.render(40)).toBe('')
    // Controller state changes always land a session event; the badge
    // re-derives on it (status-basic discipline).
    setPlan(agent, { active: true })
    agent.session.append('plan/mode', { active: true })
    expect(entry.render(40)).toBe('*plan*')
  })

  it('paints a committed plan in accent', async () => {
    const { entries } = await mount({ plan: { active: true } })
    expect(badge(entries).render(40)).toBe('*plan*')
  })

  it('paints a queued plan with the pending ellipsis — entry or exit', async () => {
    const { entries, setPlan, agent } = await mount({ plan: { active: false, pending: true } })
    expect(badge(entries).render(40)).toBe('*plan…*')
    setPlan(agent, { active: true, pending: true })
    agent.session.append('plan/mode', { active: true })
    expect(badge(entries).render(40)).toBe('*plan…*')
  })

  it('paints yolo in warning and outranks the plan transient', async () => {
    const { entries, agent } = await mount({ plan: { active: true } })
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'y0', name: 'yolo', args: '' })
    expect(badge(entries).render(40)).toBe('?yolo?')
  })

  it('degrades to hidden when plan mode is not composed and yolo is off', async () => {
    const { entries, agent } = await mount({ plan: false })
    expect(badge(entries).render(40)).toBe('')
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'y0', name: 'yolo', args: '' })
    expect(badge(entries).render(40)).toBe('?yolo?')
  })

  it('re-derives on session switches and ignores foreign sessions', async () => {
    const { ctx, screen, entries, agent, setPlan } = await mount({ plan: { active: true } })
    expect(badge(entries).render(40)).toBe('*plan*')
    const next = freshAgent(ctx, 'mode-status-next')
    ctx.emit('blue/session-changed', next)
    expect(badge(entries).render(40)).toBe('')
    // The attached session's plan entry shows through the same entry.
    setPlan(next, { active: true })
    next.session.append('plan/mode', { active: true })
    expect(badge(entries).render(40)).toBe('*plan*')
    // The old session's events no longer reach the badge: no re-derivation,
    // no redraw, the painted text keeps the attached agent's state.
    setPlan(agent, { active: false })
    const before = screen.renderRequests
    agent.session.append('plan/mode', { active: false })
    expect(screen.renderRequests).toBe(before)
    expect(badge(entries).render(40)).toBe('*plan*')
  })

  it('redraws only when the derived text changes', async () => {
    const { screen, entries, agent } = await mount({ plan: false })
    const entry = badge(entries)
    expect(entry.render(40)).toBe('')
    const before = screen.renderRequests
    agent.session.append('plan/mode', { active: true })
    // planMode is absent: the event re-derives to the same '' — no redraw.
    expect(screen.renderRequests).toBe(before)
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'c', name: 'yolo', args: '' })
    expect(screen.renderRequests).toBe(before + 1)
    expect(entry.render(40)).toBe('?yolo?')
  })

  it('truncates the badge text to the given width', async () => {
    const { entries } = await mount({ plan: { active: true } })
    expect(badge(entries).render(2)).toBe('*...*')
  })

  it('renders nothing while no session is attached', async () => {
    const { ctx, entries } = await mount({ plan: { active: true } })
    // Detach: the next derivation runs against no current agent.
    ctx.emit('blue/session-changed', null)
    expect(badge(entries).render(40)).toBe('')
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const { fiber, registered } = await mount({ plan: { active: true } })
    expect(registered()).toBe(true)
    await fiber.dispose()
    expect(registered()).toBe(false)
  })
})
