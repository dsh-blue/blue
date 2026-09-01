/**
 * `blue-jobs` plugin: the `/jobs` command (the background-job panel). The
 * list panel replaces the editor slot and follows the app-owned `blueJobs`
 * snapshot live — live jobs first by start time, settled jobs newest first —
 * with a one-second tick refreshing durations only while the panel is open
 * and at least one job is live. Enter reads the selected job's output into a
 * detail panel; `k` kills the selected live job; Esc closes.
 *
 * Output reads consume the job's single model-facing cursor (R1), so the
 * panel never polls `readJobOutput`: a read happens only on an explicit
 * Enter, and the detail view of a live job carries the cursor warning. A
 * terminal read also marks the job reported, which suppresses the
 * model-facing completion notice — accepted by design for a deliberate user
 * read. For stream kinds (bash, subagent) even a terminal read returns only
 * the delta no earlier reader consumed, and the registry keeps no replayable
 * copy: once the agent's `job_output` collected a finished job, Enter finds
 * nothing. The settled empty state says exactly that instead of claiming the
 * job produced no output.
 *
 * @module @dsh-blue/blue-interaction/jobs
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
// Empty type import carries the `commands` Context merge the registration uses.
import type {} from '@deepseek-ai/dsh-commands'
import type { Action, BlueTranslate } from '@dsh-blue/blue-frontend'
import type { BlueJob, BlueJobsSnapshot } from '@dsh-blue/blue-app'
import { displayServices } from './display-services.ts'
import { getSharedEditor, mountEditorReplacement } from './editor-instance.ts'
import { CanonicalDocumentController, type FrontendPanelDocument, type FrontendPanelItem } from './frontend-panel.ts'
import { interactionTranslator } from './locale.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-jobs'

/** Services required before the command can register. */
export const inject = ['commands', 'blueJobs', 'blueEditorHost']

/** Status glyphs painted at the left of every job row. */
export const JOB_STATUS_MARKS: Readonly<Record<BlueJob['status'], string>> = {
  running: '●',
  stopping: '●',
  completed: '✓',
  failed: '✗',
  killed: '⊘',
}

/** How many trailing output lines the detail view keeps. */
export const JOB_OUTPUT_TAIL_LINES = 120

/** Whether the job still occupies the background queue. */
export function isLiveJob(job: BlueJob): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/**
 * Compact duration from `startedAt` to `now`: seconds under a minute,
 * minutes under an hour, then hours (with remaining minutes when nonzero).
 * @param startedAt - epoch ms when the job started.
 * @param now - epoch ms now.
 * @returns the compact duration text.
 */
export function formatJobDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`
}

/**
 * Keep the trailing {@link JOB_OUTPUT_TAIL_LINES} lines of a job's output.
 * @param text - the full output text.
 * @param lines - tail bound; defaults to {@link JOB_OUTPUT_TAIL_LINES}.
 * @returns the tail and whether content was dropped.
 */
export function tailJobOutput(text: string, lines = JOB_OUTPUT_TAIL_LINES): { readonly text: string, readonly truncated: boolean } {
  const rows = text.split('\n')
  if (rows.length <= lines) return { text, truncated: false }
  return { text: rows.slice(rows.length - lines).join('\n'), truncated: true }
}

/** One-line status text for a row: live jobs carry their duration, settled jobs their terminal detail. */
function jobStatusText(job: BlueJob, now: number): string {
  if (isLiveJob(job)) return `${job.status} ${formatJobDuration(job.startedAt, now)}`
  return job.detail === undefined ? job.status : `${job.status} · ${job.detail}`
}

/**
 * Build the renderer-neutral jobs list model from one snapshot.
 * @param snapshot - the app-owned visible job set.
 * @param now - epoch ms now, for live durations.
 * @param t - interaction translator.
 * @returns the select-mode panel document.
 */
export function jobsPanelModel(snapshot: BlueJobsSnapshot, now: number, t: BlueTranslate): FrontendPanelDocument {
  const items: FrontendPanelItem[] = snapshot.jobs.map(job => ({
    id: job.id,
    label: `${JOB_STATUS_MARKS[job.status]} ${job.id}  ${job.label}`,
    detail: jobStatusText(job, now),
    action: { kind: 'jobs.view', id: job.id },
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

/**
 * Build the read-only output detail model for one job.
 * @param job - the job's post-read state.
 * @param output - the output text returned by the read.
 * @param t - interaction translator.
 * @returns the info-mode panel document.
 */
export function jobOutputPanelModel(job: BlueJob, output: string, t: BlueTranslate): FrontendPanelDocument {
  const tail = tailJobOutput(output)
  // An empty read means different things by lifecycle: a live job simply has
  // produced nothing new, while a settled stream job's output may already be
  // consumed by the agent's job_output or an earlier view — the registry
  // keeps no replayable copy, so the panel cannot tell the two apart and
  // says so instead of claiming the job produced no output.
  const empty = isLiveJob(job)
    ? t('(no new output yet)')
    : t('(no new output — already consumed by the agent or an earlier read, or the job produced none)')
  const code = tail.text === ''
    ? empty
    : tail.truncated ? `${t('… output truncated')}\n${tail.text}` : tail.text
  return {
    mode: 'info',
    title: t('Job {id}', { id: job.id }),
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
        { title: `${job.label} · ${job.detail === undefined || isLiveJob(job) ? job.status : `${job.status} · ${job.detail}`}`, body: { kind: 'code' as const, code } },
      ],
    },
    cancel: { kind: 'jobs.detail.close' },
  }
}

/**
 * Register `/jobs`.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const t = interactionTranslator(ctx)
  /** Per-open cleanups the fiber unload runs without touching the editor slot. */
  const cleanups = new Set<() => void>()
  ctx.effect(() => () => {
    for (const cleanup of cleanups) cleanup()
    cleanups.clear()
  })

  function open(): CommandResult {
    if (!ctx.blueJobs.current().available) {
      return { kind: 'error', text: t('background jobs are unavailable on this host') }
    }
    const display = displayServices(ctx)
    if (display === undefined) {
      return { kind: 'error', text: t('jobs panel is unavailable: the Blue screen is not mounted') }
    }
    let now = Date.now()
    let closed = false
    let timer: ReturnType<typeof setInterval> | undefined
    let restore: (() => void) | undefined
    let restoreDetail: (() => void) | undefined

    const liveCount = (): number => ctx.blueJobs.current().jobs.filter(isLiveJob).length
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
      const result = ctx.blueJobs.readJobOutput(id)
      if (!result.ok) {
        getSharedEditor(ctx)?.notice?.(result.message)
        return
      }
      const output = result.value
      const detail = new CanonicalDocumentController({
        ...display,
        t,
        model: () => jobOutputPanelModel(output.job, output.text, t),
        onAction: () => undefined,
        onClose: () => restoreDetail?.(),
        maxVisible: 14,
      })
      restoreDetail = mountEditorReplacement(ctx, detail)
    }
    const killJob = (id: string): void => {
      const job = ctx.blueJobs.current().jobs.find(candidate => candidate.id === id)
      if (job === undefined || !isLiveJob(job)) return
      const result = ctx.blueJobs.killJob(id)
      if (!result.ok) getSharedEditor(ctx)?.notice?.(result.message)
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
      registration.dispose()
      cleanups.delete(cleanup)
      restore?.()
    }
    const panel = new CanonicalDocumentController({
      ...display,
      t,
      model: () => jobsPanelModel(ctx.blueJobs.current(), now, t),
      onAction: execute,
      onClose: close,
      onUnhandledInput: (data, selectedId) => {
        if ((data !== 'k' && data !== 'K') || selectedId === undefined) return undefined
        const job = ctx.blueJobs.current().jobs.find(candidate => candidate.id === selectedId)
        return job !== undefined && isLiveJob(job) ? { kind: 'jobs.kill', id: selectedId } : undefined
      },
      contextHints: () => [{ id: 'jobs-kill', keys: 'k', label: t('kill'), priority: 95 }],
      maxVisible: 12,
    })
    const onJobsChanged = (): void => {
      /* v8 ignore next -- close() disposes the registration synchronously, so a post-close publish cannot arrive; this fences an asynchronous facade */
      if (closed) return
      panel.invalidate()
      display.screen.requestRender()
      if (liveCount() > 0) armTick()
      else disarmTick()
    }
    const registration = ctx.blueJobs.subscribe(onJobsChanged)
    const cleanup = (): void => {
      disarmTick()
      registration.dispose()
    }
    cleanups.add(cleanup)
    restore = mountEditorReplacement(ctx, panel)
    armTick()
    return { kind: 'success' }
  }

  const command = ctx.commands.register({
    name: 'jobs',
    description: 'List background jobs (Enter views output, k kills a running job)',
    handler: () => open(),
  })
  ctx.effect(() => command)
}
