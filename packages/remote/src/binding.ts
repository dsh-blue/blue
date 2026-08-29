import type { BlueResult, BlueSessionSnapshot } from '@dsh-blue/blue-api'
import type { ActionCoordinator, AdapterResult, AbortOptions, HarnessSessionSource, SessionBridge } from '@dsh-blue/blue-harness-adapter'
import type { RemoteSessionAction } from './types.ts'

/** Remote session read source with its package-owned structured action carrier. */
export interface RemoteSessionSource extends HarnessSessionSource {
  request(action: RemoteSessionAction, signal: AbortSignal): Promise<void>
}

export class CurrentSessionBinding {
  private generation = 0
  private source: RemoteSessionSource | undefined
  private currentSession: string | undefined
  private currentSnapshot: BlueSessionSnapshot | undefined
  private readonly listeners = new Set<(snapshot: BlueSessionSnapshot | undefined) => void>()
  constructor(private readonly session: SessionBridge, private readonly actions: ActionCoordinator) {}
  get sessionId(): string | undefined { return this.currentSession }
  get snapshot(): BlueSessionSnapshot | undefined { return this.currentSnapshot }
  subscribe(listener: (snapshot: BlueSessionSnapshot | undefined) => void): () => void { this.listeners.add(listener); listener(this.currentSnapshot); return () => this.listeners.delete(listener) }
  async switchTo(source: RemoteSessionSource | undefined, sessionId?: string): Promise<AdapterResult<BlueSessionSnapshot>> {
    const generation = ++this.generation; this.actions.switchSession(); this.session.detach(); this.source = undefined
    const result = await this.session.attach(source)
    if (generation !== this.generation) return { ok: false, code: 'BLUE_ACTION_REJECTED', message: 'The session binding result is stale' }
    if (!result.ok) { this.currentSession = undefined; this.currentSnapshot = undefined; this.emit(); return result }
    this.source = source; this.currentSession = sessionId ?? result.value.id; this.currentSnapshot = result.value; this.emit(); return result
  }
  /** Execute a remote-owned structured mutation with abort and session fencing. */
  execute(action: RemoteSessionAction, options: AbortOptions = {}): Promise<BlueResult<void>> {
    const source = this.source
    if (source === undefined || this.currentSession === undefined) {
      return Promise.resolve({ ok: false, code: 'BLUE_SESSION_UNAVAILABLE', message: 'Remote session is not attached' })
    }
    return this.actions.execute('main', ({ signal }) => source.request(action, signal), options)
  }
  detach(): void { this.generation++; this.actions.switchSession(); this.session.detach(); this.source = undefined; this.currentSession = undefined; this.currentSnapshot = undefined; this.emit() }
  dispose(): void { this.detach(); this.listeners.clear(); this.session.dispose(); this.actions.dispose() }
  private emit(): void { for (const listener of this.listeners) listener(this.currentSnapshot) }
}
