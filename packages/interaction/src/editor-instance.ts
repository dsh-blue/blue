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
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

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
 * The presence id of the `blue-editor-plus` enhancement: bash mode and the
 * slash/`@` autocomplete live on its optional fiber, and other surfaces
 * (the persistent hint row) advertise those affordances only while it is
 * attached.
 */
export const ENHANCEMENT_EDITOR_PLUS = 'blue-editor-plus'

/** Currently attached enhancement ids. */
const enhancements = new Set<string>()

/**
 * Mark an enhancement as attached to the shared editor; called inside a
 * `ctx.effect` so unloading reverts the mark.
 * @param id - the enhancement presence id.
 * @returns an idempotent disposer removing exactly this mark.
 */
export function markEditorEnhancement(id: string): () => void {
  enhancements.add(id)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    enhancements.delete(id)
  }
}

/**
 * Whether an enhancement is currently attached.
 * @param id - the enhancement presence id.
 * @returns the attachment state.
 */
export function hasEditorEnhancement(id: string): boolean {
  return enhancements.has(id)
}

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

/**
 * Rewrites one submitted line into content blocks. Enhancement plugins (e.g.
 * `blue-paste-image`) register one to contribute non-text blocks: the
 * transformer receives the ORIGINAL submitted text and returns the blocks it
 * owns, splitting text runs around its markers itself. An empty array means
 * "nothing to contribute" and the text passes through unchanged.
 */
export type SubmitTransformer = (text: string) => ContentBlock[]

/** Registered transformers, in registration order. */
const submitTransformers: SubmitTransformer[] = []

/**
 * Register a submit transformer; called by enhancement plugins inside a
 * `ctx.effect` so unloading reverts the contribution.
 * @param transformer - the transformer to append.
 * @returns an idempotent disposer removing exactly this registration.
 */
export function registerSubmitTransformer(transformer: SubmitTransformer): () => void {
  submitTransformers.push(transformer)
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    submitTransformers.splice(submitTransformers.indexOf(transformer), 1)
  }
}

/**
 * Build the content blocks for one submitted line: the concatenation of
 * every registered transformer's contribution, in registration order. With
 * no transformers registered — or when every transformer declines (returns
 * an empty array) — the result is the historical single text block, so the
 * baseline behavior is unchanged.
 * @param text - the submitted line.
 * @returns the message content blocks.
 */
export function applySubmitTransformers(text: string): ContentBlock[] {
  if (submitTransformers.length === 0) return [{ type: 'text', text }]
  const blocks = submitTransformers.flatMap(transformer => transformer(text))
  return blocks.length === 0 ? [{ type: 'text', text }] : blocks
}
