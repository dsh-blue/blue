/**
 * Public status-provider capability owner and persisted selection bridge.
 * Candidate callbacks remain inert in blue-api; this frontend-tree Fiber is
 * the only place that selects, snapshots, dry-renders, and activates one.
 *
 * @module @dsh-blue/blue-transcript/status-provider-owner
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
// Carries the optional settings service and settings/updated event merges.
import type {} from '@deepseek-ai/dsh-settings'
import { attachBluePluginHostCapabilities, subscribeBluePluginHost } from '@dsh-blue/blue-api'
// Carries the app-owned blueSessionReader Context merge.
import type {} from '@dsh-blue/blue-app'
import { BLUE_DEFAULT_STATUS_PROVIDER } from './status-model.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted by the sole Blue settings owner when its resolved source is live. */
    'blue/settings-source-ready'(value: unknown): void
  }
}

/** Stable Cordis plugin name. */
export const name = 'blue-status-provider-owner'
/** The host registry, composition target, and readonly session source. */
export const inject = ['bluePluginHost', 'blueStatusComposition', 'blueSessionReader']

function desiredStatusProvider(value: unknown): string {
  if (typeof value !== 'object' || value === null) return BLUE_DEFAULT_STATUS_PROVIDER
  const descriptor = Object.getOwnPropertyDescriptor(value, 'statusProvider')
  if (descriptor === undefined || !('value' in descriptor) || typeof descriptor.value !== 'string' || descriptor.value.trim() === '') return BLUE_DEFAULT_STATUS_PROVIDER
  return descriptor.value
}

function currentSelection(ctx: Context): string {
  const settings = ctx.get('settings') as { get(namespace: string): unknown } | undefined
  return desiredStatusProvider(settings?.get('blue'))
}

/** Attach the status-provider capability and drive one tree-scoped owner. */
export function apply(ctx: Context): void {
  const host = (ctx.bluePluginHost as unknown as Record<symbol, typeof ctx.bluePluginHost | undefined>)[symbols.original] ?? ctx.bluePluginHost
  attachBluePluginHostCapabilities(host, ctx, ['status.provider'])
  const composition = ctx.blueStatusComposition
  composition.select(currentSelection(ctx))
  const sessionSubscription = ctx.blueSessionReader.subscribe(snapshot => composition.updateSession(snapshot))
  const hostSubscription = subscribeBluePluginHost(host, snapshot => {
    composition.updateCandidates(snapshot.statusProviders, snapshot.statusProvidersRevision ?? snapshot.revision ?? 0)
  })
  ctx.on('settings/updated', (namespace, next) => {
    if (String(namespace) === 'blue') composition.select(desiredStatusProvider(next))
  })
  ctx.on('blue/settings-source-ready', value => composition.select(desiredStatusProvider(value)))
  ctx.effect(() => () => {
    hostSubscription.dispose()
    sessionSubscription.dispose()
    composition.detachProviders()
  })
}
