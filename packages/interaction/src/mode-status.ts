/**
 * `blue-status-mode` plugin: the session-mode footer badge (S24a). Normal
 * renders '' — the entry occupies nothing; plan paints `accent` (a queued
 * entry shows the `…` of the upstream "applies from the next step"
 * wording) and yolo paints `warning`, the cautionary role befitting an
 * auto-approve stance. The badge reads the same two sources the cycle
 * does — yolo from `./mode-state.ts`, plan through the `planMode`
 * controller (`ctx.get`, never `inject`: a composition without
 * dsh-plan-mode degrades to the yolo badge alone) — and re-derives on
 * session switches and the current session's events, the status-basic
 * discipline: one cheap re-derivation per event, a redraw only when the
 * painted text changed. Display-only fiber: it registers no commands, so
 * the `/theme` fiber-dispose trap does not apply — a theme swap rebuilds
 * the entry, the normal status-entry lifecycle, and the module-level yolo
 * WeakMap survives untouched.
 *
 * @module @dsh-blue/blue-interaction/mode-status
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Empty type import carries the `planMode` Context merge (dsh-plan-mode).
import type {} from '@deepseek-ai/dsh-plan-mode'
// Empty type import carries the app-owned `blueSession` Context merge and
// the `'blue/session-changed'` Events merge this plugin consumes.
import type {} from '@dsh-blue/blue-app'
// The named import also carries that package's `blueStatus` Context merge.
import type { BlueStatusEntry } from '@dsh-blue/blue-transcript'
import { yoloActive } from './mode-state.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-mode'

/** Services required before the mode badge can register. */
export const inject = ['blueStatus', 'blueScreen', 'blueTheme', 'blueComponents']

/**
 * Register the mode badge. Yolo outranks the one transient where both
 * read true (a plan exit queued mid-turn, or the watcher's deferred
 * `/yolo off` not yet flushed): approvals auto-allow now, so the yolo
 * badge is the operative truth and the plan leg converges by the next
 * step boundary.
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
    if (yoloActive(agent)) {
      text = 'yolo'
      return
    }
    const planMode = ctx.get('planMode')
    if (planMode === undefined) {
      text = ''
      return
    }
    const state = planMode.get(agent)
    if (state.pending === true) text = 'plan…'
    else if (state.active) text = 'plan'
    else text = ''
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
  ctx.on('session/event', (session) => {
    if (agent === undefined || session !== agent.session) return
    refresh()
  })

  const entry: BlueStatusEntry = {
    id: 'blue.status.mode',
    priority: 2,
    render(width: number): string {
      if (text === '') return ''
      const paint = text === 'yolo' ? colors.warning : colors.accent
      return paint(components.truncateToWidth(text, width))
    },
  }
  // Effect-bound so unloading this fiber unregisters the entry.
  ctx.effect(() => ctx.blueStatus.register(entry))
}
