/**
 * `blue-status-jobs` plugin: enhancement footer entry counting the session's
 * live background jobs — `⏵ N jobs` in the `accent` tier at priority 3 while
 * at least one job is `running`/`stopping`, invisible otherwise. The count
 * comes from the app-owned `blueJobs` facade, so hosts without a jobs
 * service simply never show the entry. A redraw is requested only when the
 * live count actually changes.
 *
 * @module @dsh-blue/blue-transcript/status-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueJobsSnapshot } from '@dsh-blue/blue-app'
import type { BlueStatusEntry } from './status-model.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-jobs'

/** Services required before the jobs entry can register. */
export const inject = ['blueStatusEntries', 'blueJobs']

/** Count the jobs still occupying the model's background queue. */
export function liveJobCount(snapshot: BlueJobsSnapshot): number {
  return snapshot.jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
}

/**
 * Register the jobs entry. Recomputes on every `blueJobs` publication; a
 * refresh is requested only when the rendered text actually changed.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let text = ''
  const registration = ctx.blueJobs.subscribe((snapshot) => {
    const count = liveJobCount(snapshot)
    const next = count > 0 ? `⏵ ${count} jobs` : ''
    if (next === text) return
    text = next
    ctx.blueStatusEntries.refresh('blue.status.jobs')
  })
  ctx.effect(() => () => registration.dispose())

  const model = (): BlueStatusEntry => ({ id: 'blue.status.jobs', priority: 3, node: { kind: 'text', content: text, tone: 'accent' }, visible: text !== '' })
  ctx.effect(() => ctx.blueStatusEntries.register(model))
}
