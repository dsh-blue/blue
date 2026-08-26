import { absent, abortResult, failure, success, type AdapterResult, type AbortOptions } from './types.ts'

export interface HarnessQuestionSource<Q, A> { ask(question: Q, signal: AbortSignal): Promise<A>; approve?(question: Q, signal: AbortSignal): Promise<A> }
/** Question/approval bridge removal condition: Harness exposes structured question and approval services. */
export class QuestionBridge<Q, A> {
  constructor(private readonly source?: HarnessQuestionSource<Q, A>) {}
  dispose(): void {}
  ask(question: Q, options: AbortOptions = {}): Promise<AdapterResult<A>> { return this.run('ask', question, options) }
  approve(question: Q, options: AbortOptions = {}): Promise<AdapterResult<A>> { return this.run('approve', question, options) }
  private async run(kind: 'ask' | 'approve', question: Q, options: AbortOptions): Promise<AdapterResult<A>> { const fn = this.source?.[kind]; if (fn === undefined) return absent(kind === 'ask' ? 'question' : 'approval'); const controller = new AbortController(); const forward = (): void => controller.abort(); options.signal?.addEventListener('abort', forward, { once: true }); if (options.signal?.aborted) controller.abort(); try { if (controller.signal.aborted) return abortResult<A>(); return success(await fn.call(this.source, question, controller.signal)) } catch (error) { return controller.signal.aborted ? abortResult<A>() : failure<A>('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) } finally { options.signal?.removeEventListener('abort', forward) } }
}
