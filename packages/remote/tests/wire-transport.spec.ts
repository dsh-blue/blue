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
    await expect(transport.snapshot('s1', signal)).resolves.toMatchObject({ watermark: 3, value: { sessionEpoch: 0, id: 's1', cwd: '/work', status: 'running' } })
    const seen: number[] = []; const off = transport.subscribe('s1', 3, event => seen.push(event.seq)); const second = transport.subscribe('s1', 3, () => undefined); f.touch(); f.emit({ type: 'session/event', sessionId: 'other', event: { type: 'turn/start', seq: 4 } }); f.emit({ type: 'session/subscribed', sessionId: 's1' }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/start', seq: 3 } }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'other', seq: 4 } }); f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 5 } }); expect(seen).toEqual([4, 5])
    vi.mocked(f.client.call).mockResolvedValue({ items: [{ sessionId: 's1', cwd: '/fresh', running: true, projections: { asOfSeq: 10 } }] })
    await expect(transport.snapshot('s1', signal)).resolves.toMatchObject({ watermark: 10, value: { revision: 3, cwd: '/fresh', status: 'running' } })
    f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 11 } })
    await expect(transport.snapshot('s1', signal)).resolves.toMatchObject({ watermark: 11, value: { revision: 4, status: 'idle' } })
    off(); second(); transport.detach('s1')
    f.emit({ type: 'session/event', sessionId: 's1', event: { type: 'turn/end', seq: 12 } })
    await expect(transport.snapshot('s1', signal)).resolves.toMatchObject({ watermark: 10, value: { revision: 0, sessionEpoch: 1, status: 'running' } })
    transport.dispose(); expect(f.client.stop).toHaveBeenCalledTimes(2)
  })
  it('handles protocol errors, aborts, writes, and question answers', async () => {
    const f = fixture(); const transport = new DshRemoteTransport(f.client); const aborted = new AbortController(); aborted.abort(); await expect(transport.negotiate(aborted.signal)).rejects.toThrow('Aborted')
    const bad = fixture(); vi.mocked(bad.client.getTui).mockResolvedValue({ protocolVersion: 3, incarnation: 'i', pluginVersion: 'p' }); await expect(new DshRemoteTransport(bad.client).negotiate(new AbortController().signal)).rejects.toThrow('unsupported')
    await expect(transport.snapshot('missing', new AbortController().signal)).resolves.toMatchObject({ watermark: -1, value: { id: 'missing' } }); await expect(transport.request('s1', { kind: 'followup', text: 'hello' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'steer', text: 'now' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).rejects.toMatchObject({ code: 'BLUE_CAPABILITY_ABSENT', capability: 'action' })
    await expect(transport.ask('s1', { rpcId: 'q', answer: { answers: [] } }, new AbortController().signal)).resolves.toEqual({ answers: [] }); await expect(transport.approve('s1', { rpcId: 'a', approvalId: 'approval-1', outcome: 'allowed-once' }, new AbortController().signal)).resolves.toBe('allowed-once'); await expect(transport.ask('s1', {}, new AbortController().signal)).rejects.toThrow('rpcId'); await expect(transport.approve('s1', { rpcId: 'a' }, new AbortController().signal)).rejects.toThrow('approvalId'); await expect(transport.approve('s1', { rpcId: 'a', approvalId: 'approval-1', outcome: 'yes' }, new AbortController().signal)).rejects.toThrow('outcome'); const pre = new AbortController(); pre.abort(); await expect(transport.ask('s1', { rpcId: 'q' }, pre.signal)).rejects.toThrow('Aborted'); await expect(transport.approve('s1', { rpcId: 'a' }, pre.signal)).rejects.toThrow('Aborted'); transport.dispose()
    const rejected = fixture(); vi.mocked(rejected.client.respond).mockResolvedValue(false); const rejectedTransport = new DshRemoteTransport(rejected.client); await expect(rejectedTransport.ask('s1', { rpcId: 'q' }, new AbortController().signal)).rejects.toThrow('rejected'); await expect(rejectedTransport.approve('s1', { rpcId: 'a', approvalId: 'approval-1', outcome: 'rejected' }, new AbortController().signal)).rejects.toThrow('rejected'); rejectedTransport.dispose()
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
        yield { data: Buffer.from('data: not-json\n\ndata: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/end","seq":4}}}\n\n').toString('base64') }
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
    expect(client.subscribe).toHaveBeenCalledWith('host.events.open', 'host.events.cancel', { kind: 'mux' }, expect.any(AbortSignal))
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
    const released: string[] = []
    let streamed = false
    let releaseStream!: () => void
    const streamGate = new Promise<void>(resolve => { releaseStream = resolve })
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['tui-read-projection', 'async-agent-actions', 'writer-lease'] },
      call: vi.fn(async () => ({ protocolVersion: 2 })),
      agents: {
        invoke: vi.fn(async (action: string) => action === 'session.list'
          ? { items: [{ sessionId: 's1', cwd: '/official', running: true, projections: { asOfSeq: 9 } }] }
          : action === 'session.history'
            ? { events: [{ event: { seq: 9 } }] }
            : undefined),
      },
      host: {
        subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          yield Buffer.from('data: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/end","seq":10}}}\n\n')
          streamed = true
          await streamGate
          yield Buffer.from('data: {"payload":{"type":"session/event","sessionId":"s1","event":{"type":"turn/start","seq":11}}}\n\n')
        } })),
      },
      attach: vi.fn(async (_sessionId, access) => ({ release: async () => { released.push(access) } })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client, { requestTimeoutMs: 321 })
    await expect(transport.negotiate(new AbortController().signal)).resolves.toMatchObject({ protocol: '2', capabilities: ['session', 'projection', 'action', 'writeLease'] })
    await expect(transport.snapshot('s1', new AbortController().signal)).resolves.toMatchObject({ watermark: 10, value: { cwd: '/official', status: 'idle' } })
    const seen: number[] = []
    transport.subscribe('s1', 10, event => seen.push(event.seq))
    await vi.waitFor(() => expect(streamed).toBe(true))
    releaseStream()
    await vi.waitFor(() => expect(seen).toEqual([11]))
    await expect(transport.request('s1', { kind: 'followup', text: 'hello' }, new AbortController().signal)).resolves.toBeUndefined()
    await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).resolves.toBeUndefined()
    expect(client.agents.invoke).toHaveBeenCalledWith('session.cancel', { sessionId: 's1' }, expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 321 }))
    await expect(transport.acquireWriteLease('s1', new AbortController().signal)).resolves.toMatchObject({ token: 'attachment:s1', sessionId: 's1' })
    await expect(transport.releaseWriteLease('s1', { token: 'attachment:s1', expiresAt: Number.POSITIVE_INFINITY, sessionId: 's1' })).resolves.toBeUndefined()
    expect(released).toContain('write')
    transport.dispose()
    const minimal = new DshRemoteTransport({ ...client, contract: {} })
    await expect(minimal.negotiate(new AbortController().signal)).resolves.toEqual({ protocol: '2', capabilities: ['writeLease'] })
    await minimal.request('s1', { kind: 'followup', text: 'without timeout' }, new AbortController().signal)
    await minimal.request('s1', { kind: 'interrupt' }, new AbortController().signal)
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
  it('releases official attachments on abort and detach across multiple sessions', async () => {
    const released: string[] = []
    const attach = vi.fn(async (sessionId: string, access: 'read' | 'write') => ({ release: async () => { released.push(`${sessionId}:${access}`) } }))
    const streamClosed = Promise.withResolvers<void>()
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['tui-read-projection'] },
      call: vi.fn(async () => undefined),
      host: { subscribe: vi.fn(async (_kind, signal) => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> { await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true })); streamClosed.resolve(); yield* [] } })) },
      agents: { invoke: vi.fn(async (action: string, payload: unknown) => action === 'session.list'
        ? { items: [{ sessionId: 's1', projections: { asOfSeq: 3 } }, { sessionId: 's2', projections: { asOfSeq: 5 } }] }
        : (payload as { sessionId?: string }).sessionId === 's1'
          ? { projections: { asOfSeq: 3 } }
          : { events: [{}, { event: {} }, { event: { seq: 5 } }], projections: { asOfSeq: 5 } }) },
      attach,
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    const preRead = new AbortController(); preRead.abort()
    await expect(transport.snapshot('pre-read', preRead.signal)).rejects.toThrow('Aborted')
    const duringRead = new AbortController()
    attach.mockImplementationOnce(async (sessionId, access) => { duringRead.abort(); return { release: async () => { released.push(`${sessionId}:${access}`) } } })
    await expect(transport.snapshot('during-read', duringRead.signal)).rejects.toThrow('Aborted')
    const preWrite = new AbortController(); preWrite.abort()
    await expect(transport.acquireWriteLease('pre-write', preWrite.signal)).rejects.toThrow('Aborted')
    const duringWrite = new AbortController()
    attach.mockImplementationOnce(async (sessionId, access) => { duringWrite.abort(); return { release: async () => { released.push(`${sessionId}:${access}`) } } })
    await expect(transport.acquireWriteLease('during-write', duringWrite.signal)).rejects.toThrow('Aborted')
    await transport.snapshot('s1', new AbortController().signal)
    await transport.snapshot('s2', new AbortController().signal)
    await transport.acquireWriteLease('s1', new AbortController().signal)
    const off = transport.subscribe('s1', 3, () => undefined)
    transport.detach('s1')
    await transport.releaseWriteLease('s1', { token: 'attachment:s1', expiresAt: Number.POSITIVE_INFINITY })
    off()
    transport.detach('s2')
    await streamClosed.promise
    transport.detach('missing')
    expect(released).toEqual(expect.arrayContaining(['during-read:read', 'during-write:write', 's1:read', 's1:write', 's2:read']))
    transport.dispose()
  })
  it('deduplicates concurrent attachments and fences detach/dispose generations', async () => {
    const firstWrite = Promise.withResolvers<{ release(): Promise<void> }>()
    const oldWrite = Promise.withResolvers<{ release(): Promise<void> }>()
    const freshWrite = Promise.withResolvers<{ release(): Promise<void> }>()
    const pendingRead = Promise.withResolvers<{ release(): Promise<void> }>()
    const released: string[] = []
    const attach = vi.fn()
      .mockImplementationOnce(async () => firstWrite.promise)
      .mockImplementationOnce(async () => oldWrite.promise)
      .mockImplementationOnce(async () => freshWrite.promise)
      .mockImplementationOnce(async () => pendingRead.promise)
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['writer-lease', 'tui-read-projection'] },
      call: vi.fn(async () => undefined),
      agents: { invoke: vi.fn(async (action: string) => action === 'session.list' ? { items: [] } : { events: [] }) },
      host: { subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {} })) },
      attach,
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const transport = new DshRemoteTransport(client)
    await transport.negotiate(new AbortController().signal)
    const abortedController = new AbortController()
    const abortedWaiter = transport.acquireWriteLease('shared', abortedController.signal)
    const sharedOne = transport.acquireWriteLease('shared', new AbortController().signal)
    const sharedTwo = transport.acquireWriteLease('shared', new AbortController().signal)
    abortedController.abort()
    await expect(abortedWaiter).rejects.toThrow('Aborted')
    await vi.waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
    firstWrite.resolve({ release: async () => { released.push('shared') } })
    await expect(sharedOne).resolves.toMatchObject({ token: 'attachment:shared' })
    await expect(sharedTwo).resolves.toMatchObject({ token: 'attachment:shared' })
    transport.detach('shared')
    await vi.waitFor(() => expect(released).toContain('shared'))

    const stale = transport.acquireWriteLease('epoch', new AbortController().signal)
    await Promise.resolve()
    transport.detach('epoch')
    const fresh = transport.acquireWriteLease('epoch', new AbortController().signal)
    freshWrite.resolve({ release: async () => { released.push('fresh') } })
    await expect(fresh).resolves.toMatchObject({ token: 'attachment:epoch' })
    oldWrite.resolve({ release: async () => { released.push('stale') } })
    await expect(stale).rejects.toThrow('Aborted')
    await vi.waitFor(() => expect(released).toContain('stale'))

    const read = transport.snapshot('pending-read', new AbortController().signal)
    await Promise.resolve()
    transport.dispose()
    pendingRead.resolve({ release: async () => { released.push('disposed-read') } })
    await expect(read).rejects.toThrow('Aborted')
    expect(released).toContain('disposed-read')
  })
  it('contains attachment cleanup failures during detach and dispose', async () => {
    const releases = vi.fn(async () => { throw new Error('cleanup failed') })
    const client: DshRemoteWireClient = {
      contract: { bridge: { major: 2, minor: 0 }, capabilities: ['writer-lease', 'tui-read-projection'] },
      call: vi.fn(async () => undefined),
      agents: { invoke: vi.fn(async (action: string) => action === 'session.list' ? { items: [] } : { events: [] }) },
      host: { subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {} })) },
      attach: vi.fn(async () => ({ release: releases })),
      respond: vi.fn(async () => true),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const detached = new DshRemoteTransport(client)
    await detached.snapshot('detach-fail', new AbortController().signal)
    await detached.acquireWriteLease('detach-fail', new AbortController().signal)
    detached.detach('detach-fail')
    await vi.waitFor(() => expect(releases).toHaveBeenCalledTimes(2))

    const disposed = new DshRemoteTransport(client)
    await disposed.snapshot('dispose-fail', new AbortController().signal)
    await disposed.acquireWriteLease('dispose-fail', new AbortController().signal)
    disposed.dispose()
    await vi.waitFor(() => expect(releases).toHaveBeenCalledTimes(4))
    detached.dispose()
  })
  it('aborts failed stream opens and restarts after split or failed SSE generations', async () => {
    const preStream = new AbortController(); preStream.abort()
    await expect(new DshRemoteTransport(fixture().client).snapshot('s1', preStream.signal)).rejects.toThrow('Aborted')
    const failedOpen: DshRemoteWireClient = {
      call: vi.fn(async () => ({ items: [] })),
      host: { subscribe: vi.fn(async () => { throw new Error('stream down') }) },
      agents: { invoke: vi.fn(async () => ({ items: [] })) },
      respond: vi.fn(async () => true), start: vi.fn(), stop: vi.fn(),
    }
    await expect(new DshRemoteTransport(failedOpen).snapshot('s1', new AbortController().signal)).rejects.toThrow('stream down')
    const swallowed = new DshRemoteTransport(failedOpen)
    swallowed.subscribe('s1', -1, () => undefined)
    await vi.waitFor(() => expect(failedOpen.host?.subscribe).toHaveBeenCalledTimes(2))
    swallowed.dispose()

    const abortingClient: DshRemoteWireClient = {
      call: vi.fn(async () => ({ items: [] })),
      host: { subscribe: vi.fn(async (_kind, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('open aborted')), { once: true }))) },
      respond: vi.fn(async () => true), start: vi.fn(), stop: vi.fn(),
    }
    const aborting = new DshRemoteTransport(abortingClient)
    const controller = new AbortController()
    const pending = aborting.snapshot('s1', controller.signal)
    await vi.waitFor(() => expect(abortingClient.host?.subscribe).toHaveBeenCalledOnce())
    controller.abort()
    await expect(pending).rejects.toThrow('open aborted')
    aborting.dispose()

    const supersededClient: DshRemoteWireClient = {
      call: vi.fn(async () => ({ items: [] })),
      host: { subscribe: vi.fn(async (_kind, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('open stopped')), { once: true }))) },
      respond: vi.fn(async () => true), start: vi.fn(), stop: vi.fn(),
    }
    const superseded = new DshRemoteTransport(supersededClient)
    const supersededOpen = superseded.snapshot('s1', new AbortController().signal)
    await vi.waitFor(() => expect(supersededClient.host?.subscribe).toHaveBeenCalledOnce())
    superseded.dispose()
    await expect(supersededOpen).rejects.toThrow('open stopped')

    let generations = 0
    const splitClient: DshRemoteWireClient = {
      call: vi.fn(async () => ({ items: [] })),
      host: { subscribe: vi.fn(async () => {
        generations += 1
        return { async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
          if (generations === 1) {
            yield Buffer.from(': connected\r\n\r\ndata: {"payload":{"type":"session/event","sessionId":"s1",')
            yield Buffer.from('"event":{"type":"turn/start","seq":2}}}\n\n')
            throw new Error('generation ended')
          }
        } }
      }) },
      agents: { invoke: vi.fn(async (action: string) => action === 'session.list' ? { items: [{ sessionId: 's1' }] } : { events: [] }) },
      respond: vi.fn(async () => true), start: vi.fn(), stop: vi.fn(),
    }
    const split = new DshRemoteTransport(splitClient)
    const splitBaseline = await split.snapshot('s1', new AbortController().signal)
    await vi.waitFor(() => expect(generations).toBe(1))
    await new Promise(resolve => setTimeout(resolve, 10))
    const replayed: number[] = []
    split.subscribe('s1', splitBaseline.watermark, event => replayed.push(event.seq))()
    expect(splitBaseline.watermark === 2 ? splitBaseline.value.status : replayed.join()).toBe(splitBaseline.watermark === 2 ? 'running' : '2')
    await vi.waitFor(() => expect(generations).toBe(2))
    split.dispose()
  })
  it('bounds replay buffers and ignores duplicate remote sequences', async () => {
    const f = fixture()
    const transport = new DshRemoteTransport(f.client)
    await transport.snapshot('s1', new AbortController().signal)
    for (let seq = 0; seq < 258; seq += 1) {
      const type = seq === 0 ? 'assistant/chunk' : seq === 1 ? 'tool/call' : 'other'
      f.emit({ type: 'session/event', sessionId: 'bulk', event: { type, seq } })
    }
    f.emit({ type: 'session/event', sessionId: 'bulk', event: { type: 'turn/end', seq: 257 } })
    const replayed: number[] = []
    transport.subscribe('bulk', -1, event => replayed.push(event.seq))()
    expect(replayed).toHaveLength(256)
    expect(replayed.at(0)).toBe(2)
    expect(replayed.at(-1)).toBe(257)
    transport.dispose()
  })
  it('creates a narrow wire client facade for an official connection', async () => {
    const invoke = vi.fn(async () => undefined)
    const fetch = vi.fn(async () => ({ status: 204, headers: [] as Array<[string, string]>, body: new Uint8Array() }))
    const attach = vi.fn(async () => ({ release: async () => undefined }))
    const client = createDshRemoteWireClient({
      contract: { bridge: { major: 2, minor: 0 }, capabilities: [] },
      host: { fetch, subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {} })) },
      agents: { invoke },
      attach,
    })
    expect(client.contract?.bridge?.major).toBe(2)
    await expect(client.call('session.list', {}, new AbortController().signal)).resolves.toBeUndefined()
    await expect(client.call('session.list', {})).resolves.toBeUndefined()
    await expect(client.respond('rpc-1', 'yes')).resolves.toBe(true)
    await expect(client.call('session.prompt', { sessionId: 's1' }, new AbortController().signal)).resolves.toBeUndefined()
    await expect(client.call('session.cancel', { sessionId: 's1' })).resolves.toBeUndefined()
    await expect(client.respond('rpc-2', 'no', new AbortController().signal)).resolves.toBe(true)
    fetch.mockResolvedValueOnce({ status: 200, headers: [], body: Buffer.from('{"accepted":false,"reason":"duplicate"}') })
    await expect(client.respond('rpc-duplicate', 'no')).resolves.toBe(false)
    fetch.mockResolvedValueOnce({ status: 200, headers: [], body: Buffer.from('{"accepted":true}') })
    await expect(client.respond('rpc-accepted', 'yes')).resolves.toBe(true)
    fetch.mockResolvedValueOnce({ status: 200, headers: [], body: Buffer.from('not-json') })
    await expect(client.respond('rpc-malformed', null)).resolves.toBe(false)
    expect(invoke).toHaveBeenCalledWith('session.list', {}, { authorization: { kind: 'read' } })
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/respond', body: expect.any(Uint8Array) }), { authorization: { kind: 'host-write' } })
    expect(JSON.parse(Buffer.from(fetch.mock.calls[0]![0].body!).toString('utf8'))).toEqual({ type: 'client-response', rpcId: 'rpc-1', result: { ok: true, value: 'yes' } })
    await client.attach?.('s1', 'read')
    expect(attach).toHaveBeenCalledWith('s1', 'read')
    expect(() => client.call('outside', {})).toThrow('outside')
    expect(() => client.call('session.prompt', {})).toThrow('sessionId')
    const noAttach = createDshRemoteWireClient({
      contract: { bridge: { major: 2, minor: 0 }, capabilities: [] },
      host: { fetch: vi.fn(async () => ({ status: 199, headers: [], body: new Uint8Array() })), subscribe: vi.fn(async () => ({ async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {} })) },
      agents: { invoke },
    })
    expect(noAttach.attach).toBeUndefined()
    await expect(noAttach.respond('rpc-failed', null)).resolves.toBe(false)
    client.start({ onMuxFrame: () => undefined, onHostFrame: () => undefined, onReopen: () => undefined })
    client.stop()
  })
})
