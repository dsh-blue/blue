import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { DockModel } from '@dsh-blue/blue-frontend'
import { plainView } from './status-model.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueDockModels: BlueDockModelService }
}

type Source = DockModel | (() => DockModel | null)

class ModelDockComponent implements BlueComponent {
  constructor(private readonly source: () => DockModel | null) {}
  render(width: number): string[] { const model = this.source(); if (model === null || model.collapsed) return []; return [plainView(model.view).slice(0, Math.max(0, width))] }
  invalidate(): void {}
}

/** Renderer-neutral dock registry with the official screen consumer bridge. */
export class BlueDockModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueDockModels'); this.screen = screen }
  attach(screen: BlueScreen): void { this.screen = screen; for (const id of this.models.keys()) this.mount(id) }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`dock model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mount(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mounted.get(initial.id)?.(); this.mounted.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.mount(id) }
  list(): readonly DockModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is DockModel => model !== null) }
  dispose(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.models.clear(); this.screen = undefined }
  private mount(id: string): void {
    const screen = this.screen; const source = this.models.get(id)
    if (screen === undefined || source === undefined) return
    this.mounted.get(id)?.(); this.mounted.delete(id)
    const model = typeof source === 'function' ? source() : source
    if (model === null || model.collapsed) return
    const component = new ModelDockComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current })
    const dispose = model.placement === 'bottom' ? screen.addBottomChild(component) : screen.addChild(component)
    this.mounted.set(id, dispose); screen.requestRender()
  }
}

export { ModelDockComponent }
