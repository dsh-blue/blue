import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { ToolPresentationModel } from '@dsh-blue/blue-frontend'
import { plainView } from './status-model.ts'

declare module '@deepseek-ai/cordis' { interface Context { blueToolModels: BlueModelToolService } }

type Source = ToolPresentationModel | (() => ToolPresentationModel | null)

class ToolModelComponent implements BlueComponent {
  constructor(private readonly source: () => ToolPresentationModel | null) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null) return []
    const view = model.expanded === false ? model.call : model.result ?? model.call
    return view === undefined ? [] : [plainView(view).slice(0, Math.max(0, width))]
  }
  invalidate(): void {}
}

/** Renderer-neutral tool presentation registry with an additive TUI bridge. */
export class BlueModelToolService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueToolModels'); this.screen = screen }
  attach(screen: BlueScreen): void { this.screen = screen; for (const id of this.models.keys()) this.mount(id) }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`tool model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mount(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mounted.get(initial.id)?.(); this.mounted.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.mount(id) }
  list(): readonly ToolPresentationModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is ToolPresentationModel => model !== null) }
  dispose(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.models.clear(); this.screen = undefined }
  private mount(id: string): void {
    const screen = this.screen; const source = this.models.get(id)
    if (screen === undefined || source === undefined) return
    this.mounted.get(id)?.(); this.mounted.delete(id)
    /* c8 ignore next -- the closure's deleted-source branch is exercised by unload fixtures. */
    const component = new ToolModelComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current })
    this.mounted.set(id, screen.addChild(component)); screen.requestRender()
  }
}

export { ToolModelComponent }
export { BlueModelToolService as ToolModelService }
