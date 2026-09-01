/**
 * `blue-status-title` plugin: the session-title footer entry — the folded
 * title right-aligned on the footer's first band (priority 30, the muted
 * tier: ambient identity, not primary status — the slot the rotating tips
 * occupied before they retired to the activity pane). The title is generated
 * upstream by the harness session-title service and exposed through its
 * official `title` session projection. This entry reads that projection via
 * `blueSessionFacts`; it never folds or subscribes to Harness events. An
 * untitled session renders '' and occupies nothing, so a fresh
 * session shows no empty slot and the second band keeps only the context
 * bar; a thin host without the title projection behaves the same.
 *
 * @module @dsh-blue/blue-transcript/status-title
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueStatusEntry } from './status-model.ts'
import type { SessionFactsService } from './session-facts.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-status-title'

/** Services required before the title entry can register. */
export const inject = ['blueStatus', 'blueSessionFacts']

/**
 * Register the title entry over the official title projection.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  const facts = ctx.get('blueSessionFacts') as SessionFactsService
  let text = facts.currentTitle ?? ''
  const offTitle = facts.subscribeTitle((title) => {
    const next = title ?? ''
    if (next === text) return
    text = next
    ctx.blueStatus.refresh('blue.status.title')
  })
  ctx.effect(() => () => offTitle())

  const model = (): BlueStatusEntry => ({ id: 'blue.status.title', priority: 30, band: 'right', node: { kind: 'text', content: text, tone: 'muted' }, visible: text !== '' })
  ctx.blueStatus.register(model)
}
