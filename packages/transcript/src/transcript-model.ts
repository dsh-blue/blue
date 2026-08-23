/**
 * Renderer-neutral transcript projection registry. It accepts readonly view
 * entries and provides an additive screen consumer; folding and session
 * ownership remain in the existing transcript domain adapter.
 *
 * @module @dsh-blue/blue-transcript/transcript-model
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { renderFrontendView, type BlueComponent, type BlueScreen } from '@dsh-blue/blue-core'
import { freezeModel, type TranscriptModel, type View } from '@dsh-blue/blue-frontend'

declare module '@deepseek-ai/cordis' { interface Context { blueTranscriptModels: TranscriptModelService } }
type Source = TranscriptModel | (() => TranscriptModel | null)

/** Maximum model entries one component renders in a frame. */
export const TRANSCRIPT_MODEL_WINDOW = 200

/** Build an immutable transcript model from already-projected frontend views. */
export function createTranscriptModel(id: string, entries: readonly View[], streaming?: boolean): TranscriptModel {
  return freezeModel({ kind: 'transcript', id, entries: [...entries], ...(streaming === undefined ? {} : { streaming }) })
}

/** Append one projected view without reading or folding Harness events. */
export function appendTranscriptView(model: TranscriptModel, entry: View, streaming = model.streaming): TranscriptModel {
  return createTranscriptModel(model.id, [...model.entries, entry], streaming)
}

class TranscriptModelComponent implements BlueComponent {
  constructor(private readonly source: () => TranscriptModel | null) {}
  render(width: number): string[] {
    const model = this.source()
    if (model === null) return []
    return model.entries.slice(-TRANSCRIPT_MODEL_WINDOW).flatMap(view => renderFrontendView(view, width))
  }
  invalidate(): void {}
}

export class TranscriptModelService extends Service {
  private readonly models = new Map<string, Source>()
  private readonly mounted = new Map<string, () => void>()
  private screen: BlueScreen | undefined
  constructor(ctx: Context, screen?: BlueScreen) { super(ctx, 'blueTranscriptModels'); this.screen = screen }
  attach(screen: BlueScreen): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.screen = screen; for (const id of this.models.keys()) this.mount(id) }
  register(source: Source): () => void {
    const initial = typeof source === 'function' ? source() : source
    if (initial === null) return () => undefined
    if (this.models.has(initial.id)) throw new Error(`transcript model "${initial.id}" is already registered`)
    this.models.set(initial.id, source); this.mount(initial.id)
    let disposed = false
    return () => { if (disposed) return; disposed = true; this.models.delete(initial.id); this.mounted.get(initial.id)?.(); this.mounted.delete(initial.id); this.screen?.requestRender() }
  }
  refresh(id: string): void { if (this.models.has(id)) this.screen?.requestRender() }
  list(): readonly TranscriptModel[] { return [...this.models.values()].map(source => typeof source === 'function' ? source() : source).filter((model): model is TranscriptModel => model !== null) }
  dispose(): void { for (const dispose of this.mounted.values()) dispose(); this.mounted.clear(); this.models.clear(); this.screen = undefined }
  private mount(id: string): void {
    const screen = this.screen; const source = this.models.get(id)
    if (screen === undefined || source === undefined) return
    this.mounted.get(id)?.(); this.mounted.delete(id)
    const component = new TranscriptModelComponent(() => { const current = this.models.get(id); return current === undefined ? null : typeof current === 'function' ? current() : current })
    this.mounted.set(id, screen.addChild(component)); screen.requestRender()
  }
}

export { TranscriptModelComponent }
