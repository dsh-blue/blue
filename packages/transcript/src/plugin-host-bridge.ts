/**
 * Blue-owned adapter from public additive plugin models to the transcript's
 * dock and status registries. Dynamic code never receives either renderer
 * service; this fiber alone compiles `BlueView` and owns all mount disposers.
 *
 * @module @dsh-blue/blue-transcript/plugin-host-bridge
 */

import type { Context } from '@deepseek-ai/cordis'
import { subscribeBluePluginHost, type BlueDockContribution, type BluePluginHostSnapshot, type BlueStatusContribution } from '@dsh-blue/blue-api'
import { BluePluginViewComponent, GutterComponent, PLUGIN_VIEW_MAX_ROWS } from '@dsh-blue/blue-core'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-view-bridge'

/** Owner services required before public views can reach the tree. */
export const inject = ['bluePluginHost', 'blueScreen', 'blueStatus', 'blueTheme', 'blueComponents']

function rowBudget(contribution: BlueDockContribution): number {
  const requested = contribution.preferredRows
  if (requested === undefined || !Number.isFinite(requested)) return PLUGIN_VIEW_MAX_ROWS
  return Math.max(0, Math.min(PLUGIN_VIEW_MAX_ROWS, Math.floor(requested)))
}

/** Mount additive dock and status contributions behind owner adapters. */
export function apply(ctx: Context): void {
  const dock = new Map<string, () => void>()
  const status = new Map<string, () => void>()
  let dockOrder = ''

  const syncStatus = (entries: readonly BlueStatusContribution[]): void => {
    const live = new Set(entries.map(entry => entry.id))
    for (const [id, dispose] of status) {
      if (live.has(id)) continue
      dispose()
      status.delete(id)
    }
    for (const entry of entries) {
      if (status.has(entry.id)) continue
      const component = new BluePluginViewComponent(entry.render, ctx.blueComponents, ctx.blueTheme.colors, 1)
      const dispose = ctx.blueStatus.register({
        id: `plugin.status.${entry.id}`,
        priority: entry.priority ?? 50,
        row: 2,
        render: width => component.render(width)[0] ?? '',
      })
      status.set(entry.id, dispose)
    }
  }

  const syncDock = (entries: readonly BlueDockContribution[]): void => {
    const nextOrder = entries.map(entry => entry.id).join('\x00')
    if (nextOrder === dockOrder) return
    for (const dispose of dock.values()) dispose()
    dock.clear()
    for (const entry of entries) {
      const component = new GutterComponent(new BluePluginViewComponent(
        entry.view,
        ctx.blueComponents,
        ctx.blueTheme.colors,
        rowBudget(entry),
      ))
      dock.set(entry.id, ctx.blueScreen.addBottomChild(component))
    }
    dockOrder = nextOrder
    ctx.blueScreen.requestRender()
  }

  const sync = (snapshot: BluePluginHostSnapshot): void => {
    syncStatus(snapshot.status)
    syncDock(snapshot.dock)
  }
  const subscription = subscribeBluePluginHost(ctx.bluePluginHost, sync)
  ctx.effect(() => () => {
    subscription.dispose()
    for (const dispose of dock.values()) dispose()
    for (const dispose of status.values()) dispose()
    dock.clear()
    status.clear()
  })
}
