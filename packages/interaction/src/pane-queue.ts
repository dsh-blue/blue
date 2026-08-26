/**
 * `blue-pane-queue` plugin: a bottom-pinned pane listing the UI current
 * agent's queued inbox messages — one muted row each with a `turn:`/`step:`
 * target prefix, refreshed off the `agent/inbox/*` live events filtered to
 * that agent. The plugin also registers the keyless contextual
 * `blue.queue.recall` key action that gates the empty-editor Up recall in
 * `blue-input` (`./input-plugin.ts`): the action binds no keys because `up`
 * is already claimed by `blue.interaction.move-up` and the keymap rejects
 * duplicate claims, so the action's presence in `blueKeymap.list()` is the
 * enable signal and the recall itself matches through the existing move-up
 * binding. Ships as a subpath plugin so the baseline bundle keeps plain
 * pi-tui history navigation on Up.
 *
 * @module @dsh-blue/blue-interaction/pane-queue
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DockModel } from '@dsh-blue/blue-frontend'
// Carries the transcript-owned dock service declaration without a runtime
// dependency; the bundle provides it before this row.
import type {} from '@dsh-blue/blue-transcript/dock-model'
// Empty type import carries the app-owned renderer-neutral session services.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-queue'
/** Services required before the pane can mount. */
export const inject = [
  'blueScreen',
  'blueTheme',
  'blueKeymap',
  'blueComponents',
  'blueDockModels',
  'blueSessionReader',
  'blueSessionActions',
]

/**
 * Contextual action gating the empty-editor Up recall in `blue-input`.
 * Registered keyless by this plugin; see the module header.
 */
export const ACTION_QUEUE_RECALL = 'blue.queue.recall'

/** Collapse a multi-line string to one line for pane rendering. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Mount the queue pane and the recall-gating key action; both revert when
 * the plugin's fiber unloads.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents

  const renderPane = (width: number): string[] => {
      const pending = ctx.blueSessionActions.queued()
      if (pending.length === 0) return []
      const rows: string[] = []
      for (const message of pending) {
        // The `↑` glyph is the activity accent, the row text stays muted:
        // truncate the plain row first, then split at the glyph — SGR
        // inserted before truncation would corrupt the width. The
        // display-width truncation (not char counting) is load-bearing:
        // queued texts carry CJK, whose cells are two columns wide
        // (the S33 acceptance crash — a char-counted cut left a row at
        // width + 2 and pi-tui threw).
        const plain = components.truncateToWidth(`queued ↑ ${message.target}: ${oneLine(message.text)}`, width)
        const at = plain.indexOf('↑')
        rows.push(
          at === -1
            ? colors.muted(plain)
            : colors.muted(plain.slice(0, at)) + colors.primary('↑') + colors.muted(plain.slice(at + 1)),
        )
      }
      return rows
  }

  const refresh = (): void => {
    ctx.blueDockModels.refresh('blue.dock.queue')
  }
  const sessionRegistration = ctx.blueSessionReader.subscribe(refresh)
  ctx.effect(() => () => sessionRegistration.dispose())

  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_QUEUE_RECALL,
    keys: [],
    description: 'Recall the latest queued message into the empty editor (up)',
  }]))
  const model = (): DockModel => ({
    kind: 'dock', id: 'blue.dock.queue', placement: 'bottom', priority: 20,
    view: { kind: 'text', text: ctx.blueSessionActions.queued().length === 0 ? '' : 'Queued messages' },
  })
  ctx.effect(() => ctx.blueDockModels.register(model, (_model, width) => renderPane(width)))
}
