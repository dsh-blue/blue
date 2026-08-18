/**
 * Tests for the `blue-input` plugin over the real session store and command
 * runtime with the fake component factory: slash-command dispatch,
 * follow-up submission, slash hints, the shared editor reference, and
 * mount/dispose behavior.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponent } from '@deepseek-ai/dsh-blue-core'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime, { type CommandResult } from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import { getSharedEditor } from '../src/editor-instance.ts'
import { clearDraft } from '../src/draft-stash.ts'
import { fakeBlueContext, KEY, type FakeBlueEditor, type FakeScreen } from './fakes.ts'

// The draft stash is module state: a test that leaves unsubmitted text
// would see it restored into the next test's freshly mounted editor.
afterEach(() => {
  clearDraft()
})

async function mount(options: { withAgent?: boolean, running?: boolean, appExit?: (code: number) => void } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  editor: FakeBlueEditor
  hint: BlueComponent
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  steer: ReturnType<typeof vi.fn>
  fiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('input-spec'))
  const followup = vi.fn()
  const cancel = vi.fn()
  const steer = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: options.running === true ? 'running' : 'idle',
    followup,
    cancel,
    steer,
  } as unknown as Agent
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent })
  if (options.appExit !== undefined) ctx.provide('appExit', options.appExit)
  const fiber = await ctx.plugin(inputPlugin)
  const editor = screen.children[0] as FakeBlueEditor
  const hint = screen.children[1] as BlueComponent
  return { ctx, screen, editor, hint, agent, followup, cancel, steer, fiber }
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

  it('drops the result notice when the fiber unloads before the command settles', async () => {
    const { ctx, screen, editor, hint, agent, fiber } = await mount()
    // A handler gate the test settles by hand, so the unload can land while
    // execute() is still in flight — the /theme crash shape.
    const gate = Promise.withResolvers<CommandResult>()
    ctx.commands.register({
      name: 'slow',
      description: 'Settle late',
      handler: () => gate.promise,
    })
    type(editor, '/slow')
    editor.handleInput(KEY.enter)
    await fiber.dispose()
    const renderRequests = screen.renderRequests
    gate.resolve({ kind: 'success', text: 'late' })
    await vi.waitFor(() => {
      expect(agent.session.events.some(event => event.type === 'command/done')).toBe(true)
    })
    // The continuation saw the unloaded fiber: no notice, no re-render, and
    // no throw through the dead context.
    expect(hint.render(80)).toEqual([])
    expect(screen.renderRequests).toBe(renderRequests)
  })

  it('drops the error notice when the fiber unloads before the command rejects', async () => {
    const { ctx, screen, editor, hint, agent, fiber } = await mount()
    const gate = Promise.withResolvers<CommandResult>()
    ctx.commands.register({
      name: 'late-fail',
      description: 'Reject late',
      handler: () => gate.promise,
    })
    type(editor, '/late-fail')
    editor.handleInput(KEY.enter)
    await fiber.dispose()
    const renderRequests = screen.renderRequests
    gate.reject(new Error('late boom'))
    await vi.waitFor(() => {
      expect(agent.session.events.some(event => event.type === 'command/done')).toBe(true)
    })
    expect(hint.render(80)).toEqual([])
    expect(screen.renderRequests).toBe(renderRequests)
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

  describe('editor-context keys', () => {
    it('clears the buffer on Escape when text is present', async () => {
      const { editor, cancel } = await mount({ running: true })
      type(editor, 'draft')
      editor.handleInput(KEY.escape)
      expect(editor.getText()).toBe('')
      expect(cancel).not.toHaveBeenCalled()
    })

    it('interrupts a running agent on Escape with an empty buffer', async () => {
      const { editor, cancel } = await mount({ running: true })
      expect(editor.onKey?.(KEY.escape)).toBe(true)
      expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    })

    it('passes Escape through with an empty buffer and an idle agent', async () => {
      const { editor, cancel } = await mount()
      expect(editor.onKey?.(KEY.escape)).toBe(false)
      expect(cancel).not.toHaveBeenCalled()
    })

    it('passes Escape through with an empty buffer and no session', async () => {
      const { editor } = await mount({ withAgent: false })
      expect(editor.onKey?.(KEY.escape)).toBe(false)
    })

    it('lets the editor close an open autocomplete dropdown on Escape', async () => {
      const { editor, cancel } = await mount({ running: true })
      editor.showingAutocomplete = true
      type(editor, 'draft')
      expect(editor.onKey?.(KEY.escape)).toBe(false)
      expect(editor.getText()).toBe('draft')
      expect(cancel).not.toHaveBeenCalled()
    })

    it('clears the buffer on Ctrl-C when text is present', async () => {
      const { editor, cancel } = await mount({ running: true })
      type(editor, 'draft')
      editor.handleInput(KEY.ctrlC)
      expect(editor.getText()).toBe('')
      expect(cancel).not.toHaveBeenCalled()
    })

    it('interrupts a running agent on Ctrl-C with an empty buffer', async () => {
      const { editor, cancel } = await mount({ running: true })
      expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
      expect(cancel).toHaveBeenCalledWith({ kind: 'user' })
    })

    it('flashes the exit hint on the first idle Ctrl-C', async () => {
      const { editor, hint } = await mount()
      vi.useFakeTimers()
      try {
        vi.setSystemTime(1_000_000)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        expect(hint.render(80)).toEqual(['~press ctrl+c again to exit~'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('exits through the launcher hook on a second idle Ctrl-C within the window', async () => {
      const exit = vi.fn()
      const { editor, cancel } = await mount({ appExit: exit })
      vi.useFakeTimers()
      try {
        vi.setSystemTime(2_000_000)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        expect(exit).not.toHaveBeenCalled()
        vi.setSystemTime(2_000_500)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        expect(exit).toHaveBeenCalledWith(0)
        expect(cancel).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('re-arms the hint when the double-press window expires', async () => {
      const exit = vi.fn()
      const { editor, hint } = await mount({ appExit: exit })
      vi.useFakeTimers()
      try {
        vi.setSystemTime(3_000_000)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        vi.setSystemTime(3_002_000)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        expect(exit).not.toHaveBeenCalled()
        expect(hint.render(80)).toEqual(['~press ctrl+c again to exit~'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('consumes the double press when the launcher provided no appExit hook', async () => {
      const { editor } = await mount()
      vi.useFakeTimers()
      try {
        vi.setSystemTime(4_000_000)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
        vi.setSystemTime(4_000_500)
        expect(editor.onKey?.(KEY.ctrlC)).toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('steers the current turn with the draft on Ctrl-S and clears the buffer', async () => {
      const { editor, steer } = await mount()
      type(editor, 'steer this')
      editor.handleInput(KEY.ctrlS)
      expect(steer).toHaveBeenCalledOnce()
      const message = steer.mock.calls[0]?.[0] as {
        role: string
        content: Array<{ type: string, text: string }>
        source: { kind: string }
      }
      expect(message.role).toBe('user')
      expect(message.content).toEqual([{ type: 'text', text: 'steer this' }])
      expect(message.source).toEqual({ kind: 'user' })
      expect(editor.getText()).toBe('')
    })

    it('passes Ctrl-S through with an empty buffer', async () => {
      const { editor, steer } = await mount()
      expect(editor.onKey?.(KEY.ctrlS)).toBe(false)
      expect(steer).not.toHaveBeenCalled()
    })

    it('passes Ctrl-S through without a session', async () => {
      const { editor } = await mount({ withAgent: false })
      type(editor, 'draft')
      expect(editor.onKey?.(KEY.ctrlS)).toBe(false)
      expect(editor.getText()).toBe('draft')
    })
  })
})
