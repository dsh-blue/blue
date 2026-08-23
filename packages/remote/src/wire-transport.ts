/**
 * Adapter from the published dsh-remote wire client to Blue's narrow
 * `RemoteTransport` contract. The external package is intentionally not a
 * dependency: callers pass its `DshApiClient`-shaped object, keeping the Blue
 * runtime usable with another wire client or a headless fixture.
 *
 * @module @dsh-blue/blue-remote/wire-transport
 */
import type { BlueSessionAction, BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type { EventEnvelope, SnapshotEnvelope } from '@dsh-blue/blue-harness-adapter'
import type { MuxFrame, RemoteWireClient, RemoteWireHealth, RemoteSessionList } from './wire-types.ts'
import type { RemoteCapabilities, RemoteTransport } from './types.ts'

/** Protocol client shape implemented by `@deepseek-harness-plugins/dsh-remote/wire`. */
export interface DshRemoteWireClient extends RemoteWireClient {}

function snapshotFromRow(sessionId: string, row?: RemoteSessionList['items'][number]): BlueSessionSnapshot {
  return { id: sessionId, cwd: row?.cwd ?? '', status: row?.running === true ? 'running' : 'idle', mode: 'normal' }
}

/** Real dsh-remote v1 transport; unsupported v1 writes remain capability-absent. */
export class DshRemoteTransport implements RemoteTransport {
  private readonly listeners = new Set<(event: EventEnvelope<BlueSessionSnapshot>) => void>()
  private readonly snapshots = new Map<string, BlueSessionSnapshot>()
  private started = false
  constructor(private readonly client: DshRemoteWireClient) {}
  async negotiate(signal: AbortSignal): Promise<RemoteCapabilities> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const health = await this.client.getTui<RemoteWireHealth>('health')
    if (health.protocolVersion !== 1) throw new Error(`remote protocol ${health.protocolVersion} is unsupported`)
    return { protocol: String(health.protocolVersion), capabilities: ['session', 'action', 'projection', 'question', 'approval'] }
  }
  async snapshot(sessionId: string, signal: AbortSignal): Promise<SnapshotEnvelope<BlueSessionSnapshot>> {
    const value = await this.client.call<RemoteSessionList>('session.list', {}, signal)
    const row = value.items.find(item => item.sessionId === sessionId)
    const snapshot = snapshotFromRow(sessionId, row)
    this.snapshots.set(sessionId, snapshot)
    return { watermark: row?.projections?.asOfSeq ?? -1, value: snapshot }
  }
  subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): () => void {
    const forward = (event: EventEnvelope<BlueSessionSnapshot>): void => { if (event.sessionId === sessionId && event.seq > afterWatermark) listener(event) }
    this.listeners.add(forward)
    if (!this.started) { this.started = true; this.client.start({ onMuxFrame: (_rpcId, frame) => this.onMux(frame), onHostFrame: () => {}, onReopen: () => {} }) }
    return () => this.listeners.delete(forward)
  }
  async request(sessionId: string, action: BlueSessionAction, signal: AbortSignal): Promise<void> {
    if (action.kind === 'interrupt') throw new Error('remote action unavailable: session interrupt is not in protocol v1')
    await this.client.call('session.prompt', { sessionId, mode: action.kind === 'steer' ? 'steer' : 'queue', content: [{ type: 'text', text: action.text }] }, signal)
  }
  async ask(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> { return this.respondQuestion(sessionId, question, signal) }
  async approve(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> { return this.respondQuestion(sessionId, question, signal) }
  dispose(): void { this.listeners.clear(); if (this.started) this.client.stop(); this.started = false; this.snapshots.clear() }
  private onMux(frame: MuxFrame): void {
    if (frame.type !== 'session/event' || frame.sessionId === undefined || frame.event === undefined) return
    const sessionId = frame.sessionId
    const event = frame.event
    const previous = this.snapshots.get(sessionId) ?? snapshotFromRow(sessionId)
    const status = event.type === 'turn/start' || event.type === 'assistant/chunk' || event.type === 'tool/call' ? 'running' : event.type === 'turn/end' ? 'idle' : previous.status
    const snapshot = { ...previous, status } as BlueSessionSnapshot
    this.snapshots.set(sessionId, snapshot)
    const envelope: EventEnvelope<BlueSessionSnapshot> = { sessionId, seq: event.seq, event: snapshot }
    for (const listener of this.listeners) listener(envelope)
  }
  private async respondQuestion(_sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const value = question as { rpcId?: unknown; answer?: unknown }
    if (typeof value.rpcId !== 'string') throw new Error('remote question requires rpcId')
    await this.client.respond(value.rpcId, value.answer)
    return value.answer
  }
}
