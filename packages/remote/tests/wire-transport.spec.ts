import { describe, expect, it, vi } from 'vitest'
import { DshRemoteTransport } from '../src/wire-transport.ts'
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
    const bad = fixture(); vi.mocked(bad.client.getTui).mockResolvedValue({ protocolVersion: 2, incarnation: 'i', pluginVersion: 'p' }); await expect(new DshRemoteTransport(bad.client).negotiate(new AbortController().signal)).rejects.toThrow('unsupported')
    await expect(transport.snapshot('missing', new AbortController().signal)).resolves.toMatchObject({ watermark: -1, value: { id: 'missing' } }); await expect(transport.request('s1', { kind: 'followup', text: 'hello' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'steer', text: 'now' }, new AbortController().signal)).resolves.toBeUndefined(); await expect(transport.request('s1', { kind: 'interrupt' }, new AbortController().signal)).rejects.toThrow('not in protocol')
    await expect(transport.ask('s1', { rpcId: 'q', answer: ['a'] }, new AbortController().signal)).resolves.toEqual(['a']); await expect(transport.approve('s1', { rpcId: 'a', answer: 'yes' }, new AbortController().signal)).resolves.toBe('yes'); await expect(transport.ask('s1', {}, new AbortController().signal)).rejects.toThrow('rpcId'); const pre = new AbortController(); pre.abort(); await expect(transport.ask('s1', { rpcId: 'q' }, pre.signal)).rejects.toThrow('Aborted'); transport.dispose()
  })
})
