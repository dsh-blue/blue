/**
 * Cordis-owned host for stable Blue plugin contributions. The host contains
 * no renderer code; core compiles the resulting readonly models later.
 *
 * @module @dsh-blue/blue-api/host
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { BlueCommandContribution, BlueDockContribution, BlueNotification, BluePluginApi, BluePluginHost, BlueRegistration, BlueRegistry, BlueResult, BlueStatusContribution } from './contracts.ts'
import { validateBlueManifest, type BluePluginManifest } from './manifest.ts'
import type { BlueErrorCode } from './contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bluePluginHost: BluePluginHostService
  }
}

type Capability = 'commands' | 'status' | 'dock' | 'notifications'

const API_MAJOR = /^\^?1(?:\.|$)/

function success<T>(value: T): BlueResult<T> { return { ok: true, value } }
function failure(code: BlueErrorCode, message: string): BlueResult<never> { return { ok: false, code, message } }

class ScopedRegistry<T extends { readonly id: string }> implements BlueRegistry<T> {
  private readonly entries = new Map<string, T>()
  private readonly handles = new Set<BlueRegistrationImpl>()

  constructor(private readonly capability: Capability, private readonly allowed: readonly string[]) {}

  register(contribution: T): BlueResult<BlueRegistration> {
    if (!this.allowed.includes(this.capability)) return failure('BLUE_CAPABILITY_DENIED', `capability "${this.capability}" was not declared`)
    if (typeof contribution !== 'object' || contribution === null || typeof contribution.id !== 'string' || contribution.id.length === 0) {
      return failure('BLUE_INVALID_CONTRIBUTION', 'contribution id must be a non-empty string')
    }
    if (this.entries.has(contribution.id)) return failure('BLUE_DUPLICATE_ID', `contribution "${contribution.id}" is already registered`)
    const value = Object.freeze({ ...contribution }) as T
    this.entries.set(value.id, value)
    const handle = new BlueRegistrationImpl(() => {
      this.entries.delete(value.id)
      this.handles.delete(handle)
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
    private readonly allowed: readonly string[],
    private readonly publishGlobal: (n: BlueNotification) => void,
    private readonly effect: (callback: () => void | (() => void)) => unknown,
  ) {}
  publish(notification: BlueNotification): BlueResult {
    if (!this.allowed.includes('notifications')) return failure('BLUE_CAPABILITY_DENIED', 'capability "notifications" was not declared')
    if (!notification || typeof notification.id !== 'string' || notification.id.length === 0) return failure('BLUE_INVALID_CONTRIBUTION', 'notification id must be a non-empty string')
    const copy = Object.freeze({ ...notification })
    this.publishGlobal(copy)
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
  emit(notification: BlueNotification): void { for (const listener of this.listeners) listener(notification) }
  dispose(): void { for (const handle of this.handles) handle.dispose(); this.listeners.clear() }
}

/** Cordis service implementing the stable Blue plugin host. */
export class BluePluginHostService extends Service implements BluePluginHost {
  readonly version = '1.0.0'
  private readonly registries = new Set<{ dispose(): void }>()
  private readonly notifications = new Set<ScopedNotifications>()

  constructor(ctx: Context) { super(ctx, 'bluePluginHost') }

  open(consumer: { effect(callback: () => void | (() => void)): unknown }, manifest: BluePluginManifest): BlueResult<BluePluginApi> {
    const valid = validateBlueManifest(manifest)
    if (!valid.ok) return failure(valid.code === 'BLUE_INVALID_MANIFEST' ? 'BLUE_INVALID_CONTRIBUTION' : 'BLUE_API_INCOMPATIBLE', valid.message)
    if (!API_MAJOR.test(manifest.api)) return failure('BLUE_API_INCOMPATIBLE', `unsupported Blue API range "${manifest.api}"`)
    const capabilities = [...manifest.capabilities]
    const commands = new ScopedRegistry<BlueCommandContribution>('commands', capabilities)
    const status = new ScopedRegistry<BlueStatusContribution>('status', capabilities)
    const dock = new ScopedRegistry<BlueDockContribution>('dock', capabilities)
    const notifications = new ScopedNotifications(capabilities, notification => {
      for (const target of this.notifications) target.emit(notification)
    }, callback => consumer.effect(callback))
    this.registries.add(commands); this.registries.add(status); this.registries.add(dock); this.notifications.add(notifications)
    const api: BluePluginApi = {
      manifest: Object.freeze({ ...manifest, capabilities: Object.freeze([...capabilities]) }),
      ...(capabilities.includes('commands') ? { commands } : {}),
      ...(capabilities.includes('status') ? { status } : {}),
      ...(capabilities.includes('dock') ? { dock } : {}),
      ...(capabilities.includes('notifications') ? { notifications } : {}),
    }
    consumer.effect(() => () => { commands.dispose(); status.dispose(); dock.dispose(); notifications.dispose(); this.registries.delete(commands); this.registries.delete(status); this.registries.delete(dock); this.notifications.delete(notifications) })
    return success(Object.freeze(api))
  }

  dispose(): void { for (const registry of this.registries) registry.dispose(); for (const notifications of this.notifications) notifications.dispose() }
}

/** Cordis plugin entry for the host service. */
export const name = 'blue-api-host'
export function apply(ctx: Context): void { new BluePluginHostService(ctx) }
