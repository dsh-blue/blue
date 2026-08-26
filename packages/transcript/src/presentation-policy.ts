/**
 * Frontend-tree-scoped transcript presentation policy. The host settings
 * document updates this object; semantic components read it without owning a
 * second Harness projection or leaking mutable policy between Cordis trees.
 *
 * @module @dsh-blue/blue-transcript/presentation-policy
 */

/** Default count of newest transcript turns kept mounted. */
export const DEFAULT_WINDOW_TURNS = 15
/** Recent steps retained by the domain projection before summary folding. */
export const DEFAULT_RECENT_STEPS_RETENTION = 30
/** Most-recent turns reached by the Ctrl-O expansion toggle. */
export const DEFAULT_EXPAND_TURNS = 3
/** Raw-line threshold above which a user message folds. */
export const DEFAULT_USER_FOLD_LINES = 10
/** Raw-character threshold above which a user message folds. */
export const DEFAULT_USER_FOLD_CHARS = 1000

/** Immutable reading of one transcript tree's presentation policy. */
export interface TranscriptPresentationSnapshot {
  readonly thinkingExpanded: boolean
  readonly toolsExpanded: boolean
  readonly windowTurns: number
  readonly recentStepsRetention: number
  readonly expandTurns: number
  readonly userFoldLines: number
  readonly userFoldChars: number
}

/** Default policy used when the host has no settings service. */
export const DEFAULT_TRANSCRIPT_PRESENTATION: TranscriptPresentationSnapshot = Object.freeze({
  thinkingExpanded: false,
  toolsExpanded: false,
  windowTurns: DEFAULT_WINDOW_TURNS,
  recentStepsRetention: DEFAULT_RECENT_STEPS_RETENTION,
  expandTurns: DEFAULT_EXPAND_TURNS,
  userFoldLines: DEFAULT_USER_FOLD_LINES,
  userFoldChars: DEFAULT_USER_FOLD_CHARS,
})

/** Mutable policy capsule owned by one `blue-transcript` parent Fiber. */
export class TranscriptPresentationPolicy {
  private value: TranscriptPresentationSnapshot = DEFAULT_TRANSCRIPT_PRESENTATION

  /** Return an immutable snapshot for one render or assertion. */
  snapshot(): TranscriptPresentationSnapshot { return this.value }

  /**
   * Apply recognized values from the resolved `blue` settings section.
   * Missing or malformed fields retain their current values.
   * @param input - unknown host settings section.
   * @returns whether any effective value changed.
   */
  apply(input: unknown): boolean {
    const section = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
    const before = this.value
    const positiveInteger = (candidate: unknown, fallback: number): number =>
      typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0 ? candidate : fallback
    const next: TranscriptPresentationSnapshot = Object.freeze({
      thinkingExpanded: typeof section.collapseThinking === 'boolean'
        ? !section.collapseThinking
        : before.thinkingExpanded,
      toolsExpanded: typeof section.collapseToolCalls === 'boolean'
        ? !section.collapseToolCalls
        : before.toolsExpanded,
      windowTurns: positiveInteger(section.windowTurns, before.windowTurns),
      recentStepsRetention: positiveInteger(section.recentStepsRetention, before.recentStepsRetention),
      expandTurns: positiveInteger(section.expandTurns, before.expandTurns),
      userFoldLines: positiveInteger(section.userFoldLines, before.userFoldLines),
      userFoldChars: positiveInteger(section.userFoldChars, before.userFoldChars),
    })
    const changed = Object.keys(next).some(key =>
      next[key as keyof TranscriptPresentationSnapshot] !== before[key as keyof TranscriptPresentationSnapshot])
    if (changed) this.value = next
    return changed
  }
}
