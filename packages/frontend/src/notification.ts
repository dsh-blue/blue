/**
 * Renderer-neutral notification registry. Notifications are immutable data;
 * renderers decide toast, status, or log presentation. Dedupe keys collapse
 * repeated external events without retaining a second domain store.
 *
 * @module @dsh-blue/blue-frontend/notification
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { NotificationModel } from './models.ts'

declare module '@deepseek-ai/cordis' { interface Context { blueNotifications: NotificationModelService } }

export class NotificationModelService extends Service {
  private readonly models = new Map<string, NotificationModel>()
  private readonly dedupe = new Map<string, string>()
  private readonly listeners = new Set<(models: readonly NotificationModel[]) => void>()
  constructor(ctx: Context) { super(ctx, 'blueNotifications') }
  push(model: NotificationModel): () => void {
    const existing = model.dedupeKey === undefined ? undefined : this.dedupe.get(model.dedupeKey)
    if (existing !== undefined) this.models.delete(existing)
    if (model.dedupeKey !== undefined) this.dedupe.set(model.dedupeKey, model.id)
    this.models.set(model.id, Object.freeze({ ...model })); this.emit()
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.dismiss(model.id) }
  }
  dismiss(id: string): boolean {
    const model = this.models.get(id); if (model === undefined) return false
    this.models.delete(id); if (model.dedupeKey !== undefined && this.dedupe.get(model.dedupeKey) === id) this.dedupe.delete(model.dedupeKey); this.emit(); return true
  }
  list(): readonly NotificationModel[] { return [...this.models.values()] }
  subscribe(listener: (models: readonly NotificationModel[]) => void): () => void { this.listeners.add(listener); listener(this.list()); return () => this.listeners.delete(listener) }
  dispose(): void { this.listeners.clear(); this.models.clear(); this.dedupe.clear() }
  private emit(): void { const models = this.list(); for (const listener of this.listeners) listener(models) }
}
