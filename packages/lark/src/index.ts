/**
 * Narrow dsh-lark compatibility adapter over its public loopback settings
 * route. It contributes one official Harness command and renderer-neutral
 * notifications without retaining settings or credential state.
 *
 * @module @dsh-blue/blue-lark
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { NotificationModel, NotificationModelService } from '@dsh-blue/blue-frontend'
// Empty type imports carry the official command and optional webServer Context merges.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Public route published by dsh-lark. */
export const LARK_SETTINGS_PATH = '/dsh-lark/settings'

/** Default number of operation ids and notifications retained for dedupe. */
export const LARK_OPERATION_RETENTION = 100

/** Redacted credential fact returned by the official route. */
export interface LarkCredentialFact {
  readonly configured: boolean
  readonly source?: string
  readonly writable?: boolean
}

/** Runtime fact returned by the official route. */
export interface LarkRuntimeFact {
  readonly state: string
  readonly message?: string
}

/** Minimal route response consumed by Blue. Settings and secret fields are ignored. */
export interface LarkSettingsSnapshot {
  readonly revision: number
  readonly credential?: LarkCredentialFact
  readonly runtime?: LarkRuntimeFact
}

/** HTTP function accepted by the client for tests and alternate carriers. */
export type LarkFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Explicit route-absence signal used by the plain command fallback. */
export class LarkRouteUnavailableError extends Error {
  /** Construct the stable route-absence error. */
  constructor() { super('Lark settings route is unavailable; the Lark domain plugin remains active') }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function snapshot(value: unknown): LarkSettingsSnapshot {
  const row = object(value)
  if (row === undefined || !Number.isSafeInteger(row.revision) || (row.revision as number) < 0) throw new Error('invalid Lark settings response')
  const credentialRow = object(row.credential)
  const runtimeRow = object(row.runtime)
  const credential = credentialRow !== undefined && typeof credentialRow.configured === 'boolean'
    ? { configured: credentialRow.configured, ...(typeof credentialRow.source === 'string' ? { source: credentialRow.source } : {}), ...(typeof credentialRow.writable === 'boolean' ? { writable: credentialRow.writable } : {}) }
    : undefined
  const runtime = runtimeRow !== undefined && typeof runtimeRow.state === 'string'
    ? { state: runtimeRow.state, ...(typeof runtimeRow.message === 'string' ? { message: runtimeRow.message } : {}) }
    : undefined
  return { revision: row.revision as number, ...(credential === undefined ? {} : { credential }), ...(runtime === undefined ? {} : { runtime }) }
}

async function responseJson(response: Response): Promise<LarkSettingsSnapshot> {
  const value = await response.json() as unknown
  if (!response.ok) {
    const message = object(value)?.error
    throw new Error(typeof message === 'string' ? message : `Lark settings request failed (${String(response.status)})`)
  }
  return snapshot(value)
}

/** Stateless client for the official dsh-lark settings route. */
export class LarkSettingsClient {
  /** Construct a client. An absent origin preserves the route-absent fallback. */
  constructor(private readonly origin?: string, private readonly fetcher: LarkFetch = globalThis.fetch) {}

  /** Read redacted runtime and credential facts. */
  async describe(signal: AbortSignal): Promise<LarkSettingsSnapshot> {
    if (this.origin === undefined) throw new LarkRouteUnavailableError()
    return responseJson(await this.fetcher(new URL(LARK_SETTINGS_PATH, this.origin), { method: 'GET', signal }))
  }

  /** Trigger the route's official reconcile path using optimistic revision. */
  async retry(signal: AbortSignal): Promise<LarkSettingsSnapshot> {
    if (this.origin === undefined) throw new LarkRouteUnavailableError()
    const current = await this.describe(signal)
    return responseJson(await this.fetcher(new URL(LARK_SETTINGS_PATH, this.origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.origin },
      body: JSON.stringify({ expectedRevision: current.revision }),
      signal,
    }))
  }
}

/** Lark command action supported by the compatibility adapter. */
export type LarkAction = 'status' | 'retry'

/** Adapter construction policy. */
export interface LarkAdapterOptions {
  readonly retention?: number
}

/** Operation-id dedupe, abort ownership, and notification projection. */
export class LarkAdapter {
  private readonly operations = new Map<string, Promise<CommandResult>>()
  private readonly active = new Map<string, AbortController>()
  private readonly notificationDisposers = new Map<string, () => void>()
  private readonly retention: number
  private generation = 0
  private disposed = false

  /** Construct an adapter over the official route client and Blue notification sink. */
  constructor(private readonly client: LarkSettingsClient, private readonly notifications: Pick<NotificationModelService, 'push'>, options: LarkAdapterOptions = {}) {
    this.retention = Math.max(1, Math.floor(options.retention ?? LARK_OPERATION_RETENTION))
  }

  /** Execute or deduplicate one status/retry operation. */
  execute(operationId: string, action: LarkAction, signal: AbortSignal = new AbortController().signal): Promise<CommandResult> {
    if (this.disposed) return Promise.resolve({ kind: 'error', text: 'Lark adapter is unloaded' })
    const existing = this.operations.get(operationId)
    if (existing !== undefined) return existing
    const controller = new AbortController()
    const forward = (): void => controller.abort(signal.reason)
    signal.addEventListener('abort', forward, { once: true })
    if (signal.aborted) forward()
    const generation = this.generation
    this.active.set(operationId, controller)
    this.publish(operationId, 'info', action === 'retry' ? 'Retrying Lark connection' : 'Checking Lark connection')
    const operation = this.run(operationId, action, controller, generation)
      .finally(() => {
        signal.removeEventListener('abort', forward)
        if (this.active.get(operationId) === controller) this.active.delete(operationId)
      })
    this.operations.set(operationId, operation)
    this.trim()
    return operation
  }

  /** Abort in-flight work and remove every retained notification. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    for (const controller of this.active.values()) controller.abort()
    for (const dispose of this.notificationDisposers.values()) dispose()
    this.active.clear()
    this.operations.clear()
    this.notificationDisposers.clear()
  }

  private async run(operationId: string, action: LarkAction, controller: AbortController, generation: number): Promise<CommandResult> {
    try {
      const current = action === 'retry' ? await this.client.retry(controller.signal) : await this.client.describe(controller.signal)
      if (this.disposed || generation !== this.generation) return { kind: 'error', text: 'Lark adapter unloaded before the request completed' }
      if (this.active.get(operationId) !== controller) return { kind: 'error', text: 'Lark request was superseded' }
      const text = describeSnapshot(current)
      this.publish(operationId, severity(current), text)
      return { kind: 'success', text }
    } catch (error) {
      if (this.disposed || generation !== this.generation) return { kind: 'error', text: 'Lark adapter unloaded before the request completed' }
      if (this.active.get(operationId) !== controller) return { kind: 'error', text: 'Lark request was superseded' }
      if (controller.signal.aborted) {
        this.notificationDisposers.get(operationId)?.()
        this.notificationDisposers.delete(operationId)
        return { kind: 'error', text: 'Lark request aborted' }
      }
      const text = error instanceof Error ? error.message : String(error)
      this.publish(operationId, error instanceof LarkRouteUnavailableError ? 'warning' : 'error', text)
      return { kind: 'error', text }
    }
  }

  private publish(operationId: string, severityValue: NotificationModel['severity'], message: string): void {
    this.notificationDisposers.get(operationId)?.()
    const model: NotificationModel = { kind: 'notification', id: `lark.operation.${operationId}`, severity: severityValue, message, dedupeKey: `lark.operation.${operationId}` }
    this.notificationDisposers.set(operationId, this.notifications.push(model))
  }

  private trim(): void {
    while (this.operations.size > this.retention) {
      const oldest = this.operations.keys().next().value as string
      this.operations.delete(oldest)
      this.active.get(oldest)?.abort('Lark operation retention limit reached')
      this.active.delete(oldest)
      this.notificationDisposers.get(oldest)?.()
      this.notificationDisposers.delete(oldest)
    }
  }
}

function describeSnapshot(current: LarkSettingsSnapshot): string {
  const state = current.runtime?.state ?? 'unknown'
  const credential = current.credential?.configured === true ? 'credential configured' : 'credential missing'
  return `Lark: ${state}; ${credential}; revision ${String(current.revision)}${current.runtime?.message === undefined ? '' : `; ${current.runtime.message}`}`
}

function severity(current: LarkSettingsSnapshot): NotificationModel['severity'] {
  if (current.runtime?.state === 'error') return 'error'
  if (current.runtime?.state === 'connected') return 'success'
  return 'info'
}

/** Stable Cordis plugin name. */
export const name = 'blue-lark'

/** The command and notification registries are required; webServer is optional. */
export const inject = ['commands', 'blueNotifications']

/** Register `/lark [status|retry]` through the official command registry. */
export function apply(ctx: Context): void {
  const webServer = ctx.get('webServer') as WebServer | undefined
  const origin = webServer === undefined ? undefined : `http://127.0.0.1:${String(webServer.port)}`
  const adapter = new LarkAdapter(new LarkSettingsClient(origin), ctx.blueNotifications)
  ctx.effect(() => ctx.commands.register({
    name: 'lark',
    description: 'Show or retry the Lark channel connection',
    input: { hint: '[status|retry]' },
    handler: invocation => {
      const action = invocation.rawInput.trim() || 'status'
      if (action !== 'status' && action !== 'retry') return { kind: 'error', text: 'usage: /lark [status|retry]' }
      return adapter.execute(String(invocation.commandId), action, invocation.signal)
    },
  }))
  ctx.effect(() => () => adapter.dispose())
}
