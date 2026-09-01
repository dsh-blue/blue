/** Native `/jobs` browser behavior and lifecycle.
 * @module @dsh-blue/blue-interaction/tests/jobs
 */

import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId, type JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as jobsPlugin from '../src/jobs.ts'
import {
  formatJobDuration,
  isLiveJob,
  jobOutputPanelModel,
  jobsPanelModel,
  sortJobs,
  tailJobOutput,
} from '../src/jobs.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext } from './fakes.ts'

const t: BlueTranslate = (key, values) => Object.entries(values ?? {})
  .reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key)

function job(id: string, status: JobSnapshot['status'], overrides: Partial<JobSnapshot> = {}): JobSnapshot {
  return {
    id: JobId(id),
    kind: 'bash',
    label: `label ${id}`,
    status,
    startedAt: 1_000,
    reported: false,
    ...overrides,
  }
}

function fakeJobs(initial: readonly JobSnapshot[] = []) {
  let rows = [...initial]
  let listError: unknown
  const listeners = new Set<(owner: Agent | undefined) => void>()
  const service = {
    list: vi.fn(() => {
      if (listError !== undefined) throw listError
      return [...rows]
    }),
    read: vi.fn((id: ReturnType<typeof JobId>) => ({
      text: `first\nsecond ${String(id)}`,
      snapshot: job(String(id), 'completed', { finishedAt: 2_000 }),
    })),
    kill: vi.fn(() => 'requested' as const),
    onJobsChanged(listener: (owner: Agent | undefined) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    service,
    listenerCount: () => listeners.size,
    publish(next: readonly JobSnapshot[], owner?: Agent) {
      rows = [...next]
      for (const listener of listeners) listener(owner)
    },
    setSilently(next: readonly JobSnapshot[]) { rows = [...next] },
    failList(error: unknown) { listError = error },
  }
}

describe('jobs panel models', () => {
  it('formats compact durations and detects live jobs', () => {
    expect(formatJobDuration(1_000, 1_000)).toBe('0s')
    expect(formatJobDuration(0, 59_999)).toBe('59s')
    expect(formatJobDuration(0, 60_000)).toBe('1m')
    expect(formatJobDuration(0, 3_599_000)).toBe('59m')
    expect(formatJobDuration(0, 3_600_000)).toBe('1h')
    expect(formatJobDuration(0, 3_660_000)).toBe('1h 1m')
    expect(isLiveJob(job('a', 'running'))).toBe(true)
    expect(isLiveJob(job('a', 'stopping'))).toBe(true)
    expect(isLiveJob(job('a', 'completed'))).toBe(false)
  })

  it('sorts live oldest-first and settled newest-first', () => {
    const rows = [
      job('done-old', 'completed', { finishedAt: 2_000 }),
      job('run-new', 'running', { startedAt: 4_000 }),
      job('done-new', 'failed', { finishedAt: 8_000 }),
      job('run-old', 'stopping', { startedAt: 1_000 }),
    ]
    expect(sortJobs(rows).map(row => String(row.id))).toEqual(['run-old', 'run-new', 'done-new', 'done-old'])
    expect(sortJobs([
      job('fallback-new', 'completed', { startedAt: 8_000 }),
      job('fallback-old', 'completed', { startedAt: 2_000 }),
    ]).map(row => String(row.id))).toEqual(['fallback-new', 'fallback-old'])
  })

  it('tails output and builds list rows for every lifecycle status', () => {
    expect(tailJobOutput('a\nb')).toEqual({ text: 'a\nb', truncated: false })
    const long = Array.from({ length: 130 }, (_, index) => `row ${String(index)}`).join('\n')
    expect(tailJobOutput(long)).toMatchObject({ truncated: true, text: expect.stringMatching(/^row 10/) })
    const model = jobsPanelModel([
      job('bash-1', 'running'),
      job('bash-2', 'stopping'),
      job('bash-3', 'completed'),
      job('bash-4', 'failed', { detail: 'exit code: 3', finishedAt: 5_000 }),
      job('bash-5', 'killed', { finishedAt: 4_000 }),
    ], 61_000, t)
    expect(model.items?.map(item => item.label)).toEqual([
      '● bash-1  label bash-1',
      '● bash-2  label bash-2',
      '✗ bash-4  label bash-4',
      '⊘ bash-5  label bash-5',
      '✓ bash-3  label bash-3',
    ])
    expect(model.items?.[0]).toMatchObject({ detail: 'running 1m', action: { kind: 'jobs.view', id: 'bash-1' } })
    expect(model.items?.[2]?.detail).toBe('failed · exit code: 3')
    expect(jobsPanelModel([], 0, t)).toMatchObject({ empty: { title: 'no background jobs' } })
  })

  it('builds live, empty, settled, and truncated output documents', () => {
    const live = jobOutputPanelModel(job('bash-1', 'running'), 'chunk', t)
    expect(live).toMatchObject({
      title: 'Job bash-1',
      view: { sections: [
        { body: { tone: 'warning', content: expect.stringContaining('output cursor') } },
        { title: 'label bash-1 · running', body: { code: 'chunk' } },
      ] },
    })
    expect(jobOutputPanelModel(job('live-empty', 'running'), '', t).view)
      .toMatchObject({ sections: [{}, { body: { code: '(no new output yet)' } }] })
    expect(jobOutputPanelModel(job('failed', 'failed', { detail: 'boom' }), '', t).view)
      .toMatchObject({ sections: [{ title: 'label failed · failed · boom', body: { code: expect.stringContaining('already consumed') } }] })
    const long = Array.from({ length: 130 }, (_, index) => `row ${String(index)}`).join('\n')
    expect(JSON.stringify(jobOutputPanelModel(job('done', 'completed'), long, t).view)).toContain('… output truncated\\nrow 10')
  })
})

describe('blue-jobs command', () => {
  afterEach(() => { vi.useRealTimers() })

  async function mount(options: { display?: boolean, current?: boolean, rows?: readonly JobSnapshot[] } = {}) {
    const { ctx, screen } = fakeBlueContext({ display: options.display })
    await ctx.plugin(CommandRuntime)
    const agent = {
      id: 'agent-1',
      status: 'idle',
      session: { id: 'agent-1', append: vi.fn() },
    } as unknown as Agent
    const sessionState: { current: Agent | null } = { current: options.current === false ? null : agent }
    ctx.provide('testSession', sessionState)
    const registry = fakeJobs(options.rows)
    ctx.provide('jobs', registry.service as never)
    const notices: string[] = []
    setSharedEditor(ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: text => { notices.push(text) },
    })
    const fiber = await ctx.plugin(jobsPlugin)
    const execute = () => ctx.commands.execute(agent, '/jobs', [], new AbortController().signal)
    return { ctx, screen, agent, sessionState, registry, notices, fiber, execute }
  }

  it('reports a missing current Agent and a missing display', async () => {
    const absent = await mount({ current: false })
    expect(await absent.execute()).toMatchObject({ result: { kind: 'error', text: 'no session is live yet' } })
    await absent.fiber.dispose()
    const headless = await mount({ display: false })
    expect(await headless.execute()).toMatchObject({ result: { kind: 'error', text: expect.stringContaining('not mounted') } })
    await headless.fiber.dispose()
  })

  it('opens, reads explicitly, kills only live jobs, and closes on Agent change', async () => {
    const rig = await mount({ rows: [job('bash-1', 'running'), job('bash-2', 'completed', { finishedAt: 2_000 })] })
    expect(await rig.execute()).toMatchObject({ result: { kind: 'success' } })
    const panel = rig.screen.overlays[0]!.component
    expect(panel.render(80).join('\n')).toContain('● bash-1')
    panel.handleInput('\r')
    expect(rig.registry.service.read).toHaveBeenCalledWith(JobId('bash-1'), rig.agent)
    const detail = rig.screen.overlays[1]!.component
    expect(detail.render(80).join('\n')).toContain('second bash-1')
    detail.handleInput('\x1b')
    panel.handleInput('\x1b[B')
    panel.handleInput('k')
    expect(rig.registry.service.kill).not.toHaveBeenCalled()
    panel.handleInput('\x1b[A')
    panel.handleInput('K')
    expect(rig.registry.service.kill).toHaveBeenCalledWith(JobId('bash-1'), rig.agent, expect.stringContaining('Blue'))
    rig.sessionState.current = { id: 'agent-2' } as Agent
    rig.ctx.emit('test/session-changed')
    expect(rig.screen.overlays[0]!.hidden).toBe(true)
    await rig.fiber.dispose()
  })

  it('contains native list, read, and kill failures as notices or an empty panel', async () => {
    const rig = await mount({ rows: [job('bash-1', 'running')] })
    rig.registry.failList('offline')
    await rig.execute()
    const panel = rig.screen.overlays[0]!.component
    expect(panel.render(80).join('\n')).toContain('no background jobs')
    rig.registry.failList(undefined)
    rig.registry.publish([job('bash-1', 'running')])
    rig.registry.service.read.mockImplementationOnce(() => { throw new Error('foreign job') })
    panel.handleInput('\r')
    expect(rig.notices).toContain('foreign job')
    rig.registry.service.kill.mockImplementationOnce(() => { throw 'kill refused' })
    panel.handleInput('k')
    expect(rig.notices).toContain('kill refused')
    panel.handleInput('\x1b')
    await rig.fiber.dispose()
  })

  it('ticks only while live jobs remain and cleans every open panel on replacement and unload', async () => {
    vi.useFakeTimers()
    const rig = await mount({ rows: [job('bash-1', 'running')] })
    await rig.execute()
    const first = rig.screen.overlays[0]!
    expect(rig.registry.listenerCount()).toBe(1)
    await rig.execute()
    expect(first.hidden).toBe(true)
    expect(rig.registry.listenerCount()).toBe(1)
    const baseline = rig.screen.renderRequests
    await vi.advanceTimersByTimeAsync(1_000)
    expect(rig.screen.renderRequests).toBeGreaterThan(baseline)
    rig.registry.setSilently([job('bash-1', 'completed')])
    await vi.advanceTimersByTimeAsync(1_000)
    const stopped = rig.screen.renderRequests
    await vi.advanceTimersByTimeAsync(2_000)
    expect(rig.screen.renderRequests).toBe(stopped)
    rig.registry.publish([job('bash-2', 'running')])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(rig.screen.renderRequests).toBeGreaterThan(stopped)
    rig.registry.publish([job('bash-2', 'completed')])
    const settled = rig.screen.renderRequests
    await vi.advanceTimersByTimeAsync(2_000)
    expect(rig.screen.renderRequests).toBe(settled)
    await rig.fiber.dispose()
    expect(rig.registry.listenerCount()).toBe(0)
  })

  it('ignores foreign owner updates, unknown actions, and invalid kill input', async () => {
    const rig = await mount({ rows: [job('bash-1', 'running')] })
    await rig.execute()
    const panel = rig.screen.overlays[0]!.component as unknown as {
      options: {
        onAction(action: { kind: string, id?: string }): void
        onClose(): void
        onUnhandledInput?(data: string, selectedId: string | undefined): unknown
      }
    }
    const before = rig.screen.renderRequests
    rig.registry.publish([job('bash-1', 'running')], {} as Agent)
    expect(rig.screen.renderRequests).toBe(before)
    panel.options.onAction({ kind: 'jobs.view' })
    panel.options.onAction({ kind: 'jobs.kill', id: 'missing' })
    panel.options.onAction({ kind: 'unknown', id: 'bash-1' })
    expect(panel.options.onUnhandledInput?.('k', undefined)).toBeUndefined()
    expect(panel.options.onUnhandledInput?.('x', 'bash-1')).toBeUndefined()
    panel.options.onClose()
    panel.options.onClose()
    await rig.fiber.dispose()
  })
})
