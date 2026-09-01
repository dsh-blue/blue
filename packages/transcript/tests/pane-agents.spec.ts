/**
 * `blue-pane-agents` plugin: the S33 subagent pane. Covers the zero-row
 * empty render, spawn-call collection into the canonical pane, the settled
 * group clearing at the next turn start while a live-running group
 * persists, the resume snapshot rebuilding the settled card, the live
 * child-session overlay end-to-end, fork prompt correlation, and
 * session-change rebinding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as paneAgents from '../src/pane-agents.ts'
import {
  resetSeq,
  stepStart,
  toolCallEvent,
  subagentCallEvent,
  toolResultEvent,
  turnStart,
} from './helpers.ts'
import { bootPanePlugin, type PanePluginHarness } from './pane-fakes.ts'

/** The frozen wall clock the injected timers report. */
const T0 = 1_700_000_000_000

/** The parent session id the tracker admits children by. */
const PARENT = 'parent-1'

beforeEach(() => {
  paneAgents.setPaneAgentsClock(() => T0 + 6_000)
})

afterEach(() => {
  paneAgents.setPaneAgentsClock(undefined)
  vi.useRealTimers()
})

/** A fake agent whose session carries the id the admission keys match. */
function fakeAgent(events: SessionEvent[]): Agent {
  return {
    id: PARENT,
    session: { id: PARENT, events, header: {} },
  } as unknown as Agent
}

/** One harness with the pane booted, the clock frozen, the agent held. */
interface Rig extends PanePluginHarness {
  agent: Agent
}

async function boot(events: SessionEvent[] = []): Promise<Rig> {
  resetSeq()
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
    const { ctx, screen } = await boot()
    expect(screen.paneLines(80)).toEqual([])
    const entry = ctx.bluePanes.list().find(candidate => candidate.id === 'blue.pane.agents')
    expect(entry?.hidden).toBe(true)
    expect(entry?.contribution.render()).toBeNull()
  })

  it('covers fallback labels and bounded parent-call errors in the tree', async () => {
    const { screen } = await boot([
      turnStart(1),
      stepStart(1, 1),
      toolCallEvent(1, 1, 'failed-text', 'subagent', JSON.stringify({ description: 'Broken text' })),
      toolResultEvent(1, 1, 'failed-text', '\nactual failure', { isError: true, time: T0 + 1_000 }),
      toolCallEvent(1, 1, 'failed-empty', 'subagent', JSON.stringify({ description: 'Broken empty' })),
      toolResultEvent(1, 1, 'failed-empty', '\n ', { isError: true, time: T0 + 2_000 }),
      toolCallEvent(1, 1, 'same', 'subagent', JSON.stringify({ name: 'Same', description: 'Same' })),
      toolResultEvent(1, 1, 'same', 'done', { time: T0 + 3_000 }),
      toolCallEvent(1, 1, 'unnamed', 'subagent', ''),
    ])
    const text = screen.paneLines(140).join('\n')
    expect(text).toContain('failed Broken text')
    expect(text).toContain('Error: actual failure')
    expect(text).toContain('done Same')
    expect(text).toContain('running subagent')
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
    expect(rows.join('\n')).toContain('running Survey')
    expect(rows.join('\n')).not.toContain('bash')
    // No ack yet: the turn boundary keeps the pending group (a member
    // without a result is not settled).
    rig.ctx.emit('session/event', rig.agent.session, { ...turnStart(2), seq: 99, time: T0 + 10_000 })
    expect(rig.screen.paneLines(140).join('\n')).toContain('running Survey')
  })

  it('survives result shapes without text and unparsable spawn arguments', async () => {
    const rig = await boot()
    const agent = fakeAgent([turnStart(1)])
    rig.ctx.emit('test/session-changed', agent)
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
    expect(rig.screen.paneLines(140).join('\n')).toContain('running subagent')
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
    expect(rig.screen.paneLines(140).join('\n')).toContain('done subagent')
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
    expect(rig.screen.paneLines(140).join('\n')).toContain('2 agents finished')
  })

  it('boots without an agent and survives a malformed result event', async () => {
    const harness = await bootPanePlugin(paneAgents, null)
    expect(harness.screen.paneLines(80)).toEqual([])
    // A result event without a toolCallId block pairs nothing and throws
    // nothing (the pane's defensive guard).
    const agent = fakeAgent([turnStart(1)])
    harness.ctx.emit('test/session-changed', agent)
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
    const text = rows.join('\n')
    expect(rows[0]).toBe('─'.repeat(140))
    expect(rows[1]).toBe('✓ 2 agents finished · 1m 30s')
    expect(rows[2]).toContain('├─ done Survey tests')
    expect(rows[3]).toContain('└─ done Map docs')
    expect(text).toContain('done Survey tests')
    expect(text).toContain('done Map docs')
    // No live projection on replay: no tool counts or tokens.
    expect(text).not.toContain('tools')
    expect(text).not.toContain('tokens')
  })

  it('clears a settled group at the next turn start', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    expect(rig.screen.paneLines(140).join('\n')).toContain('done Survey')
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
    expect(running).toContain('running Survey')
    rig.ctx.emit('session/event', child, {
      type: 'turn/end', seq: 2, time: T0 + 30_000, data: { turn: 1, reason: { kind: 'completed' } },
    })
    expect(rig.screen.paneLines(140).join('\n')).toContain('done Survey')
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
    const text = rows.join('\n')
    expect(text).toContain('running Survey')
    expect(text).toContain('1 tool')
    expect(text).toContain('3200 tokens')
    expect(text).toContain('Using read')
  })

  it('holds a fresh waiting phase as running for one second, then reveals it', async () => {
    vi.useFakeTimers()
    let now = T0
    paneAgents.setPaneAgentsClock(() => now)
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Queued', 'queue', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    const child = childSession('9f5c4086a0674b55b621c3eaf8b88c0e')
    rig.ctx.emit('session/event', child, childTurnStart())
    expect(rig.screen.paneLines(140).join('\n')).toContain('running Queued')
    now += 1_000
    vi.advanceTimersByTime(1_000)
    expect(rig.screen.paneLines(140).join('\n')).toContain('waiting Queued')
    rig.ctx.emit('session/event', child, {
      type: 'tool/call', seq: 2, time: T0 + 2_000,
      data: { turn: 1, step: 1, callId: 't1', name: 'read', arguments: '{}' },
    })
    expect(rig.screen.paneLines(140).join('\n')).toContain('running Queued')
    await rig.dispose()

    const pending = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Pending', 'pending', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    pending.ctx.emit('session/event', child, childTurnStart())
    pending.screen.paneLines(140)
    const next = fakeAgent([])
    ;(next as unknown as { id: string }).id = 'parent-next'
    pending.ctx.emit('test/session-changed', next)
    await pending.dispose()

    const unloading = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Unloading', 'unloading', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    unloading.ctx.emit('session/event', child, childTurnStart())
    expect(unloading.screen.paneLines(140).join('\n')).toContain('running Unloading')
    await unloading.dispose()
  })

  it('shows distinct agent detail and a failed live child phase', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      {
        type: 'tool/call', seq: 3, time: T0,
        data: {
          turn: 1,
          step: 1,
          callId: 'a1',
          name: 'subagent',
          arguments: JSON.stringify({ name: 'Worker', description: 'Survey tests', prompt: 'survey' }),
        },
      } as SessionEvent<'tool/call'>,
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    const child = childSession('9f5c4086a0674b55b621c3eaf8b88c0e')
    rig.ctx.emit('session/event', child, childTurnStart())
    rig.ctx.emit('session/event', child, {
      type: 'turn/end',
      seq: 2,
      time: T0 + 2_000,
      data: { turn: 1, reason: { kind: 'error', error: { message: 'failed' } } },
    })
    const text = rig.screen.paneLines(140).join('\n')
    expect(text).toContain('failed Worker · Survey tests')
    expect(text).toContain('Error: Failed')
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
    expect(rig.screen.paneLines(140).join('\n')).toContain('running Map docs')
  })

  it('rebinds on session change, dropping the old group', async () => {
    const rig = await boot([
      turnStart(1),
      stepStart(1, 1),
      subagentCallEvent(1, 1, 'a1', 'subagent', 'Survey', 'survey', { time: T0 }),
      toolResultEvent(1, 1, 'a1', 'started subagent 9f5c4086a0674b55b621c3eaf8b88c0e', { time: T0 + 5_000 }),
    ])
    expect(rig.screen.paneLines(140).join('\n')).toContain('done Survey')
    const next = fakeAgent([])
    ;(next as unknown as { id: string }).id = 'parent-2'
    ;(next.session as unknown as { id: string }).id = 'parent-2'
    rig.ctx.emit('test/session-changed', next)
    expect(rig.screen.paneLines(140)).toEqual([])
  })

  it('ignores bindings without a string session id', async () => {
    const rig = await boot()
    rig.ctx.emit('test/session-binding-changed', { session: { id: 42 } })
    rig.ctx.emit('test/session-binding-changed', undefined as never)
    expect(rig.screen.paneLines(80)).toEqual([])
    await rig.dispose()
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
    expect(rig.screen.paneLines(140).join('\n')).toContain('done Survey')
    await rig.dispose()
    expect(rig.screen.bottomChildren).toHaveLength(0)
  })
})
