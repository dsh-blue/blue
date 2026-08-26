/** Tests for the app-owned all-prompts title cadence bridge. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { installSessionTitleCadence } from '../src/title-cadence.ts'

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

function userMessage(kind: 'user' | 'plugin' = 'user') {
  return { type: 'user/message', data: { source: { kind } } }
}

function boot(options: { header?: boolean, service?: object | null } = {}): {
  ctx: Context
  session: FakeSession
  refresh: ReturnType<typeof vi.fn>
  setCurrent(session: FakeSession | undefined): void
  dispose(): void
} {
  const ctx = new Context()
  const refresh = vi.fn(() => Promise.resolve(undefined))
  if (options.service !== null) ctx.provide('sessionTitle', options.service ?? { refresh })
  const session = fakeSession(options.header ?? true)
  let current: FakeSession | undefined = session
  const dispose = installSessionTitleCadence(ctx, () => current as Session | undefined)
  return { ctx, session, refresh, setCurrent: value => { current = value }, dispose }
}

const flush = (): Promise<void> => new Promise(resolve => { queueMicrotask(resolve) })

describe('installSessionTitleCadence', () => {
  it('refreshes the current headered session after a direct human message', async () => {
    const { ctx, session, refresh } = boot()
    ctx.emit('session/event', session as never, userMessage() as never)
    await flush()
    expect(refresh).toHaveBeenCalledWith(session, expect.any(AbortSignal))
  })

  it('ignores header-less, foreign, non-human, and thin-host events', async () => {
    const headerless = boot({ header: false })
    headerless.ctx.emit('session/event', headerless.session as never, userMessage() as never)
    const ordinary = boot()
    ordinary.ctx.emit('session/event', fakeSession(true) as never, userMessage() as never)
    ordinary.ctx.emit('session/event', ordinary.session as never, userMessage('plugin') as never)
    const thin = boot({ service: null })
    thin.ctx.emit('session/event', thin.session as never, userMessage() as never)
    await flush()
    expect(headerless.refresh).not.toHaveBeenCalled()
    expect(ordinary.refresh).not.toHaveBeenCalled()
    expect(thin.refresh).not.toHaveBeenCalled()
  })

  it('drops a stale queued refresh after the current session changes', async () => {
    const test = boot()
    test.ctx.emit('session/event', test.session as never, userMessage() as never)
    test.setCurrent(fakeSession(true))
    await flush()
    expect(test.refresh).not.toHaveBeenCalled()
  })

  it('aborts and drops queued work on dispose', async () => {
    const test = boot()
    test.ctx.emit('session/event', test.session as never, userMessage() as never)
    test.dispose()
    test.dispose()
    await flush()
    expect(test.refresh).not.toHaveBeenCalled()
  })

  it('warns on refresh failure but ignores abort rejection', async () => {
    const ctx = new Context()
    const session = fakeSession(true)
    ctx.provide('sessionTitle', { refresh: () => Promise.reject(new Error('aux route gone')) })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const dispose = installSessionTitleCadence(ctx, () => session as Session)
    ctx.emit('session/event', session as never, userMessage() as never)
    await vi.waitFor(() => { expect(warn).toHaveBeenCalledWith(expect.stringContaining('aux route gone')) })
    dispose()
    warn.mockClear()
    expect(warn).not.toHaveBeenCalled()
  })

  it('suppresses a refresh rejection that settles after disposal', async () => {
    const ctx = new Context()
    const session = fakeSession(true)
    let rejectRefresh: ((error: Error) => void) | undefined
    ctx.provide('sessionTitle', {
      refresh: () => new Promise((_resolve, reject) => { rejectRefresh = reject }),
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const dispose = installSessionTitleCadence(ctx, () => session as Session)
    ctx.emit('session/event', session as never, userMessage() as never)
    await flush()
    dispose()
    rejectRefresh?.(new Error('aborted refresh'))
    await flush()
    expect(warn).not.toHaveBeenCalled()
  })
})
