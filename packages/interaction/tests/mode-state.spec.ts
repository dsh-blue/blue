/**
 * The mode-state unit: the `foldYolo` pure fold over every `command/run`
 * shape the command runtime records, the WeakMap round-trip, the
 * session-log restore, and `currentMode`'s plan/yolo resolution including
 * the plan-absent degradation and the pending leg.
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { currentMode, foldYolo, restoreYolo, setYolo, yoloActive } from '../src/mode-state.ts'

/** Build one log-only command/run record. */
function run(seq: number, name: string, args?: string): SessionEvent {
  return {
    type: 'command/run',
    seq,
    time: seq,
    data: { commandId: `cmd-${seq}`, name, ...(args === undefined ? {} : { args }) },
  } as SessionEvent
}

/** Build one unrelated log event the fold must skip. */
function other(seq: number): SessionEvent {
  return { type: 'plan/mode', seq, time: seq, data: { active: true } } as unknown as SessionEvent
}

/** A minimal agent shell over a real session (the model-commands spec idiom). */
function agentOver(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

describe('foldYolo', () => {
  it('an empty log folds to off', () => {
    expect(foldYolo([])).toBe(false)
  })

  it('a bare /yolo record (empty args) folds on', () => {
    expect(foldYolo([run(0, 'yolo', '')])).toBe(true)
  })

  it("an 'off' argument folds off, separator whitespace included", () => {
    expect(foldYolo([run(0, 'yolo', ' off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', 'off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', '  off  ')])).toBe(false)
  })

  it("any other non-empty argument folds on (handler and fold share one semantic)", () => {
    expect(foldYolo([run(0, 'yolo', ' on')])).toBe(true)
    expect(foldYolo([run(0, 'yolo', ' blah')])).toBe(true)
  })

  it('skips runs without recorded args (recordInput: false)', () => {
    expect(foldYolo([run(0, 'yolo'), run(1, 'yolo', ' off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo')])).toBe(false)
  })

  it('the last yolo run wins', () => {
    expect(foldYolo([run(0, 'yolo', ' on'), run(1, 'yolo', ' off'), run(2, 'yolo', '')])).toBe(true)
    expect(foldYolo([run(0, 'yolo', ''), run(1, 'yolo', ' off')])).toBe(false)
  })

  it('ignores other commands and non-command events', () => {
    expect(foldYolo([other(0), run(1, 'plan', ''), run(2, 'quit', ' off')])).toBe(false)
    expect(foldYolo([run(0, 'yolo', ' on'), other(1), run(2, 'plan', ' off')])).toBe(true)
  })
})

describe('the live WeakMap flag', () => {
  it('defaults off and round-trips through setYolo', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const agent = agentOver(ctx.sessions.create(SessionId('yolo-weakmap')))
    expect(yoloActive(agent)).toBe(false)
    setYolo(agent, true)
    expect(yoloActive(agent)).toBe(true)
    setYolo(agent, false)
    expect(yoloActive(agent)).toBe(false)
  })
})

describe('restoreYolo', () => {
  it('seeds the flag from the session log', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('yolo-restore'))
    session.append('command/run', { commandId: 'cmd-0', name: 'yolo', args: '' })
    session.append('command/run', { commandId: 'cmd-1', name: 'yolo', args: ' off' })
    const agent = agentOver(session)
    expect(yoloActive(agent)).toBe(false)
    restoreYolo(agent)
    expect(yoloActive(agent)).toBe(false)
    session.append('command/run', { commandId: 'cmd-2', name: 'yolo', args: '' })
    restoreYolo(agent)
    expect(yoloActive(agent)).toBe(true)
    await ctx.fiber.dispose()
  })
})

/** The fake plan-mode controller currentMode reads. */
function fakePlanMode(state: { active: boolean, pending?: boolean }): { get(agent: Agent): { active: boolean, pending?: boolean } } {
  return { get: () => ({ ...state }) }
}

describe('currentMode', () => {
  it('reads yolo first: the operative stance wins over a queued plan exit', async () => {
    const ctx = new Context()
    ctx.provide('planMode', fakePlanMode({ active: true }))
    await ctx.plugin(SessionStore)
    const agent = agentOver(ctx.sessions.create(SessionId('yolo-cycle')))
    expect(currentMode(ctx, agent)).toBe('plan')
    setYolo(agent, true)
    expect(currentMode(ctx, agent)).toBe('yolo')
    await ctx.fiber.dispose()
  })

  it('reads committed and pending plan as the plan leg', async () => {
    const ctx = new Context()
    const committed = fakePlanMode({ active: true })
    ctx.provide('planMode', committed)
    await ctx.plugin(SessionStore)
    const agent = agentOver(ctx.sessions.create(SessionId('plan-cycle')))
    expect(currentMode(ctx, agent)).toBe('plan')
    await ctx.fiber.dispose()
    const pending = new Context()
    pending.provide('planMode', fakePlanMode({ active: false, pending: true }))
    await pending.plugin(SessionStore)
    expect(currentMode(pending, agentOver(pending.sessions.create(SessionId('plan-pending'))))).toBe('plan')
    await pending.fiber.dispose()
  })

  it('degrades to the two-state cycle when plan mode is not composed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const agent = agentOver(ctx.sessions.create(SessionId('no-plan')))
    setYolo(agent, false)
    expect(currentMode(ctx, agent)).toBe('normal')
    setYolo(agent, true)
    expect(currentMode(ctx, agent)).toBe('yolo')
    await ctx.fiber.dispose()
  })
})
