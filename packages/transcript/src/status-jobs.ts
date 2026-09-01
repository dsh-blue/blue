/**
 * Native live-job count in the Blue status footer.
 *
 * @module @dsh-blue/blue-transcript/status-jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { BlueStatusEntry } from './status-model.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-jobs'

/** Native and Blue services required by the status contribution. */
export const inject = ['blueStatus', 'blueCurrentAgent', 'jobs']

/** Count jobs still occupying the background queue. */
export function liveJobCount(jobs: readonly JobSnapshot[]): number {
  return jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
}

/** Register the direct status contribution. */
export function apply(ctx: Context): void {
  let text = ''
  const refresh = (): void => {
    const agent = ctx.blueCurrentAgent.current()
    let count = 0
    try {
      count = agent === null ? 0 : liveJobCount(ctx.jobs.list(agent))
    } catch (error) {
      ctx.logger.warn(`could not list background jobs for status: ${error instanceof Error ? error.message : String(error)}`)
    }
    const next = count > 0 ? `⏵ ${String(count)} jobs` : ''
    if (next === text) return
    text = next
    ctx.blueStatus.refresh('blue.status.jobs')
  }
  const model = (): BlueStatusEntry => ({
    id: 'blue.status.jobs',
    priority: 3,
    node: { kind: 'text', content: text, tone: 'accent' },
    visible: text !== '',
  })
  ctx.blueStatus.register(model)
  const offJobs = ctx.jobs.onJobsChanged((owner) => {
    const current = ctx.blueCurrentAgent.current()
    if (owner === undefined || owner === current) refresh()
  })
  const offAgent = ctx.blueCurrentAgent.subscribe(() => refresh())
  ctx.effect(() => () => {
    offJobs()
    offAgent()
  })
}
