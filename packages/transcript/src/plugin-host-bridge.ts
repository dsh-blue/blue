/**
 * Blue-owned adapter from public additive plugin models to the transcript's
 * dock and status registries. Dynamic code never receives either renderer
 * service; this fiber alone compiles `BlueView` and owns all mount disposers.
 *
 * @module @dsh-blue/blue-transcript/plugin-host-bridge
 */

import { symbols, type Context } from '@deepseek-ai/cordis'
import { attachBluePluginHostCapabilities, subscribeBluePluginHost, type BlueDockContribution, type BluePluginHostSnapshot, type BlueStatusContribution, type BlueView } from '@dsh-blue/blue-api'
import { BluePluginViewComponent, GutterComponent, mountDockChild, PLUGIN_VIEW_MAX_ROWS } from '@dsh-blue/blue-core'
import type { StatusModel, View } from '@dsh-blue/blue-frontend'

/** Stable Cordis plugin name. */
export const name = 'blue-plugin-view-bridge'

/** Owner services required before public views can reach the tree. */
export const inject = ['bluePluginHost', 'blueScreen', 'blueStatusModels', 'blueTheme', 'blueComponents']

function rowBudget(contribution: BlueDockContribution): number {
  const requested = contribution.preferredRows
  if (requested === undefined || !Number.isFinite(requested)) return PLUGIN_VIEW_MAX_ROWS
  return Math.max(0, Math.min(PLUGIN_VIEW_MAX_ROWS, Math.floor(requested)))
}

function statusView(view: BlueView): View {
  switch (view.kind) {
    case 'text': return { kind: 'text', text: view.content, ...(view.tone === undefined ? {} : { tone: view.tone }) }
    case 'code': return { kind: 'code', code: view.code, ...(view.language === undefined ? {} : { language: view.language }) }
    case 'diff': return { kind: 'diff', before: view.before, after: view.after }
    case 'fields': return { kind: 'fields', fields: view.rows.map(row => ({ label: row.label, value: row.value.map(span => span.text).join('') })) }
    case 'sections': return { kind: 'sections', sections: view.sections.map(section => ({ title: section.title ?? '', body: statusView(section.body), ...(section.collapsed === undefined ? {} : { collapsed: section.collapsed }) })) }
  }
}

/** Mount additive dock and status contributions behind owner adapters. */
export function apply(ctx: Context): void {
  const host = (ctx.bluePluginHost as unknown as Record<symbol, typeof ctx.bluePluginHost | undefined>)[symbols.original] ?? ctx.bluePluginHost
  attachBluePluginHostCapabilities(host, ctx, ['dock', 'status'])
  const dock = new Map<string, () => void>()
  const status = new Map<string, { dispose: () => void, contribution: BlueStatusContribution }>()
  let dockOrder = ''

  const syncStatus = (entries: readonly BlueStatusContribution[]): void => {
    const live = new Set(entries.map(entry => entry.id))
    for (const [id, record] of status) {
      if (live.has(id)) continue
      record.dispose()
      status.delete(id)
    }
    for (const entry of entries) {
      if (status.has(entry.id)) continue
      const source = (): StatusModel | null => {
        const view = entry.render()
        return view === null ? {
          kind: 'status',
          id: `plugin.status.${entry.id}`,
          priority: entry.priority ?? 50,
          row: 2,
          view: { kind: 'text', text: '' },
          visible: false,
          overflow: 'truncate',
        } : {
          kind: 'status',
          id: `plugin.status.${entry.id}`,
          priority: entry.priority ?? 50,
          row: 2,
          view: statusView(view),
          visible: true,
          overflow: 'truncate',
        }
      }
      status.set(entry.id, { contribution: entry, dispose: ctx.blueStatusModels.register(source) })
      ctx.blueStatusModels.refresh(`plugin.status.${entry.id}`)
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
      dock.set(entry.id, mountDockChild(ctx.blueScreen, component, {
        priority: entry.priority ?? 50,
      }))
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
    for (const record of status.values()) record.dispose()
    dock.clear()
    status.clear()
  })
}
