/**
 * Tests for the `blue-approval` plugin: the interactive four-choice
 * answerer on the `approval/request` waterfall, dispatched directly through
 * Cordis (the approval service's policy/session plumbing is covered by
 * `@deepseek-ai/dsh-user-approval` itself). Covers the menu choices and
 * digit shortcuts, the session-scoped allowance, the feedback steering,
 * Escape/abort semantics, the FIFO serialization of concurrent requests,
 * and delegation for agents the UI does not own.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as approvalPlugin from '../src/approval-plugin.ts'
import { setYolo } from '../src/mode-state.ts'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeScreen } from './fakes.ts'

async function mount(options: { attach?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  components: FakeBlueComponents
  agent: Agent
  steer: ReturnType<typeof vi.fn>
}> {
  const { ctx, screen, components } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('approval-spec'))
  const steer = vi.fn()
  const agent = { id: session.id, session, steer } as unknown as Agent
  ctx.provide('blueSession', { current: options.attach === false ? null : agent, modelRef: undefined })
  await ctx.plugin(approvalPlugin)
  return { ctx, screen, components, agent, steer }
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
    const bar = '%' + '─'.repeat(60) + '%'
    // The S12 pull-up panel: amber rules, indented ▶ title, reason,
    // numbered choices indented under the title.
    expect(rendered[0]).toBe(bar)
    expect(rendered[1]).toBe('%  ▶ Approve bash?%')
    expect(rendered[2]).toBe('~writes files~')
    expect(rendered[3]).toBe('')
    expect(rendered[4]).toBe('*  ▶ 1. Allow once*')
    expect(rendered[5]).toBe('#    2. Allow bash for this session#')
    expect(rendered[6]).toBe('#    3. Reject#')
    expect(rendered[7]).toBe('#    4. Reject with feedback#')
    expect(rendered[8]).toBe('')
    expect(rendered[9]).toBe('_  ↑/↓ select · 1-4 choose · ↵ confirm_')
    expect(rendered[10]).toBe(bar)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('allowed-once')
    expect(pending.fallback).not.toHaveBeenCalled()
    expect(screen.overlays[0]?.hidden).toBe(true)
    // A second confirmation after settling is a no-op.
    overlay(screen).handleInput(KEY.enter)
  })

  it('omits the reason row when the asker gave none', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    expect(rendered[0]).toBe('%' + '─'.repeat(60) + '%')
    expect(rendered[1]).toBe('%  ▶ Approve bash?%')
    expect(rendered[2]).toBe('')
    expect(rendered[3]).toContain('Allow once')
    overlay(screen).handleInput(KEY.escape)
    await pending
  })

  it('moves the highlight with Up/Down, wrapping at both ends', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    // No reason row: the four choices are rows 3-6 under the title.
    overlay(screen).handleInput(KEY.up)
    expect(screen.overlays[0]?.component.render(60)[6]).toBe('*  ▶ 4. Reject with feedback*')
    overlay(screen).handleInput(KEY.down)
    expect(screen.overlays[0]?.component.render(60)[3]).toBe('*  ▶ 1. Allow once*')
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.down)
    expect(screen.overlays[0]?.component.render(60)[5]).toBe('*  ▶ 3. Reject*')
    overlay(screen).handleInput(KEY.up)
    expect(screen.overlays[0]?.component.render(60)[4]).toBe('*  ▶ 2. Allow bash for this session*')
    overlay(screen).handleInput(KEY.escape)
    await pending
  })

  it('rejects when the Reject choice is confirmed', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.down)
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('rejected')
  })

  it('direct-selects choices with the 1-4 digit keys', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput('3')
    await expect(pending).resolves.toBe('rejected')
    const second = decide(ctx, request(agent, { toolName: 'write' }))
    overlay(screen).handleInput('1')
    await expect(second).resolves.toBe('allowed-once')
  })

  it('ignores keys outside the menu vocabulary', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput('5')
    overlay(screen).handleInput('x')
    expect(screen.overlays[0]?.hidden).toBe(false)
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).resolves.toBe('rejected')
  })

  it('rejects on Escape', async () => {
    const { ctx, screen, agent } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).resolves.toBe('rejected')
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

  it('remembers "Allow for this session" and short-circuits later prompts for the tool', async () => {
    const { ctx, screen, agent } = await mount()
    const first = decide(ctx, request(agent))
    overlay(screen).handleInput('2')
    await expect(first).resolves.toBe('allowed-once')
    expect(screen.overlays).toHaveLength(1)
    // Same tool: no second prompt.
    await expect(decide(ctx, request(agent))).resolves.toBe('allowed-once')
    expect(screen.overlays).toHaveLength(1)
    // A different tool still prompts; allowing it for the session too reuses
    // the agent's allowance set.
    const third = decide(ctx, request(agent, { toolName: 'write' }))
    expect(screen.overlays).toHaveLength(2)
    overlay(screen).handleInput('2')
    await expect(third).resolves.toBe('allowed-once')
    await expect(decide(ctx, request(agent, { toolName: 'write' }))).resolves.toBe('allowed-once')
    expect(screen.overlays).toHaveLength(2)
  })

  it('steers the agent with the reason on "Reject with feedback"', async () => {
    const { ctx, screen, components, agent, steer } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput('4')
    const rendered = screen.overlays[0]?.component.render(60) ?? []
    // Feedback mode: the framed dialog keeps the title bar and swaps the
    // menu for the reason label and the inline editor.
    expect(rendered[0]).toBe('%' + '─'.repeat(60) + '%')
    expect(rendered[1]).toBe('%  ▶ Approve bash?%')
    expect(rendered[2]).toBe('')
    expect(rendered[3]).toBe('~reason:~')
    const editor = components.editors.at(-1)
    expect(editor).toBeDefined()
    for (const char of 'too risky') overlay(screen).handleInput(char)
    expect(editor?.getText()).toBe('too risky')
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('rejected')
    expect(steer).toHaveBeenCalledOnce()
    const message = steer.mock.calls[0]?.[0] as {
      role: string
      content: Array<{ type: string, text: string }>
      source: { kind: string }
    }
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: 'User rejected bash: too risky' }])
    expect(message.source).toEqual({ kind: 'user' })
    // A late duplicate submission neither steers nor settles again.
    editor?.onSubmit?.('again')
    expect(steer).toHaveBeenCalledOnce()
    screen.overlays[0]?.component.invalidate()
  })

  it('treats an empty feedback reason as a plain Reject without steering', async () => {
    const { ctx, screen, agent, steer } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput('4')
    overlay(screen).handleInput(KEY.enter)
    await expect(pending).resolves.toBe('rejected')
    expect(steer).not.toHaveBeenCalled()
  })

  it('rejects on Escape from the feedback editor', async () => {
    const { ctx, screen, agent, steer } = await mount()
    const pending = decide(ctx, request(agent))
    overlay(screen).handleInput('4')
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).resolves.toBe('rejected')
    expect(steer).not.toHaveBeenCalled()
  })

  it('serializes concurrent requests: the second prompt shows after the first settles', async () => {
    const { ctx, screen, agent } = await mount()
    const first = decide(ctx, request(agent))
    const second = decide(ctx, request(agent, { toolName: 'write' }))
    expect(screen.overlays).toHaveLength(1)
    overlay(screen).handleInput(KEY.enter)
    await expect(first).resolves.toBe('allowed-once')
    await vi.waitFor(() => {
      expect(screen.overlays).toHaveLength(2)
    })
    expect(screen.overlays[0]?.hidden).toBe(true)
    overlay(screen).handleInput(KEY.escape)
    await expect(second).resolves.toBe('rejected')
  })

  it('skips a queued request whose signal aborted while waiting', async () => {
    const { ctx, screen, agent } = await mount()
    const first = decide(ctx, request(agent))
    const controller = new AbortController()
    const second = decide(ctx, request(agent, { toolName: 'write', signal: controller.signal }))
    expect(screen.overlays).toHaveLength(1)
    controller.abort()
    overlay(screen).handleInput(KEY.enter)
    await expect(first).resolves.toBe('allowed-once')
    await expect(second).resolves.toBe('cancelled')
    expect(screen.overlays).toHaveLength(1)
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

  it('yolo auto-allows without an overlay for the attached agent', async () => {
    const { ctx, screen, agent } = await mount()
    setYolo(agent, true)
    await expect(decide(ctx, request(agent))).resolves.toBe('allowed-once')
    expect(screen.overlays).toHaveLength(0)
    // Turning yolo off restores the interactive prompt.
    setYolo(agent, false)
    const pending = decide(ctx, request(agent))
    expect(screen.overlays).toHaveLength(1)
    overlay(screen).handleInput(KEY.escape)
    await expect(pending).resolves.toBe('rejected')
  })

  it('yolo cancels a pre-aborted request rather than allowing it', async () => {
    const { ctx, screen, agent } = await mount()
    setYolo(agent, true)
    const controller = new AbortController()
    controller.abort()
    await expect(decide(ctx, request(agent, { signal: controller.signal }))).resolves.toBe('cancelled')
    expect(screen.overlays).toHaveLength(0)
  })

  it('yolo delegates for an agent the UI does not own', async () => {
    const { ctx, screen, agent } = await mount()
    setYolo(agent, true)
    const other = { id: 'other' } as unknown as Agent
    const pending = decide(ctx, request(other))
    await expect(pending).resolves.toBe('unavailable')
    expect(pending.fallback).toHaveBeenCalledOnce()
    expect(screen.overlays).toHaveLength(0)
  })
})
