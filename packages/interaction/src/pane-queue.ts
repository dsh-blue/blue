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
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { GutterComponent, type BlueComponent } from '@dsh-blue/blue-core'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
import { currentBlueAgent } from './session.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-pane-queue'
/** Services required before the pane can mount. */
export const inject = ['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']

/**
 * Contextual action gating the empty-editor Up recall in `blue-input`.
 * Registered keyless by this plugin; see the module header.
 */
export const ACTION_QUEUE_RECALL = 'blue.queue.recall'

/**
 * Join the visible text of a queued message's content blocks: text blocks
 * only, newline-joined, mirroring the transcript fold's extraction.
 * @param message - the queued user message.
 * @returns the display/recall text, empty for text-less messages.
 */
export function queuedMessageText(message: UserMessage): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  return parts.join('\n')
}

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
  const screen = ctx.blueScreen
  const components = ctx.blueComponents
  // Re-read through blueSession on every switch; the app plugin may
  // activate after this one, so blueSession is never injected.
  let agent = currentBlueAgent(ctx)

  const pane: BlueComponent = {
    invalidate(): void {},
    render(width: number): string[] {
      if (agent === undefined || !agent.inbox.hasPending) return []
      const rows: string[] = []
      const pending: readonly (readonly [string, readonly UserMessage[]])[] = [
        ['turn', agent.inbox.nextTurn],
        ['step', agent.inbox.nextStep],
      ]
      for (const [target, messages] of pending) {
        for (const message of messages) {
          // The `↑` glyph is the activity accent, the row text stays muted:
          // truncate the plain row first, then split at the glyph — SGR
          // inserted before truncation would corrupt the width. The
          // display-width truncation (not char counting) is load-bearing:
          // queued texts carry CJK, whose cells are two columns wide
          // (the S33 acceptance crash — a char-counted cut left a row at
          // width + 2 and pi-tui threw).
          const plain = components.truncateToWidth(`queued ↑ ${target}: ${oneLine(queuedMessageText(message))}`, width)
          const at = plain.indexOf('↑')
          rows.push(
            at === -1
              ? colors.muted(plain)
              : colors.muted(plain.slice(0, at)) + colors.primary('↑') + colors.muted(plain.slice(at + 1)),
          )
        }
      }
      return rows
    },
  }

  ctx.on('blue/session-changed', (next) => {
    agent = next
    screen.requestRender()
  })
  const inboxChanged = (payload: { agent: Agent }): void => {
    if (payload.agent === agent) screen.requestRender()
  }
  ctx.on('agent/inbox/inserted', inboxChanged)
  ctx.on('agent/inbox/claimed', inboxChanged)
  ctx.on('agent/inbox/discarded', inboxChanged)

  ctx.effect(() => ctx.blueKeymap.register([{
    id: ACTION_QUEUE_RECALL,
    keys: [],
    description: 'Recall the latest queued message into the empty editor (up)',
  }]))
  // Bottom-pinned like the input editor; the pane's ordering against it is
  // the composing bundle patch's concern.
  ctx.effect(() => screen.addBottomChild(new GutterComponent(pane)))
}
