/**
 * Blue-owned adapter from public additive status models to the transcript's
 * status registry. Dynamic code never receives the renderer service; this
 * Fiber alone owns the status entry disposers.
 *
 * @module @dsh-blue/blue-transcript/plugin-host-bridge
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import { attachBluePluginHostCapabilities, subscribeBluePluginHost, type BluePluginHostSnapshot, type BlueStatusEntryContribution } from '@dsh-blue/blue-api'
import type { BlueStatusEntry } from './status-model.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-view-bridge'

/** Owner services required before public views can reach the tree. */
export const inject = ['bluePluginHost', 'blueStatusEntries']

/** Mount additive status contributions behind the owner adapter. */
export function apply(ctx: Context): void {
  const host = (ctx.bluePluginHost as unknown as Record<symbol, typeof ctx.bluePluginHost | undefined>)[symbols.original] ?? ctx.bluePluginHost
  attachBluePluginHostCapabilities(host, ctx, ['status'])
  const status = new Map<string, { dispose: () => void, contribution: BlueStatusEntryContribution }>()
  let statusRevision = -1

  const syncStatus = (entries: readonly BlueStatusEntryContribution[], revision: number): void => {
    const refreshExisting = revision !== statusRevision
    const live = new Set(entries.map(entry => entry.id))
    for (const [id, record] of status) {
      if (live.has(id)) continue
      record.dispose()
      status.delete(id)
    }
    for (const entry of entries) {
      if (status.has(entry.id)) {
        if (refreshExisting) ctx.blueStatusEntries.refresh(`plugin.status.${entry.id}`)
        continue
      }
      const source = (): BlueStatusEntry | null => {
        const node = entry.render()
        return node === null ? {
          id: `plugin.status.${entry.id}`,
          priority: entry.priority ?? 50,
          row: 2,
          node: { kind: 'text', content: '' },
          visible: false,
          overflow: 'truncate',
        } : {
          id: `plugin.status.${entry.id}`,
          priority: entry.priority ?? 50,
          row: 2,
          node,
          visible: true,
          overflow: 'truncate',
        }
      }
      status.set(entry.id, { contribution: entry, dispose: ctx.blueStatusEntries.register(source) })
      ctx.blueStatusEntries.refresh(`plugin.status.${entry.id}`)
    }
    statusRevision = revision
  }

  const sync = (snapshot: BluePluginHostSnapshot): void => {
    syncStatus(snapshot.status, snapshot.statusRevision ?? snapshot.revision ?? 0)
  }
  const subscription = subscribeBluePluginHost(host, sync)
  ctx.effect(() => () => {
    subscription.dispose()
    for (const record of status.values()) record.dispose()
    status.clear()
  })
}
