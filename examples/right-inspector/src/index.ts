/**
 * Opt-in renderer-neutral right inspector using the shared user kit.
 *
 * @module @dsh-blue-example/right-inspector
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'
import { summaryMetric } from '@dsh-blue-example/user-kit'

export const name = '@dsh-blue-example/right-inspector'
export const inject = ['bluePluginHost']

/** Register a right lane that degrades into the bottom lane when narrow. */
export function apply(ctx: Context): void {
  const opened = ctx.bluePluginHost.open(ctx, { id: name, api: '^1.0.0-beta.1', capabilities: ['panes'] })
  if (!opened.ok) return
  opened.value.panes!.register({
    id: 'example.inspector.context',
    title: 'Inspector',
    placement: 'right',
    size: { min: 20, preferred: 30, max: 40 },
    narrow: 'bottom',
    render: () => ui.stack.column([
      summaryMetric.render({ label: 'Context', value: '42%', detail: '12k / 28k tokens' }),
      ui.fields([
        { label: 'Mode', value: [{ text: 'normal', tone: 'success' }] },
        { label: 'Model', value: [{ text: 'deepseek-chat', tone: 'accent' }] },
      ]),
    ], { gap: 1 }),
  })
}
