/**
 * Native background-job browser for the current Blue Agent. The panel reads
 * `ctx.jobs` directly and consumes output only after an explicit Enter.
 *
 * @module @dsh-blue/blue-interaction/jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { Action, BlueTranslate } from '@dsh-blue/blue-frontend'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController, type FrontendPanelDocument, type FrontendPanelItem } from './frontend-panel.ts'
import { interactionTranslator } from './locale.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-jobs'

/** Native and Blue services required by the command. */
export const inject = ['commands', 'jobs', 'blueCurrentAgent', 'blueEditorHost']

/** Status glyphs painted at the left of every job row. */
export const JOB_STATUS_MARKS: Readonly<Record<JobSnapshot['status'], string>> = {
  running: '●',
  stopping: '●',
  completed: '✓',
  failed: '✗',
  killed: '⊘',
}

/** How many trailing output lines the detail view keeps. */
export const JOB_OUTPUT_TAIL_LINES = 120

/** Whether the job still occupies the background queue. */
export function isLiveJob(job: JobSnapshot): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Live jobs oldest first, followed by settled jobs newest first. */
export function sortJobs(jobs: readonly JobSnapshot[]): readonly JobSnapshot[] {
  const live = jobs.filter(isLiveJob).toSorted((left, right) => left.startedAt - right.startedAt)
  const settled = jobs.filter(job => !isLiveJob(job))
    .toSorted((left, right) => (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt))
  return [...live, ...settled]
}

/** Compact duration from the start time to `now`. */
export function formatJobDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`
}

/** Keep only the configured trailing lines of job output. */
export function tailJobOutput(text: string, lines = JOB_OUTPUT_TAIL_LINES): { readonly text: string, readonly truncated: boolean } {
  const rows = text.split('\n')
  if (rows.length <= lines) return { text, truncated: false }
  return { text: rows.slice(rows.length - lines).join('\n'), truncated: true }
}

function jobStatusText(job: JobSnapshot, now: number): string {
  if (isLiveJob(job)) return `${job.status} ${formatJobDuration(job.startedAt, now)}`
  return job.detail === undefined ? job.status : `${job.status} · ${job.detail}`
}

/** Build the jobs list document. */
export function jobsPanelModel(jobs: readonly JobSnapshot[], now: number, t: BlueTranslate): FrontendPanelDocument {
  const items: FrontendPanelItem[] = sortJobs(jobs).map(job => ({
    id: String(job.id),
    label: `${JOB_STATUS_MARKS[job.status]} ${String(job.id)}  ${job.label}`,
    detail: jobStatusText(job, now),
    action: { kind: 'jobs.view', id: String(job.id) },
  }))
  return {
    mode: 'select',
    title: t('Jobs'),
    ...(items.length === 0 ? {} : { selectedId: items[0]!.id }),
    items,
    empty: { title: t('no background jobs') },
    cancel: { kind: 'jobs.close' },
  }
}

/** Build a read-only output document from one explicit consuming read. */
export function jobOutputPanelModel(job: JobSnapshot, output: string, t: BlueTranslate): FrontendPanelDocument {
  const tail = tailJobOutput(output)
  const empty = isLiveJob(job)
    ? t('(no new output yet)')
    : t('(no new output — already consumed by the agent or an earlier read, or the job produced none)')
  const code = tail.text === ''
    ? empty
    : tail.truncated ? `${t('… output truncated')}\n${tail.text}` : tail.text
  return {
    mode: 'info',
    title: t('Job {id}', { id: String(job.id) }),
    view: {
      kind: 'sections',
      sections: [
        ...(isLiveJob(job) ? [{
          body: {
            kind: 'text' as const,
            content: t("Reading a live job consumes the model's output cursor; the model will not see this output again."),
            tone: 'warning' as const,
          },
        }] : []),
        {
          title: `${job.label} · ${job.detail === undefined || isLiveJob(job) ? job.status : `${job.status} · ${job.detail}`}`,
          body: { kind: 'code' as const, code },
        },
      ],
    },
    cancel: { kind: 'jobs.detail.close' },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Register `/jobs` against the native job registry. */
export function apply(ctx: Context): void {
  const t = interactionTranslator(ctx)
  let closeOpenPanel: (() => void) | undefined

  function open(): CommandResult {
    const agent = ctx.blueCurrentAgent.current()
    if (agent === null) return { kind: 'error', text: t('no session is live yet') }
    const display = displayServices(ctx)
    if (display === undefined) return { kind: 'error', text: t('jobs panel is unavailable: the Blue screen is not mounted') }

    closeOpenPanel?.()
    let now = Date.now()
    let closed = false
    let timer: ReturnType<typeof setInterval> | undefined
    let restore: (() => void) | undefined
    let restoreDetail: (() => void) | undefined

    const jobs = (): readonly JobSnapshot[] => {
      try {
        return ctx.blueCurrentAgent.current() === agent ? ctx.jobs.list(agent) : []
      } catch (error) {
        ctx.logger.warn(`could not list background jobs: ${describe(error)}`)
        return []
      }
    }
    const liveCount = (): number => jobs().filter(isLiveJob).length
    const disarmTick = (): void => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }
    const tick = (): void => {
      now = Date.now()
      panel.invalidate()
      display.screen.requestRender()
      if (liveCount() === 0) disarmTick()
    }
    const armTick = (): void => {
      if (timer !== undefined || closed || liveCount() === 0) return
      timer = setInterval(tick, 1000)
      timer.unref()
    }
    const viewJob = (id: string): void => {
      try {
        const output = ctx.jobs.read(JobId(id), agent)
        const detail = new CanonicalDocumentController({
          ...display,
          t,
          model: () => jobOutputPanelModel(output.snapshot, output.text, t),
          onAction: () => undefined,
          onClose: () => restoreDetail?.(),
          maxVisible: 14,
        })
        restoreDetail = mountEditorReplacement(ctx, detail)
      } catch (error) {
        getSharedEditor(ctx)?.notice?.(describe(error))
      }
    }
    const killJob = (id: string): void => {
      const job = jobs().find(candidate => String(candidate.id) === id)
      if (job === undefined || !isLiveJob(job)) return
      try {
        ctx.jobs.kill(JobId(id), agent, 'killed from the Blue /jobs panel')
      } catch (error) {
        getSharedEditor(ctx)?.notice?.(describe(error))
      }
    }
    const execute = (action: Action): void => {
      const id = typeof action.id === 'string' ? action.id : undefined
      if (action.kind === 'jobs.view' && id !== undefined) viewJob(id)
      else if (action.kind === 'jobs.kill' && id !== undefined) killJob(id)
    }
    const close = (): void => {
      if (closed) return
      closed = true
      disarmTick()
      offJobs()
      offAgent()
      restoreDetail?.()
      restore?.()
      closeOpenPanel = undefined
    }
    const panel = new CanonicalDocumentController({
      ...display,
      t,
      model: () => jobsPanelModel(jobs(), now, t),
      onAction: execute,
      onClose: close,
      onUnhandledInput: (data, selectedId) => {
        if ((data !== 'k' && data !== 'K') || selectedId === undefined) return undefined
        const job = jobs().find(candidate => String(candidate.id) === selectedId)
        return job !== undefined && isLiveJob(job) ? { kind: 'jobs.kill', id: selectedId } : undefined
      },
      contextHints: () => [{ id: 'jobs-kill', keys: 'k', label: t('kill'), priority: 95 }],
      maxVisible: 12,
    })
    const onChanged = (): void => {
      panel.invalidate()
      display.screen.requestRender()
      if (liveCount() > 0) armTick()
      else disarmTick()
    }
    const offJobs = ctx.jobs.onJobsChanged((owner) => {
      if (owner === undefined || owner === agent) onChanged()
    })
    const offAgent = ctx.blueCurrentAgent.subscribe(next => {
      if (next !== agent) close()
    })
    restore = mountEditorReplacement(ctx, panel)
    closeOpenPanel = close
    armTick()
    return { kind: 'success' }
  }

  const command = ctx.commands.register({
    name: 'jobs',
    description: t('List background jobs (Enter views output, k kills a running job)'),
    handler: () => open(),
  })
  ctx.effect(() => () => {
    closeOpenPanel?.()
    command()
  })
}
