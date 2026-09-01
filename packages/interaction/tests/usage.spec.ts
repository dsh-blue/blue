/**
 * Unit tests for the `/usage` read layer: the 1024-base token formatting,
 * the percent/ratio/bar/severity family, and native projection-backed reads.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
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
/** A live native session and exact current-Agent service. */
async function sessionOver(): Promise<{ ctx: Context, session: Session, agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('usage-spec'))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  ctx.provide('blueCurrentAgent', {
    current: () => agent,
    revision: () => 0,
    subscribe: (listener: (current: Agent, revision: number) => void) => {
      listener(agent, 0)
      return () => {}
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

  it('sums all disjoint provider buckets', () => {
    expect(totalTokens({ input: 1, cacheRead: 2, cacheWrite: 3, output: 4 })).toBe(10)
  })
})

describe('readCompositionFacts', () => {
  it('reads the contextBreakdown projection when the key answers', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { contextBreakdown: { systemTokens: 10, toolsTokens: 20, messageTokens: 30 } } }),
    })
    expect(readCompositionFacts(ctx, agent)).toEqual({ system: 10, tools: 20, messages: 30 })
  })

  it('answers undefined when the native projection has no key', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) })
    expect(readCompositionFacts(ctx, agent)).toBeUndefined()
  })
})

describe('readUsageFacts', () => {
  it('reads the projection snapshot when the seam is composed', async () => {
    const { ctx, agent } = await sessionOver()
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
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { contextPressure: { pressureTokens: 4000 } } }),
    })
    const facts = readUsageFacts(ctx, agent)
    expect(facts.buckets).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    expect(facts.context).toEqual({ used: 4000 })
  })

  it('reports an empty context when the projection answers without one', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 } } }),
    })
    const facts = readUsageFacts(ctx, agent)
    expect(facts.context).toEqual({})
  })

  it('reports zeroed facts when native projections have no usage keys', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) })
    expect(readUsageFacts(ctx, agent).buckets).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
    expect(readUsageFacts(ctx, agent).context).toEqual({})
  })
})

describe('readTurnCounts', () => {
  it('reads the sessionStats projection when composed', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', {
      snapshot: () => ({ values: { sessionStats: { turns: 3, steps: 9, llmMs: 1, toolMs: 2, ttftMs: 3, ttftSteps: 4, decodeMs: 5, decodeTokens: 6 } } }),
    })
    expect(readTurnCounts(ctx, agent)).toEqual({ turns: 3, steps: 9 })
  })

  it('returns zero counts when the projection lacks the stats key', async () => {
    const { ctx, agent } = await sessionOver()
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) })
    expect(readTurnCounts(ctx, agent)).toEqual({ turns: 0, steps: 0 })
  })

  it('returns zeroed facts when no Agent is current', () => {
    const ctx = new Context()
    ctx.provide('blueCurrentAgent', { current: () => null } as never)
    ctx.provide('sessionProjections', { snapshot: () => ({ values: {} }) } as never)
    expect(readUsageFacts(ctx)).toEqual({
      buckets: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      context: {},
    })
    expect(readTurnCounts(ctx)).toEqual({ turns: 0, steps: 0 })
    expect(readCompositionFacts(ctx)).toBeUndefined()
  })
})
