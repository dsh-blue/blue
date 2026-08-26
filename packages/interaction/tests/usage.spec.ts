/**
 * Unit tests for the `/usage` read layer: the 1024-base token formatting,
 * the percent/ratio/bar/severity family, the fallback fold's
 * replace-per-step semantics, and the projection-backed reads (snapshot
 * present vs. the degraded host's fallback) plus the turn/step counts.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { MessageId, type AssistantMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  CONTEXT_BAR_WIDTH,
  formatTokens,
  ratioSeverity,
  readCompositionFacts,
  readTurnCounts,
  readUsageFacts,
  renderBar,
  totalTokens,
  usagePercent,
  usageRatio,
} from '../src/usage.ts'
import {
  foldSessionTokenBuckets as foldTokenBuckets,
  sessionDetails,
} from '../../app/src/session-details.ts'

let messageSeq = 0

/** A minimal assistant message over text content. */
function assistantMessage(): AssistantMessage {
  messageSeq += 1
  return {
    id: MessageId(`m-${String(messageSeq)}`),
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'model', provider: 'mock', model: 'mock' },
  }
}

interface UsageSample { inputTokens: number, outputTokens: number, cacheReadTokens?: number, cacheWriteTokens?: number }

/** An `assistant/message` event carrying one usage sample. */
function usageMessage(turn: number, step: number, usage: UsageSample): SessionEvent<'assistant/message'> {
  return {
    type: 'assistant/message',
    seq: -1,
    time: 0,
    data: { turn, step, message: assistantMessage(), usage },
  }
}

/** An `assistant/chunk` usage event (the streaming sample). */
function usageChunk(turn: number, step: number, usage: UsageSample): SessionEvent<'assistant/chunk'> {
  return {
    type: 'assistant/chunk',
    seq: -1,
    time: 0,
    data: { turn, step, chunk: { type: 'usage', usage } },
  }
}

/** A turn/step boundary pair around the sample events of one step. */
function step(turn: number, stepNumber: number): [SessionEvent<'turn/start'>, SessionEvent<'step/start'>, SessionEvent<'step/end'>, SessionEvent<'turn/end'>] {
  return [
    { type: 'turn/start', seq: -1, time: 0, data: { turn } },
    { type: 'step/start', seq: -1, time: 0, data: { turn, step: stepNumber } },
    { type: 'step/end', seq: -1, time: 0, data: { turn, step: stepNumber } },
    { type: 'turn/end', seq: -1, time: 0, data: { turn, reason: { kind: 'completed' } } },
  ]
}

/** A live session over the given events (seqs renumbered by the store). */
async function sessionOver(events: readonly SessionEvent[]): Promise<{ ctx: Context, session: Session, agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('usage-spec'))
  for (const event of events) {
    // Surface-eligible events carry their append marker, exactly as the
    // agent loop passes it.
    session.append(event.type, event.data, event.type === 'assistant/message' ? { surfaceOp: 'append' } : undefined)
  }
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  ctx.provide('blueSessionActions', {
    sessionDetails: () => {
      const projections = ctx.get('sessionProjections') as unknown as {
        snapshot(session: unknown): { values: Readonly<Record<string, unknown>> }
      } | undefined
      return sessionDetails(agent, undefined, projections?.snapshot(session).values)
    },
  } as never)
  return { ctx, session, agent }
}

describe('formatTokens', () => {
  it('formats the sub-1024 count as a plain integer', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(512)).toBe('512')
  })

  it('formats k above 1024 with one decimal, rounded at 100k', () => {
    expect(formatTokens(1536)).toBe('1.5k')
    expect(formatTokens(1024)).toBe('1k')
    expect(formatTokens(262144)).toBe('256k')
    expect(formatTokens(99942)).toBe('97.6k')
    expect(formatTokens(100352)).toBe('98k')
  })

  it('formats M above 1 MiB and degrades non-finite or negative input to 0', () => {
    expect(formatTokens(1024 * 1024)).toBe('1M')
    expect(formatTokens(1.5 * 1024 * 1024)).toBe('1.5M')
    expect(formatTokens(Number.NaN)).toBe('0')
    expect(formatTokens(-5)).toBe('0')
  })
})

describe('usagePercent / usageRatio', () => {
  it('rounds the share up, clamps to [0, 100], and floors a non-zero share at 1', () => {
    expect(usagePercent(1, 8192)).toBe(1)
    expect(usagePercent(4096, 8192)).toBe(50)
    expect(usagePercent(8192, 8192)).toBe(100)
    expect(usagePercent(9000, 8192)).toBe(100)
  })

  it('reports 0 for non-positive or non-finite inputs', () => {
    expect(usagePercent(0, 8192)).toBe(0)
    expect(usagePercent(10, 0)).toBe(0)
    expect(usagePercent(Number.NaN, 8192)).toBe(0)
    expect(usageRatio(-1, 8192)).toBe(0)
  })

  it('clamps the ratio to [0, 1]', () => {
    expect(usageRatio(4096, 8192)).toBe(0.5)
    expect(usageRatio(16384, 8192)).toBe(1)
  })
})

describe('renderBar / ratioSeverity', () => {
  it('renders the filled/empty bar at the requested width', () => {
    expect(renderBar(0.5, 4)).toBe('██░░')
    expect(renderBar(0, 3)).toBe('░░░')
    expect(renderBar(1, 3)).toBe('███')
    expect(renderBar(2, 3)).toBe('███')
  })

  it('defaults to the shared context-bar width', () => {
    expect(renderBar(1).length).toBe(CONTEXT_BAR_WIDTH)
  })

  it('maps the ratio onto the kimi severity thresholds', () => {
    expect(ratioSeverity(0.49)).toBe('ok')
    expect(ratioSeverity(0.5)).toBe('warn')
    expect(ratioSeverity(0.84)).toBe('warn')
    expect(ratioSeverity(0.85)).toBe('danger')
  })
})

describe('readCompositionFacts', () => {
  it('reads the contextBreakdown projection when the key answers', async () => {
    const { ctx, agent } = await sessionOver([])
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { contextBreakdown: { systemTokens: 10, toolsTokens: 20, messageTokens: 30 } } }),
    })
    expect(readCompositionFacts(ctx, agent)).toEqual({ system: 10, tools: 20, messages: 30 })
  })

  it('answers undefined without the seam or without the key', async () => {
    const { ctx, agent } = await sessionOver([])
    expect(readCompositionFacts(ctx, agent)).toBeUndefined()
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) })
    expect(readCompositionFacts(ctx, agent)).toBeUndefined()
  })
})

describe('foldTokenBuckets', () => {
  it('sums the disjoint buckets of distinct steps', () => {
    const [a] = step(0, 0)
    const [, , c, d] = step(0, 0)
    const [e, f, g, h] = step(1, 0)
    const events = [
      a, usageMessage(0, 0, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }),
      c, d,
      e, f, usageMessage(1, 0, { inputTokens: 20, outputTokens: 2, cacheWriteTokens: 7 }), g, h,
    ]
    expect(foldTokenBuckets(events)).toEqual({ input: 30, cacheRead: 100, cacheWrite: 7, output: 7 })
    expect(totalTokens(foldTokenBuckets(events))).toBe(144)
  })

  it('replaces a step re-report instead of double counting it', () => {
    const events = [
      usageChunk(0, 0, { inputTokens: 10, outputTokens: 5 }),
      usageMessage(0, 0, { inputTokens: 10, outputTokens: 5 }),
      usageMessage(0, 0, { inputTokens: 12, outputTokens: 6 }),
    ]
    expect(foldTokenBuckets(events)).toEqual({ input: 12, cacheRead: 0, cacheWrite: 0, output: 6 })
  })

  it('folds an empty log to zeros and skips non-usage events', () => {
    expect(foldTokenBuckets([])).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    const [a, b, c, d] = step(0, 0)
    expect(foldTokenBuckets([a, b, c, d])).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  })
})

describe('readUsageFacts', () => {
  it('reads the projection snapshot when the seam is composed', async () => {
    const { ctx, agent } = await sessionOver([])
    ctx.provide('sessionProjections', {
      snapshot: () => ({
        values: {
          tokenUsage: {
            uncachedInputTokens: 30, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 7,
          },
          contextPressure: { projectedTokens: 4224, pressureTokens: 4000, contextWindow: 8192 },
        },
      }),
    })
    const facts = readUsageFacts(ctx, agent)
    expect(facts.buckets).toEqual({ input: 30, cacheRead: 100, cacheWrite: 7, output: 7 })
    expect(facts.context).toEqual({ used: 4224, window: 8192 })
  })

  it('falls back from projectedTokens to pressureTokens and to absent fields', async () => {
    const { ctx, agent } = await sessionOver([])
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { contextPressure: { pressureTokens: 4000 } } }),
    })
    const facts = readUsageFacts(ctx, agent)
    expect(facts.buckets).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    expect(facts.context).toEqual({ used: 4000 })
  })

  it('reports an empty context when the projection answers without one', async () => {
    const { ctx, agent } = await sessionOver([])
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } } }),
    })
    const facts = readUsageFacts(ctx, agent)
    expect(facts.context).toEqual({})
  })

  it('folds the assistant records and the durable request context without the seam', async () => {
    const [a, b, c, d] = step(0, 0)
    const [e, f, g, h] = step(1, 0)
    const { ctx, agent } = await sessionOver([
      { type: 'request/context', seq: -1, time: 0, data: { provider: 'mock', model: 'mock', contextWindow: 8192 } },
      a, b, usageMessage(0, 0, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 }), c, d,
      e, f, usageMessage(1, 0, { inputTokens: 5, outputTokens: 1 }), g, h,
    ])
    const facts = readUsageFacts(ctx, agent)
    expect(facts.buckets).toEqual({ input: 15, cacheRead: 100, cacheWrite: 0, output: 6 })
    // The last reported request's input side is the occupancy numerator.
    expect(facts.context).toEqual({ used: 5, window: 8192 })
  })

  it('carries the window alone when no usage was reported yet', async () => {
    const { ctx, agent } = await sessionOver([
      { type: 'request/context', seq: -1, time: 0, data: { provider: 'mock', model: 'mock', contextWindow: 8192 } },
    ])
    const facts = readUsageFacts(ctx, agent)
    expect(facts.buckets).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    expect(facts.context).toEqual({ window: 8192 })
  })

  it('reports absent context facts when nothing advertised or reported', async () => {
    const { ctx, agent } = await sessionOver([])
    expect(readUsageFacts(ctx, agent).context).toEqual({})
  })
})

describe('readTurnCounts', () => {
  it('reads the sessionStats projection when composed', async () => {
    const { ctx, agent } = await sessionOver([])
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { sessionStats: { turns: 3, steps: 9, llmMs: 1, toolMs: 2, ttftMs: 3, ttftSteps: 4, decodeMs: 5, decodeTokens: 6 } } }),
    })
    expect(readTurnCounts(ctx, agent)).toEqual({ turns: 3, steps: 9 })
  })

  it('counts the durable boundary events without the seam', async () => {
    const [a, b, c, d] = step(0, 0)
    const [e, f, g, h] = step(1, 0)
    const [i, j, k, l] = step(2, 0)
    const { ctx, agent } = await sessionOver([a, b, c, d, e, f, g, h, i, j, k, l])
    expect(readTurnCounts(ctx, agent)).toEqual({ turns: 3, steps: 3 })
  })

  it('counts the boundary events when the projection lacks the stats key', async () => {
    const [a, b, c, d] = step(0, 0)
    const { ctx, agent } = await sessionOver([a, b, c, d])
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) })
    expect(readTurnCounts(ctx, agent)).toEqual({ turns: 1, steps: 1 })
  })

  it('returns zeroed facts when no current session details exist', () => {
    const ctx = new Context()
    ctx.provide('blueSessionActions', { sessionDetails: () => undefined } as never)
    expect(readUsageFacts(ctx)).toEqual({
      buckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      context: {},
    })
    expect(readTurnCounts(ctx)).toEqual({ turns: 0, steps: 0 })
  })
})
