/**
 * Opt-in renderer-neutral header pane demonstrating a shared user kit.
 *
 * @module @dsh-blue-example/header
 */
import type { Context } from '@deepseek-ai/cordis'
// Pull in Context.bluePluginHost without introducing a runtime API import.
import type {} from '@dsh-blue/blue-api'
import { summaryMetric } from '@dsh-blue-example/user-kit'

export const name = '@dsh-blue-example/header'
export const inject = ['bluePluginHost']

/** Register the example header contribution for this plugin Fiber. */
export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: name,
    api: '^1.0.0-beta.1',
    capabilities: ['panes'],
  })
  if (!opened.ok) return
  opened.value.panes!.register({
    id: 'example.header.summary',
    title: 'Workspace',
    placement: 'header',
    size: { min: 1, preferred: 3, max: 4 },
    narrow: 'hidden',
    render: () => summaryMetric.render({ label: 'Branch', value: 'main', detail: 'Blue ecosystem example' }),
  })
}
