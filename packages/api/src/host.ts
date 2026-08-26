/**
 * Cordis-owned host for stable Blue plugin contributions. The host contains
 * no renderer code; core compiles the resulting readonly models later.
 *
 * @module @dsh-blue/blue-api/host
 */

import { Service, symbols, type Context } from '@deepseek-ai/cordis'
import type { BlueCommandContribution, BlueDockContribution, BlueNotification, BluePluginApi, BluePluginHost, BlueRegistration, BlueRegistry, BlueResult, BlueStatusContribution } from './contracts.ts'
import { validateBlueManifest, type BluePluginManifest } from './manifest.ts'
import type { BlueErrorCode } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bluePluginHost: BluePluginHostService
  }
}

type Capability = 'commands' | 'status' | 'dock' | 'notifications'

/** Readonly aggregate consumed only by Blue-owned renderer adapters. */
export interface BluePluginHostSnapshot {
  readonly commands: readonly BlueCommandContribution[]
  readonly status: readonly BlueStatusContribution[]
  readonly dock: readonly BlueDockContribution[]
}

const API_MAJOR = /^\^?1(?:\.|$)/
const PHASE_ONE_CAPABILITIES = new Set<Capability>(['commands', 'status', 'dock', 'notifications'])

function success<T>(value: T): BlueResult<T> { return { ok: true, value } }
function failure(code: BlueErrorCode, message: string): BlueResult<never> { return { ok: false, code, message } }

function validateContribution(capability: Capability, contribution: { readonly id: string }): BlueResult {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(contribution.id)) {
    return failure('BLUE_INVALID_CONTRIBUTION', 'contribution id must be 1-128 lowercase namespace characters')
  }
  const priority = (contribution as { priority?: unknown }).priority
  if (priority !== undefined && (typeof priority !== 'number' || !Number.isFinite(priority) || !Number.isInteger(priority))) {
    return failure('BLUE_INVALID_CONTRIBUTION', 'contribution priority must be a finite integer')
  }
  if (capability === 'commands') {
    const command = contribution as Partial<BlueCommandContribution>
    if (!/^[a-z][a-z0-9_-]*$/u.test(command.id ?? '') || typeof command.label !== 'string' || command.label.trim().length === 0 || typeof command.execute !== 'function') {
      return failure('BLUE_INVALID_CONTRIBUTION', 'command contributions need a lowercase command id, label, and execute function')
    }
  }
  if (capability === 'status' && typeof (contribution as Partial<BlueStatusContribution>).render !== 'function') {
    return failure('BLUE_INVALID_CONTRIBUTION', 'status contributions need a render function')
  }
  if (capability === 'dock') {
    const dock = contribution as Partial<BlueDockContribution>
    if ((typeof dock.view !== 'object' || dock.view === null) && typeof dock.view !== 'function') {
      return failure('BLUE_INVALID_CONTRIBUTION', 'dock contributions need a view or view function')
    }
    for (const [label, value] of [['preferredRows', dock.preferredRows], ['minRows', dock.minRows]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 20)) {
        return failure('BLUE_LIMIT_EXCEEDED', `${label} must be an integer from 0 through 20`)
      }
    }
  }
  return success(undefined)
}

class AggregateRegistry<T extends { readonly id: string, readonly priority?: number }> {
  private readonly entries = new Map<string, { value: T, seq: number }>()
  private readonly listeners = new Set<() => void>()
  private nextSeq = 0

  add(value: T): BlueResult<BlueRegistration> {
    if (this.entries.has(value.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${value.id}" is already registered`)
    this.entries.set(value.id, { value, seq: this.nextSeq })
    this.nextSeq += 1
    try {
      this.emit()
    } catch (error) {
      this.entries.delete(value.id)
      this.emitContained()
      return failure('BLUE_DUPLICATE_ID', error instanceof Error ? error.message : `contribution "${value.id}" was rejected`)
    }
    return success(new BlueRegistrationImpl(() => {
      this.entries.delete(value.id)
      this.emitContained()
    }))
  }

  list(): readonly T[] {
    return Object.freeze([...this.entries.values()]
      .sort((left, right) => (left.value.priority ?? 50) - (right.value.priority ?? 50) || left.seq - right.seq)
      .map(entry => entry.value))
  }

  subscribe(listener: () => void): BlueRegistration {
    this.listeners.add(listener)
    return new BlueRegistrationImpl(() => { this.listeners.delete(listener) })
  }

  clear(): void {
    this.entries.clear()
    this.emitContained()
    this.listeners.clear()
  }

  private emit(): void { for (const listener of this.listeners) listener() }
  private emitContained(): void {
    for (const listener of this.listeners) {
      try { listener() } catch { /* the rejecting adapter already reported the admission failure */ }
    }
  }
}

class ScopedRegistry<T extends { readonly id: string, readonly priority?: number }> implements BlueRegistry<T> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<BlueRegistrationImpl>()

  constructor(
    private readonly capability: Capability,
    private readonly aggregate: AggregateRegistry<T>,
  ) {}

  register(contribution: T): BlueResult<BlueRegistration> {
    if (typeof contribution !== 'object' || contribution === null || typeof contribution.id !== 'string' || contribution.id.length === 0) {
      return failure('BLUE_INVALID_CONTRIBUTION', 'contribution id must be a non-empty string')
    }
    if (this.entries.has(contribution.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${contribution.id}" is already registered`)
    if (/^(?:blue[.:-]|@dsh-blue\/)/u.test(contribution.id)) {
      return failure('BLUE_ACTION_REJECTED', `contribution id "${contribution.id}" uses Blue's owner namespace`)
    }
    const valid = validateContribution(this.capability, contribution)
    if (!valid.ok) return valid
    const value = Object.freeze({ ...contribution }) as T
    const aggregate = this.aggregate.add(value)
    if (!aggregate.ok) return aggregate
    this.entries.set(value.id, value)
    const handle = new BlueRegistrationImpl(() => {
      this.entries.delete(value.id)
      this.handles.delete(handle)
      aggregate.value.dispose()
    })
    this.handles.add(handle)
    return success(handle)
  }

  list(): readonly T[] { return Object.freeze([...this.entries.values()]) }
  dispose(): void { for (const handle of this.handles) handle.dispose() }
}

class BlueRegistrationImpl implements BlueRegistration {
  disposed = false
  constructor(private readonly cleanup: () => void) {}
  dispose(): void { if (!this.disposed) { this.disposed = true; this.cleanup() } }
}

class ScopedNotifications {
  private readonly listeners = new Set<(notification: BlueNotification) => void>()
  private readonly handles = new Set<BlueRegistrationImpl>()
  constructor(
    private readonly publishGlobal: (n: BlueNotification) => void,
    private readonly effect: (callback: () => void | (() => void)) => unknown,
  ) {}
  publish(notification: BlueNotification): BlueResult {
    if (!notification || typeof notification.id !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(notification.id)) return failure('BLUE_INVALID_CONTRIBUTION', 'notification id must be 1-128 lowercase namespace characters')
    if (typeof notification.view !== 'object' || notification.view === null) return failure('BLUE_INVALID_CONTRIBUTION', 'notification view must be an object')
    const copy = Object.freeze({ ...notification })
    try { this.publishGlobal(copy) } catch (error) {
      return failure('BLUE_INVALID_CONTRIBUTION', error instanceof Error ? error.message : 'notification was rejected')
    }
    return success(undefined)
  }
  subscribe(listener: (notification: BlueNotification) => void): BlueRegistration {
    this.listeners.add(listener)
    const handle = new BlueRegistrationImpl(() => {
      this.listeners.delete(listener)
      this.handles.delete(handle)
    })
    this.handles.add(handle)
    this.effect(() => () => handle.dispose())
    return handle
  }
  emit(notification: BlueNotification): void {
    for (const listener of this.listeners) {
      try { listener(notification) } catch { /* one plugin observer cannot block the owner sink */ }
    }
  }
  dispose(): void { for (const handle of this.handles) handle.dispose(); this.listeners.clear() }
}

interface BluePluginHostState {
  readonly registries: Set<{ dispose(): void }>
  readonly notifications: Set<ScopedNotifications>
  readonly notificationObservers: Set<(notification: BlueNotification) => void>
  readonly commandContributions: AggregateRegistry<BlueCommandContribution>
  readonly statusContributions: AggregateRegistry<BlueStatusContribution>
  readonly dockContributions: AggregateRegistry<BlueDockContribution>
}

const HOST_STATE_KEY = Symbol.for('@dsh-blue/blue-api/plugin-host-states/v1')
const hostGlobals = globalThis as unknown as Record<symbol, unknown>
const existingHostStates = hostGlobals[HOST_STATE_KEY]
const HOST_STATES = existingHostStates instanceof WeakMap
  ? existingHostStates as WeakMap<BluePluginHostService, BluePluginHostState>
  : new WeakMap<BluePluginHostService, BluePluginHostState>()
hostGlobals[HOST_STATE_KEY] = HOST_STATES

function stateOf(host: BluePluginHostService): BluePluginHostState {
  const original = (host as BluePluginHostService & { [symbols.original]?: BluePluginHostService })[symbols.original]
  const state = HOST_STATES.get(original ?? host)
  if (state === undefined) throw new Error('Blue plugin host is not active')
  return state
}

/** Snapshot all additive contributions for Blue-owned adapters. */
export function snapshotBluePluginHost(host: BluePluginHostService): BluePluginHostSnapshot {
  const state = stateOf(host)
  return Object.freeze({
    commands: state.commandContributions.list(),
    status: state.statusContributions.list(),
    dock: state.dockContributions.list(),
  })
}

/** Observe aggregate changes from a Blue-owned adapter. */
export function subscribeBluePluginHost(
  host: BluePluginHostService,
  listener: (snapshot: BluePluginHostSnapshot) => void,
): BlueRegistration {
  const state = stateOf(host)
  const notify = () => listener(snapshotBluePluginHost(host))
  notify()
  const handles = [
    state.commandContributions.subscribe(notify),
    state.statusContributions.subscribe(notify),
    state.dockContributions.subscribe(notify),
  ]
  return new BlueRegistrationImpl(() => { for (const handle of handles) handle.dispose() })
}

/** Observe plugin notices from Blue's owner interaction adapter. */
export function subscribeBluePluginNotifications(
  host: BluePluginHostService,
  listener: (notification: BlueNotification) => void,
): BlueRegistration {
  const state = stateOf(host)
  state.notificationObservers.add(listener)
  return new BlueRegistrationImpl(() => { state.notificationObservers.delete(listener) })
}

function disposeHost(host: BluePluginHostService): void {
  const state = HOST_STATES.get(host)
  /* v8 ignore next -- Cordis invokes an effect cleanup at most once. */
  if (state === undefined) return
  for (const registry of state.registries) registry.dispose()
  for (const notifications of state.notifications) notifications.dispose()
  state.commandContributions.clear()
  state.statusContributions.clear()
  state.dockContributions.clear()
  state.notificationObservers.clear()
  HOST_STATES.delete(host)
}

/** Cordis service implementing the stable Blue plugin host. */
export class BluePluginHostService extends Service implements BluePluginHost {
  readonly version = '1.0.0'

  constructor(ctx: Context) {
    super(ctx, 'bluePluginHost')
    HOST_STATES.set(this, {
      registries: new Set(),
      notifications: new Set(),
      notificationObservers: new Set(),
      commandContributions: new AggregateRegistry(),
      statusContributions: new AggregateRegistry(),
      dockContributions: new AggregateRegistry(),
    })
    ctx.effect(() => () => disposeHost(this))
  }

  open(consumer: { effect(callback: () => void | (() => void)): unknown }, manifest: BluePluginManifest): BlueResult<BluePluginApi> {
    const state = stateOf(this)
    if (typeof consumer !== 'object' || consumer === null || typeof consumer.effect !== 'function') {
      return failure('BLUE_INVALID_CONTRIBUTION', 'consumer must expose a Cordis effect function')
    }
    const valid = validateBlueManifest(manifest)
    if (!valid.ok) return failure(valid.code === 'BLUE_INVALID_MANIFEST' ? 'BLUE_INVALID_CONTRIBUTION' : 'BLUE_API_INCOMPATIBLE', valid.message)
    if (!API_MAJOR.test(manifest.api)) return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${manifest.api}"`)
    const capabilities = [...manifest.capabilities]
    const unavailable = capabilities.find(capability => !PHASE_ONE_CAPABILITIES.has(capability as Capability))
    if (unavailable !== undefined) return failure('BLUE_CAPABILITY_DENIED', `capability "${unavailable}" is not available in Blue creative mode phase one`)
    const commands = new ScopedRegistry<BlueCommandContribution>('commands', state.commandContributions)
    const status = new ScopedRegistry<BlueStatusContribution>('status', state.statusContributions)
    const dock = new ScopedRegistry<BlueDockContribution>('dock', state.dockContributions)
    const notifications = new ScopedNotifications(notification => {
      for (const target of state.notifications) target.emit(notification)
      for (const observer of state.notificationObservers) observer(notification)
    }, callback => consumer.effect(callback))
    state.registries.add(commands); state.registries.add(status); state.registries.add(dock); state.notifications.add(notifications)
    const api: BluePluginApi = {
      manifest: Object.freeze({ ...manifest, capabilities: Object.freeze([...capabilities]) }),
      ...(capabilities.includes('commands') ? { commands } : {}),
      ...(capabilities.includes('status') ? { status } : {}),
      ...(capabilities.includes('dock') ? { dock } : {}),
      ...(capabilities.includes('notifications') ? { notifications } : {}),
    }
    consumer.effect(() => () => { commands.dispose(); status.dispose(); dock.dispose(); notifications.dispose(); state.registries.delete(commands); state.registries.delete(status); state.registries.delete(dock); state.notifications.delete(notifications) })
    return success(Object.freeze(api))
  }
}

/** Cordis plugin entry for the host service. */
export const name = 'blue-api-host'
export function apply(ctx: Context): void { new BluePluginHostService(ctx) }
