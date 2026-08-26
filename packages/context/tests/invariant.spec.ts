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
    expect(plugins).toEqual([expect.objectContaining({ name: 'blue-context-official', inject: ['blueSessionProjections', 'blueSessionReader'] })])
    for (const cleanup of cleanups) cleanup()
    feature.dispose()
  })

  it('attaches the official source to the current session and follows session changes', async () => {
    let current: { readonly id: string; readonly cwd: string; readonly status: 'idle'; readonly mode: 'normal' } | null = { id: 's1', cwd: '/one', status: 'idle', mode: 'normal' }
    const provided = new Map<string, unknown>()
    const cleanups: (() => void)[] = []
    let changed: ((key: string, value: unknown, seq: number) => void) | undefined
    let sessionChanged: ((session: typeof current) => void) | undefined
    let sessionDisposed = false
    const projections = {
      currentMany: (keys: readonly string[]) => current === null ? undefined : {
        asOfSeq: 1,
        values: Object.fromEntries(keys.map(key => [key, key === 'tokenUsage' ? { uncachedInputTokens: current?.id === 's1' ? 2 : 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } : undefined])),
      },
      subscribe: (listener: typeof changed) => { changed = listener; return () => { changed = undefined } },
    }
    const reader = {
      current: () => current,
      subscribe: (listener: typeof sessionChanged) => {
        sessionChanged = listener
        listener?.(current)
        return {
          get disposed() { return sessionDisposed },
          dispose() { sessionDisposed = true; sessionChanged = undefined },
        }
      },
    }
    const ctx = {
      blueSessionProjections: projections,
      blueSessionReader: reader,
      provide: (key: string, value: unknown) => provided.set(key, value),
      effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) },
    } as never
    officialContextPlugin().apply(ctx)
    await vi.waitFor(() => expect((provided.get('blueContextFeature') as ContextFeature).snapshot).toBeDefined())
    const feature = provided.get('blueContextFeature') as ContextFeature
    expect(feature.snapshot).toMatchObject({ sessionId: 's1', facts: { input: 2 } })
    const next = { id: 's2', cwd: '/two', status: 'idle', mode: 'normal' } as const
    current = next
    sessionChanged?.(next)
    await vi.waitFor(() => expect(feature.snapshot?.sessionId).toBe('s2'))
    expect(feature.snapshot).toMatchObject({ sessionId: 's2' })
    changed?.('tokenUsage', {}, 2)
    await Promise.resolve()
    expect(feature.snapshot?.watermark).toBe(2)
    const third = { id: 's3', cwd: '/three', status: 'idle', mode: 'normal' } as const
    current = third
    sessionChanged?.(third)
    await vi.waitFor(() => expect(feature.snapshot?.sessionId).toBe('s3'))
    await feature.attach('missing')
    expect(feature.snapshot).toBeUndefined()
    current = null
    sessionChanged?.(null)
    expect(feature.snapshot).toBeUndefined()
    for (const cleanup of cleanups) cleanup()
    expect(sessionDisposed).toBe(true)
    expect(changed).toBeUndefined()
  })

  it('stays inert before the first current session exists', () => {
    const cleanups: Array<() => void> = []
    let disposed = false
    const ctx = {
      blueSessionProjections: { currentMany: () => undefined, subscribe: () => () => undefined },
      blueSessionReader: {
        current: () => null,
        subscribe: (listener: (session: null) => void) => {
          listener(null)
          return { get disposed() { return disposed }, dispose() { disposed = true } }
        },
      },
      provide: () => undefined,
      effect: (effect: () => () => void) => { cleanups.push(effect()); return cleanups.at(-1) },
    } as never
    officialContextPlugin().apply(ctx)
    for (const cleanup of cleanups) cleanup()
    expect(disposed).toBe(true)
  })
})
