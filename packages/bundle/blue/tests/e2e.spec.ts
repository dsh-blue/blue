/**
 * Whole-tree E2E for the Blue bundle: every Blue plugin row boots through the
 * real Loader from a temp cordis.yml (mirroring cordis.patch.yml's insert
 * rows), the command line arrives through `provideCmdline`, the agent spine
 * is the REAL registry + agent loop driven by a scripted mock LLM adapter
 * (agent-loop-testkit), and the terminal is core's recording FakeTerminal so
 * input is simulated and rendered output asserted. Only the model and the
 * process terminal are substituted.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresetsService from '@deepseek-ai/dsh-agent-presets'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialsProvider from '@deepseek-ai/dsh-credentials-local'
import { apply as piAiApply, inject as piAiInject } from '@deepseek-ai/dsh-llm-pi-ai'
import { createServer } from 'node:http'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as SessionStats from '@deepseek-ai/dsh-session-stats'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetsService from '@deepseek-ai/dsh-permission-presets'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
// The theme modules come from the package subpaths — not relative core
// source paths — because the /theme swap keys registry runtimes by apply
// callback identity: only the module instance interaction's theme-switch
// statically imports (this same lib file) shares a registry record with the
// baseline provider fiber it replaces.
import * as themeDarkPlugin from '@dsh-blue/blue-core/theme-dark'
import * as themeLightPlugin from '@dsh-blue/blue-core/theme-light'
import { BlueComponentsService, BlueKeymapService, BlueScreenService, BlueTerminalInfoService } from '../../../core/src/index.ts'
import * as appPlugin from '../../../app/src/index.ts'
import * as startupPlugin from '../../../app/src/startup.ts'
import { startBlueTerminal } from '../../../core/src/terminal.ts'
import { FakeTerminal, waitForRender } from '../../../core/tests/fake-terminal.ts'
import * as interactionPlugin from '../../../interaction/src/index.ts'
import { clearDraft, stashHistory } from '../../../interaction/src/draft-stash.ts'
import { userInvocableSkills } from '../../../interaction/src/skills-catalog.ts'
import * as editorPlusPlugin from '../../../interaction/src/editor-plus.ts'
import * as attachmentsPlugin from '../../../interaction/src/attachments.ts'
import * as pasteImagePlugin from '../../../interaction/src/paste-image.ts'
import { setClipboardImageReader } from '../../../interaction/src/paste-image.ts'
import { setClipboardOsc52Emitter, setClipboardTextWriter } from '../../../interaction/src/clipboard-write.ts'
import * as modeStatusPlugin from '../../../interaction/src/mode-status.ts'
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
import * as statusCwdPlugin from '../../../transcript/src/status-cwd.ts'
import * as statusGitPlugin from '../../../transcript/src/status-git.ts'
import * as statusTitlePlugin from '../../../transcript/src/status-title.ts'
import { setRecentStepsRetention, setStepFoldingEnabled } from '../../../transcript/src/window.ts'
import { CallId } from '@deepseek-ai/dsh-llm'
import { MockAdapter, reasoningResponse, textResponse, toolCallResponse } from './mock-adapter.ts'
// The wizard's models.dev lookup stays offline in the e2e (the fixture
// gateways carry their own metadata paths).
import { setModelsDevLoader } from '../../../interaction/src/models-dev.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../../core/tests/temp-dir.ts'


registerTempDirCleanup()

/**
 * Two tool calls in one response — one agent-loop step. The read group
 * forms per step, so the grouping e2e needs both calls in a single request;
 * the mock's `toolCallResponse` emits one call per response (and per step).
 */
function twoToolCallsResponse(
  first: { callId: string, name: string, args: object },
  second: { callId: string, name: string, args: object },
): StreamChunk[] {
  const build = (index: number, callId: string, name: string, args: object): StreamChunk[] => {
    const argumentsJson = JSON.stringify(args)
    const id = CallId(callId)
    return [
      { type: 'block-start', index, blockType: 'tool-call' },
      { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsJson.slice(0, 5) },
      { type: 'tool-call-delta', index, id, argumentsDelta: argumentsJson.slice(5) },
      { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    ]
  }
  return [
    ...build(0, first.callId, first.name, first.args),
    ...build(1, second.callId, second.name, second.args),
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const disposers: (() => Promise<void>)[] = []

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
  for (const dispose of disposers.splice(0)) await dispose()
  // In-turn step folding is module-global; restore the defaults so the next
  // spec decides its own policy.
  setStepFoldingEnabled(true)
  setRecentStepsRetention(undefined)
  // The editor stash is module state shared by every booted tree in this
  // worker: don't leak one case's submitted history into the next case's
  // fresh editor.
  clearDraft()
  stashHistory([])
})

/** One booted Blue tree plus its observations. */
interface BlueTree {
  ctx: Context
  terminal: FakeTerminal
  adapter: MockAdapter
  exits: number[]
  sessionChanges: Agent[]
}

/** One fixture preset the e2e roster's temp root ships. */
interface PresetFixture {
  /** The preset id (directory name and roster key). */
  id: string
  /** A tool the preset's composition registers (`e2e` tool names stay distinct). */
  tool?: string
  /** Ship an invalid composition: the roster lists the preset as broken. */
  broken?: boolean
  /** The display order (preset.yml metadata). */
  order?: number
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
  statusCwdApply: typeof statusCwdPlugin.apply
  statusGitApply: typeof statusGitPlugin.apply
  statusTitleApply: typeof statusTitlePlugin.apply
  statusContextApply: typeof statusContextPlugin.apply
  modeStatusApply: typeof modeStatusPlugin.apply
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
  contextWindow?: number
  /** The advertised model catalog for the mock adapter (listModels). */
  models?: readonly LlmModelInfo[]
  /** The reasoning metadata resolveModelInfo reports. */
  reasoning?: LlmModelReasoningInfo
  /** Mount the real file-backed settings and credentials providers. */
  realSettings?: { settingsPath: string, credentialsPath: string }
  /** Mount the real (dormant) llm-pi-ai adapter plugin. */
  piAi?: boolean
  /**
   * Mount the permission-preset family (stub shell + real approval +
   * permission services mirroring the dsh-base table). Flag-gated:
   * pinInitialPermission appends three events to every fresh session,
   * which would perturb the unrelated cases.
   */
  permissionPresets?: boolean
  /**
   * Mount the session-projection family (registry + token-meter +
   * session-stats) exactly as dsh-base composes it, so the /usage and
   * /status panels read the real projections. Flag-gated: the family is
   * the production path, the fold without it is the degraded host's.
   */
  sessionProjections?: boolean
  /**
   * The fixture presets the roster's temp root ships, replacing the default
   * single empty composition (which keeps every other case's tool surface
   * exactly what it registers itself). The first fixture is the roster
   * default the app driver mounts fresh agents onto.
   */
  presetFixtures?: readonly PresetFixture[]
  /**
   * Mount the real skill family (registry + filesystem provider scoped to
   * the given root + tool-skill) so the `#` pipeline runs against the
   * upstream gesture path end to end. Flag-gated: tool-skill publishes a
   * skill catalog into every request, which would perturb unrelated cases.
   */
  skills?: { root: string }
}): Promise<BlueTree> {
  const dir = mkdtempTracked('dsh-blue-e2e-')
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
    statusCwdApply: statusCwdPlugin.apply,
    statusGitApply: statusGitPlugin.apply,
    statusTitleApply: statusTitlePlugin.apply,
    statusContextApply: statusContextPlugin.apply,
    modeStatusApply: modeStatusPlugin.apply,
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
    // The enhancement-segment status rows mirror cordis.patch.yml's row
    // order: the cwd abbreviation, the git badge, the rotating tip, and the
    // context occupancy.
    '- id: blue-status-cwd',
    `  name: ${fixture('blue-status-cwd.mjs', `
export const name = 'blue-status-cwd'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.statusCwdApply(ctx)
`)}`,
    '- id: blue-status-git',
    `  name: ${fixture('blue-status-git.mjs', `
export const name = 'blue-status-git'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.statusGitApply(ctx)
`)}`,
    // The harness session-title service stand-in (the thin e2e tree boots no
    // dsh-base): the structural fold the status-title entry reads.
    '- id: e2e-session-title',
    `  name: ${fixture('e2e-session-title.mjs', `
export const name = 'e2e-session-title'
export const apply = ctx => ctx.provide('sessionTitle', {
  get: session => {
    for (let i = session.events.length - 1; i >= 0; i--) {
      const event = session.events[i]
      if (event.type === 'session/title') return { title: event.data.title }
    }
    return undefined
  },
})
`)}`,
    '- id: blue-status-title',
    `  name: ${fixture('blue-status-title.mjs', `
export const name = 'blue-status-title'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.statusTitleApply(ctx)
`)}`,
    '- id: blue-status-context',
    `  name: ${fixture('blue-status-context.mjs', `
export const name = 'blue-status-context'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme']
export const apply = ctx => globalThis.__blueE2E.statusContextApply(ctx)
`)}`,
    // The S24a mode badge row mirrors cordis.patch.yml: display-only fiber
    // reading the yolo WeakMap and the planMode controller.
    '- id: blue-status-mode',
    `  name: ${fixture('blue-status-mode.mjs', `
export const name = 'blue-status-mode'
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.modeStatusApply(ctx)
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
    // re-declares the source module's inject list (the activity pane injects
    // blueComponents itself, joining the dock-order activation round).
    '- id: blue-pane-activity',
    `  name: ${fixture('blue-pane-activity.mjs', `
export const name = 'blue-pane-activity'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.paneActivityApply(ctx)
`)}`,
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
  // The real plan-mode controller, as dsh-base composes it: /plan arrives
  // self-registered and plan/mode events hit the log (S24a e2e).
  await ctx.plugin(PlanModeController, { section: 'Plan mode (e2e): draft only — no mutations.' })
  await ctx.plugin(UserQuestionService)
  if (options.sessionProjections === true) {
    // The projection family as dsh-base composes it: the registry drives
    // the token-meter and session-stats units over every committed event.
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TokenMeter)
    await ctx.plugin(SessionStats)
  }
  if (options.permissionPresets === true) {
    // The permission family as dsh-base composes it: a minimal sandboxed
    // shell stand-in (the presets service only reads sandboxMode at load),
    // the real approval service (the /permission command writes its live
    // policy), and the preset table exactly as the base patch declares it
    // (bare keys — no names, no descriptions).
    ctx.provide('shell', { sandboxMode: 'workspace-write' } as unknown as ShellExecutor)
    await ctx.plugin(ApprovalService, {})
    await ctx.plugin(PermissionPresetsService, {
      presets: {
        'read-only': { sandbox: 'read-only', approval: 'ask' },
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      },
    })
  }
  // The agent-preset roster, as the bundle patch now composes it (the
  // thin-host migration): every agent the driver creates joins its preset's
  // standing composition. The real service over a temp root; the writable
  // user root stays off so a developer's own presets never leak in. The
  // default fixture is one EMPTY composition — every plain case's tool
  // surface stays exactly what it registers itself, unchanged from before
  // the migration; preset cases pass richer fixtures.
  const presets = options.presetFixtures ?? [{ id: 'e2e' }]
  const presetRoot = join(dir, 'agent-presets')
  for (const preset of presets) {
    const presetDir = join(presetRoot, preset.id)
    mkdirSync(presetDir, { recursive: true })
    if (preset.broken === true) {
      // Parses, then fails the entry-list audit: the roster lists it broken.
      writeFileSync(join(presetDir, 'agent.cordis.yml'), 'not-a-list: true\n')
    } else if (preset.tool !== undefined) {
      const tool = JSON.stringify(preset.tool)
      const toolRow = fixture(`${preset.id}-tool.mjs`, `
export const name = '${preset.id}-tool'
export const inject = ['tools']
export const apply = (ctx) => {
  ctx.effect(() => ctx.tools.register({
    name: ${tool},
    description: 'The ${preset.id} preset fixture tool',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => '' },
    execute: async () => ({}),
  }))
}
`)
      writeFileSync(join(presetDir, 'agent.cordis.yml'), `- name: '${toolRow}'\n`)
    } else {
      writeFileSync(join(presetDir, 'agent.cordis.yml'), '[]\n')
    }
    if (preset.order !== undefined) {
      writeFileSync(join(presetDir, 'preset.yml'), `order: ${preset.order}\n`)
    }
  }
  await ctx.plugin(AgentPresetsService, {
    default: presets[0]!.id,
    roots: [{ path: presetRoot, trust: 'system' }],
    includeUserRoot: false,
  })
  if (options.skills !== undefined) {
    // The skill family (S29): the real registry, the filesystem provider
    // isolated to the fixture root (no default project/user/bundled
    // roots, so the catalog is exactly the fixture's), and tool-skill —
    // its `agents`/`tools` dependencies come from the agent-loop
    // testkit's registry/runtime mounts above. Tool-skill owns the
    // `/name` gesture pre-step (the injected `<skill_content>` body) and
    // the model-facing skill catalog.
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      includeDefaultRoots: false,
      customSkillDirs: [options.skills.root],
      watch: true,
    })
    await ctx.plugin(toolSkill)
  }
  // The settings family mounts before the default-model service so the
  // latter's settings-backed default tier resolves through the file.
  if (options.realSettings !== undefined) {
    await ctx.plugin(FileSettingsProvider, { path: options.realSettings.settingsPath, watch: false })
    await ctx.plugin(LocalCredentialsProvider, { path: options.realSettings.credentialsPath, watch: false })
  }
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'mock', model: 'mock' })
  if (options.piAi === true) {
    // The dormant posture: the installed catalog registers the
    // configurable-provider directory and the discovery seam, no routes.
    await ctx.plugin({ name: 'llm-pi-ai', inject: [...piAiInject], apply: piAiApply }, {})
  }
  if (options.persistenceRoot !== undefined) {
    await ctx.plugin(JsonlSessionPersistence, { root: options.persistenceRoot })
  }
  const adapter = new MockAdapter(
    options.script,
    options.reasoning,
    undefined,
    options.contextWindow,
    options.models,
  )
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
 * Execute a slash command through the real registry, exactly as the editor's
 * submit router does. Typing is avoided here so the editor-plus autocomplete
 * cannot intercept the submission and a typed command cannot clobber a draft
 * under test.
 */
async function executeCommand(tree: BlueTree, agent: Agent, line: string) {
  const execution = await tree.ctx.commands.execute(agent, line, [], new AbortController().signal)
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

setModelsDevLoader(() => Promise.resolve(undefined))

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
    expect(output).toContain('Welcome to Blue!')
    expect(output).toContain(`blue v${BLUE_VERSION}`)
    // AgentDefaultModelConfig mounts provider/model 'mock'; the banner
    // snapshots the selection at mount.
    expect(output).toContain('mock · mock')
    // The eighty-column right cell is past the section threshold, so the
    // quick-start tips join even on the default terminal — and they are the
    // real derived pool texts (S16), not placeholders: '! to run a shell
    // command' is short enough to survive the 32-column right-cell budget
    // at eighty columns whole.
    expect(output).toContain('Tips for getting started')
    expect(output).toContain('! to run a shell command')
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
    expect(frame).toContain('Tips for getting started')
    // The kimi gutter insets the banner one column on both sides (D29,
    // S21): a row spans the leading gutter column plus `columns - 2`
    // banner columns — no cap, but no full bleed either.
    const bannerRow = frame.split('\r\n').find(row => row.includes('Welcome to Blue!')) ?? ''
    const plain = bannerRow
      // Strip every escape flavor the renderer emits: SGR runs, CSI
      // modes (?2031h ...), OSC 8 hyperlink tails, and stray controls.
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\u0007]*\u0007/g, '')
      .replace(/[\u0000-\u001f]/g, '')
    // fullFrame bumps the width by one to force the repaint.
    expect(plain.trimEnd().length).toBe(tree.terminal.columns - 1)
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

  it('an Esc-interrupted thinking block settles: no ghost spinner beside the next turn', async () => {
    // The S24a dogfood find: the interrupted turn ends with no
    // assistant/message, so the thinking block's streaming flag never
    // flipped and its spinner kept animating after the next message — two
    // working rows. The settled block must render its folded form only.
    const tree = await bootBlue([], { script: ['hang-reasoning', reasoningResponse('second thought', 'done')] })
    const agent = await currentAgent(tree)
    typeLine(tree.terminal, 'first')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('pondering the question at hand') })
    tree.terminal.sendInput('\x1b')
    await agent.whenIdle()
    // Interrupted and idle: the tombstone row replaces the stream, and no
    // live thinking row may remain beside it.
    await vi.waitFor(async () => {
      const frame = await fullFrame(tree.terminal)
      expect(frame.includes('⏹ interrupted')).toBe(true)
      expect(frame.includes('thinking...')).toBe(false)
    })
    // The next turn streams its own thinking and completes; still no ghost.
    typeLine(tree.terminal, 'second')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    await agent.whenIdle()
    await vi.waitFor(async () => {
      expect((await fullFrame(tree.terminal)).includes('thinking...')).toBe(false)
    })
    // Both reasonings stay readable in their settled folded form.
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('pondering the question at hand')
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
    // Collapsed (the default): the S20 kimi card header (✓ mark, Used verb,
    // bold name, lines chip), the 3-row preview, and the expand hint; the
    // tail of the full output does not.
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('✓ Used long-output')
    expect(shown).toContain(' · 1 line')
    expect(shown).toContain('more lines, ')
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
    setStepFoldingEnabled(false)
    typeLine(tree.terminal, 'edit the file')
    await agent.whenIdle()
    await waitForRender()
    // Compare against SGR-stripped output so marker/text adjacency survives
    // the separate color spans ('-' marker + removed text, '+' + added).
    // The S20 kimi header carries the verb, tool name, and the +A -R chip;
    // the per-file title/path lines are gone (the path belongs to the key
    // argument, absent here because the scripted call carries no args).
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('✓ Used edit-file')
    expect(shown).toContain(' · +2 -1')
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
    process.env.DSH_BLUE_ATTACHMENT_DIR = mkdtempTracked('dsh-blue-e2e-attachments-')
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
    // Retention 0 pins the folding mechanism itself (each step/start folds
    // the previous step); the default 30-step window gets its own case below.
    setRecentStepsRetention(0)
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

  it('groups two same-step Reads into the kimi tree', async () => {
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
    const shown = tree.terminal.output.replace(/\x1b\[[0-9;]*m/g, '')
    expect(shown).toContain('Read 2 files')
    expect(shown).toContain('· 6 lines')
    expect(shown).toContain('├─ src/a.ts')
    expect(shown).toContain('└─ src/b.ts')
    expect(shown).toContain('read done')
  })

  it('keeps a multi-step turn\'s tool cards expanded under the kimi 30-step retention', async () => {
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
    clearDraft()
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
    clearDraft()
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
    clearDraft()
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
    clearDraft()
    // The dropdown renders inside the editor's content width — the frame
    // bars and the editor's own paddingX are both shaved off it — so a
    // 56-column terminal leaves the description column (31 wide) narrower
    // than /sessions' 42-char summary while still past the width-40 gate.
    tree.terminal.resize(56, 24)
    tree.terminal.sendInput('/sess')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/sessions') })
    const frame = await fullFrame(tree.terminal)
    const rows = frame.split('\r\n')
    // The dropdown row, not the discovery hint row below the frame, carries
    // the side-bar-anchored two-line treatment.
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

  it('renders a footer entry registered by a downstream plugin through blueStatus', async () => {
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
      // carries the light roleUser bullet (#953800), not dark's #f0c674 —
      // bold-wrapped per the S18 kimi user chrome.
      await vi.waitFor(() => {
        const rendered = tree.terminal.written.slice(beforeSwitch).join('')
        expect(rendered).toContain('show palette')
        expect(rendered).toContain('palette reply')
        expect(rendered).toContain('\x1b[1m\x1b[38;2;149;56;0m✨ ')
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
    expect(running).toContain('🌑')
    // Dock order (S12): the footer pins to the terminal's last rows, the
    // editor sits above it, and the spinner above the editor (the first
    // gray `border` frame run at or after the spinner — the idle editor
    // frame is neutral since S11).
    const footerAt = running.indexOf(`${FOOTER_TEXT_SGR}mock`)
    const spinnerAt = running.indexOf('· Tip: ')
    const borderAt = running.indexOf(EDITOR_BORDER_SGR, spinnerAt)
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(borderAt).toBeGreaterThan(spinnerAt)
    expect(footerAt).toBeGreaterThan(borderAt)
    tree.terminal.sendInput('\x03')
    await agent.whenIdle()
    const idle = await fullFrame(tree.terminal)
    expect(idle).not.toContain('🌑')
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
    expect(frame).not.toContain('🌑')
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
    expect(waiting).toContain('🌑')
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
    expect(paneled).not.toContain('🌑')
    expect(paneled).not.toContain('· Tip: ')

    // Dismiss restores the spinner.
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => { expect(await fullFrame(tree.terminal)).toContain('🌑') })
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
    // Dock order (S12): the footer pins to the terminal's last rows, then
    // the editor's rounded top border, then the todo pane above it (the
    // first gray `border` frame run at or after the pane — the idle editor
    // frame is neutral since S11).
    const expanded = await fullFrame(tree.terminal)
    const footer = expanded.indexOf(`${FOOTER_TEXT_SGR}mock`)
    const todo = expanded.indexOf('active-task')
    const editorBorder = expanded.indexOf(EDITOR_BORDER_SGR, todo)
    expect(footer).toBeGreaterThanOrEqual(0)
    expect(editorBorder).toBeGreaterThan(todo)
    expect(footer).toBeGreaterThan(editorBorder)
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
    setStepFoldingEnabled(false)
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
    expect(shown).toContain('probe output')
    expect(shown).toContain('plain answer')
    expect(shown).not.toContain('todo_write')
    expect(shown).not.toContain('todos updated')
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
    const footerAt = docked.indexOf(`${FOOTER_TEXT_SGR}mock`)
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
    // PageDown thrice scrolls to the tail of the Keys section — including
    // the pane-todo global action; the accumulated output carries the rows
    // once the throttled render settles. (Three presses since S27' added
    // /init: 38 content rows need the third 10-row step to clamp at the
    // scroll floor.)
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    tree.terminal.sendInput('\x1b[6~')
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('Toggle todo list expansion') })
    const scrolled = tree.terminal.output
    expect(scrolled).toContain('ctrl+c')
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
    clearDraft()
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
    clearDraft()
  })

  it('recalls a /theme argument submission after the swap rebuilds the editor', async () => {
    const tree = await bootBlue([], { script: [] })
    await currentAgent(tree)
    tree.terminal.sendInput('\x1b')
    tree.terminal.sendInput('\x1b')
    clearDraft()
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
    clearDraft()
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
    clearDraft()
  })

  it('switches sessions through /new and /fork, and lists them in the /sessions picker', async () => {
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
    await expect(executeCommand(tree, agent, '/help')).resolves.toEqual({ kind: 'success' })
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('/model') })
    expect(tree.terminal.output).toContain('/effort (/thinking)')
    expect(tree.terminal.output).toContain('/provider')
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
    expect(picker).toContain('[ High ]')
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
    expect(tree.terminal.output).toContain('[ Default ]')
    expect(tree.terminal.output).toContain('  High  ')
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
    const tree = await bootBlue([], {
      script: [textResponse('unused')],
      realSettings: { settingsPath: `${dir}/settings.yaml`, credentialsPath: `${dir}/.credentials.yaml` },
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
    await vi.waitFor(() => { expect(tree.terminal.output).toContain('via the credentials service') })
    // Field 1 is the optional baseURL override — skip it, then the key.
    tree.terminal.sendInput('\r')
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

  it('moves modelRef to the fresh session on /new', async () => {
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
    const modelRef = tree.ctx.get('blueSession')!.modelRef
    expect(modelRef).toBeDefined()
    // The fresh agent reads the default tier: mock.
    expect(modelRef!.current).toMatchObject({ provider: 'mock', model: 'mock' })
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
    await vi.waitFor(() => { expect(tree.ctx.get('blueSession')?.current).not.toBe(agent) })
    const fresh = tree.ctx.get('blueSession')?.current
    expect(fresh).toBeDefined()
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
    const forked = await vi.waitFor(() => {
      const next = tree.ctx.get('blueSession')?.current
      expect(next).toBeDefined()
      expect(next).not.toBe(agent)
      return next!
    })
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
    expect(frame).toContain('64.1k / 8k')
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
    expect(frame).toContain('0.1.1-rc.1')
    // The panel is version-only: no model section even with a live session.
    expect(frame).not.toContain('mock (mock)')
    // Escape restores the editor: the panel leaves the next full frame
    // (the version section heading is the panel-only marker).
    tree.terminal.sendInput('\x1b')
    await vi.waitFor(async () => {
      expect(stripSgr(await fullFrame(tree.terminal))).not.toContain('Version')
    })
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
    await vi.waitFor(() => { expect(userInvocableSkills().length).toBeGreaterThan(0) })
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
    await vi.waitFor(() => { expect(userInvocableSkills().length).toBeGreaterThan(0) })
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
    // /plan <message> enters plan mode and steers the draft request.
    await expect(executeCommand(tree, agent, '/plan draft it')).resolves.toMatchObject({ kind: 'success' })
    await vi.waitFor(async () => {
      const frame = await fullFrame(tree.terminal)
      expect(frame).toContain('Plan review')
      expect(frame).toContain('Fix the build')
      expect(frame).toContain('1. Approve')
      expect(frame).toContain('2. Reject')
      expect(frame).toContain('3. Revise')
    })
    // The cursor seeds on the approving row.
    tree.terminal.sendInput('\r')
    await vi.waitFor(() => { expect(tree.adapter.requests).toHaveLength(2) })
    const followUp = JSON.stringify(tree.adapter.requests[1]!.messages)
    expect(followUp).toContain('Plan approved')
    await agent.whenIdle()
    expect(planMode.get(agent).active).toBe(false)
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
    // The declined review renders as the warning-tone decision record,
    // not the ✗ error card (the round-3 ruling).
    const frame = await fullFrame(tree.terminal)
    expect(frame).toContain('plan declined')
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
