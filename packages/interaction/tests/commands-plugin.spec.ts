/**
 * Tests for the `blue-commands` plugin over the real command runtime:
 * `/quit` exit requests, `/resume` event emission, and disposal.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as commandsPlugin from '../src/commands-plugin.ts'
import type {} from '@deepseek-ai/dsh-blue-app'

async function mount(options: { appExit?: (code: number) => void } = {}): Promise<{
  ctx: Context
  agent: Agent
  fiber: { dispose(): Promise<void> }
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  if (options.appExit !== undefined) ctx.provide('appExit', options.appExit)
  const session = ctx.sessions.create(SessionId('commands-spec'))
  const agent = { id: session.id, session } as unknown as Agent
  const fiber = await ctx.plugin(commandsPlugin)
  return { ctx, agent, fiber }
}

const signal = (): AbortSignal => new AbortController().signal

describe('blue-commands plugin', () => {
  it('/quit requests exit through the launcher appExit hook', async () => {
    const exit = vi.fn()
    const { ctx, agent } = await mount({ appExit: exit })
    const execution = await ctx.commands.execute(agent, '/quit', signal())
    expect(exit).toHaveBeenCalledWith(0)
    expect(execution?.result).toEqual({ kind: 'success' })
  })

  it('/quit reports an error when the launcher provided no appExit', async () => {
    const { ctx, agent } = await mount()
    const execution = await ctx.commands.execute(agent, '/quit', signal())
    const result = execution?.result
    expect(result?.kind).toBe('error')
    if (result?.kind === 'error') expect(result.text).toContain('appExit')
  })

  it('/resume emits blue/request-resume with the trimmed session id', async () => {
    const { ctx, agent } = await mount()
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    const execution = await ctx.commands.execute(agent, '/resume  abc-123 ', signal())
    expect(onResume).toHaveBeenCalledWith('abc-123')
    expect(execution?.result).toEqual({ kind: 'success', text: 'resuming session abc-123' })
  })

  it('/resume without an id returns a usage error', async () => {
    const { ctx, agent } = await mount()
    const onResume = vi.fn()
    ctx.on('blue/request-resume', onResume)
    const execution = await ctx.commands.execute(agent, '/resume', signal())
    expect(onResume).not.toHaveBeenCalled()
    expect(execution?.result).toEqual({ kind: 'error', text: 'usage: /resume <session-id>' })
  })

  it('unregisters both commands when the fiber disposes', async () => {
    const { ctx, agent, fiber } = await mount({ appExit: () => {} })
    expect(ctx.commands.find(agent, 'quit')).toBeDefined()
    expect(ctx.commands.find(agent, 'resume')).toBeDefined()
    await fiber.dispose()
    expect(ctx.commands.find(agent, 'quit')).toBeUndefined()
    expect(ctx.commands.find(agent, 'resume')).toBeUndefined()
  })
})
