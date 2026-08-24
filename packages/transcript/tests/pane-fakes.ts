/**
 * Shared fakes for the pane plugin specs: a bottom-child-recording screen, a
 * keymap recording registrations, a command registry, and a boot helper
 * driving one pane plugin module through a real Cordis context (services via
 * `ctx.reflect.provide`, the `status-fakes` precedent).
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  BlueComponent,
  BlueKeyAction,
  BlueKeymap,
  BlueOverlayHandle,
  BlueScreen,
} from '@dsh-blue/blue-core'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { fakeBlueComponents } from './helpers.ts'
import { asAgent, COLORS, type FakeAgent } from './status-fakes.ts'

/** Records bottom mounts and render requests; the other mounts throw. */
export class PaneFakeScreen implements BlueScreen {
  readonly bottomChildren: BlueComponent[] = []
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80
  rows = 24

  addChild(): () => void {
    throw new Error('fake addChild is out of scope for pane plugin tests')
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
   * Every mounted bottom child's rendered rows, in mount order. Guttered
   * passive panes have their leading gutter stripped for these source-plane
   * assertions; full-width connected panes (btw) are left untouched.
   */
  paneLines(width = 80): string[] {
    return this.bottomChildren
      .flatMap(component => component.render(width))
      .map(line => line === ' ' ? '' : line.startsWith(' ') ? line.slice(1) : line)
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
  const serviceNames: Record<string, unknown> = {
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: fakeBlueComponents(),
    blueKeymap: keymap,
    blueSession: { current: current === null ? null : asAgent(current) },
    commands,
    ...extras,
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }
  const fiber = await ctx.plugin(plugin)
  return {
    ctx,
    screen,
    keymap,
    commands,
    dispose: () => fiber.dispose(),
  }
}
