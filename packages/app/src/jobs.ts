/**
 * The app-owned background-jobs surface (`blueJobs`): a renderer-neutral
 * facade over the Harness `ctx.jobs` registry through the harness-adapter
 * `JobsBridge`. The app owns the fenced `caller` argument — the current
 * Agent — so transcript and interaction consumers never see an Agent, a
 * Session, or the registry itself. Hosts without a jobs service publish
 * `available: false`; the facade itself is always provided so consumers
 * inject one stable service.
 *
 * Cursor discipline (R1): `readJobOutput` consumes the job's single output
 * cursor and a terminal read marks the job reported, suppressing the
 * model-facing completion notice. The service never reads on its own —
 * output reads happen only when the interaction layer relays an explicit
 * user request.
 *
 * @module @dsh-blue/blue-app/jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import { JobsBridge } from '@dsh-blue/blue-harness-adapter'
import type { BlueRegistration, BlueResult } from '@dsh-blue/blue-api'
import type { BlueJob, BlueJobsService, BlueJobsSnapshot } from './types.ts'

/** Structured capability absence for hosts without a jobs registry. */
function jobsUnavailable<T>(): BlueResult<T> {
  return { ok: false, code: 'BLUE_CAPABILITY_ABSENT', message: 'background jobs are unavailable on this host' }
}

/** Copy one registry snapshot into the frozen renderer-neutral shape. */
function copyJob(snapshot: JobSnapshot): BlueJob {
  return Object.freeze({
    id: String(snapshot.id),
    kind: String(snapshot.kind),
    label: snapshot.label,
    status: snapshot.status,
    ...(snapshot.detail === undefined ? {} : { detail: snapshot.detail }),
    startedAt: snapshot.startedAt,
    ...(snapshot.finishedAt === undefined ? {} : { finishedAt: snapshot.finishedAt }),
  })
}

/** Live jobs first by start time, then settled jobs newest first. */
function sortJobs(jobs: readonly BlueJob[]): readonly BlueJob[] {
  const live = jobs.filter(job => job.status === 'running' || job.status === 'stopping')
    .sort((a, b) => a.startedAt - b.startedAt)
  const settled = jobs.filter(job => job.status !== 'running' && job.status !== 'stopping')
    .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))
  return Object.freeze([...live, ...settled])
}

/**
 * Provide `blueJobs` on `ctx` and follow the optional host `jobs` service.
 * @param ctx - the app plugin context.
 * @param currentAgent - reads the private active Agent for caller fencing.
 * @returns a `publish` hook the session commit point calls so owner-scoped visibility follows a session switch.
 */
export function installJobsService(ctx: Context, currentAgent: () => Agent | undefined): { publish(): void } {
  const bridge = new JobsBridge()
  const listeners = new Set<(snapshot: BlueJobsSnapshot) => void>()
  let snapshot: BlueJobsSnapshot = Object.freeze({ available: false, jobs: Object.freeze([]) })
  const publish = (): void => {
    let available = bridge.attached
    let jobs: readonly BlueJob[] = snapshot.jobs
    if (available) {
      const result = bridge.list()
      if (result.ok) {
        jobs = sortJobs(result.value.map(copyJob))
      } else {
        // A transient list failure keeps the last good snapshot.
        /* v8 ignore next -- the bridge is attached here, so only source failures carry a message */
        const message = 'absent' in result ? result.absent.reason : result.message
        ctx.logger.warn(`blue-app: could not list background jobs: ${message}`)
        return
      }
    } else {
      jobs = Object.freeze([])
    }
    snapshot = Object.freeze({ available, jobs })
    for (const listener of listeners) listener(snapshot)
  }
  const service: BlueJobsService = {
    current: () => snapshot,
    subscribe(listener): BlueRegistration {
      listeners.add(listener)
      listener(snapshot)
      let disposed = false
      return {
        get disposed() { return disposed },
        dispose() {
          if (disposed) return
          disposed = true
          listeners.delete(listener)
        },
      }
    },
    killJob(id) {
      const result = bridge.kill(id, 'killed from the Blue /jobs panel')
      if (result.ok) return result
      return 'absent' in result ? jobsUnavailable() : { ok: false, code: result.code, message: result.message }
    },
    readJobOutput(id) {
      const result = bridge.readOutput(id)
      if (result.ok) return { ok: true, value: { text: result.value.text, job: copyJob(result.value.snapshot) } }
      return 'absent' in result ? jobsUnavailable() : { ok: false, code: result.code, message: result.message }
    },
  }
  ctx.provide('blueJobs', service)
  // The host jobs service is an optional composition row: the injected Fiber
  // activates when it appears and disposes when its provider unloads.
  ctx.inject(['jobs'], (jobsCtx) => {
    bridge.attach(jobsCtx.jobs, currentAgent)
    const off = bridge.subscribe(publish)
    publish()
    jobsCtx.effect(() => () => {
      off()
      bridge.detach()
      publish()
    })
  })
  ctx.effect(() => () => {
    bridge.dispose()
    listeners.clear()
  })
  return { publish }
}
