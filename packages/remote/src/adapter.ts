import type { BlueSessionAction, BlueSessionSnapshot } from '@dsh-blue/blue-api'
import { abortResult, failure, success, type EventEnvelope, type HarnessSessionSource, type Unsubscribe } from '@dsh-blue/blue-harness-adapter'
import type { RemoteCapability, RemoteCapabilities, RemoteResult, RemoteTransport, WriteLease } from './types.ts'

const noSource = <T>(capability: RemoteCapability): RemoteResult<T> => ({ ok: false, code: 'BLUE_CAPABILITY_ABSENT', capability })

/** Thin dsh-remote proxy. It owns transport state, never Agent/Session objects. */
export class RemoteSessionAdapter implements HarnessSessionSource {
  private controller = new AbortController()
  private unsubscribe: Unsubscribe | undefined
  private generation = 0
  private currentSession: string | undefined
  private remoteCapabilities: RemoteCapabilities | undefined
  private lease: WriteLease | undefined
  constructor(private readonly transport: RemoteTransport) {}
  get capabilities(): readonly string[] { return this.remoteCapabilities?.capabilities ?? [] }
  get sessionId(): string | undefined { return this.currentSession }
  get protocol(): string | undefined { return this.remoteCapabilities?.protocol }
  async connect(sessionId: string, signal: AbortSignal = new AbortController().signal): Promise<RemoteResult<BlueSessionSnapshot>> {
    this.disconnect()
    const generation = ++this.generation
    const controller = this.controller
    const forward = (): void => controller.abort()
    signal.addEventListener('abort', forward, { once: true })
    try {
      if (signal.aborted) return abortResult()
      const capabilities = await this.transport.negotiate(controller.signal)
      if (controller.signal.aborted || generation !== this.generation) return abortResult()
      this.remoteCapabilities = capabilities
      if (!capabilities.capabilities.includes('session')) return noSource('session')
      this.currentSession = sessionId
      const snapshot = await this.snapshot(controller.signal)
      return success(snapshot.value)
    } catch (error) { return controller.signal.aborted ? abortResult() : failure('BLUE_API_INCOMPATIBLE', error instanceof Error ? error.message : String(error)) }
    finally { signal.removeEventListener('abort', forward) }
  }
  snapshot(signal: AbortSignal): Promise<Readonly<{ watermark: number; value: BlueSessionSnapshot }>> {
    if (this.currentSession === undefined || !this.capabilities.includes('session')) return Promise.reject(new Error('remote session unavailable'))
    return this.transport.snapshot(this.currentSession, signal)
  }
  subscribe(afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): Unsubscribe {
    const sessionId = this.currentSession; const generation = this.generation; let watermark = afterWatermark
    if (sessionId === undefined || !this.capabilities.includes('session')) return () => undefined
    const off = this.transport.subscribe(sessionId, afterWatermark, event => {
      if (generation === this.generation && !this.controller.signal.aborted && event.sessionId === this.currentSession && event.seq > watermark) { watermark = event.seq; listener(event) }
    })
    this.unsubscribe = off
    return () => { if (this.unsubscribe === off) this.unsubscribe = undefined; off() }
  }
  async request(action: BlueSessionAction, signal: AbortSignal): Promise<void> {
    if (this.currentSession === undefined || !this.capabilities.includes('action')) throw new Error('remote action unavailable')
    return this.transport.request(this.currentSession, action, signal)
  }
  async acquireWriteLease(signal: AbortSignal = new AbortController().signal): Promise<RemoteResult<WriteLease>> {
    if (this.currentSession === undefined || !this.capabilities.includes('writeLease') || this.transport.acquireWriteLease === undefined) return noSource('writeLease')
    try { if (signal.aborted) return abortResult(); this.lease = await this.transport.acquireWriteLease(this.currentSession, signal); return success(this.lease) }
    catch (error) { return signal.aborted ? abortResult() : failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  async releaseWriteLease(): Promise<RemoteResult<void>> {
    const lease = this.lease; if (lease === undefined || this.currentSession === undefined || this.transport.releaseWriteLease === undefined) return success(undefined)
    try { await this.transport.releaseWriteLease(this.currentSession, lease); this.lease = undefined; return success(undefined) }
    catch (error) { return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  questionSource(): { ask(question: unknown, signal: AbortSignal): Promise<unknown>; approve(question: unknown, signal: AbortSignal): Promise<unknown> } | undefined {
    if (this.currentSession === undefined) return undefined
    const sessionId = this.currentSession
    return {
      ask: async (question, signal) => { if (!this.capabilities.includes('question') || this.transport.ask === undefined) throw new Error('remote question unavailable'); return this.transport.ask(sessionId, question, signal) },
      approve: async (question, signal) => { if (!this.capabilities.includes('approval') || this.transport.approve === undefined) throw new Error('remote approval unavailable'); return this.transport.approve(sessionId, question, signal) },
    }
  }
  disconnect(): void {
    this.controller.abort()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const lease = this.lease
    const sessionId = this.currentSession
    this.lease = undefined
    if (lease !== undefined && sessionId !== undefined && this.transport.releaseWriteLease !== undefined) void this.transport.releaseWriteLease(sessionId, lease).catch(() => undefined)
    this.controller = new AbortController()
    this.currentSession = undefined
    this.remoteCapabilities = undefined
    this.generation++
  }
  dispose(): void { this.disconnect() }
}
