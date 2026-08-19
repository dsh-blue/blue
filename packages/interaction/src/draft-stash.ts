/**
 * Module-level stash of the input editor's unsubmitted draft (text and
 * input mode). A theme swap disposes the theme provider fiber and Cordis
 * reloads every `blueTheme` dependent — including `blue-input`, whose
 * editor component is rebuilt from scratch. The module instance survives
 * the reload while the component does not, so the draft lives here:
 * `blue-input` mirrors every edit into the stash through `onChange`, clears
 * it when the text is consumed (submit/steer), and restores it into the
 * freshly mounted editor; `blue-editor-plus` mirrors the prompt/bash mode
 * the same way, so a bash draft reloads as bash.
 *
 * @module @dsh-blue/blue-interaction/draft-stash
 */

/** The stashed draft; the empty string means nothing to restore. */
let draft = ''

/**
 * The stashed input mode. Mirrored beside the draft text so a bash-mode
 * editor rebuilt by a theme swap comes back as bash (`!` symbol, border
 * label, and hue included) instead of silently turning the drafted shell
 * command into an agent prompt.
 */
let inputMode: 'prompt' | 'bash' = 'prompt'

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
  inputMode = 'prompt'
}

/**
 * Read the stashed draft.
 * @returns the preserved editor text, or `''` when nothing is stashed.
 */
export function getStashedDraft(): string {
  return draft
}

/**
 * Mirror the editor's input mode into the stash.
 * @param mode - `'prompt'` or `'bash'`.
 */
export function stashInputMode(mode: 'prompt' | 'bash'): void {
  inputMode = mode
}

/**
 * Read the stashed input mode.
 * @returns the preserved mode; `'prompt'` when nothing was stashed.
 */
export function getStashedInputMode(): 'prompt' | 'bash' {
  return inputMode
}
