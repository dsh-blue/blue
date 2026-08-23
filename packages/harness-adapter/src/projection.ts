import { absent, success, type AdapterCapability, type AdapterResult, type EventEnvelope, type SnapshotEnvelope, type Unsubscribe } from './types.ts'

export interface HarnessProjectionSource<E> { snapshot(sessionId: string, signal: AbortSignal): Promise<SnapshotEnvelope<readonly E[]>>; subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<E>) => void): Unsubscribe }
export interface ProjectionUnit<S, E> { readonly capability?: AdapterCapability; init(): S; apply(state: S, event: E): S }

/** Projection bridge removal condition: Harness owns a compatible projection registry and resume watermark. */
export class ProjectionBridge<S, E> {
  private state: S | undefined
  private sessionId: string | undefined
  private watermark = -1
  private unsubscribe: Unsubscribe | undefined
  private controller = new AbortController()
  private readonly listeners = new Set<(state: S, watermark: number) => void>()
  constructor(private readonly unit: ProjectionUnit<S, E>, private readonly source?: HarnessProjectionSource<E>) {}
  get snapshot(): Readonly<{ readonly state: S | undefined; readonly watermark: number; readonly sessionId?: string }> { return { state: this.state, watermark: this.watermark, ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }) } }
  subscribe(listener: (state: S, watermark: number) => void): Unsubscribe { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async attach(sessionId: string): Promise<AdapterResult<S>> {
    if (this.source === undefined) return absent('projection')
    this.detach(); const controller = this.controller; const baseline = await this.source.snapshot(sessionId, controller.signal); if (controller.signal.aborted) return { ok: false, code: 'BLUE_ABORTED', message: 'The projection attach was aborted' }
    this.sessionId = sessionId; this.state = baseline.value.reduce((state, event) => this.unit.apply(state, event), this.unit.init()); this.watermark = baseline.watermark; this.emit()
    this.unsubscribe = this.source.subscribe(sessionId, baseline.watermark, event => this.accept(event, controller))
    return success(this.state)
  }
  detach(): void { this.controller.abort(); this.unsubscribe?.(); this.unsubscribe = undefined; this.controller = new AbortController(); this.sessionId = undefined; this.state = undefined; this.watermark = -1 }
  dispose(): void { this.detach(); this.listeners.clear() }
  private accept(event: EventEnvelope<E>, controller: AbortController): void { if (controller.signal.aborted || this.sessionId !== event.sessionId || event.seq <= this.watermark || this.state === undefined) return; this.state = this.unit.apply(this.state, event.event); this.watermark = event.seq; this.emit() }
  private emit(): void { /* c8 ignore next -- detach intentionally clears state before late callbacks can publish */ if (this.state !== undefined) for (const listener of this.listeners) listener(this.state, this.watermark) }
}
