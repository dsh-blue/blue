/**
 * Tests for the `/init` command: the canned prompt rides a user follow-up
 * on the UI's current agent, a running agent refuses the invocation, and
 * no attached session reports its error. The command registers through
 * `registerInitCommand` on the real command runtime; the agent is the
 * spec's fake with a recording `followup`.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { registerInitCommand } from '../src/session-init.ts'
import type {} from '@dsh-blue/blue-app'

async function mount(options: {
  status?: 'idle' | 'running'
  attach?: boolean
} = {}): Promise<{
  ctx: Context
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  dispose: () => void
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('init-spec'))
  const followup = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: options.status ?? 'idle',
    followup,
  } as unknown as Agent
  ctx.provide('blueCurrentAgent', {
    current: () => options.attach === false ? null : agent,
    revision: () => 0,
    subscribe: () => () => {},
  } as never)
  const dispose = registerInitCommand(ctx)
  return { ctx, agent, followup, dispose }
}

describe('/init command', () => {
  it('sends the canned AGENTS.md prompt as a user follow-up when idle', async () => {
    const { ctx, agent, followup } = await mount()
    const execution = await ctx.commands.execute(agent, '/init', [], new AbortController().signal)
    expect(execution?.result).toEqual({
      kind: 'success',
      text: 'analyzing the codebase to write AGENTS.md',
    })
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0] as UserMessage
    expect(message.role).toBe('user')
    expect(message.source).toEqual({ kind: 'user' })
    const text = JSON.stringify(message.content)
    // The kimi prompt's load-bearing lines: the exploration brief, the
    // target file, and the replace-not-append rule.
    expect(text).toContain('explore the current project directory')
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('one coherent, up-to-date file')
  })

  it('refuses the invocation while the agent is running', async () => {
    const { ctx, agent, followup } = await mount({ status: 'running' })
    const execution = await ctx.commands.execute(agent, '/init', [], new AbortController().signal)
    expect(execution?.result).toEqual({
      kind: 'error',
      text: 'cannot run /init while the agent is running',
    })
    expect(followup).not.toHaveBeenCalled()
  })

  it('reports an error when no session is attached', async () => {
    const { ctx, agent, followup } = await mount({ attach: false })
    const execution = await ctx.commands.execute(agent, '/init', [], new AbortController().signal)
    expect(execution?.result).toEqual({ kind: 'error', text: 'no active session' })
    expect(followup).not.toHaveBeenCalled()
  })

  it('surfaces a rejected structured follow-up action', async () => {
    const { ctx, agent, followup } = await mount()
    followup.mockImplementationOnce(() => { throw new Error('submission rejected') })
    await expect(ctx.commands.execute(agent, '/init', [], new AbortController().signal))
      .rejects.toThrow('submission rejected')
    expect(followup).toHaveBeenCalledOnce()
  })

  it('unregisters with its disposer', async () => {
    const { ctx, agent, dispose } = await mount()
    dispose()
    const execution = await ctx.commands.execute(agent, '/init', [], new AbortController().signal)
    expect(execution).toBeUndefined()
  })
})
