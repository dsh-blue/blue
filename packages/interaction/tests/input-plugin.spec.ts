/**
 * Tests for the `blue-input` plugin over the real session store and command
 * runtime: slash-command dispatch, follow-up submission, slash hints, and
 * mount/dispose behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import type { BlueInput } from '../src/editor.ts'
import { fakeBlueContext, KEY, type FakeScreen } from './fakes.ts'

async function mount(options: { withAgent?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  input: BlueInput
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('input-spec'))
  const followup = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    followup,
  } as unknown as Agent
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent })
  const fiber = await ctx.plugin(inputPlugin)
  const input = screen.children[0] as BlueInput
  return { ctx, screen, input, agent, followup, fiber }
}

function type(input: BlueInput, text: string): void {
  for (const char of text) input.handleInput(char)
}

describe('blue-input plugin', () => {
  it('mounts the editor focused at the root of the tree', async () => {
    const { screen, input } = await mount()
    expect(screen.children).toEqual([input])
    expect(screen.focused).toBe(input)
    expect(input.focused).toBe(true)
  })

  it('stays pinned below transcript content mounted after it', async () => {
    const { screen, input } = await mount()
    // Transcript components only mount once a session exists — long after
    // the editor — yet must render above it.
    const transcriptRow: Parameters<FakeScreen['addChild']>[0] = { render: () => ['transcript'], invalidate: () => {} }
    screen.addChild(transcriptRow)
    expect(screen.children).toEqual([transcriptRow, input])
  })

  it('submits plain text as a user follow-up message and clears the buffer', async () => {
    const { input, followup } = await mount()
    type(input, 'hello there')
    input.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]?.[0] as {
      role: string
      content: Array<{ type: string; text: string }>
      source: { kind: string }
    }
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: 'hello there' }])
    expect(message.source).toEqual({ kind: 'user' })
    expect(input.getValue()).toBe('')
  })

  it('ignores whitespace-only submissions', async () => {
    const { input, followup } = await mount()
    type(input, '   ')
    input.handleInput(KEY.enter)
    expect(followup).not.toHaveBeenCalled()
  })

  it('notices instead of submitting without an attached session', async () => {
    const { screen, input } = await mount({ withAgent: false })
    type(input, 'hello')
    input.handleInput(KEY.enter)
    expect(input.render(80).at(-1)).toBe('~no active session~')
    expect(screen.renderRequests).toBeGreaterThan(0)
  })

  it('dispatches slash commands through the real registry and logs lifecycle events', async () => {
    const { ctx, input, agent, followup } = await mount()
    ctx.commands.register({
      name: 'poke',
      description: 'Poke the test',
      handler: () => ({ kind: 'success', text: 'poked' }),
    })
    type(input, '/poke now')
    input.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(input.render(80).at(-1)).toBe('~poked~')
    })
    expect(followup).not.toHaveBeenCalled()
    const events = agent.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done')
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(ctx.commands.find(agent, 'poke')).toBeDefined()
  })

  it('notices unknown commands', async () => {
    const { input } = await mount()
    type(input, '/missing')
    input.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(input.render(80).at(-1)).toBe('~unknown command: /missing~')
    })
  })

  it('notices command error results and handler rejections', async () => {
    const { ctx, input } = await mount()
    ctx.commands.register({
      name: 'fail',
      description: 'Fail by result',
      handler: () => ({ kind: 'error', text: 'broken' }),
    })
    type(input, '/fail')
    input.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(input.render(80).at(-1)).toBe('~!broken!~')
    })
    ctx.commands.register({
      name: 'throw',
      description: 'Fail by throwing',
      handler: () => {
        throw new Error('boom')
      },
    })
    type(input, '/throw')
    input.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(input.render(80).at(-1)).toBe('~!boom!~')
    })
  })

  it('shows matching command hints for slash-prefixed input and replaces them on edit', async () => {
    const { ctx, input } = await mount()
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    type(input, '/res')
    expect(input.render(80).at(-1)).toBe('~/restart — Restart everything  /resume — Resume a previous session~')
    type(input, 'x')
    expect(input.render(80).at(-1)).toBe('~no matching command: /resx~')
    input.handleInput(KEY.backspace)
    expect(input.render(80).at(-1)).toContain('/resume')
  })

  it('lists every command on a bare slash prefix', async () => {
    const { ctx, input } = await mount()
    ctx.commands.register({ name: 'alpha', description: 'First command', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'beta', description: 'Second command', handler: () => ({ kind: 'success' }) })
    type(input, '/')
    const hint = input.render(80).at(-1)
    expect(hint).toContain('/alpha — First command')
    expect(hint).toContain('/beta — Second command')
    // Typing a letter narrows the discovery list again.
    type(input, 'b')
    expect(input.render(80).at(-1)).toBe('~/beta — Second command~')
  })

  it('shows no hint without an attached session', async () => {
    const { input } = await mount({ withAgent: false })
    type(input, '/res')
    expect(input.render(80)).toHaveLength(1)
  })

  it('shows no hint when the slash line is not a command', async () => {
    const { input } = await mount()
    type(input, '/1')
    expect(input.render(80)).toHaveLength(1)
  })

  it('keeps the hint clear when a command succeeds without text', async () => {
    const { ctx, input, agent } = await mount()
    ctx.commands.register({
      name: 'quiet',
      description: 'Succeed silently',
      handler: () => ({ kind: 'success' }),
    })
    type(input, '/quiet')
    input.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(agent.session.events.some(event => event.type === 'command/done')).toBe(true)
    })
    // No notice row: only the prompt line renders.
    expect(input.render(80)).toHaveLength(1)
  })

  it('unmounts the editor and releases focus when the fiber disposes', async () => {
    const { screen, fiber } = await mount()
    expect(screen.children).toHaveLength(1)
    await fiber.dispose()
    expect(screen.children).toHaveLength(0)
    expect(screen.focused).toBeNull()
  })
})
