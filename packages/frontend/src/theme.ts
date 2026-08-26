/**
 * Renderer-neutral theme model registry. The registry carries semantic token
 * values only; a renderer decides how those values become terminal colors,
 * CSS variables, or another visual representation.
 *
 * @module @dsh-blue/blue-frontend/theme
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ThemeModel } from './models.ts'

declare module '@deepseek-ai/cordis' { interface Context { blueThemeModels: ThemeModelService } }

export class ThemeModelService extends Service {
  private readonly models = new Map<string, ThemeModel>()
  private readonly listeners = new Set<(model: ThemeModel | undefined) => void>()
  private active: string | undefined
  constructor(ctx: Context) { super(ctx, 'blueThemeModels') }
  register(model: ThemeModel): () => void {
    if (this.models.has(model.id)) throw new Error(`theme model "${model.id}" is already registered`)
    this.models.set(model.id, Object.freeze({ ...model, colors: Object.freeze({ ...model.colors }) }))
    if (this.active === undefined) this.active = model.id
    this.emit()
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(model.id); if (this.active === model.id) this.active = this.models.keys().next().value; this.emit() }
  }
  activate(id: string): boolean { if (!this.models.has(id)) return false; this.active = id; this.emit(); return true }
  get current(): ThemeModel | undefined { return this.active === undefined ? undefined : this.models.get(this.active) }
  list(): readonly ThemeModel[] { return [...this.models.values()] }
  subscribe(listener: (model: ThemeModel | undefined) => void): () => void { this.listeners.add(listener); listener(this.current); return () => this.listeners.delete(listener) }
  dispose(): void { this.listeners.clear(); this.models.clear(); this.active = undefined }
  private emit(): void { for (const listener of this.listeners) listener(this.current) }
}
