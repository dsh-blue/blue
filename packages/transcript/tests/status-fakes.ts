/**
 * Shared fakes for the status-entry plugin specs: identity colors, a
 * render-request-recording screen, a structural `blueStatus` registry, a
 * structural Agent whose session carries the durable header and the request
 * header fold, and a boot helper driving one plugin module through a real
 * Cordis context (services via `ctx.reflect.provide`, as in plugin.spec).
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  BlueComponent,
  BlueOverlayHandle,
  BlueScreen,
} from '@deepseek-ai/dsh-blue-core'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { BlueStatus, BlueStatusEntry } from '../src/types.ts'
import { fakeBlueComponents } from './helpers.ts'

/** Identity colors so rendered assertions see structure, not escape codes. */
const id = (text: string): string => text
export const COLORS = {
  text: id, textStrong: id, muted: id, textMuted: id, accent: id, primary: id, border: id,
  borderFocus: id,
  success: id, error: id, warning: id, selectedBg: id, roleUser: id, shellMode: id,
  mdHeading: id, mdLink: id, mdLinkUrl: id, mdCode: id, mdCodeBlock: id,
  mdCodeBlockBorder: id, mdQuote: id, mdQuoteBorder: id, mdHr: id, mdListBullet: id,
  diffAdded: id, diffRemoved: id, diffAddedStrong: id, diffRemovedStrong: id,
  diffGutter: id, diffMeta: id,
}
// Structurally satisfies BlueSemanticColors; declared where consumed.

/** Records render requests; mounting methods are out of scope here. */
export class StatusFakeScreen implements BlueScreen {
  readonly renderRequests: (boolean | undefined)[] = []
  readonly columns = 80

  addChild(): () => void {
    throw new Error('fake addChild is out of scope for status plugin tests')
  }

  addBottomChild(_component: BlueComponent): () => void {
    return () => {}
  }

  removeChild(): void {}

  setFocus(): void {}

  showOverlay(): BlueOverlayHandle {
    throw new Error('fake showOverlay is out of scope for status plugin tests')
  }

  requestRender(force?: boolean): void {
    this.renderRequests.push(force)
  }
}

/** Structural `blueStatus`: remembers entries, honors the disposer contract. */
export class FakeStatusRegistry implements BlueStatus {
  readonly entries: BlueStatusEntry[] = []

  register(entry: BlueStatusEntry): () => void {
    this.entries.push(entry)
    let done = false
    return () => {
      if (done) return
      done = true
      const index = this.entries.indexOf(entry)
      if (index !== -1) this.entries.splice(index, 1)
    }
  }
}

/** Structural stand-in for the parts of `Session` the status plugins read. */
export interface FakeSession {
  events: SessionEvent[]
  header: { cwd?: string }
  requestHeader(): { config: { model: string } } | undefined
}

/** Structural stand-in for the real `Agent`; cast at the typed emit sites. */
export interface FakeAgent {
  id: SessionId
  status: 'idle' | 'running'
  options: { provider?: string, model?: string }
  session: FakeSession
}

let agentCounter = 0

/**
 * A fake agent whose session is a plain event-log object.
 * @param events - the session's event snapshot.
 * @param options - agent options (model/provider fallbacks) and the durable
 *   header cwd / request-header model the plugins may prefer.
 */
export function fakeAgent(
  events: SessionEvent[],
  options: { model?: string, provider?: string, cwd?: string, headerModel?: string } = {},
): FakeAgent {
  agentCounter += 1
  const header: { cwd?: string } = {}
  if (options.cwd !== undefined) header.cwd = options.cwd
  const agentOptions: { provider?: string, model?: string } = {}
  if (options.model !== undefined) agentOptions.model = options.model
  if (options.provider !== undefined) agentOptions.provider = options.provider
  const headerModel = options.headerModel
  return {
    id: SessionId(`fake-agent-${agentCounter}`),
    status: 'idle',
    options: agentOptions,
    session: {
      events,
      header,
      requestHeader: () => (headerModel === undefined ? undefined : { config: { model: headerModel } }),
    },
  }
}

/** Narrow a fake to the app-owned event payload type. */
export function asAgent(fake: FakeAgent): Agent {
  return fake as unknown as Agent
}

/** A plugin module shape accepted by `ctx.plugin`. */
export interface StatusPluginModule {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
}

export interface StatusPluginHarness {
  ctx: Context
  screen: StatusFakeScreen
  registry: FakeStatusRegistry
  entry: BlueStatusEntry
  dispose(): Promise<void>
}

/**
 * Boot one status-entry plugin on a fresh root context with every service it
 * injects faked.
 * @param plugin - the plugin module under test.
 * @param current - agent preloaded onto `blueSession.current`, if any.
 */
export async function bootStatusPlugin(
  plugin: StatusPluginModule,
  current: FakeAgent | null = null,
): Promise<StatusPluginHarness> {
  const ctx = new Context()
  const screen = new StatusFakeScreen()
  const registry = new FakeStatusRegistry()
  const serviceNames: Record<string, unknown> = {
    blueStatus: registry,
    blueScreen: screen,
    blueTheme: { colors: COLORS },
    blueComponents: fakeBlueComponents(),
    blueSession: { current: current === null ? null : asAgent(current) },
  }
  for (const [serviceName, value] of Object.entries(serviceNames)) {
    ctx.reflect.provide(serviceName, value)
  }
  const fiber = await ctx.plugin(plugin)
  return {
    ctx,
    screen,
    registry,
    entry: registry.entries[0]!,
    dispose: () => fiber.dispose(),
  }
}
