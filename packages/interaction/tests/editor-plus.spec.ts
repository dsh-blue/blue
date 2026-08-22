/**
 * Tests for the `blue-editor-plus` plugin: prompt/bash mode switching, shell
 * execution and echo (fake and default executors), the dispatching
 * autocomplete provider (slash commands and `@` mentions — delegation to the
 * L0 fd pipeline with the fs fallback behind it), and the shared-reference
 * attach/detach lifecycle.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type { BlueAutocompleteProvider, BlueComponent } from '@dsh-blue/blue-core'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import { registerCommandAliases } from '../src/command-meta.ts'
import * as editorPlus from '../src/editor-plus.ts'
import * as fileMention from '../src/file-mention.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { clearDraft, stashHistory } from '../src/draft-stash.ts'
import { __setCatalogForTest } from '../src/skills-catalog.ts'
import { fakeBlueContext, FakeBlueEditor, KEY, type FakeBlueComponents, type FakeScreen } from './fakes.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'


registerTempDirCleanup()

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => {
  editorPlus.setShellExecutor(undefined)
  fileMention.setFdProbe(undefined)
  clearSharedEditor()
  // The draft stash is module state: don't leak unsubmitted text or
  // submitted history into the next test's freshly mounted editor.
  clearDraft()
  stashHistory([])
  __setCatalogForTest(undefined)
  vi.restoreAllMocks()
})

async function mount(options: { withAgent?: boolean, plusFirst?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  components: FakeBlueComponents
  editor: FakeBlueEditor
  hint: BlueComponent
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  inputFiber: { dispose(): Promise<void> }
  plusFiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen, components } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('editor-plus-spec'))
  const followup = vi.fn()
  const agent = { id: session.id, session, status: 'idle', followup } as unknown as Agent
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent, modelRef: undefined })
  const plusFiber = options.plusFirst === true ? await ctx.plugin(editorPlus) : undefined
  const inputFiber = await ctx.plugin(inputPlugin)
  const editor = screen.children[0] as FakeBlueEditor
  // blue-input mounts the editor first, then the hint line below it.
  const hint = screen.children[1] as BlueComponent
  return {
    ctx,
    screen,
    components,
    editor,
    hint,
    agent,
    followup,
    inputFiber,
    plusFiber: plusFiber ?? await ctx.plugin(editorPlus),
  }
}

function type(editor: FakeBlueEditor, text: string): void {
  for (const char of text) editor.handleInput(char)
}

/** The shell echo components currently mounted in the scroll region. */
function echoes(screen: FakeScreen): BlueComponent[] {
  return screen.children.filter(child => !(child instanceof FakeBlueEditor))
    .filter(child => child.render(80)[0]?.startsWith('$$ ') === true)
}

describe('blue-editor-plus input modes', () => {
  it("switches to bash mode on a bare '!' without polluting the buffer", async () => {
    const { editor } = await mount()
    type(editor, '!')
    expect(editor.getText()).toBe('')
    expect(editor.borderColor('x')).toBe('$x$')
  })

  it('applies the bash triple: ! symbol, border label, and shell hue', async () => {
    const { editor } = await mount()
    expect(editor.promptSymbol).toBe('>')
    type(editor, '!')
    expect(editor.promptSymbol).toBe('!')
    expect(editor.borderLabel).toBe(' $! shell mode$ ')
    expect(editor.borderColor('x')).toBe('$x$')
  })

  it('keeps the shell hue over the slash-context resolution while bash is active', async () => {
    const { editor } = await mount()
    type(editor, '!')
    // A leading `/` is a path separator in bash mode; blue-input's
    // primary-highlight must not win over the re-asserted shell hue.
    type(editor, '/etc/passwd')
    expect(editor.borderColor('x')).toBe('$x$')
  })

  it('exits bash mode on Escape with an empty buffer', async () => {
    const { editor } = await mount()
    type(editor, '!')
    expect(editor.promptSymbol).toBe('!')
    // The kimi bash exit: Escape on the empty `!` prompt returns to prompt
    // mode, consumed by the editor chain.
    expect(editor.onKey?.(KEY.escape)).toBe(true)
    expect(editor.promptSymbol).toBe('>')
    expect(editor.borderLabel).toBeUndefined()
    expect(editor.borderColor('x')).toBe('x')
  })

  it('exits bash mode on Backspace with an empty buffer', async () => {
    const { editor } = await mount()
    type(editor, '!')
    expect(editor.onKey?.('\x7f')).toBe(true)
    expect(editor.promptSymbol).toBe('>')
    expect(editor.borderLabel).toBeUndefined()
    expect(editor.borderColor('x')).toBe('x')
  })

  it('keeps bash mode when Escape clears a non-empty buffer', async () => {
    const { editor } = await mount()
    type(editor, '!')
    type(editor, 'ls')
    // Escape clears the draft through blue-input's chain; the mode stays.
    editor.onKey?.(KEY.escape)
    expect(editor.getText()).toBe('')
    expect(editor.promptSymbol).toBe('!')
    expect(editor.borderColor('x')).toBe('$x$')
    // The next Escape on the now-empty prompt exits.
    expect(editor.onKey?.(KEY.escape)).toBe(true)
    expect(editor.promptSymbol).toBe('>')
  })

  it('restores the prompt symbol and drops the label on a bash submission', async () => {
    const { editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: '', stderr: '' }))
    type(editor, '!')
    type(editor, 'true')
    editor.handleInput(KEY.enter)
    expect(editor.promptSymbol).toBe('>')
    expect(editor.borderLabel).toBeUndefined()
    expect(editor.borderColor('x')).toBe('x')
  })

  it("keeps a later '!' in the buffer while in bash mode", async () => {
    const { editor } = await mount()
    type(editor, '!')
    type(editor, '!ls')
    expect(editor.getText()).toBe('!ls')
    expect(editor.borderColor('x')).toBe('$x$')
  })

  it('executes a bash submission, echoes it, records history, and reverts to prompt mode', async () => {
    const { screen, editor, followup } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: 'hi there\n', stderr: '' }))
    type(editor, '!')
    type(editor, 'echo hi')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    const echo = echoes(screen)[0] as BlueComponent
    expect(echo.render(80)).toEqual(['$$ $echo hi', '_hi there_'])
    echo.invalidate()
    expect(editor.borderColor('x')).toBe('x')
    expect(editor.history).toEqual(['echo hi'])
    expect(editor.getText()).toBe('')
    // Prompt mode again: plain text routes to the agent follow-up.
    type(editor, 'back to prompt')
    editor.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('requests a render when the shell echo mounts, not only on the next keypress', async () => {
    const { screen, editor } = await mount()
    // A manually-settled executor: the echo mounts strictly after the
    // input-driven frame, the async window where a paint must be asked for.
    const gate = Promise.withResolvers<editorPlus.ShellExecution>()
    editorPlus.setShellExecutor(() => gate.promise)
    type(editor, '!')
    type(editor, 'echo late')
    editor.handleInput(KEY.enter)
    // Let the input-frame render requests settle before snapshotting.
    await new Promise(resolve => setImmediate(resolve))
    const before = screen.renderRequests
    gate.resolve({ code: 0, stdout: 'late output\n', stderr: '' })
    await vi.waitFor(() => { expect(echoes(screen)).toHaveLength(1) })
    expect(screen.renderRequests).toBeGreaterThan(before)
  })

  it('renders a non-zero exit code in the error color and skips an empty body', async () => {
    const { screen, editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 3, stdout: '', stderr: '' }))
    type(editor, '!')
    type(editor, 'boom')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    expect(echoes(screen)[0]?.render(80)).toEqual(['$$ $boom', '_(no output)_', '!exit code 3!'])
  })

  it('echoes executor rejections with exit code 1', async () => {
    const { screen, editor } = await mount()
    let failures = 0
    editorPlus.setShellExecutor(() => {
      failures += 1
      return failures === 1 ? Promise.reject(new Error('spawn broke')) : Promise.reject('raw failure')
    })
    type(editor, '!')
    type(editor, 'first')
    editor.handleInput(KEY.enter)
    type(editor, '!')
    type(editor, 'second')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(2)
    })
    expect(echoes(screen)[0]?.render(80)).toEqual(['$$ $first', '!spawn broke!', '!exit code 1!'])
    expect(echoes(screen)[1]?.render(80)).toEqual(['$$ $second', '!raw failure!', '!exit code 1!'])
  })

  it('drops the echo when the fiber unloads before the shell settles', async () => {
    const { screen, editor, plusFiber } = await mount()
    // A shell gate the test settles by hand, so the theme-swap unload can
    // land while the command is still running.
    const gate = Promise.withResolvers<editorPlus.ShellExecution>()
    editorPlus.setShellExecutor(() => gate.promise)
    type(editor, '!')
    type(editor, 'slow')
    editor.handleInput(KEY.enter)
    await plusFiber.dispose()
    gate.resolve({ code: 0, stdout: 'late\n', stderr: '' })
    await new Promise(resolve => setImmediate(resolve))
    // The continuation saw the unloaded fiber: no echo, and no throw through
    // the dead context.
    expect(echoes(screen)).toHaveLength(0)
  })

  it('drops the echo when the fiber unloads before the shell fails', async () => {
    const { screen, editor, plusFiber } = await mount()
    const gate = Promise.withResolvers<editorPlus.ShellExecution>()
    editorPlus.setShellExecutor(() => gate.promise)
    type(editor, '!')
    type(editor, 'slow')
    editor.handleInput(KEY.enter)
    await plusFiber.dispose()
    gate.reject(new Error('late spawn'))
    await new Promise(resolve => setImmediate(resolve))
    expect(echoes(screen)).toHaveLength(0)
  })

  it('reverts to prompt mode without executing on a blank bash submission', async () => {
    const { editor, followup } = await mount()
    const executor = vi.fn(() => Promise.resolve({ code: 0, stdout: '', stderr: '' }))
    editorPlus.setShellExecutor(executor)
    type(editor, '!')
    type(editor, '   ')
    editor.handleInput(KEY.enter)
    expect(executor).not.toHaveBeenCalled()
    expect(editor.borderColor('x')).toBe('x')
    type(editor, 'plain')
    editor.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('caps echo output by line count', async () => {
    const { screen, editor } = await mount()
    const output = Array.from({ length: 250 }, (_, index) => `line ${index}`).join('\n')
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: output, stderr: '' }))
    type(editor, '!')
    type(editor, 'flood')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    const rendered = echoes(screen)[0]?.render(80) ?? []
    expect(rendered).toHaveLength(1 + 200 + 1)
    expect(rendered.at(-1)).toBe('~… output truncated~')
    expect(rendered[1]).toBe('_line 0_')
    expect(rendered[200]).toBe('_line 199_')
  })

  it('caps echo output by byte count', async () => {
    const { screen, editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: 'x'.repeat(70_000), stderr: '' }))
    type(editor, '!')
    type(editor, 'big')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    const rendered = echoes(screen)[0]?.render(100_000) ?? []
    expect(rendered[1]).toHaveLength(64 * 1024 + 2)
    expect(rendered.at(-1)).toBe('~… output truncated~')
  })

  it('dims stderr on success and reddens it on failure', async () => {
    const { screen, editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: 'out\n', stderr: 'warn\n' }))
    type(editor, '!')
    type(editor, 'mixed')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    expect(echoes(screen)[0]?.render(80)).toEqual(['$$ $mixed', '_out_', '_warn_'])
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 2, stdout: 'out\n', stderr: 'boom\n' }))
    type(editor, '!')
    type(editor, 'bad')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(2)
    })
    expect(echoes(screen)[1]?.render(80)).toEqual(['$$ $bad', '_out_', '!boom!', '!exit code 2!'])
  })

  it('sanitizes terminal sequences out of captured output', async () => {
    const { screen, editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({
      code: 0,
      stdout: '\x1b[31mred\x1b[0m\n\x1b]0;title\x07ok',
      stderr: '',
    }))
    type(editor, '!')
    type(editor, 'ansi')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    // The SGR colors and the OSC window-title sequence never reach the TUI.
    expect(echoes(screen)[0]?.render(80)).toEqual(['$$ $ansi', '_red_', '_ok_'])
  })

  it('combines per-stream caps into one truncation row', async () => {
    const { screen, editor } = await mount()
    const flood = Array.from({ length: 250 }, (_, index) => `s${index}`).join('\n')
    editorPlus.setShellExecutor(() => Promise.resolve({
      code: 0,
      stdout: flood,
      stderr: 'z'.repeat(70_000),
    }))
    type(editor, '!')
    type(editor, 'flood2')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    const rendered = echoes(screen)[0]?.render(100_000) ?? []
    expect(rendered.at(-1)).toBe('~… output truncated~')
    expect(rendered[1]).toBe('_s0_')
  })

  it('truncates echo rows to the render width', async () => {
    const { screen, editor } = await mount()
    editorPlus.setShellExecutor(() => Promise.resolve({ code: 0, stdout: 'y'.repeat(100), stderr: '' }))
    type(editor, '!')
    type(editor, 'wide')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    const rendered = echoes(screen)[0]?.render(20) ?? []
    expect(rendered[0]).toBe('$$ $wide')
    expect(rendered[1]).toBe(`_${'y'.repeat(17)}\x1b[0m...\x1b[0m_`)
  })

  it('runs the default executor through the real shell', async () => {
    const { screen, editor } = await mount()
    type(editor, '!')
    type(editor, 'echo blue-plus-real')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    expect(echoes(screen)[0]?.render(80)).toEqual(['$$ $echo blue-plus-real', '_blue-plus-real_'])
  })

  it('maps signal terminations and numeric exit codes through the default executor', async () => {
    const { screen, editor } = await mount()
    type(editor, '!')
    type(editor, 'exit 3')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(1)
    })
    expect(echoes(screen)[0]?.render(80).at(-1)).toBe('!exit code 3!')
    type(editor, '!')
    type(editor, 'kill -TERM $$')
    editor.handleInput(KEY.enter)
    await vi.waitFor(() => {
      expect(echoes(screen)).toHaveLength(2)
    })
    expect(echoes(screen)[1]?.render(80).at(-1)).toBe('!exit code 1!')
  })
})

describe('blue-editor-plus attach lifecycle', () => {
  it('attaches when blue-input mounts after it', async () => {
    const { editor } = await mount({ plusFirst: true })
    expect(editor.autocompleteProvider).toBeDefined()
    type(editor, '!')
    expect(editor.borderColor('x')).toBe('$x$')
  })

  it('restores the previous editor handlers when the fiber disposes', async () => {
    const { editor, followup, plusFiber } = await mount()
    await plusFiber.dispose()
    type(editor, '!')
    // No mode switch anymore: the '!' stays in the buffer, the frame keeps
    // the prompt-mode look, and the submit routes as a plain follow-up
    // through the restored blue-input handler.
    expect(editor.getText()).toBe('!')
    expect(editor.promptSymbol).toBe('>')
    expect(editor.borderColor('x')).toBe('x')
    editor.handleInput(KEY.enter)
    expect(followup).toHaveBeenCalledOnce()
  })

  it('re-attaches to the new editor when blue-input remounts (theme reload)', async () => {
    const { ctx, screen, editor, inputFiber } = await mount()
    type(editor, '!')
    expect(editor.borderColor('x')).toBe('$x$')
    await inputFiber.dispose()
    // Detach restored the old editor's prompt-mode frame.
    expect(editor.borderColor('x')).toBe('x')
    expect(editor.promptSymbol).toBe('>')
    await ctx.plugin(inputPlugin)
    const remounted = screen.children[0] as FakeBlueEditor
    expect(remounted).not.toBe(editor)
    type(remounted, '!')
    expect(remounted.borderColor('x')).toBe('$x$')
  })

  it('rebuilds bash mode on the remounted editor from the reload stash', async () => {
    const { ctx, screen, editor, inputFiber } = await mount()
    type(editor, '!')
    type(editor, 'ls -la')
    await inputFiber.dispose()
    await ctx.plugin(inputPlugin)
    const remounted = screen.children[0] as FakeBlueEditor
    // The draft text and the bash triple both survive the rebuild.
    expect(remounted.getText()).toBe('ls -la')
    expect(remounted.promptSymbol).toBe('!')
    expect(remounted.borderLabel).toBe(' $! shell mode$ ')
    expect(remounted.borderColor('x')).toBe('$x$')
  })

  it('tolerates a shared editor that carries no prior handlers', async () => {
    const { ctx } = await mount({ plusFirst: true })
    const bare = new FakeBlueEditor()
    const submitPrompt = vi.fn()
    setSharedEditor({ editor: bare, submitPrompt })
    ctx.emit('blue/input-editor-changed')
    type(bare, '!')
    expect(bare.borderColor('x')).toBe('$x$')
    // Leave bash mode again, so the re-attach below starts from the
    // stashed prompt mode rather than restoring the bash frame.
    bare.handleInput(KEY.enter)
    expect(bare.promptSymbol).toBe('>')
    // Detach restores the (undefined) handlers without crashing.
    clearSharedEditor()
    ctx.emit('blue/input-editor-changed')
    expect(bare.onChange).toBeUndefined()
    expect(bare.onSubmit).toBeUndefined()
    // A prompt-mode submit after re-attaching falls through to the router.
    setSharedEditor({ editor: bare, submitPrompt })
    ctx.emit('blue/input-editor-changed')
    type(bare, 'hello')
    bare.handleInput(KEY.enter)
    expect(submitPrompt).toHaveBeenCalledWith('hello')
  })
})

describe('blue-editor-plus slash completion', () => {
  async function providerOf(options: { withAgent?: boolean } = {}): Promise<{
    provider: BlueAutocompleteProvider
    ctx: Context
    editor: FakeBlueEditor
  }> {
    const mounted = await mount(options)
    const provider = (mounted.editor.autocompleteProvider ?? undefined) as BlueAutocompleteProvider | undefined
    if (provider === undefined) throw new Error('no provider attached')
    return { provider, ctx: mounted.ctx, editor: mounted.editor }
  }

  it('suggests commands fuzzy-matching the slash prefix, ties keeping registry order', async () => {
    const { provider, ctx } = await providerOf()
    const agent = ctx.get('blueSession')?.current as Agent
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'quit', description: 'Exit Blue', handler: () => ({ kind: 'success' }) })
    const suggestions = await provider.getSuggestions(['/re'], 0, 3, { signal: signal() })
    // The prefix carries its slash so Enter accepts-and-submits; values do
    // too so pi-tui's best-match preselection keys on the typed text. The
    // registry lists name-sorted ('restart' precedes 'resume'), and the
    // equal scores keep that order.
    expect(suggestions?.prefix).toBe('/re')
    expect(suggestions?.items).toEqual([
      { value: '/restart', label: '/restart', description: 'Restart everything' },
      { value: '/resume', label: '/resume', description: 'Resume a previous session' },
    ])
    expect(agent).toBeDefined()
  })

  it('drops commands the query cannot subsequence-match', async () => {
    const { provider, ctx } = await providerOf()
    ctx.commands.register({ name: 'theme', description: 'Switch the color theme', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    // 'thm' matches `theme` out of order but finds no `h` after `t` in
    // `restart`.
    const suggestions = await provider.getSuggestions(['/thm'], 0, 4, { signal: signal() })
    expect(suggestions?.items).toEqual([
      { value: '/theme', label: '/theme', description: 'Switch the color theme' },
    ])
  })

  it('joins the argument hint into the dropdown description', async () => {
    const { provider, ctx } = await providerOf()
    ctx.commands.register({
      name: 'resume',
      description: 'Resume a previous session',
      input: { hint: '<question>' },
      handler: () => ({ kind: 'success' }),
    })
    ctx.commands.register({
      name: 'router',
      description: 'Route the conversation',
      handler: () => ({ kind: 'success' }),
    })
    const suggestions = await provider.getSuggestions(['/r'], 0, 2, { signal: signal() })
    const byName = new Map(suggestions?.items.map(item => [item.label, item.description]))
    expect(byName.get('/resume')).toBe('<question> — Resume a previous session')
    // A command without an argument hint keeps its plain summary.
    expect(byName.get('/router')).toBe('Route the conversation')
  })

  it('matches aliases behind the canonical name, labeling alias hits with the alias list', async () => {
    const { provider, ctx } = await providerOf()
    ctx.commands.register({ name: 'exist', description: 'Exists in the workspace', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'quit', description: 'Exit Blue', handler: () => ({ kind: 'success' }) })
    const clear = registerCommandAliases('quit', ['q', 'exit'])
    try {
      // `exi` misses the canonical names (`exist` matches it fully, `quit`
      // cannot) but hits `quit`'s alias `exit`: the canonical command
      // surfaces with the alias list on the label, the value still completes
      // to `/quit`, and the score tie keeps the canonical-name match ahead
      // of the alias match (the kimi sort rule).
      const suggestions = await provider.getSuggestions(['/exi'], 0, 4, { signal: signal() })
      expect(suggestions?.items).toEqual([
        { value: '/exist', label: '/exist', description: 'Exists in the workspace' },
        { value: '/quit', label: '/quit (q, exit)', description: 'Exit Blue' },
      ])
      // A query the canonical name itself matches (`q` is a subsequence of
      // `quit`) keeps the plain label — aliases only count when the name
      // misses.
      const plain = await provider.getSuggestions(['/q'], 0, 2, { signal: signal() })
      expect(plain?.items.some(item => item.label === '/quit (q, exit)')).toBe(false)
      expect(plain?.items.some(item => item.value === '/quit' && item.description === 'Exit Blue')).toBe(true)
    } finally {
      clear()
    }
  })

  it('declines slash suggestions in bash mode so Enter runs the typed path', async () => {
    const { provider, ctx, editor } = await providerOf()
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    type(editor, '!')
    await expect(provider.getSuggestions(['/tmp'], 0, 4, { signal: signal() })).resolves.toBeNull()
  })

  it('applies a slash completion by replacing the command token', async () => {
    const { provider } = await providerOf()
    const applied = provider.applyCompletion(
      ['/res abc', 'second line'],
      0,
      4,
      { value: '/resume', label: '/resume' },
      '/res',
    )
    expect(applied).toEqual({ lines: ['/resume abc', 'second line'], cursorLine: 0, cursorCol: 8 })
  })

  it('returns null without an attached session', async () => {
    const { provider } = await providerOf({ withAgent: false })
    await expect(provider.getSuggestions(['/re'], 0, 3, { signal: signal() })).resolves.toBeNull()
  })

  it('returns null for plain text and for slash lines past the command token', async () => {
    const { provider } = await providerOf()
    await expect(provider.getSuggestions(['hello'], 0, 5, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions(['/resume abc'], 0, 11, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions([], 0, 0, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions(['x'], 3, 0, { signal: signal() })).resolves.toBeNull()
  })

  it('returns the lines unchanged when applying outside any completion context', async () => {
    const { provider } = await providerOf()
    expect(provider.applyCompletion([], 0, 0, { value: 'x', label: 'x' }, ''))
      .toEqual({ lines: [], cursorLine: 0, cursorCol: 0 })
  })
})

describe('blue-editor-plus # skill completion', () => {
  /** One summary double for the catalog seam. */
  function skill(name: string, options: { modelInvocable?: boolean } = {}): SkillSummary {
    return {
      name,
      description: `The ${name} skill`,
      invocation: { modelInvocable: options.modelInvocable ?? true, userInvocable: true },
      source: 'custom',
      provider: 'spec',
    }
  }

  it('suggests settled skills fuzzy-matching the # prefix, values carrying their #', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check'), skill('summarize')])
    const suggestions = await provider.getSuggestions(['#deploy-ch'], 0, 10, { signal: signal() })
    // The value and the returned prefix carry the `#` so pi-tui's
    // best-match preselection keys on the typed text — and Enter, seeing a
    // non-slash prefix, accepts without submitting.
    expect(suggestions?.prefix).toBe('#deploy-ch')
    expect(suggestions?.items).toEqual([
      { value: '#deploy-check', label: '#deploy-check', description: 'The deploy-check skill' },
    ])
    expect(provider.triggerCharacters).toEqual(['/', '@', '#'])
  })

  it('a bare # lists every settled skill', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check'), skill('summarize')])
    const suggestions = await provider.getSuggestions(['#'], 0, 1, { signal: signal() })
    expect(suggestions?.prefix).toBe('#')
    expect(suggestions?.items.map(item => item.value)).toEqual(['#deploy-check', '#summarize'])
  })

  it('marks user-only skills in the dropdown description', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check', { modelInvocable: false })])
    const suggestions = await provider.getSuggestions(['#de'], 0, 3, { signal: signal() })
    expect(suggestions?.items).toEqual([
      { value: '#deploy-check', label: '#deploy-check', description: 'user-only · The deploy-check skill' },
    ])
  })

  it('completes a # token mid-line after other words', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check')])
    const suggestions = await provider.getSuggestions(['please run #de'], 0, 14, { signal: signal() })
    expect(suggestions?.prefix).toBe('#de')
    expect(suggestions?.items[0]?.value).toBe('#deploy-check')
  })

  it('declines outside a skill token: mid-word #, doubled #, uppercase, closed and empty matches', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check')])
    // `C#` (mid-word), `##` (hash before the token), and `#De` (uppercase
    // sits outside the name grammar) never trigger.
    await expect(provider.getSuggestions(['C#'], 0, 2, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions(['##'], 0, 2, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions(['#De'], 0, 3, { signal: signal() })).resolves.toBeNull()
    // A closed token (trailing space) and a query matching nothing close
    // the dropdown rather than listing.
    await expect(provider.getSuggestions(['#deploy-check '], 0, 14, { signal: signal() })).resolves.toBeNull()
    await expect(provider.getSuggestions(['#zzz'], 0, 4, { signal: signal() })).resolves.toBeNull()
  })

  it('declines with nothing settled', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    await expect(provider.getSuggestions(['#de'], 0, 3, { signal: signal() })).resolves.toBeNull()
  })

  it('declines # suggestions in bash mode so Enter keeps the shell line', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    __setCatalogForTest([skill('deploy-check')])
    type(editor, '!')
    await expect(provider.getSuggestions(['#de'], 0, 3, { signal: signal() })).resolves.toBeNull()
  })

  it('applies a # completion by replacing the token mid-line with a trailing space', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    // Unlike a slash command the token sits mid-line: the leading words
    // survive, the applied value takes its trailing space, and the text
    // after the cursor joins trimmed.
    const applied = provider.applyCompletion(
      ['please run #de now', 'second line'],
      0,
      14,
      { value: '#deploy-check', label: '#deploy-check' },
      '#de',
    )
    expect(applied).toEqual({ lines: ['please run #deploy-check now', 'second line'], cursorLine: 0, cursorCol: 25 })
  })

  it('returns the lines unchanged when applying a # item outside a skill token', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    expect(provider.applyCompletion(['plain'], 0, 5, { value: '#x', label: '#x' }, '#x'))
      .toEqual({ lines: ['plain'], cursorLine: 0, cursorCol: 5 })
  })
})

describe('blue-editor-plus argument-hint ghost', () => {
  it('shows the command input hint after a completed command token', async () => {
    const { ctx, editor } = await mount()
    ctx.commands.register({
      name: 'btw',
      description: 'Ask a side question',
      input: { hint: '<question>' },
      handler: () => ({ kind: 'success' }),
    })
    type(editor, '/btw')
    // No separator typed yet: the ghost lead-spaces itself.
    expect(editor.ghostHint).toBe(' <question>')

    type(editor, ' ')
    expect(editor.ghostHint).toBe('<question>')

    // Typing the argument replaces the ghost — the regex only admits a
    // command token plus at most one space.
    type(editor, 'w')
    expect(editor.ghostHint).toBeUndefined()
  })

  it('clears the ghost for unknown commands and hint-less commands', async () => {
    const { ctx, editor } = await mount()
    ctx.commands.register({ name: 'plain', description: 'No input hint', handler: () => ({ kind: 'success' }) })
    type(editor, '/unknown')
    expect(editor.ghostHint).toBeUndefined()
    editor.setText('')
    type(editor, '/plain')
    expect(editor.ghostHint).toBeUndefined()
  })

  it('resolves the argument hint through an alias token', async () => {
    const { ctx, editor } = await mount()
    ctx.commands.register({
      name: 'resume',
      description: 'Resume a previous session',
      input: { hint: '<session-id>' },
      handler: () => ({ kind: 'success' }),
    })
    const clear = registerCommandAliases('resume', ['r'])
    try {
      // `/r ` is an alias token: the ghost looks the hint up on the
      // canonical command, mirroring the dispatch rewrite.
      type(editor, '/r ')
      expect(editor.ghostHint).toBe('<session-id>')
      // Without a registered alias the token stays unknown.
      editor.setText('/x ')
      expect(editor.ghostHint).toBeUndefined()
    } finally {
      clear()
    }
  })

  it('never shows the ghost without an attached session', async () => {
    const { editor } = await mount({ withAgent: false })
    type(editor, '/btw')
    expect(editor.ghostHint).toBeUndefined()
  })

  it('never shows the ghost in bash mode and clears it on detach', async () => {
    const { ctx, editor, plusFiber } = await mount()
    ctx.commands.register({
      name: 'btw',
      description: 'Ask a side question',
      input: { hint: '<question>' },
      handler: () => ({ kind: 'success' }),
    })
    type(editor, '!')
    type(editor, '/btw')
    expect(editor.ghostHint).toBeUndefined()

    // Empty the bash buffer, leave bash, and establish a prompt-mode ghost.
    editor.setText('')
    editor.onKey?.(KEY.escape)
    type(editor, '/btw')
    expect(editor.ghostHint).toBe(' <question>')
    await plusFiber.dispose()
    expect(editor.ghostHint).toBeUndefined()
  })

  it('ghosts a draft restored before the enhancement attaches', async () => {
    // A theme-swap reload order: blue-input restores the stashed draft, then
    // editor-plus attaches over it.
    const { ctx, editor, plusFiber } = await mount()
    ctx.commands.register({
      name: 'btw',
      description: 'Ask a side question',
      input: { hint: '<question>' },
      handler: () => ({ kind: 'success' }),
    })
    type(editor, '/btw')
    expect(editor.ghostHint).toBe(' <question>')
    await plusFiber.dispose()
    editor.setText('/btw')
    expect(editor.ghostHint).toBeUndefined()
    const reattach = await ctx.plugin(editorPlus)
    expect(editor.ghostHint).toBe(' <question>')
    await reattach.dispose()
  })
})

describe('blue-editor-plus @ mentions', () => {
  const savedPath = process.env.PATH
  const savedCwd = process.cwd()

  afterEach(() => {
    process.env.PATH = savedPath
    process.chdir(savedCwd)
  })

  /** Re-attach so the autocomplete provider picks up the current cwd. */
  function reattach(ctx: Context): void {
    ctx.emit('blue/input-editor-changed')
  }

  /**
   * A project fixture: a source tree, a hidden tree, a spaced filename, and
   * node_modules (the one tree the fallback never yields).
   */
  function fixture(): string {
    const dir = mkdtempTracked('blue-plus-files-')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.ts'), 'a')
    writeFileSync(join(dir, 'src', 'b.ts'), 'b')
    writeFileSync(join(dir, 'top.md'), 'top')
    writeFileSync(join(dir, 'a b.txt'), 'spaced')
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, '.hidden', 'secret.ts'), 'x')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'i.js'), 'x')
    return dir
  }

  it('delegates @ suggestions to the L0 mention source while fd is available', async () => {
    fileMention.setFdProbe(async () => 'fd')
    const { editor, components } = await mount()
    await fileMention.detectFdPath()
    const delegated = vi.fn(async () => ({
      items: [{ value: '@src/a.ts', label: 'a.ts', description: 'src/a.ts' }],
      prefix: '@sr',
    }))
    components.mentionGetSuggestions = delegated
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const options = { signal: signal() }
    const suggestions = await provider.getSuggestions(['see @sr'], 0, 7, options)
    expect(suggestions).toEqual({
      items: [{ value: '@src/a.ts', label: 'a.ts', description: 'src/a.ts' }],
      prefix: '@sr',
    })
    expect(delegated).toHaveBeenCalledWith(['see @sr'], 0, 7, options)
  })

  it('applies an @ completion through the delegated source', async () => {
    const { editor, components } = await mount()
    components.mentionApplyCompletion = (lines, cursorLine, cursorCol) => ({
      lines: ['applied'],
      cursorLine,
      cursorCol,
    })
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const applied = provider.applyCompletion(['see @sr'], 0, 7, { value: '@src/a.ts', label: 'a.ts' }, '@sr')
    expect(applied).toEqual({ lines: ['applied'], cursorLine: 0, cursorCol: 7 })
  })

  it('gates explicit file completion on an @ token', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    expect(provider.shouldTriggerFileCompletion?.(['@x'], 0, 2)).toBe(true)
    expect(provider.shouldTriggerFileCompletion?.(['see @x'], 0, 6)).toBe(true)
    expect(provider.shouldTriggerFileCompletion?.(['hello'], 0, 5)).toBe(false)
    expect(provider.shouldTriggerFileCompletion?.(['/cmd'], 0, 4)).toBe(false)
    expect(provider.shouldTriggerFileCompletion?.([], 0, 0)).toBe(false)
  })

  it('lists one level for a bare @ without consulting fd, and drills on request', async () => {
    fileMention.setFdProbe(async () => 'fd')
    const { ctx, editor, components } = await mount()
    await fileMention.detectFdPath()
    const delegated = vi.fn(async () => ({ items: [{ value: '@zz.ts', label: 'zz.ts' }], prefix: '@' }))
    components.mentionGetSuggestions = delegated
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    await fileMention.detectFdPath()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    // The empty-tail token takes the deterministic one-level listing —
    // fd is never asked.
    const bare = await provider.getSuggestions(['@'], 0, 1, { signal: signal() })
    expect(bare?.items.map(item => item.value)).toEqual(['@.hidden/', '@src/', '@"a b.txt"', '@top.md'])
    const drill = await provider.getSuggestions(['@src/'], 0, 5, { signal: signal() })
    expect(drill?.items.map(item => item.value)).toEqual(['@src/a.ts', '@src/b.ts'])
    expect(delegated).not.toHaveBeenCalled()
  })

  it('falls back to the fs scanner for fd-less query-bearing tokens', async () => {
    fileMention.setFdProbe(async () => null)
    const { ctx, editor } = await mount()
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const scoped = await provider.getSuggestions(['@src/a'], 0, 6, { signal: signal() })
    expect(scoped?.items).toEqual([{ value: '@src/a.ts', label: 'a.ts', description: 'src/a.ts' }])
  })

  it('returns null when the fallback finds no match in an unreadable tree', async () => {
    fileMention.setFdProbe(async () => null)
    const { ctx, editor } = await mount()
    const root = fixture()
    mkdirSync(join(root, 'locked'))
    chmodSync(join(root, 'locked'), 0o000)
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@zzz'], 0, 4, { signal: signal() })
    expect(suggestions).toBeNull()
  })

  it('caps the fs fallback at the suggestion limit', async () => {
    fileMention.setFdProbe(async () => null)
    const { ctx, editor } = await mount()
    const root = mkdtempTracked('blue-plus-many-')
    for (let index = 0; index < 205; index += 1) writeFileSync(join(root, `f${String(index).padStart(3, '0')}.txt`), 'x')
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@'], 0, 1, { signal: signal() })
    expect(suggestions?.items).toHaveLength(fileMention.MAX_FALLBACK_SUGGESTIONS)
  })

  it('falls back to the fs scanner when the fd source throws mid-session', async () => {
    fileMention.setFdProbe(async () => 'fd')
    const { ctx, editor, components } = await mount()
    await fileMention.detectFdPath()
    components.mentionGetSuggestions = async () => {
      throw new Error('fd spawn failed')
    }
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    await fileMention.detectFdPath()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@top'], 0, 4, { signal: signal() })
    expect(suggestions?.items).toEqual([{ value: '@top.md', label: 'top.md', description: 'top.md' }])
  })

  it('notices in the hint line when the mention matches nothing', async () => {
    fileMention.setFdProbe(async () => null)
    const { ctx, editor, hint } = await mount()
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    // The empty-session-cwd corner: a directory with nothing to list (and
    // equally a prefix with no match) closes the dropdown without items —
    // the hint line carries the feedback instead of silence.
    const suggestions = await provider.getSuggestions(['@zzz'], 0, 4, { signal: signal() })
    expect(suggestions).toBeNull()
    expect(hint.render(80).join('\n')).toContain('no matching files under the session cwd')
  })

  it('stays quiet when an aborted mention round returns nothing', async () => {
    fileMention.setFdProbe(async () => null)
    const { ctx, editor, hint } = await mount()
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const controller = new AbortController()
    controller.abort()
    const suggestions = await provider.getSuggestions(['@zzz'], 0, 4, { signal: controller.signal })
    expect(suggestions).toBeNull()
    expect(hint.render(80).join('\n')).not.toContain('no matching files')
  })
})
