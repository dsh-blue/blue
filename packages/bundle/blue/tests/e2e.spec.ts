/**
 * Whole-tree E2E for the Blue bundle: every Blue plugin row boots through the
 * real Loader from a temp cordis.yml (mirroring cordis.patch.yml's insert
 * rows), the command line arrives through `provideCmdline`, the agent spine
 * is the REAL registry + agent loop driven by a scripted mock LLM adapter
 * (agent-loop-testkit), and the terminal is core's recording FakeTerminal so
 * input is simulated and rendered output asserted. Only the model and the
 * process terminal are substituted.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import { homedir} from 'node:os'
import { basename, join} from 'node:path'
import { afterEach, describe, expect, it, vi} from 'vitest'
import type { Agent} from '@deepseek-ai/dsh-agent'
import { createServer} from 'node:http'
import type { StreamChunk} from '@deepseek-ai/dsh-llm'
import { createUserMessage} from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome, ApprovalRequest} from '@deepseek-ai/dsh-user-approval'
import type { BluePluginApi } from '../../../api/src/contracts.ts'
// The theme modules come from the package subpaths — not relative core
// source paths — because the /theme swap keys registry runtimes by apply
// callback identity: only the module instance interaction's theme-switch
// statically imports (this same lib file) shares a registry record with the
// baseline provider fiber it replaces.
import * as themeDarkPlugin from '@dsh-blue/blue-core/theme-dark'
import * as themeLightPlugin from '@dsh-blue/blue-core/theme-light'
import { FakeTerminal, waitForRender} from '../../../core/tests/fake-terminal.ts'
import { userInvocableSkills} from '../../../interaction/src/skills-catalog.ts'
import * as editorPlusPlugin from '../../../interaction/src/editor-plus.ts'
import { setClipboardImageReader} from '../../../interaction/src/paste-image.ts'
import { setClipboardOsc52Emitter, setClipboardTextWriter} from '../../../interaction/src/clipboard-write.ts'
import { setExternalEditorLauncher} from '../../../interaction/src/external-editor.ts'
import { BLUE_VERSION} from '../../../transcript/src/banner-content.ts'
import { MOON_SPINNER_FRAMES} from '../../../transcript/src/spinners.ts'
import * as statusCwdPlugin from '../../../transcript/src/status-cwd.ts'
import * as statusGitPlugin from '../../../transcript/src/status-git.ts'
import { reasoningResponse, textResponse, toolCallResponse} from './mock-adapter.ts'
// The wizard's models.dev lookup stays offline in the e2e (the fixture
// gateways carry their own metadata paths).
import { setModelsDevLoader} from '../../../interaction/src/models-dev.ts'
import { mkdtempTracked} from '../../../core/tests/temp-dir.ts'

// The boot infrastructure (bootBlue, helpers, module reset) lives in
// e2e-boot.ts, shared with the VT snapshot spec.
import { bootBlue, currentAgent, typeLine, executeCommand, resetBlueModuleState, disposers, twoToolCallsResponse} from './e2e-boot.ts'


/** The idle editor frame's border SGR: dark palette `border` #5a5a5a (S11). */
const EDITOR_BORDER_SGR = '\x1b[38;2;90;90;90m'

/** The footer's inter-slot gap, in columns (the S15 two-space join). */
const FOOTER_GAP = 2

/**
 * The S15 footer's greyscale tiers (dark palette): the model and the
 * context percentage carry the full `text` #e0e0e0, the cwd, the git badge,
 * and the session title the `muted` #888888 — the kimi footer's visual
 * hierarchy (the tips tier retired with the S30 footer swap).
 */
const FOOTER_TEXT_SGR = '\x1b[38;2;224;224;224m'
const FOOTER_MUTED_SGR = '\x1b[38;2;136;136;136m'

/**
 * Whether a frame of the activity-pane spinner shows in `text`. Frames are
 * two columns wide and cycle, so a snapshot may catch any of them; the
 * ripple is only present while the spinner is live.
 */
function hasSpinnerFrame(text: string): boolean {
  return MOON_SPINNER_FRAMES.some(frame => text.includes(frame))
}

/**
 * Strip every escape flavor the renderer emits (SGR runs, CSI modes, OSC 8
 * hyperlinks, stray controls) so footer-row assertions see plain text.
 */
function stripSgr(row: string): string {
  return row
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\u0007]*\u0007/g, '')
    .replace(/[\u0000-\u001f]/g, '')
}

/**
 * Remove the checkout directory's basename from a frame: the banner and
 * the status-cwd footer entry paint the session cwd, and a worktree named
 * after the feature under test can carry the very words an absence
 * assertion looks for (a `…-plan…` checkout would fake a plan badge).
 */
function stripCwdName(text: string): string {
  const name = basename(process.cwd())
  return name.length === 0 ? text : text.replaceAll(name, '')
}

afterEach(async () => {
  await resetBlueModuleState()
})

/** A local endpoint answering `GET …/models` with the OpenAI list shape. */
async function startModelServer(models: { id: string }[]): Promise<{ url: string, close(): Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url !== undefined && request.url.endsWith('/models')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ object: 'list', data: models.map(model => ({ id: model.id, object: 'model' })) }))
      return
    }
    response.statusCode = 404
    response.end('{}')
  })
  // Await the binding: reading address() before `listening` yields port 0.
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
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

setModelsDevLoader(() => Promise.resolve(undefined))

describe('blue whole-tree e2e', () => {
  it('boots the tree and publishes the renderer-neutral current-session snapshot', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    expect(tree.sessionChanges).toEqual([agent])
    // The input editor mounted and the tree is idle, nothing rendered away.
    expect(tree.exits).toEqual([])
    expect(tree.creativeIsolation.blueScreen === undefined).toBe(true)
    expect(tree.creativeIsolation.commands === undefined).toBe(true)
    expect(tree.creativeIsolation.bluePluginHost !== undefined).toBe(true)
    expect(tree.creativeIsolation.tools !== undefined).toBe(true)
  })

  it('hot-mounts additive public dock, status, command, and notification contributions', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    let api: BluePluginApi | undefined
    const fiber = tree.ctx.plugin({
      name: 'e2e-public-plugin',
      inject: ['bluePluginHost'],
      apply(pluginCtx) {
        const opened = pluginCtx.bluePluginHost.open(pluginCtx, {
          id: '@acme/e2e-public-plugin',
          api: '^1.0.0',
          capabilities: ['dock', 'status', 'commands', 'notifications'],
        })
        if (!opened.ok) throw new Error(opened.message)
        api = opened.value
        const dock = api.dock!.register({ id: 'creative-dock', view: { kind: 'text', content: 'creative dock live' } })
        const status = api.status!.register({ id: 'creative-status', render: () => ({ kind: 'text', content: 'creative status' }) })
        const command = api.commands!.register({ id: 'creative', label: 'Run the creative command', execute: async () => ({ ok: true, value: undefined }) })
        if (!dock.ok || !status.ok || !command.ok) throw new Error('public contribution registration failed')
      },
    })
    await fiber.await()
    await waitForRender()
    const mounted = stripSgr(await fullFrame(tree.terminal))
    expect(mounted).toContain('creative dock live')
    expect(mounted).toContain('creative status')
    await expect(executeCommand(tree, agent, '/creative')).resolves.toEqual({ kind: 'success' })
    expect(api!.notifications!.publish({ id: 'creative-notice', tone: 'success', view: { kind: 'text', content: 'creative notice' } })).toEqual({ ok: true, value: undefined })
    expect(stripSgr(await fullFrame(tree.terminal))).toContain('creative notice')

    await fiber.dispose()
    await waitForRender()
    const unloaded = stripSgr(await fullFrame(tree.terminal))
    expect(unloaded).not.toContain('creative dock live')
    expect(unloaded).not.toContain('creative status')
    await expect(executeCommand(tree, agent, '/creative')).resolves.toBeUndefined()
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

  it('replays and drives the official conversation model without duplicating the legacy transcript', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-official-transcript-')
    const first = await bootBlue(['official replay question'], {
      script: [textResponse('official replay answer')],
      persistenceRoot: root,
      officialTranscript: true,
    })
    const firstAgent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await firstAgent.whenIdle()
    const id = String(firstAgent.session.id)
    await first.ctx.sessions.flush(firstAgent.session)
    await first.ctx.fiber.dispose()

    const resumed = await bootBlue(['--resume', id], {
      script: [textResponse('official live answer')],
      persistenceRoot: root,
      officialTranscript: true,
    })
    const resumedAgent = await currentAgent(resumed)
    await vi.waitFor(async () => {
      const model = resumed.ctx.blueTranscriptModels.list().find(entry => entry.id === 'official-conversation')
      expect(model?.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'transcript-user', text: 'official replay question' }),
        expect.objectContaining({ kind: 'transcript-assistant', text: 'official replay answer' }),
      ]))
    })

    typeLine(resumed.terminal, 'official live question')
    await vi.waitFor(() => { expect(resumed.adapter.requests).toHaveLength(1) })
    await resumedAgent.whenIdle()
    await vi.waitFor(async () => {
      const model = resumed.ctx.blueTranscriptModels.list().find(entry => entry.id === 'official-conversation')
      expect(model?.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'transcript-assistant', text: 'official replay answer' }),
        expect.objectContaining({ kind: 'transcript-user', text: 'official live question' }),
        expect.objectContaining({ kind: 'transcript-assistant', text: 'official live answer' }),
      ]))
    })

    const officialEntry = [...resumed.ctx.loader.entries()]
      .find(entry => entry.options.id === 'blue-transcript-official')
    expect(officialEntry).toBeDefined()
    await resumed.ctx.loader.update(officialEntry!.id, { disabled: true })
    await resumed.ctx.loader.await()
    expect(resumed.ctx.blueTranscriptModels.list().some(entry => entry.id === 'official-conversation')).toBe(false)
    const conversationEntry = [...resumed.ctx.loader.entries()]
      .find(entry => entry.options.id === 'blue-conversation')
    expect(conversationEntry).toBeDefined()
    await resumed.ctx.loader.update(conversationEntry!.id, { disabled: true })
    await resumed.ctx.loader.await()
    await vi.waitFor(() => {
      expect(resumed.ctx.get('blueConversationProjection')).toBeUndefined()
      expect(resumed.ctx.sessionProjections.snapshot(resumedAgent.session).values.blueConversation).toBeUndefined()
    })
  })

  it('renders the welcome banner at boot as the first scroll child', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    const output = tree.terminal.output
    expect(output).toContain('Welcome to Blue!')
    expect(output).toContain('Send /help for help information.')
    // AgentDefaultModelConfig mounts provider/model 'mock'; the banner
    // snapshots the selection at mount.
    expect(output).toContain('mock · mock')
    // The info rows paint the muted label and the value as separate SGR
    // runs, so the joined row is asserted on the stripped frame.
    expect(stripSgr(output)).toContain('Directory: ')
    expect(stripSgr(output)).toContain(`Version:   ${BLUE_VERSION}`)
    // The banner renders before any transcript content.
    expect(output.indexOf('Welcome to Blue!')).toBeLessThan(output.indexOf('Blue online.'))
  })

  it('fills the full width on wide terminals with the banner still above the transcript', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await waitForRender()
    tree.terminal.resize(120, tree.terminal.rows)
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('Welcome to Blue!')
    expect(frame).toContain('Send /help for help information.')
    // The banner is frameless: the whale logo block sits left and the
    // status column beside it, so the welcome row is content-width — it
    // never bleeds to the full viewport (no box frame, no cap).
    const bannerRow = frame.split('\r\n').find(row => row.includes('Welcome to Blue!')) ?? ''
    const plain = bannerRow
      // Strip every escape flavor the renderer emits: SGR runs, CSI
      // modes (?2031h ...), OSC 8 hyperlink tails, and stray controls.
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\u0007]*\u0007/g, '')
      .replace(/[\u0000-\u001f]/g, '')
    // fullFrame bumps the width by one to force the repaint; the welcome
    // row now stays within it rather than spanning it.
    expect(plain.trimEnd().length).toBeLessThanOrEqual(tree.terminal.columns)
    expect(plain.trimEnd().length).toBeGreaterThan(0)
    expect(frame.indexOf('Welcome to Blue!')).toBeLessThan(frame.indexOf('Blue online.'))
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
    const bannerAt = rows.findIndex(row => row.includes('Welcome to Blue!'))
    const footerAt = rows.findIndex(row => row.includes(`${FOOTER_TEXT_SGR}mock`))
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
      // The locator strips every ANSI control sequence, not just SGR: OSC 8
      // hyperlink tails survive an SGR-only strip, and a late dock repaint
      // (e.g. the git badge resolving on a slow big-diff checkout) re-emits
      // rows behind an erase-line `\x1b[2K` prefix. The assertion wants the
      // row's true color, which interleaves INSIDE the code, so only the
      // transport wrappers may go.
      const bare = row.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\]8;;\x07/g, '').trim()
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

  it('Esc retracts a tool-free thinking turn into the editor with no tombstone or ghost', async () => {
    const tree = await bootBlue([], { script: ['hang-reasoning', reasoningResponse('second thought', 'done')] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'first')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('pondering the question at hand') })
    tree.terminal.sendInput('\x1b')
    await agent.whenIdle()
    await vi.waitFor(async () => {
      const frame = await fullFrame(tree.terminal)
      expect(frame.includes('■ interrupted')).toBe(false)
      expect(frame.includes('thinking...')).toBe(false)
      expect(frame.includes('pondering the question at hand')).toBe(false)
      expect(frame.includes('first')).toBe(true)
    })
    expect(agent.session.deriveMessages()).toEqual([])

    // The restored draft owns the next Escape; clear it, then submit a
    // genuinely new turn. The withdrawn thinking must never return.
    tree.terminal.sendInput('\x1b')
    typeLine(tree.terminal, 'second')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    await agent.whenIdle()
    await vi.waitFor(async () => {
      expect((await fullFrame(tree.terminal)).includes('thinking...')).toBe(false)
    })
    const frame = await fullFrame(tree.terminal)
    expect(frame).not.toContain('pondering the question at hand')
    expect(frame).toContain('second thought')
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

  it('Ctrl-O toggles a tool result between the collapsed preview and the full output', async () => {
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
    // Collapsed (the default): the S20 kimi card header (✓ mark, Used verb,
    // bold name, lines chip), the 3-row preview, and the expand hint; the
    // tail of the full output does not.
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('long-output')
    expect(tree.terminal.output).toContain('long-output')
    expect(tree.terminal.output).not.toContain('TAILMARKER')
    const beforeToggle = tree.terminal.written.length
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    const expanded = tree.terminal.written.slice(beforeToggle).join('')
    expect(expanded).toContain('TAILMARKER')
  })

  it('renders a diff-intent tool through the DiffCard: kimi header, chip, and +/- rows', async () => {
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
    typeLine(tree.terminal, 'edit the file')
    await agent.whenIdle()
    await waitForRender()
    // Compare against SGR-stripped output so marker/text adjacency survives
    // the separate color spans ('-' marker + removed text, '+' + added).
    // The S20 kimi header carries the verb, tool name, and the +A -R chip;
    // the per-file title/path lines are gone (the path belongs to the key
    // argument, absent here because the scripted call carries no args).
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('a.ts')
    expect(shown).toContain('- two')
    expect(shown).toContain('+ TWO')
    expect(shown).toContain('+ four')
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
    typeLine(tree.terminal, 'list files')
    await agent.whenIdle()
    await waitForRender()
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('ls -la')
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
    const attachmentRoot = mkdtempTracked('dsh-blue-e2e-attachments-')
    process.env.DSH_BLUE_ATTACHMENT_DIR = attachmentRoot
    // A 1×1 PNG (the shared literal shape with core's and interaction's
    // suites).
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
      0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
      0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
    try {
      setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: png, mediaType: 'image/png' }))
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
      setClipboardImageReader(() => Promise.resolve({ kind: 'image', data: png, mediaType: 'image/jpeg' }))
      tree.terminal.sendInput('\x16')
      await vi.waitFor(() => {
        expect(tree.terminal.output).toContain('image rejected: declared image/jpeg but the bytes sniff as image/png')
      })
      const files = readdirSync(attachmentRoot)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/\.png$/)
      expect(new Uint8Array(readFileSync(join(attachmentRoot, files[0]!)))).toEqual(png)
    } finally {
      setClipboardImageReader(undefined)
      if (previousDir === undefined) delete process.env.DSH_BLUE_ATTACHMENT_DIR
      else process.env.DSH_BLUE_ATTACHMENT_DIR = previousDir
    }
  })

  it.skip('folds earlier in-turn steps into the summary line once the next step starts', async () => {
    // Retention 0 pins the folding mechanism itself (each step/start folds
    // the previous step); the default 30-step window gets its own case below.
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
    expect(shown).toContain('… step 1 · call 1 tools')
    expect(shown).toContain('… step 2 · call 1 tools')
    expect(shown).toContain('done')
  })

  it('groups two same-step Reads into one tree card that hides file content', async () => {
    // One request carrying both tool calls keeps them in one agent-loop
    // step (the grouping unit); the second request's text starts the next
    // step, which — under the default retention — leaves the group mounted.
    const tree = await bootBlue([], {
      script: [
        twoToolCallsResponse(
          { callId: 'call-r1', name: 'read', args: { file_path: 'src/a.ts' } },
          { callId: 'call-r2', name: 'read', args: { file_path: 'src/b.ts' } },
        ),
        textResponse('read done'),
      ],
    })
    const agent = await currentAgent(tree)
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'read',
      description: 'read a file',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }),
      presentResult: (args: unknown) => ({
        card: 'read',
        path: (args as { file_path: string }).file_path,
        offset: 1,
        lines: [
          { number: 1, text: 'first line of the file' },
          { number: 2, text: 'second line of the file' },
        ],
        totalLines: 2,
      }),
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'l1\nl2\nl3' }],
      },
      execute: () => Promise.resolve('l1\nl2\nl3'),
    })
    typeLine(tree.terminal, 'read the files')
    await agent.whenIdle()
    await waitForRender()
    expect(tree.adapter.requests.length).toBe(2)
    const strip = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')
    const shown = strip(tree.terminal.output)
    // Collapsed: the by-file tree with per-window ranges — never the content.
    expect(shown).toContain('Read 2 files')
    expect(shown).toContain('├─ src/a.ts · 1-2')
    expect(shown).toContain('└─ src/b.ts · 1-2')
    expect(shown).not.toContain('second line of the file')
    expect(shown).toContain('read done')
    // Ctrl-O expands the group's bounded previews with file line numbers.
    tree.terminal.sendInput('\x0f')
    await waitForRender()
    const expanded = strip(tree.terminal.written.join(''))
    expect(expanded).toContain('1  first line of the file')
  })

  it('breaks read groups on other tools while grouping across thinking', async () => {
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-r1', 'read', { file_path: 'src/a.ts' }),
        toolCallResponse('call-sh', 'bash', { command: 'ls' }),
        toolCallResponse('call-r2', 'read', { file_path: 'src/b.ts' }),
        textResponse('done'),
      ],
    })
    const agent = await currentAgent(tree)
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'read',
      description: 'read a file',
      parameters: { type: 'object', properties: {} },
      presentCall: () => ({ card: 'generic', title: 'Read', kind: 'read' }),
      presentResult: (args: unknown) => ({
        card: 'read',
        path: (args as { file_path: string }).file_path,
        offset: 1,
        lines: [{ number: 1, text: 'one' }],
        totalLines: 1,
      }),
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'one' }] },
      execute: () => Promise.resolve('one'),
    })
    tools.register({
      name: 'bash',
      description: 'run a command',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'a.ts' }] },
      execute: () => Promise.resolve('a.ts'),
    })
    typeLine(tree.terminal, 'read between commands')
    await agent.whenIdle()
    await waitForRender()
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    // Two single-file groups, one per run, with the command card between.
    expect(shown.split('Read 1 file').length - 1).toBe(2)
    expect(shown).toContain('Ran a command')
    expect(shown).toContain('└─ src/a.ts · 1-1')
    expect(shown).toContain('└─ src/b.ts · 1-1')
  })

  it.skip('keeps a multi-step turn\'s tool cards expanded under the kimi 30-step retention', async () => {
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
    // The S20 dogfood alignment: within the default retention window every
    // step's card stays mounted — two `✓ Used probe` headers, no summary.
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown.split('✓ Used probe').length - 1).toBe(2)
    expect(shown).not.toContain('… step 1')
    expect(shown).toContain('done')
  })

  it('renders the baseline footer entry on the last rows below the editor', async () => {
    const tree = await bootBlue(['fix', 'the', 'build'], { script: [textResponse('Blue online.')] })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    // The model string comes from the scripted flow's durable request header
    // (the mock default model config is provider/model 'mock'), painted in
    // the footer's full text tier — S15's brightest footer color.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${FOOTER_TEXT_SGR}mock`) })
    // Position discipline: a width change forces a full clear-and-repaint
    // frame, so the last such chunk carries every row in screen order —
    // transcript reply, then the editor's rounded top border (the first
    // gray `border` #5a5a5a run; the idle frame is neutral since S11,
    // slash/bash contexts recolor it), then the footer pinned to the
    // terminal's last rows (the S12 kimi dock order).
    const footerAnchor = `${FOOTER_TEXT_SGR}mock`
    tree.terminal.resize(100, 30)
    let frame = ''
    await vi.waitFor(() => {
      frame = [...tree.terminal.written].reverse()
        .find(chunk => chunk.includes('\x1b[2J') && chunk.includes(footerAnchor)) ?? ''
      expect(frame).not.toBe('')
    })
    const reply = frame.indexOf('Blue online.')
    const footer = frame.indexOf(footerAnchor)
    const editorBorder = frame.indexOf(EDITOR_BORDER_SGR, reply)
    expect(reply).toBeGreaterThanOrEqual(0)
    expect(editorBorder).toBeGreaterThan(reply)
    expect(footer).toBeGreaterThan(editorBorder)
  })

  it('frames the editor in a rounded box with a prompt symbol and no persistent hint row', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    const frame = await fullFrame(tree.terminal)
    // The idle frame is the neutral gray rounded box: corners on both rules…
    expect(frame).toContain(`${EDITOR_BORDER_SGR}╭`)
    expect(frame).toContain(`${EDITOR_BORDER_SGR}╰`)
    // …a side bar on the content row with the bare `>` prompt in column 2
    // (no SGR between the bar's reset and the symbol).
    expect(frame).toContain(`${EDITOR_BORDER_SGR}│\x1b[39m > `)
    // The persistent key-affordance row retired with the S15 dogfood
    // verdict: no fragment of it survives below the box — the footer tips
    // carry the teaching instead.
    expect(frame).not.toContain('! bash · / commands')
    expect(frame).not.toContain('ctrl+c exit')
    expect(frame).not.toContain('ctrl+s steer')
  })

  it('recolors the frame for slash context with the dropdown boxed in the same frame', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('/')
    // The editor-plus provider resolves the command list asynchronously;
    // the dropdown rows appear once it settles.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/copy') })
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
    // same-color side bars — one frame, no bare rows in between. S14: the
    // wrapping list carries the argument hint joined into the description
    // (/copy anchors the S26-extended list inside the eight-row window;
    // /help now sits beyond the fold).
    const dropdownAt = frame.indexOf('/copy', bottomAt)
    expect(dropdownAt).toBeGreaterThan(bottomAt)
    const dropdownRowStart = frame.lastIndexOf(`${PRIMARY_SGR}│`, dropdownAt)
    expect(dropdownRowStart).toBeGreaterThan(bottomAt)
    expect(frame).toContain('<question> — Ask a side question in a forked session')
  })

  it('fuzzy-matches the slash prefix out of order and ranks the contiguous hit first', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // Shared draft stash hygiene: escape clears the buffer (closing any
    // dropdown left open), clearDrop drops the reload copy.
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('/se')
    // The dropdown's own rows — '/sessions' alone is ambiguous since the
    // S16 banner's tips column carries a /sessions line. Only the
    // preselected row carries the `→` pointer; /resume anchors by its
    // dropdown description.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('→ /sessions') })
    const fuzzy = await fullFrame(tree.terminal)
    // The contiguous /sessions hit ranks first (real pi-tui scoring, lower
    // is better) — and since the S24a merge /resume is an alias, so the
    // dropdown (canonical-only discovery) carries no second 'se' row.
    const sessionsAt = fuzzy.indexOf('→ /sessions')
    expect(sessionsAt).toBeGreaterThanOrEqual(0)
    expect(fuzzy).not.toContain('Resume a previous session')
    // An out-of-order subsequence still hits, and the misses are gone.
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('/ssns')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('→ /sessions') })
    const subseq = await fullFrame(tree.terminal)
    expect(subseq).toContain('→ /sessions')
    expect(subseq).not.toContain('Resume a previous session')
    expect(subseq).not.toContain('→ /new')
  })

  it('ghosts the argument hint after the cursor and bolds the leading slash token', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('/btw')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Ask a side question') })
    const frame = await fullFrame(tree.terminal)
    // The ghost: textMuted (#6b6b6b) with its lead space, starting right at
    // the end-of-buffer cursor cell (the dropdown's description row carries
    // no cursor, so the SGR adjacency is unique to the editor row).
    const GHOST_SGR = '\x1b[38;2;107;107;107m'
    expect(frame).toContain(`\x1b[7m \x1b[0m${GHOST_SGR} <question>`)
    // The leading slash token paints bold primary: `\x1b[1m` … `/btw` …
    // `\x1b[22m` around the primary SGR.
    const PRIMARY_SGR = '\x1b[38;2;79;168;255m'
    expect(frame).toContain(`\x1b[1m${PRIMARY_SGR}/btw`)
  })

  it('Enter on the slash dropdown accepts the fuzzy hit and submits it', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('/hel')
    // The dropdown row's own description — '/help' alone is ambiguous since
    // the S16 banner's tips column carries `/help: show commands`.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Show available commands') })
    // pi-tui's Enter-on-slash semantics: the preselected completion applies
    // first, then the line submits — the /help overlay is the command's own
    // observable effect. The generous timeout: this case sits early in a
    // long file and the boot-render cycle rides the throttled scheduler.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Commands') }, { timeout: 5000 })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(' help') })
  })

  it('wraps long dropdown descriptions onto a second line at narrow widths', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    // The dropdown renders inside the editor's content width — the frame
    // bars and the editor's own paddingX are both shaved off it — so a
    // 56-column terminal leaves the description column (31 wide) narrower
    // than /sessions' 42-char summary while still past the width-40 gate.
    tree.terminal.resize(56, 24)
    tree.terminal.sendInput('/sess')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/sessions') })
    const frame = await fullFrame(tree.terminal)
    const rows = frame.split('\r\n')
    // The dropdown row carries the side-bar-anchored two-line treatment
    // (the S14 hint-row discovery tier retired with D42 — the dropdown is
    // the only command catalog).
    const at = rows.findIndex(row => row.includes('→ /sessions'))
    expect(at).toBeGreaterThanOrEqual(0)
    // The continuation row carries the description tail in the description
    // column — the command column stays blank, so no slash token repeats.
    expect(rows[at + 1]).toContain('switch to one')
    expect(rows[at + 1]).not.toContain('/')
  })

  it('applies the bash triple on ! mode and restores the prompt frame on submit', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    // The draft stash is module state shared across this worker's cases; the
    // previous case leaves a '/' draft behind, and bash entry needs an empty
    // buffer (same clear as the queue-recall case).
    tree.terminal.sendInput('\x1b')
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

  it('keeps the footer model entry stable across a turn and an interrupt', async () => {
    // S15: the agent-status half of the old '{model} · {status}' entry is
    // gone — the running state lives in the activity spinner, and the footer
    // model text never flickers between turn states.
    const tree = await bootBlue([], { script: ['hang'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'long work')
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${FOOTER_TEXT_SGR}mock`) })
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain(`${FOOTER_TEXT_SGR}mock`)
  })

  it('renders a footer entry registered by a downstream plugin through StatusModel', async () => {
    const tree = await bootBlue([], { script: [], footerExtra: 'e2e-extra-entry' })
    await currentAgent(tree)
    // Widen first: at the default 80 columns the real checkout's git badge
    // (a dirty worktree carries large diff counts) can crowd a low-priority
    // left slot out of the band — the registry contract, not the entry, is
    // what this case pins.
    tree.terminal.resize(200, 24)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('e2e-extra-entry') })
  })

  it('renders the context footer entry from the assistant/message usage', async () => {
    // A scripted turn whose usage reports 4242 input-side tokens against the
    // adapter-advertised 8192-token window: the real agent loop logs the
    // usage as the assistant/message event and the request/context event
    // carries the window, so the entry formats 'context: 52% (4.1k/8k)' on
    // the 1024 base — right-aligned on the footer's second band.
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'usage reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'usage reply' } },
      { type: 'usage', usage: { inputTokens: 4242, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const tree = await bootBlue([], { script: [usageScript], contextWindow: 8192 })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'spend tokens')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await vi.waitFor(() => {
      expect(tree.terminal.output).toContain(`${FOOTER_TEXT_SGR}context: 52% (4.1k/8k)`)
    })
    // Band discipline: the percentage sits on its own footer row, flush
    // against the terminal's right edge.
    const frame = await fullFrame(tree.terminal)
    const row = frame.split('\r\n').find(line => line.includes('context: 52%'))
    expect(row).toBeDefined()
    expect(stripSgr(row!).trimEnd().endsWith('context: 52% (4.1k/8k)')).toBe(true)
  })

  it('renders the git footer entry through the injected command runner', async () => {
    // The e2e's session cwd is the repo checkout itself (app sets meta.cwd
    // from process.cwd()), so the real probe would return whatever branch
    // the checkout happens to be on; inject a fake runner for a
    // deterministic sentinel instead (same module instance the mounted
    // plugin delegates to) — branch ahead 2 with one modified file, so the
    // full S15 badge composes: diff counts plus the sync markers, in the
    // muted tier.
    statusGitPlugin.setGitCommandRunner((args) => {
      if (args[0] === 'branch') return 'e2e-branch'
      if (args[0] === 'status') return '## e2e-branch...origin/e2e-branch [ahead 2]\n M wip.ts\n'
      if (args[0] === 'diff') return '7\t2\tsrc/wip.ts\n'
      return null
    })
    try {
      const tree = await bootBlue([], { script: [] })
      await currentAgent(tree)
      await vi.waitFor(() => {
        expect(tree.terminal.output).toContain(`${FOOTER_MUTED_SGR}e2e-branch [+7 -2 ↑2]`)
      })
    } finally {
      statusGitPlugin.setGitCommandRunner(undefined)
    }
  })

  it('lays out the footer bands: tiered left slots, the session title flush right', async () => {
    // The S15 kimi identity end to end: band 1 carries the model in the full
    // text tier, then the abbreviated cwd and the git badge in muted — each
    // slot separated by exactly two spaces — with the folded session title
    // (the retired tips slot) right-aligned in the same muted tier against
    // the terminal edge.
    statusGitPlugin.setGitCommandRunner((args) => {
      if (args[0] === 'branch') return 'e2e-branch'
      if (args[0] === 'status') return '## e2e-branch...origin/e2e-branch [ahead 2]\n M wip.ts\n'
      if (args[0] === 'diff') return '7\t2\tsrc/wip.ts\n'
      return null
    })
    try {
      const tree = await bootBlue([], { script: [] })
      const agent = await currentAgent(tree)
      agent.session.append('session/title', { title: 'fix the login timeout' })
      // Wide enough that every slot and the title fit: the layout, not the
      // yield, is under test here.
      tree.terminal.resize(200, 24)
      await vi.waitFor(() => {
        expect(tree.terminal.output).toContain(`${FOOTER_MUTED_SGR}e2e-branch [+7 -2 ↑2]`)
      })
      const frame = await fullFrame(tree.terminal)
      const row = frame.split('\r\n').find(line => line.includes('e2e-branch'))
      expect(row).toBeDefined()
      // Tier anchors: the model leads in text #e0e0e0, the cwd, badge, and
      // title paint muted #888888.
      expect(row!).toContain(`${FOOTER_TEXT_SGR}mock`)
      expect(row!).toContain(`${FOOTER_MUTED_SGR}e2e-branch [+7 -2 ↑2]`)
      // Slot order and the two-space joins, against the same abbreviation
      // the cwd entry derives from this process's working directory.
      const cwdLabel = statusCwdPlugin.shortenCwd(process.cwd(), homedir())
      const plain = stripSgr(row!).trimStart()
      expect(plain.startsWith(`mock  ${cwdLabel}  e2e-branch [+7 -2 ↑2]`)).toBe(true)
      // The title is the right cluster: whatever the width, it ends the row.
      expect(plain.trimEnd().endsWith('fix the login timeout')).toBe(true)
    } finally {
      statusGitPlugin.setGitCommandRunner(undefined)
    }
  })

  it('truncates the right cluster to its budget before the left cluster yields', async () => {
    // Narrow the terminal so the right cluster's budget (width − left
    // cluster − gap) covers only part of the title: the title truncates to
    // that budget — the entry's own discipline — while the left cluster
    // keeps its full content, model through git badge. (The tips entry this
    // case covered before the S30 footer swap hid entirely under pressure;
    // the title entry truncates instead.)
    statusGitPlugin.setGitCommandRunner((args) => {
      if (args[0] === 'branch') return 'e2e-branch'
      if (args[0] === 'status') return '## e2e-branch\n'
      return null
    })
    try {
      const tree = await bootBlue([], { script: [] })
      const agent = await currentAgent(tree)
      agent.session.append('session/title', { title: 'fix the login timeout' })
      const cwdLabel = statusCwdPlugin.shortenCwd(process.cwd(), homedir())
      const leftCluster = `mock  ${cwdLabel}  e2e-branch`.length
      // A right-cluster budget of 8 columns in the frame, computed off the
      // same cwd abbreviation the entry derives, so the boundary holds in
      // any checkout. fullFrame forces its repaint by bumping the width one
      // column, so the resize lands one short of the frame's budget.
      const budget = 8
      tree.terminal.resize(leftCluster + FOOTER_GAP + budget - 1, 24)
      const frame = await fullFrame(tree.terminal)
      const row = frame.split('\r\n').find(line => line.includes('e2e-branch'))
      expect(row).toBeDefined()
      const plain = stripSgr(row!)
      expect(plain.trim().startsWith(`mock  ${cwdLabel}  e2e-branch`)).toBe(true)
      // pi-tui's truncateToWidth cuts at word boundaries: an 8-column
      // budget keeps only 'fix' plus the 3-column ellipsis.
      expect(plain.trimEnd().endsWith('fix...')).toBe(true)
      expect(plain).not.toContain('login timeout')
    } finally {
      statusGitPlugin.setGitCommandRunner(undefined)
    }
  })

  it('re-derives the title on every human message past the first (D41 bridge)', async () => {
    // The harness service's all-prompts cadence cannot schedule itself
    // against this agent-loop event order (step/start precedes the turn's
    // user/message, so the onMainRequest boundary gate always rejects the
    // message that opened the turn); the blue-session-title-cadence bridge
    // drives the public refresh instead. The first message stays with the
    // service's own header path — no refresh before a request header
    // exists (a header-less refresh would fail for lack of a route and
    // supersede that path's pending work).
    const tree = await bootBlue([], { script: [textResponse('first answer'), textResponse('second answer')] })
    const agent = await currentAgent(tree)
    const refreshes = () =>
      (globalThis as unknown as { __blueE2E: { sessionTitleRefreshes: string[] } }).__blueE2E.sessionTitleRefreshes
    typeLine(tree.terminal, 'first prompt')
    await agent.whenIdle()
    expect(refreshes()).toEqual([])
    typeLine(tree.terminal, 'second prompt')
    await agent.whenIdle()
    await vi.waitFor(() => {
      expect(refreshes()).toEqual([agent.session.id])
    })
  })

  it('renders nothing for injected runtime context — only human input folds (D28)', async () => {
    const tree = await bootBlue([], { script: [textResponse('plain answer')] })
    const agent = await currentAgent(tree)
    // The harness injects context as synthetic user/message events with a
    // plugin source; the fold hides them outright (zero presentation, zero
    // placeholder — the S19 rule pulled into the S17 dogfood).
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'RUNTIME-CONTEXT-SECRET' }],
      source: { kind: 'plugin', plugin: 'agent-context', form: 'snapshot', sections: [] },
    }), { surfaceOp: 'append' })
    typeLine(tree.terminal, 'visible prompt')
    await agent.whenIdle()
    await waitForRender()
    expect(tree.terminal.output).toContain('visible prompt')
    expect(tree.terminal.output).toContain('plain answer')
    expect(tree.terminal.output).not.toContain('RUNTIME-CONTEXT-SECRET')
  })

  it('resumes a persisted session: history renders from the snapshot, no replay needed', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-sessions-')
    // The persisted turn carries visible reasoning: the resumed thinking
    // block renders finalized (D16 — replay converges with the live fold),
    // never the live spinner label.
    const first = await bootBlue(['remember this'], {
      script: [reasoningResponse(
        ['first we consider the input,', 'then we weigh alternatives,', 'finally we decide.'].join('\n'),
        'phase one answer',
      )],
      persistenceRoot: root,
    })
    const firstAgent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await firstAgent.whenIdle()
    // A persisted synthetic injection stays hidden on replay too (D16: the
    // snapshot shares the live fold's rules).
    firstAgent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'PERSISTED-CONTEXT-SECRET' }],
      source: { kind: 'plugin', plugin: 'agent-context' },
    }), { surfaceOp: 'append' })
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
    // Finalized thinking: the bullet above the folded preview and the
    // expansion hint — and no live `thinking...` row anywhere.
    expect(stripSgr(output)).toContain('● first we consider the input,')
    expect(output).toContain('more lines, ctrl+o to expand')
    expect(output).not.toContain('thinking...')
    // The persisted synthetic injection stayed hidden (D16 snapshot rule).
    expect(output).not.toContain('PERSISTED-CONTEXT-SECRET')
  })

  it('/export writes the folded session to a Markdown file through the raw artifact', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-export-')
    const tree = await bootBlue(['export me this'], {
      script: [textResponse('exported answer')],
      persistenceRoot: root,
    })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    const target = join(root, 'session.md')
    const result = await executeCommand(tree, agent, `/export ${target}`)
    expect(result).toEqual({ kind: 'success' })
    const markdown = readFileSync(target, 'utf8')
    expect(markdown).toContain('# Blue Session Export')
    expect(markdown).toContain('export me this')
    expect(markdown).toContain('exported answer')
    expect(markdown).toContain(`session_id: ${String(agent.id)}`)
    // The full mode exports the event-stream view beside it.
    const fullTarget = join(root, 'session-full.md')
    const fullResult = await executeCommand(tree, agent, `/export full ${fullTarget}`)
    expect(fullResult).toEqual({ kind: 'success' })
    const fullMarkdown = readFileSync(fullTarget, 'utf8')
    expect(fullMarkdown).toContain('# Blue Session Export (full)')
    expect(fullMarkdown).toContain('event_count:')
    expect(fullMarkdown).toContain('#### user (user)')
    expect(fullMarkdown).toContain('#### assistant')
  })

  it('/copy pushes the last assistant message through the clipboard pipeline', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-copy-')
    const captured: string[] = []
    setClipboardTextWriter(async text => {
      captured.push(text)
    })
    // Keep the osc52 leg injected-false for the native pass: the default
    // would write the escape to the test runner's stdout.
    setClipboardOsc52Emitter(() => false)
    try {
      const tree = await bootBlue(['copy this'], {
        script: [textResponse('the answer to copy')],
        persistenceRoot: root,
      })
      const agent = await currentAgent(tree)
      await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
      await agent.whenIdle()
      const result = await executeCommand(tree, agent, '/copy')
      expect(result).toEqual({ kind: 'success' })
      expect(captured).toEqual(['the answer to copy'])
      await vi.waitFor(() => {
        expect(tree.terminal.output).toContain('copied the last assistant message')
      })
      // The SSH fallback: every platform tool fails, the OSC 52 escape went
      // out — the copy still succeeds with the unverified report.
      const osc52: string[] = []
      setClipboardTextWriter(async () => {
        throw new Error('no clipboard tool is available (wl-copy not installed, xclip not installed)')
      })
      setClipboardOsc52Emitter(text => {
        osc52.push(text)
        return true
      })
      const fallback = await executeCommand(tree, agent, '/copy')
      expect(fallback).toEqual({ kind: 'success' })
      expect(osc52).toEqual(['the answer to copy'])
      await vi.waitFor(() => {
        expect(tree.terminal.output).toContain('copied via terminal escape sequence (unverified')
      })
    } finally {
      setClipboardTextWriter(undefined)
      setClipboardOsc52Emitter(undefined)
    }
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
      // (light #0969da, the primary anchor).
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
      // carries the light roleUser bullet (#2e3fb8), not dark's #f0c674 —
      // bold-wrapped per the S18 kimi user chrome.
      await vi.waitFor(() => {
        const rendered = tree.terminal.written.slice(beforeSwitch).join('')
        expect(rendered).toContain('show palette')
        expect(rendered).toContain('palette reply')
        expect(rendered).toContain('\x1b[1m\x1b[38;2;46;63;184m» ')
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
        expect(rendered).toContain('Welcome to Blue!')
        expect(rendered).toContain('palette reply')
        expect(rendered.indexOf('Welcome to Blue!')).toBeLessThan(rendered.indexOf('palette reply'))
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

  it('shows the moon spinner while the agent runs and drops it when the turn ends', async () => {
    const tree = await bootBlue([], { script: ['hang-silent'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'long work')
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('· Tip: ') })
    const running = await fullFrame(tree.terminal)
    expect(hasSpinnerFrame(running)).toBe(true)
    // Dock order (S12): the footer pins to the terminal's last rows, the
    // editor sits above it, and the spinner above the editor (the first
    // gray `border` frame run at or after the spinner — the idle editor
    // frame is neutral since S11).
    const footerAt = running.indexOf(`${FOOTER_TEXT_SGR}mock`)
    const spinnerAt = running.indexOf('· Tip: ')
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(spinnerAt).toBeGreaterThanOrEqual(0)
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    const idle = await fullFrame(tree.terminal)
    expect(hasSpinnerFrame(idle)).toBe(false)
    expect(idle).not.toContain('· Tip: ')
  })

  it('shows the kimi working row while composing — frame, label, and tip', async () => {
    // 'hang' streams text then parks: the phase is composing and the pane
    // shows the kimi row — its assistant block has no cursor, so the pane
    // spinner is the composing signal (full parity restored by the user's
    // second dogfood ruling).
    const tree = await bootBlue([], { script: ['hang'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'stream it')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('working...') })
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('working...')
    expect(frame).toContain('· Tip: ')
    expect(hasSpinnerFrame(frame)).toBe(false)
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
  })

  it('rides the mode machine: moon while waiting, empty pane while thinking', async () => {
    // 'hang-silent' parks the stream before any delta: the pane shows the
    // moon spinner with a teaching tip, not the composing row.
    const tree = await bootBlue([], { script: ['hang-silent'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'slow work')
    await vi.waitFor(() => { expect(agent.status).toBe('running') })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('· Tip: ') })
    const waiting = await fullFrame(tree.terminal)
    expect(hasSpinnerFrame(waiting)).toBe(true)
    expect(waiting).not.toContain('working...')
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
  })

  it('streams a live thinking block with the tail window while the activity pane empties', async () => {
    // 'hang-reasoning' streams reasoning then parks: the thinking block
    // owns the spinner and the pane stands down.
    const tree = await bootBlue([], { script: ['hang-reasoning'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'ponder')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('thinking...') })
    const thinking = await fullFrame(tree.terminal)
    expect(thinking).toContain('pondering the question at hand')
    expect(thinking).not.toContain('working...')
    expect(thinking).not.toContain('· Tip: ')
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
  })

  it('finalizes the thinking block in place with the folded preview, expanded by ctrl+o', async () => {
    const reasoning = [
      'the first consideration spans the opening line,',
      'the second lands on the middle line,',
      'the third occupies the closing line,',
      'and a fourth line guarantees the fold.',
    ].join('\n')
    const tree = await bootBlue([], { script: [reasoningResponse(reasoning, 'the answer')] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'think it through')
    await agent.whenIdle()
    await waitForRender()
    // Finalized in place: the bullet over the folded preview plus the hint.
    expect(stripSgr(tree.terminal.output)).toContain('● the first consideration spans the opening line,')
    expect(tree.terminal.output).toContain('more lines, ctrl+o to expand')
    expect(tree.terminal.output).not.toContain('and a fourth line guarantees the fold.')
    // Ctrl-O opens the full reasoning body across the shared toggle.
    const beforeToggle = tree.terminal.written.length
    tree.terminal.sendInput('\x0f')
    await vi.waitFor(() => {
      expect(stripSgr(tree.terminal.written.slice(beforeToggle).join(''))).toContain('and a fourth line guarantees the fold.')
    })
    // And back: the folded hint returns.
    const beforeBack = tree.terminal.written.length
    tree.terminal.sendInput('\x0f')
    await vi.waitFor(() => {
      expect(tree.terminal.written.slice(beforeBack).join('')).toContain('more lines, ctrl+o to expand')
    })
  })

  it('hides the activity pane while a dialog panel occupies the editor slot', async () => {
    const tree = await bootBlue([], { script: ['hang-silent'] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'busy work')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('· Tip: ') })

    // The /help panel takes the editor slot: below it only the footer —
    // the moon row stands down for the panel's lifetime.
    typeLine(tree.terminal, '/help')
    await vi.waitFor(() => { expect(tree.terminal.output.toLowerCase()).toContain('key bindings') })
    const paneled = await fullFrame(tree.terminal)
    expect(hasSpinnerFrame(paneled)).toBe(false)
    expect(paneled).not.toContain('· Tip: ')

    // Dismiss restores the spinner.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => { expect(hasSpinnerFrame(await fullFrame(tree.terminal))).toBe(true) })
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
  })

  it('renders the folded todo pane above the editor and expands it with Ctrl-T', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // Inject a durable whole-list snapshot straight into the session log; the
    // pane's live 'session/event' subscription picks it up.
    agent.session.append('todo/write', {
      todos: [
        { content: 'done-task', status: 'completed' },
        { content: 'active-task', status: 'in_progress' },
        { content: 'later-1', status: 'pending' },
        { content: 'later-2', status: 'pending' },
        { content: 'later-3', status: 'pending' },
        { content: 'later-4', status: 'pending' },
      ],
    })
    // The kimi folded default: every in-progress row, the latest completed,
    // and the earliest pending fit into five rows; the footer counts the one
    // hidden pending entry. Completed content renders struck through.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('active-task') })
    await waitForRender()
    expect(tree.terminal.output).toContain('\x1b[9mdone-task\x1b[29m')
    expect(tree.terminal.output).toContain('… +1 more (1 pending) · ctrl+t to expand')
    expect(tree.terminal.output).not.toContain('later-4')
    // The official facts consumer remains in the dock and the footer stays
    // pinned below it. The provider activation round may place the todo
    // regular child on either side of the editor during a hot composition.
    const expanded = await fullFrame(tree.terminal)
    const footer = expanded.indexOf(`${FOOTER_TEXT_SGR}mock`)
    const todo = expanded.indexOf('active-task')
    const editorBorder = expanded.indexOf(EDITOR_BORDER_SGR)
    expect(footer).toBeGreaterThanOrEqual(0)
    expect(editorBorder).toBeGreaterThanOrEqual(0)
    expect(footer).toBeGreaterThan(todo)
    // The global Ctrl-T action expands the pane to the full list.
    tree.terminal.sendInput('\x14')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('later-4') })
    const full = await fullFrame(tree.terminal)
    expect(full).toContain('all 6 items · ctrl+t to collapse')
  })

  it('hides todo_write tool calls from the stream while sibling tools render', async () => {
    const tree = await bootBlue([], {
      script: [
        toolCallResponse('call-todo', 'todo_write', { todos: [] }),
        toolCallResponse('call-probe', 'side-probe', {}),
        textResponse('plain answer'),
      ],
    })
    const agent = await currentAgent(tree)
    // Step folding collapses the step's tool cards into one summary line;
    // disabling it keeps the sibling tool's card mounted so its result row
    // stays observably present next to the suppressed todo call.
    // Structural ToolDefinitions without importing dsh-tools: register()
    // only validates the output declaration's shape.
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'todo_write',
      description: 'test stand-in for the harness todo tool',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: () => Promise.resolve('todos updated'),
    })
    tools.register({
      name: 'side-probe',
      description: 'test tool emitting a visible output',
      parameters: { type: 'object', properties: {} },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: () => Promise.resolve('probe output'),
    })
    typeLine(tree.terminal, 'run both tools')
    await agent.whenIdle()
    await waitForRender()
    // The sibling tool renders its card (across the accumulated frames —
    // step folding later collapses it into the summary line); the todo call
    // renders nothing in any frame — the pane owns the list's presentation,
    // so the stream never echoes it.
    const shown = tree.terminal.output
    expect(shown).toContain('side-probe')
    expect(shown).toContain('plain answer')
    expect(shown).not.toContain('todo_write')
    expect(shown).not.toContain('todos updated')
  })

  it('renders queued inbox messages without taking Up from editor history', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // The draft stash is module state shared across this worker's cases: make
    // sure the editor starts empty so Up reaches the recall path.
    tree.terminal.sendInput('\x1b')
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
    const footerAt = docked.indexOf(`${FOOTER_TEXT_SGR}mock`)
    const queuedAt = docked.indexOf('queued-task')
    const borderAt = docked.indexOf(EDITOR_BORDER_SGR, queuedAt)
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(borderAt).toBeGreaterThan(queuedAt)
    expect(footerAt).toBeGreaterThan(borderAt)
    // Up remains editor history navigation; the queue stays pending.
    tree.terminal.sendInput('\x1b[A')
    expect(agent.inbox.hasPending).toBe(true)
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('queued-task')
    // History navigation does not submit anything to the model.
    expect(tree.adapter.requests).toHaveLength(0)
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
    expect(shown).toContain('/mcp')
    // /quit fell past the 16-row window when S34 added /mcp; the scrolled
    // view still carries the first window's rows in the accumulated output.
    expect(shown).toContain('showing 1-16 of')
    // PageDown reaches the tail of the Keys section — including the
    // pane-todo global action; the accumulated output carries the rows
    // once the throttled render settles. (The first press is awaited on
    // its own: /quit slid past the 16-row window when S34 added /mcp, and
    // back-to-back presses coalesce under the throttle — only awaited
    // steps are guaranteed a repaint. Three more reach the scroll floor after
    // the rewind command adds another row.)
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('showing 11-26') })
    expect(tree.terminal.output).toContain('Exit Blue')
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Toggle todo list expansion') })
    const scrolled = tree.terminal.output
    expect(scrolled).toContain('ctrl+c')
    expect(scrolled).toContain('Exit Blue')
    // Escape closes the overlay.
    tree.terminal.sendInput('\x1b')
    expect(await fullFrame(tree.terminal)).not.toContain('Exit Blue')
  })

  it('hides the editor while the /help panel is open — only the footer below it', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await executeCommand(tree, agent, '/help')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Commands') })
    const frame = await fullFrame(tree.terminal)
    const rows = frame.split('\r\n')
    // The editor's neutral-gray frame is gone from the screen: the D30
    // dialog mount replaces the editor in its dock slot, so its rounded
    // box no longer peeks between the panel and the footer (its top rule
    // used to render as a lone gray rule under the panel).
    expect(frame).not.toContain('38;2;90;90;90')
    // The bottom row is the footer's first band (model · cwd · git); the
    // editor's frame is nowhere between it and the panel above.
    expect(rows.at(-1)).toContain(`${FOOTER_TEXT_SGR}mock`)
    // Escape restores the editor frame.
    tree.terminal.sendInput('\x1b')
    const restored = await fullFrame(tree.terminal)
    expect(restored).toContain('38;2;90;90;90')
    expect(restored).not.toContain('Exit Blue')
  })

  it('keeps a recalled slash command intact and ghost-free after Up recall', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    // Submit /theme by typing so the editor's own history records it, then
    // recall it with Up: pi-tui parks the cursor on the text's first
    // character, where the argument-hint ghost must decline instead of
    // splicing through the zero-width hardware-cursor marker (the S16
    // dogfood garble that ate the recalled text).
    tree.terminal.sendInput('/theme')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('→ /theme') })
    await waitForRender()
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('themes:') })
    tree.terminal.sendInput('\x1b[A')
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('theme')
    expect(frame).not.toContain('[dark|light')
    // The recalled text is unsubmitted: clear the module-level draft stash
    // so it cannot leak into the next case's fresh editor.
  })

  it('recalls a /theme argument submission after the swap rebuilds the editor', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    // Type the command so the editor's own history records it, then swap:
    // the swap rebuilds blue-input (a theme dependent) and with it the
    // editor component — pi-tui keeps the history in the component, so
    // only the stash replay keeps the entry recallable.
    tree.terminal.sendInput('/theme')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('→ /theme') })
    tree.terminal.sendInput(' light')
    // Let the autocomplete's async round settle on the no-match result
    // before Enter: pi-tui's confirm applies the stale selection while a
    // suggestion round is still in flight (typed chars and Enter arrive in
    // one synchronous burst here, unlike human typing).
    await waitForRender()
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.ctx.get('blueTheme')?.colors).toBe(themeLightPlugin.LIGHT_COLORS) })
    tree.terminal.sendInput('\x1b[A')
    // The recalled line renders with the slash token painted bold-primary,
    // so the anchor strips SGR before matching.
    const frame = await fullFrame(tree.terminal)
    expect(frame.split('\r\n').some(row => stripSgr(row).includes('/theme light'))).toBe(true)
  })

  it('completes @ mentions with directory drill-down and submits them as plain text', async () => {
    const tree = await bootBlue([], { script: [textResponse('mentioned')] })
    const agent = await currentAgent(tree)
    // The session cwd is the repo checkout: '@docs' ranks the docs
    // directory, and Enter accepts it without submitting (only slash
    // completions fall through to submit). Suggestions are async and the
    // fs fallback (no fd on PATH — the CI runner) resolves far slower than
    // the fd pipeline, so each Enter waits on frames written *after* the
    // typing: the accumulated output already holds earlier dropdowns, and
    // a stale-frame wait would let Enter race the in-flight round and fall
    // through as a plain submit.
    tree.terminal.sendInput('@docs')
    let settled = tree.terminal.written.length
    await vi.waitFor(() => {
      expect(tree.terminal.written.slice(settled).join('')).toContain('docs/')
    })
    tree.terminal.sendInput('\r')
    // The accept leaves '@docs/' before the cursor; the adapter's reopen
    // hook lists the directory's contents, and the continued typing
    // preselects the architecture doc by its basename prefix. The settled
    // state is the dropdown's pointer row over the label — the sibling
    // doc only ever appears in the unfiltered listing, so its absence
    // rules out a late drill-down frame satisfying the wait.
    tree.terminal.sendInput('blue-arch')
    settled = tree.terminal.written.length
    await vi.waitFor(() => {
      const frames = tree.terminal.written.slice(settled).join('')
      expect(frames).toContain('→ blue-architecture.md')
      expect(frames).not.toContain('blue-commands-plan.md')
    })
    tree.terminal.sendInput('\r')
    await waitForRender()
    // The file accept appends the trailing space — still no submission.
    expect(tree.adapter.requests).toHaveLength(0)
    // The third Enter submits: the mention travels as plain text (the kimi
    // semantics — the model reads the file itself), no attachment blocks.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const request = tree.adapter.requests[0]!
    expect(JSON.stringify(request.messages)).toContain('@docs/blue-architecture.md')
    await agent.whenIdle()
  })

  it('switches sessions through /new and /fork, and lists lineage in the /sessions tree', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-sessions-')
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
    expect(picker).toContain('└─')
    expect(picker).toContain('← current')
    // The tree seeds its cursor on the live session even when it is nested.
    // Picking it flashes a notice and no switch happens.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('already the current session') })
    expect(tree.sessionChanges).toHaveLength(3)
  })

  it('/rewind creates a child from a complete earlier turn and preserves the parent', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-rewind-')
    const tree = await bootBlue(['first prompt'], {
      script: [textResponse('first answer'), textResponse('second answer')],
      persistenceRoot: root,
    })
    const parent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await parent.whenIdle()
    typeLine(tree.terminal, 'second prompt')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    await parent.whenIdle()
    const secondUserIndex = parent.session.events.findIndex(event =>
      event.type === 'user/message' && JSON.stringify(event.data).includes('second prompt'))
    const secondTurnStart = parent.session.events.slice(0, secondUserIndex + 1)
      .findLast(event => event.type === 'turn/start')?.seq
    expect(secondTurnStart).toBeTypeOf('number')

    await expect(executeCommand(tree, parent, '/rewind')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Rewind current session') })
    expect(tree.terminal.output).toContain('second prompt')
    expect(tree.terminal.output).toContain('The original session stays available')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(2) })
    const child = tree.sessionChanges[1]!
    expect(String(child.session.header.parentSession)).toBe(String(parent.id))
    expect(child.session.header.seedLength).toBe(secondTurnStart)
    expect(parent.session.events.some(event =>
      event.type === 'user/message' && JSON.stringify(event.data).includes('second prompt'))).toBe(true)

    await tree.ctx.sessions.flush(child.session)
    tree.terminal.resize(300, 40)
    await expect(executeCommand(tree, child, '/sessions')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Sessions') })
    expect(tree.terminal.output).toContain(String(parent.id))
    expect(tree.terminal.output).toContain(String(child.id))
    expect(tree.terminal.output).toContain('└─')
  })

  it('/clear completes as an annotated alias of /new and runs its semantics', async () => {
    const tree = await bootBlue(['first', 'task'], {
      script: [textResponse('first answer')],
      persistenceRoot: mkdtempTracked('dsh-blue-e2e-clear-'),
    })
    const first = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await first.whenIdle()

    // The alias surfaces the canonical command, the label carrying the
    // alias annotation (`/new (clear)` — the query matched the alias, not
    // the name). Assert the increment after the keystrokes only: the
    // accumulated output holds older frames that would false-satisfy.
    const mark = tree.terminal.written.length
    tree.terminal.sendInput('/clear')
    await vi.waitFor(() => {
      expect(tree.terminal.written.slice(mark).join('')).toContain('/new (clear)')
    })
    // Enter runs the alias line's semantics: a fresh session attaches and
    // the session-changed broadcast fires (the preselected completion and
    // the raw line both resolve to /new — the value completes to the
    // canonical name, the input layer rewrites the alias).
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(2) })
    const second = tree.sessionChanges[1]!
    expect(second.id).not.toBe(first.id)
  })

  it('/init lists in /help, sends its canned prompt to an idle agent, and refuses while running', async () => {
    // The listing surface: /help enumerates the command with its summary.
    const listing = await bootBlue([], { script: [] })
    const helper = await currentAgent(listing)
    await expect(executeCommand(listing, helper, '/help')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => {
      expect(listing.terminal.output).toContain('Analyze the codebase and write AGENTS.md')
    })

    // The idle path: the canned prompt rides the next request as a user
    // message — the exploration brief and the AGENTS.md target are both
    // model-visible.
    const tree = await bootBlue([], { script: [textResponse('AGENTS.md written')] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/init'))
      .resolves.toEqual({ kind: 'success', text: 'analyzing the codebase to write AGENTS.md' })
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const messages = JSON.stringify(tree.adapter.requests[0]!.messages)
    expect(messages).toContain('explore the current project directory')
    expect(messages).toContain('AGENTS.md')
    await agent.whenIdle()

    // The busy path: a typed /init while the agent runs is refused with a
    // notice and no second request.
    const busy = await bootBlue([], { script: ['hang'] })
    const busyAgent = await currentAgent(busy)
    typeLine(busy.terminal, 'long work')
    await vi.waitFor(() => { expect(busy.adapter.requests).toHaveLength(1) })
    await vi.waitFor(() => { expect(busyAgent.status).toBe('running') })
    const mark = busy.terminal.written.length
    typeLine(busy.terminal, '/init')
    await vi.waitFor(() => {
      expect(busy.terminal.written.slice(mark).join(''))
        .toContain('cannot run /init while the agent is running')
    })
    expect(busy.adapter.requests).toHaveLength(1)
  })

  it('lists the model-family commands in /help', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    tree.terminal.resize(100, 40)
    await expect(executeCommand(tree, agent, '/help')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/model') })
    expect(tree.terminal.output).toContain('/effort (/thinking)')
    // /changelog can push /provider past the first window; page the panel down.
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/provider') })
  })

  it('opens the /model picker, commits the draft, and routes the next request', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('ok')],
      contextWindow: 65536,
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' as never },
    })
    const agent = await currentAgent(tree)
    tree.terminal.resize(300, 40)
    await expect(executeCommand(tree, agent, '/model')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Select a model') })
    const picker = tree.terminal.output
    expect(picker).toContain('Mock Pro')
    expect(picker).toContain('ctx 64k')
    expect(picker).toContain('← current')
    expect(picker).toContain('[High]')
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Switched to mock-pro (mock) · thinking high') })
    typeLine(tree.terminal, 'go')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    expect(tree.adapter.requests[0]!.model).toBe('mock-pro')
    expect(tree.adapter.requests[0]!.reasoningEffort).toBe('high' as never)
  })

  it('/model answers the unknown-id and empty-catalog guards', async () => {
    const tree = await bootBlue([], {
      script: [],
      models: [{ provider: 'mock', id: 'mock', name: 'Mock' }],
    })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/model nope'))
      .resolves.toEqual({ kind: 'error', text: 'unknown model: nope' })
    const empty = await bootBlue([], { script: [] })
    const emptyAgent = await currentAgent(empty)
    await expect(executeCommand(empty, emptyAgent, '/model'))
      .resolves.toEqual({ kind: 'success', text: 'no models advertised for the configured providers' })
  })

  it('commits /model session-only with Alt+S and persists the default with Enter', async () => {
    const dir = mkdtempTracked('dsh-blue-e2e-model-')
    const settingsPath = `${dir}/settings.yaml`
    const credentialsPath = `${dir}/.credentials.yaml`
    writeFileSync(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: existing-test-key\n', { mode: 0o600 })
    const boot = async () => bootBlue([], {
      script: [],
      realSettings: { settingsPath, credentialsPath },
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' as never },
    })

    // Alt+S switches the session but leaves the stored default untouched.
    const sessionOnly = await boot()
    const agent = await currentAgent(sessionOnly)
    sessionOnly.terminal.resize(300, 40)
    await expect(executeCommand(sessionOnly, agent, '/model')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(sessionOnly.terminal.output).toContain('Select a model') })
    sessionOnly.terminal.sendInput('\x1b[B')
    sessionOnly.terminal.sendInput('\x1bs')
    await vi.waitFor(() => {
      expect(sessionOnly.terminal.output).toContain('Switched to mock-pro (mock) · thinking high · session only')
    })
    await sessionOnly.ctx.fiber.dispose()
    const afterSessionOnly = await boot()
    await vi.waitFor(() => { expect(afterSessionOnly.terminal.output).toContain('mock · mock') })
    expect(afterSessionOnly.terminal.output).not.toContain('mock-pro · mock')
    await afterSessionOnly.ctx.fiber.dispose()

    // Enter persists the default through the settings file; a fresh boot
    // (same files) starts on it — the banner snapshot reads it back.
    const persisting = await boot()
    const persistAgent = await currentAgent(persisting)
    await expect(executeCommand(persisting, persistAgent, '/model')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(persisting.terminal.output).toContain('Select a model') })
    persisting.terminal.sendInput('\x1b[B')
    persisting.terminal.sendInput('\r')
    await vi.waitFor(() => {
      expect(persisting.terminal.output).toContain('Switched to mock-pro (mock) · thinking high')
    })
    await persisting.ctx.fiber.dispose()
    expect(readFileSync(settingsPath, 'utf8')).toContain('mock-pro')
    const restarted = await boot()
    await vi.waitFor(() => { expect(restarted.terminal.output).toContain('mock-pro · mock') })
    await restarted.ctx.fiber.dispose()
  })

  it('switches the thinking effort through the /effort panel and direct levels', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('ok')],
      reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'high' as never },
    })
    const agent = await currentAgent(tree)
    tree.terminal.resize(300, 40)
    await expect(executeCommand(tree, agent, '/effort')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Thinking effort') })
    // No live effort → the Default segment starts active.
    expect(tree.terminal.output).toContain('[Default]')
    // Right steps to Low; Enter applies it session-wide.
    tree.terminal.sendInput('\x1b[C')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Thinking set to low') })

    await expect(executeCommand(tree, agent, '/effort high'))
      .resolves.toEqual({ kind: 'success', text: 'Thinking set to high' })
    typeLine(tree.terminal, 'go')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    expect(tree.adapter.requests[0]!.reasoningEffort).toBe('high' as never)

    await expect(executeCommand(tree, agent, '/effort default'))
      .resolves.toEqual({ kind: 'success', text: 'Thinking set to provider default' })
    await expect(executeCommand(tree, agent, '/effort bogus'))
      .resolves.toEqual({
        kind: 'error',
        text: 'unsupported thinking effort "bogus" for mock: available: default, low, high',
      })

    const plain = await bootBlue([], { script: [] })
    const plainAgent = await currentAgent(plain)
    await expect(executeCommand(plain, plainAgent, '/effort'))
      .resolves.toEqual({ kind: 'error', text: 'the current model exposes no reasoning efforts' })
  })

  it('lists providers and opens the scoped picker on switch', async () => {
    const tree = await bootBlue([], {
      script: [],
      models: [{ provider: 'mock', id: 'mock', name: 'Mock' }],
    })
    const agent = await currentAgent(tree)
    tree.terminal.resize(300, 40)
    await expect(executeCommand(tree, agent, '/provider')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Providers') })
    expect(tree.terminal.output).toContain('← current')
    expect(tree.terminal.output).toContain('+ Add provider')
    // Enter on a configured row routes to the edit flow; without the host
    // settings services this tree answers their guard notice.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => {
      expect(tree.terminal.output).toContain('provider configuration requires the host settings and credentials services')
    })
    await expect(executeCommand(tree, agent, '/provider switch nope'))
      .resolves.toEqual({ kind: 'error', text: 'unknown provider: nope (registered: mock)' })
    await expect(executeCommand(tree, agent, '/provider bogus'))
      .resolves.toEqual({ kind: 'error', text: 'usage: /provider [list | switch <name> | add]' })
  })

  it('adds a custom endpoint through the real settings, credentials, and pi-ai stack', async () => {
    const server = await startModelServer([{ id: 'gateway-chat' }, { id: 'gateway-lite' }])
    const dir = mkdtempTracked('dsh-blue-e2e-add-')
    const settingsPath = `${dir}/settings.yaml`
    const credentialsPath = `${dir}/.credentials.yaml`
    const tree = await bootBlue(['start'], {
      script: [textResponse('booted')],
      realSettings: { settingsPath, credentialsPath },
      piAi: true,
    })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    tree.terminal.resize(300, 40)
    // The wizard's panels settle with user input, so the command promise
    // stays pending while the test drives them.
    const outcome = executeCommand(tree, agent, '/provider add')
    // Source: Custom endpoint.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Add provider') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    // Protocol: openai-completions.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Endpoint protocol') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    // Form: route, baseURL, key.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Custom endpoint') })
    tree.terminal.sendInput('blue-e2e-gw')
    tree.terminal.sendInput('\t')
    tree.terminal.sendInput(`${server.url}/v1`)
    tree.terminal.sendInput('\t')
    tree.terminal.sendInput('sk-test-key')
    tree.terminal.sendInput('\r')
    // Discovery feeds the adopt multi-select.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Advertised models') })
    expect(tree.terminal.output).toContain('gateway-chat')
    tree.terminal.sendInput(' ')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Model defaults') })
    tree.terminal.sendInput('\r')
    tree.terminal.sendInput('\r')
    await expect(outcome).resolves.toEqual({ kind: 'success', text: 'provider "blue-e2e-gw" added' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Select a model · blue-e2e-gw') })
    // Escape keeps the provider without switching the default.
    tree.terminal.sendInput('\x1b')
    // The writes landed on disk and the route is live.
    const settingsDocument = readFileSync(settingsPath, 'utf8')
    expect(settingsDocument).toContain('llm-pi-ai')
    expect(settingsDocument).toContain('blue-e2e-gw')
    expect(settingsDocument).toContain('openai-completions')
    expect(settingsDocument).toContain('BLUE_E2E_GW_API_KEY')
    expect(readFileSync(credentialsPath, 'utf8')).toContain('BLUE_E2E_GW_API_KEY')
    await vi.waitFor(() => {
      expect(tree.ctx.llm.listProviders().map(provider => provider.id)).toContain('blue-e2e-gw')
    })
    const models = await tree.ctx.llm.listModels('blue-e2e-gw')
    expect(models.map(model => model.id)).toEqual(['gateway-chat'])
    await server.close()
  })

  it('surfaces a failing completion endpoint as a transcript error row', async () => {
    // The listing endpoint answers; every other route 404s — the probe
    // for the dogfood report of a silent no-output conversation.
    const server = createServer((request, response) => {
      if (request.url !== undefined && request.url.endsWith('/models')) {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ object: 'list', data: [{ id: 'gw-chat', object: 'model' }] }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: { message: 'no such route' } }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const dir = mkdtempTracked('dsh-blue-e2e-dead-')
    const settingsPath = `${dir}/settings.yaml`
    const credentialsPath = `${dir}/.credentials.yaml`
    writeFileSync(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: existing-test-key\n', { mode: 0o600 })
    const tree = await bootBlue([], {
      script: [textResponse('unused')],
      realSettings: { settingsPath, credentialsPath },
      piAi: true,
    })
    const agent = await currentAgent(tree)
    tree.terminal.resize(300, 40)
    const outcome = executeCommand(tree, agent, '/provider add')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Add provider') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Endpoint protocol') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Custom endpoint') })
    tree.terminal.sendInput('deadgw')
    tree.terminal.sendInput('\t')
    tree.terminal.sendInput(`http://127.0.0.1:${port}/v1`)
    tree.terminal.sendInput('\t')
    tree.terminal.sendInput('sk-probe')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Advertised models') })
    tree.terminal.sendInput(' ')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Model defaults') })
    tree.terminal.sendInput('\r')
    tree.terminal.sendInput('\r')
    await expect(outcome).resolves.toEqual({ kind: 'success', text: 'provider "deadgw" added' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Select a model · deadgw') })
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Switched to gw-chat (deadgw)') })
    // Converse: the completion call 404s. Dump what the UI does.
    typeLine(tree.terminal, 'hello there')
    await new Promise(resolve => setTimeout(resolve, 5000))
    // The failed turn renders its error row — the dead-endpoint answer,
    // never a silent transcript.
    await vi.waitFor(() => {
      expect(tree.terminal.output).toContain('request failed')
      expect(tree.terminal.output).toContain('no such route')
    })
    expect(agent.status).toBe('idle')
    await server.close()
  }, 40000)

  it('adopts a known catalog vendor through the wizard', async () => {
    const dir = mkdtempTracked('dsh-blue-e2e-vendor-')
    const settingsPath = `${dir}/settings.yaml`
    const credentialsPath = `${dir}/.credentials.yaml`
    writeFileSync(credentialsPath, 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: existing-test-key\n', { mode: 0o600 })
    const tree = await bootBlue([], {
      script: [],
      realSettings: { settingsPath, credentialsPath },
      piAi: true,
    })
    const agent = await currentAgent(tree)
    tree.terminal.resize(300, 40)
    const outcome = executeCommand(tree, agent, '/provider add')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Add provider') })
    tree.terminal.sendInput('\r')
    // The source panel's own first row says "Known provider (…)", so wait
    // for the vendor picker by its first catalog row instead.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('amazon-bedrock') })
    const vendor = 'amazon-bedrock'
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('vendor default endpoint') })
    expect(tree.terminal.output).not.toContain('Base URL')
    tree.terminal.sendInput('vendor-key')
    tree.terminal.sendInput('\r')
    await expect(outcome).resolves.toEqual({ kind: 'success', text: `provider "${vendor}" added` })
    const settingsDocument = readFileSync(settingsPath, 'utf8')
    expect(settingsDocument).toContain(vendor)
    expect(settingsDocument).toContain(`${vendor.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`)
    await vi.waitFor(() => {
      expect(tree.ctx.llm.listProviders().map(provider => provider.id)).toContain(vendor)
    })
  })

  it('stores the first-run DeepSeek key through the onboarding panel', async () => {
    const set = vi.fn(async () => {})
    const tree = await bootBlue([], {
      script: [],
      credentials: { describe: async () => ({ configured: false, writable: true }), set },
    })
    await currentAgent(tree)
    tree.terminal.resize(160, 30)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Connect to DeepSeek') })
    tree.terminal.sendInput('sk-onboarding')
    expect(tree.terminal.output).not.toContain('sk-onboarding')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('DeepSeek API key saved') })
    expect(set).toHaveBeenCalledWith(expect.anything(), 'sk-onboarding')
  })

  it('answers the /provider add guard without the host settings services', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/provider add')).resolves.toEqual({
      kind: 'error',
      text: 'provider configuration requires the host settings, credentials, and llm services',
    })
  })

  it('keeps the switched model across a resume (the header tier)', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-resume-')
    const first = await bootBlue(['first'], {
      script: [textResponse('one'), textResponse('two'), textResponse('three')],
      persistenceRoot: root,
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
    })
    const agent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(first, agent, '/model mock-pro'))
      .resolves.toEqual({ kind: 'success', text: 'Switched to mock-pro (mock)' })
    typeLine(first.terminal, 'second')
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(2) })
    await agent.whenIdle()
    const id = String(agent.session.id)
    await first.ctx.sessions.flush(agent.session)
    await first.ctx.fiber.dispose()

    const resumed = await bootBlue(['--resume', id], { script: [textResponse('three')], persistenceRoot: root })
    await currentAgent(resumed)
    typeLine(resumed.terminal, 'third')
    await vi.waitFor(() => { expect(resumed.adapter.requests).toHaveLength(1) })
    // The resumed session keeps mock-pro (the old wiring snapped it back
    // to the process default `mock`).
    expect(resumed.adapter.requests[0]!.model).toBe('mock-pro')
  })

  it('a model switch updates the footer and banner model lines immediately', async () => {
    // The S24a dogfood round-4 find: the footer read the logged
    // request/header tier (stale until the next turn) and the banner was a
    // boot snapshot of the default — both now track the live selection.
    const tree = await bootBlue([], {
      script: [],
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
    })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${FOOTER_TEXT_SGR}mock`) })
    await expect(executeCommand(tree, agent, '/model mock-pro'))
      .resolves.toEqual({ kind: 'success', text: 'Switched to mock-pro (mock)' })
    // Footer: the pick shows before any new turn logs a header.
    await vi.waitFor(() => { expect(tree.terminal.output).toContain(`${FOOTER_TEXT_SGR}mock-pro`) })
    // Banner: the model line re-derives too.
    await vi.waitFor(async () => {
      expect(await fullFrame(tree.terminal)).toContain('mock-pro · mock')
    })
    // /new re-derives too: the fresh session's ref resolves from the
    // default service (the e2e boot saves no settings, so back to mock) —
    // the banner tracks the switch instead of freezing the boot snapshot.
    await expect(executeCommand(tree, agent, '/new')).resolves.toMatchObject({ kind: 'success' })
    await currentAgent(tree)
    await vi.waitFor(async () => {
      expect(await fullFrame(tree.terminal)).toContain('mock · mock')
    })
  })

  it('moves the model route to the fresh session on /new', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('ok')],
      models: [
        { provider: 'mock', id: 'mock', name: 'Mock' },
        { provider: 'mock', id: 'mock-pro', name: 'Mock Pro' },
      ],
    })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/model mock-pro'))
      .resolves.toEqual({ kind: 'success', text: 'Switched to mock-pro (mock)' })
    await expect(executeCommand(tree, agent, '/new'))
      .resolves.toEqual({ kind: 'success', text: 'starting a new session' })
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(2) })
    // The fresh agent reads the default tier: mock.
    expect(tree.ctx.blueSessionActions.modelSelection()).toMatchObject({ provider: 'mock', model: 'mock' })
    const fresh = tree.sessionChanges[1]!
    typeLine(tree.terminal, 'go')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await fresh.whenIdle()
    expect(tree.adapter.requests[0]!.model).toBe('mock')
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

  it('yolo auto-approves without an overlay while questions still pop', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    // No overlay: the waterfall settles allowed-once straight away.
    const before = tree.terminal.written.length
    await expect(tree.ctx.waterfall('approval/request', { agent, toolName: 'bash' }, fallback))
      .resolves.toBe('allowed-once')
    await waitForRender()
    expect(tree.terminal.written.slice(before).join('')).not.toContain('Approve bash?')
    expect(fallback).not.toHaveBeenCalled()
    // Questions are a separate service: the questionnaire still opens.
    const answer = tree.ctx.userQuestions.ask({
      questions: [
        { id: 'q1', question: 'Still asking?', header: 'ASK', options: [{ label: 'yes' }] },
      ],
    })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Still asking?') })
    tree.terminal.sendInput('\r')
    await expect(answer).resolves.toEqual({ answers: [{ id: 'q1', selected: ['yes'] }] })
  })

  it('bare /yolo toggles and the log records the disambiguating follow-up', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    const args = agent.session.events
      .filter((event): event is typeof event & { data: { name: string, args?: string } } =>
        event.type === 'command/run' && event.data.name === 'yolo')
      .map(event => event.data.args)
    expect(args).toEqual(['', '', ' off'])
    // Off means off: the next approval prompts again.
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    const pending = tree.ctx.waterfall('approval/request', { agent, toolName: 'bash' }, fallback)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Approve bash?') })
    tree.terminal.sendInput('\r')
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('shift+tab cycles normal → plan → yolo → normal with the footer badge', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    expect(planMode.get(agent).active).toBe(false)
    // normal → plan
    tree.terminal.sendInput('\x1b[Z')
    await vi.waitFor(() => { expect(planMode.get(agent).active).toBe(true) })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('plan') })
    // plan → yolo
    tree.terminal.sendInput('\x1b[Z')
    await vi.waitFor(() => { expect(planMode.get(agent).active).toBe(false) })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('yolo') })
    // yolo auto-allows while the badge shows
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    await expect(tree.ctx.waterfall('approval/request', { agent, toolName: 'bash' }, fallback))
      .resolves.toBe('allowed-once')
    // yolo → normal: no badge. The cycle dispatch is async, so first wait
    // for its '/yolo off' notice, then clear it with one edit (the hint
    // line's one-shot tier) before asserting real frames.
    tree.terminal.sendInput('\x1b[Z')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('yolo off') })
    tree.terminal.sendInput('x')
    await vi.waitFor(async () => {
      // The frame still paints the session cwd (banner + status-cwd
      // entry), and this suite runs from checkouts whose directory name
      // can itself contain the badge words (a `…-plan…` worktree) —
      // strip the cwd basename so the assertion targets the badge.
      const frame = stripCwdName(await fullFrame(tree.terminal))
      expect(frame).not.toContain('yolo')
      expect(frame).not.toContain('plan')
    })
    expect(planMode.get(agent).active).toBe(false)
  })

  it('plan and yolo are exclusive whichever way the switch lands', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    // /plan while yolo is on: the deferred watcher turns yolo off.
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    await expect(executeCommand(tree, agent, '/plan')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(() => {
      const args = agent.session.events
        .filter((event): event is typeof event & { data: { name: string, args?: string } } =>
          event.type === 'command/run' && event.data.name === 'yolo')
        .map(event => event.data.args)
      expect(args.at(-1)).toBe(' off')
    })
    expect(planMode.get(agent).active).toBe(true)
    // /yolo on while plan is active: plan exits first.
    await expect(executeCommand(tree, agent, '/yolo on')).resolves.toMatchObject({ kind: 'success' })
    expect(planMode.get(agent).active).toBe(false)
  })

  it('keeps yolo across a resume (the command/run fold)', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-yolo-resume-')
    const first = await bootBlue(['first'], { script: [textResponse('one')], persistenceRoot: root })
    const agent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(first, agent, '/yolo on')).resolves.toMatchObject({ kind: 'success' })
    const id = String(agent.session.id)
    await first.ctx.sessions.flush(agent.session)
    await first.ctx.fiber.dispose()

    const resumed = await bootBlue(['--resume', id], { script: [], persistenceRoot: root })
    const next = await currentAgent(resumed)
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    await expect(resumed.ctx.waterfall('approval/request', { agent: next, toolName: 'bash' }, fallback))
      .resolves.toBe('allowed-once')
    const args = next.session.events
      .filter((event): event is typeof event & { data: { name: string, args?: string } } =>
        event.type === 'command/run' && event.data.name === 'yolo')
      .map(event => event.data.args)
    expect(args).toEqual([' on'])
  })

  it('keeps plan across a resume (the plan/mode fold)', async () => {
    const root = mkdtempTracked('dsh-blue-e2e-plan-resume-')
    const first = await bootBlue(['first'], { script: [textResponse('one')], persistenceRoot: root })
    const agent = await currentAgent(first)
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(first, agent, '/plan')).resolves.toMatchObject({ kind: 'success' })
    const id = String(agent.session.id)
    await first.ctx.sessions.flush(agent.session)
    await first.ctx.fiber.dispose()

    const resumed = await bootBlue(['--resume', id], { script: [], persistenceRoot: root })
    const next = await currentAgent(resumed)
    const planMode = resumed.ctx.get('planMode')!
    expect(planMode.get(next).active).toBe(true)
    // The badge follows the folded state.
    await vi.waitFor(async () => { expect(await fullFrame(resumed.terminal)).toContain('plan') })
  })

  it('/new resets the mode to normal', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    await expect(executeCommand(tree, agent, '/new')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.sessionChanges).toHaveLength(2) })
    const fresh = tree.sessionChanges[1]!
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    const pending = tree.ctx.waterfall('approval/request', { agent: fresh!, toolName: 'bash' }, fallback)
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Approve bash?') })
    tree.terminal.sendInput('\r')
    await expect(pending).resolves.toBe('allowed-once')
    await vi.waitFor(async () => {
      expect(await fullFrame(tree.terminal)).not.toContain('yolo')
    })
  })

  it('/help lists /yolo with its alias and the shift+tab binding', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/help')).resolves.toMatchObject({ kind: 'success' })
    // The command list outgrew the first window once S25 added the
    // session-info family; one PageDown brings the tail commands in.
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/yolo (/yes)') })
    // The Keys section sits below the commands window; scroll to the very
    // end so the tail rows (shift+tab among them) enter the window.
    for (let i = 0; i < 24; i += 1) tree.terminal.sendInput('\x1b[B')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('shift+tab') })
  })

  it('a fork inherits yolo from the forked log', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/yolo')).resolves.toMatchObject({ kind: 'success' })
    await expect(executeCommand(tree, agent, '/fork')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(() => {
      const next = tree.sessionChanges[1]
      expect(next).toBeDefined()
      expect(next).not.toBe(agent)
    })
    const forked = tree.sessionChanges[1]!
    const fallback = vi.fn(() => Promise.resolve<ApprovalOutcome>('unavailable'))
    await expect(tree.ctx.waterfall('approval/request', { agent: forked, toolName: 'bash' }, fallback))
      .resolves.toBe('allowed-once')
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

  it('/status lists the header facts, counts, model, and context in the read-only panel', async () => {
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'usage reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'usage reply' } },
      { type: 'usage', usage: { inputTokens: 4242, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const tree = await bootBlue([], { script: [usageScript], contextWindow: 8192, sessionProjections: true })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'spend tokens')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(tree, agent, '/status')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Session') })
    const frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain(String(agent.session.id))
    expect(frame).toContain('cwd')
    expect(frame).toContain('UTC')
    expect(frame).toContain('1 · 1 steps')
    expect(frame).toContain('mock (mock)')
    expect(frame).toContain(`Blue v${BLUE_VERSION}`)
    expect(frame).toContain('/ 8k')
    // Escape restores the editor: the panel leaves the next full frame.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('Context window')
    })
  })

  it('/context reads the token-meter projections and survives a resume through the durable fold', async () => {
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'usage reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'usage reply' } },
      { type: 'usage', usage: { inputTokens: 4242, outputTokens: 100, cacheReadTokens: 61440 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const root = mkdtempTracked('dsh-blue-e2e-usage-')
    const first = await bootBlue([], {
      script: [usageScript],
      contextWindow: 8192,
      persistenceRoot: root,
      sessionProjections: true,
    })
    const agent = await currentAgent(first)
    typeLine(first.terminal, 'spend tokens')
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(first, agent, '/context')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(stripSgr(first.terminal.output)).toContain('64.2k') })
    const frame = stripSgr(await fullFrame(first.terminal))
    expect(frame).toContain('4.1k')
    expect(frame).toContain('60k')
    expect(frame).toContain('100')
    // With the composition grid present the occupancy bar section is
    // replaced — the anchored totals ride the grid's headline instead.
    expect(frame).toContain('/8k tokens (100%)')
    // The CC-style composition section rides on the contextBreakdown
    // projection: the glyph grid with the legend riding its right edge.
    // The full panel overflows the sixteen-row window, so the free row
    // needs one page down.
    expect(frame).toContain('Context usage (heuristic)')
    expect(frame).toContain('Estimated usage by category')
    expect(frame).toContain('System prompt:')
    expect(frame).toContain('Messages:')
    first.terminal.sendInput('\x1b[6~')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(first.terminal))).toContain('Free space:')
    })
    const id = String(agent.session.id)
    await first.ctx.sessions.flush(agent.session)
    await first.ctx.fiber.dispose()

    // The resumed session reports the same totals: the projection folds
    // the whole durable log, replay included.
    const resumed = await bootBlue(['--resume', id], { script: [], persistenceRoot: root, sessionProjections: true })
    const resumedAgent = await currentAgent(resumed)
    await expect(executeCommand(resumed, resumedAgent, '/context')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(stripSgr(resumed.terminal.output)).toContain('64.2k') })
  })

  it('/context consumes the optional frontend-runtime model over the official projection service', async () => {
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'frontend context reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'frontend context reply' } },
      { type: 'usage', usage: { inputTokens: 2048, outputTokens: 32, cacheReadTokens: 1024 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const tree = await bootBlue([], { script: [usageScript], contextWindow: 8192, sessionProjections: true, frontendContext: true })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'render official context')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    const feature = (tree.ctx as unknown as { get(name: string): { model?: unknown } | undefined }).get('blueContextFeature')
    await vi.waitFor(() => { expect(feature?.model).toBeDefined() })
    await expect(executeCommand(tree, agent, '/context')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('usage')
      expect(frame).toContain('input: 2k')
      expect(frame).toContain('context pressure')
      expect(frame).toContain('composition')
    })
    tree.terminal.sendInput('\x1b')
  })

  it('/context falls back to the assistant fold without the projection family', async () => {
    const usageScript: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'usage reply' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'usage reply' } },
      { type: 'usage', usage: { inputTokens: 4242, outputTokens: 100, cacheReadTokens: 61440 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const tree = await bootBlue([], { script: [usageScript], contextWindow: 8192 })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'spend tokens')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    await agent.whenIdle()
    await expect(executeCommand(tree, agent, '/context')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(stripSgr(tree.terminal.output)).toContain('64.2k') })
    const frame = stripSgr(await fullFrame(tree.terminal))
    // The fallback context pair: last request's input side over the
    // advertised window.
    expect(frame).toContain('64.1k/8k')
  })

  it('/version opens the read-only panel over the release lines and the live model', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/version')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => {
      expect(stripSgr(tree.terminal.output)).toContain(`v${BLUE_VERSION}`)
    })
    const frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain(`v${BLUE_VERSION}`)
    expect(frame).toContain('harness')
    expect(frame).toContain('0.1.1-rc.2')
    // The panel is version-only: no model section even with a live session.
    expect(frame).not.toContain('mock (mock)')
    // Escape restores the editor: the panel leaves the next full frame
    // (the `v`-prefixed release line is the panel-only marker — the boot
    // banner's own Version row carries the bare number).
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain(`v${BLUE_VERSION}`)
    })
  })

  it('loads Blue creative-mode metadata and persona into a real model request', async () => {
    const tree = await bootBlue(['what mode are you in?'], {
      script: [textResponse('Blue creative mode')],
      presetFixtures: [{ id: 'cordis' }],
      creativePersonaOnly: true,
    })
    const agent = await currentAgent(tree)
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const preset = await tree.ctx.agentPresets.resolve('cordis')
    expect(preset.name).toBe('创造模式')
    expect(preset.description).toContain('Blue')
    expect(tree.ctx.agentPresets.composedPreset(agent.ctx)).toBe('cordis')
    const request = JSON.stringify(tree.adapter.requests[0]!)
    expect(request).toContain('BLUE CREATIVE MODE')
    expect(request).toContain('never describe this preset as ordinary')
    expect(request).toContain('PROTOTYPE IN SESSION, THEN ASK, THEN PERSIST')
  })

  it('mounts every agent onto the roster default and honors the logged selection across a resume (thin-host)', async () => {
    const fixtures = [
      { id: 'alpha', tool: 'e2e_alpha_tool', order: 1 },
      { id: 'beta', tool: 'e2e_beta_tool', order: 2 },
    ]
    // Tree one: the default boot mounts the roster default (alpha), a
    // switch rebinds to beta, and the selection event lands in the log.
    const persistenceRoot = mkdtempTracked('dsh-blue-e2e-presets-')
    const first = await bootBlue([], { script: [], presetFixtures: fixtures, persistenceRoot })
    const firstAgent = await currentAgent(first)
    const roster = first.ctx.get('agentPresets')!
    expect(roster.composedPreset(firstAgent.ctx)).toBe('alpha')
    await expect(executeCommand(first, firstAgent, '/preset beta')).resolves.toEqual({ kind: 'success', text: 'preset beta' })
    expect(roster.composedPreset(firstAgent.ctx)).toBe('beta')
    const sessionId = String(firstAgent.session.id)
    await first.ctx.fiber.dispose()
    disposers.length = 0
    // Tree two: a fresh boot over the same persistence root resumes the
    // session and rebuilds the composition its log names.
    const second = await bootBlue(['--resume', sessionId], { script: [], presetFixtures: fixtures, persistenceRoot })
    const secondAgent = await currentAgent(second)
    expect(second.ctx.get('agentPresets')!.composedPreset(secondAgent.ctx)).toBe('beta')
  })

  it('/tools opens the picker, stacks the tool detail on Enter, and Escape walks back', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // Two global registrations from the spec side: a plain tool and an
    // MCP-namespaced one, both in the agent's inherited global layer.
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'spec_probe',
      description: 'The spec-side probe tool.\nIt never executes; the panel only reads.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'What to probe' } },
        required: ['target'],
      },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
      execute: () => Promise.resolve('ok'),
    })
    tools.register({
      name: 'mcp__demo__list_items',
      description: 'demo list',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
      execute: () => Promise.resolve('ok'),
    })
    await expect(executeCommand(tree, agent, '/tools')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('spec_probe')
    })
    // The picker shows the name beside the first-sentence brief.
    let frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain('The spec-side probe tool.')
    expect(frame).toContain('mcp__demo__list_items')
    // Step down to the mcp row (exit_plan_mode sorts first), then Enter
    // opens the detail panel stacked above the picker.
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).toContain('server')
    })
    frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain('demo')
    expect(frame).toContain('demo list')
    expect(frame).toContain('no parameters')
    // Escape walks back to the picker, a second one closes it.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('server')
    })
    expect(stripSgr(await fullFrame(tree.terminal))).toContain('spec_probe')
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('spec_probe')
    })
  })

  it('/mcp walks the fixture server stack: picker, config detail, tool schema', async () => {
    const tree = await bootBlue([], {
      script: [],
      mcpServers: [{ id: 'mcp-demo', serverName: 'demo', env: { DEMO_TOKEN: 'fixture-secret' } }],
    })
    const agent = await currentAgent(tree)
    // The entry connected during boot: loader.await covered the initial
    // sync, so the picker reads the joined truth immediately.
    await expect(executeCommand(tree, agent, '/mcp')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('demo')
      expect(frame).toContain('synced')
      expect(frame).toContain('2 tools')
    })
    // Enter opens the per-server panel: the config pseudo-row plus the two
    // raw-named tools with their first-sentence briefs.
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('server config')
      expect(frame).toContain('list_items')
      expect(frame).toContain('List the fixture items.')
    })
    // Enter on the head (config) row: the endpoint carries the interpreter
    // (the panel truncates the long fixture path tail) and the env appears
    // as its KEY list — the value never renders.
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain(process.execPath)
      expect(frame).toContain('DEMO_TOKEN')
      expect(frame).not.toContain('fixture-secret')
    })
    // Back out, down to the first tool row, and into the schema detail the
    // /tools detail view renders (server attribution included).
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('mcp__demo__list_items')
      expect(frame).toContain('Parameters')
      expect(frame).toContain('limit')
    })
    // Escape climbs back one level at a time, each waiting for the level
    // below to visibly retake the editor slot before the next key arrives.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('server config')
      expect(frame).not.toContain('Parameters')
    })
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).not.toContain('server config')
      expect(frame).toContain('MCP servers')
    })
    // The final Escape can lose a race with the editor-slot settle right
    // after a restore (the input dispatch lands one tick before the
    // refocus); the wait re-sends it while the picker is still up, so the
    // assertion holds on the settled end state either way.
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      if (frame.includes('MCP servers')) tree.terminal.sendInput('\x1b')
      expect(frame).not.toContain('MCP servers')
    })
  })

  it('/mcp sorts the no-tools server ahead and shows its honest note', async () => {
    const tree = await bootBlue([], {
      script: [],
      mcpServers: [
        { id: 'mcp-demo', serverName: 'demo' },
        { id: 'mcp-dead', serverName: 'dead', dead: true },
      ],
    })
    const agent = await currentAgent(tree)
    await executeCommand(tree, agent, '/mcp')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      // Attention-first: the dead row (no tools) heads the list, the live
      // one follows; both carry their transport and status.
      expect(frame).toContain('dead')
      expect(frame).toContain('no tools')
      expect(frame).toContain('demo')
      expect(frame).toContain('synced')
    })
    // Enter on the head (dead) row: the config pseudo-row and the honest
    // blocked row — no tools registered, recovery named.
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('server config')
      expect(frame).toContain('(no tools registered)')
    })
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
  })

  it('/mcp mounts the guidance panel when no servers are declared', async () => {
    const tree = await bootBlue([], { script: [] })
    const agent = await currentAgent(tree)
    // A spec-side mcp__-named registration with no matching entry: the
    // empty panel notes the orphan instead of hiding it.
    const tools = (tree.ctx as unknown as { tools: { register(definition: unknown): () => void } }).tools
    tools.register({
      name: 'mcp__ghost__haunt',
      description: 'ghost tool',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: '' }] },
      execute: () => Promise.resolve('ok'),
    })
    await expect(executeCommand(tree, agent, '/mcp')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('no MCP servers are declared')
      expect(frame).toContain('dsh-blue.dev')
      expect(frame).toContain('1 mcp__ tool visible but undeclared')
    })
    tree.terminal.sendInput('\x1b')
  })

  it('/tools shows the preset-bound surface: the default mounts alpha and switching swaps the catalog', async () => {
    const tree = await bootBlue([], {
      script: [],
      presetFixtures: [
        { id: 'alpha', tool: 'e2e_alpha_tool', order: 1 },
        { id: 'beta', tool: 'e2e_beta_tool', order: 2 },
      ],
    })
    const agent = await currentAgent(tree)
    await executeCommand(tree, agent, '/tools')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).toContain('e2e_alpha_tool')
    })
    let frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).not.toContain('e2e_beta_tool')
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('e2e_alpha_tool')
    })
    // The swap: beta's composition replaces alpha's in the agent's view.
    await expect(executeCommand(tree, agent, '/preset beta')).resolves.toEqual({ kind: 'success', text: 'preset beta' })
    await executeCommand(tree, agent, '/tools')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).toContain('e2e_beta_tool')
    })
    frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).not.toContain('e2e_alpha_tool')
  })

  it('opens the /preset picker on a bare line: broken rows block, cancel switches nothing', async () => {
    const tree = await bootBlue([], {
      script: [],
      presetFixtures: [
        { id: 'alpha', tool: 'e2e_alpha_tool', order: 1 },
        { id: 'beta', tool: 'e2e_beta_tool', order: 2 },
        { id: 'broken', broken: true, order: 3 },
      ],
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, '/preset')
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('alpha')
      expect(frame).toContain('beta')
      expect(frame).toContain('broken')
    })
    // The default composition (alpha) is the current row.
    const frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain('← current')
    // Step to the broken row and press Enter: blocked, no switch, no event.
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      expect(stripSgr(tree.terminal.output)).toContain('broken')
    })
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')).toEqual([])
    expect(tree.ctx.get('agentPresets')!.composedPreset(agent.ctx)).toBe('alpha')
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('Presets')
    })
  })

  it('switches through the picker and the log records the same write path as a typed line', async () => {
    const tree = await bootBlue([], {
      script: [],
      presetFixtures: [
        { id: 'alpha', tool: 'e2e_alpha_tool', order: 1 },
        { id: 'beta', tool: 'e2e_beta_tool', order: 2 },
      ],
    })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, '/preset')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).toContain('Presets')
    })
    // The cursor seeds on the current row (alpha); step down to beta and Enter.
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => {
      expect(stripSgr(tree.terminal.output)).toContain('preset beta')
    })
    const selected = agent.session.events.filter(event => event.type === 'agent-preset/selected')
    expect(selected.map(event => (event.data as { agentPreset: string }).agentPreset)).toEqual(['beta'])
    const runs = agent.session.events.filter(event => event.type === 'command/run')
    expect(runs.map(event => ({ name: event.data.name, args: event.data.args }))).toEqual([
      { name: 'preset', args: '' },
      { name: 'preset', args: ' beta' },
    ])
    expect(tree.ctx.get('agentPresets')!.composedPreset(agent.ctx)).toBe('beta')
  })

  it('/preset answers the unknown-target and blank-session guards', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('ok')],
      presetFixtures: [{ id: 'alpha', tool: 'e2e_alpha_tool', order: 1 }],
    })
    const agent = await currentAgent(tree)
    const unknown = await executeCommand(tree, agent, '/preset nope')
    expect(unknown?.kind).toBe('error')
    expect(unknown?.kind === 'error' ? unknown.text : '').toContain('available:')
    // One real turn opens the session: the blank-only guard refuses after it.
    typeLine(tree.terminal, 'run')
    await agent.whenIdle()
    const locked = await executeCommand(tree, agent, '/preset alpha')
    expect(locked).toEqual({
      kind: 'error',
      text: 'cannot switch presets: this session has already started (blank sessions only)',
    })
    expect(agent.session.events.filter(event => event.type === 'agent-preset/selected')).toEqual([])
  })

  /** A skill fixture root carrying one `deploy-check` skill (S29 e2e). */
  function skillsRootFixture(): string {
    const root = mkdtempTracked('dsh-blue-e2e-skills-')
    mkdirSync(join(root, 'deploy-check'), { recursive: true })
    writeFileSync(join(root, 'deploy-check', 'SKILL.md'), [
      '---',
      'name: deploy-check',
      'description: Checks deployment readiness before shipping',
      '---',
      '',
      'Run the deployment checklist before every release.',
      '',
    ].join('\n'))
    return root
  }

  it('completes # skills, Enter accepts without submitting, and the rewrite drives the gesture', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('skill acknowledged')],
      skills: { root: skillsRootFixture() },
    })
    const agent = await currentAgent(tree)
    // The catalog settles asynchronously off session-changed; typing into
    // the editor before the settle would close the dropdown for the whole
    // token (pi-tui only re-triggers on the next keystroke).
    await vi.waitFor(() => { expect(userInvocableSkills(tree.ctx).length).toBeGreaterThan(0) })
    for (const char of '#deploy-ch') tree.terminal.sendInput(char)
    // Incremental-frame discipline (the R0 lesson): assert only frames
    // written after this mark — the cumulative output could fake-satisfy.
    const mark = tree.terminal.written.length
    await vi.waitFor(() => {
      expect(tree.terminal.written.slice(mark).join('')).toContain('#deploy-check')
    })
    // pi-tui's Enter on a non-slash completion accepts without submitting:
    // the buffer holds the applied token and no request has gone out.
    tree.terminal.sendInput('\r')
    await waitForRender()
    expect(tree.adapter.requests).toHaveLength(0)
    // The second Enter submits: the line rewrites to the gesture form, the
    // tool-skill pre-step appends the injected skill body to the request,
    // and the screen never shows the injection body (D28).
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const messages = tree.adapter.requests[0]!.messages as unknown as Array<{
      content: Array<{ type: string, text: string }>
      source: { kind: string }
    }>
    expect(JSON.stringify(messages)).toContain('/deploy-check')
    const injected = messages.filter(message => message.source.kind === 'skill-invocation')
    expect(injected).toHaveLength(1)
    expect(injected[0]!.content[0]!.text).toContain('<skill_content name="deploy-check">')
    await agent.whenIdle()
    await waitForRender()
    expect(stripSgr(tree.terminal.output)).not.toContain('<skill_content')
    expect(stripSgr(tree.terminal.output)).not.toContain('skill_instructions')
  })

  it('passes an unknown #tag to the model untouched, with no injection', async () => {
    const tree = await bootBlue([], {
      script: [textResponse('plain answer')],
      skills: { root: skillsRootFixture() },
    })
    await currentAgent(tree)
    typeLine(tree.terminal, '#unknown-tag')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(1) })
    const messages = tree.adapter.requests[0]!.messages as unknown as Array<{
      content: Array<{ type: string, text: string }>
      source: { kind: string }
    }>
    // The tag reaches the model verbatim (no rewrite), and no skill body
    // rode along — only the model-facing catalog may mention skills.
    expect(JSON.stringify(messages)).toContain('#unknown-tag')
    expect(JSON.stringify(messages)).not.toContain('/unknown-tag')
    expect(messages.some(message => message.source.kind === 'skill-invocation')).toBe(false)
  })

  it('suspends the renderer around Ctrl-G and repaints fully with the edited draft', async () => {
    // S31 end to end: the Ctrl-G branch resolves the injected launcher (no
    // real child in the e2e), the runtime suspends the renderer for the
    // child's duration, and the resume's forced repaint already carries the
    // edited draft — banner included, i.e. a full frame, not an incremental
    // editor-only update.
    const savedVisual = process.env.VISUAL
    process.env.VISUAL = 'blue-e2e-editor'
    setExternalEditorLauncher((seed, command) => {
      expect(seed).toBe('e2e draft')
      expect(command).toBe('blue-e2e-editor')
      return Promise.resolve('e2e edited\n')
    })
    try {
      const tree = await bootBlue([], { script: [textResponse('ok')] })
      await currentAgent(tree)
      for (const char of 'e2e draft') tree.terminal.sendInput(char)
      await waitForRender()
      const stopCountBefore = tree.terminal.stopCount
      const startCountBefore = tree.terminal.startCount
      // Incremental-frame discipline: assert only frames written after the
      // suspend mark.
      const mark = tree.terminal.written.length
      tree.terminal.sendInput('\x07')
      await vi.waitFor(() => {
        const resumed = tree.terminal.written.slice(mark).join('')
        expect(resumed).toContain('e2e edited')
        expect(resumed).toContain('Welcome to Blue!')
      })
      expect(tree.terminal.stopCount).toBe(stopCountBefore + 1)
      expect(tree.terminal.startCount).toBe(startCountBefore + 1)
    } finally {
      process.env.VISUAL = savedVisual
      setExternalEditorLauncher(undefined)
    }
  })

  it('replays the injected skill body across a resume while the screen stays clean', async () => {
    const persistence = mkdtempTracked('dsh-blue-e2e-skill-resume-')
    const skills = skillsRootFixture()
    const first = await bootBlue([], {
      script: [textResponse('first answer')],
      persistenceRoot: persistence,
      skills: { root: skills },
    })
    const firstAgent = await currentAgent(first)
    // The rewrite reads the settled catalog; typing before the settle
    // would pass the tag through unrewritten (the honest unknown-tag path).
    await vi.waitFor(() => { expect(userInvocableSkills(first.ctx).length).toBeGreaterThan(0) })
    typeLine(first.terminal, '#deploy-check')
    await vi.waitFor(() => { expect(first.adapter.requests).toHaveLength(1) })
    await firstAgent.whenIdle()
    await waitForRender()
    // Live presentation hides the injected body (D28).
    expect(stripSgr(first.terminal.output)).not.toContain('<skill_content')
    await first.ctx.sessions.flush(firstAgent.session)
    const id = String(firstAgent.session.id)
    await first.ctx.fiber.dispose()
    disposers.length = 0

    const second = await bootBlue(['--resume', id], {
      script: [textResponse('second answer')],
      persistenceRoot: persistence,
      skills: { root: skills },
    })
    const agent = await currentAgent(second)
    await waitForRender()
    // Replay converges with the live fold: the skill invocation stays
    // hidden on screen…
    expect(stripSgr(second.terminal.output)).not.toContain('<skill_content')
    // …while the next round's request still carries the earlier injection.
    typeLine(second.terminal, 'go again')
    await vi.waitFor(() => { expect(second.adapter.requests).toHaveLength(1) })
    const replayed = second.adapter.requests[0]!.messages as unknown as Array<{
      content: Array<{ type: string, text: string }>
      source: { kind: string }
    }>
    const injected = replayed.filter(message => message.source.kind === 'skill-invocation')
    expect(injected).toHaveLength(1)
    expect(injected[0]!.content[0]!.text).toContain('<skill_content name="deploy-check">')
    await agent.whenIdle()
  })

  it('/skills renders the read-only catalog panel and Esc restores the editor', async () => {
    const tree = await bootBlue([], { script: [], skills: { root: skillsRootFixture() } })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/skills')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = stripSgr(await fullFrame(tree.terminal))
      expect(frame).toContain('deploy-check')
      expect(frame).toContain('Checks deployment readiness before shipping')
    })
    // The custom fixture root heads its own section.
    const frame = stripSgr(await fullFrame(tree.terminal))
    expect(frame).toContain('custom')
    // Escape closes back to the editor.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('Checks deployment readiness')
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

  it('opens the /permission preset picker on a bare line and cancels without dispatching', async () => {
    const tree = await bootBlue([], { script: [], permissionPresets: true })
    const agent = await currentAgent(tree)
    // The interception lives in the editor submit path, so the line must
    // be typed, not executed through the command runtime.
    typeLine(tree.terminal, '/permission')
    await vi.waitFor(async () => {
      const frame = await fullFrame(tree.terminal)
      expect(frame).toContain('Permissions')
      expect(frame).toContain('read-only')
      expect(frame).toContain('danger-full-access')
      expect(frame).toContain('sandbox danger-full-access · approval never')
      expect(frame).toContain('← current')
    })
    tree.terminal.sendInput('\x1b')
    // Esc restores the editor; no command/run was ever recorded (the log
    // stays honest — only real switches dispatch).
    await vi.waitFor(async () => {
      expect(await fullFrame(tree.terminal)).not.toContain('Permissions')
    })
    expect(agent.session.events.some(event => event.type === 'command/run' && event.data.name === 'permission'))
      .toBe(false)
  })

  it('gates danger-full-access behind the typed-y form and switches presets both ways', async () => {
    const tree = await bootBlue([], { script: [], permissionPresets: true })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, '/permission')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('danger-full-access') })
    // The cursor seeds on the current preset (workspace-write, row 2 of
    // 3): one Down reaches the danger row.
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Full access') })
    // Esc pops the gate back onto the picker.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('danger-full-access') })
    // A wrong entry holds the form open with the validation error.
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Full access') })
    tree.terminal.sendInput('n')
    tree.terminal.sendInput('\r')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('type y to confirm') })
    // The typed y closes both layers and dispatches the real switch.
    tree.terminal.sendInput('\x7f')
    tree.terminal.sendInput('y')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('preset danger-full-access') })
    // The log's first permission/preset is the session-creation pin; the
    // switch is the last one.
    const presets = agent.session.events
      .filter(event => event.type === 'permission/preset')
      .map(event => event.data.preset)
    expect(presets.at(-1)).toBe('danger-full-access')
    const approvalPolicies = agent.session.events
      .filter(event => event.type === 'approval/policy')
      .map(event => event.data.policy)
    expect(approvalPolicies.at(-1)).toBe('never')
    expect(agent.session.events.some(event => event.type === 'sandbox/mode')).toBe(true)
    // Switching back through the panel needs no gate. The cursor re-seeds
    // on the now-current danger row; Down wraps to read-only (row 1 of 3).
    typeLine(tree.terminal, '/permission')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Permissions') })
    tree.terminal.sendInput('\x1b[B')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('preset read-only') })
    const policiesAfter = agent.session.events
      .filter(event => event.type === 'approval/policy')
      .map(event => event.data.policy)
    expect(policiesAfter.at(-1)).toBe('ask')
  })

  it('passes /permission <name> straight through to the upstream command', async () => {
    const tree = await bootBlue([], { script: [], permissionPresets: true })
    const agent = await currentAgent(tree)
    await expect(executeCommand(tree, agent, '/permission nope')).resolves.toMatchObject({
      kind: 'error',
      text: expect.stringContaining('unknown preset "nope"') as string,
    })
    const before = tree.terminal.written.length
    typeLine(tree.terminal, '/permission read-only')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('preset read-only') })
    expect(tree.terminal.written.slice(before).join('')).not.toContain('Permissions')
    const runs = agent.session.events
      .filter((event): event is typeof event & { data: { name: string, args?: string } } =>
        event.type === 'command/run' && event.data.name === 'permission')
      .map(event => event.data.args)
    expect(runs).toEqual([' nope', ' read-only'])
  })

  /** The plan markdown the scripted exit_plan_mode call submits. */
  const PLAN_MD = '# Fix the build\n\n1. One\n2. Two'

  it('renders the plan review panel and approves through Enter', async () => {
    const tree = await bootBlue([], {
      script: [toolCallResponse('c1', 'exit_plan_mode', { plan: PLAN_MD }), textResponse('done')],
    })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    agent.session.append('todo/write', {
      todos: Array.from({ length: 6 }, (_, index) => ({
        content: `plan-task-${index}`,
        status: index === 0 ? 'in_progress' as const : 'pending' as const,
      })),
    })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('plan-task-0') })
    // /plan <message> enters plan mode and steers the draft request.
    await expect(executeCommand(tree, agent, '/plan draft it')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = await fullFrame(tree.terminal)
      expect(frame).toContain('Plan review')
      expect(frame).toContain('Fix the build')
      expect(frame).toContain('1. Approve')
      expect(frame).toContain('2. Reject')
      expect(frame).toContain('3. Revise')
      expect(frame).not.toContain('plan-task-0')
    })
    // The cursor seeds on the approving row.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    const followUp = JSON.stringify(tree.adapter.requests[1]!.messages)
    expect(followUp).toContain('Plan approved')
    await agent.whenIdle()
    expect(planMode.get(agent).active).toBe(false)
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('plan-task-0') })
  })

  it('rejects the plan through the second button and plan mode survives', async () => {
    const tree = await bootBlue([], {
      script: [toolCallResponse('c1', 'exit_plan_mode', { plan: PLAN_MD }), textResponse('ok')],
    })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    await expect(executeCommand(tree, agent, '/plan draft it')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Plan review') })
    // Right moves the choice cursor to Reject.
    tree.terminal.sendInput('\x1b[C')
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    const followUp = JSON.stringify(tree.adapter.requests[1]!.messages)
    expect(followUp).toContain('The user chose to keep planning')
    await agent.whenIdle()
    expect(planMode.get(agent).active).toBe(true)
    // The official transcript presents the plan result as structured text;
    // the legacy warning record is no longer part of this projection path.
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('Fix the build')
    expect(frame).toContain('Fix the build')
    expect(frame).not.toContain('✗ Used exit_plan_mode')
  })

  it('submits revision feedback from the third row: their feedback reaches the model', async () => {
    const tree = await bootBlue([], {
      script: [toolCallResponse('c1', 'exit_plan_mode', { plan: PLAN_MD }), textResponse('ok')],
    })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    await expect(executeCommand(tree, agent, '/plan draft it')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Plan review') })
    // Right twice focuses the inline revision input; typed text rides the
    // row (digits included — the input owns the keys while focused).
    tree.terminal.sendInput('\x1b[C')
    tree.terminal.sendInput('\x1b[C')
    await vi.waitFor(async () => {
      expect(await fullFrame(tree.terminal)).toContain('Type feedback')
    })
    for (const char of 'redo step 2') tree.terminal.sendInput(char)
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    const followUp = JSON.stringify(tree.adapter.requests[1]!.messages)
    expect(followUp).toContain('The user chose to keep planning; their feedback: redo step 2')
    await agent.whenIdle()
    expect(planMode.get(agent).active).toBe(true)
  })

  it('dismisses the plan review on Escape and the crafted message reaches the model', async () => {
    const tree = await bootBlue([], {
      script: [toolCallResponse('c1', 'exit_plan_mode', { plan: PLAN_MD }), textResponse('ok')],
    })
    const agent = await currentAgent(tree)
    const planMode = tree.ctx.get('planMode')!
    await expect(executeCommand(tree, agent, '/plan draft it')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('Plan review') })
    // Esc rejects with ASK_CANCELLED — the code dsh-plan-mode catches to
    // deliver its crafted message instead of the raw rethrow.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    const followUp = JSON.stringify(tree.adapter.requests[1]!.messages)
    expect(followUp).toContain('user dismissed the plan review to speak instead')
    await agent.whenIdle()
    expect(planMode.get(agent).active).toBe(true)
  })
})
