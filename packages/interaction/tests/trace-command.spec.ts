/** Tests for `/trace` command registration, official query reads, and copy paths. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Action } from '@dsh-blue/blue-frontend'
import { fakeBlueContext } from './fakes.ts'
import { setClipboardOsc52Emitter, setClipboardTextWriter } from '../src/clipboard-write.ts'
import { setSharedEditor } from '../src/editor-instance.ts'
import { registerTraceCommand, traceDetailPanelModel, tracePanelModel } from '../src/trace-command.ts'
import type { TraceItem } from '../src/trace-format.ts'

const record = { sessionId: SessionId('trace-test'), seq: 0, time: 1, type: 'user/message', surface: 'current' as const }
const target = { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } }

describe('registerTraceCommand', () => {
  let copied: string[]
  let notices: string[]

  beforeEach(() => {
    copied = []
    notices = []
    setClipboardTextWriter(async text => { copied.push(text) })
    setClipboardOsc52Emitter(() => false)
  })

  afterEach(() => {
    setClipboardTextWriter(undefined)
    setClipboardOsc52Emitter(undefined)
  })

  it('builds empty, aggregated, and raw-detail panel models', () => {
    expect(tracePanelModel('session', [])).toMatchObject({ mode: 'info', view: { content: 'no trace events yet' } })
    const item: TraceItem = {
      seq: 3, lastSeq: 5, eventSeqs: [3, 4, 5], time: Number.NaN,
      type: 'assistant/chunk', surface: 'shadowed', title: 'Thinking', summary: 'first\nsecond',
    }
    expect(tracePanelModel('session', [item])).toMatchObject({
      mode: 'select',
      items: [{ id: '3', label: expect.stringContaining('??:??:?? · #3-5'), detail: 'first second' }],
    })
    expect(traceDetailPanelModel(item, '[{"type":"assistant/chunk"}]')).toMatchObject({
      mode: 'info', title: 'Trace detail #3-5', view: { kind: 'sections' },
    })
  })

  async function mount(options: { session?: boolean, query?: boolean, display?: boolean, throwRead?: unknown } = {}) {
    const { ctx, screen } = fakeBlueContext({ display: options.display })
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('trace-test'))
    if (options.session !== false) ctx.provide('testSession', { current: { id: SessionId('trace-test') } as never })
    if (options.query !== false) {
      ctx.provide('sessionQuery', {
        readSession: vi.fn(async () => options.throwRead === undefined ? ({ session: {}, events: [target] }) : Promise.reject(options.throwRead)),
        readEvent: vi.fn(async () => ({ session: {}, target, events: [target], startSeq: 0, endSeq: 0 })),
        traceEvent: vi.fn(async () => ({ session: {}, target: record, replacementChain: [], replacedEventSeqs: [], sourceEventSeqs: [], derivedEventSeqs: [] })),
      } as never)
    }
    setSharedEditor(ctx, {
      editor: { focused: false, render: () => [], invalidate: () => {} } as never,
      submitPrompt: () => {},
      notice: text => { notices.push(text) },
    })
    const dispose = registerTraceCommand(ctx)
    const agent = { id: session.id, session } as never
    return { ctx, dispose, agent, screen }
  }

  it('copies all, a selected event, and rejects an unknown event', async () => {
    const { ctx, dispose, agent } = await mount()
    expect(await ctx.commands.execute(agent, '/trace copy all', [], new AbortController().signal)).toMatchObject({ result: { kind: 'success' } })
    expect(copied[0]).toContain('# Trace')
    expect(await ctx.commands.execute(agent, '/trace copy 0', [], new AbortController().signal)).toMatchObject({ result: { kind: 'success' } })
    expect(copied[1]).toContain('hello')
    expect(await ctx.commands.execute(agent, '/trace copy 9', [], new AbortController().signal)).toMatchObject({ result: { kind: 'error', text: 'trace event #9 was not found' } })
    setClipboardTextWriter(async () => { throw new Error('clipboard down') })
    expect(await ctx.commands.execute(agent, '/trace copy 0', [], new AbortController().signal)).toMatchObject({ result: { kind: 'error', text: 'could not copy trace item: clipboard down' } })
    dispose()
  })

  it('opens the editor-slot panel and loads selected details', async () => {
    const { ctx, dispose, agent, screen } = await mount()
    expect(await ctx.commands.execute(agent, '/trace', [], new AbortController().signal)).toMatchObject({ result: { kind: 'success' } })
    const panel = screen.overlays[0]?.component
    expect(panel).toBeDefined()
    panel?.handleInput('\r')
    await Promise.resolve()
    const detail = screen.overlays[1]?.component
    expect(detail).toBeDefined()
    expect(detail?.render(80).join('\n')).toContain('user/message')
    detail?.handleInput('\x1b[6~')
    detail?.handleInput('\x1b')
    panel?.handleInput('a')
    await vi.waitFor(() => { expect(notices).toContain('copied 1 trace events') })
    panel?.handleInput('c')
    await Promise.resolve()
    const options = (panel as unknown as {
      options: {
        onAction(action: Action): void
        onUnhandledInput?(data: string, selectedId: string | undefined): Action | undefined
      }
    }).options
    options.onAction({ kind: 'trace.unknown', seq: 0 })
    expect(options.onUnhandledInput?.('c', undefined)).toBeUndefined()
    setClipboardTextWriter(async () => { throw new Error('native clipboard unavailable') })
    setClipboardOsc52Emitter(() => true)
    panel?.handleInput('a')
    await vi.waitFor(() => { expect(notices.some(notice => notice.includes('terminal escape sequence'))).toBe(true) })
    setClipboardTextWriter(async () => { throw new Error('clipboard down') })
    setClipboardOsc52Emitter(() => false)
    panel?.handleInput('a')
    await vi.waitFor(() => { expect(notices).toContain('could not copy trace: clipboard down') })
    panel?.handleInput('\x1b')
    dispose()
  })

  it('reports missing session and query service and unregisters', async () => {
    const missing = await mount({ session: false })
    expect(await missing.ctx.commands.execute(missing.agent, '/trace', [], new AbortController().signal)).toMatchObject({ result: { kind: 'error', text: 'no session is live yet' } })
    missing.dispose()
    const noQuery = await mount({ query: false })
    expect(await noQuery.ctx.commands.execute(noQuery.agent, '/trace', [], new AbortController().signal)).toMatchObject({ result: { kind: 'error', text: 'could not read trace: session query is unavailable' } })
    noQuery.dispose()
    expect(await noQuery.ctx.commands.execute(noQuery.agent, '/trace copy all', [], new AbortController().signal)).toBeUndefined()
    const { ctx: broken, agent: brokenAgent, dispose: disposeBroken } = await mount({ throwRead: 'broken' })
    expect(await broken.commands.execute(brokenAgent, '/trace', [], new AbortController().signal)).toMatchObject({ result: { text: 'could not read trace: broken' } })
    disposeBroken()
    const noDisplay = await mount({ display: false })
    expect(await noDisplay.ctx.commands.execute(noDisplay.agent, '/trace', [], new AbortController().signal))
      .toMatchObject({ result: { kind: 'error', text: 'trace is unavailable: the Blue screen is not mounted' } })
    noDisplay.dispose()
  })
})
