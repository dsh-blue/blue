import type { BlueResult } from '@dsh-blue/blue-api'
import { ActionCoordinator } from '@dsh-blue/blue-harness-adapter'
import { buildContextModel, contextCommand } from './model.ts'
import { ContextProjection } from './projection.ts'
import type { ContextAction, ContextModel, ContextSnapshot, ContextSource } from './types.ts'
export class ContextFeature {
  readonly projection: ContextProjection
  private readonly actions = new ActionCoordinator()
  private readonly listeners = new Set<(model: ContextModel | undefined) => void>()
  constructor(source?: ContextSource) { this.projection = new ContextProjection(source); this.projection.subscribe(snapshot => this.emit(buildContextModel(snapshot))) }
  get snapshot(): ContextSnapshot | undefined { return this.projection.snapshot }
  get model(): ContextModel | undefined { const snapshot = this.snapshot; return snapshot === undefined ? undefined : buildContextModel(snapshot) }
  get command(): Readonly<{ readonly kind: 'command'; readonly id: string; readonly label: string; readonly enabled: boolean; readonly action: ContextAction }> | undefined { const snapshot = this.snapshot; return snapshot === undefined ? undefined : contextCommand(snapshot.sessionId) }
  subscribe(listener: (model: ContextModel | undefined) => void): () => void { this.listeners.add(listener); listener(this.model); return () => this.listeners.delete(listener) }
  async attach(sessionId: string): Promise<ReturnType<ContextProjection['attach']>> { return this.projection.attach(sessionId) }
  async execute(action: ContextAction): Promise<BlueResult<void>> { if (action.kind === 'context.open') return { ok: true, value: undefined }; if (this.snapshot?.sessionId !== action.sessionId) return { ok: false, code: 'BLUE_SESSION_UNAVAILABLE', message: 'Context session is not attached' }; return this.actions.execute('main', async () => undefined) }
  detach(): void { this.actions.switchSession(); this.projection.detach(); this.emit(undefined) }
  dispose(): void { this.actions.dispose(); this.projection.dispose(); this.listeners.clear() }
  private emit(model: ContextModel | undefined): void { for (const listener of this.listeners) listener(model) }
}
