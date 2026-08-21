/**
 * Tests for the `blue-input` plugin over the real session store and command
 * runtime with the fake component factory: slash-command dispatch,
 * follow-up submission, slash hints, the shared editor reference, and
 * mount/dispose behavior.
 */

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueComponent, BlueFocusable } from '@dsh-blue/blue-core'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime, { type CommandResult } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import * as inputPlugin from '../src/input-plugin.ts'
import { registerCommandAliases } from '../src/command-meta.ts'
import { __setCatalogForTest } from '../src/skills-catalog.ts'
import * as paneQueuePlugin from '../src/pane-queue.ts'
import { getSharedEditor, mountEditorReplacement } from '../src/editor-instance.ts'
import { clearDraft, getStashedDraft, stashHistory } from '../src/draft-stash.ts'
import { setExternalEditorLauncher } from '../src/external-editor.ts'
import { fakeBlueContext, KEY, type FakeBlueComponents, type FakeBlueEditor, type FakeScreen } from './fakes.ts'

// The draft stash is module state: a test that leaves unsubmitted text
// or submitted history would see it restored into the next test's
// freshly mounted editor.
afterEach(() => {
  clearDraft()
  stashHistory([])
  __setCatalogForTest(undefined)
})

/** One settled-skill double for the catalog seam. */
function skillOf(name: string): SkillSummary {
  return {
    name,
    description: `The ${name} skill`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: 'spec',
  }
}

/** In-memory inbox double with a stubbed, recordable removal. */
function fakeInbox(options: {
  nextTurn?: UserMessage[]
  nextStep?: UserMessage[]
  remove?: (id: string) => boolean
} = {}) {
  const nextTurn = options.nextTurn ?? []
  const nextStep = options.nextStep ?? []
  return {
    nextTurn,
    nextStep,
    remove: vi.fn(options.remove ?? (() => true)),
    get hasPending(): boolean {
      return nextTurn.length > 0 || nextStep.length > 0
    },
  }
}

function queued(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

async function mount(options: {
  withAgent?: boolean
  running?: boolean
  appExit?: (code: number) => void
  inbox?: ReturnType<typeof fakeInbox>
  modelRef?: unknown
} = {}): Promise<{
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
    inbox: options.inbox ?? fakeInbox(),
  } as unknown as Agent
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent, modelRef: options.modelRef ?? undefined })
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
    const { ctx, screen, editor, hint } = await mount()
    expect(screen.children).toEqual([editor, hint])
    expect(screen.focused).toBe(editor)
    expect(editor.focused).toBe(true)
    // The editor mounts with the rounded-box chrome's prerequisites — the
    // prompt symbol and the padding that reserves its columns — and the hint
    // row renders nothing at rest (the persistent tier retired with S15).
    expect(editor.promptSymbol).toBe('>')
    expect((ctx.blueComponents as FakeBlueComponents).editorOptions[0]).toEqual({ paddingX: 4 })
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

  it('rewrites #skill tokens on the follow-up path while history keeps the original', async () => {
    const { editor, followup } = await mount()
    __setCatalogForTest([skillOf('deploy-check')])
    type(editor, 'run #deploy-check now')
    editor.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
    const message = followup.mock.calls[0]?.[0] as {
      content: Array<{ type: string; text: string }>
    }
    // The gesture form reaches the model; the history entry keeps the
    // `#name` the user typed (Up-recall edits what was typed).
    expect(message.content).toEqual([{ type: 'text', text: 'run /deploy-check now' }])
    expect(editor.history).toEqual(['run #deploy-check now'])
  })

  it('passes unknown #tags through untouched on the follow-up path', async () => {
    const { editor, followup } = await mount()
    __setCatalogForTest([skillOf('deploy-check')])
    // The unknown tag stays; the trailing period breaks the recognized
    // token's end boundary, so it stays too.
    type(editor, 'see #unknown-tag and #deploy-check.')
    editor.handleInput(KEY.enter)
    const message = followup.mock.calls[0]?.[0] as { content: Array<{ type: string; text: string }> }
    expect(message.content).toEqual([{ type: 'text', text: 'see #unknown-tag and #deploy-check.' }])
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

  it('rewrites an alias line to its canonical command before dispatch', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({
      name: 'quit',
      description: 'Exit Blue',
      handler: (invocation) => ({ kind: 'success', text: `bye${invocation.rawInput}` }),
    })
    const clear = registerCommandAliases('quit', ['q', 'exit'])
    try {
      // `/q now` reaches the `/quit` handler with its raw input intact — the
      // kimi resolution: the alias is not a registered command, the rewrite
      // happens before `ctx.commands.execute`.
      type(editor, '/q now')
      editor.handleInput(KEY.enter)
      await vi.waitFor(() => {
        expect(hint.render(80)).toEqual(['~bye now~'])
      })
    } finally {
      clear()
    }
  })

  it('notices unknown commands', async () => {
    const { editor, hint } = await mount()
    type(editor, '/missing')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~unknown command: /missing~'])
    })
  })

  it('renders no command catalog for slash input — the dropdown owns discovery (D42)', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({
      name: 'poke',
      description: 'Poke the agent',
      handler: () => ({ kind: 'success' as const, text: 'poked' }),
    })
    // A match (bare slash or a prefix) renders nothing whether the dropdown
    // is up or closed — the S34 dogfood verdict retired the discovery tier
    // that double-rendered the catalog next to it; only the empty-result
    // notice below survives from the S14 tier.
    type(editor, '/')
    expect(hint.render(80)).toEqual([])
    editor.showingAutocomplete = true
    expect(hint.render(80)).toEqual([])
    editor.showingAutocomplete = false
    type(editor, 'po')
    expect(hint.render(80)).toEqual([])
    hint.invalidate()
  })

  it('opens the permission picker on a bare /permission instead of dispatching', async () => {
    const { ctx, screen, editor, hint } = await mount()
    const handler = vi.fn(() => ({ kind: 'success' as const, text: 'should not run' }))
    ctx.commands.register({ name: 'permission', description: 'spy standing in for the upstream command', handler })
    ctx.provide('permissionPresets', {
      names: ['read-only', 'workspace-write'],
      current: () => 'workspace-write',
      resolve: name => ({ sandbox: `${name}-sandbox`, approval: 'ask' }),
      optionOf: name => ({ value: name, name }),
    })
    type(editor, '/permission')
    editor.handleInput(KEY.enter)
    // The picker replaces the editor in its dock slot (the real D30
    // machinery the plugin installs); the upstream command never runs and
    // no notice lands (the panel owns the interaction).
    await vi.waitFor(() => { expect(screen.children).toHaveLength(1) })
    const panel = screen.children[0] as BlueFocusable
    const frame = (panel as { render(width: number): string[] }).render(80).join('\n')
    expect(frame).toContain('Permissions')
    expect(frame).toContain('← current')
    expect(handler).not.toHaveBeenCalled()
    expect(hint.render(80)).toEqual([])
    // Esc closes back to the editor, still without a dispatch.
    panel.handleInput(KEY.escape)
    expect(handler).not.toHaveBeenCalled()
    expect(screen.children).toEqual([editor, expect.anything()])
    expect(screen.focused).toBe(editor)
  })

  it('passes a with-argument /permission line through to the command', async () => {
    const { ctx, editor, hint, screen } = await mount()
    const handler = vi.fn(() => ({ kind: 'success' as const, text: 'preset read-only' }))
    ctx.commands.register({ name: 'permission', description: 'spy standing in for the upstream command', handler })
    ctx.provide('permissionPresets', {
      names: ['read-only'],
      current: () => 'read-only',
      resolve: name => ({ sandbox: name, approval: 'ask' }),
      optionOf: name => ({ value: name, name }),
    })
    type(editor, '/permission read-only')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => { expect(hint.render(80)).toEqual(['~preset read-only~']) })
    expect(handler).toHaveBeenCalledOnce()
    // No panel ever took the editor slot.
    expect(screen.children).toHaveLength(2)
  })

  it('falls through a bare /permission to unknown-command without the preset service', async () => {
    const { editor, hint } = await mount()
    type(editor, '/permission')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(hint.render(80)).toEqual(['~unknown command: /permission~'])
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
    // The continuation saw the unloaded fiber: no notice lands — the row
    // stays empty — no re-render, and no throw
    // through the dead context.
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

  it('keeps only the empty-result notice for slash-prefixed input', async () => {
    const { ctx, editor, hint } = await mount()
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    // A match renders nothing (D42: the dropdown owns discovery); the empty
    // result keeps its notice — the dropdown closes itself on an empty
    // match, so the notice is the only feedback.
    type(editor, '/res')
    expect(hint.render(80)).toEqual([])
    type(editor, 'x')
    expect(hint.render(80)).toEqual(['~no matching command: /resx~'])
    editor.setText('/res')
    expect(hint.render(80)).toEqual([])
  })

  it('renders no hint row without an attached session', async () => {
    const { editor, hint } = await mount({ withAgent: false })
    type(editor, '/res')
    // No agent means no slash feedback, and nothing else owns the row.
    expect(hint.render(80)).toEqual([])
  })

  it('renders no hint row when the slash line is not a command', async () => {
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

  it('renders no hint row when a command succeeds without text', async () => {
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

  it('renders no persistent row in any state — the footer tips teach the affordances', async () => {
    // The S15 dogfood verdict retired the persistent key-affordance tier:
    // idle, running, and with every enhancement attached, the hint row
    // stays empty unless a notice or slash feedback owns it.
    const idle = await mount()
    expect(idle.hint.render(80)).toEqual([])
    await idle.fiber.dispose()

    const running = await mount({ running: true })
    expect(running.hint.render(80)).toEqual([])
    await running.fiber.dispose()
  })

  it('highlights the frame in primary for slash input and restores the neutral border', async () => {
    const { editor } = await mount()
    type(editor, '/th')
    expect(editor.borderColor('x')).toBe('^x^')
    editor.setText('plain')
    expect(editor.borderColor('x')).toBe('x')
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

  it('restores the prompt history across the theme-swap reload', async () => {
    // `/theme <name>` rebuilds this fiber as its own effect: the editor
    // component (and pi-tui's in-component history) dies with it. The
    // stash mirrors the history at submit time and the remount replays it.
    const first = await mount()
    type(first.editor, 'hello')
    first.editor.handleInput(KEY.enter)
    type(first.editor, '/theme dark')
    first.editor.handleInput(KEY.enter)
    expect(first.editor.history).toEqual(['/theme dark', 'hello'])
    await first.fiber.dispose()
    const second = await mount()
    expect(second.editor.history).toEqual(['/theme dark', 'hello'])
  })

  describe('editor-slot swap (D30 dialog mount)', () => {
    /** A minimal focusable panel for slot tests. */
    function panel(name: string): BlueFocusable & BlueComponent {
      return {
        name,
        focused: false,
        handleInput: vi.fn(),
        invalidate: vi.fn(),
        render: () => [name],
      }
    }

    it('hides the editor for the panel and restores it with focus on dispose', async () => {
      const { screen, editor, hint } = await mount()
      const first = panel('first')
      const restore = mountEditorReplacement(first)
      // The editor and hint left the dock; the panel took the slot and
      // the focus.
      expect(screen.children).toEqual([first])
      expect(screen.focused).toBe(first)
      restore()
      expect(screen.children).toEqual([editor, hint])
      expect(screen.focused).toBe(editor)
    })

    it('stacks nested panels: disposing the top refocuses the one beneath', async () => {
      const { screen, editor } = await mount()
      const outer = panel('outer')
      const inner = panel('inner')
      const restoreOuter = mountEditorReplacement(outer)
      const restoreInner = mountEditorReplacement(inner)
      expect(screen.children).toEqual([outer, inner])
      restoreInner()
      // The outer panel stays mounted and regains focus.
      expect(screen.children).toEqual([outer])
      expect(screen.focused).toBe(outer)
      restoreOuter()
      expect(screen.children).toEqual([editor, expect.anything()])
      expect(screen.focused).toBe(editor)
    })

    it('keeps the editor hidden when the bottom panel of a stack disposes first', async () => {
      const { screen, editor } = await mount()
      const outer = panel('outer')
      const inner = panel('inner')
      const restoreOuter = mountEditorReplacement(outer)
      const restoreInner = mountEditorReplacement(inner)
      // Out-of-order: the first-mounted panel goes while the top stays.
      restoreOuter()
      expect(screen.children).toEqual([inner])
      expect(screen.focused).toBe(inner)
      restoreInner()
      expect(screen.focused).toBe(editor)
    })

    it('unmounts an open panel with the fiber and turns its disposer into a no-op', async () => {
      const { screen, fiber } = await mount()
      const open = panel('open')
      const restore = mountEditorReplacement(open)
      await fiber.dispose()
      // The teardown unmounted the panel; the late disposer must not
      // resurrect the editor against the disposed fiber's screen handle.
      expect(screen.children).toEqual([])
      expect(() => restore()).not.toThrow()
      expect(screen.children).toEqual([])
      expect(screen.focused).toBeNull()
    })

    it('keeps the editor buffer across a swap round-trip', async () => {
      const { editor } = await mount()
      type(editor, 'draft survives')
      const restore = mountEditorReplacement(panel('modal'))
      restore()
      expect(editor.getText()).toBe('draft survives')
    })

    it('emits blue/editor-slot-swapped on occupancy transitions only', async () => {
      const { ctx, fiber } = await mount()
      const swaps: boolean[] = []
      ctx.on('blue/editor-slot-swapped', occupied => swaps.push(occupied))

      const restoreOuter = mountEditorReplacement(panel('outer'))
      // A nested panel does not re-emit: the slot stayed occupied.
      const restoreInner = mountEditorReplacement(panel('inner'))
      restoreInner()
      expect(swaps).toEqual([true])
      restoreOuter()
      expect(swaps).toEqual([true, false])

      // Unloading with a panel open releases the occupancy too.
      mountEditorReplacement(panel('gone'))
      expect(swaps).toEqual([true, false, true])
      await fiber.dispose()
      expect(swaps).toEqual([true, false, true, false])
    })
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

    it('rewrites #skill tokens on the Ctrl-S steer path too', async () => {
      const { editor, steer } = await mount()
      __setCatalogForTest([skillOf('deploy-check')])
      type(editor, 'steer #deploy-check')
      editor.handleInput(KEY.ctrlS)
      expect(steer).toHaveBeenCalledOnce()
      const message = steer.mock.calls[0]?.[0] as { content: Array<{ type: string, text: string }> }
      expect(message.content).toEqual([{ type: 'text', text: 'steer /deploy-check' }])
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

  describe('external editor (Ctrl-G, S31)', () => {
    const savedVisual = process.env.VISUAL
    const savedEditor = process.env.EDITOR

    beforeEach(() => {
      process.env.VISUAL = 'blue-spec-editor'
    })

    afterEach(() => {
      process.env.VISUAL = savedVisual
      process.env.EDITOR = savedEditor
      setExternalEditorLauncher(undefined)
    })

    /** Install a recording launcher; `impl` decides each call's outcome. */
    function fakeLauncher(impl: (seed: string) => Promise<string | undefined>): string[] {
      const seeds: string[] = []
      setExternalEditorLauncher((seed, command) => {
        seeds.push(`${command}: ${seed}`)
        return impl(seed)
      })
      return seeds
    }

    /** Let the async flow settle past its final await chain. */
    async function settle(): Promise<void> {
      await new Promise<void>(resolve => {
        setImmediate(resolve)
      })
    }

    it('hands the draft over, suspends once, and writes the edit back with the mirrors synced', async () => {
      const { editor, screen } = await mount()
      const seeds = fakeLauncher(() => Promise.resolve('edited\r\n\r\n'))
      type(editor, 'draft here')
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(editor.getText()).toBe('edited\n')
      })
      // The seed is the expanded draft and the command is the resolved
      // $VISUAL; the CRLF pair collapses and one trailing newline drops.
      expect(seeds).toEqual(['blue-spec-editor: draft here'])
      expect(screen.suspends).toBe(1)
      expect(getStashedDraft()).toBe('edited\n')
    })

    it('keeps the draft untouched on a nonzero editor exit (:cq)', async () => {
      const { editor, screen, hint } = await mount()
      fakeLauncher(() => Promise.resolve(undefined))
      type(editor, 'keep me')
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(screen.suspends).toBe(1)
      })
      await settle()
      expect(editor.getText()).toBe('keep me')
      expect(getStashedDraft()).toBe('keep me')
      expect(hint.render(80)).toEqual([])
    })

    it('notices instead of suspending when no editor is configured', async () => {
      process.env.VISUAL = ''
      process.env.EDITOR = ''
      const { editor, screen, hint } = await mount()
      expect(editor.onKey?.(KEY.ctrlG)).toBe(true)
      expect(screen.suspends).toBe(0)
      expect(hint.render(80)).toEqual(['~set $VISUAL or $EDITOR to edit drafts externally~'])
    })

    it('notices a launcher failure and re-arms for the next press', async () => {
      const { editor, screen, hint } = await mount()
      let outcome: Promise<string | undefined> = Promise.reject(new Error('editor gone'))
      fakeLauncher(() => outcome)
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(hint.render(80)).toEqual(['~!editor gone!~'])
      })
      expect(screen.suspends).toBe(1)
      // A non-Error rejection stringifies into the notice.
      outcome = Promise.reject('plain failure')
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(hint.render(80)).toEqual(['~!plain failure!~'])
      })
      expect(screen.suspends).toBe(2)
      outcome = Promise.resolve('second try')
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(editor.getText()).toBe('second try')
      })
      expect(screen.suspends).toBe(3)
    })

    it('consumes a second Ctrl-G while a session is in flight and re-arms after', async () => {
      const { editor, screen } = await mount()
      const gate = Promise.withResolvers<string | undefined>()
      fakeLauncher(() => gate.promise)
      editor.handleInput(KEY.ctrlG)
      expect(editor.onKey?.(KEY.ctrlG)).toBe(true)
      expect(screen.suspends).toBe(1)
      gate.resolve('late edit')
      await vi.waitFor(() => {
        expect(editor.getText()).toBe('late edit')
      })
      expect(screen.suspends).toBe(1)
      editor.handleInput(KEY.ctrlG)
      await vi.waitFor(() => {
        expect(screen.suspends).toBe(2)
      })
    })

    it('leaves the draft alone when the fiber unloads mid-session', async () => {
      const { editor, screen, fiber } = await mount()
      const gate = Promise.withResolvers<string | undefined>()
      fakeLauncher(() => gate.promise)
      type(editor, 'draft survives')
      editor.handleInput(KEY.ctrlG)
      await fiber.dispose()
      gate.resolve('must not land')
      await settle()
      expect(editor.getText()).toBe('draft survives')
      expect(screen.suspends).toBe(1)
    })

    it('drops the failure notice when the fiber unloads before the launcher rejects', async () => {
      const { editor, hint, fiber } = await mount()
      const gate = Promise.withResolvers<string | undefined>()
      fakeLauncher(() => gate.promise)
      editor.handleInput(KEY.ctrlG)
      await fiber.dispose()
      gate.reject(new Error('late boom'))
      await settle()
      expect(hint.render(80)).toEqual([])
    })
  })

  describe('queued-message recall (pane-queue enhancement)', () => {
    it('leaves Up to the editor history when pane-queue is not loaded', async () => {
      const inbox = fakeInbox({ nextTurn: [queued('queued draft')] })
      const { editor } = await mount({ inbox })
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(inbox.remove).not.toHaveBeenCalled()
      expect(editor.getText()).toBe('')
    })

    it('recalls the latest queued message into an empty buffer on Up', async () => {
      const first = queued('first')
      const latest = queued('latest')
      const inbox = fakeInbox({ nextTurn: [first, latest] })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(true)
      expect(inbox.remove).toHaveBeenCalledWith(latest.id)
      expect(editor.getText()).toBe('latest')
    })

    it('prefers pending steering over queued turns as the fresher intent', async () => {
      const steering = queued('steer me')
      const inbox = fakeInbox({ nextTurn: [queued('a turn')], nextStep: [steering] })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(true)
      expect(inbox.remove).toHaveBeenCalledWith(steering.id)
      expect(editor.getText()).toBe('steer me')
    })

    it('passes Up through when the buffer is not empty', async () => {
      const inbox = fakeInbox({ nextTurn: [queued('queued')] })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      type(editor, 'draft')
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(inbox.remove).not.toHaveBeenCalled()
      expect(editor.getText()).toBe('draft')
    })

    it('passes Up through when nothing is pending', async () => {
      const inbox = fakeInbox()
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(inbox.remove).not.toHaveBeenCalled()
    })

    it('passes Up through without an attached session', async () => {
      const { ctx, editor } = await mount({ withAgent: false })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(false)
    })

    it('leaves the editor alone when the removal loses the race with a claim', async () => {
      const pending = queued('claimed already')
      const inbox = fakeInbox({ nextTurn: [pending], remove: () => false })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(inbox.remove).toHaveBeenCalledWith(pending.id)
      expect(editor.getText()).toBe('')
    })

    it('ignores a queued message without visible text', async () => {
      const empty = { ...queued(''), content: [] } as UserMessage
      const inbox = fakeInbox({ nextTurn: [empty] })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(inbox.remove).not.toHaveBeenCalled()
    })
  })

  describe('side-question pane routing (S13)', () => {
    it('mirrors the connected flag onto the editor and splices its corners', async () => {
      const { ctx, editor } = await mount()
      ctx.emit('blue/editor-connected-above', true)
      expect(editor.connectedAbove).toBe(true)
      ctx.emit('blue/editor-connected-above', false)
      expect(editor.connectedAbove).toBe(false)
    })

    it('closes the pane on Escape before clearing the draft', async () => {
      const { ctx, editor, cancel } = await mount({ running: true })
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true)
      type(editor, 'draft')
      expect(editor.onKey?.(KEY.escape)).toBe(true)
      expect(command).toHaveBeenCalledWith('close')
      // The draft survives the close; the interrupt chain is not reached.
      expect(editor.getText()).toBe('draft')
      expect(cancel).not.toHaveBeenCalled()
    })

    it('lets an open autocomplete dropdown own Escape while the pane is up', async () => {
      const { ctx, editor } = await mount({ running: true })
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true)
      editor.showingAutocomplete = true
      expect(editor.onKey?.(KEY.escape)).toBe(false)
      expect(command).not.toHaveBeenCalled()
    })

    it('keeps the clear/interrupt chain when no pane is connected', async () => {
      const { ctx, editor } = await mount({ running: true })
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      type(editor, 'draft')
      editor.handleInput(KEY.escape)
      expect(editor.getText()).toBe('')
      expect(command).not.toHaveBeenCalled()
    })

    it('scrolls the pane on Up and Down with an empty buffer', async () => {
      const { ctx, editor } = await mount()
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true)
      expect(editor.onKey?.(KEY.up)).toBe(true)
      expect(editor.onKey?.(KEY.down)).toBe(true)
      expect(command.mock.calls).toEqual([['scroll-up'], ['scroll-down']])
    })

    it('passes arrows through to the editor when the pane is up but the buffer is not empty', async () => {
      const { ctx, editor } = await mount()
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true)
      type(editor, 'draft')
      expect(editor.onKey?.(KEY.up)).toBe(false)
      expect(command).not.toHaveBeenCalled()
    })

    it('leaves the queue recall in charge of Up when no pane is connected', async () => {
      const inbox = fakeInbox({ nextTurn: [queued('queued draft')] })
      const { ctx, editor } = await mount({ inbox })
      await ctx.plugin(paneQueuePlugin)
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      expect(editor.onKey?.(KEY.up)).toBe(true)
      expect(editor.getText()).toBe('queued draft')
      expect(command).not.toHaveBeenCalled()
    })

    it('submits the draft to the side conversation on Enter while connected', async () => {
      const { ctx, editor, followup } = await mount({ withAgent: true })
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true, false)
      type(editor, 'and then?')
      editor.handleInput(KEY.enter)
      expect(command).toHaveBeenCalledWith('submit', 'and then?')
      // The buffer clears and the main agent never sees the text.
      expect(editor.getText()).toBe('')
      expect(followup).not.toHaveBeenCalled()
    })

    it('refuses the submit and restores the draft while the side agent is busy', async () => {
      const { ctx, editor } = await mount()
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true, true)
      type(editor, 'wait for me')
      editor.handleInput(KEY.enter)
      // The draft survives, the notice flashes, and no command is emitted.
      expect(editor.getText()).toBe('wait for me')
      expect(command).not.toHaveBeenCalled()
    })

    it('clears the buffer without submitting when connected and the draft is blank', async () => {
      const { ctx, editor } = await mount()
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      ctx.emit('blue/editor-connected-above', true, false)
      type(editor, '   ')
      editor.handleInput(KEY.enter)
      expect(editor.getText()).toBe('')
      expect(command).not.toHaveBeenCalled()
    })

    it('keeps the main-agent submit path when no pane is connected', async () => {
      const { ctx, editor, followup } = await mount({ withAgent: true })
      const command = vi.fn()
      ctx.on('blue/btw-command', command)
      type(editor, 'plain')
      editor.handleInput(KEY.enter)
      expect(followup).toHaveBeenCalledOnce()
      expect(command).not.toHaveBeenCalled()
    })
  })
})

describe('the Alt+M model cycle key', () => {
  /** Capture the shared editor's notice channel for assertions. */
  function captureNotices(): string[] {
    const notices: string[] = []
    const shared = getSharedEditor() as { notice?: (text: string) => void } | undefined
    expect(shared).toBeDefined()
    shared!.notice = (text: string) => { notices.push(text) }
    return notices
  }

  it('switches the session model without touching the draft', async () => {
    const writes: unknown[] = []
    const state = { current: { provider: 'mock', model: 'mock' } }
    const modelRef = {
      get current() { return state.current },
      set current(next: unknown) { state.current = next; writes.push(next) },
    }
    const { ctx, editor } = await mount({ modelRef })
    ctx.provide('llm', {
      listModels: async () => [{ id: 'mock', name: 'Mock' }, { id: 'mock-pro', name: 'Mock Pro' }],
    } as never)
    const notices = captureNotices()
    type(editor, 'keep this draft')
    editor.handleInput(KEY.altM)
    // The press is consumed before the Editor sees it, so the draft
    // survives byte for byte — the point of the hotkey.
    expect(editor.getText()).toBe('keep this draft')
    await vi.waitFor(() => { expect(notices).toHaveLength(1) })
    expect(notices[0]).toBe('Switched to mock-pro (mock) · session only')
    expect(writes).toEqual([{ provider: 'mock', model: 'mock-pro' }])
  })

  it('still consumes the press without a session, flashing the guard notice', async () => {
    const { editor } = await mount({ withAgent: false })
    const notices = captureNotices()
    type(editor, 'draft')
    editor.handleInput(KEY.altM)
    expect(editor.getText()).toBe('draft')
    await vi.waitFor(() => { expect(notices).toEqual(['no session is live yet']) })
  })
})
