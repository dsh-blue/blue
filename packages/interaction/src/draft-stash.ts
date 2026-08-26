/**
 * Frontend-tree stash of the input editor's unsubmitted draft (text and
 * input mode) and its prompt history. A theme swap disposes the theme
 * provider fiber and Cordis reloads every `blueTheme` dependent —
 * including `blue-input`, whose editor component is rebuilt from scratch.
 * The parent state service survives the reload while the component does not,
 * so `blue-input` mirrors every edit into this state
 * through `onChange`, clears it when the text is consumed (submit/steer),
 * and restores it into the freshly mounted editor; `blue-editor-plus`
 * mirrors the prompt/bash mode the same way, so a bash draft reloads as
 * bash. The history mirrors beside it (after every submission) — pi-tui
 * keeps the history in the component, so without the stash a `/theme`
 * argument submission would vanish from Up-recall the moment its own
 * command rebuilds the editor.
 *
 * @module @dsh-blue/blue-interaction/draft-stash
 */

/** Draft, mode, and history owned by one frontend tree. */
export class DraftStash {
  private draft = ''
  private inputMode: 'prompt' | 'bash' = 'prompt'
  private history: readonly string[] = []

/**
 * Mirror the editor's current text into the stash.
 * @param text - the editor content to preserve across reloads.
 */
  stashDraft(text: string): void { this.draft = text }

/** Clear the draft stash; called when the draft is consumed (submitted/steered). */
  clearDraft(): void {
    this.draft = ''
    this.inputMode = 'prompt'
  }

/**
 * Read the stashed draft.
 * @returns the preserved editor text, or `''` when nothing is stashed.
 */
  getStashedDraft(): string { return this.draft }

/**
 * Mirror the editor's input mode into the stash.
 * @param mode - `'prompt'` or `'bash'`.
 */
  stashInputMode(mode: 'prompt' | 'bash'): void { this.inputMode = mode }

/**
 * Read the stashed input mode.
 * @returns the preserved mode; `'prompt'` when nothing was stashed.
 */
  getStashedInputMode(): 'prompt' | 'bash' { return this.inputMode }

/**
 * Mirror the editor's prompt history into the stash.
 * @param entries - the history entries, newest first.
 */
  stashHistory(entries: readonly string[]): void { this.history = [...entries] }

/**
 * Read the stashed history.
 * @returns the preserved entries, newest first; empty when nothing was
 *   stashed.
 */
  getStashedHistory(): readonly string[] { return this.history }

  clearAll(): void {
    this.clearDraft()
    this.history = []
  }
}
