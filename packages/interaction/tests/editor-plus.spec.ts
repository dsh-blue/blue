/**
 * Tests for the `blue-editor-plus` plugin: prompt/bash mode switching, shell
 * execution and echo (fake and default executors), the dispatching
 * autocomplete provider (slash commands and `@` files, fd and fs-fallback
 * listing), and the shared-reference attach/detach lifecycle.
 */

import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BlueAutocompleteProvider, BlueComponent } from '@deepseek-ai/dsh-blue-core'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import * as inputPlugin from '../src/input-plugin.ts'
import * as editorPlus from '../src/editor-plus.ts'
import { clearSharedEditor, setSharedEditor } from '../src/editor-instance.ts'
import { clearDraft } from '../src/draft-stash.ts'
import { fakeBlueContext, FakeBlueEditor, KEY, type FakeScreen } from './fakes.ts'

const signal = (): AbortSignal => new AbortController().signal

afterEach(() => {
  editorPlus.setShellExecutor(undefined)
  editorPlus.setFdRunner(undefined)
  clearSharedEditor()
  // The draft stash is module state: don't leak unsubmitted text into the
  // next test's freshly mounted editor.
  clearDraft()
  vi.restoreAllMocks()
})

async function mount(options: { withAgent?: boolean, plusFirst?: boolean } = {}): Promise<{
  ctx: Context
  screen: FakeScreen
  editor: FakeBlueEditor
  agent: Agent
  followup: ReturnType<typeof vi.fn>
  inputFiber: { dispose(): Promise<void> }
  plusFiber: { dispose(): Promise<void> }
}> {
  const { ctx, screen } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  await ctx.plugin(CommandRuntime)
  const session = ctx.sessions.create(SessionId('editor-plus-spec'))
  const followup = vi.fn()
  const agent = { id: session.id, session, status: 'idle', followup } as unknown as Agent
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent })
  const plusFiber = options.plusFirst === true ? await ctx.plugin(editorPlus) : undefined
  const inputFiber = await ctx.plugin(inputPlugin)
  const editor = screen.children[0] as FakeBlueEditor
  return {
    ctx,
    screen,
    editor,
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
    expect(rendered[1]).toBe(`_${'y'.repeat(17)}..._`)
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
  }> {
    const mounted = await mount(options)
    const provider = (mounted.editor.autocompleteProvider ?? undefined) as BlueAutocompleteProvider | undefined
    if (provider === undefined) throw new Error('no provider attached')
    return { provider, ctx: mounted.ctx }
  }

  it('suggests commands matching the slash prefix', async () => {
    const { provider, ctx } = await providerOf()
    const agent = ctx.get('blueSession')?.current as Agent
    ctx.commands.register({ name: 'resume', description: 'Resume a previous session', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'restart', description: 'Restart everything', handler: () => ({ kind: 'success' }) })
    ctx.commands.register({ name: 'quit', description: 'Exit Blue', handler: () => ({ kind: 'success' }) })
    const suggestions = await provider.getSuggestions(['/re'], 0, 3, { signal: signal() })
    expect(suggestions?.prefix).toBe('re')
    expect(suggestions?.items).toEqual([
      { value: 'restart', label: '/restart', description: 'Restart everything' },
      { value: 'resume', label: '/resume', description: 'Resume a previous session' },
    ])
    expect(agent).toBeDefined()
  })

  it('applies a slash completion by replacing the command token', async () => {
    const { provider } = await providerOf()
    const applied = provider.applyCompletion(
      ['/res abc', 'second line'],
      0,
      4,
      { value: 'resume', label: '/resume' },
      'res',
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

describe('blue-editor-plus file completion', () => {
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

  /** A project fixture: regular files, a hidden tree, and node_modules. */
  function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), 'blue-plus-files-'))
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'src', 'a.ts'), 'a')
    writeFileSync(join(dir, 'src', 'b.ts'), 'b')
    writeFileSync(join(dir, 'top.md'), 'top')
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, '.hidden', 'secret.ts'), 'x')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'i.js'), 'x')
    return dir
  }

  it('suggests fd-listed files matching the @ prefix', async () => {
    const { editor } = await mount()
    editorPlus.setFdRunner(() => Promise.resolve(['src/a.ts', 'src/b.ts', 'top.md']))
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@sr'], 0, 3, { signal: signal() })
    expect(suggestions?.prefix).toBe('sr')
    expect(suggestions?.items).toEqual([
      { value: 'src/a.ts', label: 'src/a.ts' },
      { value: 'src/b.ts', label: 'src/b.ts' },
    ])
  })

  it('applies a file completion keeping the @ mention marker', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const applied = provider.applyCompletion(['see @sr'], 0, 7, { value: 'src/a.ts', label: 'src/a.ts' }, 'sr')
    expect(applied).toEqual({ lines: ['see @src/a.ts'], cursorLine: 0, cursorCol: 13 })
  })

  it('gates explicit file completion on an @ token', async () => {
    const { editor } = await mount()
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    expect(provider.shouldTriggerFileCompletion?.(['@x'], 0, 2)).toBe(true)
    expect(provider.shouldTriggerFileCompletion?.(['hello'], 0, 5)).toBe(false)
    expect(provider.shouldTriggerFileCompletion?.(['/cmd'], 0, 4)).toBe(false)
    expect(provider.shouldTriggerFileCompletion?.([], 0, 0)).toBe(false)
  })

  it('falls back to the fs scanner when fd is unavailable, skipping hidden and node_modules trees', async () => {
    const { ctx, editor } = await mount()
    const root = fixture()
    process.chdir(root)
    reattach(ctx)
    editorPlus.setFdRunner(() => Promise.resolve(null))
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const all = await provider.getSuggestions(['@'], 0, 1, { signal: signal() })
    expect(all?.items.map(item => item.value).sort()).toEqual(['src/a.ts', 'src/b.ts', 'top.md'])
    const scoped = await provider.getSuggestions(['@src/a'], 0, 6, { signal: signal() })
    expect(scoped?.items).toEqual([{ value: 'src/a.ts', label: 'src/a.ts' }])
  })

  it('yields an empty suggestion set for an unreadable tree', async () => {
    const { ctx, editor } = await mount()
    const root = fixture()
    mkdirSync(join(root, 'locked'))
    chmodSync(join(root, 'locked'), 0o000)
    process.chdir(root)
    reattach(ctx)
    editorPlus.setFdRunner(() => Promise.resolve(null))
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@x'], 0, 2, { signal: signal() })
    expect(suggestions?.items).toEqual([])
  })

  it('caps the fs scanner at the suggestion limit', async () => {
    const { ctx, editor } = await mount()
    const root = mkdtempSync(join(tmpdir(), 'blue-plus-many-'))
    for (let index = 0; index < 205; index += 1) writeFileSync(join(root, `f${String(index).padStart(3, '0')}.txt`), 'x')
    process.chdir(root)
    reattach(ctx)
    editorPlus.setFdRunner(() => Promise.resolve(null))
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@'], 0, 1, { signal: signal() })
    expect(suggestions?.items).toHaveLength(200)
  })

  it('uses the default fd runner when fd is on PATH', async () => {
    const { ctx, editor } = await mount()
    const root = fixture()
    const bin = mkdtempSync(join(tmpdir(), 'blue-plus-bin-'))
    const fd = join(bin, 'fd')
    writeFileSync(fd, '#!/bin/sh\nprintf "fd/a.ts\\nfd/b.ts\\n"\n')
    chmodSync(fd, 0o755)
    process.env.PATH = `${bin}:${savedPath ?? ''}`
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@fd'], 0, 3, { signal: signal() })
    expect(suggestions?.items).toEqual([
      { value: 'fd/a.ts', label: 'fd/a.ts' },
      { value: 'fd/b.ts', label: 'fd/b.ts' },
    ])
  })

  it('falls back when the default fd runner cannot spawn fd', async () => {
    const { ctx, editor } = await mount()
    const root = fixture()
    const empty = mkdtempSync(join(tmpdir(), 'blue-plus-empty-bin-'))
    process.env.PATH = empty
    process.chdir(root)
    reattach(ctx)
    const provider = editor.autocompleteProvider as BlueAutocompleteProvider
    const suggestions = await provider.getSuggestions(['@top'], 0, 4, { signal: signal() })
    expect(suggestions?.items).toEqual([{ value: 'top.md', label: 'top.md' }])
  })
})
