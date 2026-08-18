/**
 * The shared Blue interaction key actions. One batch registered once by the
 * `blue-interaction-keys` plugin: the multi-select overlay (`BlueSelect`)
 * resolves its keys through `ctx.blueKeymap` against these action ids, so
 * key claims never conflict and hint text reflects the registered bindings.
 * Text-editing keys are owned by the pi-tui Editor behind
 * `ctx.blueComponents.createEditor` and no longer appear here.
 *
 * @module @deepseek-ai/dsh-blue-interaction/keys
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueKeyAction } from '@deepseek-ai/dsh-blue-core'

/** Confirm the focused choice or submit the text (Enter). */
export const ACTION_SUBMIT = 'blue.interaction.submit'
/** Cancel or dismiss the active surface (Escape). */
export const ACTION_CANCEL = 'blue.interaction.cancel'
/** Move the list cursor up (Up arrow). */
export const ACTION_MOVE_UP = 'blue.interaction.move-up'
/** Move the list cursor down (Down arrow). */
export const ACTION_MOVE_DOWN = 'blue.interaction.move-down'
/** Toggle the focused choice in a multi-select list (Space). */
export const ACTION_TOGGLE = 'blue.interaction.toggle'

/** The full interaction key batch, registered as one unit. */
export const INTERACTION_KEY_ACTIONS: readonly BlueKeyAction[] = [
  { id: ACTION_SUBMIT, keys: 'enter', description: 'Submit input / confirm selection' },
  { id: ACTION_CANCEL, keys: 'escape', description: 'Cancel or dismiss the active surface' },
  { id: ACTION_MOVE_UP, keys: 'up', description: 'Move the list cursor up' },
  { id: ACTION_MOVE_DOWN, keys: 'down', description: 'Move the list cursor down' },
  { id: ACTION_TOGGLE, keys: 'space', description: 'Toggle the focused choice in a multi-select' },
]

/** Stable Cordis plugin name. */
export const name = 'blue-interaction-keys'
/** Services required before the key batch can register. */
export const inject = ['blueKeymap']

/**
 * Register the shared interaction key actions, unregistered automatically
 * when the plugin's fiber unloads.
 * @param ctx - plugin context carrying `blueKeymap`.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.blueKeymap.register([...INTERACTION_KEY_ACTIONS]))
}
