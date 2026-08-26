import { describe, expect, it, vi } from 'vitest'
import { OfficialContextSource, officialContextEvent, type OfficialSessionProjectionService } from '../src/official-source.ts'

const timeline = {
  ok: true,
  model: 'deepseek-chat',
  provider: 'deepseek',
  current: { system: 10, tools: 20, user: 30, inject: 4, assistant: 50, tool: 6, total: 120 },
  requests: [
    { turn: 1, step: 2, time: 100, seq: 8, system: 10, tools: 20, user: 30, inject: 4, assistant: 50, tool: 6, total: 120, prompt: 110, output: 10 },
    { turn: -1, time: 'bad', seq: 2, total: 1 },
  ],
  events: [
    { seq: 1, time: 10, kind: 'compaction', count: 2 },
    { seq: 2, time: 20, kind: 'prune', tokens: 4 },
    { seq: 3, time: 30, kind: 'inject', name: 'AGENTS.md', form: 'instructions' },
    { seq: 4, time: 40, kind: 'model', from: 'old', to: 'new' },
    { seq: 5.5, time: 50, kind: 'unknown' },
  ],
  nodes: [],
  droppedNodes: 3,
  images: 2,
}

function values() {
  return {
    tokenUsage: { uncachedInputTokens: 100, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 4 },
    contextPressure: { pressureTokens: 140, projectedTokens: 150, contextWindow: 1000 },
    contextBreakdown: { systemTokens: 10, toolsTokens: 20, messageTokens: 90 },
    contextTimeline: timeline,
  }
}

function fixture(initial = values(), initialSeq = 8) {
  let state: Readonly<Record<string, unknown>> = initial
  let seq = initialSeq
  let currentSessionId: string | undefined = 's1'
  let changed: ((key: string, value: unknown, seq: number) => void) | undefined
  const off = vi.fn()
  const service: OfficialSessionProjectionService = {
    currentMany: vi.fn(keys => currentSessionId === undefined ? undefined : {
      asOfSeq: seq,
      values: Object.fromEntries(keys.map(key => [key, state[key]])),
    }),
    subscribe: vi.fn(listener => { changed = listener; return off }),
  }
  return {
    service,
    off,
    current: () => currentSessionId,
    setSession(sessionId: string | undefined) { currentSessionId = sessionId },
    set(next: Readonly<Record<string, unknown>>, nextSeq: number) { state = next; seq = nextSeq },
    emit(key: string, eventSeq: number) { changed?.(key, state[key], eventSeq) },
  }
}

describe('official context projection mapping', () => {
  it('maps all official projection keys and narrows the timeline payload', () => {
    expect(officialContextEvent(values())).toEqual({
      type: 'official',
      official: {
        complete: true,
        usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 4 },
        pressure: { projectedTokens: 150, pressureTokens: 140, contextWindow: 1000 },
        breakdown: { system: 10, tools: 20, messages: 90 },
        timeline: {
          model: 'deepseek-chat',
          provider: 'deepseek',
          current: timeline.current,
          requests: [{ turn: 1, step: 2, time: 100, seq: 8, total: 120, prompt: 110, output: 10 }],
          events: timeline.events.slice(0, 4),
          droppedNodes: 3,
          images: 2,
        },
      },
    })
  })

  it('degrades malformed keys independently and accepts partial official values', () => {
    expect(officialContextEvent({})).toBeUndefined()
    expect(officialContextEvent({ contextTimeline: [] })).toBeUndefined()
    expect(officialContextEvent({ contextPressure: {} })).toBeUndefined()
    expect(officialContextEvent({
      tokenUsage: { uncachedInputTokens: -1, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3 },
      contextPressure: { projectedTokens: Number.NaN, pressureTokens: 2 },
      contextBreakdown: { systemTokens: 1, toolsTokens: 'bad', messageTokens: 3 },
      contextTimeline: { current: null },
    })).toEqual({ type: 'official', official: { complete: true, pressure: { pressureTokens: 2 } } })
    expect(officialContextEvent({ contextPressure: { contextWindow: 2048 } })).toEqual({ type: 'official', official: { complete: true, pressure: { contextWindow: 2048 } } })
    expect(officialContextEvent({ contextBreakdown: { systemTokens: 1, toolsTokens: 2, messageTokens: 3 } })).toEqual({ type: 'official', official: { complete: true, breakdown: { system: 1, tools: 2, messages: 3 } } })
    expect(officialContextEvent({
      contextTimeline: {
        current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 21 },
        requests: 'bad', events: null, droppedNodes: 1.5, images: -1,
      },
    })).toMatchObject({ official: { timeline: { requests: [], events: [], droppedNodes: 0, images: 0 } } })
    expect(officialContextEvent({
      contextTimeline: {
        model: 4,
        provider: false,
        current: { system: -1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 20 },
      },
    })).toBeUndefined()
    expect(officialContextEvent({
      contextTimeline: {
        current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 21 },
        requests: [null, { time: 1, seq: 2, total: 3 }],
        events: [null, { seq: 2, time: 3, kind: 'inject' }],
      },
    })).toMatchObject({ official: { timeline: { requests: [{ time: 1, seq: 2, total: 3 }], events: [{ seq: 2, time: 3, kind: 'inject' }] } } })
  })
})

describe('OfficialContextSource', () => {
  it('closes the baseline/subscribe gap and coalesces same-seq key changes', async () => {
    const f = fixture()
    const source = new OfficialContextSource(f.service, f.current)
    const baseline = await source.snapshot('s1', new AbortController().signal)
    expect(baseline).toMatchObject({ watermark: 8, events: [{ type: 'official' }] })

    f.set({ ...values(), contextPressure: { pressureTokens: 200, contextWindow: 1000 } }, 9)
    f.emit('contextPressure', 9)
    f.emit('tokenUsage', 9)
    await Promise.resolve()
    const accepted: Array<{ seq: number; sessionId: string }> = []
    const off = source.subscribe('s1', 8, event => accepted.push(event))
    expect(accepted.map(({ seq, sessionId }) => ({ seq, sessionId }))).toEqual([{ seq: 9, sessionId: 's1' }])
    expect(f.service.currentMany).toHaveBeenCalledTimes(2)

    f.set(values(), 11)
    f.emit('sessionStats', 10)
    f.emit('contextTimeline', 10)
    f.emit('contextBreakdown', 11)
    await Promise.resolve()
    expect(accepted.at(-1)?.seq).toBe(11)
    expect(accepted).toHaveLength(2)

    off()
    f.set(values(), 12)
    f.emit('tokenUsage', 12)
    await Promise.resolve()
    f.set(values(), 13)
    f.emit('tokenUsage', 13)
    await Promise.resolve()
    f.set(values(), 11)
    f.emit('tokenUsage', 11)
    await Promise.resolve()
    const skipped: number[] = []
    source.subscribe('s1', 13, event => skipped.push(event.seq))()
    expect(skipped).toEqual([])
    source.dispose()
    source.dispose()
    expect(f.off).toHaveBeenCalledOnce()
  })

  it('filters listeners by watermark, ignores inactive sessions, and drops late work after dispose', async () => {
    const f = fixture()
    const source = new OfficialContextSource(f.service, f.current)
    await source.snapshot('s1', new AbortController().signal)
    const low: number[] = []
    const high: number[] = []
    source.subscribe('s1', 8, event => low.push(event.seq))
    source.subscribe('s1', 20, event => high.push(event.seq))
    source.subscribe('s1', 30, () => undefined)()
    f.set(values(), 10)
    f.setSession('s2')
    f.emit('tokenUsage', 10)
    f.setSession('s1')
    f.emit('tokenUsage', 10)
    await Promise.resolve()
    expect(low).toEqual([10])
    expect(high).toEqual([])

    f.set({}, 11)
    f.emit('tokenUsage', 11)
    await Promise.resolve()
    expect(low).toEqual([10])
    f.set(values(), 12)
    f.emit('tokenUsage', 12)
    source.dispose()
    await Promise.resolve()
    f.emit('tokenUsage', 13)
    await Promise.resolve()
    expect(low).toEqual([10])
  })

  it('does not publish a new session cut from a microtask queued for the previous session', async () => {
    const f = fixture()
    const source = new OfficialContextSource(f.service, f.current)
    await source.snapshot('s1', new AbortController().signal)
    const first: number[] = []
    source.subscribe('s1', 8, event => first.push(event.seq))
    f.set({ ...values(), contextPressure: { pressureTokens: 900 } }, 9)
    f.emit('contextPressure', 9)

    f.setSession('s2')
    f.set({ ...values(), contextPressure: { pressureTokens: 20 } }, 1)
    await source.snapshot('s2', new AbortController().signal)
    await Promise.resolve()
    expect(first).toEqual([])

    const second: number[] = []
    source.subscribe('s2', 1, event => second.push(event.seq))
    f.set(values(), 2)
    f.emit('tokenUsage', 2)
    await Promise.resolve()
    expect(second).toEqual([2])
    source.dispose()
  })

  it('rejects aborted and unavailable attaches and serves an empty projection cut', async () => {
    const f = fixture({}, -1)
    const source = new OfficialContextSource(f.service, f.current)
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.snapshot('s1', aborted.signal)).rejects.toThrow('aborted')
    await expect(source.snapshot('missing', new AbortController().signal)).rejects.toThrow('unavailable')
    await expect(source.snapshot('s1', new AbortController().signal)).resolves.toEqual({ watermark: -1, events: [] })
    f.setSession(undefined)
    await expect(source.snapshot('s1', new AbortController().signal)).rejects.toThrow('unavailable')
    source.dispose()
  })

  it('rejects a missing or stale consistent cut after the initial session check', async () => {
    const missing = fixture()
    missing.service.currentMany = vi.fn(() => undefined)
    const missingSource = new OfficialContextSource(missing.service, missing.current)
    await expect(missingSource.snapshot('s1', new AbortController().signal)).rejects.toThrow('unavailable')
    missingSource.dispose()

    const stale = fixture()
    stale.service.currentMany = vi.fn(() => {
      stale.setSession('s2')
      return { asOfSeq: 1, values: {} }
    })
    const staleSource = new OfficialContextSource(stale.service, stale.current)
    await expect(staleSource.snapshot('s1', new AbortController().signal)).rejects.toThrow('unavailable')
    staleSource.dispose()
  })

  it('drops scheduled cuts when the session changes or the refreshed cut disappears', async () => {
    const changed = fixture()
    const changedSource = new OfficialContextSource(changed.service, changed.current)
    await changedSource.snapshot('s1', new AbortController().signal)
    changed.emit('tokenUsage', 9)
    changed.setSession('s2')
    await Promise.resolve()
    changedSource.dispose()

    const missing = fixture()
    const missingSource = new OfficialContextSource(missing.service, missing.current)
    await missingSource.snapshot('s1', new AbortController().signal)
    missing.service.currentMany = vi.fn(() => undefined)
    missing.emit('tokenUsage', 9)
    await Promise.resolve()
    missingSource.dispose()

    const stale = fixture()
    const staleSource = new OfficialContextSource(stale.service, stale.current)
    await staleSource.snapshot('s1', new AbortController().signal)
    stale.service.currentMany = vi.fn(() => {
      stale.setSession('s2')
      return { asOfSeq: 9, values: values() }
    })
    stale.emit('tokenUsage', 9)
    await Promise.resolve()
    staleSource.dispose()
  })
})
