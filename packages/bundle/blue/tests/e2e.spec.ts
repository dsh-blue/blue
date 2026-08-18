/**
 * Whole-tree E2E for the Blue bundle: the five Blue plugins boot through the
 * real Loader from a temp cordis.yml (mirroring cordis.patch.yml's insert
 * rows), the command line arrives through `provideCmdline`, the agent spine
 * is the REAL registry + agent loop driven by a scripted mock LLM adapter
 * (agent-loop-testkit), and the terminal is core's recording FakeTerminal so
 * input is simulated and rendered output asserted. Only the model and the
 * process terminal are substituted.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
// The theme modules come from the package subpaths — not relative core
// source paths — because the /theme swap keys registry runtimes by apply
// callback identity: only the module instance interaction's theme-switch
// statically imports (this same lib file) shares a registry record with the
// baseline provider fiber it replaces.
import * as themeDarkPlugin from '@deepseek-ai/dsh-blue-core/theme-dark'
import * as themeLightPlugin from '@deepseek-ai/dsh-blue-core/theme-light'
import { BlueComponentsService, BlueKeymapService, BlueScreenService, BlueTerminalInfoService } from '../../../core/src/index.ts'
import * as appPlugin from '../../../app/src/index.ts'
import * as startupPlugin from '../../../app/src/startup.ts'
import { startBlueTerminal } from '../../../core/src/terminal.ts'
import { FakeTerminal, waitForRender } from '../../../core/tests/fake-terminal.ts'
import * as interactionPlugin from '../../../interaction/src/index.ts'
import * as editorPlusPlugin from '../../../interaction/src/editor-plus.ts'
import * as transcriptPlugin from '../../../transcript/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

/** One booted Blue tree plus its observations. */
interface BlueTree {
  ctx: Context
  terminal: FakeTerminal
  adapter: MockAdapter
  exits: number[]
  sessionChanges: Agent[]
}

/** Test-scope hooks the Loader fixtures delegate to. */
interface BlueE2EHooks {
  coreApply: (ctx: Context) => Promise<void>
  themeDarkApply: typeof themeDarkPlugin.apply
  transcriptApply: typeof transcriptPlugin.apply
  interactionApply: typeof interactionPlugin.apply
  editorPlusApply: typeof editorPlusPlugin.apply
  startupApply: typeof startupPlugin.apply
  appApply: typeof appPlugin.apply
  appConfig: typeof appPlugin.Config
}

/**
 * Boot the full Blue tree: fixture rows delegate to the source-plane plugins
 * (the Loader imports through Node's resolver, which cannot reach tsconfig
 * paths). The core row starts the real renderer over the recording terminal.
 * @param argv - inner command-line arguments (`dsh --profile blue <argv>`).
 * @param options - the mock model script and an optional persistence root.
 */
async function bootBlue(argv: string[], options: {
  script: ConstructorParameters<typeof MockAdapter>[0]
  persistenceRoot?: string
}): Promise<BlueTree> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-blue-e2e-'))
  const terminal = new FakeTerminal()
  const hooks: BlueE2EHooks = {
    coreApply: async (ctx) => {
      // startBlueTerminal went async with the OSC 11 probe; the e2e skips the
      // probe (FakeTerminal answers no queries) and awaits the runtime. The
      // service set mirrors core's apply: the keymap instantiates directly
      // (not via ctx.plugin) so the global dispatcher listener closes over
      // the instance, and blueComponents mounts as a blueTheme-injecting
      // sub-plugin so it waits for the theme-dark row.
      const runtime = await startBlueTerminal(terminal, () => Promise.resolve(undefined))
      const keymap = new BlueKeymapService(ctx)
      ctx.effect(() =>
        runtime.tui.addInputListener(data => (keymap.dispatch(data) ? { consume: true } : undefined)),
      )
      ctx.plugin(BlueTerminalInfoService, { background: runtime.background, kittyKeyboard: runtime.kittyKeyboard })
      ctx.plugin(BlueScreenService, runtime)
      ctx.plugin({
        name: 'blue-components',
        inject: ['blueTheme'],
        apply(subCtx: Context) {
          subCtx.plugin(BlueComponentsService, { theme: subCtx.blueTheme, tui: runtime.tui })
        },
      })
      ctx.effect(() => () => runtime.stop())
    },
    themeDarkApply: themeDarkPlugin.apply,
    transcriptApply: transcriptPlugin.apply,
    interactionApply: interactionPlugin.apply,
    editorPlusApply: editorPlusPlugin.apply,
    startupApply: startupPlugin.apply,
    appApply: appPlugin.apply,
    appConfig: appPlugin.Config,
  }
  ;(globalThis as unknown as { __blueE2E: BlueE2EHooks }).__blueE2E = hooks

  const fixture = (file: string, body: string): string => {
    writeFileSync(join(dir, file), body)
    return pathToFileURL(join(dir, file)).href
  }
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: blue-core',
    `  name: ${fixture('blue-core.mjs', `
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueE2E.coreApply(ctx)
`)}`,
    // The theme row mirrors cordis.patch.yml: blueTheme now ships from the
    // theme-dark subpath plugin as its own fiber. The fixture re-exports the
    // apply function itself — no wrapper arrow — so the loader-mounted
    // runtime is keyed by the very callback theme-switch.ts's
    // registry.delete looks up when /theme swaps the provider.
    '- id: blue-theme-dark',
    `  name: ${fixture('blue-theme-dark.mjs', `
export const name = 'blue-theme-dark'
export const apply = globalThis.__blueE2E.themeDarkApply
`)}`,
    '- id: blue-transcript',
    `  name: ${fixture('blue-transcript.mjs', `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']
export const apply = ctx => globalThis.__blueE2E.transcriptApply(ctx)
`)}`,
    '- id: blue-interaction',
    `  name: ${fixture('blue-interaction.mjs', `
export const name = 'blue-interaction'
export const apply = ctx => globalThis.__blueE2E.interactionApply(ctx)
`)}`,
    // The enhancement-segment row mirrors cordis.patch.yml: editor-plus
    // layers bash mode and autocomplete over the shared editor, attaching
    // through the 'blue/input-editor-changed' event.
    '- id: blue-editor-plus',
    `  name: ${fixture('blue-editor-plus.mjs', `
export const name = 'blue-editor-plus'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'commands']
export const apply = ctx => globalThis.__blueE2E.editorPlusApply(ctx)
`)}`,
    '- id: blue-startup',
    `  name: ${fixture('blue-startup.mjs', `
export const name = 'blue-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__blueE2E.startupApply(ctx)
`)}`,
    // The app row mirrors cordis.patch.yml: row-level inject on the startup
    // provider, launch values resolved lazily from it.
    '- id: blue-app',
    `  name: ${fixture('blue-app.mjs', `
export const name = 'blue-app'
export const inject = ['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']
export const Config = globalThis.__blueE2E.appConfig
export const apply = (ctx, config) => globalThis.__blueE2E.appApply(ctx, config)
`)}`,
    '  inject: [blueStartup]',
    '  config:',
    '    task: !!js ctx.blueStartup.task',
    '    resume: !!js ctx.blueStartup.resume',
    '',
  ].join('\n'))

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const exits: number[] = []
  provideCmdline(ctx, { args: argv, exit: code => void exits.push(code) })

  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
  }
  const adapter = new MockAdapter(options.script)
  ctx.llm.registerAdapter(['mock'], adapter)

  const sessionChanges: Agent[] = []
  ctx.on('blue/session-changed', (agent) => { sessionChanges.push(agent) })

  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, terminal, adapter, exits, sessionChanges }
}

/** Wait until the app driver has published its first Agent. */
async function currentAgent(tree: BlueTree): Promise<Agent> {
  await vi.waitFor(() => { expect(tree.ctx.get('blueSession')?.current).not.toBeNull() })
  return tree.ctx.get('blueSession')!.current!
}

/** Type one line into the focused editor and submit it. */
function typeLine(terminal: FakeTerminal, line: string): void {
  for (const char of line) terminal.sendInput(char)
  terminal.sendInput('\r')
}

/**
 * Execute a slash command through the real registry, exactly as the editor's
 * submit router does. Typing is avoided here so the editor-plus autocomplete
 * cannot intercept the submission and a typed command cannot clobber a draft
 * under test.
 */
async function executeCommand(tree: BlueTree, agent: Agent, line: string) {
  const execution = await tree.ctx.commands.execute(agent, line, new AbortController().signal)
  return execution?.result
}

/**
 * Return to the dark baseline after a theme-switch case. theme-switch.ts
 * holds the live theme key in module state shared across this worker's
 * cases, while every bootBlue mounts a fresh dark fiber — leaving light
 * active would strand the next case's `/theme` swap (registry.delete would
 * find no light fiber and the remount would trip the duplicate-service
 * guard).
 */
async function backToDark(tree: BlueTree, agent: Agent): Promise<void> {
  await executeCommand(tree, agent, '/theme dark')
  await vi.waitFor(() => { expect(tree.ctx.get('blueTheme')?.colors).toBe(themeDarkPlugin.DARK_COLORS) })
}

describe('blue whole-tree e2e', () => {
  it('boots the tree, publishes blueSession, and broadcasts session-changed', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    expect(tree.sessionChanges).toEqual([agent])
    // The input editor mounted and the tree is idle, nothing rendered away.
    expect(tree.exits).toEqual([])
  })

  it('runs a startup task through the real loop and renders the reply', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    const output = tree.terminal.output
    expect(output).toContain('fix the build')
    expect(output).toContain('Blue online.')
  })

  it('routes typed input to the agent and renders the streamed answer', async () => {
    const tree = await bootBlue([], { script: [textResponse('typed answer')] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'say hi')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const request = tree.adapter.requests[0]!
    expect(JSON.stringify(request.messages)).toContain('say hi')
    await agent.whenIdle()
    await waitForRender()
    expect(tree.terminal.output).toContain('typed answer')
  })

  it('decodes Kitty CSI-u input without dropping characters', async () => {
    const tree = await bootBlue([], { script: [textResponse('kitty reply')] })
    const agent = await currentAgent(tree)
    // '\x1b[113u' is the Kitty keyboard protocol encoding of a plain 'q';
    // the real pi-tui Editor input chain must decode it into the buffer.
    tree.terminal.sendInput('\x1b[113u')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    expect(JSON.stringify(tree.adapter.requests[0]!.messages)).toContain('q')
    await agent.whenIdle()
  })

  it('runs ! shell commands through editor-plus and echoes output into the scroll region', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // Inject a fake executor (same module instance as the mounted plugin):
    // no real spawn in the e2e.
    editorPlusPlugin.setShellExecutor(command => Promise.resolve({ code: 0, output: `ran: ${command}\n` }))
    try {
      typeLine(tree.terminal, '!echo hi')
      await vi.waitFor(() => { expect(tree.terminal.output).toContain('ran: echo hi') })
      // The ShellEcho header row repeats the command itself.
      expect(tree.terminal.output).toContain('! echo hi')
      // Bash mode never reaches the model.
      expect(tree.adapter.requests).toHaveLength(0)
    } finally {
      editorPlusPlugin.setShellExecutor(undefined)
    }
  })

  it('answers the approval waterfall through the overlay for the attached agent', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    const request: ApprovalRequest = { agent, toolName: 'bash' }
    const decision = tree.ctx.waterfall('approval/request', request, fallback)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Approve bash?') })
    // Enter confirms the focused default: Allow once.
    tree.terminal.sendInput('\r')
    await expect(decision).resolves.toBe('allowed-once')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('Ctrl-C interrupts a running turn: the agent returns to idle and the process stays up', async () => {
    const tree = await bootBlue([], { script: ['hang'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'long work')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    expect(agent.status).toBe('idle')
    // The interrupt stays in-session: no exit was requested.
    expect(tree.exits).toEqual([])
  })

  it('double Ctrl-C on an idle agent exits with code 0', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // Two presses inside the 1s double-press window: the first only arms the
    // exit (hint-line notice), the second takes the same appExit path /quit
    // uses.
    tree.terminal.sendInput('\x03')
    tree.terminal.sendInput('\x03')
    expect(tree.exits).toEqual([0])
  })

  it('Esc clears the draft: a later submission carries only the new text', async () => {
    const tree = await bootBlue([], { script: [textResponse('esc ok')] })
    const agent = await currentAgent(tree)
    for (const char of 'draft to discard') tree.terminal.sendInput(char)
    tree.terminal.sendInput('\x1b')
    typeLine(tree.terminal, 'kept')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const messages = JSON.stringify(tree.adapter.requests[0]!.messages)
    expect(messages).toContain('kept')
    // Had Esc not cleared the buffer, the submission would have been the
    // draft plus 'kept'.
    expect(messages).not.toContain('draft to discard')
    await agent.whenIdle()
  })

  it('Ctrl-O toggles a tool result between the one-line summary and the full output', async () => {
    // Spaced words so the expanded wrap lands TAILMARKER intact on one row;
    // past the 160-char summary ceiling so the collapsed form ellipsizes it
    // away.
    const fullOutput = `${'word '.repeat(80)}TAILMARKER end`
    const tree = await bootBlue([], {
      script: [toolCallResponse('call-long', 'long-output', {}), textResponse('tool done')],
    })
    const agent = await currentAgent(tree)
    // A structural ToolDefinition registered without importing dsh-tools:
    // the bundle package does not depend on it directly, and register() only
    // validates the output declaration's shape.
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'long-output',
      description: 'test tool emitting a long output',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: () => Promise.resolve(fullOutput),
    })
    typeLine(tree.terminal, 'run the tool')
    await agent.whenIdle()
    await waitForRender()
    // Collapsed (the default): the one-line ellipsized summary renders; the
    // tail of the full output does not.
    expect(tree.terminal.output).toContain('long-output')
    expect(tree.terminal.output).not.toContain('TAILMARKER')
    const beforeToggle = tree.terminal.written.length
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    const expanded = tree.terminal.written.slice(beforeToggle).join('')
    expect(expanded).toContain('TAILMARKER')
  })

  it('resumes a persisted session: history renders from the snapshot, no replay needed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-blue-e2e-sessions-'))
    const first = await bootBlue(['remember this'], {
      script: [textResponse('phase one answer')],
      persistenceRoot: root,
    })
    const firstAgent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await firstAgent.whenIdle()
    const sessionId = String(firstAgent.id)
    await first.ctx.fiber.dispose()
    disposers.length = 0

    const second = await bootBlue(['--resume', sessionId], { script: [], persistenceRoot: root })
    const agent = await currentAgent(second)
    expect(String(agent.id)).toBe(sessionId)
    expect(second.sessionChanges).toEqual([agent])
    // No model call: the transcript folds the durable snapshot.
    expect(second.adapter.requests).toHaveLength(0)
    await waitForRender()
    const output = second.terminal.output
    expect(output).toContain('remember this')
    expect(output).toContain('phase one answer')
  })

  it('switches the live palette through /theme: blueTheme re-provides and the UI re-renders light', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // ctx.get('blueTheme') returns a fresh proxy per call — the palette is
    // compared by identity, never the service.
    expect(tree.ctx.get('blueTheme')?.colors).toBe(themeDarkPlugin.DARK_COLORS)
    const beforeSwitch = tree.terminal.written.length
    try {
      const result = await executeCommand(tree, agent, '/theme light')
      expect(result).toEqual({ kind: 'success', text: 'switched to theme "light"' })
      await vi.waitFor(() => {
        expect(tree.ctx.get('blueTheme')?.colors).toBe(themeLightPlugin.LIGHT_COLORS)
      })
      // The swap disposes the dark fiber and Cordis reloads every blueTheme
      // dependent; the remounted editor re-renders with the light palette
      // (border #6e7781).
      await vi.waitFor(() => {
        expect(tree.terminal.written.slice(beforeSwitch).join('')).toContain('\x1b[38;2;110;119;129m')
      })
    } finally {
      await backToDark(tree, agent)
    }
  })

  it('keeps the unsubmitted editor draft across the theme swap', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    for (const char of 'hello') tree.terminal.sendInput(char)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('hello') })
    const beforeSwitch = tree.terminal.written.length
    try {
      // Programmatic execution: typing the command into the same editor
      // would replace the draft under test.
      const result = await executeCommand(tree, agent, '/theme light')
      expect(result?.kind).toBe('success')
      // The reload rebuilds the editor from scratch; the draft comes back
      // from interaction's module-level stash and re-renders.
      await vi.waitFor(() => {
        expect(tree.terminal.written.slice(beforeSwitch).join('')).toContain('hello')
      })
    } finally {
      await backToDark(tree, agent)
    }
    // The draft was never submitted: the model saw nothing.
    expect(tree.adapter.requests).toHaveLength(0)
  })

  it('re-renders the transcript with the new palette after the theme swap', async () => {
    const tree = await bootBlue(['show', 'palette'], { script: [textResponse('palette reply')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    expect(tree.terminal.output).toContain('show palette')
    expect(tree.terminal.output).toContain('palette reply')
    const beforeSwitch = tree.terminal.written.length
    try {
      const result = await executeCommand(tree, agent, '/theme light')
      expect(result?.kind).toBe('success')
      await vi.waitFor(() => {
        expect(tree.ctx.get('blueTheme')?.colors).toBe(themeLightPlugin.LIGHT_COLORS)
      })
      // The transcript reload re-folds the full session snapshot (the D16
      // path): both rendered items come back, and the re-rendered user row
      // carries the light accent gutter (#0a7ea4), not dark's #8abeb7.
      await vi.waitFor(() => {
        const rendered = tree.terminal.written.slice(beforeSwitch).join('')
        expect(rendered).toContain('show palette')
        expect(rendered).toContain('palette reply')
        expect(rendered).toContain('\x1b[38;2;10;126;164m❯')
      })
    } finally {
      await backToDark(tree, agent)
    }
  })

  it('survives a typed /theme light: the swap unloads the input fiber mid-command without crashing', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    expect(tree.ctx.get('blueTheme')?.colors).toBe(themeDarkPlugin.DARK_COLORS)
    const beforeSwitch = tree.terminal.written.length
    try {
      // The real user path that crashed: the command arrives through the
      // editor, so execute() is still in flight when the swap unloads the
      // input fiber (blue-input injects blueTheme). Bracketed paste instead
      // of keystrokes: the pi-tui Editor inserts pasted text atomically
      // without triggering the editor-plus autocomplete dropdown, which
      // would race the Enter (an open dropdown turns Enter into completion
      // acceptance instead of submission).
      // The draft stash is module state shared across this worker's cases:
      // the fresh editor may have restored a previous case's unsubmitted
      // draft, so clear the buffer before typing the command.
      tree.terminal.sendInput('\x1b')
      // The real user path that crashed: the command arrives through the
      // editor, so execute() is still in flight when the swap unloads the
      // input fiber (blue-input injects blueTheme). Bracketed paste instead
      // of keystrokes: the pi-tui Editor inserts pasted text atomically
      // without triggering the editor-plus autocomplete dropdown, which
      // would race the Enter (an open dropdown turns Enter into completion
      // acceptance instead of submission).
      tree.terminal.sendInput('\x1b[200~/theme light\x1b[201~')
      tree.terminal.sendInput('\r')
      await vi.waitFor(() => {
        expect(tree.ctx.get('blueTheme')?.colors).toBe(themeLightPlugin.LIGHT_COLORS)
      })
      // Still alive after the swap: no fatal surfaced, no exit requested,
      // and the remounted editor re-renders with the light palette (border
      // #6e7781).
      expect(tree.terminal.output).not.toContain('fatal')
      expect(tree.exits).toEqual([])
      await vi.waitFor(() => {
        expect(tree.terminal.written.slice(beforeSwitch).join('')).toContain('\x1b[38;2;110;119;129m')
      })
    } finally {
      await backToDark(tree, agent)
    }
  })

  it('restores the terminal and removes every registration on dispose', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // Capture the host-plane service objects: fiber disposal unregisters the
    // services themselves, so post-dispose reads go through the captures.
    const questions = tree.ctx.userQuestions
    const commands = tree.ctx.commands
    await tree.ctx.fiber.dispose()
    disposers.length = 0

    expect(tree.terminal.drainCount).toBe(1)
    expect(tree.terminal.stopCount).toBe(1)
    expect(tree.ctx.get('blueScreen')).toBeUndefined()
    // blueTheme now comes from the separate blue-theme-dark plugin row; it
    // unregisters with the same fiber disposal.
    expect(tree.ctx.get('blueTheme')).toBeUndefined()
    expect(tree.ctx.get('blueKeymap')).toBeUndefined()
    // The user-questions provider went with the fiber: re-registering does
    // not trip the single-provider guard.
    const unregister = questions.registerProvider({
      ask: () => Promise.resolve({ answers: [] }),
    })
    unregister()
    // The built-in commands went too.
    expect(commands.list(agent).map(command => command.name)).toEqual([])
  })
})
