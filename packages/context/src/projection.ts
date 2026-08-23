import { ProjectionBridge, type AdapterResult } from '@dsh-blue/blue-harness-adapter'
import { freezeModel } from '@dsh-blue/blue-frontend'
import type { ContextEvent, ContextFacts, ContextSnapshot, ContextSource, ContextState, UsageSample } from './types.ts'

const EMPTY: ContextFacts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
export function initialContextState(): ContextState { return { usage: EMPTY, samples: {} } }
function sampleKey(sample: UsageSample): string { return `${sample.turn}/${sample.step}` }
function sumSamples(samples: Readonly<Record<string, UsageSample>>): ContextFacts {
  let input = 0; let output = 0; let cacheRead = 0; let cacheWrite = 0
  for (const sample of Object.values(samples)) { input += sample.inputTokens; output += sample.outputTokens; cacheRead += sample.cacheReadTokens ?? 0; cacheWrite += sample.cacheWriteTokens ?? 0 }
  return { input, output, cacheRead, cacheWrite }
}
export function applyContextEvent(state: ContextState, event: ContextEvent): ContextState {
  if (event.type === 'usage' && event.usage !== undefined) { const samples = { ...state.samples, [sampleKey(event.usage)]: event.usage }; return { usage: { ...state.usage, ...sumSamples(samples) }, samples } }
  if (event.type === 'pressure') return { ...state, usage: { ...state.usage, ...(event.projectedTokens ?? event.pressureTokens) === undefined ? {} : { used: event.projectedTokens ?? event.pressureTokens }, ...(event.contextWindow === undefined ? {} : { window: event.contextWindow }) } }
  if (event.type === 'breakdown' && event.systemTokens !== undefined && event.toolsTokens !== undefined && event.messageTokens !== undefined) return { ...state, usage: { ...state.usage, breakdown: { system: event.systemTokens, tools: event.toolsTokens, messages: event.messageTokens } } }
  return state
}
export class ContextProjection {
  private readonly bridge: ProjectionBridge<ContextState, ContextEvent>
  private sessionId: string | undefined
  private watermark = -1
  private state: ContextState | undefined
  private readonly listeners = new Set<(snapshot: ContextSnapshot) => void>()
  constructor(source?: ContextSource) { this.bridge = new ProjectionBridge({ init: initialContextState, apply: applyContextEvent }, source === undefined ? undefined : { snapshot: async (id, signal) => { const result = await source.snapshot(id, signal); return { watermark: result.watermark, value: result.events } }, subscribe: (id, seq, listener) => source.subscribe(id, seq, listener) }); this.bridge.subscribe((state, watermark) => { this.state = state; this.watermark = watermark; if (this.sessionId !== undefined) this.emit() }) }
  get snapshot(): ContextSnapshot | undefined { return this.sessionId === undefined || this.state === undefined ? undefined : freezeModel({ sessionId: this.sessionId, watermark: this.watermark, facts: this.state.usage }) }
  subscribe(listener: (snapshot: ContextSnapshot) => void): () => void { this.listeners.add(listener); const current = this.snapshot; if (current !== undefined) listener(current); return () => this.listeners.delete(listener) }
  async attach(sessionId: string): Promise<AdapterResult<ContextState>> { this.sessionId = undefined; const result = await this.bridge.attach(sessionId); if (result.ok) { this.sessionId = sessionId; this.watermark = this.bridge.snapshot.watermark; this.state = result.value; this.emit() } return result }
  detach(): void { this.bridge.detach(); this.sessionId = undefined; this.state = undefined; this.watermark = -1 }
  dispose(): void { this.bridge.dispose(); this.listeners.clear(); this.sessionId = undefined; this.state = undefined }
  private emit(): void { const snapshot = this.snapshot; if (snapshot !== undefined) for (const listener of this.listeners) listener(snapshot) }
}
