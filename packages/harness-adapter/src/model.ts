import { absent, success, type AdapterResult } from './types.ts'
import type { CapabilitySource } from './capabilities.ts'
import { probeCapabilities } from './capabilities.ts'

export interface HarnessModelSource<M> extends CapabilitySource { listModels(signal: AbortSignal): Promise<readonly M[]> }
/** Model bridge removal condition: Harness model catalog is already renderer-neutral and capability-scoped. */
export class ModelBridge<M> {
  private readonly capability = 'model' as const
  constructor(private readonly source?: HarnessModelSource<M>) {}
  dispose(): void {}
  async list(signal: AbortSignal = new AbortController().signal): Promise<AdapterResult<readonly M[]>> { if (this.source === undefined || !probeCapabilities(this.source, [this.capability]).has(this.capability)) return absent(this.capability); if (signal.aborted) return { ok: false, code: 'BLUE_ABORTED', message: 'The model request was aborted' }; try { return success(await this.source.listModels(signal)) } catch (error) { return { ok: false, code: 'BLUE_ACTION_REJECTED', message: error instanceof Error ? error.message : String(error) } } }
}
