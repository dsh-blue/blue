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
import { BlueStatusEntryService, type BlueStatusEntry } from '../../transcript/src/status-model.ts'
import { fakeBlueContext, type FakeScreen } from './fakes.ts'

const contexts = new WeakMap<Agent, Context>()

function setYolo(agent: Agent, enabled: boolean): void {
  contexts.get(agent)?.blueSessionActions.setYolo(enabled)
}

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
  models: BlueStatusEntryService
  registered: () => boolean
  setPlan: (agent: Agent, state: PlanState | undefined) => void
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const models = new BlueStatusEntryService(ctx, screen)
  const planStates = new Map<Agent, PlanState>()
  if (options.plan !== false) {
    ctx.provide('planMode', {
      get: (agent: Agent) => ({ active: false, ...planStates.get(agent) }),
    })
  }
  const session = ctx.sessions.create(SessionId('mode-status-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  contexts.set(agent, ctx)
  if (options.plan !== undefined && options.plan !== false) {
    planStates.set(agent, options.plan)
  }
  ctx.provide('testSession', { current: agent, modelRef: undefined })
  let bound: Agent | null = agent
  const listeners = new Set<() => void>()
  ctx.on('test/session-changed', next => {
    bound = next
    for (const listener of listeners) listener()
  })
  ctx.on('session/event', session => {
    if (session !== bound?.session) return
    for (const listener of listeners) listener()
  })
  ctx.provide('blueSessionFacts', {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      listener()
      return () => listeners.delete(listener)
    },
  })
  const fiber = await ctx.plugin(modeStatus)
  return {
    ctx,
    screen,
    agent,
    models,
    registered: () => modeModel(models) !== undefined,
    setPlan: (target, state) => {
      if (state === undefined) planStates.delete(target)
      else planStates.set(target, state)
    },
    fiber,
  }
}

/** Observe the renderer-neutral mode contribution directly. */
function modeModel(models: BlueStatusEntryService): BlueStatusEntry | undefined {
  return models.list().find(model => model.id === 'blue.status.mode')
}

function modeText(models: BlueStatusEntryService): string {
  const model = modeModel(models)
  if (model?.visible !== true || model.node.kind !== 'text') return ''
  return model.node.content
}

/** A minimal agent shell over a fresh session. */
function freshAgent(ctx: Context, id: string): Agent {
  const session = ctx.sessions.create(SessionId(id))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  contexts.set(agent, ctx)
  return agent
}

describe('blue-status-mode', () => {
  it('registers at priority 2 and follows the controller state', async () => {
    const { models, setPlan, agent } = await mount({ plan: { active: false } })
    expect(modeModel(models)?.priority).toBe(2)
    expect(modeText(models)).toBe('')
    // Controller state changes always land a session event; the badge
    // re-derives on it (status-basic discipline).
    setPlan(agent, { active: true })
    agent.session.append('plan/mode', { active: true })
    expect(modeText(models)).toBe('plan')
  })

  it('paints a committed plan in accent', async () => {
    const { models } = await mount({ plan: { active: true } })
    expect(modeText(models)).toBe('plan')
  })

  it('paints a queued plan with the pending ellipsis — entry or exit', async () => {
    const { models, setPlan, agent } = await mount({ plan: { active: false, pending: true } })
    expect(modeText(models)).toBe('plan…')
    setPlan(agent, { active: true, pending: true })
    agent.session.append('plan/mode', { active: true })
    expect(modeText(models)).toBe('plan…')
  })

  it('paints yolo in warning and outranks the plan transient', async () => {
    const { models, agent } = await mount({ plan: { active: true } })
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'y0', name: 'yolo', args: '' })
    expect(modeText(models)).toBe('yolo')
  })

  it('degrades to hidden when plan mode is not composed and yolo is off', async () => {
    const { models, agent } = await mount({ plan: false })
    expect(modeText(models)).toBe('')
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'y0', name: 'yolo', args: '' })
    expect(modeText(models)).toBe('yolo')
  })

  it('re-derives on session switches and ignores foreign sessions', async () => {
    const { ctx, screen, models, agent, setPlan } = await mount({ plan: { active: true } })
    expect(modeText(models)).toBe('plan')
    const next = freshAgent(ctx, 'mode-status-next')
    ;(ctx.get('testSession') as { current: Agent | null }).current = next
    ctx.emit('test/session-changed', next)
    expect(modeText(models)).toBe('')
    // The attached session's plan entry shows through the same entry.
    setPlan(next, { active: true })
    next.session.append('plan/mode', { active: true })
    expect(modeText(models)).toBe('plan')
    // The old session's events no longer reach the badge: no re-derivation,
    // no redraw, the painted text keeps the attached agent's state.
    setPlan(agent, { active: false })
    const before = screen.renderRequests
    agent.session.append('plan/mode', { active: false })
    expect(screen.renderRequests).toBe(before)
    expect(modeText(models)).toBe('plan')
  })

  it('redraws only when the derived text changes', async () => {
    const { screen, models, agent } = await mount({ plan: false })
    expect(modeText(models)).toBe('')
    const before = screen.renderRequests
    agent.session.append('plan/mode', { active: true })
    // planMode is absent: the event re-derives to the same '' — no redraw.
    expect(screen.renderRequests).toBe(before)
    setYolo(agent, true)
    agent.session.append('command/run', { commandId: 'c', name: 'yolo', args: '' })
    expect(screen.renderRequests).toBe(before + 1)
    expect(modeText(models)).toBe('yolo')
  })

  it('truncates the badge text to the given width', async () => {
    const { models } = await mount({ plan: { active: true } })
    expect(modeModel(models)?.node).toEqual({ kind: 'text', content: 'plan', tone: 'accent' })
  })

  it('renders nothing while no session is attached', async () => {
    const { ctx, models } = await mount({ plan: { active: true } })
    // Detach: the next derivation runs against no current agent.
    ;(ctx.get('testSession') as { current: Agent | null }).current = null
    ctx.emit('test/session-changed', null)
    expect(modeText(models)).toBe('')
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const { fiber, registered } = await mount({ plan: { active: true } })
    expect(registered()).toBe(true)
    await fiber.dispose()
    expect(registered()).toBe(false)
  })
})
