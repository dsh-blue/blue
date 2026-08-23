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
import type { DshRemoteConnectionClient, HostEventFrame, MuxFrame, RemoteWireClient, RemoteWireHealth, RemoteSessionList, RemoteWireContract } from './wire-types.ts'
import type { RemoteCapabilities, RemoteTransport, WriteLease } from './types.ts'

/** Protocol client shape implemented by `@deepseek-harness-plugins/dsh-remote/wire`. */
export interface DshRemoteWireClient extends RemoteWireClient {
  readonly contract?: RemoteWireContract
  readonly host?: { subscribe(kind: 'mux' | 'host', signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> }
  readonly agents?: { invoke<T>(action: string, payload: unknown, options?: { readonly signal?: AbortSignal }): Promise<T> }
  attach?(sessionId: string, access: 'read' | 'write'): Promise<{ release(): Promise<void> }>
}

/** Options for the authenticated dsh-remote v2 contract probe. */
export interface DshRemoteTransportOptions {
  readonly acceptedAbis?: readonly Record<string, string>[]
  readonly requiredCapabilities?: readonly string[]
  readonly bridge?: { readonly major: number; readonly minMinor: number; readonly maxMinor: number }
}

/**
 * Adapt an authenticated `@dsh-remote/core` connection to the wire-client
 * shape without importing the external package into Blue.
 */
export function createDshRemoteWireClient(connection: DshRemoteConnectionClient): DshRemoteWireClient {
  return {
    contract: connection.contract,
    host: connection.host,
    agents: connection.agents,
    call: (method, payload, signal) => connection.agents.invoke(method, payload, { ...(signal === undefined ? {} : { signal }) }),
    respond: async (rpcId, value) => { await connection.agents.invoke('respond', { rpcId, value }); return true },
    start: () => undefined,
    stop: () => undefined,
  }
}

function snapshotFromRow(sessionId: string, row?: RemoteSessionList['items'][number]): BlueSessionSnapshot {
  return { id: sessionId, cwd: row?.cwd ?? '', status: row?.running === true ? 'running' : 'idle', mode: 'normal' }
}

/** dsh-remote v1/v2 transport; v1 compatibility remains capability-scoped. */
export class DshRemoteTransport implements RemoteTransport {
  private readonly listeners = new Set<(event: EventEnvelope<BlueSessionSnapshot>) => void>()
  private readonly snapshots = new Map<string, BlueSessionSnapshot>()
  private started = false
  private negotiatedProtocol: string | undefined
  private readonly options: DshRemoteTransportOptions
  private readonly leases = new Map<string, { readonly release: () => Promise<void> }>()
  constructor(private readonly client: DshRemoteWireClient, options: DshRemoteTransportOptions = {}) { this.options = options }
  async negotiate(signal: AbortSignal): Promise<RemoteCapabilities> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (this.client.contract !== undefined) {
      const capabilities = new Set((this.client.contract.capabilities ?? []).flatMap(value => capabilityAliases(value)))
      this.negotiatedProtocol = String(this.client.contract.bridge?.major ?? 2)
      return { protocol: this.negotiatedProtocol, capabilities: [...capabilities] }
    }
    const health = this.client.getTui === undefined
      ? await this.client.call<RemoteWireHealth>('system.describe', {}, signal)
      : await this.client.getTui<RemoteWireHealth>('health')
    if (typeof health.protocolVersion !== 'number') throw new Error('remote wire client does not expose health negotiation')
    if (health.protocolVersion !== 1 && health.protocolVersion !== 2) throw new Error(`remote protocol ${health.protocolVersion} is unsupported`)
    let contract: RemoteWireContract | undefined
    if (health.protocolVersion === 2 && this.options.acceptedAbis !== undefined && this.options.acceptedAbis.length > 0) {
      contract = await this.client.call<RemoteWireContract>('system.negotiate', {
        bridge: this.options.bridge ?? { major: 2, minMinor: 0, maxMinor: health.protocolMinor ?? 0 },
        ...(this.options.requiredCapabilities === undefined ? {} : { requiredCapabilities: this.options.requiredCapabilities }),
        acceptedAbis: this.options.acceptedAbis,
      }, signal)
    }
    const advertised = contract?.capabilities ?? health.capabilities ?? ['session', 'action', 'projection', 'question', 'approval']
    const capabilities = new Set(advertised.flatMap(value => capabilityAliases(value)))
    this.negotiatedProtocol = String(contract?.bridge?.major ?? health.protocolVersion)
    return { protocol: this.negotiatedProtocol, capabilities: [...capabilities] }
  }
  async snapshot(sessionId: string, signal: AbortSignal): Promise<SnapshotEnvelope<BlueSessionSnapshot>> {
    const value = this.client.agents === undefined
      ? await this.client.call<RemoteSessionList>('session.list', {}, signal)
      : await this.client.agents.invoke<RemoteSessionList>('session.list', {}, { signal })
    const row = value.items.find(item => item.sessionId === sessionId)
    const snapshot = snapshotFromRow(sessionId, row)
    this.snapshots.set(sessionId, snapshot)
    return { watermark: row?.projections?.asOfSeq ?? -1, value: snapshot }
  }
  subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): () => void {
    const forward = (event: EventEnvelope<BlueSessionSnapshot>): void => { if (event.sessionId === sessionId && event.seq > afterWatermark) listener(event) }
    this.listeners.add(forward)
    if (!this.started) {
      this.started = true
      if (this.client.host !== undefined) void this.readConnectionEvents(sessionId)
      else if (this.client.subscribeEvents === undefined && this.client.subscribe === undefined) this.client.start({ onMuxFrame: (_rpcId, frame) => this.onMux(frame), onHostFrame: frame => this.onHost(frame), onReopen: () => {} })
      else void this.readEvents(sessionId)
    }
    return () => this.listeners.delete(forward)
  }
  async request(sessionId: string, action: BlueSessionAction, signal: AbortSignal): Promise<void> {
    if (action.kind === 'interrupt') {
      if (this.negotiatedProtocol !== '2') throw new Error('remote action unavailable: session interrupt is not in protocol v1')
      if (this.client.agents !== undefined) await this.client.agents.invoke('session.cancel', { sessionId }, { signal })
      else await this.client.call('session.cancel', { sessionId }, signal)
      return
    }
    const payload = { sessionId, mode: action.kind === 'steer' ? 'steer' : 'queue', content: [{ type: 'text', text: action.text }] }
    if (this.client.agents !== undefined) await this.client.agents.invoke('session.prompt', payload, { signal })
    else await this.client.call('session.prompt', payload, signal)
  }
  async acquireWriteLease(sessionId: string, signal: AbortSignal): Promise<WriteLease> {
    if (this.client.attach !== undefined) {
      const attachment = await this.client.attach(sessionId, 'write')
      this.leases.set(sessionId, attachment)
      return { token: `attachment:${sessionId}`, expiresAt: Number.POSITIVE_INFINITY, sessionId }
    }
    const grant = await this.client.call<{ readonly leaseId?: string; readonly token?: string; readonly fencingToken?: number; readonly expiresAt: number; readonly sessionId?: string; readonly clientId?: string; readonly frontendInstanceId?: string }>('lease.acquire', { sessionId }, signal)
    return {
      token: grant.token ?? grant.leaseId ?? String(grant.fencingToken ?? ''),
      expiresAt: grant.expiresAt,
      ...(grant.leaseId === undefined ? {} : { leaseId: grant.leaseId }),
      ...(grant.fencingToken === undefined ? {} : { fencingToken: grant.fencingToken }),
      ...(grant.sessionId === undefined ? {} : { sessionId: grant.sessionId }),
      ...(grant.clientId === undefined ? {} : { clientId: grant.clientId }),
      ...(grant.frontendInstanceId === undefined ? {} : { frontendInstanceId: grant.frontendInstanceId }),
    }
  }
  async releaseWriteLease(sessionId: string, lease: WriteLease): Promise<void> {
    const attachment = this.leases.get(sessionId)
    if (attachment !== undefined) { this.leases.delete(sessionId); await attachment.release(); return }
    await this.client.call('lease.release', { sessionId, leaseId: lease.leaseId ?? lease.token })
  }
  async ask(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> { return this.respondQuestion(sessionId, question, signal) }
  async approve(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> { return this.respondQuestion(sessionId, question, signal) }
  dispose(): void { this.listeners.clear(); if (this.started) this.client.stop(); this.started = false; this.negotiatedProtocol = undefined; this.snapshots.clear(); for (const attachment of this.leases.values()) void attachment.release(); this.leases.clear() }
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
  private onHost(frame: HostEventFrame): void {
    if (frame === null || typeof frame !== 'object') return
    const payload = frame.payload ?? frame.data ?? frame
    if (typeof payload !== 'object' || payload === null) return
    const value = payload as { payload?: unknown; type?: unknown; sessionId?: unknown; event?: unknown }
    const nested = value.payload ?? payload
    if (typeof nested !== 'object' || nested === null) return
    const event = nested as { type?: unknown; sessionId?: unknown; event?: { type?: unknown; seq?: unknown } }
    if (event.type !== 'session/event' || typeof event.sessionId !== 'string' || event.event === undefined || typeof event.event.seq !== 'number' || typeof event.event.type !== 'string') return
    this.onMux({ type: 'session/event', sessionId: event.sessionId, event: { type: event.event.type, seq: event.event.seq } })
  }
  private async readEvents(sessionId: string): Promise<void> {
    const stream = this.client.subscribeEvents !== undefined
      ? await this.client.subscribeEvents('mux')
      : await this.client.subscribe!('host.events.open', 'host.events.cancel', { kind: 'mux' })
    for await (const chunk of stream) {
      if (this.listeners.size === 0) return
      const text = decodeBase64(chunk.data)
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const frame = JSON.parse(line.slice(6)) as HostEventFrame
          this.onHost(frame)
        } catch { /* malformed stream data is ignored; the connection remains usable */ }
      }
    }
    void sessionId
  }
  private async readConnectionEvents(sessionId: string): Promise<void> {
    const stream = await this.client.host!.subscribe('mux')
    for await (const chunk of stream) {
      if (this.listeners.size === 0) return
      const text = Buffer.from(chunk).toString('utf8')
      for (const line of text.split('\n')) {
        if (!line.startsWith('data: ')) continue
        try { this.onHost(JSON.parse(line.slice(6)) as HostEventFrame) } catch { /* ignore malformed SSE */ }
      }
    }
    void sessionId
  }
  private async respondQuestion(_sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const value = question as { rpcId?: unknown; answer?: unknown }
    if (typeof value.rpcId !== 'string') throw new Error('remote question requires rpcId')
    await this.client.respond(value.rpcId, value.answer)
    return value.answer
  }
}

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8')
}

function capabilityAliases(value: string): RemoteCapabilities['capabilities'] {
  const aliases: Readonly<Record<string, RemoteCapabilities['capabilities']>> = {
    'tui-read-projection': ['session', 'projection'],
    'session-projection': ['session', 'projection'],
    'async-agent-actions': ['action'],
    'session-actions': ['action'],
    'host-events-v1': ['projection', 'session'],
    'host-events': ['projection', 'session'],
    'writer-lease': ['writeLease'],
    'session-write-lease': ['writeLease'],
    'question-bridge': ['question'],
    'approval-bridge': ['approval'],
  }
  const mapped = aliases[value]
  if (mapped !== undefined) return mapped
  return ['session', 'action', 'projection', 'question', 'approval', 'writeLease'].includes(value)
    ? [value as RemoteCapabilities['capabilities'][number]]
    : []
}
