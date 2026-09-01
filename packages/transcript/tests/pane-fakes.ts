/**
 * Shared fakes for the pane plugin specs: a bottom-child-recording screen, a
 * keymap recording registrations, a command registry, and a boot helper
 * driving one pane plugin module through a real Cordis context (services via
 * `ctx.reflect.provide`, the `status-fakes` precedent).
 */

import { Context } from '@deepseek-ai/cordis'
import { BluePaneService } from '@dsh-blue/blue-api'
import type {
  BlueComponent,
  BlueKeyAction,
  BlueKeymap,
  BlueOverlayHandle,
  BlueScreen,
} from '@dsh-blue/blue-core'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { fakeBlueComponents } from './helpers.ts'
import { asAgent, COLORS, FakeFactsService, type FakeAgent } from './status-fakes.ts'
import { compileBlueUiNode } from '../../core/src/ui-compiler.ts'
import { conversationProjectionDefinition, foldConversationProjection, initialConversationState, type ConversationProjectionState } from '../../conversation/src/projection.ts'
import type { ConversationProjection } from '../../conversation/src/types.ts'

const ANSI_OR_OSC = /\x1b(?:\][^\x07]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)/gu

/** Records bottom mounts and render requests; the other mounts throw. */
export class PaneFakeScreen implements BlueScreen {
  readonly children: BlueComponent[] = []
  readonly bottomChildren: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  rows = 24
  private readonly paneComponents = new Map<string, BlueComponent>()
  private panes?: BluePaneService
  private components?: ReturnType<typeof fakeBlueComponents>
  private colors: typeof COLORS = COLORS

  addChild(component: BlueComponent): () => void {
    this.children.push(component)
    return () => {
      const index = this.children.indexOf(component)
      if (index !== -1) this.children.splice(index, 1)
    }
  }

  addBottomChild(component: BlueComponent): () => void {
    this.bottomChildren.push(component)
    let done = false
    return () => {
      if (done) return
      done = true
      const index = this.bottomChildren.indexOf(component)
      if (index !== -1) this.bottomChildren.splice(index, 1)
    }
  }

  removeChild(): void {}

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('fake showOverlay is out of scope for pane plugin tests')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }

  /** S31 seam: pass-through; the pane suites never suspend the screen. */
  suspend<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  setTitle(): void {}

  /**
   * Every mounted bottom child's rendered rows, in mount order, with the
   * kimi gutter column the mount layer wraps the panes in stripped — the
   * gutter itself is a mount-layer concern covered by the core gutter spec
   * and the bundle e2e; these specs assert the pane's own surface.
   */
  paneLines(width = 80): string[] {
    return this.bottomChildren.flatMap(component => component.render(width))
      .map(line => line.replace(ANSI_OR_OSC, ''))
  }

  bindPanes(panes: BluePaneService, components: ReturnType<typeof fakeBlueComponents>, colors: typeof COLORS): void {
    this.panes = panes
    this.components = components
    this.colors = colors
    panes.subscribe(entries => {
      const live = new Set(entries.filter(entry => !entry.hidden).map(entry => entry.id))
      for (const [id, component] of this.paneComponents) {
        if (live.has(id)) continue
        this.paneComponents.delete(id)
        const index = this.bottomChildren.indexOf(component)
        if (index !== -1) this.bottomChildren.splice(index, 1)
      }
      for (const entry of entries) {
        if (entry.hidden || this.paneComponents.has(entry.id)) continue
        const component: BlueComponent = {
          render: width => {
            const current = this.panes?.list().find(candidate => candidate.id === entry.id)
            const node = current?.contribution.render()
            if (node === null || node === undefined || this.components === undefined) return []
            const compiled = compileBlueUiNode(node, {
              components: this.components,
              colors: this.colors,
              getViewport: () => ({ columns: width, rows: this.rows }),
              screenMode: 'main',
            })
            const rows = compiled.ok ? compiled.value.component.render(width) : compiled.errorComponent.render(width)
            return rows.map(line => line.replace(ANSI_OR_OSC, ''))
          },
          invalidate: () => {},
        }
        this.paneComponents.set(entry.id, component)
        this.bottomChildren.push(component)
      }
      this.requestRender()
    })
  }
}

/** Records keymap registrations; handlers are invoked manually by specs. */
export class PaneFakeKeymap implements BlueKeymap {
  readonly actions: BlueKeyAction[] = []

  register(actions: BlueKeyAction[]): () => void {
    this.actions.push(...actions)
    let done = false
    return () => {
      if (done) return
      done = true
      for (const action of actions) {
        const index = this.actions.indexOf(action)
        if (index !== -1) this.actions.splice(index, 1)
      }
    }
  }

  /** The registered handler for `id`; throws when no such action is live. */
  handler(id: string): () => void {
    const action = this.actions.find(candidate => candidate.id === id)
    if (action?.handler === undefined) throw new Error(`no handler action registered for ${id}`)
    return action.handler
  }

  matches(): boolean {
    throw new Error('fake matches is out of scope for pane plugin tests')
  }

  dispatch(): boolean {
    throw new Error('fake dispatch is out of scope for pane plugin tests')
  }

  getKeys(): string[] {
    throw new Error('fake getKeys is out of scope for pane plugin tests')
  }

  list(): readonly BlueKeyAction[] {
    return [...this.actions]
  }
}

/** Records command registrations; handlers are invoked manually by specs. */
export class PaneFakeCommands {
  readonly definitions = new Map<string, CommandDefinition>()

  register(definition: CommandDefinition): () => void {
    this.definitions.set(definition.name, definition)
    let done = false
    return () => {
      if (done) return
      done = true
      this.definitions.delete(definition.name)
    }
  }

  /** Invoke the named command's handler with the given raw input. */
  run(name: string, rawInput: string): CommandResult | Promise<CommandResult> {
    const definition = this.definitions.get(name)
    if (definition === undefined) throw new Error(`no command registered for /${name}`)
    return definition.handler({ rawInput } as unknown as CommandInvocation)
  }
}

/** Minimal official projection read-face for side-session pane fixtures. */
export class FakeProjectionService {
  private readonly listeners = new Set<(session: unknown, key: string, value: unknown, seq: number) => void>()
  private readonly states = new WeakMap<object, ConversationProjectionState>()
  private readonly watermarks = new WeakMap<object, number>()
  snapshot(session: { readonly events?: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }): { readonly values: Record<string, unknown>, readonly asOfSeq: number } {
    const key = session as object
    const state = this.states.get(key) ?? (session.events ?? []).reduce((current, event) => this.reduce(current, event), initialConversationState())
    return { values: { blueConversation: conversationProjectionDefinition.wire.view(state) }, asOfSeq: this.watermarks.get(key) ?? session.events?.at(-1)?.seq ?? -1 }
  }
  onChanged(listener: (session: unknown, key: string, value: unknown, seq: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  emit(session: unknown, event: import('@deepseek-ai/dsh-session').SessionEvent): void {
    const key = session as object
    const current = this.states.get(key) ?? (session as { readonly events?: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }).events?.slice(0, -1).reduce((state, row) => this.reduce(state, row), initialConversationState()) ?? initialConversationState()
    const next = this.reduce(current, event)
    this.states.set(key, next)
    this.watermarks.set(key, event.seq)
    const snapshot = this.snapshot(session as { readonly events?: readonly import('@deepseek-ai/dsh-session').SessionEvent[] })
    for (const listener of this.listeners) listener(session, 'blueConversation', snapshot.values.blueConversation as ConversationProjection, event.seq)
  }
  private reduce(state: ConversationProjectionState, event: import('@deepseek-ai/dsh-session').SessionEvent): ConversationProjectionState {
    if (event.type === 'tool/result') {
      const message = event.data.message as { readonly content?: unknown } | undefined
      const block = Array.isArray(message?.content) ? message.content[0] as { readonly toolCallId?: unknown, readonly content?: unknown } | undefined : undefined
      if (block?.toolCallId === undefined || !Array.isArray(block.content)) return state
    }
    const projectedEvent = event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'tool/result'
      ? { ...event, surfaceOp: event.surfaceOp ?? 'append' } as import('@deepseek-ai/dsh-session').SessionEvent
      : event
    const replayCurrent = projectedEvent.type === 'assistant/message'
      ? { ...state, finalizedSteps: state.finalizedSteps.filter(key => key !== `${String(projectedEvent.data.turn)}:${String(projectedEvent.data.step)}`) }
      : state
    return foldConversationProjection(replayCurrent, projectedEvent)
  }
}

/** A plugin module shape accepted by `ctx.plugin`. */
export interface PanePluginModule {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
}

export interface PanePluginHarness {
  ctx: Context
  screen: PaneFakeScreen
  keymap: PaneFakeKeymap
  commands: PaneFakeCommands
  dispose(): Promise<void>
}

/**
 * Boot one pane plugin on a fresh root context with every service it injects
 * faked.
 * @param plugin - the plugin module under test.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 * @param extras - extra services (e.g. a fake `agents` registry).
 */
export async function bootPanePlugin(
  plugin: PanePluginModule,
  current: FakeAgent | null = null,
  extras: Record<string, unknown> = {},
): Promise<PanePluginHarness> {
  const ctx = new Context()
  const screen = new PaneFakeScreen()
  const keymap = new PaneFakeKeymap()
  const commands = new PaneFakeCommands()
  const facts = new FakeFactsService(ctx, current)
  const components = fakeBlueComponents()
  const panes = new BluePaneService(ctx)
  const projections = new FakeProjectionService()
  ctx.on('session/event', (session, event) => projections.emit(session, event))
  const serviceNames: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: components,
    blueKeymap: keymap,
    blueCurrentAgent: {
      current: () => current === null ? null : asAgent(current),
      revision: () => 0,
      subscribe(listener: (agent: unknown, revision: number) => void) {
        listener(current === null ? null : asAgent(current), 0)
        return () => {}
      },
    },
    blueSessionFacts: facts,
    sessionProjections: projections,
    commands,
    agents: { create: async () => { throw new Error('fake agents.create is not configured') } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'mock' }) },
    agentPresets: { mount: async () => {} },
    ...extras,
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }
  const theme = serviceNames.blueTheme as { readonly colors: typeof COLORS }
  screen.bindPanes(panes, components, theme.colors)
  const fiber = await ctx.plugin(plugin)
  return {
    ctx,
    screen,
    keymap,
    commands,
    dispose: () => fiber.dispose(),
  }
}
