import type { BlueSessionAction, BlueSessionSnapshot, BlueSessionReader, BlueSessionRequester, BlueRegistration, BlueResult } from '@dsh-blue/blue-api'
import { absent, abortResult, AdapterCapabilityAbsentError, failure, staleResult, success, type AdapterResult, type EventEnvelope, type SnapshotEnvelope, type AbortOptions, type Unsubscribe } from './types.ts'

export interface HarnessSessionSource { snapshot(signal: AbortSignal): Promise<SnapshotEnvelope<BlueSessionSnapshot>>; subscribe(afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): Unsubscribe; request(action: BlueSessionAction, signal: AbortSignal): Promise<void> }
export interface SessionBridgeOptions { readonly source?: HarnessSessionSource }

/** Session bridge removal condition: Harness exposes the same snapshot watermark and split read/action facades. */
export class SessionBridge implements BlueSessionReader, BlueSessionRequester {
  private source: HarnessSessionSource | undefined
  private controller = new AbortController()
  private unsubscribe: Unsubscribe | undefined
  private epoch = 0
  private currentSnapshot: BlueSessionSnapshot | null = null
  private watermark = -1
  private readonly listeners = new Set<(snapshot: BlueSessionSnapshot | null) => void>()
  /** Strict read-only facet for a `session.read` owner attachment. */
  readonly reader: BlueSessionReader
  /** Strict action-only facet for a `session.act` owner attachment. */
  readonly requester: BlueSessionRequester

  constructor(options: SessionBridgeOptions = {}) {
    this.source = options.source
    this.reader = Object.freeze({
      current: () => this.current(),
      subscribe: (listener: (snapshot: BlueSessionSnapshot | null) => void) => this.subscribe(listener),
    })
    this.requester = Object.freeze({ request: (action: BlueSessionAction, requestOptions?: AbortOptions) => this.request(action, requestOptions) })
  }
  get sessionEpoch(): number { return this.epoch }
  get attached(): boolean { return this.source !== undefined && this.currentSnapshot !== null }
  async attach(source = this.source): Promise<AdapterResult<BlueSessionSnapshot>> {
    if (source === undefined) return absent('session')
    this.detach(false); const controller = this.controller; const snapshot = await source.snapshot(controller.signal)
    if (controller.signal.aborted) return abortResult<BlueSessionSnapshot>()
    this.source = source; this.watermark = snapshot.watermark; this.currentSnapshot = snapshot.value
    this.unsubscribe = source.subscribe(snapshot.watermark, event => {
      if (event.seq <= this.watermark || event.sessionId !== this.currentSnapshot?.id || controller.signal.aborted) return
      this.watermark = event.seq; this.currentSnapshot = event.event; this.emit()
    })
    this.emit(); return success(snapshot.value)
  }
  current(): BlueSessionSnapshot | null { return this.currentSnapshot }
  subscribe(listener: (snapshot: BlueSessionSnapshot | null) => void): BlueRegistration { this.listeners.add(listener); listener(this.currentSnapshot); let disposed = false; return { get disposed() { return disposed }, dispose: () => { if (!disposed) { disposed = true; this.listeners.delete(listener) } } } }
  async request(action: BlueSessionAction, options: AbortOptions = {}): Promise<BlueResult> {
    const source = this.source; const snapshot = this.currentSnapshot; const epoch = this.epoch; if (source === undefined || snapshot === null) return failure('BLUE_SESSION_UNAVAILABLE', 'No Harness session is attached')
    const controller = new AbortController(); const forward = (): void => controller.abort(); options.signal?.addEventListener('abort', forward, { once: true }); if (options.signal?.aborted) controller.abort()
    try {
      if (controller.signal.aborted) return abortResult()
      await source.request(action, controller.signal)
      return epoch === this.epoch ? success(undefined) : staleResult()
    } catch (error) {
      if (controller.signal.aborted) return abortResult()
      if (error instanceof AdapterCapabilityAbsentError) return failure(error.code, error.message)
      return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error))
    } finally { options.signal?.removeEventListener('abort', forward) }
  }
  detach(emit = true): void { this.controller.abort(); this.unsubscribe?.(); this.unsubscribe = undefined; this.controller = new AbortController(); this.epoch++; this.currentSnapshot = null; this.watermark = -1; if (emit) this.emit() }
  dispose(): void { this.detach(); this.listeners.clear(); this.source = undefined }
  private emit(): void { for (const listener of this.listeners) listener(this.currentSnapshot) }
}
