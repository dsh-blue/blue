/**
 * `blue-status-basic` plugin: the baseline footer entry — `{model} · {agent
 * status}` in muted colors at priority 0, replacing the retired fixed
 * `StatusBarComponent`. Ships as a subpath entry so the composing bundle
 * lists it as its own patch row and a deployment can swap or drop the
 * baseline independently of the footer shell. The model prefers the durable
 * request header (`session.requestHeader()?.config.model`) over
 * `agent.options`, which can be empty on resume; `blueSession` is read
 * through `ctx.get` plus `'blue/session-changed'` (never `inject`), the same
 * discipline as the transcript plugin itself, because the app plugin may
 * activate after this one. Without an attached agent the entry renders ''
 * and the footer occupies nothing — matching the pre-footer behavior of
 * showing no status without a session.
 *
 * @module @dsh-blue/blue-transcript/status-basic
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Empty type import carries the app-owned `blueSession` Context merge and the
// `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
// The named import also carries this package's `blueStatus` Context merge.
import type { BlueStatusEntry } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-basic'

/** Services required before the baseline entry can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/**
 * Register the baseline entry. Re-derives its text on agent status flips
 * (filtered to the current agent), on session switches, and on the current
 * session's events — the first request of a session logs the `request/header`
 * snapshot the model name prefers. Redraws are requested only when the
 * derived text actually changed, so a streamed chunk costs one cheap
 * re-derivation and no render.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const colors = ctx.blueTheme.colors
  const components = ctx.blueComponents
  const screen = ctx.blueScreen
  let agent: Agent | undefined = ctx.get('blueSession')?.current ?? undefined
  let text = ''

  const derive = (): void => {
    if (agent === undefined) {
      text = ''
      return
    }
    const model = agent.session.requestHeader()?.config.model
      ?? agent.options.model
      ?? agent.options.provider
      ?? 'no model'
    text = `${model} · ${agent.status}`
  }

  const refresh = (): void => {
    const before = text
    derive()
    if (text !== before) screen.requestRender()
  }

  derive()
  ctx.on('blue/session-changed', (next) => {
    agent = next
    refresh()
  })
  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    refresh()
  })
  ctx.on('session/event', (session) => {
    if (agent === undefined || session !== agent.session) return
    refresh()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.basic',
    priority: 0,
    render(width: number): string {
      if (text === '') return ''
      return colors.muted(components.truncateToWidth(text, width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
