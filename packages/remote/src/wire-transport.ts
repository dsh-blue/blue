/**
 * Adapter from dsh-remote clients to Blue's narrow remote transport. The
 * official connection is accepted structurally so Blue does not retain or
 * expose remote Agent or Session objects.
 *
 * @module @dsh-blue/blue-remote/wire-transport
 */
import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import { AdapterCapabilityAbsentError } from '@dsh-blue/blue-harness-adapter'
import type { EventEnvelope, SnapshotEnvelope } from '@dsh-blue/blue-harness-adapter'
import type {
  DshRemoteConnectionClient,
  HostEventFrame,
  MuxFrame,
  RemoteAuthorization,
  RemoteCallOptions,
  RemoteSessionHistory,
  RemoteSessionList,
  RemoteWireClient,
  RemoteWireContract,
  RemoteWireHealth,
} from './wire-types.ts'
import type { RemoteCapabilities, RemoteSessionAction, RemoteTransport, WriteLease } from './types.ts'

type Attachment = { readonly release: () => Promise<void> }
type PendingAttachment = { readonly epoch: number; waiters: number; promise: Promise<void> }

/** Protocol client shape implemented by legacy wire clients and the official connection facade. */
export interface DshRemoteWireClient extends RemoteWireClient {
  readonly contract?: RemoteWireContract
  readonly host?: { subscribe(kind: 'mux' | 'host', signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> }
  readonly agents?: { invoke<T>(action: string, payload: unknown, options?: RemoteCallOptions): Promise<T> }
  attach?(sessionId: string, access: 'read' | 'write'): Promise<Attachment>
}

/** Options for the authenticated dsh-remote v2 contract probe. */
export interface DshRemoteTransportOptions {
  readonly acceptedAbis?: readonly Record<string, string>[]
  readonly requiredCapabilities?: readonly string[]
  readonly bridge?: { readonly major: number; readonly minMinor: number; readonly maxMinor: number }
  /** Bound official agent actions; mutation timeouts surface as outcome-unknown failures. */
  readonly requestTimeoutMs?: number
}

function sessionIdFrom(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null || typeof (payload as { sessionId?: unknown }).sessionId !== 'string') {
    throw new Error('remote session action requires sessionId')
  }
  return (payload as { sessionId: string }).sessionId
}

function authorizationFor(action: string, payload: unknown): RemoteAuthorization {
  if (action === 'session.list' || action === 'session.history') return { kind: 'read' }
  if (action === 'session.prompt' || action === 'session.cancel') return { kind: 'session-write', sessionId: sessionIdFrom(payload) }
  throw new Error(`remote action is outside the Blue compatibility facade: ${action}`)
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
    ...(connection.attach === undefined ? {} : { attach: (sessionId: string, access: 'read' | 'write') => connection.attach!(sessionId, access) }),
    call: (method, payload, signal) => connection.agents.invoke(method, payload, {
      authorization: authorizationFor(method, payload),
      ...(signal === undefined ? {} : { signal }),
    }),
    respond: async (rpcId, value, signal) => {
      const response = await connection.host.fetch({
        path: '/api/respond',
        method: 'POST',
        headers: [['content-type', 'application/json']],
        body: Buffer.from(JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } })),
      }, { authorization: { kind: 'host-write' }, ...(signal === undefined ? {} : { signal }) })
      if (response.status < 200 || response.status >= 300) return false
      if (response.body.byteLength === 0) return true
      try {
        return (JSON.parse(Buffer.from(response.body).toString('utf8')) as { accepted?: unknown }).accepted === true
      } catch {
        return false
      }
    },
    start: () => undefined,
    stop: () => undefined,
  }
}

function snapshotFromRow(sessionId: string, row?: RemoteSessionList['items'][number], revision = 0): BlueSessionSnapshot {
  return { revision, id: sessionId, cwd: row?.cwd ?? '', status: row?.running === true ? 'running' : 'idle', mode: 'normal' }
}

function applyEvent(snapshot: BlueSessionSnapshot, event: NonNullable<MuxFrame['event']>): BlueSessionSnapshot {
  const status = event.type === 'turn/start' || event.type === 'assistant/chunk' || event.type === 'tool/call'
    ? 'running'
    : event.type === 'turn/end'
      ? 'idle'
      : snapshot.status
  return { ...snapshot, revision: snapshot.revision + 1, status }
}

function historyWatermark(history: RemoteSessionHistory): number {
  let watermark = history.projections?.asOfSeq ?? -1
  for (const item of history.events ?? []) {
    const seq = item.event?.seq
    if (typeof seq === 'number' && seq > watermark) watermark = seq
  }
  return watermark
}

/** dsh-remote v1/v2 transport; v1 compatibility remains capability-scoped. */
export class DshRemoteTransport implements RemoteTransport {
  private readonly listeners = new Set<(event: EventEnvelope<BlueSessionSnapshot>) => void>()
  private readonly snapshots = new Map<string, BlueSessionSnapshot>()
  private readonly recent = new Map<string, EventEnvelope<BlueSessionSnapshot>[]>()
  private readonly detachedSessions = new Set<string>()
  private readonly readAttachments = new Map<string, Attachment>()
  private readonly writeAttachments = new Map<string, Attachment>()
  private readonly pendingReadAttachments = new Map<string, PendingAttachment>()
  private readonly pendingWriteAttachments = new Map<string, PendingAttachment>()
  private readonly attachmentEpochs = new Map<string, number>()
  private streamController: AbortController | undefined
  private started = false
  private disposed = false
  private negotiatedProtocol: string | undefined
  private readonly options: DshRemoteTransportOptions

  constructor(private readonly client: DshRemoteWireClient, options: DshRemoteTransportOptions = {}) { this.options = options }

  async negotiate(signal: AbortSignal): Promise<RemoteCapabilities> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    if (this.client.contract !== undefined) {
      const capabilities = new Set((this.client.contract.capabilities ?? []).flatMap(value => capabilityAliases(value)))
      if (this.client.attach !== undefined) capabilities.add('writeLease')
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
    this.detachedSessions.delete(sessionId)
    await this.ensureReadAttachment(sessionId, signal)
    await this.ensureEventStream(signal)
    const value = this.client.agents === undefined
      ? await this.client.call<RemoteSessionList>('session.list', {}, signal)
      : await this.client.agents.invoke<RemoteSessionList>('session.list', {}, {
          authorization: { kind: 'read' }, signal,
          ...(this.options.requestTimeoutMs === undefined ? {} : { timeoutMs: this.options.requestTimeoutMs }),
        })
    const row = value.items.find(item => item.sessionId === sessionId)
    let watermark = row?.projections?.asOfSeq ?? -1
    if (this.client.agents !== undefined) {
      const history = await this.client.agents.invoke<RemoteSessionHistory>('session.history', { sessionId, maxMessages: 1 }, {
        authorization: { kind: 'read' }, signal,
        ...(this.options.requestTimeoutMs === undefined ? {} : { timeoutMs: this.options.requestTimeoutMs }),
      })
      watermark = Math.max(watermark, historyWatermark(history))
    }
    let snapshot = snapshotFromRow(sessionId, row, this.snapshots.get(sessionId)?.revision ?? 0)
    for (const envelope of this.recent.get(sessionId) ?? []) {
      if (envelope.seq <= watermark) continue
      snapshot = { ...snapshot, revision: Math.max(snapshot.revision, envelope.event.revision), status: envelope.event.status }
      watermark = envelope.seq
    }
    this.snapshots.set(sessionId, snapshot)
    return { watermark, value: snapshot }
  }

  subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): () => void {
    this.detachedSessions.delete(sessionId)
    let watermark = afterWatermark
    const forward = (event: EventEnvelope<BlueSessionSnapshot>): void => {
      if (event.sessionId !== sessionId || event.seq <= watermark) return
      watermark = event.seq
      listener(event)
    }
    this.listeners.add(forward)
    for (const event of this.recent.get(sessionId) ?? []) forward(event)
    if (!this.started) void this.ensureEventStream(new AbortController().signal).catch(() => undefined)
    return () => this.listeners.delete(forward)
  }

  async request(sessionId: string, action: RemoteSessionAction, signal: AbortSignal): Promise<void> {
    if (this.client.agents !== undefined) await this.ensureWriteAttachment(sessionId, signal)
    if (action.kind === 'interrupt') {
      if (this.negotiatedProtocol !== '2') throw new AdapterCapabilityAbsentError('action', 'remote session interrupt is unavailable in protocol v1')
      if (this.client.agents !== undefined) await this.client.agents.invoke('session.cancel', { sessionId }, {
        authorization: { kind: 'session-write', sessionId }, signal,
        ...(this.options.requestTimeoutMs === undefined ? {} : { timeoutMs: this.options.requestTimeoutMs }),
      })
      else await this.client.call('session.cancel', { sessionId }, signal)
      return
    }
    const payload = { sessionId, mode: action.kind === 'steer' ? 'steer' : 'queue', content: [{ type: 'text', text: action.text }] }
    if (this.client.agents !== undefined) await this.client.agents.invoke('session.prompt', payload, {
      authorization: { kind: 'session-write', sessionId }, signal,
      ...(this.options.requestTimeoutMs === undefined ? {} : { timeoutMs: this.options.requestTimeoutMs }),
    })
    else await this.client.call('session.prompt', payload, signal)
  }

  async acquireWriteLease(sessionId: string, signal: AbortSignal): Promise<WriteLease> {
    if (this.client.attach !== undefined) {
      await this.ensureWriteAttachment(sessionId, signal)
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
    const attachment = this.writeAttachments.get(sessionId)
    if (attachment !== undefined) { this.writeAttachments.delete(sessionId); await attachment.release(); return }
    if (lease.token.startsWith('attachment:')) return
    await this.client.call('lease.release', { sessionId, leaseId: lease.leaseId ?? lease.token })
  }

  async ask(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const value = question as { rpcId?: unknown; answer?: unknown }
    if (typeof value.rpcId !== 'string') throw new Error('remote question requires rpcId')
    if (!await this.client.respond(value.rpcId, { sessionId, answer: value.answer }, signal)) throw new Error('remote question response was rejected')
    return value.answer
  }

  async approve(sessionId: string, question: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const value = question as { rpcId?: unknown; approvalId?: unknown; outcome?: unknown }
    if (typeof value.rpcId !== 'string' || typeof value.approvalId !== 'string') throw new Error('remote approval requires rpcId and approvalId')
    if (value.outcome !== 'allowed-once' && value.outcome !== 'rejected') throw new Error('remote approval outcome is invalid')
    if (!await this.client.respond(value.rpcId, { sessionId, approvalId: value.approvalId, outcome: value.outcome }, signal)) throw new Error('remote approval response was rejected')
    return value.outcome
  }

  detach(sessionId: string): void {
    this.detachedSessions.add(sessionId)
    this.attachmentEpochs.set(sessionId, (this.attachmentEpochs.get(sessionId) ?? 0) + 1)
    const read = this.readAttachments.get(sessionId)
    const write = this.writeAttachments.get(sessionId)
    this.readAttachments.delete(sessionId)
    this.writeAttachments.delete(sessionId)
    if (read !== undefined) void read.release().catch(() => undefined)
    if (write !== undefined) void write.release().catch(() => undefined)
    this.snapshots.delete(sessionId)
    this.recent.delete(sessionId)
    if (this.readAttachments.size === 0 && this.writeAttachments.size === 0 && this.listeners.size === 0) this.stopStream()
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.stopStream()
    this.negotiatedProtocol = undefined
    this.snapshots.clear()
    this.recent.clear()
    this.detachedSessions.clear()
    for (const attachment of this.readAttachments.values()) void attachment.release().catch(() => undefined)
    for (const attachment of this.writeAttachments.values()) void attachment.release().catch(() => undefined)
    this.readAttachments.clear()
    this.writeAttachments.clear()
    this.pendingReadAttachments.clear()
    this.pendingWriteAttachments.clear()
    this.attachmentEpochs.clear()
  }

  private async ensureReadAttachment(sessionId: string, signal: AbortSignal): Promise<void> {
    await this.ensureAttachment(sessionId, 'read', signal)
  }

  private async ensureWriteAttachment(sessionId: string, signal: AbortSignal): Promise<void> {
    await this.ensureAttachment(sessionId, 'write', signal)
  }

  private async ensureAttachment(sessionId: string, access: 'read' | 'write', signal: AbortSignal): Promise<void> {
    const attach = this.client.attach
    if (attach === undefined) return
    const attached = access === 'read' ? this.readAttachments : this.writeAttachments
    if (attached.has(sessionId)) return
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const pending = access === 'read' ? this.pendingReadAttachments : this.pendingWriteAttachments
    const epoch = this.attachmentEpochs.get(sessionId) ?? 0
    let record = pending.get(sessionId)
    if (record === undefined || record.epoch !== epoch) {
      record = { epoch, waiters: 0, promise: Promise.resolve() }
      const current = record
      pending.set(sessionId, current)
      current.promise = Promise.resolve().then(async (): Promise<void> => {
        const attachment = await attach.call(this.client, sessionId, access)
        if (current.waiters === 0 || this.disposed || (this.attachmentEpochs.get(sessionId) ?? 0) !== epoch) {
          await attachment.release()
          throw new DOMException('Aborted', 'AbortError')
        }
        attached.set(sessionId, attachment)
      })
      const cleanup = (): void => { if (pending.get(sessionId) === current) pending.delete(sessionId) }
      void current.promise.then(cleanup, cleanup)
    }
    record.waiters += 1
    let waiting = true
    const finishWaiting = (): void => {
      if (!waiting) return
      waiting = false
      record.waiters -= 1
    }
    let abort!: () => void
    const callerAbort = new Promise<never>((_resolve, reject) => {
      abort = () => {
        finishWaiting()
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      await Promise.race([record.promise, callerAbort])
    } finally {
      signal.removeEventListener('abort', abort)
      finishWaiting()
    }
  }

  private async ensureEventStream(signal: AbortSignal): Promise<void> {
    if (this.started) return
    this.started = true
    const controller = new AbortController()
    this.streamController = controller
    const forwardAbort = (): void => controller.abort()
    signal.addEventListener('abort', forwardAbort, { once: true })
    try {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (this.client.host !== undefined) {
        const stream = await this.client.host.subscribe('mux', controller.signal)
        signal.removeEventListener('abort', forwardAbort)
        void this.consumeConnectionStream(stream, controller)
      } else if (this.client.subscribeEvents !== undefined || this.client.subscribe !== undefined) {
        const stream = this.client.subscribeEvents !== undefined
          ? await this.client.subscribeEvents('mux', controller.signal)
          : await this.client.subscribe!('host.events.open', 'host.events.cancel', { kind: 'mux' }, controller.signal)
        signal.removeEventListener('abort', forwardAbort)
        void this.consumeLegacyStream(stream, controller)
      } else {
        signal.removeEventListener('abort', forwardAbort)
        this.client.start({ onMuxFrame: (_rpcId, frame) => this.onMux(frame), onHostFrame: frame => this.onHost(frame), onReopen: () => {} })
      }
    } catch (error) {
      signal.removeEventListener('abort', forwardAbort)
      if (this.streamController === controller) { this.streamController = undefined; this.started = false }
      throw error
    }
  }

  private async consumeConnectionStream(stream: AsyncIterable<Uint8Array>, controller: AbortController): Promise<void> {
    const decoder = new TextDecoder()
    await this.consumeSse(stream, chunk => decoder.decode(chunk, { stream: true }), controller)
  }

  private async consumeLegacyStream(stream: AsyncIterable<{ data: string }>, controller: AbortController): Promise<void> {
    await this.consumeSse(stream, chunk => decodeBase64(chunk.data), controller)
  }

  private async consumeSse<T>(stream: AsyncIterable<T>, decode: (chunk: T) => string, controller: AbortController): Promise<void> {
    let buffered = ''
    try {
      for await (const chunk of stream) {
        if (controller.signal.aborted) return
        buffered += decode(chunk).replaceAll('\r\n', '\n')
        let boundary = buffered.indexOf('\n\n')
        while (boundary >= 0) {
          const frame = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data !== '') {
            try { this.onHost(JSON.parse(data) as HostEventFrame) } catch { /* malformed SSE data does not own connection liveness */ }
          }
          boundary = buffered.indexOf('\n\n')
        }
      }
    } catch { /* stream failure ends this generation; the next consumer reopens it */ }
    finally {
      if (this.streamController === controller) { this.streamController = undefined; this.started = false }
    }
  }

  private stopStream(): void {
    this.streamController?.abort()
    this.streamController = undefined
    if (this.started) this.client.stop()
    this.started = false
  }

  private onMux(frame: MuxFrame): void {
    if (frame.type !== 'session/event' || frame.sessionId === undefined || frame.event === undefined) return
    const sessionId = frame.sessionId
    if (this.detachedSessions.has(sessionId)) return
    const events = this.recent.get(sessionId) ?? []
    if ((events.at(-1)?.seq ?? -1) >= frame.event.seq) return
    const previous = this.snapshots.get(sessionId) ?? snapshotFromRow(sessionId)
    const snapshot = applyEvent(previous, frame.event)
    this.snapshots.set(sessionId, snapshot)
    const envelope: EventEnvelope<BlueSessionSnapshot> = { sessionId, seq: frame.event.seq, event: snapshot }
    events.push(envelope)
    if (events.length > 256) events.shift()
    this.recent.set(sessionId, events)
    for (const listener of this.listeners) listener(envelope)
  }

  private onHost(frame: HostEventFrame): void {
    if (frame === null || typeof frame !== 'object') return
    const payload = frame.payload ?? frame.data ?? frame
    if (typeof payload !== 'object' || payload === null) return
    const value = payload as { payload?: unknown }
    const nested = value.payload ?? payload
    if (typeof nested !== 'object' || nested === null) return
    const event = nested as { type?: unknown; sessionId?: unknown; event?: { type?: unknown; seq?: unknown } }
    if (event.type !== 'session/event' || typeof event.sessionId !== 'string' || event.event === undefined || typeof event.event.seq !== 'number' || typeof event.event.type !== 'string') return
    this.onMux({ type: 'session/event', sessionId: event.sessionId, event: { type: event.event.type, seq: event.event.seq } })
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
    'host-events-v1': ['projection', 'session', 'question', 'approval'],
    'host-events': ['projection', 'session', 'question', 'approval'],
    'writer-lease': ['writeLease'],
    'session-write-lease': ['writeLease'],
    'session-writer-lease-v2': ['writeLease'],
    'question-bridge': ['question'],
    'approval-bridge': ['approval'],
  }
  const mapped = aliases[value]
  if (mapped !== undefined) return mapped
  return ['session', 'action', 'projection', 'question', 'approval', 'writeLease'].includes(value)
    ? [value as RemoteCapabilities['capabilities'][number]]
    : []
}
