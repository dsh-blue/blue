/**
 * Renderer-neutral dock registry and the Blue screen consumer bridge.
 *
 * @module @dsh-blue/blue-transcript/dock-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { GutterComponent, renderFrontendView, type BlueComponent, type BlueScreen } from '@dsh-blue/blue-core'
import type { DockModel } from '@dsh-blue/blue-frontend'

declare module '@deepseek-ai/cordis' {
  interface Context { blueDockModels: BlueDockModelService }
}

type Source = DockModel | (() => DockModel | null)
type Renderer = (model: DockModel, width: number) => string[]

/** Width-bounded TUI consumer for one dock model source. */
class ModelDockComponent implements BlueComponent {
  constructor(
    private readonly source: () => DockModel | null,
    private readonly renderer?: Renderer,
  ) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null || model.collapsed) return []
    if (this.renderer !== undefined) return this.renderer(model, width)
    const rows = [...renderFrontendView(model.view, width)]
    return model.preferredRows === undefined ? rows : rows.slice(0, Math.max(0, model.preferredRows))
  }
  invalidate(): void {}
}

/** Stable renderer root for one placement lane. */
class ModelDockGroupComponent implements BlueComponent {
  constructor(private readonly children: () => readonly BlueComponent[]) {}
  render(width: number): string[] {
    return this.children().flatMap(component => component.render(width))
  }
  invalidate(): void {
    for (const component of this.children()) component.invalidate()
  }
}

/** Renderer-neutral dock registry with the official screen consumer bridge. */
export class BlueDockModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly components = new Map<string, BlueComponent>()
  private readonly groups = {
    left: new ModelDockGroupComponent(() => this.orderedComponents('left')),
    right: new ModelDockGroupComponent(() => this.orderedComponents('right')),
    bottom: new ModelDockGroupComponent(() => this.orderedComponents('bottom')),
  }
  private readonly mounted = new Map<DockModel['placement'], () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) {
    super(ctx, 'blueDockModels')
    if (screen !== undefined) this.attach(screen)
  }
  attach(screen: BlueScreen): void { this.unmountAll(); this.screen = screen; this.mountGroups(screen) }
  register(source: Source, renderer?: Renderer): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`dock model "${initial.id}" is already registered`)
    this.models.set(initial.id, source)
    const component = new ModelDockComponent(
      () => { const current = this.models.get(initial.id); return current === undefined ? null : typeof current === 'function' ? current() : current },
      renderer,
    )
    this.components.set(initial.id, renderer === undefined ? component : new GutterComponent(component))
    this.syncSideGroups()
    this.screen?.requestRender()
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.models.delete(initial.id)
      this.components.delete(initial.id)
      this.syncSideGroups()
      this.screen?.requestRender()
    }
  }
  refresh(id: string, force?: boolean): void {
    if (!this.models.has(id)) return
    this.syncSideGroups()
    this.components.get(id)?.invalidate()
    this.screen?.requestRender(force)
  }
  list(): readonly DockModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is DockModel => model !== null) }
  dispose(): void { this.unmountAll(); this.models.clear(); this.components.clear(); this.screen = undefined }
  private unmountAll(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear() }
  private mountGroups(screen: BlueScreen): void {
    this.mounted.set('bottom', screen.addBottomChild(this.groups.bottom))
    this.syncSideGroups()
    screen.requestRender()
  }
  private syncSideGroups(): void {
    const screen = this.screen
    if (screen === undefined) return
    for (const placement of ['left', 'right'] as const) {
      const present = this.orderedComponents(placement).length > 0
      const dispose = this.mounted.get(placement)
      if (present && dispose === undefined) this.mounted.set(placement, screen.addChild(this.groups[placement]))
      if (!present && dispose !== undefined) {
        dispose()
        this.mounted.delete(placement)
      }
    }
  }
  private orderedComponents(placement: DockModel['placement']): readonly BlueComponent[] {
    return [...this.models.entries()].map(([id, source]) => ({ id, model: typeof source === 'function' ? source() : source }))
      .filter((row): row is { id: string; model: DockModel } => row.model !== null)
      .filter(row => row.model.placement === placement)
      .sort((left, right) => (left.model.priority ?? 0) - (right.model.priority ?? 0)
        || left.id.localeCompare(right.id))
      .map(row => this.components.get(row.id))
      .filter((component): component is BlueComponent => component !== undefined)
  }
}

export { ModelDockComponent, ModelDockGroupComponent }
