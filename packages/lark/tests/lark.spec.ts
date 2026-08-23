/**
 * HTTP, operation, notification, and Fiber lifecycle coverage for blue-lark.
 *
 * @module @dsh-blue/blue-lark/tests
 */
import { describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { NotificationModel } from '@dsh-blue/blue-frontend'
import { LARK_OPERATION_RETENTION, LARK_SETTINGS_PATH, LarkAdapter, LarkRouteUnavailableError, LarkSettingsClient, apply, inject, name, type LarkFetch } from '../src/index.ts'
import * as invariant from '../src/invariant.ts'

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function notifications() {
  const models = new Map<string, NotificationModel>()
  return { models, sink: { push: (model: NotificationModel) => { models.set(model.id, model); return () => { models.delete(model.id) } } } }
}

describe('LarkSettingsClient', () => {
  it('reads only minimal redacted facts and retries with expectedRevision', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetcher: LarkFetch = async (input, init) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
      return init?.method === 'POST'
        ? json({ revision: 8, settings: { appId: 'ignored' }, credential: { configured: true, source: 'store', writable: true }, runtime: { state: 'connected' } })
        : json({ revision: 7, settings: { appId: 'ignored' }, credential: { configured: false }, runtime: { state: 'error', message: 'offline' } })
    }
    const client = new LarkSettingsClient('http://127.0.0.1:7000', fetcher)
    await expect(client.describe(new AbortController().signal)).resolves.toEqual({ revision: 7, credential: { configured: false }, runtime: { state: 'error', message: 'offline' } })
    await expect(client.retry(new AbortController().signal)).resolves.toEqual({ revision: 8, credential: { configured: true, source: 'store', writable: true }, runtime: { state: 'connected' } })
    expect(calls[0]?.url).toBe(`http://127.0.0.1:7000${LARK_SETTINGS_PATH}`)
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({ expectedRevision: 7 })
    expect(calls[2]?.init?.headers).toMatchObject({ origin: 'http://127.0.0.1:7000' })
  })

  it('rejects absent routes, failed responses, and malformed payloads', async () => {
    const absent = new LarkSettingsClient()
    await expect(absent.describe(new AbortController().signal)).rejects.toBeInstanceOf(LarkRouteUnavailableError)
    await expect(absent.retry(new AbortController().signal)).rejects.toBeInstanceOf(LarkRouteUnavailableError)
    const failed = new LarkSettingsClient('http://127.0.0.1:1', async () => json({ error: 'route down' }, 400))
    await expect(failed.describe(new AbortController().signal)).rejects.toThrow('route down')
    const statusOnly = new LarkSettingsClient('http://127.0.0.1:1', async () => json({}, 500))
    await expect(statusOnly.describe(new AbortController().signal)).rejects.toThrow('(500)')
    for (const value of [null, [], {}, { revision: -1 }, { revision: 1.5 }]) {
      const invalid = new LarkSettingsClient('http://127.0.0.1:1', async () => json(value))
      await expect(invalid.describe(new AbortController().signal)).rejects.toThrow('invalid Lark settings response')
    }
    const sparse = new LarkSettingsClient('http://127.0.0.1:1', async () => json({ revision: 0, credential: { configured: 'yes' }, runtime: { state: 1 } }))
    await expect(sparse.describe(new AbortController().signal)).resolves.toEqual({ revision: 0 })
  })
})

describe('LarkAdapter', () => {
  it('deduplicates operation ids and projects success/error/retry notification states', async () => {
    const fixture = notifications()
    let calls = 0
    const client = new LarkSettingsClient('http://127.0.0.1:1', async (_input, init) => {
      calls += 1
      return json(init?.method === 'POST'
        ? { revision: 2, credential: { configured: true }, runtime: { state: 'connected' } }
        : { revision: 1, credential: { configured: false }, runtime: { state: 'error', message: 'disconnected' } })
    })
    const adapter = new LarkAdapter(client, fixture.sink)
    const first = adapter.execute('same', 'status')
    const duplicate = adapter.execute('same', 'retry')
    expect(duplicate).toBe(first)
    await expect(first).resolves.toMatchObject({ kind: 'success', text: 'Lark: error; credential missing; revision 1; disconnected' })
    expect(fixture.models.get('lark.operation.same')?.severity).toBe('error')
    await expect(adapter.execute('retry', 'retry')).resolves.toMatchObject({ kind: 'success', text: 'Lark: connected; credential configured; revision 2' })
    expect(calls).toBe(3)
    expect(fixture.models.get('lark.operation.retry')?.severity).toBe('success')
    expect(LARK_OPERATION_RETENTION).toBe(100)
  })

  it('uses route-absent warning and ordinary failure notifications', async () => {
    const fixture = notifications()
    const absent = new LarkAdapter(new LarkSettingsClient(), fixture.sink)
    await expect(absent.execute('absent', 'status')).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('domain plugin remains active') })
    expect(fixture.models.get('lark.operation.absent')?.severity).toBe('warning')
    const failed = new LarkAdapter(new LarkSettingsClient('http://127.0.0.1:1', async () => { throw 'network down' }), fixture.sink)
    await expect(failed.execute('failed', 'status')).resolves.toEqual({ kind: 'error', text: 'network down' })
    expect(fixture.models.get('lark.operation.failed')?.severity).toBe('error')
  })

  it('aborts caller work, rejects late unload results, and caps retained operations', async () => {
    const fixture = notifications()
    let settle: ((response: Response) => void) | undefined
    const delayed = new LarkSettingsClient('http://127.0.0.1:1', (_input, init) => new Promise((resolve, reject) => {
      settle = resolve
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const adapter = new LarkAdapter(delayed, fixture.sink, { retention: 1 })
    const caller = new AbortController()
    const aborted = adapter.execute('aborted', 'status', caller.signal)
    caller.abort()
    await expect(aborted).resolves.toEqual({ kind: 'error', text: 'Lark request aborted' })
    expect(fixture.models.has('lark.operation.aborted')).toBe(false)
    const late = adapter.execute('late', 'status')
    adapter.dispose()
    settle?.(json({ revision: 1, runtime: { state: 'connected' } }))
    await expect(late).resolves.toEqual({ kind: 'error', text: 'Lark adapter unloaded before the request completed' })
    await expect(adapter.execute('after', 'status')).resolves.toEqual({ kind: 'error', text: 'Lark adapter is unloaded' })
    adapter.dispose()
    expect(fixture.models.size).toBe(0)

    const immediate = new LarkAdapter(new LarkSettingsClient('http://127.0.0.1:1', async () => json({ revision: 1 })), fixture.sink, { retention: 1 })
    await immediate.execute('one', 'status')
    await immediate.execute('two', 'status')
    expect(fixture.models.has('lark.operation.one')).toBe(false)
    expect(fixture.models.get('lark.operation.two')?.severity).toBe('info')
  })

  it('forwards pre-aborted signals and rejects a late success after unload', async () => {
    const fixture = notifications()
    const preAborted = new AbortController()
    preAborted.abort('already cancelled')
    const observesAbort = new LarkAdapter(new LarkSettingsClient('http://127.0.0.1:1', async (_input, init) => {
      expect(init?.signal?.aborted).toBe(true)
      throw new Error('cancelled')
    }), fixture.sink)
    await expect(observesAbort.execute('pre-aborted', 'status', preAborted.signal)).resolves.toEqual({ kind: 'error', text: 'Lark request aborted' })

    let settle: ((response: Response) => void) | undefined
    const ignoresAbort = new LarkAdapter(new LarkSettingsClient('http://127.0.0.1:1', () => new Promise(resolve => { settle = resolve })), fixture.sink)
    const late = ignoresAbort.execute('late-success', 'status')
    ignoresAbort.dispose()
    settle?.(json({ revision: 1, runtime: { state: 'connected' } }))
    await expect(late).resolves.toEqual({ kind: 'error', text: 'Lark adapter unloaded before the request completed' })
  })

  it('aborts an in-flight retention eviction without disturbing a reused id', async () => {
    const fixture = notifications()
    const pending: { resolve(response: Response): void }[] = []
    const client = new LarkSettingsClient('http://127.0.0.1:1', (_input, init) => new Promise((resolve, reject) => {
      const index = pending.length
      pending.push({ resolve })
      if (index === 1) init?.signal?.addEventListener('abort', () => reject(new Error('evicted')), { once: true })
    }))
    const adapter = new LarkAdapter(client, fixture.sink, { retention: 1 })
    const evicted = adapter.execute('reused', 'status')
    const current = adapter.execute('current', 'status')
    pending[0]?.resolve(json({ revision: 1, runtime: { state: 'connected' } }))
    await expect(evicted).resolves.toEqual({ kind: 'error', text: 'Lark request was superseded' })
    const reused = adapter.execute('reused', 'status')
    await expect(current).resolves.toEqual({ kind: 'error', text: 'Lark request was superseded' })
    pending[2]?.resolve(json({ revision: 3, runtime: { state: 'connected' } }))
    await expect(reused).resolves.toMatchObject({ kind: 'success', text: expect.stringContaining('revision 3') })
    expect(fixture.models.has('lark.operation.current')).toBe(false)
    expect(fixture.models.get('lark.operation.reused')?.severity).toBe('success')
  })
})

describe('Lark plugin entries', () => {
  it('registers the official command with route-absent fallback and Fiber cleanup', async () => {
    let definition: { handler(invocation: { commandId: string; rawInput: string; signal: AbortSignal }): CommandResult | Promise<CommandResult> } | undefined
    const cleanups: (() => void)[] = []
    const ctx = {
      get: () => undefined,
      blueNotifications: notifications().sink,
      commands: { register: (value: typeof definition) => { definition = value; return () => { definition = undefined } } },
      effect: (effect: () => () => void) => { cleanups.push(effect()) },
    } as never
    apply(ctx)
    await expect(definition?.handler({ commandId: 'status', rawInput: '', signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'error', text: expect.stringContaining('unavailable') })
    await expect(definition?.handler({ commandId: 'retry', rawInput: 'retry', signal: new AbortController().signal })).resolves.toMatchObject({ kind: 'error' })
    expect(definition?.handler({ commandId: 'bad', rawInput: 'delete', signal: new AbortController().signal })).toEqual({ kind: 'error', text: 'usage: /lark [status|retry]' })
    for (const cleanup of cleanups) cleanup()
    expect(definition).toBeUndefined()
    expect(name).toBe('blue-lark')
    expect(inject).toEqual(['commands', 'blueNotifications'])
  })

  it('uses the official webServer port when present and ships an invariant companion', () => {
    const register = vi.fn(() => () => undefined)
    const effects: (() => void)[] = []
    apply({ get: () => ({ port: 8123 }), blueNotifications: notifications().sink, commands: { register }, effect: (effect: () => () => void) => { effects.push(effect()) } } as never)
    expect(register).toHaveBeenCalledOnce()
    for (const cleanup of effects) cleanup()
    expect(invariant.name).toBe('blue-lark-invariant')
    expect(() => invariant.apply({} as never)).not.toThrow()
  })
})
