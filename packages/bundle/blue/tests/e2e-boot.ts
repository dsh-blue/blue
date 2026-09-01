/** Shared direct-service whole-tree boot fixture.
 * @module @dsh-blue/blue/tests/e2e-boot
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as apiPlugin from '../../../api/src/index.ts'
import type {
  BlueEditorExtensionRegistry,
  BlueOverlayRegistry,
  BluePaneRegistry,
  BlueStatusRegistry,
} from '../../../api/src/contracts.ts'
import * as appPlugin from '../../../app/src/index.ts'
import type { BlueCurrentAgentService } from '../../../app/src/current-agent.ts'
import {
  BlueComponentsService,
  BlueKeymapService,
  BlueScreenService,
  BlueTerminalInfoService,
} from '../../../core/src/index.ts'
import { mountBlueSurfaceRenderer } from '../../../core/src/surface-renderer.ts'
import { startBlueTerminal } from '../../../core/src/terminal.ts'
import type { BlueTerminalRuntime } from '../../../core/src/terminal.ts'
import * as themeDarkPlugin from '../../../core/src/theme-dark.ts'
import { FakeTerminal } from '../../../core/tests/fake-terminal.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../../core/tests/temp-dir.ts'

registerTempDirCleanup()

interface CommandDefinitionProbe {
  readonly name: string
  readonly description: string
  readonly handler: () => unknown | Promise<unknown>
}

class CommandServiceProbe extends Service {
  private readonly entries = new Map<string, CommandDefinitionProbe>()
  constructor(ctx: Context) { super(ctx, 'commands') }
  register(definition: CommandDefinitionProbe): () => void {
    if (this.entries.has(definition.name)) throw new Error(`duplicate command ${definition.name}`)
    this.entries.set(definition.name, definition)
    return this.ctx.effect(() => () => { this.entries.delete(definition.name) })
  }
  find(name: string): CommandDefinitionProbe | undefined { return this.entries.get(name) }
  list(): readonly CommandDefinitionProbe[] { return [...this.entries.values()] }
}

class ProjectionServiceProbe extends Service {
  readonly calls: Array<{ readonly session: unknown, readonly keys: readonly string[] }> = []
  constructor(ctx: Context) { super(ctx, 'sessionProjections') }
  snapshot(session: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> {
    this.calls.push({ session, keys })
    return Object.freeze({})
  }
}

class ToolServiceProbe extends Service {
  readonly scopes: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'tools') }
  schemas(agent: Agent): readonly unknown[] {
    this.scopes.push(agent)
    return []
  }
}

interface DirectContext extends Context {
  readonly commands: CommandServiceProbe
  readonly sessionProjections: ProjectionServiceProbe
  readonly tools: ToolServiceProbe
  readonly blueCurrentAgent: BlueCurrentAgentService
  readonly bluePanes: BluePaneRegistry
  readonly blueStatus: BlueStatusRegistry
  readonly blueOverlays: BlueOverlayRegistry
  readonly blueEditorExtensions: BlueEditorExtensionRegistry
}

interface FakeSession {
  readonly id: string
  readonly events: unknown[]
  readonly header: { readonly cwd: string }
  readonly surface: { readonly nodes: readonly unknown[] }
  requestHeader(): undefined
}

interface FakeAgent extends Agent {
  readonly session: FakeSession
}

function fakeAgent(id: string): FakeAgent {
  const session: FakeSession = {
    id,
    events: [],
    header: { cwd: process.cwd() },
    surface: { nodes: [] },
    requestHeader: () => undefined,
  }
  return {
    id: session.id,
    session,
    status: 'idle',
    options: {},
    followup() {},
    cancel() {},
  } as unknown as FakeAgent
}

export interface DirectObservations {
  readonly selectedAgents: Agent[]
  readonly selectedSessions: unknown[]
  readonly serviceVisibility: Record<string, boolean>
}

interface DirectHooks {
  readonly apiApply: typeof apiPlugin.apply
  readonly themeApply: typeof themeDarkPlugin.apply
  readonly appApply: typeof appPlugin.apply
  readonly appInject: typeof appPlugin.inject
  coreApply(ctx: Context): Promise<void>
  consumerApply(ctx: Context): void
}

export interface DirectBlueTree {
  readonly ctx: Context
  readonly terminal: FakeTerminal
  readonly observations: DirectObservations
  readonly commands: CommandServiceProbe
  readonly projections: ProjectionServiceProbe
  readonly tools: ToolServiceProbe
  readonly controller: {
    readonly created: string[]
    readonly forks: Array<{ readonly sessionId: unknown, readonly atSeq?: number }>
  }
  readonly exits: number[]
}

export const disposers: Array<() => Promise<void>> = []

export async function resetDirectBlue(): Promise<void> {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
}

/** Boot actual Blue API/app/theme/core code through a real Loader composition. */
export async function bootDirectBlue(options: { readonly terminal?: FakeTerminal } = {}): Promise<DirectBlueTree> {
  const dir = mkdtempTracked('dsh-blue-direct-e2e-')
  const terminal = options.terminal ?? new FakeTerminal(80, 24)
  const observations: DirectObservations = {
    selectedAgents: [],
    selectedSessions: [],
    serviceVisibility: {},
  }

  const hooks: DirectHooks = {
    apiApply: apiPlugin.apply,
    themeApply: themeDarkPlugin.apply,
    appApply: appPlugin.apply,
    appInject: appPlugin.inject,
    async coreApply(ctx) {
      const runtime = await startBlueTerminal(terminal, () => Promise.resolve(undefined))
      const keymap = new BlueKeymapService(ctx)
      ctx.effect(() => runtime.tui.addInputListener(data => (keymap.dispatch(data) ? { consume: true } : undefined)))
      ctx.plugin(BlueTerminalInfoService, { background: runtime.background, kittyKeyboard: runtime.kittyKeyboard })
      ctx.plugin(BlueScreenService, runtime)
      ctx.plugin({
        name: 'blue-components',
        inject: ['blueTheme'],
        apply(componentCtx: Context) {
          componentCtx.plugin(BlueComponentsService, { theme: componentCtx.blueTheme, tui: runtime.tui })
        },
      })
      ctx.plugin({
        name: 'blue-surface-renderer',
        inject: ['bluePanes', 'blueOverlays', 'blueComponents', 'blueTheme', 'blueKeymap'],
        apply(rendererCtx: Context) {
          mountBlueSurfaceRenderer(rendererCtx as Parameters<typeof mountBlueSurfaceRenderer>[0], runtime)
        },
      })
      ctx.effect(() => () => runtime.stop())
    },
    consumerApply(ctx) {
      const direct = ctx as unknown as DirectContext
      for (const service of [
        'commands',
        'sessionProjections',
        'tools',
        'blueCurrentAgent',
        'bluePanes',
        'blueStatus',
        'blueOverlays',
        'blueEditorExtensions',
      ]) observations.serviceVisibility[service] = ctx.get(service) !== undefined

      direct.bluePanes.register({
        id: 'e2e.direct-pane',
        title: 'Direct plugin',
        placement: 'bottom',
        size: { min: 2, preferred: 3, max: 4 },
        render: () => ({ kind: 'text', content: 'native dsh + Blue seam' }),
      })
      direct.blueStatus.register({
        id: 'e2e.direct-status',
        visible: true,
        node: { kind: 'text', content: 'direct' },
      })
      direct.blueEditorExtensions.register({ id: 'e2e.direct-editor', hint: 'Direct extension' })
      direct.commands.register({
        name: 'direct-overlay',
        description: 'Open the direct overlay',
        handler: () => {
          direct.blueOverlays.close('e2e.direct-overlay')
          direct.blueOverlays.open({
            id: 'e2e.direct-overlay',
            title: 'Direct overlay',
            capturing: true,
            render: () => ({ kind: 'text', content: 'opened through the direct Blue service' }),
          })
          return { kind: 'success' }
        },
      })
      direct.blueCurrentAgent.subscribe(agent => {
        if (agent === null) return
        observations.selectedAgents.push(agent)
        observations.selectedSessions.push(agent.session)
        direct.sessionProjections.snapshot(agent.session, ['blueConversation'])
        direct.tools.schemas(agent)
      })
    },
  }
  ;(globalThis as unknown as { __blueDirectE2E: DirectHooks }).__blueDirectE2E = hooks

  const fixture = (file: string, source: string): string => {
    writeFileSync(join(dir, file), source)
    return pathToFileURL(join(dir, file)).href
  }
  const rows = [
    '- id: blue-api',
    `  name: ${fixture('blue-api.mjs', `
export const name = 'blue-api'
export const apply = ctx => globalThis.__blueDirectE2E.apiApply(ctx)
`)}`,
    '- id: blue-theme-dark',
    `  name: ${fixture('blue-theme-dark.mjs', `
export const name = 'blue-theme-dark'
export const apply = ctx => globalThis.__blueDirectE2E.themeApply(ctx)
`)}`,
    '- id: blue-core',
    `  name: ${fixture('blue-core.mjs', `
export const name = 'blue-core'
export const apply = ctx => globalThis.__blueDirectE2E.coreApply(ctx)
`)}`,
    '- id: blue-app',
    `  name: ${fixture('blue-app.mjs', `
export const name = 'blue-app'
export const inject = globalThis.__blueDirectE2E.appInject
export const apply = ctx => globalThis.__blueDirectE2E.appApply(ctx, {})
`)}`,
    '- id: direct-sibling',
    `  name: ${fixture('direct-sibling.mjs', `
export const name = 'direct-sibling'
export const inject = ['commands', 'sessionProjections', 'tools', 'blueCurrentAgent', 'bluePanes', 'blueStatus', 'blueOverlays', 'blueEditorExtensions']
export const apply = ctx => globalThis.__blueDirectE2E.consumerApply(ctx)
`)}`,
    '',
  ]
  writeFileSync(join(dir, 'cordis.yml'), rows.join('\n'))

  const ctx = new Context()
  const exits: number[] = []
  const agents = new Map<string, FakeAgent>()
  let sequence = 0
  const created: string[] = []
  const forks: Array<{ sessionId: unknown, atSeq?: number }> = []
  const createAgent = (prefix: string): FakeAgent => {
    const agent = fakeAgent(`${prefix}-${String(++sequence)}`)
    agents.set(String(agent.id), agent)
    return agent
  }
  const controller = {
    created,
    forks,
    async create() {
      const agent = createAgent('session')
      created.push(String(agent.id))
      return { sessionId: agent.id }
    },
    async resolveAgent(id: unknown) {
      const agent = agents.get(String(id))
      return agent === undefined ? { error: new Error(`unknown session ${String(id)}`) } : { agent }
    },
    async fork(input: { sessionId: unknown, atSeq?: number }) {
      forks.push(input)
      const agent = createAgent('fork')
      return { sessionId: agent.id }
    },
  }
  ctx.provide('appExit', (code: number) => { exits.push(code) })
  ctx.provide('blueStartup', { task: undefined, resume: undefined } as never)
  ctx.provide('agents', { get: (id: unknown) => agents.get(String(id)), list: () => [...agents.values()] } as never)
  ctx.provide('sessionController', controller as never)
  const commandFiber = await ctx.plugin(CommandServiceProbe)
  const projectionFiber = await ctx.plugin(ProjectionServiceProbe)
  const toolFiber = await ctx.plugin(ToolServiceProbe)
  const commands = ctx.get('commands') as unknown as CommandServiceProbe
  const projections = ctx.get('sessionProjections') as unknown as ProjectionServiceProbe
  const tools = ctx.get('tools') as unknown as ToolServiceProbe
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()

  disposers.push(async () => {
    await ctx.fiber.dispose()
    await Promise.all([commandFiber.dispose(), projectionFiber.dispose(), toolFiber.dispose()])
  })
  return { ctx, terminal, observations, commands, projections, tools, controller, exits }
}

/** Wait for app startup to select the exact live Agent. */
export async function currentAgent(tree: DirectBlueTree): Promise<Agent> {
  let agent: Agent | null = null
  for (let turn = 0; turn < 100; turn += 1) {
    agent = (tree.ctx.get('blueCurrentAgent') as BlueCurrentAgentService | undefined)?.current() ?? null
    if (agent !== null) return agent
    await Promise.resolve()
  }
  throw new Error('Blue app did not select an Agent')
}

/** Execute the fixture's ordinary native command definition. */
export async function executeDirectOverlay(tree: DirectBlueTree): Promise<unknown> {
  const command = tree.commands.find('direct-overlay')
  if (command === undefined) throw new Error('direct-overlay command is not registered')
  return command.handler()
}

/** Expose renderer runtime typing to tests without a second renderer contract. */
export type { BlueTerminalRuntime }
