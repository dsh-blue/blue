/**
 * Tests for the `blue-approval` plugin: the interactive answerer on the
 * `approval/request` waterfall, dispatched directly through Cordis (the
 * approval service's policy/session plumbing is covered by
 * `@deepseek-ai/dsh-user-approval` itself).
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as approvalPlugin from '../src/approval-plugin.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

async function mount(options: { attach?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  agent: Agent
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('approval-spec'))
  const agent = { id: session.id, session } as unknown as Agent
  ctx.provide('blueSession', { current: options.attach === false ? null : agent })
  await ctx.plugin(approvalPlugin)
  return { ctx, screen, agent }
}

function request(agent: Agent, extra: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { agent, toolName: 'bash', ...extra }
}

/** Dispatch the waterfall with the fail-closed fallback as the chain tail. */
function decide(
  ctx: Context,
  req: ApprovalRequest,
): Promise<ApprovalOutcome> & { fallback: ReturnType<typeof vi.fn> } {
  const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
  return Object.assign(ctx.waterfall('approval/request', req, fallback), { fallback })
}

function overlay(screen: FakeScreen): { handleInput(data: string): void } {
  const entry = screen.overlays.at(-1)
  if (entry === undefined) throw new Error('no overlay shown')
  return entry.component as { handleInput(data: string): void }
}

describe('blue-approval answerer', () => {
  it('allows once on confirm of the default choice', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent, { reason: 'writes files' }))
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    expect(rendered[0]).toBe('?Approve bash??')
    expect(rendered[1]).toBe('~writes files~')
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('allowed-once')
    expect(pending.fallback).not.toHaveBeenCalled()
    expect(screen.overlays[0]?.hidden).toBe(true)
    // A second confirmation after settling is a no-op.
    overlay(screen).handleInput(KEY.enter)
  })

  it('rejects when the Reject choice is confirmed', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('rejected')
  })

  it('cancels on Escape', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).resolves.toBe('cancelled')
  })

  it('cancels and hides the overlay when the request signal aborts', async () => {
    const { ctx, screen, agent } = await mount()
    const controller = new AbortController()
    const pending = decide(ctx, request(agent, { signal: controller.signal }))
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(screen.overlays[0]?.hidden).toBe(true)
  })

  it('settles immediately as cancelled for a pre-aborted signal', async () => {
    const { ctx, screen, agent } = await mount()
    const controller = new AbortController()
    controller.abort()
    await expect(decide(ctx, request(agent, { signal: controller.signal }))).resolves.toBe('cancelled')
    expect(screen.overlays).toHaveLength(0)
  })

  it('delegates down the waterfall for an agent the UI does not own', async () => {
    const { ctx, screen } = await mount()
    const other = { id: 'other' } as unknown as Agent
    const pending = decide(ctx, request(other))
    await expect(pending).resolves.toBe('unavailable')
    expect(pending.fallback).toHaveBeenCalledOnce()
    expect(screen.overlays).toHaveLength(0)
  })

  it('delegates when no session is attached', async () => {
    const { ctx, screen, agent } = await mount({ attach: false })
    const pending = decide(ctx, request(agent))
    await expect(pending).resolves.toBe('unavailable')
    expect(screen.overlays).toHaveLength(0)
  })

  it('omits the reason row when the asker gave none', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    expect(rendered[0]).toBe('?Approve bash??')
    expect(rendered[1]).toContain('Allow once')
    overlay(screen).handleInput(KEY.escape)
    await pending
  })
})
