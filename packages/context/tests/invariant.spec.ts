import { describe, expect, it, vi } from 'vitest'
import * as invariant from '../src/invariant.ts'
import { apply, contextPlugin, officialContextPlugin } from '../src/plugins.ts'
import { ContextFeature } from '../src/feature.ts'
describe('context invariant companion', () => { it('has a stable entry', () => { expect(invariant.name).toBe('blue-context-invariant'); expect(() => invariant.apply({} as never)).not.toThrow() }) })
describe('context plugin', () => {
  it('owns feature disposal in the Cordis fiber and mounts the gated official child', () => {
    const feature = new ContextFeature()
    const provided = new Map<string, unknown>()
    const cleanups: (() => void)[] = []
    const plugins: unknown[] = []
    const ctx = {
      provide: (key: string, value: unknown) => provided.set(key, value),
      effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) },
      plugin: (plugin: unknown) => plugins.push(plugin),
    } as never
    contextPlugin(feature).apply(ctx)
    contextPlugin().apply(ctx)
    apply(ctx)
    expect(provided.get('blueContextFeature')).toBeDefined()
    expect(plugins).toEqual([expect.objectContaining({ name: 'blue-context-official', inject: ['sessionProjections', 'blueSession'] })])
    for (const cleanup of cleanups) cleanup()
    feature.dispose()
  })

  it('attaches the official source to the current session and follows session changes', async () => {
    const sessions = { current: { id: 's1', session: { marker: 1 } } as unknown | null }
    const provided = new Map<string, unknown>()
    const cleanups: (() => void)[] = []
    let changed: ((session: unknown, key: string, value: unknown, seq: number) => void) | undefined
    let sessionChanged: ((agent: unknown) => void) | undefined
    const projections = {
      snapshot: (session: unknown) => ({ asOfSeq: 1, values: { tokenUsage: { uncachedInputTokens: session === (sessions.current as { session: unknown }).session ? 2 : 0, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
      onChanged: (listener: typeof changed) => { changed = listener; return () => { changed = undefined } },
    }
    const ctx = {
      get: (key: string) => key === 'sessionProjections' ? projections : sessions,
      provide: (key: string, value: unknown) => provided.set(key, value),
      effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) },
      on: (_event: string, listener: (agent: unknown) => void) => { sessionChanged = listener; return () => { sessionChanged = undefined } },
    } as never
    officialContextPlugin().apply(ctx)
    await vi.waitFor(() => expect((provided.get('blueContextFeature') as ContextFeature).snapshot).toBeDefined())
    const feature = provided.get('blueContextFeature') as ContextFeature
    expect(feature.snapshot).toMatchObject({ sessionId: 's1', facts: { input: 2 } })
    const next = { session: { id: 's2', marker: 2 } }
    sessions.current = next
    sessionChanged?.(next)
    await vi.waitFor(() => expect(feature.snapshot?.sessionId).toBe('s2'))
    expect(feature.snapshot).toMatchObject({ sessionId: 's2' })
    changed?.(next.session, 'tokenUsage', {}, 2)
    await Promise.resolve()
    expect(feature.snapshot?.watermark).toBe(2)
    const third = { session: { header: { id: 's3' }, marker: 3 } }
    sessions.current = third
    sessionChanged?.(third)
    await vi.waitFor(() => expect(feature.snapshot?.sessionId).toBe('s3'))
    await feature.attach('missing')
    sessionChanged?.({ id: 4, session: {} })
    expect(feature.snapshot).toBeUndefined()
    sessionChanged?.('invalid')
    sessions.current = null
    sessionChanged?.(null)
    expect(feature.snapshot).toBeUndefined()
    for (const cleanup of cleanups) cleanup()
  })

  it('stays inert before the first current session exists', () => {
    const cleanups: Array<() => void> = []
    const ctx = {
      get: (key: string) => key === 'sessionProjections'
        ? { snapshot: () => ({ asOfSeq: -1, values: {} }), onChanged: () => () => undefined }
        : { current: null },
      provide: () => undefined,
      effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) },
      on: () => () => undefined,
    } as never
    officialContextPlugin().apply(ctx)
    for (const cleanup of cleanups) cleanup()
  })
})
