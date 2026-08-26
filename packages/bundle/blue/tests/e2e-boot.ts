/**
 * Shared boot infrastructure for the bundle's whole-tree specs: bootBlue
 * (fixture rows over the real Loader + the real agent spine driven by the
 * scripted MockAdapter), the per-spec state reset, and the input/command
 * helpers. Extracted from e2e.spec.ts so the VT snapshot spec can boot the
 * same tree without importing a spec file (whose top-level describe would
 * re-register every e2e case in this fork).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs'
import { createRequire} from 'node:module'
import { dirname, join} from 'node:path'
import { pathToFileURL} from 'node:url'
import { expect, vi} from 'vitest'
import { Context} from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { Group } from '@deepseek-ai/cordis-plugin-loader'
import AgentPresetsService from '@deepseek-ai/dsh-agent-presets'
import type { Agent} from '@deepseek-ai/dsh-agent'
import type { LlmModelInfo, LlmModelReasoningInfo} from '@deepseek-ai/dsh-llm'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalCredentialsProvider from '@deepseek-ai/dsh-credentials-local'
import { apply as piAiApply, inject as piAiInject} from '@deepseek-ai/dsh-llm-pi-ai'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies} from '@deepseek-ai/dsh-agent-loop-testkit'
import { provideCmdline} from '@deepseek-ai/dsh-cmdline'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import PlanModeController from '@deepseek-ai/dsh-plan-mode'
import type { StreamChunk} from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { SessionProjectionRegistry} from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import * as SessionStats from '@deepseek-ai/dsh-session-stats'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import PermissionPresetsService from '@deepseek-ai/dsh-permission-presets'
import type { ShellExecutor} from '@deepseek-ai/dsh-shell'
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
import * as apiHostPlugin from '../../../api/src/host.ts'
import { BlueComponentsService, BlueKeymapService, BlueScreenService, BlueTerminalInfoService} from '../../../core/src/index.ts'
import * as appPlugin from '../../../app/src/index.ts'
import * as startupPlugin from '../../../app/src/startup.ts'
import { startBlueTerminal} from '../../../core/src/terminal.ts'
import { FakeTerminal} from '../../../core/tests/fake-terminal.ts'
import * as interactionPlugin from '../../../interaction/src/index.ts'
import * as contextPlugin from '../../../context/src/index.ts'
import * as conversationPlugin from '../../../conversation/src/index.ts'
import * as editorPlusPlugin from '../../../interaction/src/editor-plus.ts'
import * as attachmentsPlugin from '../../../interaction/src/attachments.ts'
import * as pasteImagePlugin from '../../../interaction/src/paste-image.ts'
import * as modeStatusPlugin from '../../../interaction/src/mode-status.ts'
import * as paneQueuePlugin from '../../../interaction/src/pane-queue.ts'
import * as interactionBridgePlugin from '../../../interaction/src/plugin-host-bridge.ts'
import * as transcriptPlugin from '../../../transcript/src/index.ts'
import * as officialTranscriptPlugin from '../../../transcript/src/official-model.ts'
import * as bannerPlugin from '../../../transcript/src/banner.ts'
import * as paneActivityPlugin from '../../../transcript/src/pane-activity.ts'
import * as paneBtwPlugin from '../../../transcript/src/pane-btw.ts'
import * as paneTodoPlugin from '../../../transcript/src/pane-todo.ts'
import * as viewBridgePlugin from '../../../transcript/src/plugin-host-bridge.ts'
import * as statusBasicPlugin from '../../../transcript/src/status-basic-model.ts'
import * as statusContextPlugin from '../../../transcript/src/status-context.ts'
import * as statusCwdPlugin from '../../../transcript/src/status-cwd.ts'
import * as statusGitPlugin from '../../../transcript/src/status-git.ts'
import * as statusTitlePlugin from '../../../transcript/src/status-title.ts'
import { CallId} from '@deepseek-ai/dsh-llm'
import { MockAdapter} from './mock-adapter.ts'
// The wizard's models.dev lookup stays offline in the e2e (the fixture
// gateways carry their own metadata paths).
import { setModelsDevLoader} from '../../../interaction/src/models-dev.ts'
import { updaterInternals} from '../../../interaction/src/updater/io.ts'
import { mkdtempTracked, registerTempDirCleanup} from '../../../core/tests/temp-dir.ts'


registerTempDirCleanup()

/**
 * Two tool calls in one response — one agent-loop step. The read group
 * forms per step, so the grouping e2e needs both calls in a single request;
 * the mock's `toolCallResponse` emits one call per response (and per step).
 */
export function twoToolCallsResponse(
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

export const disposers: (() => Promise<void>)[] = []

/**
 * A hand-rolled MCP stdio server for the `/mcp` e2e (S34): newline-delimited
 * JSON-RPC 2.0 with zero dependencies — `initialize` echoes the client's
 * protocol version (always acceptable per the MCP negotiation spec),
 * `tools/list` serves the two fixture tools, `tools/call` answers text, and
 * notifications (no id) get no response. The dsh-mcp-client row spawns it
 * with the running interpreter, so the whole bridge path — loader entry,
 * child process, SDK client, tool registration — runs for real.
 */
const MCP_FIXTURE_SERVER = `
let buffer = ''
const send = message => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim() === '') continue
    const message = JSON.parse(line)
    if (message.id === undefined) continue
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'blue-e2e-fixture', version: '1.0.0' },
      } })
    } else if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools: [
        { name: 'list_items', description: 'List the fixture items.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'How many items to list.' } }, required: [] } },
        { name: 'echo_message', description: 'Echo one message back.', inputSchema: { type: 'object', properties: {} } },
      ] } })
    } else if (message.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'fixture ok' }] } })
    } else if (message.method === 'ping') {
      send({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  }
})
process.stdin.on('end', () => { process.exit(0) })
`

export async function resetBlueModuleState(): Promise<void> {
  for (const dispose of disposers.splice(0)) await dispose()
}

/** One booted Blue tree plus its observations. */
export interface BlueTree {
  ctx: Context
  terminal: FakeTerminal
  adapter: MockAdapter
  exits: number[]
  sessionChanges: Agent[]
  creativeIsolation: { blueScreen?: unknown, commands?: unknown, bluePluginHost?: unknown, tools?: unknown }
}

/** One fixture preset the e2e roster's temp root ships. */
export interface PresetFixture {
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
  apiHostApply: typeof apiHostPlugin.apply
  presetsApply: (ctx: Context) => void
  creativeIsolationApply: (ctx: Context) => void
  coreApply: (ctx: Context) => Promise<void>
  themeDarkApply: typeof themeDarkPlugin.apply
  bannerApply: typeof bannerPlugin.apply
  transcriptApply: typeof transcriptPlugin.apply
  statusBasicApply: typeof statusBasicPlugin.apply
  statusCwdApply: typeof statusCwdPlugin.apply
  statusGitApply: typeof statusGitPlugin.apply
  statusTitleApply: typeof statusTitlePlugin.apply
  statusContextApply: typeof statusContextPlugin.apply
  contextApply: typeof contextPlugin.apply
  conversationApply: typeof conversationPlugin.apply
  officialTranscriptApply: typeof officialTranscriptPlugin.apply
  modeStatusApply: typeof modeStatusPlugin.apply
  paneActivityApply: typeof paneActivityPlugin.apply
  paneQueueApply: typeof paneQueuePlugin.apply
  paneTodoApply: typeof paneTodoPlugin.apply
  paneBtwApply: typeof paneBtwPlugin.apply
  viewBridgeApply: typeof viewBridgePlugin.apply
  interactionApply: typeof interactionPlugin.apply
  interactionBridgeApply: typeof interactionBridgePlugin.apply
  editorPlusApply: typeof editorPlusPlugin.apply
  attachmentsApply: typeof attachmentsPlugin.apply
  pasteImageApply: typeof pasteImagePlugin.apply
  pasteImageConfig: typeof pasteImagePlugin.Config
  startupApply: typeof startupPlugin.apply
  appApply: typeof appPlugin.apply
  appConfig: typeof appPlugin.Config
  /** Session ids the sessionTitle stand-in's refresh recorded (D41 bridge). */
  sessionTitleRefreshes: string[]
}

/**
 * Boot the full Blue tree: fixture rows delegate to the source-plane plugins
 * (the Loader imports through Node's resolver, which cannot reach tsconfig
 * paths). The core row starts the real renderer over the recording terminal.
 * @param argv - inner command-line arguments (`dsh --profile blue <argv>`).
 * @param options - the mock model script, an optional persistence root, and
 *   an optional downstream footer-entry text (adds a fixture row registering
 *   it through the status-model registry).
 */
export async function bootBlue(argv: string[], options: {
  script: ConstructorParameters<typeof MockAdapter>[0]
  /** Keep only the shipped persona row when exercising prompt assembly. */
  creativePersonaOnly?: boolean
  persistenceRoot?: string
  footerExtra?: string
  contextWindow?: number
  /** The advertised model catalog for the mock adapter (listModels). */
  models?: readonly LlmModelInfo[]
  /** The reasoning metadata resolveModelInfo reports. */
  reasoning?: LlmModelReasoningInfo
  /** Mount the real file-backed settings and credentials providers. */
  realSettings?: { settingsPath: string, credentialsPath: string }
  /** Provide a structural credentials seam without local environment layers. */
  credentials?: object
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
  /** Mount the default F3 context row in focused source-plane cases. */
  frontendContext?: boolean
  /** Mount the default F5 conversation rows in focused source-plane cases. */
  officialTranscript?: boolean
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
  /**
   * Real `dsh-mcp-client` entries for the `/mcp` e2e (S34). A live row
   * spawns the hand-rolled fixture server; a `dead` row names a missing
   * binary with reconnects off — the contained failure path (fiber active,
   * no tools). Flag-gated: the entries register real `mcp__` tools, which
   * would perturb every other case's tool surface.
   */
  mcpServers?: readonly {
    readonly id: string
    readonly serverName: string
    readonly dead?: boolean
    readonly env?: Readonly<Record<string, string>>
  }[]
  /**
   * The terminal the renderer drives: the recording FakeTerminal by default;
   * a subclass (the VT snapshot harness's VtTerminal) can mirror every write
   * into a headless terminal while keeping the full recording semantics.
   */
  terminal?: FakeTerminal
}): Promise<BlueTree> {
  const dir = mkdtempTracked('dsh-blue-e2e-')
  // The boot update check stays offline in the e2e (the models.dev
  // precedent): its npm/fetch seams fail fast and its DSH_HOME points at
  // the temp tree, so no spec ever waits on the real registry or touches
  // the developer's own dsh home.
  updaterInternals.env = { DSH_HOME: join(dir, 'dsh-home') }
  updaterInternals.spawnOnce = () =>
    Promise.resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT (e2e offline)' })
  updaterInternals.fetchText = () => Promise.reject(new Error('e2e offline'))
  // S37 puts the dsh host in the workspace (blue-cli's pinned dependency),
  // and the host carries node-addon-require-builtin within the loader's
  // resolution — the loader's internal importer activates on Node 24, and
  // bare rows (the /mcp e2e's dsh-mcp-client) then resolve from this
  // profile's baseUrl, not from the importing module's own tree. A real
  // profile has node_modules beside its cordis.yml; link the one
  // bare-name package in so the temp profile resolves it the same way.
  const mcpClientRoot = dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-mcp-client/package.json'))
  mkdirSync(join(dir, 'node_modules', '@deepseek-ai'), { recursive: true })
  symlinkSync(mcpClientRoot, join(dir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client'))
  // A real dsh profile carries every package referenced by its shipped
  // presets. The e2e profile is otherwise intentionally thin, so mirror
  // that resolution surface for Blue's bundle-owned cordis payload.
  if (options.creativePersonaOnly === true) {
    const presetComposition = readFileSync(new URL('../presets/cordis/agent.cordis.yml', import.meta.url), 'utf8')
    const presetPackages = new Set([...presetComposition.matchAll(/name: '(@deepseek-ai\/[^']+)'/g)]
      .map(match => match[1]!.split('/').slice(0, 2).join('/')))
    const require = createRequire(import.meta.url)
    for (const packageName of presetPackages) {
      const packageRoot = dirname(require.resolve(`${packageName}/package.json`))
      const target = join(dir, 'node_modules', ...packageName.split('/'))
      if (!existsSync(target)) symlinkSync(packageRoot, target)
    }
  }
  const terminal = options.terminal ?? new FakeTerminal()
  const creativeIsolation: BlueTree['creativeIsolation'] = {}
  let presetRoot = ''
  const hooks: BlueE2EHooks = {
    apiHostApply: apiHostPlugin.apply,
    presetsApply: (ctx) => { ctx.plugin(AgentPresetsService, { default: (options.presetFixtures ?? [{ id: 'e2e' }])[0]!.id, roots: [{ path: presetRoot, trust: 'system' }], includeUserRoot: false }) },
    creativeIsolationApply: (ctx) => {
      creativeIsolation.blueScreen = ctx.get('blueScreen')
      creativeIsolation.commands = ctx.get('commands')
      creativeIsolation.bluePluginHost = ctx.get('bluePluginHost')
      creativeIsolation.tools = ctx.get('tools')
    },
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
    statusBasicApply: statusBasicPlugin.apply,
    statusCwdApply: statusCwdPlugin.apply,
    statusGitApply: statusGitPlugin.apply,
    statusTitleApply: statusTitlePlugin.apply,
    statusContextApply: statusContextPlugin.apply,
    contextApply: contextPlugin.apply,
    conversationApply: conversationPlugin.apply,
    officialTranscriptApply: officialTranscriptPlugin.apply,
    modeStatusApply: modeStatusPlugin.apply,
    paneActivityApply: paneActivityPlugin.apply,
    paneQueueApply: paneQueuePlugin.apply,
    paneTodoApply: paneTodoPlugin.apply,
    paneBtwApply: paneBtwPlugin.apply,
    viewBridgeApply: viewBridgePlugin.apply,
    interactionApply: interactionPlugin.apply,
    interactionBridgeApply: interactionBridgePlugin.apply,
    editorPlusApply: editorPlusPlugin.apply,
    attachmentsApply: attachmentsPlugin.apply,
    pasteImageApply: pasteImagePlugin.apply,
    pasteImageConfig: pasteImagePlugin.Config,
    startupApply: startupPlugin.apply,
    appApply: appPlugin.apply,
    appConfig: appPlugin.Config,
    sessionTitleRefreshes: [],
  }
  ;(globalThis as unknown as { __blueE2E: BlueE2EHooks }).__blueE2E = hooks

  const fixture = (file: string, body: string): string => {
    writeFileSync(join(dir, file), body)
    return pathToFileURL(join(dir, file)).href
  }
  const rows = [
    '- id: blue-agent-presets',
    `  name: ${fixture('blue-agent-presets.mjs', `
export const name = 'blue-agent-presets'
export const apply = ctx => globalThis.__blueE2E.presetsApply(ctx)
`)}`,
    '- id: blue-creative-host',
    '  name: cordis:group',
    '  group: true',
    '  isolate:',
    '    blueScreen: true',
    '    commands: true',
    '  config:',
    '    - id: creative-isolation-probe',
    `      name: ${fixture('creative-isolation-probe.mjs', `
export const name = 'creative-isolation-probe'
export const inject = ['bluePluginHost', 'tools']
export const apply = ctx => globalThis.__blueE2E.creativeIsolationApply(ctx)
`)}`,
    '- id: blue-api-host',
    `  name: ${fixture('blue-api-host.mjs', `
export const name = 'blue-api-host'
export const apply = ctx => globalThis.__blueE2E.apiHostApply(ctx)
`)}`,
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
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionReader', 'agentDefaultModel']
export const apply = ctx => globalThis.__blueE2E.bannerApply(ctx)
`)}`,
    '- id: blue-transcript',
    `  name: ${fixture('blue-transcript.mjs', `
export const name = 'blue-transcript'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'blueSessionReader', 'blueSessionProjections']
export const apply = ctx => globalThis.__blueE2E.transcriptApply(ctx)
`)}`,
    // The baseline status row publishes a renderer-neutral StatusModel.
    '- id: blue-status-basic',
    `  name: ${fixture('blue-status-basic.mjs', `
export const name = 'blue-status-basic'
export const inject = ['blueStatusModels', 'blueSessionFacts']
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
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap', 'blueEditorHost', 'blueSessionReader', 'blueSessionActions', 'blueSkillsCatalog', 'blueInteractionState', 'commands']
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
export const inject = ['attachments', 'blueKeymap', 'blueEditorHost', 'blueInteractionState']
export const Config = globalThis.__blueE2E.pasteImageConfig
export const apply = (ctx, config) => globalThis.__blueE2E.pasteImageApply(ctx, config)
`)}`,
    // The enhancement-segment status rows mirror cordis.patch.yml's row
    // order: the cwd abbreviation, the git badge, the rotating tip, and the
    // context occupancy.
    '- id: blue-status-cwd',
    `  name: ${fixture('blue-status-cwd.mjs', `
export const name = 'blue-status-cwd'
export const inject = ['blueStatusModels', 'blueSessionFacts']
export const apply = ctx => globalThis.__blueE2E.statusCwdApply(ctx)
`)}`,
    '- id: blue-status-git',
    `  name: ${fixture('blue-status-git.mjs', `
export const name = 'blue-status-git'
export const inject = ['blueStatusModels', 'blueSessionFacts']
export const apply = ctx => globalThis.__blueE2E.statusGitApply(ctx)
`)}`,
    // The harness session-title service stand-in (the thin e2e tree boots no
    // dsh-base): the structural fold the status-title entry reads, plus the
    // refresh recorder the D41 cadence bridge drives.
    '- id: e2e-session-title',
    `  name: ${fixture('e2e-session-title.mjs', `
export const name = 'e2e-session-title'
export const inject = ['sessionProjections']
export const apply = ctx => {
  const titleSchema = {
    parse: value => {
      if (value === null || typeof value === 'string') return value
      throw new Error('invalid title projection')
    },
  }
  ctx.sessionProjections.register({
    key: 'title',
    stateSchema: titleSchema,
    init: () => null,
    apply: (state, event) => event.type === 'session/title' ? event.data.title : state,
    wire: { viewSchema: titleSchema, view: state => state },
    stateVersion: 1,
  })
  ctx.provide('sessionTitle', {
    get: session => {
      for (let i = session.events.length - 1; i >= 0; i--) {
        const event = session.events[i]
        if (event.type === 'session/title') return { title: event.data.title }
      }
      return undefined
    },
    refresh: session => {
      globalThis.__blueE2E.sessionTitleRefreshes.push(session.id)
      return Promise.resolve(undefined)
    },
  })
}
`)}`,
    '- id: blue-status-title',
    `  name: ${fixture('blue-status-title.mjs', `
export const name = 'blue-status-title'
export const inject = ['blueStatusModels', 'blueSessionFacts']
export const apply = ctx => globalThis.__blueE2E.statusTitleApply(ctx)
`)}`,
    '- id: blue-status-context',
    `  name: ${fixture('blue-status-context.mjs', `
export const name = 'blue-status-context'
export const inject = ['blueStatusModels', 'blueSessionFacts']
export const apply = ctx => globalThis.__blueE2E.statusContextApply(ctx)
`)}`,
    ...(options.frontendContext === true ? [
      '- id: blue-context',
      `  name: ${fixture('blue-context.mjs', `
export const name = 'blue-context'
export const apply = ctx => globalThis.__blueE2E.contextApply(ctx)
`)}`,
    ] : []),
    ...(options.officialTranscript !== false ? [
      '- id: blue-conversation',
      `  name: ${fixture('blue-conversation.mjs', `
export const name = 'blue-conversation'
export const inject = ['sessionProjections']
export const apply = ctx => globalThis.__blueE2E.conversationApply(ctx)
`)}`,
      '- id: blue-transcript-official',
      `  name: ${fixture('blue-transcript-official.mjs', `
export const name = 'blue-transcript-official'
export const inject = ['blueConversationProjection', 'blueSessionProjections', 'blueSessionReader', 'blueTranscriptModels', 'blueToolPresentations']
export const apply = ctx => globalThis.__blueE2E.officialTranscriptApply(ctx)
`)}`,
    ] : []),
    // The S24a mode badge row mirrors cordis.patch.yml: display-only fiber
    // reading the yolo WeakMap and the planMode controller.
    '- id: blue-status-mode',
    `  name: ${fixture('blue-status-mode.mjs', `
export const name = 'blue-status-mode'
export const inject = ['blueStatusModels', 'blueSessionReader', 'blueSessionActions']
export const apply = ctx => globalThis.__blueE2E.modeStatusApply(ctx)
`)}`,
    // The enhancement-segment pane rows mirror cordis.patch.yml; each fixture
    // re-declares the source module's inject list (the activity pane injects
    // blueComponents itself, joining the dock-order activation round).
    '- id: blue-pane-activity',
    `  name: ${fixture('blue-pane-activity.mjs', `
export const name = 'blue-pane-activity'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueSessionFacts', 'blueDockModels']
export const apply = ctx => globalThis.__blueE2E.paneActivityApply(ctx)
`)}`,
    '  inject: [blueComponents, blueSessionFacts]',
    '- id: blue-pane-queue',
    `  name: ${fixture('blue-pane-queue.mjs', `
export const name = 'blue-pane-queue'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'blueDockModels', 'blueSessionReader', 'blueSessionActions']
export const apply = ctx => globalThis.__blueE2E.paneQueueApply(ctx)
`)}`,
    '  inject: [blueComponents, blueSessionReader, blueSessionActions]',
    '- id: blue-pane-todo',
    `  name: ${fixture('blue-pane-todo.mjs', `
export const name = 'blue-pane-todo'
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents', 'blueSessionFacts', 'blueDockModels']
export const apply = ctx => globalThis.__blueE2E.paneTodoApply(ctx)
`)}`,
    '  inject: [blueComponents, blueSessionFacts]',
    '- id: blue-pane-btw',
    `  name: ${fixture('blue-pane-btw.mjs', `
export const name = 'blue-pane-btw'
export const inject = ['blueScreen', 'blueTheme', 'blueComponents', 'commands', 'blueSessionActions', 'blueDockModels']
export const apply = ctx => globalThis.__blueE2E.paneBtwApply(ctx)
`)}`,
    '  inject: [blueComponents, blueSessionActions]',
    '- id: blue-plugin-view-bridge',
    `  name: ${fixture('blue-plugin-view-bridge.mjs', `
export const name = 'blue-plugin-view-bridge'
export const inject = ['bluePluginHost', 'blueScreen', 'blueStatusModels', 'blueTheme', 'blueComponents']
export const apply = ctx => globalThis.__blueE2E.viewBridgeApply(ctx)
`)}`,
    // The assembly segment closes the plain baseline: the interaction row
    // mounts the input editor below every pane row above.
    '- id: blue-interaction',
    `  name: ${fixture('blue-interaction.mjs', `
export const name = 'blue-interaction'
export const inject = ['blueSessionReader', 'blueSessionActions']
export const apply = ctx => globalThis.__blueE2E.interactionApply(ctx)
`)}`,
    '- id: blue-plugin-interaction-bridge',
    `  name: ${fixture('blue-plugin-interaction-bridge.mjs', `
export const name = 'blue-plugin-interaction-bridge'
export const inject = ['bluePluginHost', 'commands', 'blueTheme', 'blueEditorHost']
export const apply = ctx => globalThis.__blueE2E.interactionBridgeApply(ctx)
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
    '  inject: [blueStartup, agentPresets]',
    '  config:',
    '    task: !!js ctx.blueStartup.task',
    '    resume: !!js ctx.blueStartup.resume',
  ]
  // One real dsh-mcp-client entry per fixture server (S34 /mcp e2e): the
  // loader boots the entry, the bridge spawns the child and registers its
  // tools, and /mcp reads the joined truth. The flow-style config is valid
  // YAML and keeps the row assembly one line per field.
  if (options.mcpServers !== undefined) {
    // The child runs by plain path (node's CLI takes no file URL as its
    // entry argument), written once and shared by every live row.
    writeFileSync(join(dir, 'mcp-fixture-server.mjs'), MCP_FIXTURE_SERVER)
    const serverPath = join(dir, 'mcp-fixture-server.mjs')
    for (const server of options.mcpServers) {
      const config = server.dead === true
        ? {
            transport: 'stdio',
            serverName: server.serverName,
            command: 'blue-e2e-missing-binary',
            args: [] as string[],
            env: {},
            cwd: '',
            failOnStartupError: false,
            reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
          }
        : {
            transport: 'stdio',
            serverName: server.serverName,
            command: process.execPath,
            args: [serverPath],
            env: server.env ?? {},
            cwd: '',
            toolCallTimeoutMs: 60_000,
            failOnStartupError: false,
            reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 },
          }
      rows.push(
        `- id: ${server.id}`,
        "  name: '@deepseek-ai/dsh-mcp-client'",
        `  config: ${JSON.stringify(config)}`,
      )
    }
  }
  // A stand-in downstream plugin: one fixture row registering a fixed-text
  // model through the status-model registry, after every bundle row.
  if (options.footerExtra !== undefined) {
    const text = JSON.stringify(options.footerExtra)
    rows.push(
      '- id: blue-e2e-extra',
      `  name: ${fixture('blue-e2e-extra.mjs', `
export const name = 'blue-e2e-extra'
export const inject = ['blueStatusModels']
export const apply = (ctx) => {
  ctx.effect(() => ctx.blueStatusModels.register({ kind: 'status', id: 'e2e-extra', priority: 30, view: { kind: 'text', text: ${text} }, visible: true }))
}
`)}`,
    )
  }
  writeFileSync(join(dir, 'cordis.yml'), [...rows, ''].join('\n'))

  const ctx = new Context()
  // Bare package specifiers (the dsh-mcp-client rows) resolve from the
  // bundle package's own node_modules, as they would from the CLI's
  // installation; every fixture row is an absolute file URL and resolves
  // regardless of the base.
  await ctx.plugin(Loader, { baseUrl: new URL('..', import.meta.url).href })
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  const exits: number[] = []
  provideCmdline(ctx, { args: argv, exit: code => void exits.push(code) })

  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CommandRuntime)
  // The real plan-mode controller, as dsh-base composes it: /plan arrives
  // self-registered and plan/mode events hit the log (S24a e2e).
  await ctx.plugin(PlanModeController, { section: 'Plan mode (e2e): draft only — no mutations.' })
  await ctx.plugin(UserQuestionService)
  if (options.sessionProjections !== false || options.officialTranscript !== false) {
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
  presetRoot = join(dir, 'agent-presets')
  for (const preset of presets) {
    const presetDir = join(presetRoot, preset.id)
    mkdirSync(presetDir, { recursive: true })
    if (preset.id === 'cordis' && options.creativePersonaOnly === true) {
      cpSync(new URL('../presets/cordis/', import.meta.url), presetDir, { recursive: true })
      const compositionPath = join(presetDir, 'agent.cordis.yml')
      const composition = readFileSync(compositionPath, 'utf8')
      const personaStart = composition.indexOf('- id: persona\n')
      const personaEnd = composition.indexOf('\n- id: agent-instructions\n', personaStart)
      if (personaStart < 0 || personaEnd < 0) throw new Error('Blue creative persona row is missing')
      writeFileSync(compositionPath, `${composition.slice(personaStart, personaEnd)}\n`)
    } else if (preset.broken === true) {
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
  } else if (options.credentials !== undefined) {
    ctx.provide('credentials', options.credentials as never)
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

  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  const sessionChanges: Agent[] = []
  let lastSessionId: string | undefined
  const sessionRegistration = ctx.blueSessionReader.subscribe(snapshot => {
    if (snapshot === null || snapshot.id === lastSessionId) return
    const agent = ctx.agents.get(snapshot.id as never)
    if (agent !== undefined) {
      lastSessionId = snapshot.id
      sessionChanges.push(agent)
    }
  })
  ctx.effect(() => () => sessionRegistration.dispose())
  disposers.push(async () => { await ctx.fiber.dispose() })
  return { ctx, terminal, adapter, exits, sessionChanges, creativeIsolation }
}

/** Wait until the app driver has published its first Agent. */
export async function currentAgent(tree: BlueTree): Promise<Agent> {
  let current: Agent | undefined
  await vi.waitFor(() => {
    const session = tree.ctx.blueSessionReader.current()
    expect(session).not.toBeNull()
    current = session === null ? undefined : tree.ctx.agents.get(session.id as never)
    expect(current).toBeDefined()
  })
  return current!
}

/** Type one line into the focused editor and submit it. */
export function typeLine(terminal: FakeTerminal, line: string): void {
  for (const char of line) terminal.sendInput(char)
  terminal.sendInput('\r')
}

/**
 * Execute a slash command through the real registry, exactly as the editor's
 * submit router does. Typing is avoided here so the editor-plus autocomplete
 * cannot intercept the submission and a typed command cannot clobber a draft
 * under test.
 */
export async function executeCommand(tree: BlueTree, agent: Agent, line: string) {
  const execution = await tree.ctx.commands.execute(agent, line, [], new AbortController().signal)
  return execution?.result
}

setModelsDevLoader(() => Promise.resolve(undefined))
