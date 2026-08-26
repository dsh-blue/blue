import type { BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type { ActionCoordinator, AdapterResult, SessionBridge } from '@dsh-blue/blue-harness-adapter'

export class CurrentSessionBinding {
  private generation = 0
  private currentSession: string | undefined
  private currentSnapshot: BlueSessionSnapshot | undefined
  private readonly listeners = new Set<(snapshot: BlueSessionSnapshot | undefined) => void>()
  constructor(private readonly session: SessionBridge, private readonly actions: ActionCoordinator) {}
  get sessionId(): string | undefined { return this.currentSession }
  get snapshot(): BlueSessionSnapshot | undefined { return this.currentSnapshot }
  subscribe(listener: (snapshot: BlueSessionSnapshot | undefined) => void): () => void { this.listeners.add(listener); listener(this.currentSnapshot); return () => this.listeners.delete(listener) }
  async switchTo(source: Parameters<SessionBridge['attach']>[0], sessionId?: string): Promise<AdapterResult<BlueSessionSnapshot>> {
    const generation = ++this.generation; this.actions.switchSession(); this.session.detach()
    const result = await this.session.attach(source)
    if (generation !== this.generation) return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'The session binding result is stale' }
    if (!result.ok) { this.currentSession = undefined; this.currentSnapshot = undefined; this.emit(); return result }
    this.currentSession = sessionId ?? result.value.id; this.currentSnapshot = result.value; this.emit(); return result
  }
  detach(): void { this.generation++; this.actions.switchSession(); this.session.detach(); this.currentSession = undefined; this.currentSnapshot = undefined; this.emit() }
  dispose(): void { this.detach(); this.listeners.clear(); this.session.dispose(); this.actions.dispose() }
  private emit(): void { for (const listener of this.listeners) listener(this.currentSnapshot) }
}
