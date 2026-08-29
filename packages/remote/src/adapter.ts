/**
 * Renderer-neutral remote session adapter. It fences transport generations,
 * converts transport failures to structured Blue results, and owns at most
 * one writer lease for the current remote session.
 *
 * @module @dsh-blue/blue-remote/adapter
 */

import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import { abortResult, failure, success, type EventEnvelope, type HarnessSessionSource, type Unsubscribe } from '@dsh-blue/blue-harness-adapter'
import type { RemoteCapability, RemoteCapabilities, RemoteResult, RemoteSessionAction, RemoteTransport, WriteLease } from './types.ts'

const noSource = <T>(capability: RemoteCapability): RemoteResult<T> => ({ ok: false, code: 'BLUE_CAPABILITY_ABSENT', capability })

/** One background transport failure that cannot be returned to a caller. */
export interface RemoteDiagnostic {
  readonly operation: 'lease.release'
  readonly sessionId: string
  readonly code: 'BLUE_ACTION_REJECTED'
  readonly message: string
}

/** Runtime seams for deterministic lease expiry and background diagnostics. */
export interface RemoteSessionAdapterOptions {
  readonly now?: () => number
  readonly onDiagnostic?: (diagnostic: RemoteDiagnostic) => void
}

interface LeaseAcquisition {
  readonly sessionId: string
  readonly generation: number
  readonly controller: AbortController
  waiters: number
  promise: Promise<RemoteResult<WriteLease>>
}

interface LeaseRelease {
  readonly sessionId: string
  readonly generation: number
  readonly lease: WriteLease
  promise: Promise<RemoteResult<void>>
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Thin dsh-remote proxy. It owns transport state, never Agent/Session objects. */
export class RemoteSessionAdapter implements HarnessSessionSource {
  private controller = new AbortController()
  private unsubscribe: Unsubscribe | undefined
  private generation = 0
  private currentSession: string | undefined
  private remoteCapabilities: RemoteCapabilities | undefined
  private lease: WriteLease | undefined
  private leaseAcquisition: LeaseAcquisition | undefined
  private leaseRelease: LeaseRelease | undefined

  constructor(
    private readonly transport: RemoteTransport,
    private readonly options: RemoteSessionAdapterOptions = {},
  ) {}

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
    } catch (error) {
      return controller.signal.aborted ? abortResult() : failure('BLUE_API_INCOMPATIBLE', describe(error))
    } finally {
      signal.removeEventListener('abort', forward)
    }
  }

  snapshot(signal: AbortSignal): Promise<Readonly<{ watermark: number; value: BlueSessionSnapshot }>> {
    if (this.currentSession === undefined || !this.capabilities.includes('session')) return Promise.reject(new Error('remote session unavailable'))
    return this.transport.snapshot(this.currentSession, signal)
  }

  subscribe(afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): Unsubscribe {
    const sessionId = this.currentSession
    const generation = this.generation
    let watermark = afterWatermark
    if (sessionId === undefined || !this.capabilities.includes('session')) return () => undefined
    const off = this.transport.subscribe(sessionId, afterWatermark, event => {
      if (generation === this.generation && !this.controller.signal.aborted && event.sessionId === this.currentSession && event.seq > watermark) {
        watermark = event.seq
        listener(event)
      }
    })
    this.unsubscribe = off
    return () => {
      if (this.unsubscribe === off) this.unsubscribe = undefined
      off()
    }
  }

  async request(action: RemoteSessionAction, signal: AbortSignal): Promise<void> {
    if (this.currentSession === undefined || !this.capabilities.includes('action')) throw new Error('remote action unavailable')
    return this.transport.request(this.currentSession, action, signal)
  }

  async acquireWriteLease(signal: AbortSignal = new AbortController().signal): Promise<RemoteResult<WriteLease>> {
    const sessionId = this.currentSession
    const acquire = this.transport.acquireWriteLease
    if (sessionId === undefined || !this.capabilities.includes('writeLease') || acquire === undefined) return noSource('writeLease')
    if (signal.aborted) return abortResult()

    const current = this.lease
    if (current !== undefined && this.leaseIsCurrent(current)) return success(current)
    if (current !== undefined) {
      this.lease = undefined
      await this.releaseDetachedLease(sessionId, current)
    }

    const generation = this.generation
    const pending = this.leaseAcquisition
    if (pending !== undefined && pending.sessionId === sessionId && pending.generation === generation) return this.waitForLease(pending, signal)

    const controller = new AbortController()
    const lifecycle = this.controller.signal
    const abort = (): void => controller.abort()
    lifecycle.addEventListener('abort', abort, { once: true })

    const record: LeaseAcquisition = {
      sessionId,
      generation,
      controller,
      waiters: 0,
      promise: Promise.resolve(abortResult<WriteLease>()),
    }
    this.leaseAcquisition = record
    record.promise = (async (): Promise<RemoteResult<WriteLease>> => {
      try {
        const granted = await acquire.call(this.transport, sessionId, controller.signal)
        if (controller.signal.aborted || generation !== this.generation || sessionId !== this.currentSession) {
          await this.releaseDetachedLease(sessionId, granted)
          return abortResult()
        }
        if (!this.leaseIsCurrent(granted)) {
          await this.releaseDetachedLease(sessionId, granted)
          return failure('BLUE_ACTION_REJECTED', 'remote writer lease was already expired')
        }
        this.lease = granted
        return success(granted)
      } catch (error) {
        return controller.signal.aborted ? abortResult() : failure('BLUE_ACTION_REJECTED', describe(error))
      } finally {
        lifecycle.removeEventListener('abort', abort)
        if (this.leaseAcquisition === record) this.leaseAcquisition = undefined
      }
    })()
    return this.waitForLease(record, signal)
  }

  async releaseWriteLease(): Promise<RemoteResult<void>> {
    const sessionId = this.currentSession
    if (sessionId === undefined) return success(undefined)
    const acquisition = this.leaseAcquisition
    if (acquisition !== undefined && acquisition.sessionId === sessionId) {
      acquisition.controller.abort()
      await acquisition.promise
    }
    const pending = this.leaseRelease
    if (pending !== undefined && pending.sessionId === sessionId && pending.generation === this.generation) return pending.promise
    const lease = this.lease
    if (lease === undefined) return success(undefined)
    this.lease = undefined
    const release = this.transport.releaseWriteLease
    if (release === undefined) return success(undefined)
    const generation = this.generation
    const record: LeaseRelease = {
      sessionId,
      generation,
      lease,
      promise: Promise.resolve(success<void>(undefined)),
    }
    this.leaseRelease = record
    record.promise = (async (): Promise<RemoteResult<void>> => {
      try {
        await release.call(this.transport, sessionId, lease)
        return success(undefined)
      } catch (error) {
        const message = describe(error)
        if (generation === this.generation && sessionId === this.currentSession && this.lease === undefined) this.lease = lease
        this.report({ operation: 'lease.release', sessionId, code: 'BLUE_ACTION_REJECTED', message })
        return failure('BLUE_ACTION_REJECTED', message)
      } finally {
        if (this.leaseRelease === record) this.leaseRelease = undefined
      }
    })()
    return record.promise
  }

  questionSource(): { ask(question: unknown, signal: AbortSignal): Promise<unknown>; approve(question: unknown, signal: AbortSignal): Promise<unknown> } | undefined {
    if (this.currentSession === undefined) return undefined
    const sessionId = this.currentSession
    return {
      ask: async (question, signal) => {
        if (!this.capabilities.includes('question') || this.transport.ask === undefined) throw new Error('remote question unavailable')
        return this.transport.ask(sessionId, question, signal)
      },
      approve: async (question, signal) => {
        if (!this.capabilities.includes('approval') || this.transport.approve === undefined) throw new Error('remote approval unavailable')
        return this.transport.approve(sessionId, question, signal)
      },
    }
  }

  disconnect(): void {
    this.generation++
    this.controller.abort()
    this.leaseAcquisition?.controller.abort()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    const lease = this.lease
    const sessionId = this.currentSession
    this.lease = undefined
    if (lease !== undefined && sessionId !== undefined) void this.releaseDetachedLease(sessionId, lease)
    if (sessionId !== undefined) this.transport.detach?.(sessionId)
    this.controller = new AbortController()
    this.currentSession = undefined
    this.remoteCapabilities = undefined
  }

  dispose(): void {
    this.disconnect()
    this.transport.dispose?.()
  }

  private leaseIsCurrent(lease: WriteLease): boolean {
    return lease.expiresAt === Number.POSITIVE_INFINITY
      || (Number.isFinite(lease.expiresAt) && lease.expiresAt > (this.options.now ?? Date.now)())
  }

  private async waitForLease(record: LeaseAcquisition, signal: AbortSignal): Promise<RemoteResult<WriteLease>> {
    record.waiters += 1
    let waiting = true
    const finishWaiting = (): void => {
      if (!waiting) return
      waiting = false
      record.waiters -= 1
    }
    let abort!: () => void
    const callerAbort = new Promise<RemoteResult<WriteLease>>(resolve => {
      abort = () => {
        finishWaiting()
        if (record.waiters === 0 && this.leaseAcquisition === record) record.controller.abort()
        resolve(abortResult())
      }
      signal.addEventListener('abort', abort, { once: true })
    })
    try {
      return await Promise.race([record.promise, callerAbort])
    } finally {
      signal.removeEventListener('abort', abort)
      finishWaiting()
    }
  }

  private async releaseDetachedLease(sessionId: string, lease: WriteLease): Promise<void> {
    const release = this.transport.releaseWriteLease
    if (release === undefined) return
    try {
      await release.call(this.transport, sessionId, lease)
    } catch (error) {
      this.report({ operation: 'lease.release', sessionId, code: 'BLUE_ACTION_REJECTED', message: describe(error) })
    }
  }

  private report(diagnostic: RemoteDiagnostic): void {
    try { this.options.onDiagnostic?.(diagnostic) } catch { /* diagnostics cannot own remote lifecycle */ }
  }
}
