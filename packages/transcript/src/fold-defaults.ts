/**
 * Per-category expansion defaults for transcript entries: whether thinking
 * blocks and tool cards mount expanded before any Ctrl-O press. The values
 * are module-level with a test setter (the `window.ts` precedent) and are
 * driven by the host settings document — the mounter reads the resolved
 * `blue` namespace (`collapseThinking` / `collapseToolCalls`) through the
 * optional `settings` service and translates it here; `fold.ts` stays pure
 * (D16) and never reads policy. Both categories default to collapsed,
 * byte-identical to the pre-settings behavior; the Ctrl-O toggle composes
 * over them, so releasing the toggle returns each category to its
 * configured default instead of unconditionally collapsing.
 *
 * @module @dsh-blue/blue-transcript/fold-defaults
 */

/** One expansion-defaults reading: `true` mounts that category expanded. */
interface ExpansionDefaults {
  thinking: boolean
  tools: boolean
}

/** The shipped defaults: every category collapsed, as before settings. */
const DEFAULT_EXPANSION: ExpansionDefaults = { thinking: false, tools: false }

let current: ExpansionDefaults = { ...DEFAULT_EXPANSION }

/**
 * Merge new per-category defaults (the settings driver and tests inject
 * here). Keys absent from `next` keep their current value.
 * @param next - the partial replacement, or `undefined` to restore both
 *   shipped defaults.
 */
export function setDefaultExpansion(next?: { thinking?: boolean, tools?: boolean }): void {
  if (next === undefined) {
    current = { ...DEFAULT_EXPANSION }
    return
  }
  current = {
    thinking: next.thinking ?? current.thinking,
    tools: next.tools ?? current.tools,
  }
}

/**
 * Read the active expansion default of one category.
 * @param kind - the category: `'thinking'` blocks or `'tools'` cards.
 * @returns whether entries of that category mount expanded by default.
 */
export function defaultExpansion(kind: 'thinking' | 'tools'): boolean {
  return current[kind]
}
