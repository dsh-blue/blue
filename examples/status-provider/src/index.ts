/**
 * Inert custom status provider candidate; user settings remain host-owned.
 *
 * @module @dsh-blue-example/status-provider
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BlueStatusProvider } from '@dsh-blue/blue-api'
import type {} from '@dsh-blue/blue-api'

export const name = '@dsh-blue-example/status-provider'
export const inject = ['bluePluginHost']

/** Compact status tree rendered only after explicit user selection. */
export const statusProvider: BlueStatusProvider = {
  id: 'example.status.compact',
  render: snapshot => ({
    kind: 'stack',
    direction: 'row',
    gap: 1,
    children: [
      { node: { kind: 'text', content: snapshot.busy ? 'Working' : 'Ready', tone: snapshot.busy ? 'accent' : 'success' } },
      { node: { kind: 'text', content: snapshot.session?.model?.id ?? 'No model', tone: 'muted' }, grow: 1, when: { minWidth: 24 } },
      { node: { kind: 'text', content: snapshot.session?.mode ?? 'normal', tone: 'muted' } },
    ],
  }),
}

/** Add an inert candidate without reading or writing provider selection. */
export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, { id: name, api: '^1.0.0', capabilities: ['status.provider'] })
  if (!opened.ok) return
  opened.value.statusProviders!.register(statusProvider)
}
