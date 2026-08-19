/**
 * @dsh-blue/blue-interaction — Blue terminal UI interaction layer
 * over `dsh-blue-core`: the bottom input editor with slash-command dispatch
 * (`blue-input`, pi-tui Editor behind `ctx.blueComponents`), the built-in
 * `/quit`, `/resume`, `/new`, `/fork`, `/sessions`, `/help`, and `/theme`
 * commands (`blue-commands`), the `ctx.userQuestions`
 * overlay provider (`blue-questions`, one tabbed questionnaire overlay per
 * request), and the interactive four-choice `approval/request` answerer
 * (`blue-approval`). The optional bash-mode and autocomplete enhancement
 * layer ships as the `./editor-plus` subpath plugin (`blue-editor-plus`),
 * and the queued-message pane with the empty-editor Up recall as the
 * `./pane-queue` subpath plugin (`blue-pane-queue`). All registrations are
 * effect-bound, so unloading the fiber reverts every contribution.
 *
 * @module @dsh-blue/blue-interaction
 */

import type { Context } from '@deepseek-ai/cordis'
import * as approvalPlugin from './approval-plugin.ts'
import * as commandsPlugin from './commands-plugin.ts'
import * as inputPlugin from './input-plugin.ts'
import * as keysPlugin from './keys.ts'
import * as questionsPlugin from './questions-plugin.ts'

// BluePanel is the package's public overlay container; BlueSelect stays
// package-internal as the multi-select-only list (single-select moved to
// ctx.blueComponents.createSelectList) and is no longer exported.
export { BluePanel } from './select.ts'

/** Stable Cordis plugin name. */
export const name = 'blue-interaction'

/**
 * Mount the Blue interaction plugins. The key batch registers first; the
 * other plugins resolve their keys against it.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(keysPlugin)
  ctx.plugin(commandsPlugin)
  ctx.plugin(inputPlugin)
  ctx.plugin(questionsPlugin)
  ctx.plugin(approvalPlugin)
}
