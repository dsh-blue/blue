/**
 * Module-level stash of the input editor's unsubmitted draft. A theme swap
 * disposes the theme provider fiber and Cordis reloads every `blueTheme`
 * dependent — including `blue-input`, whose editor component is rebuilt
 * from scratch. The module instance survives the reload while the component
 * does not, so the draft lives here: `blue-input` mirrors every edit into
 * the stash through `onChange`, clears it when the text is consumed
 * (submit/steer), and restores it into the freshly mounted editor.
 *
 * @module @deepseek-ai/dsh-blue-interaction/draft-stash
 */

/** The stashed draft; the empty string means nothing to restore. */
let draft = ''

/**
 * Mirror the editor's current text into the stash.
 * @param text - the editor content to preserve across reloads.
 */
export function stashDraft(text: string): void {
  draft = text
}

/** Clear the stash; called when the draft is consumed (submitted/steered). */
export function clearDraft(): void {
  draft = ''
}

/**
 * Read the stashed draft.
 * @returns the preserved editor text, or `''` when nothing is stashed.
 */
export function getStashedDraft(): string {
  return draft
}
