/**
 * `blue-pane-queue` plugin: a bottom-pinned pane listing the UI current
 * agent's queued inbox messages — one muted row each with a `turn:`/`step:`
 * target prefix, refreshed from the app-owned `blue/queue-changed`
 * notification after an inbox mutation. It never claims Up/Down: those keys
 * always remain editor-history navigation.
 *
 * @module @dsh-blue/blue-interaction/pane-queue
 */

import type { Context } from '@deepseek-ai/cordis'
// Carries the transcript-owned bottom-pane service declaration without a
// runtime dependency; the bundle provides it before this row.
import type {} from '@dsh-blue/blue-transcript'
// Empty type import carries the app-owned renderer-neutral session services.
import type {} from '@dsh-blue/blue-app'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-queue'
/** Services required before the pane can mount. */
export const inject = [
  'blueScreen',
  'blueTheme',
  'blueComponents',
  'blueBottomPanes',
  'blueSessionReader',
  'blueSessionActions',
]

/** Collapse a multi-line string to one line for pane rendering. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * Mount the queue pane and subscribe to the app-owned queue notification.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents

  const renderPane = (width: number): string[] => {
    const pending = ctx.blueSessionActions.queued()
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
    ctx.blueBottomPanes.refresh('blue.dock.queue')
  }
  const sessionRegistration = ctx.blueSessionReader.subscribe(refresh)
  ctx.effect(() => () => sessionRegistration.dispose())

  ctx.effect(() => ctx.on('blue/queue-changed', refresh))
  const model = () => {
    const pending = ctx.blueSessionActions.queued()
    return {
      id: 'blue.dock.queue', priority: 20,
      node: { kind: 'text' as const, content: pending.length === 0 ? '' : 'Queued messages' },
      collapsed: pending.length === 0,
    }
  }
  ctx.effect(() => ctx.blueBottomPanes.register(model, (_node, width) => renderPane(width)))
}
