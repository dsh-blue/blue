/**
 * `blue-pane-agents` plugin: the S33 subagent pane. Covers the zero-row
 * empty render, spawn-call collection into the pinned card, the settled
 * group clearing at the next turn start while a live-running group
 * persists, the resume snapshot rebuilding the settled card, the live
 * child-session overlay end-to-end, fork prompt correlation, and
 * session-change rebinding.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as paneAgents from '../src/pane-agents.ts'
import { setAgentGroupTimers } from '../src/agent-group.ts'
import {
  resetSeq,
  stepStart,
  toolCallEvent,
  subagentCallEvent,
  toolResultEvent,
  turnStart,
} from './helpers.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'

afterEach(() => {
  setAgentGroupTimers(undefined)
})

/** The frozen wall clock the injected timers report. */
const T0 = 1_700_000_000_000

/** The parent session id the tracker admits children by. */
const PARENT = 'parent-1'

/** A fake agent whose session carries the id the admission keys match. */
function fakeAgent(events: SessionEvent[]): Agent {
  return {
    session: { id: PARENT, events, header: {} },
  } as unknown as Agent
}

/** One harness with the pane booted, the clock frozen, the agent held. */
interface Rig extends PanePluginHarness {
  agent: Agent
}

/** Captured tick so a spec can fire the card's 1 Hz redraw path. */
let fireTick: (() => void) | undefined

async function boot(events: SessionEvent[] = []): Promise<Rig> {
  resetSeq()
  fireTick = undefined
  setAgentGroupTimers({
    setInterval: cb => {
      fireTick = cb
      return 0 as unknown as ReturnType<typeof setInterval>
    },
    clearInterval: () => {},
    now: () => T0 + 10_000,
  })
  const agent = fakeAgent(events)
  const harness = await bootPanePlugin(paneAgents, agent)
  return { ...harness, agent }
}

/** A fake child session the tracker admits. */
function childSession(id: string): Session {
  return { id, header: { origin: 'subagent', parentSession: PARENT } } as unknown as Session
}

/** A child `turn/start` for the emit path. */
function childTurnStart(): SessionEvent<'turn/start'> {
  return { type: 'turn/start', seq: 1, time: T0 + 1_000, data: { turn: 1 } }
}

describe('blue-pane-agents plugin', () => {
  it('renders zero rows with no spawn calls', async () => {
    const { screen } = await boot()
    expect(screen.paneLines(80)).toEqual([])
  })

  it('ignores ordinary tool calls and keeps an unacked group across turns', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      // An ordinary call in the same stream is not pane material.
      toolCallEvent(1, 1, 'b1', 'bash', '{}', { time: T0 + 1_000 }),
    ])
    const rows = rig.screen.paneLines(140)
    expect(rows[1]).toContain('Running 1 agents')
    expect(rows.join('\n')).not.toContain('bash')
    // No ack yet: the turn boundary keeps the pending group (a member
    // without a result is not settled).
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(2), seq: 99, time: T0 + 10_000 })
    expect(rig.screen.paneLines(140)[1]).toContain('Running 1 agents')
  })

  it('survives result shapes without text and unparsable spawn arguments', async () => {
    const rig = await boot()
    const agent = fakeAgent([turnStart(1)])
    rig.ctx.emit('blue/session-changed', agent)
    // A result whose message carries no content at all.
    rig.ctx.emit('session/event', agent.session, {
      type: 'tool/result', seq: 50, time: T0 + 1_000,
      data: { turn: 1, step: 1, message: undefined } as never,
    })
    // A spawn call with unparsable arguments joins with no description.
    rig.ctx.emit('session/event', agent.session, {
      type: 'tool/call', seq: 51, time: T0 + 2_000,
      data: { turn: 1, step: 1, callId: 'bad1', name: 'subagent', arguments: 'not-json' },
    })
    // The description chain falls to the ellipsized raw arguments.
    expect(rig.screen.paneLines(140)[2]).toContain('not-json')
    // A result pairing into it with a non-text block yields empty text;
    // a block without a content field pairs the same empty way.
    rig.ctx.emit('session/event', agent.session, {
      type: 'tool/result', seq: 52, time: T0 + 3_000,
      data: {
        turn: 1, step: 1,
        message: {
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'bad1', content: [{ type: 'image', attachment: { id: 'x' } }], isError: false }],
        },
      },
    })
    expect(rig.screen.paneLines(140)[1]).toContain('1 agents finished')
    rig.ctx.emit('session/event', agent.session, {
      type: 'tool/call', seq: 53, time: T0 + 4_000,
      data: { turn: 1, step: 1, callId: 'bad2', name: 'subagent_fork', arguments: '{}' },
    })
    rig.ctx.emit('session/event', agent.session, {
      type: 'tool/result', seq: 54, time: T0 + 5_000,
      data: {
        turn: 1, step: 1,
        message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'bad2', isError: false }] },
      },
    })
    expect(rig.screen.paneLines(140)[1]).toContain('2 agents finished')
  })

  it('boots without an agent and survives a malformed result event', async () => {
    setAgentGroupTimers({
      setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearInterval: () => {},
      now: () => T0 + 10_000,
    })
    const harness = await bootPanePlugin(paneAgents, null)
    expect(harness.screen.paneLines(80)).toEqual([])
    // A result event without a toolCallId block pairs nothing and throws
    // nothing (the pane's defensive guard).
    const agent = fakeAgent([turnStart(1)])
    harness.ctx.emit('blue/session-changed', agent)
    harness.ctx.emit('session/event', agent.session, {
      type: 'tool/result', seq: 50, time: T0 + 1_000,
      data: { turn: 1, step: 1, message: { role: 'user', content: [] } },
    })
    expect(harness.screen.paneLines(80)).toEqual([])
  })

  it('rebuilds the settled card from a resume snapshot (no live overlay)', async () => {
    const { screen } = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey tests', 'survey', { time: T0 }),
      subagentCallEvent(1, 1, 'a2', 'subagent', 'Map docs', 'map', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 90_000 }),
      toolResultEvent(1, 1, 'a2', 'started subagent bd317666afec47f4777c7ca701c1779e', { time: T0 + 45_000 }),
    ])
    const rows = screen.paneLines(140)
    expect(rows[0]).toBe('')
    expect(rows[1]).toContain('2 agents finished')
    expect(rows[1]).toContain('1m 30s')
    expect(rows[2]).toContain('├─ subagent · Survey tests')
    expect(rows[3]).toContain('└─ subagent · Map docs')
    // No live overlay on replay: no tool counts, no tokens.
    expect(rows[1]).not.toContain('tok')
  })

  it('clears a settled group at the next turn start', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    expect(rig.screen.paneLines(140)[1]).toContain('1 agents finished')
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(2), seq: 99, time: T0 + 10_000 })
    expect(rig.screen.paneLines(140)).toEqual([])
  })

  it('keeps a live-running group across the turn boundary, then clears once done', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    const child = childSession('9f5c4086a0674b55b621c3eaf8b88c0e')
    // The ack landed but the child still runs — the live overlay is the
    // authority, so the next turn start does not clear the pane.
    rig.ctx.emit('session/event', child, childTurnStart())
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(2), seq: 99, time: T0 + 10_000 })
    const running = rig.screen.paneLines(140).join('\n')
    expect(running).toContain('Running 1 agents')
    rig.ctx.emit('session/event', child, {
      type: 'turn/end', seq: 2, time: T0 + 30_000, data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(rig.screen.paneLines(140)[1]).toContain('1 agents finished')
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(3), seq: 100, time: T0 + 60_000 })
    expect(rig.screen.paneLines(140)).toEqual([])
  })

  it('overlays live child stats onto the pane card end-to-end', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey the tests', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    const child = childSession('9f5c4086a0674b55b621c3eaf8b88c0e')
    rig.ctx.emit('session/event', child, childTurnStart())
    rig.ctx.emit('session/event', child, {
      type: 'tool/call', seq: 2, time: T0 + 2_000,
      data: { turn: 1, step: 1, callId: 't1', name: 'read', arguments: '{}' },
    })
    rig.ctx.emit('session/event', child, {
      type: 'assistant/message', seq: 3, time: T0 + 3_000,
      data: {
        turn: 1, step: 1,
        message: { role: 'assistant', content: [] },
        usage: { inputTokens: 3000, outputTokens: 200 },
      },
    })
    const rows = rig.screen.paneLines(140)
    expect(rows[1]).toContain('Running 1 agents')
    expect(rows[2]).toContain('1 tool')
    expect(rows[2]).toContain('3.1k tok')
    expect(rows[3]).toContain('Using read')
    // The pending tick redraws through the card's requestRender nudge.
    const before = rig.screen.renderRequests.length
    fireTick?.()
    expect(rig.screen.renderRequests.length).toBeGreaterThan(before)
  })

  it('correlates a fork member through its delegation prompt', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'f1', 'subagent_fork', 'Map docs', 'map the docs', { time: T0 }),
      toolResultEvent(1, 1, 'f1', 'started background subagent job subagent-1', { time: T0 + 5_000 }),
    ])
    const child = childSession('9c3405b971ad4baf92203564fb4d27e4')
    rig.ctx.emit('session/event', child, {
      type: 'user/message', seq: 1, time: T0 + 1_000,
      data: {
        id: 'm1', role: 'user',
        content: [{ type: 'text', text: 'map the docs' }],
        source: { kind: 'user' },
      },
    })
    rig.ctx.emit('session/event', child, childTurnStart())
    expect(rig.screen.paneLines(140)[1]).toContain('Running 1 agents')
  })

  it('rebinds on session change, dropping the old group', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    expect(rig.screen.paneLines(140)[1]).toContain('1 agents finished')
    rig.ctx.emit('blue/session-changed', fakeAgent([]))
    expect(rig.screen.paneLines(140)).toEqual([])
  })

  it('forwards invalidate to the mounted card and unmounts with its fiber', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    const pane = rig.screen.bottomChildren[0]
    pane?.invalidate()
    // The invalidated card rebuilds its rows on the next render.
    expect(rig.screen.paneLines(140)[1]).toContain('1 agents finished')
    await rig.dispose()
    expect(rig.screen.bottomChildren).toHaveLength(0)
  })
})
