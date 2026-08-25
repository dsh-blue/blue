/**
 * Renderer-neutral dock registry and the Blue screen consumer bridge.
 *
 * @module @dsh-blue/blue-transcript/dock-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { renderFrontendView, type BlueComponent, type BlueScreen } from '@dsh-blue/blue-core'
import type { DockModel } from '@dsh-blue/blue-frontend'

declare module '@deepseek-ai/cordis' {
  interface Context { blueDockModels: BlueDockModelService }
}

type Source = DockModel | (() => DockModel | null)

/** Width-bounded TUI consumer for one dock model source. */
class ModelDockComponent implements BlueComponent {
  constructor(private readonly source: () => DockModel | null) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null || model.collapsed) return []
    const rows = [...renderFrontendView(model.view, width)]
    return model.preferredRows === undefined ? rows : rows.slice(0, Math.max(0, model.preferredRows))
  }
  invalidate(): void {}
}

/** Renderer-neutral dock registry with the official screen consumer bridge. */
export class BlueDockModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueDockModels'); this.screen = screen }
  attach(screen: BlueScreen): void { this.unmountAll(); this.screen = screen; this.mountAll() }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`dock model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mountAll()
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mountAll() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.mountAll() }
  list(): readonly DockModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is DockModel => model !== null) }
  dispose(): void { this.unmountAll(); this.models.clear(); this.screen = undefined }
  private unmountAll(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear() }
  private mountAll(): void {
    const screen = this.screen
    if (screen === undefined) return
    this.unmountAll()
    const rows = [...this.models.entries()].map(([id, source]) => ({ id, source, model: typeof source === 'function' ? source() : source }))
      .filter((row): row is { id: string; source: Source; model: DockModel } => row.model !== null && row.model.collapsed !== true)
      .sort((left, right) => placementOrder(left.model.placement) - placementOrder(right.model.placement)
        || (left.model.priority ?? 0) - (right.model.priority ?? 0)
        || left.id.localeCompare(right.id))
    for (const row of rows) this.mount(row.id)
    screen.requestRender()
  }
  private mount(id: string): void {
    const screen = this.screen; const source = this.models.get(id)
    if (screen === undefined || source === undefined) return
    this.mounted.get(id)?.(); this.mounted.delete(id)
    const model = typeof source === 'function' ? source() : source
    if (model === null || model.collapsed) return
    const component = new ModelDockComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current })
    const dispose = model.placement === 'bottom' ? screen.addBottomChild(component) : screen.addChild(component)
    this.mounted.set(id, dispose)
  }
}

function placementOrder(placement: DockModel['placement']): number {
  return placement === 'left' ? 0 : placement === 'right' ? 1 : 2
}

export { ModelDockComponent }
