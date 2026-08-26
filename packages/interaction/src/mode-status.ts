/**
 * `blue-status-mode` plugin: the session-mode footer badge (S24a). Normal
 * renders '' — the entry occupies nothing; plan paints `accent` (a queued
 * entry shows the `…` of the upstream "applies from the next step"
 * wording) and yolo paints `warning`, the cautionary role befitting an
 * auto-approve stance. The badge reads the app-owned renderer-neutral mode
 * snapshot and re-derives through the session reader subscription. Agent,
 * Session, and plan-controller objects never cross into this renderer.
 *
 * @module @dsh-blue/blue-interaction/mode-status
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-app'
import type { StatusModel } from '@dsh-blue/blue-frontend'
// Empty import carries the transcript-owned `blueStatusModels` Context merge.
import type {} from '@dsh-blue/blue-transcript'

/** Stable Cordis plugin name. */
export const name = 'blue-status-mode'

/** Services required before the mode badge can register. */
export const inject = ['blueStatusModels', 'blueSessionReader', 'blueSessionActions']

/**
 * Register the mode badge. Yolo outranks the one transient where both
 * read true (a plan exit queued mid-turn, or the watcher's deferred
 * `/yolo off` not yet flushed): approvals auto-allow now, so the yolo
 * badge is the operative truth and the plan leg converges by the next
 * step boundary.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  let text = ''

  const derive = (): void => {
    const state = ctx.blueSessionActions.modeState()
    text = state?.mode === 'yolo' ? 'yolo' : state?.mode === 'plan' ? state.pending ? 'plan…' : 'plan' : ''
  }

  const refresh = (): void => {
    const before = text
    derive()
    if (text !== before) ctx.blueStatusModels.refresh('blue.status.mode')
  }

  derive()
  const registration = ctx.blueSessionReader.subscribe(() => refresh())
  ctx.effect(() => () => registration.dispose())

  const model = (): StatusModel => ({ kind: 'status', id: 'blue.status.mode', priority: 2, view: { kind: 'text', text, tone: text === 'yolo' ? 'warning' : 'accent' }, visible: text !== '' })
  ctx.effect(() => ctx.blueStatusModels.register(model))
}
