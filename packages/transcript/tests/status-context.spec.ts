/**
 * `blue-status-context` plugin: the context-occupancy footer entry. Covers
 * the snapshot-then-subscribe attach, the disjoint input-side token sum, the
 * compact `k` formatting boundaries, live `session/event` increments, and
 * session-change rebinding.
 */

import { describe, expect, it } from 'vitest'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import * as context from '../src/status-context.ts'
import { assistantEvent, reasoningDelta, resetSeq, userEvent } from './helpers.ts'
import { asAgent, bootStatusPlugin, fakeAgent } from './status-fakes.ts'

/** An `assistant/message` event carrying token accounting. */
function usageEvent(turn: number, step: number, usage: TokenUsage): SessionEvent<'assistant/message'> {
  const base = assistantEvent(turn, step, [{ type: 'text', text: 'answer' }])
  return { ...base, data: { ...base.data, usage } }
}

describe('contextTokens and formatTokens', () => {
  it('sums the disjoint input-side counts only', () => {
    expect(context.contextTokens({ inputTokens: 100, outputTokens: 50 })).toBe(100)
    expect(context.contextTokens({
      inputTokens: 100,
      outputTokens: 999,
      cacheReadTokens: 900,
      cacheWriteTokens: 200,
      reasoningTokens: 42,
    })).toBe(1200)
  })

  it('formats plain below 1000 and one-decimal k at or above it', () => {
    expect(context.formatTokens(0)).toBe('0')
    expect(context.formatTokens(999)).toBe('999')
    expect(context.formatTokens(1000)).toBe('1.0k')
    expect(context.formatTokens(12300)).toBe('12.3k')
  })
})

describe('blue-status-context', () => {
  it('renders nothing without a session or without usage data', async () => {
    const noSession = await bootStatusPlugin(context)
    expect(noSession.entry.render(80)).toBe('')
    expect(noSession.entry.id).toBe('blue.status.context')
    expect(noSession.entry.priority).toBe(20)
    await noSession.dispose()

    resetSeq()
    const noUsage = await bootStatusPlugin(context, fakeAgent([userEvent('hi')]))
    expect(noUsage.entry.render(80)).toBe('')
    await noUsage.dispose()
  })

  it('reads the latest step occupancy from the snapshot', async () => {
    resetSeq()
    const agent = fakeAgent([
      userEvent('hi'),
      usageEvent(1, 1, { inputTokens: 1000, outputTokens: 10 }),
      usageEvent(1, 2, { inputTokens: 11000, outputTokens: 10, cacheReadTokens: 1300 }),
      reasoningDelta(1, 3, 'thinking'),
    ])
    const harness = await bootStatusPlugin(context, agent)
    expect(harness.entry.render(80)).toBe('ctx 12.3k')
    await harness.dispose()
  })

  it('tracks live increments on the attached session only', async () => {
    resetSeq()
    const agent = fakeAgent([usageEvent(1, 1, { inputTokens: 999, outputTokens: 1 })])
    const { ctx, screen, entry, dispose } = await bootStatusPlugin(context, agent)
    expect(entry.render(80)).toBe('ctx 999')
    const baseline = screen.renderRequests.length

    // Events from another session and usage-less finalizes are ignored.
    const other = fakeAgent([])
    ctx.emit('session/event', other.session as unknown as Session, usageEvent(2, 1, { inputTokens: 5, outputTokens: 1 }))
    ctx.emit('session/event', agent.session as unknown as Session, userEvent('no accounting here'))
    ctx.emit('session/event', agent.session as unknown as Session, assistantEvent(1, 2, [{ type: 'text', text: 'no usage' }]))
    expect(entry.render(80)).toBe('ctx 999')
    expect(screen.renderRequests.length).toBe(baseline)

    ctx.emit('session/event', agent.session as unknown as Session, usageEvent(1, 3, { inputTokens: 1500, outputTokens: 1 }))
    expect(entry.render(80)).toBe('ctx 1.5k')
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // A restated occupancy requests no redraw.
    ctx.emit('session/event', agent.session as unknown as Session, usageEvent(1, 4, { inputTokens: 1500, outputTokens: 1 }))
    expect(screen.renderRequests.length).toBe(baseline + 1)
    await dispose()
  })

  it('rebinds on blue/session-changed and goes quiet on a usage-less session', async () => {
    resetSeq()
    const first = fakeAgent([usageEvent(1, 1, { inputTokens: 500, outputTokens: 1 })])
    const { ctx, screen, entry, dispose } = await bootStatusPlugin(context, first)
    expect(entry.render(80)).toBe('ctx 500')

    resetSeq()
    const second = fakeAgent([userEvent('fresh')])
    const baseline = screen.renderRequests.length
    ctx.emit('blue/session-changed', asAgent(second))
    expect(entry.render(80)).toBe('')
    expect(screen.renderRequests.length).toBe(baseline + 1)

    // The stale subscription to the first session stays inert.
    ctx.emit('session/event', first.session as unknown as Session, usageEvent(2, 1, { inputTokens: 9000, outputTokens: 1 }))
    expect(entry.render(80)).toBe('')

    ctx.emit('session/event', second.session as unknown as Session, usageEvent(1, 1, { inputTokens: 42, outputTokens: 1 }))
    expect(entry.render(80)).toBe('ctx 42')
    await dispose()
  })

  it('honors the width budget for its ASCII-only text', async () => {
    resetSeq()
    const agent = fakeAgent([usageEvent(1, 1, { inputTokens: 999, outputTokens: 1 })])
    const harness = await bootStatusPlugin(context, agent)
    expect(harness.entry.render(7)).toBe('ctx 999')
    expect(harness.entry.render(6)).toBe('')
    await harness.dispose()
  })

  it('unregisters the entry when the fiber unloads', async () => {
    const harness = await bootStatusPlugin(context, fakeAgent([]))
    expect(harness.registry.entries).toHaveLength(1)
    await harness.dispose()
    expect(harness.registry.entries).toHaveLength(0)
  })
})
