import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobRead, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { absent, failure, success, type AdapterResult, type Unsubscribe } from './types.ts'

/** Structural view of `ctx.jobs` (`@deepseek-ai/dsh-jobs` `JobRegistry`): the caller agent is pure authorization, supplied by the attach site. */
export interface HarnessJobsSource {
  list(caller?: Agent): JobSnapshot[]
  get(id: JobId, caller?: Agent): JobSnapshot
  read(id: JobId, caller?: Agent): JobRead
  kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished'
  onJobsChanged(listener: (owner: Agent | undefined) => void): () => void
}

/**
 * Jobs bridge removal condition: Harness exposes a renderer-neutral job
 * snapshot surface Blue can consume without the `Agent`-fenced caller argument.
 *
 * Cursor discipline (R1): each job has ONE consuming output cursor, and every
 * read advances it; a terminal read also marks the job reported, suppressing
 * the model-facing completion notice. Callers must therefore read only on an
 * explicit user request — never poll `readOutput`.
 */
export class JobsBridge {
  private source: HarnessJobsSource | undefined
  private caller: (() => Agent | undefined) | undefined
  private unsubscribe: Unsubscribe | undefined
  private readonly listeners = new Set<() => void>()
  get attached(): boolean { return this.source !== undefined }
  attach(source: HarnessJobsSource, caller: () => Agent | undefined): void {
    this.unsubscribe?.(); this.unsubscribe = undefined
    this.source = source; this.caller = caller
    this.unsubscribe = source.onJobsChanged(owner => { if (owner === undefined || owner === this.caller?.()) this.emit() })
    this.emit()
  }
  detach(): void { this.unsubscribe?.(); this.unsubscribe = undefined; this.source = undefined; this.caller = undefined; this.emit() }
  dispose(): void { this.unsubscribe?.(); this.unsubscribe = undefined; this.source = undefined; this.caller = undefined; this.listeners.clear() }
  subscribe(listener: () => void): Unsubscribe { this.listeners.add(listener); let active = true; return () => { if (active) { active = false; this.listeners.delete(listener) } } }
  list(): AdapterResult<readonly JobSnapshot[]> {
    if (this.source === undefined) return absent('jobs')
    try { return success(this.source.list(this.caller?.())) } catch (error) { return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  get(id: string): AdapterResult<JobSnapshot> {
    if (this.source === undefined) return absent('jobs')
    try { return success(this.source.get(id as JobId, this.caller?.())) } catch (error) { return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  kill(id: string, reason?: string): AdapterResult<'requested' | 'already-finished'> {
    if (this.source === undefined) return absent('jobs')
    try { return success(this.source.kill(id as JobId, this.caller?.(), reason)) } catch (error) { return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  readOutput(id: string): AdapterResult<JobRead> {
    if (this.source === undefined) return absent('jobs')
    try { return success(this.source.read(id as JobId, this.caller?.())) } catch (error) { return failure('BLUE_ACTION_REJECTED', error instanceof Error ? error.message : String(error)) }
  }
  private emit(): void { for (const listener of this.listeners) listener() }
}
