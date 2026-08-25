import type { EventEnvelope, Unsubscribe } from '@dsh-blue/blue-harness-adapter'

export interface RegistrySource<E> { snapshot(sessionId: string, signal: AbortSignal): Promise<{ readonly watermark: number; readonly value: readonly E[] }>; subscribe(sessionId: string, afterWatermark: number, listener: (event: EventEnvelope<E>) => void): Unsubscribe }
export interface ProjectionRegistration { readonly key: string; dispose(): void }
export interface ProjectionUnit<S, E> { init(): S; apply(state: S, event: E): S }
type Slot<S> = { state: S; watermark: number; sessionId: string; off: Unsubscribe; controller: AbortController; listeners: Set<(state: S, watermark: number) => void> }

/** Multi-session projection registry; one feed per registered projection/session. */
export class ProjectionRegistry {
  private readonly units = new Map<string, { unit: ProjectionUnit<unknown, unknown>; source: RegistrySource<unknown>; slots: Map<string, Slot<unknown>> }>()
  register<S, E>(key: string, unit: ProjectionUnit<S, E>, source: RegistrySource<E>): ProjectionRegistration {
    if (this.units.has(key)) throw new Error(`Projection "${key}" is already registered`)
    const record = { unit: unit as ProjectionUnit<unknown, unknown>, source: source as RegistrySource<unknown>, slots: new Map<string, Slot<unknown>>() }; this.units.set(key, record)
    return {
      key,
      dispose: () => {
        if (this.units.get(key) !== record) return
        for (const slot of record.slots.values()) {
          slot.controller.abort()
          slot.off()
          slot.listeners.clear()
        }
        record.slots.clear()
        this.units.delete(key)
      },
    }
  }
  async attach<S>(key: string, sessionId: string, signal: AbortSignal = new AbortController().signal): Promise<{ readonly ok: true; readonly state: S; readonly watermark: number } | { readonly ok: false; readonly code: 'BLUE_CAPABILITY_ABSENT' | 'BLUE_ABORTED' }> {
    const record = this.units.get(key); if (record === undefined) return { ok: false, code: 'BLUE_CAPABILITY_ABSENT' }
    this.detach(key, sessionId); const controller = new AbortController(); const forward = (): void => controller.abort(); signal.addEventListener('abort', forward, { once: true })
    try { const baseline = await record.source.snapshot(sessionId, controller.signal); if (controller.signal.aborted) return { ok: false, code: 'BLUE_ABORTED' }; const state = baseline.value.reduce((current, event) => record.unit.apply(current, event), record.unit.init()); const slot = { state, watermark: baseline.watermark, sessionId, controller, listeners: new Set<(state: unknown, watermark: number) => void>() } as Slot<unknown>; slot.off = record.source.subscribe(sessionId, baseline.watermark, event => { if (controller.signal.aborted || event.sessionId !== sessionId || event.seq <= slot.watermark) return; slot.state = record.unit.apply(slot.state, event.event); slot.watermark = event.seq; for (const listener of slot.listeners) (listener as (state: unknown, watermark: number) => void)(slot.state, slot.watermark) }); record.slots.set(sessionId, slot); return { ok: true, state: state as S, watermark: slot.watermark } }
    finally { signal.removeEventListener('abort', forward) }
  }
  snapshot<S>(key: string, sessionId: string): Readonly<{ state?: S; watermark: number }> { const slot = this.units.get(key)?.slots.get(sessionId); return { ...(slot === undefined ? {} : { state: slot.state as S }), watermark: slot?.watermark ?? -1 } }
  subscribe<S>(key: string, sessionId: string, listener: (state: S, watermark: number) => void): Unsubscribe { const slot = this.units.get(key)?.slots.get(sessionId); if (slot === undefined) return () => undefined; slot.listeners.add(listener as (state: unknown, watermark: number) => void); listener(slot.state as S, slot.watermark); return () => slot.listeners.delete(listener as (state: unknown, watermark: number) => void) }
  detach(key: string, sessionId: string): void { const slot = this.units.get(key)?.slots.get(sessionId); if (slot === undefined) return; slot.controller.abort(); slot.off(); slot.listeners.clear(); this.units.get(key)?.slots.delete(sessionId) }
  dispose(): void { for (const key of this.units.keys()) { const record = this.units.get(key)!; for (const sessionId of record.slots.keys()) this.detach(key, sessionId); this.units.delete(key) } }
}
