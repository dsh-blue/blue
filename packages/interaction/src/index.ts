/**
 * @deepseek-ai/dsh-blue-interaction — Blue terminal UI interaction layer
 * over `dsh-blue-core`: the bottom input editor with slash-command dispatch
 * (`blue-input`), the built-in `/quit` and `/resume` commands
 * (`blue-commands`), the `ctx.userQuestions` overlay provider
 * (`blue-questions`), and the interactive `approval/request` answerer
 * (`blue-approval`). All key handling resolves through `ctx.blueKeymap`
 * (`blue-interaction-keys`); all registrations are effect-bound, so
 * unloading the fiber reverts every contribution.
 *
 * @module @deepseek-ai/dsh-blue-interaction
 */

import type { Context } from '@deepseek-ai/cordis'
import * as approvalPlugin from './approval-plugin.ts'
import * as commandsPlugin from './commands-plugin.ts'
import * as inputPlugin from './input-plugin.ts'
import * as keysPlugin from './keys.ts'
import * as questionsPlugin from './questions-plugin.ts'

export { BlueInput } from './editor.ts'
export type { BlueInputOptions } from './editor.ts'
export { BluePanel, BlueSelect } from './select.ts'
export type { BlueSelectItem, BlueSelectOptions } from './select.ts'

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
