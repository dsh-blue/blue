/**
 * The all-prompts cadence bridge (`blue-session-title-cadence`, D41): the
 * refresh deferred to a microtask on every human message of the current
 * session once a request header exists, the header-less first message left
 * to the service's own path, the foreign-session and non-human filters,
 * the thin-host skip, the null agent broadcast, and the refresh rejection
 * warn.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as cadence from '../src/session-title-cadence.ts'
import { fakeBlueContext } from './fakes.ts'

/** The fake session: an identity token plus a programmable header. */
interface FakeSession {
  id: string
  requestHeader(): { config: { provider: string, model: string } } | undefined
}

function fakeSession(withHeader: boolean): FakeSession {
  return {
    id: `cadence-spec-${withHeader ? 'headered' : 'header-less'}`,
    requestHeader: () => withHeader
      ? { config: { provider: 'spec-provider', model: 'spec-model' } }
      : undefined,
  }
}

function attach(session: FakeSession): Agent {
  return { id: 'cadence-spec-agent', session, status: 'idle' } as unknown as Agent
}

/** One user/message event slice; the source kind drives the human filter. */
function userMessage(kind: 'user' | 'plugin' = 'user') {
  return { type: 'user/message', data: { source: { kind } } }
}

/** Boot the bridge with a current agent over a headered or header-less session. */
async function boot(options: { header?: boolean, service?: object | null } = {}): Promise<{
  ctx: ReturnType<typeof fakeBlueContext>['ctx']
  session: FakeSession
  refresh: ReturnType<typeof vi.fn>
}> {
  const { ctx } = fakeBlueContext()
  const refresh = vi.fn(() => Promise.resolve(undefined))
  // Providing null models the thin host (the service never mounted).
  if (options.service !== null) ctx.provide('sessionTitle', options.service ?? { refresh })
  const session = fakeSession(options.header ?? true)
  ctx.provide('blueSession', { current: attach(session) })
  await ctx.plugin(cadence)
  return { ctx, session, refresh }
}

/** Flush the queueMicrotask hop between the observer and the refresh. */
const flush = (): Promise<void> => new Promise(resolve => { queueMicrotask(resolve) })

describe('blue-session-title-cadence', () => {
  it('refreshes on a human message of the current session once a header exists', async () => {
    const { ctx, session, refresh } = await boot()
    ctx.emit('session/event', session as never, userMessage() as never)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(session)
  })

  it('stays out before the first request header (the service path owns it)', async () => {
    const { ctx, session, refresh } = await boot({ header: false })
    ctx.emit('session/event', session as never, userMessage() as never)
    await flush()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ignores foreign sessions and non-human messages', async () => {
    const { ctx, session, refresh } = await boot()
    ctx.emit('session/event', fakeSession(true) as never, userMessage() as never)
    ctx.emit('session/event', session as never, userMessage('plugin') as never)
    await flush()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('skips a thin host without the service and a null agent broadcast', async () => {
    const { ctx, session } = await boot({ service: null })
    expect(() => ctx.emit('session/event', session as never, userMessage() as never)).not.toThrow()
    await flush()

    // A failed /new broadcasts null; events before the next attach are ignored.
    ctx.emit('blue/session-changed', null as never)
    expect(() => ctx.emit('session/event', session as never, userMessage() as never)).not.toThrow()
    await flush()
  })

  it('follows the agent on session switches', async () => {
    const { ctx, session, refresh } = await boot()
    const next = fakeSession(true)
    ctx.emit('blue/session-changed', attach(next) as never)
    ctx.emit('session/event', session as never, userMessage() as never)
    ctx.emit('session/event', next as never, userMessage() as never)
    await flush()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith(next)
  })

  it('warns when the refresh rejects', async () => {
    const { ctx } = fakeBlueContext()
    const refresh = vi.fn(() => Promise.reject(new Error('aux route gone')))
    ctx.provide('sessionTitle', { refresh })
    const session = fakeSession(true)
    ctx.provide('blueSession', { current: attach(session) })
    await ctx.plugin(cadence)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.emit('session/event', session as never, userMessage() as never)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledTimes(1) })
    expect(warn.mock.calls[0]![0]).toContain('aux route gone')
  })
})
