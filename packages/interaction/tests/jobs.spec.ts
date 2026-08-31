/**
 * `/jobs` command: the panel model builders, capability/display errors, the
 * editor-slot list panel with live snapshot following, the one-second tick,
 * output detail reads, kill routing, and fiber-unload cleanup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { BlueTranslate } from '@dsh-blue/blue-frontend'
import type { BlueJob, BlueJobsService, BlueJobsSnapshot } from '@dsh-blue/blue-app'
import { fakeBlueContext } from './fakes.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import * as jobsPlugin from '../src/jobs.ts'
import { formatJobDuration, isLiveJob, jobOutputPanelModel, jobsPanelModel, tailJobOutput } from '../src/jobs.ts'

const t: BlueTranslate = (key, values) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), key)

const job = (id: string, status: BlueJob['status'], overrides: Partial<BlueJob> = {}): BlueJob => ({
  id, kind: 'bash', label: `label ${id}`, status, startedAt: 1_000, ...overrides,
})

/** Structural `blueJobs` fake with a mutable snapshot and recorded calls. */
function fakeJobs(rows: BlueJob[] = [], available = true) {
  let snapshot: BlueJobsSnapshot = Object.freeze({ available, jobs: Object.freeze(rows) })
  const listeners = new Set<(next: BlueJobsSnapshot) => void>()
  const service: BlueJobsService = {
    current: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot)
      let disposed = false
      return { get disposed() { return disposed }, dispose: () => { if (!disposed) { disposed = true; listeners.delete(listener) } } }
    },
    killJob: vi.fn((_id: string) => ({ ok: true, value: 'requested' as const })),
    readJobOutput: vi.fn((id: string) => ({
      ok: true as const,
      value: { text: `first\nsecond ${id}`, job: job(id, 'completed', { finishedAt: 2_000 }) },
    })),
  }
  return {
    service,
    listenerCount: () => listeners.size,
    publish(next: BlueJob[], nextAvailable = true) {
      snapshot = Object.freeze({ available: nextAvailable, jobs: Object.freeze(next) })
      for (const listener of listeners) listener(snapshot)
    },
    /** Swap the snapshot without notifying: a change the facade has not observed yet. */
    setSilently(next: BlueJob[]) {
      snapshot = Object.freeze({ available: true, jobs: Object.freeze(next) })
    },
  }
}

describe('jobs panel models', () => {
  it('formats compact durations', () => {
    expect(formatJobDuration(1_000, 1_000)).toBe('0s')
    expect(formatJobDuration(0, 59_999)).toBe('59s')
    expect(formatJobDuration(0, 60_000)).toBe('1m')
    expect(formatJobDuration(0, 3_599_000)).toBe('59m')
    expect(formatJobDuration(0, 3_600_000)).toBe('1h')
    expect(formatJobDuration(0, 3_660_000)).toBe('1h 1m')
  })

  it('detects live jobs and tails output', () => {
    expect(isLiveJob(job('a', 'running'))).toBe(true)
    expect(isLiveJob(job('a', 'stopping'))).toBe(true)
    expect(isLiveJob(job('a', 'completed'))).toBe(false)
    expect(tailJobOutput('a\nb')).toEqual({ text: 'a\nb', truncated: false })
    const long = Array.from({ length: 130 }, (_, index) => `row ${index}`).join('\n')
    const tail = tailJobOutput(long)
    expect(tail.truncated).toBe(true)
    expect(tail.text.split('\n')).toHaveLength(120)
    expect(tail.text.startsWith('row 10')).toBe(true)
  })

  it('builds the list model with marks, durations, and the empty state', () => {
    const empty = jobsPanelModel({ available: true, jobs: [] }, 0, t)
    expect(empty).toMatchObject({ mode: 'select', title: 'Jobs', empty: { title: 'no background jobs' } })
    const model = jobsPanelModel({
      available: true,
      jobs: [
        job('bash-1', 'running'),
        job('bash-2', 'stopping'),
        job('bash-3', 'completed'),
        job('bash-4', 'failed', { detail: 'exit code: 3', finishedAt: 5_000 }),
        job('bash-5', 'killed', { finishedAt: 4_000 }),
      ],
    }, 61_000, t)
    expect(model.selectedId).toBe('bash-1')
    expect(model.items?.map(item => item.label)).toEqual([
      '● bash-1  label bash-1',
      '● bash-2  label bash-2',
      '✓ bash-3  label bash-3',
      '✗ bash-4  label bash-4',
      '⊘ bash-5  label bash-5',
    ])
    expect(model.items?.[0]?.detail).toBe('running 1m')
    expect(model.items?.[2]?.detail).toBe('completed')
    expect(model.items?.[3]?.detail).toBe('failed · exit code: 3')
    expect(model.items?.[0]?.action).toEqual({ kind: 'jobs.view', id: 'bash-1' })
  })

  it('builds the output detail with the live-cursor warning, empty, and truncated output', () => {
    const live = jobOutputPanelModel(job('bash-1', 'running'), 'chunk', t)
    expect(live.title).toBe('Job bash-1')
    expect(live.view).toMatchObject({
      kind: 'sections',
      sections: [
        { body: { kind: 'text', tone: 'warning', content: expect.stringContaining('output cursor') } },
        { title: 'label bash-1 · running', body: { kind: 'code', code: 'chunk' } },
      ],
    })
    const settled = jobOutputPanelModel(job('bash-2', 'failed', { detail: 'exit code: 3', finishedAt: 2_000 }), '', t)
    expect(settled.view).toMatchObject({
      sections: [{ title: 'label bash-2 · failed · exit code: 3', body: { code: '(no output)' } }],
    })
    const long = Array.from({ length: 130 }, (_, index) => `row ${index}`).join('\n')
    const truncated = jobOutputPanelModel(job('bash-3', 'completed', { finishedAt: 2_000 }), long, t)
    const code = (truncated.view as { sections: { body: { code: string } }[] }).sections[0]!.body.code
    expect(code.startsWith('… output truncated\nrow 10')).toBe(true)
  })
})

describe('blue-jobs command', () => {
  let notices: string[]

  beforeEach(() => { notices = [] })
  afterEach(() => { vi.useRealTimers() })

  async function mount(options: { display?: boolean, available?: boolean, rows?: BlueJob[] } = {}) {
    const { ctx, screen } = fakeBlueContext({ display: options.display })
    await ctx.plugin(CommandRuntime)
    const fake = fakeJobs(options.rows ?? [], options.available ?? true)
    ctx.provide('blueJobs', fake.service as never)
    setSharedEditor(ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: text => { notices.push(text) },
    })
    const fiber = await ctx.plugin(jobsPlugin)
    const agent = { id: 'a1', session: { append: vi.fn() } } as never
    const execute = (line: string) => ctx.commands.execute(agent, line, [], new AbortController().signal)
    return { ctx, screen, fake, fiber, execute }
  }

  it('reports capability absence and a missing display', async () => {
    const unavailable = await mount({ available: false })
    expect(await unavailable.execute('/jobs')).toMatchObject({ result: { kind: 'error', text: 'background jobs are unavailable on this host' } })
    await unavailable.fiber.dispose()
    const headless = await mount({ display: false })
    expect(await headless.execute('/jobs')).toMatchObject({ result: { kind: 'error', text: 'jobs panel is unavailable: the Blue screen is not mounted' } })
    await headless.fiber.dispose()
  })

  it('opens the editor-slot list, views output, kills a live job, and closes', async () => {
    const { screen, fake, fiber, execute } = await mount({
      rows: [job('bash-1', 'running'), job('bash-2', 'completed', { finishedAt: 2_000 })],
    })
    expect(await execute('/jobs')).toMatchObject({ result: { kind: 'success' } })
    const panel = screen.overlays[0]?.component
    expect(panel).toBeDefined()
    const frame = panel?.render(80).join('\n') ?? ''
    expect(frame).toContain('● bash-1  label bash-1')
    expect(frame).toContain('✓ bash-2  label bash-2')
    // Enter on the running job: the fake read returns a completed snapshot.
    panel?.handleInput('\r')
    await Promise.resolve()
    expect(fake.service.readJobOutput).toHaveBeenCalledWith('bash-1')
    const detail = screen.overlays[1]?.component
    expect(detail).toBeDefined()
    const detailFrame = detail?.render(80).join('\n') ?? ''
    expect(detailFrame).toContain('second bash-1')
    expect(detailFrame).not.toContain('output cursor')
    detail?.handleInput('\x1b')
    // k on the settled job is a no-op; k on the live job kills it.
    panel?.handleInput('\x1b[B')
    panel?.handleInput('k')
    expect(fake.service.killJob).not.toHaveBeenCalled()
    panel?.handleInput('\x1b[A')
    panel?.handleInput('k')
    expect(fake.service.killJob).toHaveBeenCalledWith('bash-1')
    panel?.handleInput('\x1b')
    await fiber.dispose()
  })

  it('shows the live-cursor warning when reading a running job', async () => {
    const { screen, fake, fiber, execute } = await mount({ rows: [job('bash-1', 'running')] })
    vi.mocked(fake.service.readJobOutput).mockReturnValueOnce({
      ok: true,
      value: { text: 'partial output', job: job('bash-1', 'running') },
    })
    await execute('/jobs')
    screen.overlays[0]?.component.handleInput('\r')
    await Promise.resolve()
    const detailFrame = screen.overlays[1]?.component.render(80).join('\n')
    expect(detailFrame).toContain('partial output')
    expect(detailFrame).toContain('output cursor')
    screen.overlays[1]?.component.handleInput('\x1b')
    screen.overlays[0]?.component.handleInput('\x1b')
    await fiber.dispose()
  })

  it('notices kill and read failures', async () => {
    const { screen, fake, fiber, execute } = await mount({ rows: [job('bash-1', 'running')] })
    await execute('/jobs')
    const panel = screen.overlays[0]!.component
    vi.mocked(fake.service.readJobOutput).mockReturnValueOnce({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'foreign job' })
    panel.handleInput('\r')
    await Promise.resolve()
    expect(notices).toContain('foreign job')
    expect(screen.overlays).toHaveLength(1)
    vi.mocked(fake.service.killJob).mockReturnValueOnce({ ok: false, code: 'BLUE_ACTION_REJECTED', message: 'unknown job' })
    panel.handleInput('k')
    expect(notices).toContain('unknown job')
    panel.handleInput('\x1b')
    await fiber.dispose()
  })

  it('follows snapshot changes and ticks durations only while live jobs remain', async () => {
    vi.useFakeTimers()
    const { screen, fake, fiber, execute } = await mount({ rows: [job('bash-1', 'running')] })
    await execute('/jobs')
    const panel = screen.overlays[0]!.component
    const baseline = screen.renderRequests
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.renderRequests).toBeGreaterThan(baseline)
    // The tick disarms itself when the queue drained between ticks (the
    // facade has not observed the settle yet).
    fake.setSilently([job('bash-1', 'completed', { finishedAt: 2_000 })])
    const drained = screen.renderRequests
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screen.renderRequests).toBeGreaterThan(drained)
    const selfDisarmed = screen.renderRequests
    await vi.advanceTimersByTimeAsync(2_000)
    expect(screen.renderRequests).toBe(selfDisarmed)
    // The subscription repaint re-arms the tick while a live job remains...
    fake.publish([job('bash-1', 'running')])
    const rearmed = screen.renderRequests
    expect(rearmed).toBeGreaterThan(selfDisarmed)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(screen.renderRequests).toBeGreaterThan(rearmed)
    // ...and disarms it once the publish leaves nothing live.
    fake.publish([job('bash-1', 'completed', { finishedAt: 2_000 })])
    const settled = screen.renderRequests
    expect(settled).toBeGreaterThan(rearmed)
    expect(panel.render(80).join('\n')).toContain('✓ bash-1  label bash-1')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(screen.renderRequests).toBe(settled)
    panel.handleInput('\x1b')
    await fiber.dispose()
  })

  it('closes idempotently and guards kill against unknown or settled jobs', async () => {
    const { screen, fake, fiber, execute } = await mount({
      rows: [job('bash-1', 'running'), job('bash-2', 'completed', { finishedAt: 2_000 })],
    })
    await execute('/jobs')
    const panel = screen.overlays[0]!.component as unknown as {
      options: { onAction(action: { kind: string, id?: string }): void, onClose(): void }
    }
    panel.options.onAction({ kind: 'jobs.kill', id: 'bash-99' })
    panel.options.onAction({ kind: 'jobs.kill', id: 'bash-2' })
    expect(fake.service.killJob).not.toHaveBeenCalled()
    panel.options.onClose()
    panel.options.onClose()
    await fiber.dispose()
  })

  it('cleans up the timer and subscription when the fiber unloads with the panel open', async () => {
    vi.useFakeTimers()
    const { screen, fake, fiber, execute } = await mount({ rows: [job('bash-1', 'running')] })
    await execute('/jobs')
    expect(fake.listenerCount()).toBe(1)
    await fiber.dispose()
    expect(fake.listenerCount()).toBe(0)
    const before = screen.renderRequests
    await vi.advanceTimersByTimeAsync(3_000)
    expect(screen.renderRequests).toBe(before)
    fake.publish([job('bash-1', 'running'), job('bash-2', 'running')])
    expect(screen.renderRequests).toBe(before)
  })

  it('ignores unhandled input and unknown actions', async () => {
    const { screen, fiber, execute } = await mount({ rows: [job('bash-1', 'running')] })
    await execute('/jobs')
    const panel = screen.overlays[0]!.component as unknown as {
      handleInput(data: string): void
      options: { onAction(action: { kind: string }): void, onUnhandledInput?(data: string, selectedId: string | undefined): unknown }
    }
    expect(panel.options.onUnhandledInput?.('k', undefined)).toBeUndefined()
    expect(panel.options.onUnhandledInput?.('x', 'bash-1')).toBeUndefined()
    panel.options.onAction({ kind: 'jobs.view' })
    panel.options.onAction({ kind: 'jobs.unknown' })
    expect(screen.overlays).toHaveLength(1)
    panel.handleInput('\x1b')
    await fiber.dispose()
  })
})
