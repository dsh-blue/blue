/**
 * Module-level shared reference to the input editor mounted by `blue-input`.
 * `blue-editor-plus` lives on a separate plugin fiber (an optional
 * enhancement row in the bundle patch), and `blue-input` provides no Cordis
 * service, so `inject` cannot order the enhancement after the editor mount.
 * Instead `blue-input` publishes the editor and its submit router here on
 * mount, clears them on unmount, and emits `'blue/input-editor-changed'` on
 * each transition; subscribers re-read the reference on every emission,
 * which also covers theme reloads rebuilding both plugins.
 *
 * @module @deepseek-ai/dsh-blue-interaction/editor-instance
 */

import type { BlueEditor } from '@deepseek-ai/dsh-blue-core'
// Empty type import carries the Cordis `Events` interface this file merges into.
import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The shared input editor reference changed: `blue-input` mounted a new
     * editor or unmounted the previous one. Consumers re-read
     * `getSharedEditor()` instead of caching the reference.
     * Unfiltered: the editor is a singleton owned by `blue-input`.
     * @mode emit
     */
    'blue/input-editor-changed'(): void
  }
}

/** The editor and callbacks `blue-input` publishes while mounted. */
export interface SharedEditor {
  /** The mounted input editor. */
  readonly editor: BlueEditor
  /**
   * Route one submitted line: slash-command dispatch through
   * `ctx.commands` or an agent follow-up, with history recording and
   * buffer clearing.
   * @param text - the expanded editor content.
   */
  readonly submitPrompt: (text: string) => void
  /**
   * Flash a one-shot notice in the hint line; used by overlay-driven flows
   * (e.g. the `/sessions` picker) whose outcome settles after the command
   * handler already returned.
   * @param text - the notice text; styling is the caller's.
   */
  readonly notice?: (text: string) => void
}

let shared: SharedEditor | undefined

/**
 * Publish the mounted editor; called by `blue-input` on mount.
 * @param value - the editor and its submit router.
 */
export function setSharedEditor(value: SharedEditor): void {
  shared = value
}

/** Clear the reference; called by `blue-input` on unmount. */
export function clearSharedEditor(): void {
  shared = undefined
}

/**
 * Read the currently mounted editor, if any.
 * @returns the shared editor entry, or `undefined` while `blue-input` is
 *   unmounted.
 */
export function getSharedEditor(): SharedEditor | undefined {
  return shared
}
