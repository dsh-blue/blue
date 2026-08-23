import { describe, expect, it, vi } from 'vitest'
import { createDshRemoteWireClient, DshRemoteTransport } from '../src/wire-transport.ts'
import type { DshRemoteWireClient } from '../src/wire-transport.ts'
import type { MuxFrame } from '../src/wire-types.ts'

function fixture() {
  let handlers: { onMuxFrame(rpcId: string, frame: MuxFrame): void; onHostFrame(frame: unknown): void; onReopen(): void } | undefined
  const client: DshRemoteWireClient = {
    getTui: vi.fn(async () => ({ protocolVersion: 1, incarnation: 'i', pluginVersion: 'p' })),
    call: vi.fn(async (method: string) => method === 'session.list' ? { items: [{ sessionId: 's1', cwd: '/work', running: true, projections: { asOfSeq: 3 } }] } : { accepted: true }),
    respond: vi.fn(async () => true),
    start: vi.fn(value => { handlers = value }),
    stop: vi.fn(),
  }
  return { client, emit: (frame: MuxFrame) => handlers?.onMuxFrame('rpc', frame), touch: () => { handlers?.onHostFrame({}); handlers?.onReopen() } }
}

describe('DshRemoteTransport', () => {
  it('negotiates health, snapshots, maps events, and tears down streams', async () => {
    const f = fixture(); const transport = new DshRemoteTransport(f.client); const signal = new AbortController().signal
    await expect(transport.negotiate(signal)).resolves.toEqual({ protocol: '1', capabilities: ['session', 'action', 'projection', 'question', 'approval'] })
    await expect(transport.snapshot('s1', signal)).resolves.toMatchObject({ watermark: 3, value: { id: 's1', cwd: '/work', status: 'running' } })
    const seen: number[] = []; const off = transport.subscribe('s1', 3, event => seen.push(event.seq)); const second = transport.subscribe('s1', 3, () => undefined); f.touch(); f.emit({ type: 'session/event', sessionId: 'other', event: { type: 'turn/start', seq: 4 } }); f.emit({ type: 'session/subscribed', sessionId: 's1' }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/start', seq: 3 } }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'other', seq: 4 } }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 5 } }); expect(seen).toEqual([4, 5]); off(); second(); transport.dispose(); expect(f.client.stop).toHaveBeenCalledTimes(1)
  })
  it('handles protocol errors, aborts, writes, and question answers', async () => {
    const f = fixture(); const transport = new DshRemoteTransport(f.client); const aborted = new AbortController(); aborted.abort(); await expect(transport.negotiate(aborted.signal)).rejects.toThrow('Aborted')
    const bad = fixture(); vi.mocked(bad.client.getTui).mockResolvedValue({ protocolVersion: 3, incarnation: 'i', pluginVersion: 'p' }); await expect(new DshRemoteTransport(bad.client).negotiate(new AbortController().signal)).rejects.toThrow('unsupported')
    await expect(transport.snapshot('missing', new AbortController().signal)).resolves.toMatchObject({ watermark: -1, value: { id: 'missing' } }); await expect(transport.request('s1', { kind: 'followup', text: 'hello' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'steer', text: 'now' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).rejects.toThrow('not in protocol')
    await expect(transport.ask('s1', { rpcId: 'q', answer: ['a'] }, new AbortController().signal)).resolves.toEqual(['a']); await expect(transport.approve('s1', { rpcId: 'a', answer: 'yes' }, new AbortController().signal)).resolves.toBe('yes'); await expect(transport.ask('s1', {}, new AbortController().signal)).rejects.toThrow('rpcId'); const pre = new AbortController(); pre.abort(); await expect(transport.ask('s1', { rpcId: 'q' }, pre.signal)).rejects.toThrow('Aborted'); transport.dispose()
  })
  it('accepts the v2 health contract and maps writer lease RPCs', async () => {
    const f = fixture()
    vi.mocked(f.client.getTui).mockResolvedValue({ protocolVersion: 2, incarnation: 'i', pluginVersion: 'p', capabilities: ['session', 'writeLease', 'unknown'] })
    vi.mocked(f.client.call).mockImplementation(async (method: string) => method === 'lease.acquire' ? { leaseId: 'lease-1', fencingToken: 7, expiresAt: 100, sessionId: 's1', clientId: 'c', frontendInstanceId: 'f' } : method === 'lease.release' ? { released: true } : { accepted: true })
    const transport = new DshRemoteTransport(f.client)
    await expect(transport.negotiate(new AbortController().signal)).resolves.toEqual({ protocol: '2', capabilities: ['session', 'writeLease'] })
    await expect(transport.acquireWriteLease('s1', new AbortController().signal)).resolves.toMatchObject({ token: 'lease-1', leaseId: 'lease-1', fencingToken: 7 })
    await expect(transport.releaseWriteLease('s1', { token: 'lease-1', expiresAt: 100, leaseId: 'lease-1' })).resolves.toBeUndefined()
    expect(f.client.call).toHaveBeenCalledWith('lease.release', { sessionId: 's1', leaseId: 'lease-1' })
    transport.dispose()
    const fallback = fixture()
    vi.mocked(fallback.client.getTui).mockResolvedValue({ protocolVersion: 2, incarnation: 'i', pluginVersion: 'p', capabilities: ['writeLease'] })
    vi.mocked(fallback.client.call).mockResolvedValueOnce({ token: 'token-only', expiresAt: 20 }).mockResolvedValueOnce({ expiresAt: 21 }).mockResolvedValue({ released: true })
    const fallbackTransport = new DshRemoteTransport(fallback.client)
    await expect(fallbackTransport.acquireWriteLease('s1', new AbortController().signal)).resolves.toMatchObject({ token: 'token-only', expiresAt: 20 })
    await expect(fallbackTransport.acquireWriteLease('s1', new AbortController().signal)).resolves.toMatchObject({ token: '', expiresAt: 21 })
    await expect(fallbackTransport.releaseWriteLease('s1', { token: 'token-only', expiresAt: 20 })).resolves.toBeUndefined()
    fallbackTransport.dispose()
    const missingHealth = fixture()
    missingHealth.client.getTui = undefined
    await expect(new DshRemoteTransport(missingHealth.client).negotiate(new AbortController().signal)).rejects.toThrow('health negotiation')
  })
  it('probes the authenticated v2 system contract and consumes host event chunks', async () => {
    let released = false
    const chunks = [Buffer.from('data: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/start","seq":2}}}\n\n').toString('base64')]
    const client: DshRemoteWireClient = {
      call: vi.fn(async (method: string) => method === 'system.describe'
        ? { protocolVersion: 2, capabilities: ['tui-read-projection', 'async-agent-actions', 'host-events', 'writer-lease', 'question-bridge', 'approval-bridge', 'unknown'] }
        : { contractId: 'c', bridge: { major: 2, minor: 0 }, capabilities: ['session', 'action', 'projection', 'writeLease', 'question-bridge', 'approval-bridge'], abi: {}, limits: {} }),
      subscribeEvents: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<{ data: string }> { yield { data: chunks[0]! }; released = true } })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client, { acceptedAbis: [{ dshVersion: '0.1.0-rc.6' }], requiredCapabilities: ['session'] })
    await expect(transport.negotiate(new AbortController().signal)).resolves.toMatchObject({ protocol: '2', capabilities: expect.arrayContaining(['session', 'action', 'projection', 'question', 'approval', 'writeLease']) })
    const seen: number[] = []
    transport.subscribe('s1', 1, event => seen.push(event.seq))
    await vi.waitFor(() => expect(released).toBe(true))
    expect(seen).toEqual([2])
    expect(client.call).toHaveBeenCalledWith('system.negotiate', expect.objectContaining({ acceptedAbis: [{ dshVersion: '0.1.0-rc.6' }], requiredCapabilities: ['session'] }), expect.any(AbortSignal))
    await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).resolves.toBeUndefined()
    expect(client.call).toHaveBeenCalledWith('session.cancel', { sessionId: 's1' }, expect.any(AbortSignal))
    transport.dispose()
    const noRequired = new DshRemoteTransport(client, { acceptedAbis: [{ dshVersion: '0.1.0-rc.6' }] })
    await noRequired.negotiate(new AbortController().signal)
    noRequired.dispose()
  })
  it('supports the official host.events subscription shape and ignores malformed frames', async () => {
    let emitted = false
    const client: DshRemoteWireClient = {
      call: vi.fn(async () => ({ protocolVersion: 2, capabilities: ['session'] })),
      subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<{ data: string }> {
        yield { data: Buffer.from('data: not-json\ndata: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/end","seq":4}}}\n\n').toString('base64') }
        emitted = true
      } })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    await transport.negotiate(new AbortController().signal)
    const seen: number[] = []
    transport.subscribe('s1', 3, event => seen.push(event.seq))
    await vi.waitFor(() => expect(emitted).toBe(true))
    expect(seen).toEqual([4])
    expect(client.subscribe).toHaveBeenCalledWith('host.events.open', 'host.events.cancel', { kind: 'mux' })
    transport.dispose()

    let startHandlers: { onHostFrame(frame: unknown): void } | undefined
    const legacy: DshRemoteWireClient = {
      getTui: vi.fn(async () => ({ protocolVersion: 1 })),
      call: vi.fn(async () => ({ items: [] })),
      respond: vi.fn(async () => true),
      start: vi.fn(handlers => { startHandlers = handlers }),
      stop: vi.fn(),
    }
    const legacyTransport = new DshRemoteTransport(legacy)
    await legacyTransport.negotiate(new AbortController().signal)
    legacyTransport.subscribe('s1', -1, () => undefined)
    startHandlers?.onHostFrame(null as unknown as never)
    startHandlers?.onHostFrame({ data: 'not-an-object' })
    startHandlers?.onHostFrame({ payload: { payload: 'not-an-object' } })
    startHandlers?.onHostFrame({ payload: null })
    startHandlers?.onHostFrame({ payload: { type: 'not-session' } })
    legacyTransport.dispose()
  })
  it('stops an event stream when its listeners are removed', async () => {
    let release!: () => void
    const stream = new Promise<void>(resolve => { release = resolve })
    const client: DshRemoteWireClient = {
      call: vi.fn(async () => ({ protocolVersion: 2, capabilities: ['session'] })),
      subscribeEvents: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<{ data: string }> { await stream; yield { data: '' } } })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    await transport.negotiate(new AbortController().signal)
    const off = transport.subscribe('s1', 0, () => undefined)
    off()
    release()
    await Promise.resolve()
    transport.dispose()
  })
  it('adapts the official dsh-remote connection client without wire method guessing', async () => {
    let released = false
    let streamed = false
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['tui-read-projection', 'async-agent-actions', 'writer-lease'] },
      call: vi.fn(async () => ({ protocolVersion: 2 })),
      agents: {
        invoke: vi.fn(async (action: string) => action === 'session.list' ? { items: [{ sessionId: 's1', cwd: '/official', running: false, projections: { asOfSeq: 9 } }] } : undefined),
      },
      host: {
        subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          yield Buffer.from('data: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/end","seq":10}}}\n\n')
          streamed = true
        } })),
      },
      attach: vi.fn(async () => ({ release: async () => { released = true } })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    await expect(transport.negotiate(new AbortController().signal)).resolves.toMatchObject({ protocol: '2', capabilities: ['session', 'projection', 'action', 'writeLease'] })
    await expect(transport.snapshot('s1', new AbortController().signal)).resolves.toMatchObject({ watermark: 9, value: { cwd: '/official' } })
    const seen: number[] = []
    transport.subscribe('s1', 9, event => seen.push(event.seq))
    await vi.waitFor(() => expect(streamed).toBe(true))
    expect(seen).toEqual([10])
    await expect(transport.request('s1', { kind: 'followup', text: 'hello' }, new AbortController().signal)).resolves.toBeUndefined()
    await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).resolves.toBeUndefined()
    expect(client.agents.invoke).toHaveBeenCalledWith('session.cancel', { sessionId: 's1' }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await expect(transport.acquireWriteLease('s1', new AbortController().signal)).resolves.toMatchObject({ token: 'attachment:s1', sessionId: 's1' })
    await expect(transport.releaseWriteLease('s1', { token: 'attachment:s1', expiresAt: Number.POSITIVE_INFINITY, sessionId: 's1' })).resolves.toBeUndefined()
    expect(released).toBe(true)
    transport.dispose()
    const minimal = new DshRemoteTransport({ ...client, contract: {} })
    await expect(minimal.negotiate(new AbortController().signal)).resolves.toEqual({ protocol: '2', capabilities: [] })
    await minimal.acquireWriteLease('s1', new AbortController().signal)
    minimal.dispose()
  })
  it('drops a late official host event after unsubscribe', async () => {
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['session'] },
      call: vi.fn(async () => ({ protocolVersion: 2 })),
      host: { subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> { await waiting; yield Buffer.from('data: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/end","seq":2}}}\n\n') } })) },
      agents: { invoke: vi.fn(async () => undefined) },
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    await transport.negotiate(new AbortController().signal)
    const off = transport.subscribe('s1', 0, () => { throw new Error('late event') })
    off()
    release()
    await Promise.resolve()
    transport.dispose()
  })
  it('creates a narrow wire client facade for an official connection', async () => {
    const invoke = vi.fn(async () => undefined)
    const client = createDshRemoteWireClient({
      contract: { bridge: { major: 2, minor: 0 }, capabilities: [] },
      host: { subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {} })) },
      agents: { invoke },
    })
    expect(client.contract?.bridge?.major).toBe(2)
    await expect(client.call('session.list', {}, new AbortController().signal)).resolves.toBeUndefined()
    await expect(client.call('session.list', {})).resolves.toBeUndefined()
    await expect(client.respond('rpc-1', 'yes')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('respond', { rpcId: 'rpc-1', value: 'yes' })
    client.start({ onMuxFrame: () => undefined, onHostFrame: () => undefined, onReopen: () => undefined })
    client.stop()
  })
})
