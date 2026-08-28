import { describe, expect, it } from 'vitest'
import { ContextFeature } from '../src/feature.ts'
import { applyContextEvent, ContextProjection, initialContextState } from '../src/projection.ts'
import { buildContextModel, contextCommand, contextPercent, formatContextTokens } from '../src/model.ts'
import type { ContextEvent, ContextSource } from '../src/types.ts'

function eventSource(events: readonly ContextEvent[]): { readonly source: ContextSource; emit(event: ContextEvent, seq: number, sessionId?: string): void } { let listener: ((event: { seq: number; sessionId: string; event: ContextEvent }) => void) | undefined; return { source: { capabilities: ['refresh'], snapshot: async () => ({ watermark: events.length, events }), subscribe: (_id, _seq, next) => { listener = next; return () => { listener = undefined } }, refresh: async () => undefined }, emit: (event, seq, sessionId = 's1') => listener?.({ event, seq, sessionId }) } }

describe('context projection', () => {
  it('replays usage with replace-per-step semantics and pressure/breakdown', () => { let state = initialContextState(); state = applyContextEvent(state, { type: 'usage', usage: { turn: 1, step: 1, inputTokens: 10, outputTokens: 2 } }); state = applyContextEvent(state, { type: 'usage', usage: { turn: 1, step: 1, inputTokens: 20, outputTokens: 3, cacheReadTokens: 4 } }); state = applyContextEvent(state, { type: 'pressure', projectedTokens: 100, pressureTokens: 20, contextWindow: 200 }); state = applyContextEvent(state, { type: 'pressure', pressureTokens: 40 }); state = applyContextEvent(state, { type: 'pressure' }); state = applyContextEvent(state, { type: 'breakdown', systemTokens: 2, toolsTokens: 3, messageTokens: 4 }); expect(state.usage).toEqual({ input: 20, output: 3, cacheRead: 4, cacheWrite: 0, used: 40, window: 200, breakdown: { system: 2, tools: 3, messages: 4 } }); expect(applyContextEvent(state, { type: 'breakdown' })).toBe(state) })
  it('applies official whole-value cuts without losing optional projections', () => {
    const timeline = { current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 21 }, requests: [], events: [], droppedNodes: 0, images: 0 }
    let state = applyContextEvent(initialContextState(), { type: 'official', official: { usage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4 }, pressure: { pressureTokens: 20, contextWindow: 100 }, breakdown: { system: 1, tools: 2, messages: 3 }, timeline } })
    expect(state.usage).toEqual({ input: 10, output: 2, cacheRead: 3, cacheWrite: 4, used: 20, window: 100, breakdown: { system: 1, tools: 2, messages: 3 }, timeline })
    state = applyContextEvent(state, { type: 'official', official: { pressure: { projectedTokens: 30 } } })
    expect(state.usage.used).toBe(30)
    state = applyContextEvent(state, { type: 'official', official: { usage: { input: 11, output: 3, cacheRead: 4, cacheWrite: 5 } } })
    expect(state.usage).toMatchObject({ input: 11, output: 3, cacheRead: 4, cacheWrite: 5, used: 30, timeline })
    state = applyContextEvent(state, { type: 'official', official: { complete: true, usage: { input: 10, output: 2, cacheRead: 3, cacheWrite: 4 }, pressure: { pressureTokens: 20, contextWindow: 100 }, breakdown: { system: 1, tools: 2, messages: 3 }, timeline } })
    expect(state.usage).toEqual({ input: 10, output: 2, cacheRead: 3, cacheWrite: 4, used: 20, window: 100, breakdown: { system: 1, tools: 2, messages: 3 }, timeline })
    state = applyContextEvent(state, { type: 'official', official: { complete: true, pressure: {} } })
    expect(state.usage).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
    expect(applyContextEvent(state, { type: 'official' })).toBe(state)
  })
  it('formats pressure safely and builds optional sections', () => { expect(formatContextTokens(-1)).toBe('0'); expect(formatContextTokens(1024)).toBe('1k'); expect(formatContextTokens(102400)).toBe('100k'); expect(formatContextTokens(1048576)).toBe('1M'); expect(contextPercent(undefined, 10)).toBeUndefined(); expect(contextPercent(1, 10)).toBe(10); expect(contextPercent(100, 10)).toBe(100); const snapshot = { sessionId: 's1', watermark: 4, facts: { input: 10, output: 2, cacheRead: 3, cacheWrite: 1, used: 5, window: 10, breakdown: { system: 1, tools: 2, messages: 3 } } } as const; const model = buildContextModel(snapshot); expect(model.panel.title).toBe('Context'); expect(model.panel.node).toMatchObject({ kind: 'stack' }); expect(model.status.views[0]).toMatchObject({ kind: 'text', text: 'context 50%' }); expect(contextCommand('s1').action).toEqual({ kind: 'context.open', sessionId: 's1' }); expect(buildContextModel(snapshot, 'loading').panel.node).toMatchObject({ kind: 'stack' }); expect(buildContextModel(snapshot, 'empty').status.views[0]).toMatchObject({ text: 'no context data' }); expect(buildContextModel(snapshot, 'absent').panel.node).toMatchObject({ kind: 'stack' }); expect(buildContextModel(snapshot, 'error', 'down')).toMatchObject({ state: 'error', error: 'down' }); expect(buildContextModel(snapshot, 'error').status.views[0]).toMatchObject({ text: 'context error: request failed' }) })
  it('builds timeline sections and omits refresh for push-only official projections', () => {
    const snapshot = { sessionId: 's1', watermark: 9, facts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timeline: { model: 'm', provider: 'p', current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 21 }, requests: [{ turn: 1, step: 2, time: 1, seq: 8, total: 21 }], events: [{ seq: 3, time: 1, kind: 'model', from: 'a', to: 'b' }, { seq: 4, time: 2, kind: 'inject', name: 'rules' }, { seq: 5, time: 3, kind: 'prune', tokens: 2 }, { seq: 6, time: 4, kind: 'compaction', count: 3 }], droppedNodes: 2, images: 1 } } } as const
    const model = buildContextModel(snapshot, 'ready', undefined, false)
    expect(model.panel.refresh).toBeUndefined()
    expect(model.status.capabilities).toContain('context.timeline')
    expect(model.status.views[0]).toMatchObject({ text: 'context · 1 requests' })
    expect(model.panel.node).toMatchObject({ kind: 'stack' })
    const sparseTimeline = { current: { system: 1, tools: 2, user: 3, inject: 4, assistant: 5, tool: 6, total: 21 }, requests: [], events: [], droppedNodes: 0, images: 0 } as const
    const sparse = buildContextModel({ sessionId: 's2', watermark: 1, facts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timeline: sparseTimeline } })
    expect(sparse.status.views[0]).toMatchObject({ text: 'context · 0 requests' })
    const noProvider = buildContextModel({ sessionId: 's2b', watermark: 1, facts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timeline: { ...sparseTimeline, model: 'm' } } })
    expect(noProvider.panel.node).toMatchObject({ kind: 'stack' })
    const fallbackEvents = buildContextModel({ sessionId: 's3', watermark: 8, facts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, timeline: { ...sparseTimeline, requests: [{ time: 1, seq: 1, total: 2 }], events: [{ seq: 1, time: 1, kind: 'model' }, { seq: 2, time: 2, kind: 'inject', form: 'rules' }, { seq: 3, time: 3, kind: 'inject' }, { seq: 4, time: 4, kind: 'prune' }, { seq: 5, time: 5, kind: 'compaction' }] } } })
    expect(fallbackEvents.panel.node).toMatchObject({ kind: 'stack' })
  })
})

describe('ContextFeature', () => {
  it('attaches, emits a headless model, accepts incremental events and unloads', async () => { const fixture = eventSource([{ type: 'usage', usage: { turn: 1, step: 1, inputTokens: 10, outputTokens: 2 } }, { type: 'pressure', pressureTokens: 20, contextWindow: 100 }]); const feature = new ContextFeature(fixture.source); const models: unknown[] = []; const off = feature.subscribe(model => models.push(model)); expect(feature.model).toBeUndefined(); expect(feature.command).toBeUndefined(); await expect(feature.attach('s1')).resolves.toMatchObject({ ok: true }); expect(feature.model?.panel.title).toBe('Context'); expect(feature.snapshot?.facts.used).toBe(20); fixture.emit({ type: 'usage', usage: { turn: 1, step: 2, inputTokens: 4, outputTokens: 1 } }, 3); expect(feature.snapshot?.watermark).toBe(3); expect(feature.snapshot?.facts.input).toBe(14); fixture.emit({ type: 'usage', usage: { turn: 1, step: 2, inputTokens: 40, outputTokens: 5 } }, 3); expect(feature.snapshot?.facts.input).toBe(14); expect(feature.command?.action.kind).toBe('context.open'); await expect(feature.execute({ kind: 'context.open', sessionId: 's1' })).resolves.toMatchObject({ ok: true }); await expect(feature.execute({ kind: 'context.refresh', sessionId: 's1' })).resolves.toMatchObject({ ok: true }); off(); feature.detach(); expect(feature.snapshot).toBeUndefined(); feature.dispose(); expect(models.length).toBeGreaterThan(0) })
  it('publishes empty and absent models during attach and refresh', async () => {
    const empty = new ContextFeature({ capabilities: ['refresh'], snapshot: async () => ({ watermark: 0, events: [] }), subscribe: () => () => undefined, refresh: async () => undefined })
    await empty.attach('empty')
    expect(empty.model?.state).toBe('empty')
    await empty.execute({ kind: 'context.refresh', sessionId: 'empty' })
    expect(empty.model?.state).toBe('empty')
    empty.dispose()
    const unavailable = new ContextFeature()
    await unavailable.attach('missing')
    expect(unavailable.model?.state).toBe('absent')
    unavailable.dispose()
  })
  it('returns absent and session fallback when source/capability is unavailable', async () => { const feature = new ContextFeature(); await expect(feature.attach('s1')).resolves.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT' }); await expect(feature.execute({ kind: 'context.refresh', sessionId: 'other' })).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' }); feature.detach(); feature.dispose() })
  it('rejects an action for another attached session', async () => { const feature = new ContextFeature(eventSource([]).source); await feature.attach('s1'); await expect(feature.execute({ kind: 'context.refresh', sessionId: 'other' })).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' }); feature.dispose() })
  it('supports direct projection listeners and clears late snapshots on detach', async () => { const projection = new ContextProjection(eventSource([{ type: 'usage', usage: { turn: 1, step: 1, inputTokens: 1, outputTokens: 1 } }]).source); const snapshots: number[] = []; await projection.attach('s1'); const off = projection.subscribe(snapshot => snapshots.push(snapshot.watermark)); expect(snapshots.at(-1)).toBe(1); off(); projection.detach(); (projection as unknown as { emit(): void }).emit(); projection.dispose() })
  it('maps refresh capability absence and source errors to structured results', async () => {
    const absent = new ContextFeature({ snapshot: async () => ({ watermark: 0, events: [] }), subscribe: () => () => undefined, capabilities: [] })
    await absent.attach('s1')
    await expect(absent.execute({ kind: 'context.refresh', sessionId: 's1' })).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED' })
    absent.dispose()
    const failing = new ContextFeature({ capabilities: ['refresh'], snapshot: async () => ({ watermark: 0, events: [] }), subscribe: () => () => undefined, refresh: async () => { throw 'refresh down' } })
    await failing.attach('s1')
    await expect(failing.execute({ kind: 'context.refresh', sessionId: 's1' })).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED', message: 'refresh down' })
    await expect(failing.execute({ kind: 'context.open', sessionId: 'other' })).resolves.toMatchObject({ ok: true })
    failing.dispose()
  })
  it('maps projection refresh failures and unavailable attach state', async () => {
    const projection = new ContextProjection({ capabilities: ['refresh'], snapshot: async () => { throw new Error('snapshot down') }, subscribe: () => () => undefined, refresh: async () => undefined })
    await expect(projection.attach('s1')).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED', message: 'snapshot down' })
    await expect(projection.refresh(new AbortController().signal)).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    const refreshError = new ContextProjection({ capabilities: ['refresh'], snapshot: async () => ({ watermark: 0, events: [] }), subscribe: () => () => undefined, refresh: async () => { throw new Error('refresh down') } })
    await refreshError.attach('s1')
    await expect(refreshError.refresh(new AbortController().signal)).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED', message: 'refresh down' })
    refreshError.dispose()
    const noSource = new ContextProjection()
    await expect(noSource.refresh(new AbortController().signal)).resolves.toMatchObject({ code: 'BLUE_SESSION_UNAVAILABLE' })
    noSource.dispose()
  })
  it('renders a projection snapshot with the default ready state', async () => {
    const fixture = eventSource([{ type: 'usage', usage: { turn: 1, step: 1, inputTokens: 1, outputTokens: 1 } }])
    const feature = new ContextFeature(fixture.source)
    await feature.projection.attach('s1')
    expect(feature.model?.state).toBe('ready')
    feature.dispose()
  })
  it('publishes ordinary attach failures as error models', async () => {
    const feature = new ContextFeature({
      capabilities: ['context'],
      snapshot: async () => { throw new Error('context down') },
      subscribe: () => () => undefined,
    })
    await expect(feature.attach('s1')).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED', message: 'context down' })
    expect(feature.model).toMatchObject({ state: 'error', error: 'context down' })
    feature.dispose()
  })
  it('maps refresh capability absence to an error model', async () => {
    const feature = new ContextFeature({
      capabilities: ['context'],
      snapshot: async () => ({ watermark: 0, events: [] }),
      subscribe: () => () => undefined,
    })
    await feature.attach('s1')
    await expect(feature.execute({ kind: 'context.refresh', sessionId: 's1' })).resolves.toMatchObject({ code: 'BLUE_ACTION_REJECTED', message: expect.stringContaining('refresh') })
    expect(feature.model?.state).toBe('error')
    feature.dispose()
  })
})
