import type { BlueSessionSnapshot, BlueSessionReader, BlueRegistration } from '@dsh-blue/blue-api'
import { absent, abortResult, success, type AdapterResult, type EventEnvelope, type SnapshotEnvelope, type Unsubscribe } from './types.ts'

export interface HarnessSessionSource { snapshot(signal: AbortSignal): Promise<SnapshotEnvelope<BlueSessionSnapshot>>; subscribe(afterWatermark: number, listener: (event: EventEnvelope<BlueSessionSnapshot>) => void): Unsubscribe }
export interface SessionBridgeOptions { readonly source?: HarnessSessionSource }

/** Session bridge removal condition: Harness exposes the same snapshot watermark and readonly facade. */
export class SessionBridge implements BlueSessionReader {
  private source: HarnessSessionSource | undefined
  private controller = new AbortController()
  private unsubscribe: Unsubscribe | undefined
  private epoch = 0
  private currentSnapshot: BlueSessionSnapshot | null = null
  private watermark = -1
  private readonly listeners = new Set<(snapshot: BlueSessionSnapshot | null) => void>()
  /** Strict read-only facet for a `session.read` owner attachment. */
  readonly reader: BlueSessionReader

  constructor(options: SessionBridgeOptions = {}) {
    this.source = options.source
    this.reader = Object.freeze({
      current: () => this.current(),
      subscribe: (listener: (snapshot: BlueSessionSnapshot | null) => void) => this.subscribe(listener),
    })
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
  detach(emit = true): void { this.controller.abort(); this.unsubscribe?.(); this.unsubscribe = undefined; this.controller = new AbortController(); this.epoch++; this.currentSnapshot = null; this.watermark = -1; if (emit) this.emit() }
  dispose(): void { this.detach(); this.listeners.clear(); this.source = undefined }
  private emit(): void { for (const listener of this.listeners) listener(this.currentSnapshot) }
}
