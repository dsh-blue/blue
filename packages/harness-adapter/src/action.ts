import { abortResult, failure, staleResult, success, type ActionRef, type AbortOptions } from './types.ts'
import type { BlueResult } from '@dsh-blue/blue-api'

export type ActionHandler<T> = (context: { readonly ref: ActionRef; readonly signal: AbortSignal }) => Promise<T>
export class ActionCoordinator {
  private sessionEpochValue = 0
  private requestEpoch = 0
  private active: { readonly ref: ActionRef; readonly controller: AbortController } | undefined
  private tail: Promise<unknown> = Promise.resolve()
  get sessionEpoch(): number { return this.sessionEpochValue }
  switchSession(): number { this.active?.controller.abort(); this.active = undefined; this.sessionEpochValue++; return this.sessionEpochValue }
  execute<T>(scope: ActionRef['scope'], handler: ActionHandler<T>, options: AbortOptions = {}): Promise<BlueResult<T>> {
    const queuedSessionEpoch = this.sessionEpochValue
    const run = async (): Promise<BlueResult<T>> => { if (queuedSessionEpoch !== this.sessionEpochValue) return staleResult<T>(); const ref: ActionRef = { sessionEpoch: this.sessionEpochValue, requestEpoch: ++this.requestEpoch, scope }; const controller = new AbortController(); const forward = (): void => controller.abort(); options.signal?.addEventListener('abort', forward, { once: true }); if (options.signal?.aborted) controller.abort(); this.active = { ref, controller }
      try {
        if (controller.signal.aborted) return abortResult<T>()
        const value = await handler({ ref, signal: controller.signal })
        if (this.active?.ref !== ref) return staleResult<T>()
        return success(value)
      } catch (error) { return controller.signal.aborted ? abortResult<T>() : failure<T>('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) } finally { options.signal?.removeEventListener('abort', forward); if (this.active?.ref === ref) this.active = undefined }
    }
    const result = this.tail.then(run, run); this.tail = result.then(() => undefined); return result
  }
  abort(): void { this.active?.controller.abort() }
  dispose(): void { this.abort(); this.sessionEpochValue++ }
}
