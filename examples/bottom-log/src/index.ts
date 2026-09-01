/**
 * Opt-in renderer-neutral bottom log pane.
 *
 * @module @dsh-blue-example/bottom-log
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@dsh-blue-example/bottom-log'
export const inject = ['bluePanes']

/** Register a bounded passive log in the bottom surface lane. */
export function apply(ctx: Context): void {
  ctx.bluePanes.register({
    id: 'example.log.recent',
    title: 'Recent activity',
    placement: 'bottom',
    size: { min: 2, preferred: 4, max: 6 },
    narrow: 'bottom',
    render: () => ui.surface({
      chrome: 'lane',
      child: ui.sections([
        { body: ui.text('Plugin loaded', { tone: 'success' }) },
        { body: ui.text('Waiting for the next host event', { tone: 'muted' }) },
      ]),
    }),
  })
}
