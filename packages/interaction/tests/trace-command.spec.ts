/** Tests for `/trace` command registration, official query reads, and copy paths. */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { fakeBlueContext } from './fakes.ts'
import { setClipboardOsc52Emitter, setClipboardTextWriter } from '../src/clipboard-write.ts'
import { registerTraceCommand } from '../src/trace-command.ts'

const record = { sessionId: SessionId('trace-test'), seq: 0, time: 1, type: 'user/message', surface: 'current' as const }
const target = { type: 'user/message', seq: 0, time: 1, surfaceOp: 'append', data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } } }

describe('registerTraceCommand', () => {
  let copied: string[]

  beforeEach(() => {
    copied = []
    setClipboardTextWriter(async text => { copied.push(text) })
    setClipboardOsc52Emitter(() => false)
  })

  afterEach(() => {
    setClipboardTextWriter(undefined)
    setClipboardOsc52Emitter(undefined)
  })

  async function mount(options: { session?: boolean, query?: boolean, throwRead?: unknown } = {}) {
    const { ctx, screen } = fakeBlueContext()
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('trace-test'))
    if (options.session !== false) ctx.provide('blueSession', { current: { id: SessionId('trace-test') } as never })
    if (options.query !== false) {
      ctx.provide('sessionQuery', {
        readSession: vi.fn(async () => options.throwRead === undefined ? ({ session: {}, events: [target] }) : Promise.reject(options.throwRead)),
        readEvent: vi.fn(async () => ({ session: {}, target, events: [target], startSeq: 0, endSeq: 0 })),
        traceEvent: vi.fn(async () => ({ session: {}, target: record, replacementChain: [], replacedEventSeqs: [], sourceEventSeqs: [], derivedEventSeqs: [] })),
      } as never)
    }
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
    expect(panel?.render(80).join('\n')).toContain('"type": "user/message"')
    panel?.handleInput('a')
    await Promise.resolve()
    panel?.handleInput('c')
    await Promise.resolve()
    setClipboardTextWriter(async () => { throw new Error('clipboard down') })
    panel?.handleInput('a')
    await Promise.resolve()
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
  })
})
