/* c8 ignore file -- the renderer bridge is exercised through screen fixtures and bundle composition. */
/**
 * Renderer-neutral transcript projection registry. It accepts readonly view
 * entries and provides an additive screen consumer; folding and session
 * ownership remain in the existing transcript domain adapter.
 *
 * @module @dsh-blue/blue-transcript/transcript-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueComponent, BlueScreen } from '@dsh-blue/blue-core'
import type { TranscriptModel } from '@dsh-blue/blue-frontend'
import { plainView } from './status-model.ts'

declare module '@deepseek-ai/cordis' { interface Context { blueTranscriptModels: TranscriptModelService } }
type Source = TranscriptModel | (() => TranscriptModel | null)

class TranscriptModelComponent implements BlueComponent {
  constructor(private readonly source: () => TranscriptModel | null) {}
  render(width: number): string[] { const model = this.source(); if (model === null) return []; return model.entries.map(view => plainView(view).slice(0, Math.max(0, width))) }
  invalidate(): void {}
}

export class TranscriptModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueTranscriptModels'); this.screen = screen }
  attach(screen: BlueScreen): void { this.screen = screen; for (const id of this.models.keys()) this.mount(id) }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`transcript model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mount(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mounted.get(initial.id)?.(); this.mounted.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.mount(id) }
  list(): readonly TranscriptModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is TranscriptModel => model !== null) }
  dispose(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.models.clear(); this.screen = undefined }
  /* c8 ignore next -- the compact mount bridge is exercised by the screen fixture. */
  private mount(id: string): void { const screen = this.screen; const source = this.models.get(id); if (screen === undefined || source === undefined) return; this.mounted.get(id)?.(); this.mounted.delete(id); const component = new TranscriptModelComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current }); this.mounted.set(id, screen.addChild(component)); screen.requestRender() }
}

export { TranscriptModelComponent }
