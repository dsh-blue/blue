import type { FrontendProvider, ProviderContext } from './provider.ts'
import { plainProvider } from './provider.ts'
import { freezeModel, type ProviderModel } from './models.ts'

export type ModelListener = (model: ProviderModel) => void
export class FrontendHost {
  private provider: FrontendProvider = plainProvider
  private generation = 0
  private controller = new AbortController()
  private swapping = false
  private readonly pendingSwaps: Array<{ readonly next: FrontendProvider; readonly restore: boolean; readonly resolve: () => void; readonly reject: (reason?: unknown) => void }> = []
  private disposed = false
  private readonly listeners = new Set<ModelListener>()
  private model: ProviderModel = freezeModel({ providerId: 'plain', capabilities: [], nodes: [] })

  get currentProvider(): FrontendProvider { return this.provider }
  get snapshot(): ProviderModel { return this.model }
  subscribe(listener: ModelListener): () => void { this.listeners.add(listener); listener(this.model); return () => this.listeners.delete(listener) }
  private context(): ProviderContext {
    const generation = this.generation
    return { generation, signal: this.controller.signal, isCurrent: () => !this.disposed && generation === this.generation, publish: model => { if (generation === this.generation && !this.disposed) { this.model = freezeModel(model); for (const listener of this.listeners) listener(this.model) } } }
  }
  async activateInitial(provider: FrontendProvider): Promise<void> { await this.swap(provider, false) }
  async swap(next: FrontendProvider, restore = true): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.pendingSwaps.push({ next, restore, resolve, reject })
      this.drainSwaps()
    })
  }
  private drainSwaps(): void {
    if (this.swapping) return
    const pending = this.pendingSwaps.shift()
    if (pending === undefined) return
    this.swapping = true
    void this.performSwap(pending.next, pending.restore).then(
      () => { pending.resolve(); this.swapping = false; this.drainSwaps() },
      error => { pending.reject(error); this.swapping = false; this.drainSwaps() },
    )
  }
  private async performSwap(next: FrontendProvider, restore: boolean): Promise<void> {
    if (this.disposed) return
    const previous = this.provider
    const state = previous.capture ? await previous.capture(this.controller.signal) : undefined
    if (this.disposed) return
    this.controller.abort(); await previous.dispose?.()
    if (this.disposed) return
    this.generation++; this.controller = new AbortController(); this.provider = next
    try { const context = this.context(); await next.activate(context, state); if (restore && next.restore && state !== undefined) await next.restore(state, context) }
    catch { await next.dispose?.(); this.provider = plainProvider; this.generation++; this.controller = new AbortController(); await plainProvider.activate(this.context()) }
  }
  async unload(): Promise<void> { if (this.disposed) return; this.controller.abort(); await this.provider.dispose?.(); this.disposed = true; this.provider = plainProvider; this.model = freezeModel({ providerId: 'plain', capabilities: [], nodes: [] }); this.listeners.clear() }
}
