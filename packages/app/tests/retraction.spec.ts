/** Safe main-turn retraction and durable surface replacement tests. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createBlueRequestController } from '../src/request-lifecycle.ts'
import { installRetractionService } from '../src/retraction.ts'

/** Build one running agent over a real append-only Session. */
function rig(options: { current?: 'agent' | 'none'; route?: 'agent' | 'header' | 'empty' } = {}) {
  const ctx = new Context()
  const session = Session.create(SessionId('retraction-test'))
  const cancel = vi.fn()
  const agent = {
    id: session.id,
    status: 'running',
    session,
    options: options.route === 'empty' ? {} : { provider: 'mock', model: 'mock-model' },
    cancel,
  } as unknown as Agent
  const requests = createBlueRequestController(ctx)
  const errors: string[] = []
  if (options.route === 'header') {
    Object.defineProperty(session, 'requestHeader', {
      value: () => ({ config: { provider: 'header-provider', model: 'header-model' } }),
    })
  }
  const service = installRetractionService(
    ctx,
    () => options.current === 'none' ? null : agent,
    requests,
    message => errors.push(message),
  )
  return { agent, cancel, ctx, errors, requests, service, session }
}

/** Enter one ordinary human prompt into an open turn. */
function enterPrompt(session: Session, text = 'change this') {
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  return message
}

describe('message retraction', () => {
  it('cancels a text/reasoning-only turn and durably removes it from model history', async () => {
    const test = rig()
    const lifecycle: string[] = []
    const retracted: number[] = []
    test.ctx.on('blue/request-state-changed', event => lifecycle.push(event.state))
    test.ctx.on('blue/turn-retracted', event => retracted.push(event.turn))
    test.requests.begin('main')
    const message = enterPrompt(test.session)
    test.session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'reasoning-delta', text: 'private thought' },
    })

    test.ctx.emit('session/event', Session.create(SessionId('foreign')), {
      type: 'turn/end', seq: 0, time: 0, data: { turn: 1, reason: { kind: 'aborted' } },
    })
    expect(test.service.tryRetract(String(message.id))).toBe(true)
    expect(test.service.tryRetract(String(message.id))).toBe(false)
    test.ctx.emit('session/event', test.session, {
      type: 'step/end', seq: 99, time: 0, data: { turn: 1, step: 1 },
    })
    test.ctx.emit('session/event', test.session, {
      type: 'turn/end', seq: 100, time: 0, data: { turn: 2, reason: { kind: 'aborted' } },
    })
    expect(test.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    expect(lifecycle).toEqual(['started', 'aborted'])
    expect(retracted).toEqual([1])

    const end = test.session.append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
    test.ctx.emit('session/event', test.session, end)
    await Promise.resolve()
    const marker = test.session.events.at(-1)!
    expect(marker).toMatchObject({
      type: 'assistant/message',
      data: { turn: 1, step: 1, interrupted: true, message: { content: [] } },
      surfaceOp: { op: 'replace' },
    })
    expect(test.session.deriveMessages()).toEqual([])
    expect(test.errors).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('rejects a turn after a tool call is recorded', async () => {
    const test = rig()
    test.requests.begin('main')
    const message = enterPrompt(test.session)
    test.session.append('tool/call', {
      turn: 1,
      step: 1,
      callId: CallId('call-1'),
      name: 'bash',
      arguments: '{}',
    })
    expect(test.service.tryRetract(String(message.id))).toBe(false)
    expect(test.cancel).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('rejects a stale message id without changing the request lifecycle', async () => {
    const test = rig()
    const ref = test.requests.begin('main')
    enterPrompt(test.session)
    expect(test.service.tryRetract('another-message')).toBe(false)
    expect(test.requests.active()).toBe(ref)
    expect(test.cancel).not.toHaveBeenCalled()
    await test.ctx.fiber.dispose()
  })

  it('rejects a closed turn and a missing live agent', async () => {
    const closed = rig()
    closed.requests.begin('main')
    const message = enterPrompt(closed.session)
    closed.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(closed.service.tryRetract(String(message.id))).toBe(false)
    await closed.ctx.fiber.dispose()

    const missing = rig({ current: 'none' })
    missing.requests.begin('main')
    expect(missing.service.tryRetract('missing')).toBe(false)
    await missing.ctx.fiber.dispose()
  })

  it('rejects an assistant tool-call intent before execution records begin', async () => {
    const test = rig()
    test.requests.begin('main')
    const message = enterPrompt(test.session)
    test.session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'assistant-tool' as never,
        role: 'assistant',
        source: { kind: 'model', provider: 'mock', model: 'mock-model' },
        content: [{ type: 'tool-call', id: CallId('call-2'), name: 'bash', arguments: '{}' }],
      },
    }, { surfaceOp: 'append' })
    expect(test.service.tryRetract(String(message.id))).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it.each([
    ['Error', new Error('append failed')],
    ['string', 'append failed'],
  ])('reports a %s replacement append failure', async (_label, failure) => {
    const test = rig({ route: _label === 'Error' ? 'header' : 'empty' })
    test.requests.begin('main')
    const message = enterPrompt(test.session)
    expect(test.service.tryRetract(String(message.id))).toBe(true)
    const append = test.session.append.bind(test.session)
    const end = append('turn/end', { turn: 1, reason: { kind: 'aborted' } })
    Object.defineProperty(test.session, 'append', { value: () => { throw failure } })
    test.ctx.emit('session/event', test.session, end)
    await Promise.resolve()
    expect(test.errors).toEqual(['could not persist message retraction: append failed'])
    await test.ctx.fiber.dispose()
  })
})
