/**
 * Tests for the `blue-input` plugin over the real session store and command
 * runtime with the fake component factory: slash-command dispatch,
 * follow-up submission, slash hints, the shared editor reference, and
 * mount/dispose behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponent } from '@deepseek-ai/dsh-blue-core'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import { getSharedEditor } from '../src/editor-instance.ts'
import { fakeBlueContext, KEY, type FakeBlueEditor, type FakeScreen } from './fakes.ts'

async function mount(options: { withAgent?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  editor: FakeBlueEditor
  hint: BlueComponent
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
  const editor = screen.children[0] as FakeBlueEditor
  const hint = screen.children[1] as BlueComponent
  return { ctx, screen, editor, hint, agent, followup, fiber }
}

function type(editor: FakeBlueEditor, text: string): void {
  for (const char of text) editor.handleInput(char)
}

describe('blue-input plugin', () => {
  it('mounts the editor and hint line focused at the bottom of the tree', async () => {
    const { screen, editor, hint } = await mount()
    expect(screen.children).toEqual([editor, hint])
    expect(screen.focused).toBe(editor)
    expect(editor.focused).toBe(true)
    expect(hint.render(80)).toEqual([])
    hint.invalidate()
  })

  it('stays pinned below transcript content mounted after it', async () => {
    const { screen, editor, hint } = await mount()
    // Transcript components only mount once a session exists — long after
    // the editor — yet must render above it.
    const transcriptRow: Parameters<FakeScreen['addChild']>[0] = { render: () => ['transcript'], invalidate: () => {} }
    screen.addChild(transcriptRow)
    expect(screen.children).toEqual([transcriptRow, editor, hint])
  })

  it('publishes the editor and submit router through the shared reference', async () => {
    const { editor } = await mount()
    const shared = getSharedEditor()
    expect(shared?.editor).toBe(editor)
    expect(shared?.submitPrompt).toBeTypeOf('function')
  })

  it('submits plain text as a user follow-up message, records history, and clears the buffer', async () => {
    const { editor, followup } = await mount()
    type(editor, 'hello there')
    editor.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]?.[0] as {
      role: string
      content: Array<{ type: string; text: string }>
      source: { kind: string }
    }
    expect(message.role).toBe('user')
    expect(message.content).toEqual([{ type: 'text', text: 'hello there' }])
    expect(message.source).toEqual({ kind: 'user' })
    expect(editor.getText()).toBe('')
    expect(editor.history).toEqual(['hello there'])
  })

  it('ignores whitespace-only submissions', async () => {
    const { editor, followup } = await mount()
    type(editor, '   ')
    editor.handleInput(KEY.enter)
    expect(followup).not.toHaveBeenCalled()
    expect(editor.history).toEqual([])
  })

  it('notices instead of submitting without an attached session', async () => {
    const { screen, editor, hint } = await mount({ withAgent: false })
    type(editor, 'hello')
    editor.handleInput(KEY.enter)
    expect(hint.render(80)).toEqual(['~no active session~'])
    expect(screen.renderRequests).toBeGreaterThan(0)
  })

  it('dispatches slash commands through the real registry and logs lifecycle events', async () => {
    const { ctx, editor, hint, agent, followup } = await mount()
    ctx.commands.register({
      name: 'poke',
      description: 'Poke the test',
      handler: () => ({ kind: 'success', text: 'poked' }),
    })
    type(editor, '/poke now')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~poked~'])
    })
    expect(followup).not.toHaveBeenCalled()
    const events = agent.session.events.filter(event => event.type === 'command/run' || event.type === 'command/done')
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(ctx.commands.find(agent, 'poke')).toBeDefined()
    expect(editor.history).toEqual(['/poke now'])
  })

  it('notices unknown commands', async () => {
    const { editor, hint } = await mount()
    type(editor, '/missing')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~unknown command: /missing~'])
    })
  })

  it('notices command error results and handler rejections', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({
      name: 'fail',
      description: 'Fail by result',
      handler: () => ({ kind: 'error', text: 'broken' }),
    })
    type(editor, '/fail')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~!broken!~'])
    })
    ctx.commands.register({
      name: 'throw',
      description: 'Fail by throwing',
      handler: () => {
        throw new Error('boom')
      },
    })
    type(editor, '/throw')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~!boom!~'])
    })
  })

  it('shows matching command hints for slash-prefixed input and replaces them on edit', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    type(editor, '/res')
    expect(hint.render(80)).toEqual(['~/restart — Restart everything  /resume — Resume a previous session~'])
    type(editor, 'x')
    expect(hint.render(80)).toEqual(['~no matching command: /resx~'])
    editor.setText('/res')
    expect(hint.render(80)[0]).toContain('/resume')
  })

  it('lists every command on a bare slash prefix', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({ name: 'alpha', description: 'First command', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'beta', description: 'Second command', handler: () => ({ kind: 'success' }) })
    type(editor, '/')
    const rendered = hint.render(80)[0]
    expect(rendered).toContain('/alpha — First command')
    expect(rendered).toContain('/beta — Second command')
    // Typing a letter narrows the discovery list again.
    type(editor, 'b')
    expect(hint.render(80)).toEqual(['~/beta — Second command~'])
  })

  it('shows no hint without an attached session', async () => {
    const { editor, hint } = await mount({ withAgent: false })
    type(editor, '/res')
    expect(hint.render(80)).toEqual([])
  })

  it('shows no hint when the slash line is not a command', async () => {
    const { editor, hint } = await mount()
    type(editor, '/1')
    expect(hint.render(80)).toEqual([])
  })

  it('truncates an over-wide hint to the viewport width', async () => {
    const { editor, hint } = await mount({ withAgent: false })
    type(editor, 'hello')
    editor.handleInput(KEY.enter)
    expect(hint.render(10)).toEqual(['~no acti...~'])
  })

  it('keeps the hint clear when a command succeeds without text', async () => {
    const { ctx, editor, hint, agent } = await mount()
    ctx.commands.register({
      name: 'quiet',
      description: 'Succeed silently',
      handler: () => ({ kind: 'success' }),
    })
    type(editor, '/quiet')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(agent.session.events.some(event => event.type === 'command/done')).toBe(true)
    })
    expect(hint.render(80)).toEqual([])
  })

  it('unmounts the editor, clears the shared reference, and releases focus on dispose', async () => {
    const { screen, fiber } = await mount()
    expect(screen.children).toHaveLength(2)
    expect(getSharedEditor()).toBeDefined()
    await fiber.dispose()
    expect(screen.children).toHaveLength(0)
    expect(screen.focused).toBeNull()
    expect(getSharedEditor()).toBeUndefined()
  })
})
