/**
 * Whole-tree E2E for the Blue bundle: every Blue plugin row boots through the
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
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
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
import { clearDraft } from '../../../interaction/src/draft-stash.ts'
import * as editorPlusPlugin from '../../../interaction/src/editor-plus.ts'
import * as attachmentsPlugin from '../../../interaction/src/attachments.ts'
import * as pasteImagePlugin from '../../../interaction/src/paste-image.ts'
import { setClipboardImageReader } from '../../../interaction/src/paste-image.ts'
import * as paneQueuePlugin from '../../../interaction/src/pane-queue.ts'
import * as transcriptPlugin from '../../../transcript/src/index.ts'
import * as bannerPlugin from '../../../transcript/src/banner.ts'
import { BLUE_VERSION } from '../../../transcript/src/banner-content.ts'
import * as intentDiffPlugin from '../../../transcript/src/intent-diff.ts'
import * as intentTerminalPlugin from '../../../transcript/src/intent-terminal.ts'
import * as paneActivityPlugin from '../../../transcript/src/pane-activity.ts'
import * as paneBtwPlugin from '../../../transcript/src/pane-btw.ts'
import * as paneTodoPlugin from '../../../transcript/src/pane-todo.ts'
import * as statusBasicPlugin from '../../../transcript/src/status-basic.ts'
import * as statusContextPlugin from '../../../transcript/src/status-context.ts'
import * as statusGitPlugin from '../../../transcript/src/status-git.ts'
import { setStepFoldingEnabled } from '../../../transcript/src/window.ts'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const disposers: (() => Promise<void>)[] = []

/** The idle editor frame's border SGR: dark palette `border` #5a5a5a (S11). */
const EDITOR_BORDER_SGR = '\x1b[38;2;90;90;90m'

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  // In-turn step folding is module-global; restore the default so the next
  // spec decides its own policy.
  setStepFoldingEnabled(true)
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
  bannerApply: typeof bannerPlugin.apply
  transcriptApply: typeof transcriptPlugin.apply
  intentDiffApply: typeof intentDiffPlugin.apply
  intentTerminalApply: typeof intentTerminalPlugin.apply
  statusBasicApply: typeof statusBasicPlugin.apply
  statusGitApply: typeof statusGitPlugin.apply
  statusContextApply: typeof statusContextPlugin.apply
  paneActivityApply: typeof paneActivityPlugin.apply
  paneQueueApply: typeof paneQueuePlugin.apply
  paneTodoApply: typeof paneTodoPlugin.apply
  paneBtwApply: typeof paneBtwPlugin.apply
  interactionApply: typeof interactionPlugin.apply
  editorPlusApply: typeof editorPlusPlugin.apply
  attachmentsApply: typeof attachmentsPlugin.apply
  pasteImageApply: typeof pasteImagePlugin.apply
  startupApply: typeof startupPlugin.apply
  appApply: typeof appPlugin.apply
  appConfig: typeof appPlugin.Config
}

/**
 * Boot the full Blue tree: fixture rows delegate to the source-plane plugins
 * (the Loader imports through Node's resolver, which cannot reach tsconfig
 * paths). The core row starts the real renderer over the recording terminal.
 * @param argv - inner command-line arguments (`dsh --profile blue <argv>`).
 * @param options - the mock model script, an optional persistence root, and
 *   an optional downstream footer-entry text (adds a fixture row registering
 *   it through `blueStatus`).
 */
async function bootBlue(argv: string[], options: {
  script: ConstructorParameters<typeof MockAdapter>[0]
  persistenceRoot?: string
  footerExtra?: string
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
    bannerApply: bannerPlugin.apply,
    transcriptApply: transcriptPlugin.apply,
    intentDiffApply: intentDiffPlugin.apply,
    intentTerminalApply: intentTerminalPlugin.apply,
    statusBasicApply: statusBasicPlugin.apply,
    statusGitApply: statusGitPlugin.apply,
    statusContextApply: statusContextPlugin.apply,
    paneActivityApply: paneActivityPlugin.apply,
    paneQueueApply: paneQueuePlugin.apply,
    paneTodoApply: paneTodoPlugin.apply,
    paneBtwApply: paneBtwPlugin.apply,
    interactionApply: interactionPlugin.apply,
    editorPlusApply: editorPlusPlugin.apply,
    attachmentsApply: attachmentsPlugin.apply,
    pasteImageApply: pasteImagePlugin.apply,
    startupApply: startupPlugin.apply,
    appApply: appPlugin.apply,
    appConfig: appPlugin.Config,
  }
  ;(globalThis as unknown as { __blueE2E: BlueE2EHooks }).__blueE2E = hooks

  const fixture = (file: string, body: string): string => {
    writeFileSync(join(dir, file), body)
    return pathToFileURL(join(dir, file)).href
  }
  const rows = [
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
    // The banner row mirrors cordis.patch.yml: it sits before the transcript
    // row in the same blueComponents activation round, so the earlier row
    // keeps the banner first in the scroll area across mounts and reloads.
    '- id: blue-banner',
    `  name: ${fixture('blue-banner.mjs', `
export const name = 'blue-banner'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']
export const apply = ctx => globalThis.__blueE2E.bannerApply(ctx)
`)}`,
    '- id: blue-transcript',
    `  name: ${fixture('blue-transcript.mjs', `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'tools']
export const apply = ctx => globalThis.__blueE2E.transcriptApply(ctx)
`)}`,
    // The baseline-segment status row mirrors cordis.patch.yml: the
    // '{model} · {status}' footer entry registers into the transcript row's
    // blueStatus registry. Plain delegation — no registry-identity constraint
    // like the theme rows.
    '- id: blue-status-basic',
    `  name: ${fixture('blue-status-basic.mjs', `
export const name = 'blue-status-basic'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.statusBasicApply(ctx)
`)}`,
    // The enhancement segment mirrors cordis.patch.yml's row order: the
    // editor-plus layer first, then the footer entries, then the four bottom
    // panes. The loader mounts sibling rows concurrently, so dock order is
    // set by the blueComponents activation round: transcript, pane-todo, and
    // pane-btw inject it themselves, the two lighter panes carry the patch's
    // row-level pin, and the round activates in row order (activity → queue
    // → todo → btw) — while the interaction row's input plugin subscribes
    // last (created inside interaction's apply), so the editor mounts below
    // every pane.
    '- id: blue-editor-plus',
    `  name: ${fixture('blue-editor-plus.mjs', `
export const name = 'blue-editor-plus'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'commands']
export const apply = ctx => globalThis.__blueE2E.editorPlusApply(ctx)
`)}`,
    // The input-side S7 rows mirror cordis.patch.yml: the attachment store
    // provides the harness 'attachments' service, and paste-image injects it
    // (plus blueKeymap) so its fiber activates after the store.
    '- id: blue-attachments',
    `  name: ${fixture('blue-attachments.mjs', `
export const name = 'blue-attachments'
export const inject = ['blueComponents']
export const apply = ctx => globalThis.__blueE2E.attachmentsApply(ctx)
`)}`,
    '- id: blue-paste-image',
    `  name: ${fixture('blue-paste-image.mjs', `
export const name = 'blue-paste-image'
export const inject = ['attachments', 'blueKeymap']
export const apply = ctx => globalThis.__blueE2E.pasteImageApply(ctx)
`)}`,
    // The enhancement-segment status rows mirror cordis.patch.yml: the git
    // branch and context-occupancy footer entries.
    '- id: blue-status-git',
    `  name: ${fixture('blue-status-git.mjs', `
export const name = 'blue-status-git'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.statusGitApply(ctx)
`)}`,
    '- id: blue-status-context',
    `  name: ${fixture('blue-status-context.mjs', `
export const name = 'blue-status-context'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme']
export const apply = ctx => globalThis.__blueE2E.statusContextApply(ctx)
`)}`,
    // The S7 intent rows mirror cordis.patch.yml: both inject the
    // transcript's blueIntents registry and register their render intents.
    '- id: blue-intent-diff',
    `  name: ${fixture('blue-intent-diff.mjs', `
export const name = 'blue-intent-diff'
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.intentDiffApply(ctx)
`)}`,
    '- id: blue-intent-terminal',
    `  name: ${fixture('blue-intent-terminal.mjs', `
export const name = 'blue-intent-terminal'
export const inject = ['blueIntents', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.intentTerminalApply(ctx)
`)}`,
    // The enhancement-segment pane rows mirror cordis.patch.yml; each fixture
    // re-declares the source module's inject list, and the two lighter panes
    // carry the patch's row-level blueComponents dock-order pin.
    '- id: blue-pane-activity',
    `  name: ${fixture('blue-pane-activity.mjs', `
export const name = 'blue-pane-activity'
export const inject = ['blueScreen', 'blueTheme']
export const apply = ctx => globalThis.__blueE2E.paneActivityApply(ctx)
`)}`,
    '  inject: [blueComponents]',
    '- id: blue-pane-queue',
    `  name: ${fixture('blue-pane-queue.mjs', `
export const name = 'blue-pane-queue'
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap']
export const apply = ctx => globalThis.__blueE2E.paneQueueApply(ctx)
`)}`,
    '  inject: [blueComponents]',
    '- id: blue-pane-todo',
    `  name: ${fixture('blue-pane-todo.mjs', `
export const name = 'blue-pane-todo'
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.paneTodoApply(ctx)
`)}`,
    '- id: blue-pane-btw',
    `  name: ${fixture('blue-pane-btw.mjs', `
export const name = 'blue-pane-btw'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'commands', 'agents']
export const apply = ctx => globalThis.__blueE2E.paneBtwApply(ctx)
`)}`,
    // The assembly segment closes the plain baseline: the interaction row
    // mounts the input editor below every pane row above.
    '- id: blue-interaction',
    `  name: ${fixture('blue-interaction.mjs', `
export const name = 'blue-interaction'
export const apply = ctx => globalThis.__blueE2E.interactionApply(ctx)
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
  ]
  // A stand-in downstream plugin: one fixture row registering a fixed-text
  // entry through the blueStatus registry, after every bundle row.
  if (options.footerExtra !== undefined) {
    const text = JSON.stringify(options.footerExtra)
    rows.push(
      '- id: blue-e2e-extra',
      `  name: ${fixture('blue-e2e-extra.mjs', `
export const name = 'blue-e2e-extra'
export const inject = ['blueStatus']
export const apply = (ctx) => {
  ctx.effect(() => ctx.blueStatus.register({ id: 'e2e-extra', priority: 30, render: () => ${text} }))
}
`)}`,
    )
  }
  writeFileSync(join(dir, 'cordis.yml'), [...rows, ''].join('\n'))

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

/**
 * Force a full clear-and-repaint frame with a resize and return the first
 * such chunk WRITTEN AFTER the resize: incremental diffs leave stale text in
 * `written` and earlier frames also carried '\x1b[2J', so only a fresh full
 * frame reflects exactly what is on screen right now.
 */
async function fullFrame(terminal: FakeTerminal): Promise<string> {
  const before = terminal.written.length
  terminal.resize(terminal.columns + 1, terminal.rows)
  let frame = ''
  await vi.waitFor(() => {
    frame = terminal.written.slice(before).find(chunk => chunk.includes('\x1b[2J')) ?? ''
    expect(frame).not.toBe('')
  })
  return frame
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

  it('renders the welcome banner at boot as the first scroll child, tips included at eighty columns', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    const output = tree.terminal.output
    expect(output).toContain('Welcome back!')
    expect(output).toContain(`blue v${BLUE_VERSION}`)
    // AgentDefaultModelConfig mounts provider/model 'mock'; the banner
    // snapshots the selection at mount.
    expect(output).toContain('mock · mock')
    // The eighty-column right cell (61 wide) is past the section threshold,
    // so the quick-start tips join even on the default terminal.
    expect(output).toContain('Tips for getting started')
    // The banner renders before any transcript content.
    expect(output.indexOf('Welcome back!')).toBeLessThan(output.indexOf('Blue online.'))
  })

  it('fills the full width on wide terminals with the banner still above the transcript', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    tree.terminal.resize(120, tree.terminal.rows)
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('Welcome back!')
    expect(frame).toContain('Tips for getting started')
    // The box never caps: every banner row spans the full terminal width.
    const bannerRow = frame.split('\r\n').find(row => row.includes('Welcome back!')) ?? ''
    const plain = bannerRow
      // Strip every escape flavor the renderer emits: SGR runs, CSI
      // modes (?2031h ...), OSC 8 hyperlink tails, and stray controls.
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\u0007]*\u0007/g, '')
      .replace(/[\u0000-\u001f]/g, '')
    // fullFrame bumps the width by one to force the repaint; the box
    // fills whatever the terminal then reports — no cap.
    expect(plain.trimEnd().length).toBe(tree.terminal.columns)
    expect(frame.indexOf('Welcome back!')).toBeLessThan(frame.indexOf('Blue online.'))
  })

  it('sinks the footer and editor dock to the last rows at boot with no session content', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    await waitForRender()
    const frame = await fullFrame(tree.terminal)
    const rows = frame.split('\r\n')
    // The boot tree (banner + dock) is shorter than the 24-row viewport; the
    // renderer pads the gap so the dock spans the terminal's last rows
    // instead of floating right under the banner.
    expect(rows).toHaveLength(24)
    const bannerAt = rows.findIndex(row => row.includes('Welcome back!'))
    const footerAt = rows.findIndex(row => row.includes('mock · idle'))
    expect(bannerAt).toBeGreaterThanOrEqual(0)
    expect(footerAt).toBeGreaterThan(bannerAt)
    expect(footerAt).toBeGreaterThanOrEqual(rows.length - 8)
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

  it('renders markdown v2: bold heading, bullet rewrite, fence, and js highlighting', async () => {
    const reply = [
      '# Title',
      '',
      '- item',
      '',
      '[link](https://example.com)',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
    ].join('\n')
    const tree = await bootBlue([], { script: [textResponse(reply)] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'show markdown')
    await agent.whenIdle()
    await waitForRender()
    const shown = tree.terminal.output
    // Content anchors first (the S8 discipline: never anchor shared border
    // colors): the bullet rewrite and the fence rows are text-level facts,
    // asserted on the SGR-stripped stream (the bullet and its text sit on
    // opposite sides of a color reset).
    const plain = shown.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('• item')
    expect(plain).toContain('```js')
    expect(plain).toContain('example.com')
    // The heading row carries bold on top of the palette color, and the js
    // body row carries truecolor SGR from the highlighter (color existence
    // only — exact hues are pinned by the core unit specs; the row is
    // located by its SGR-stripped text because highlighting interleaves
    // SGR runs inside the code).
    const headingRow = shown.split(/\r?\n/).find(row => row.includes('Title'))
    expect(headingRow).toMatch(/\x1b\[1m/)
    const codeRow = shown.split(/\r?\n/).find(row => {
      // OSC 8 hyperlink tails survive the SGR strip; match on the prefix.
      const bare = row.replace(/\x1b\[[0-9;]*m/g, '').trim()
      return bare.startsWith('const x = 1')
    })
    expect(codeRow).toMatch(/\x1b\[38;2;/)
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
    // The dark theme v2 shell-mode violet.
    const SHELL_SGR = '\x1b[38;2;189;147;249m'
    // Inject a fake executor (same module instance as the mounted plugin):
    // no real spawn in the e2e.
    editorPlusPlugin.setShellExecutor(command => Promise.resolve({ code: 0, stdout: `ran: ${command}\n`, stderr: '' }))
    try {
      typeLine(tree.terminal, '!echo hi')
      await vi.waitFor(() => { expect(tree.terminal.output).toContain('ran: echo hi') })
      // The ShellEcho header leads with the shell-mode `$ ` marker, then the
      // command body in the default foreground (the kimi dim presentation).
      expect(tree.terminal.output).toContain(`${SHELL_SGR}$ `)
      // Bash mode never reaches the model.
      expect(tree.adapter.requests).toHaveLength(0)
    } finally {
      editorPlusPlugin.setShellExecutor(undefined)
    }
  })

  it('echoes a failed shell command with red stderr and the exit-code row', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // The dark theme v2 error red.
    const ERROR_SGR = '\x1b[38;2;232;84;84m'
    editorPlusPlugin.setShellExecutor(() => Promise.resolve({ code: 1, stdout: '', stderr: 'boom\n' }))
    try {
      typeLine(tree.terminal, '!fail')
      await vi.waitFor(() => { expect(tree.terminal.output).toContain('boom') })
      expect(tree.terminal.output).toContain('exit code 1')
      // The stderr paints error-red (truecolor SGR anchor).
      expect(tree.terminal.output).toContain(`${ERROR_SGR}boom`)
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
    // Step folding collapses an earlier step's tool cards into one summary
    // line; disabling it keeps this spec's single-step tool card mounted so
    // the Ctrl-O expansion path stays observable.
    setStepFoldingEnabled(false)
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

  it('renders a diff-intent tool through the DiffCard: title, path count, and +/- rows', async () => {
    const tree = await bootBlue([], {
      script: [toolCallResponse('call-diff', 'edit-file', {}), textResponse('edited')],
    })
    const agent = await currentAgent(tree)
    // The presenter hooks are optional fields on the structural definition;
    // the call view diffs the arguments, the result view the (identical)
    // payload here, and the output render gives the model a text block.
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'edit-file',
      description: 'edit a file',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({
        card: 'diff',
        title: 'Edit a.ts',
        diffs: [{ path: 'a.ts', oldText: 'one\ntwo\nthree', newText: 'one\nTWO\nthree\nfour' }],
      }),
      presentResult: () => ({
        card: 'diff',
        title: 'Edited a.ts',
        diffs: [{ path: 'a.ts', oldText: 'one\ntwo\nthree', newText: 'one\nTWO\nthree\nfour' }],
      }),
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'edited a.ts' }],
      },
      execute: () => Promise.resolve('ok'),
    })
    // Step folding folds earlier steps' tool cards into one summary line;
    // disabling it keeps the diff card mounted so the rows stay observable.
    setStepFoldingEnabled(false)
    typeLine(tree.terminal, 'edit the file')
    await agent.whenIdle()
    await waitForRender()
    // Compare against SGR-stripped output so marker/text adjacency survives
    // the separate color spans ('-' marker + removed text, '+' + added).
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('Edited a.ts')
    expect(shown).toContain('a.ts')
    expect(shown).toContain('-two')
    expect(shown).toContain('+TWO')
    expect(shown).toContain('+four')
  })

  it('renders a terminal-intent tool through the TerminalCard: cwd, command, output, and the nonzero exit badge', async () => {
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-ls', 'bash', { v: 1 }),
        toolCallResponse('call-fail', 'bash', { v: 2 }),
        textResponse('ran the shell'),
      ],
    })
    const agent = await currentAgent(tree)
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'bash',
      description: 'run a shell command',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'terminal', title: 'ls -la', cwd: '/tmp' }),
      // The second scripted call carries v:2 — its result card gets the
      // nonzero exit badge while the first stays at a silent exit 0.
      presentResult: (args: { v: number }) =>
        args.v === 2
          ? { card: 'terminal', title: 'ls -la', cwd: '/tmp', output: 'file-a\nfile-b', exitCode: 2 }
          : { card: 'terminal', title: 'ls -la', cwd: '/tmp', output: 'file-a\nfile-b', exitCode: 0 },
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'listed' }],
      },
      execute: () => Promise.resolve('ok'),
    })
    // Both scripted calls are separate steps; without disabling the fold the
    // first card collapses to a summary before the exit badge asserts.
    setStepFoldingEnabled(false)
    typeLine(tree.terminal, 'list files')
    await agent.whenIdle()
    await waitForRender()
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('$ ls -la')
    expect(shown).toContain('/tmp')
    expect(shown).toContain('file-a')
    expect(shown).toContain('file-b')
    // The second call completes with a nonzero exit: the badge renders.
    expect(shown).toContain('exit 2')
    expect(shown).toContain('ran the shell')
  })

  it('pastes a clipboard image into the editor and submits it as an image content block', async () => {
    // The attachment store resolves its root in the constructor, so the env
    // override must be in place before the boot creates the service.
    const previousDir = process.env.DSH_BLUE_ATTACHMENT_DIR
    process.env.DSH_BLUE_ATTACHMENT_DIR = mkdtempSync(join(tmpdir(), 'dsh-blue-e2e-attachments-'))
    // A 1×1 PNG (the shared literal shape with core's and interaction's
    // suites).
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
      0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
      0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
    try {
      setClipboardImageReader(() => Promise.resolve(png))
      const tree = await bootBlue([], { script: [textResponse('got it')] })
      const agent = await currentAgent(tree)
      for (const char of 'look at this ') tree.terminal.sendInput(char)
      // '\x16' is the raw Ctrl-V byte; the paste trigger resolves it through
      // the keymap ahead of the pi-tui Editor.
      tree.terminal.sendInput('\x16')
      await vi.waitFor(() => { expect(tree.terminal.output).toContain('[image #1]') })
      tree.terminal.sendInput('\r')
      await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
      const request = tree.adapter.requests[0]!
      const serialized = JSON.stringify(request.messages)
      expect(serialized).toContain('"type":"image"')
      expect(serialized).toContain('look at this')
      expect(serialized).not.toContain('[image #1]')
      await agent.whenIdle()
    } finally {
      setClipboardImageReader(undefined)
      if (previousDir === undefined) delete process.env.DSH_BLUE_ATTACHMENT_DIR
      else process.env.DSH_BLUE_ATTACHMENT_DIR = previousDir
    }
  })

  it('folds earlier in-turn steps into the summary line once the next step starts', async () => {
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-s1', 'probe', { v: 1 }),
        toolCallResponse('call-s2', 'probe', { v: 2 }),
        textResponse('done'),
      ],
    })
    const agent = await currentAgent(tree)
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'probe',
      description: 'probe tool',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'probed' }],
      },
      execute: () => Promise.resolve('ok'),
    })
    typeLine(tree.terminal, 'run the probes')
    await agent.whenIdle()
    await waitForRender()
    // Each scripted response starts a new step, so the first two steps fold
    // into one summary line each; the final step's card stays mounted.
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('… step 1 · probe ×1')
    expect(shown).toContain('… step 2 · probe ×1')
    expect(shown).toContain('done')
  })

  it('renders the baseline footer entry on the last rows below the editor', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    // The model string comes from the scripted flow's durable request header
    // (the mock default model config is provider/model 'mock').
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('mock · idle') })
    // Position discipline: a width change forces a full clear-and-repaint
    // frame, so the last such chunk carries every row in screen order —
    // transcript reply, then the editor's rounded top border (the first
    // gray `border` #5a5a5a run; the idle frame is neutral since S11,
    // slash/bash contexts recolor it), then the footer pinned to the
    // terminal's last rows (the S12 kimi dock order).
    tree.terminal.resize(100, 30)
    let frame = ''
    await vi.waitFor(() => {
      frame = [...tree.terminal.written].reverse()
        .find(chunk => chunk.includes('\x1b[2J') && chunk.includes('mock · idle')) ?? ''
      expect(frame).not.toBe('')
    })
    const reply = frame.indexOf('Blue online.')
    const footer = frame.indexOf('mock · idle')
    const editorBorder = frame.indexOf(EDITOR_BORDER_SGR, reply)
    expect(reply).toBeGreaterThanOrEqual(0)
    expect(editorBorder).toBeGreaterThan(reply)
    expect(footer).toBeGreaterThan(editorBorder)
  })

  it('frames the editor in a rounded box with a prompt symbol and persistent hint row', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    const frame = await fullFrame(tree.terminal)
    // The idle frame is the neutral gray rounded box: corners on both rules…
    expect(frame).toContain(`${EDITOR_BORDER_SGR}╭`)
    expect(frame).toContain(`${EDITOR_BORDER_SGR}╰`)
    // …a side bar on the content row with the bare `>` prompt in column 2
    // (no SGR between the bar's reset and the symbol).
    expect(frame).toContain(`${EDITOR_BORDER_SGR}│\x1b[39m > `)
    // The persistent hint row carries every loaded affordance — bash and @
    // (editor-plus) and paste image (its action) — in textMuted #6b6b6b.
    const hintAt = frame.indexOf('\x1b[38;2;107;107;107m')
    expect(hintAt).toBeGreaterThanOrEqual(0)
    expect(frame.slice(hintAt)).toContain('! bash · / commands · @ files · ctrl+s steer · ctrl+v paste image · ctrl+c exit')
  })

  it('recolors the frame for slash context with the dropdown boxed in the same frame', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('/')
    // The editor-plus provider resolves the command list asynchronously;
    // the dropdown rows appear once it settles.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/help') })
    const frame = await fullFrame(tree.terminal)
    // Slash context: the whole frame — corners and the dropdown's side bars
    // alike — repaints in primary #4fa8ff (the paint routes through the live
    // borderColor the slash resolution set).
    const PRIMARY_SGR = '\x1b[38;2;79;168;255m'
    const topAt = frame.indexOf(`${PRIMARY_SGR}╭`)
    expect(topAt).toBeGreaterThanOrEqual(0)
    const bottomAt = frame.indexOf(`${PRIMARY_SGR}╰`, topAt)
    expect(bottomAt).toBeGreaterThan(topAt)
    // The dropdown renders below the bottom rule, its rows carrying the
    // same-color side bars — one frame, no bare rows in between.
    const dropdownAt = frame.indexOf('/help', bottomAt)
    expect(dropdownAt).toBeGreaterThan(bottomAt)
    const dropdownRowStart = frame.lastIndexOf(`${PRIMARY_SGR}│`, dropdownAt)
    expect(dropdownRowStart).toBeGreaterThan(bottomAt)
  })

  it('applies the bash triple on ! mode and restores the prompt frame on submit', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // The draft stash is module state shared across this worker's cases; the
    // previous case leaves a '/' draft behind, and bash entry needs an empty
    // buffer (same clear as the queue-recall case).
    tree.terminal.sendInput('\x1b')
    clearDraft()
    tree.terminal.sendInput('!')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('! shell mode') })
    const bash = await fullFrame(tree.terminal)
    // The triple: the shellMode #bd93f9 frame, the `! shell mode` label in
    // the top rule, and the `!` prompt symbol in the frame's hue.
    const SHELL_SGR = '\x1b[38;2;189;147;249m'
    expect(bash).toContain(`${SHELL_SGR}╭`)
    expect(bash).toContain(`${SHELL_SGR}! shell mode`)
    expect(bash).toContain(`${SHELL_SGR}│\x1b[39m ${SHELL_SGR}!`)
    // Escape on the empty `!` prompt exits bash mode (the kimi exit): the
    // shell label leaves and the neutral editor frame returns.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(() => {
      const frame = tree.terminal.output
      const last = frame.lastIndexOf(`${EDITOR_BORDER_SGR}╭`)
      expect(last).toBeGreaterThan(frame.indexOf('! shell mode'))
    })
    // Backspace exits the same way.
    tree.terminal.sendInput('!')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('! shell mode') })
    tree.terminal.sendInput('\x7f')
    await vi.waitFor(() => {
      const frame = tree.terminal.output
      const last = frame.lastIndexOf(`${EDITOR_BORDER_SGR}╭`)
      expect(last).toBeGreaterThan(frame.indexOf('! shell mode'))
    })
    // Submitting an empty command returns to the neutral prompt frame too.
    tree.terminal.sendInput('!')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('! shell mode') })
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => {
      const frame = tree.terminal.output
      const last = frame.lastIndexOf(`${EDITOR_BORDER_SGR}╭`)
      expect(last).toBeGreaterThan(frame.indexOf('! shell mode'))
    })
  })

  it('flips the baseline footer entry to running during a turn and back to idle on interrupt', async () => {
    const tree = await bootBlue([], { script: ['hang'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'long work')
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('mock · running') })
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('mock · idle') })
  })

  it('renders a footer entry registered by a downstream plugin through blueStatus', async () => {
    const tree = await bootBlue([], { script: [], footerExtra: 'e2e-extra-entry' })
    await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('e2e-extra-entry') })
  })

  it('renders the context footer entry from the assistant/message usage', async () => {
    // A scripted turn whose usage reports 4242 input-side tokens: the real
    // agent loop logs it as the assistant/message event's usage, and the
    // status-context entry formats it as 'ctx 4.2k'.
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'usage reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'usage reply' } },
      { type: 'usage', usage: { inputTokens: 4242, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const tree = await bootBlue([], { script: [usageScript] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'spend tokens')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('ctx 4.2k') })
  })

  it('renders the git footer entry through the injected branch runner', async () => {
    // The e2e's session cwd is the repo checkout itself (app sets meta.cwd
    // from process.cwd()), so the real probe would return whatever branch
    // the checkout happens to be on; inject a fake runner for a
    // deterministic sentinel instead (same module instance the mounted
    // plugin delegates to).
    statusGitPlugin.setGitBranchRunner(() => 'e2e-branch')
    try {
      const tree = await bootBlue([], { script: [] })
      await currentAgent(tree)
      await vi.waitFor(() => { expect(tree.terminal.output).toContain('e2e-branch') })
    } finally {
      statusGitPlugin.setGitBranchRunner(undefined)
    }
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
      // (border #0969da, the primary anchor).
      await vi.waitFor(() => {
        expect(tree.terminal.written.slice(beforeSwitch).join('')).toContain('\x1b[38;2;9;105;218m')
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
      // carries the light roleUser gutter (#953800), not dark's #f0c674.
      await vi.waitFor(() => {
        const rendered = tree.terminal.written.slice(beforeSwitch).join('')
        expect(rendered).toContain('show palette')
        expect(rendered).toContain('palette reply')
        expect(rendered).toContain('\x1b[38;2;149;56;0m❯')
      })
    } finally {
      await backToDark(tree, agent)
    }
  })

  it('keeps the banner first after a /theme swap reloads the transcript', async () => {
    const tree = await bootBlue(['show', 'palette'], { script: [textResponse('palette reply')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    const beforeSwitch = tree.terminal.written.length
    try {
      const result = await executeCommand(tree, agent, '/theme light')
      expect(result?.kind).toBe('success')
      await vi.waitFor(() => {
        expect(tree.ctx.get('blueTheme')?.colors).toBe(themeLightPlugin.LIGHT_COLORS)
      })
      // The swap reloads every blueTheme-dependent fiber — the transcript
      // re-folds its whole snapshot back into the scroll area. The banner row
      // sits before the transcript row, so in the shared blueComponents
      // activation round it re-mounts first and stays the first scroll child.
      await vi.waitFor(() => {
        const rendered = tree.terminal.written.slice(beforeSwitch).join('')
        expect(rendered).toContain('Welcome back!')
        expect(rendered).toContain('palette reply')
        expect(rendered.indexOf('Welcome back!')).toBeLessThan(rendered.indexOf('palette reply'))
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
        expect(tree.terminal.written.slice(beforeSwitch).join('')).toContain('\x1b[38;2;9;105;218m')
      })
    } finally {
      await backToDark(tree, agent)
    }
  })

  it('shows the activity spinner while the agent runs and drops it when the turn ends', async () => {
    const tree = await bootBlue([], { script: ['hang'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'long work')
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('working…') })
    const running = await fullFrame(tree.terminal)
    expect(running).toContain('working…')
    // Dock order (S12): the footer pins to the terminal's last rows, the
    // editor sits above it, and the spinner above the editor (the first
    // gray `border` frame run at or after the spinner — the idle editor
    // frame is neutral since S11).
    const footerAt = running.indexOf('mock · running')
    const spinnerAt = running.indexOf('working…')
    const borderAt = running.indexOf(EDITOR_BORDER_SGR, spinnerAt)
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(borderAt).toBeGreaterThan(spinnerAt)
    expect(footerAt).toBeGreaterThan(borderAt)
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    expect(await fullFrame(tree.terminal)).not.toContain('working…')
  })

  it('renders the todo pane above the editor with the footer on the last rows, and Ctrl-T collapses it', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // Inject a durable whole-list snapshot straight into the session log; the
    // pane's live 'session/event' subscription picks it up.
    agent.session.append('todo/write', {
      todos: [
        { content: 'done-task', status: 'completed' },
        { content: 'active-task', status: 'in_progress' },
        { content: 'later-task', status: 'pending' },
      ],
    })
    // A list with in-progress work starts expanded: one styled row per entry.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('active-task') })
    // Dock order (S12): the footer pins to the terminal's last rows, then
    // the editor's rounded top border, then the todo pane above it (the
    // first gray `border` frame run at or after the pane — the idle editor
    // frame is neutral since S11).
    const expanded = await fullFrame(tree.terminal)
    const footer = expanded.indexOf('mock · idle')
    const todo = expanded.indexOf('active-task')
    const editorBorder = expanded.indexOf(EDITOR_BORDER_SGR, todo)
    expect(footer).toBeGreaterThanOrEqual(0)
    expect(editorBorder).toBeGreaterThan(todo)
    expect(footer).toBeGreaterThan(editorBorder)
    // The global Ctrl-T action collapses the pane to the one-line summary.
    tree.terminal.sendInput('\x14')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('todos 1/3') })
    const collapsed = await fullFrame(tree.terminal)
    expect(collapsed).toContain('todos 1/3')
    expect(collapsed).not.toContain('active-task')
  })

  it('renders queued inbox messages and recalls the latest into the empty editor on Up', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // The draft stash is module state shared across this worker's cases: make
    // sure the editor starts empty so Up reaches the recall path.
    tree.terminal.sendInput('\x1b')
    clearDraft()
    agent.inbox.append('next-turn', createUserMessage({
      content: [{ type: 'text', text: 'queued-task' }],
      source: { kind: 'user' },
    }))
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('queued-task') })
    // Dock order (S12): the footer pins to the terminal's last rows, the
    // editor sits above it, and the queue pane above the editor (the first
    // gray `border` frame run at or after the pane — the idle editor frame
    // is neutral since S11). The `↑` glyph splits the row with primary SGR
    // (S13), so the anchor is the message text alone.
    const docked = await fullFrame(tree.terminal)
    const footerAt = docked.indexOf('mock · idle')
    const queuedAt = docked.indexOf('queued-task')
    const borderAt = docked.indexOf(EDITOR_BORDER_SGR, queuedAt)
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(borderAt).toBeGreaterThan(queuedAt)
    expect(footerAt).toBeGreaterThan(borderAt)
    // Empty editor + Up: the pane-queue recall action moves the message out
    // of the inbox and into the draft.
    tree.terminal.sendInput('\x1b[A')
    expect(agent.inbox.hasPending).toBe(false)
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('queued-task')
    expect(frame).not.toContain('queued ↑ turn:')
    // The recall only drafts the text: the model saw nothing.
    expect(tree.adapter.requests).toHaveLength(0)
    // Leave no stashed draft for the next case's editor to restore.
    tree.terminal.sendInput('\x1b')
    clearDraft()
  })

  it('lists the registered commands and key bindings in the /help overlay', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    const result = await executeCommand(tree, agent, '/help')
    expect(result?.kind).toBe('success')
    // The framed HelpPanel: primary rules and the ` help ` title with the
    // key hint. The two aligned sections start with the sorted commands.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Commands') })
    const shown = tree.terminal.output
    expect(shown).toContain(' help')
    expect(shown).toContain('/btw')
    expect(shown).toContain('Exit Blue')
    expect(shown).toContain('showing 1-16 of')
    // PageDown twice scrolls to the tail of the Keys section — including
    // the pane-todo global action; the accumulated output carries the rows
    // once the throttled render settles.
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Toggle todo panel') })
    const scrolled = tree.terminal.output
    expect(scrolled).toContain('ctrl+c')
    // Escape closes the overlay.
    tree.terminal.sendInput('\x1b')
    expect(await fullFrame(tree.terminal)).not.toContain('Exit Blue')
  })

  it('switches sessions through /new and /fork, and lists them in the /sessions picker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-blue-e2e-sessions-'))
    const tree = await bootBlue(['first', 'task'], {
      script: [textResponse('first answer'), textResponse('second answer')],
      persistenceRoot: root,
    })
    const first = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await first.whenIdle()

    // /new attaches a fresh session; the session-changed broadcast fires.
    await expect(executeCommand(tree, first, '/new'))
      .resolves.toEqual({ kind: 'success', text: 'starting a new session' })
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(2) })
    const second = tree.sessionChanges[1]!
    expect(second.id).not.toBe(first.id)

    // Give the second session history so the fork's seed prefix is non-empty.
    typeLine(tree.terminal, 'second task')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    await second.whenIdle()

    // /fork attaches a child carrying the parent's full event log as its seed.
    await expect(executeCommand(tree, second, '/fork'))
      .resolves.toEqual({ kind: 'success', text: 'forking the current session' })
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(3) })
    const forked = tree.sessionChanges[2]!
    expect(String(forked.session.header.parentSession)).toBe(String(second.id))
    expect(forked.session.header.seedLength).toBeGreaterThan(0)

    // /sessions lists the persisted sessions newest-first in a picker
    // overlay. Flush the live fork so its header has reached the disk, and
    // widen the terminal first: the row labels (id · date · cwd) need room,
    // and the cwd segment is as long as this checkout's path (a worktree
    // path runs ~30 columns longer than the main checkout).
    await tree.ctx.sessions.flush(forked.session)
    tree.terminal.resize(300, 40)
    await expect(executeCommand(tree, forked, '/sessions')).resolves.toEqual({ kind: 'success' })
    // The framed picker: the `Sessions` title with the key hint, rows
    // carrying the `❯ ` pointer and the `← current` badge on the live one.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Sessions') })
    const picker = tree.terminal.output
    expect(picker).toContain('esc cancel · ↵ resume')
    expect(picker).toContain(String(first.id))
    expect(picker).toContain(String(second.id))
    expect(picker).toContain(String(forked.id))
    expect(picker).toContain('← current')
    // Pick the live session: a notice flashes and no switch happens. Find its
    // row deterministically by reproducing the picker's newest-first sort
    // over the same persisted headers.
    const persistence = tree.ctx.get('sessionPersistence')!
    const headers = await persistence.list(new AbortController().signal)
    const sorted = [...headers].sort((a, b) => b.createdAt - a.createdAt)
    const currentRow = sorted.findIndex(header => String(header.id) === String(forked.id))
    expect(currentRow).toBeGreaterThanOrEqual(0)
    for (let row = 0; row < currentRow; row += 1) tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('already the current session') })
    expect(tree.sessionChanges).toHaveLength(3)
  })

  it('runs /btw side questions in a forked session and dismisses the pane', async () => {
    const tree = await bootBlue([], { script: [textResponse('side reply')] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/btw hello side'))
      .resolves.toEqual({ kind: 'success', text: 'asked the side question' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('side reply') })
    expect(tree.terminal.output).toContain('› hello side')
    // The pane frames itself and splices into the editor: the in-border
    // title, the close hint, and the editor's top-left corner turn `├` —
    // the `╭` is replaced by the splice while the pane is connected.
    expect(tree.terminal.output).toContain(' BTW ')
    expect(tree.terminal.output).toContain('Esc close')
    expect(tree.terminal.output).toContain(`${EDITOR_BORDER_SGR}├`)
    // The exchange ran on the side agent: one model request, the main agent
    // untouched.
    expect(tree.adapter.requests).toHaveLength(1)

    // Enter while the pane is up continues the side conversation: the text
    // reaches the SAME side agent as a second turn, never the main agent.
    typeLine(tree.terminal, 'follow up?')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('› follow up?') })
    expect(tree.adapter.requests).toHaveLength(2)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('side reply') })

    // Escape (routed through the editor chain while the pane is up) closes
    // it; the editor's rounded corner comes back.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${EDITOR_BORDER_SGR}╭`) })
    expect(await fullFrame(tree.terminal)).not.toContain('› hello side')
    expect(await fullFrame(tree.terminal)).not.toContain(`${EDITOR_BORDER_SGR}├`)

    // The pane reopened via /btw dismisses through the bare command too.
    await expect(executeCommand(tree, agent, '/btw hello again'))
      .resolves.toEqual({ kind: 'success', text: 'asked the side question' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${EDITOR_BORDER_SGR}├`) })
    await expect(executeCommand(tree, agent, '/btw'))
      .resolves.toEqual({ kind: 'success', text: 'dismissed the side question' })
    expect(await fullFrame(tree.terminal)).not.toContain('› hello again')
  })

  it('remembers a session-scoped approval: the next request for the tool skips the overlay', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    const request: ApprovalRequest = { agent, toolName: 'bash' }
    const first = tree.ctx.waterfall('approval/request', request, fallback)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Approve bash?') })
    const menu = tree.terminal.output
    expect(menu).toContain('Allow once')
    expect(menu).toContain('Allow bash for this session')
    expect(menu).toContain('Reject')
    expect(menu).toContain('Reject with feedback')
    // Digit 2 direct-selects "Allow bash for this session".
    tree.terminal.sendInput('2')
    await expect(first).resolves.toBe('allowed-once')
    expect(fallback).not.toHaveBeenCalled()
    // The session allowance short-circuits the prompt: no overlay renders.
    const before = tree.terminal.written.length
    const second = tree.ctx.waterfall('approval/request', { agent, toolName: 'bash' }, fallback)
    await expect(second).resolves.toBe('allowed-once')
    await waitForRender()
    expect(tree.terminal.written.slice(before).join('')).not.toContain('Approve bash?')
  })

  it('answers a two-question user request through one tabbed overlay', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    const answer = tree.ctx.userQuestions.ask({
      questions: [
        { id: 'q1', question: 'First question?', header: 'ONE', options: [{ label: 'alpha' }, { label: 'beta' }] },
        { id: 'q2', question: 'Second question?', header: 'TWO', options: [{ label: 'gamma' }, { label: 'delta' }] },
      ],
    })
    // One overlay carries the whole request: the tab row shows both headers.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('First question?') })
    expect(tree.terminal.output).toContain('ONE')
    expect(tree.terminal.output).toContain('TWO')
    // Tab switches to the second question; Enter confirms its focused option,
    // then the overlay returns to the first (still unanswered) question.
    tree.terminal.sendInput('\t')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Second question?') })
    tree.terminal.sendInput('\r')
    tree.terminal.sendInput('\r')
    await expect(answer).resolves.toEqual({
      answers: [
        { id: 'q1', selected: ['alpha'] },
        { id: 'q2', selected: ['gamma'] },
      ],
    })
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
