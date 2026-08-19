/**
 * The persistent hint row's content: the key-affordance fragments shown
 * under the input editor when no transient notice or slash suggestion owns
 * the line (priority: notice > slash hint > this row). The fragments come
 * from a curated action-id whitelist resolved through `blueKeymap.getKeys`
 * — never a `keymap.list()` dump, which would pour approval, questionnaire,
 * and pane actions into a one-row hint — plus existence gates for optional
 * enhancements: the `! bash` and `@ files` affordances are only advertised
 * while `blue-editor-plus` is attached, and the paste-image binding while
 * its keymap action is registered. Both states are read at render time, so
 * a plugin loading later flips the row without re-wiring. Pure module: the
 * sources are injected, keymap-free, trivially testable.
 *
 * @module @dsh-blue/blue-interaction/hint-content
 */

import { ACTION_CANCEL, ACTION_INTERRUPT, ACTION_STEER } from './keys.ts'
import { ACTION_IMAGE_PASTE } from './paste-image.ts'

/** The injected fact sources the hint fragments resolve against. */
export interface HintSources {
  /**
   * The keys bound to a keymap action, in binding order; the first is shown.
   * @param action - the action id.
   * @returns the bound key ids, empty when the action is not registered.
   */
  keys(action: string): readonly string[]
  /** Whether the `blue-editor-plus` enhancement is attached to the editor. */
  readonly editorPlus: boolean
  /** Whether the paste-image keymap action is registered. */
  readonly pasteImage: boolean
}

/**
 * The display label for one action's binding, or `undefined` when the
 * action carries no keys (dropped from the row rather than shown keyless).
 * @param sources - the fact sources.
 * @param action - the action id.
 * @returns the first bound key id, verbatim.
 */
function keyLabel(sources: HintSources, action: string): string | undefined {
  return sources.keys(action)[0]
}

/**
 * Compose the idle-state hint: the affordances of an idle editor. The
 * `! bash` and `@ files` fragments appear only with the editor-plus
 * enhancement; every key-named fragment drops when its action is unbound.
 * @param sources - the fact sources.
 * @returns the joined fragments; `/ commands` always survives.
 */
export function idleHint(sources: HintSources): string {
  const parts: string[] = []
  if (sources.editorPlus) parts.push('! bash')
  parts.push('/ commands')
  if (sources.editorPlus) parts.push('@ files')
  const steer = keyLabel(sources, ACTION_STEER)
  if (steer !== undefined) parts.push(`${steer} steer`)
  if (sources.pasteImage) {
    const paste = keyLabel(sources, ACTION_IMAGE_PASTE)
    if (paste !== undefined) parts.push(`${paste} paste image`)
  }
  const exit = keyLabel(sources, ACTION_INTERRUPT)
  if (exit !== undefined) parts.push(`${exit} exit`)
  return parts.join(' · ')
}

/**
 * Compose the running-state hint: the two actions that matter while an
 * agent turn is in flight.
 * @param sources - the fact sources.
 * @returns the joined fragments, possibly empty when neither action is bound.
 */
export function runningHint(sources: HintSources): string {
  const parts: string[] = []
  const interrupt = keyLabel(sources, ACTION_CANCEL)
  if (interrupt !== undefined) parts.push(`${interrupt} interrupt`)
  const steer = keyLabel(sources, ACTION_STEER)
  if (steer !== undefined) parts.push(`${steer} steer`)
  return parts.join(' · ')
}
