import type { BlueResult } from '@dsh-blue/blue-api'
import { ActionCoordinator } from '@dsh-blue/blue-harness-adapter'
import { buildContextModel, contextCommand } from './model.ts'
import { ContextProjection } from './projection.ts'
import type { ContextAction, ContextModel, ContextModelState, ContextSnapshot, ContextSource } from './types.ts'
export class ContextFeature {
  readonly projection: ContextProjection
  private readonly actions = new ActionCoordinator()
  private readonly listeners = new Set<(model: ContextModel | undefined) => void>()
  private state: ContextModelState | undefined
  private error: string | undefined
  constructor(source?: ContextSource) { this.projection = new ContextProjection(source); this.projection.subscribe(snapshot => this.emit(buildContextModel(snapshot))) }
  get snapshot(): ContextSnapshot | undefined { return this.projection.snapshot }
  get model(): ContextModel | undefined { const snapshot = this.snapshot; if (snapshot !== undefined) return buildContextModel(snapshot, this.state ?? 'ready', this.error); if (this.state === undefined) return undefined; return buildContextModel({ sessionId: '', watermark: -1, facts: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, this.state, this.error) }
  get command(): Readonly<{ readonly kind: 'command'; readonly id: string; readonly label: string; readonly enabled: boolean; readonly action: ContextAction }> | undefined { const snapshot = this.snapshot; return snapshot === undefined ? undefined : contextCommand(snapshot.sessionId) }
  subscribe(listener: (model: ContextModel | undefined) => void): () => void { this.listeners.add(listener); listener(this.model); return () => this.listeners.delete(listener) }
  async attach(sessionId: string): Promise<ReturnType<ContextProjection['attach']>> { this.state = 'loading'; this.error = undefined; this.emit(this.model); const result = await this.projection.attach(sessionId); if (result.ok) { this.state = result.value.usage.input === 0 && result.value.usage.output === 0 ? 'empty' : 'ready'; this.emit(this.model) } else { this.state = result.code === 'BLUE_CAPABILITY_ABSENT' ? 'absent' : 'error'; this.error = 'message' in result ? result.message : result.absent.reason; this.emit(this.model) } return result }
  async execute(action: ContextAction): Promise<BlueResult<void>> {
    if (action.kind === 'context.open') return { ok: true, value: undefined }
    if (this.snapshot?.sessionId !== action.sessionId) return { ok: false, code: 'BLUE_SESSION_UNAVAILABLE', message: 'Context session is not attached' }
    this.state = 'loading'; this.error = undefined; this.emit(this.model)
    const result = await this.actions.execute('main', async ({ signal }) => {
      const refreshed = await this.projection.refresh(signal)
      if (!refreshed.ok) throw new Error(refreshed.code === 'BLUE_CAPABILITY_ABSENT' && 'absent' in refreshed ? refreshed.absent.reason : refreshed.message)
    })
    if (result.ok) { this.state = this.snapshot?.facts.input === 0 && this.snapshot.facts.output === 0 ? 'empty' : 'ready'; this.emit(this.model); return { ok: true, value: undefined } }
    this.state = 'error'; this.error = result.message; this.emit(this.model); return result
  }
  detach(): void { this.actions.switchSession(); this.projection.detach(); this.state = undefined; this.error = undefined; this.emit(undefined) }
  dispose(): void { this.actions.dispose(); this.projection.dispose(); this.listeners.clear(); this.state = undefined; this.error = undefined }
  private emit(model: ContextModel | undefined): void { for (const listener of this.listeners) listener(model) }
}
