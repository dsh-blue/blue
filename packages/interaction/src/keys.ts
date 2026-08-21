/**
 * The shared Blue interaction key actions. One batch registered once by the
 * `blue-interaction-keys` plugin: the multi-select overlay (`BlueSelect`)
 * resolves its keys through `ctx.blueKeymap` against these action ids, so
 * key claims never conflict and hint text reflects the registered bindings.
 * The editor-context actions (interrupt, steer) carry no handler: they are
 * resolved by the main editor's `onKey` hook in `./input-plugin.ts`, never
 * by the global dispatcher. Text-editing keys are owned by the pi-tui
 * Editor behind `ctx.blueComponents.createEditor` and do not appear here —
 * the single exception is the contextual `backspace` gate for mode exits
 * like bash's "Backspace on an empty `!` prompt" (`editor-plus` matches
 * it in its own `onKey` wrapper; it never dispatches).
 *
 * @module @dsh-blue/blue-interaction/keys
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BlueKeyAction } from '@dsh-blue/blue-core'

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
/** Clear the input, interrupt the agent, or exit on a second press (Ctrl-C); editor-context only. */
export const ACTION_INTERRUPT = 'blue.interaction.interrupt'
/** Steer the current turn with the drafted input (Ctrl-S); editor-context only. */
export const ACTION_STEER = 'blue.interaction.steer'
/**
 * Delete backward — contextual only: the pi-tui Editor owns actual
 * deletion, and this action is a gate for mode exits like bash's
 * "Backspace on an empty `!` prompt" (editor-plus matches it, it never
 * dispatches).
 */
export const ACTION_BACKSPACE = 'blue.interaction.backspace'
/**
 * Step the active segment control left (Left arrow) — contextual only:
 * the thinking-segment panels (`/model`, `/effort`) match it in their own
 * `handleInput`; the pi-tui Editor owns cursor-left in text.
 */
export const ACTION_SEGMENT_LEFT = 'blue.interaction.segment-left'
/**
 * Step the active segment control right (Right arrow) — contextual only,
 * the mirror of {@link ACTION_SEGMENT_LEFT}.
 */
export const ACTION_SEGMENT_RIGHT = 'blue.interaction.segment-right'
/**
 * Confirm the active surface session-only — no persisted default
 * (Alt+S) — contextual only: the model-family panels match it to commit a
 * switch that leaves the default-model service untouched.
 */
export const ACTION_SESSION_ONLY = 'blue.interaction.session-only'
/**
 * Cycle the session mode normal → plan → yolo (Shift+Tab) — contextual
 * only: the main editor's `onKey` chain matches it in
 * `./input-plugin.ts`; panels and questionnaires keep their own
 * Shift+Tab tab-navigation because the chain runs solely under editor
 * focus.
 */
export const ACTION_CYCLE_MODE = 'blue.interaction.cycle-mode'
/**
 * Hand the draft to the external editor $VISUAL/$EDITOR (Ctrl-G) —
 * contextual only: the main editor's `onKey` chain matches it in
 * `./input-plugin.ts` and runs the `blueScreen.suspend` flow from
 * `./external-editor.ts` (S31).
 */
export const ACTION_EXTERNAL_EDITOR = 'blue.interaction.external-editor'

/** The full interaction key batch, registered as one unit. */
export const INTERACTION_KEY_ACTIONS: readonly BlueKeyAction[] = [
  { id: ACTION_SUBMIT, keys: 'enter', description: 'Submit input / confirm selection' },
  { id: ACTION_CANCEL, keys: 'escape', description: 'Cancel or dismiss the active surface' },
  { id: ACTION_MOVE_UP, keys: 'up', description: 'Move the list cursor up' },
  { id: ACTION_MOVE_DOWN, keys: 'down', description: 'Move the list cursor down' },
  { id: ACTION_TOGGLE, keys: 'space', description: 'Toggle the focused choice in a multi-select' },
  { id: ACTION_INTERRUPT, keys: 'ctrl+c', description: 'Clear input / interrupt the agent / press twice to exit' },
  { id: ACTION_STEER, keys: 'ctrl+s', description: 'Steer the current turn with the draft' },
  { id: ACTION_BACKSPACE, keys: 'backspace', description: 'Delete backward / exit bash mode on an empty prompt' },
  { id: ACTION_SEGMENT_LEFT, keys: 'left', description: 'Step the segment control left (contextual)' },
  { id: ACTION_SEGMENT_RIGHT, keys: 'right', description: 'Step the segment control right (contextual)' },
  { id: ACTION_SESSION_ONLY, keys: 'alt+s', description: 'Confirm session-only, no persisted default (contextual)' },
  { id: ACTION_CYCLE_MODE, keys: 'shift+tab', description: 'Cycle the session mode: normal → plan → yolo' },
  { id: ACTION_EXTERNAL_EDITOR, keys: 'ctrl+g', description: 'Edit the draft in your external editor ($VISUAL/$EDITOR)' },
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
