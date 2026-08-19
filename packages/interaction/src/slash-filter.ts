/**
 * The S14 slash-command fuzzy filter: one pure helper shared by the editor's
 * autocomplete provider (`editor-plus.ts`) and the input hint line's
 * discovery list (`input-plugin.ts`), so the dropdown and the hint row
 * always agree on what "matches" means. The semantics are the kimi
 * `scoreTokens` port: the query splits on whitespace, every token must
 * subsequence-match the command name, and survivors rank by summed
 * pi-tui score (lower is better).
 *
 * @module @deepseek-ai/dsh-blue-interaction/slash-filter
 */

import type { BlueComponents } from '@deepseek-ai/dsh-blue-core'

/** The command-registry shape the filter reads. */
export interface SlashCommandText {
  /** Lowercase command name without the leading slash. */
  readonly name: string
}

/**
 * All query tokens must fuzzy-match the command name; returns the summed
 * score, or `null` when any token misses. An empty token list matches
 * everything with score 0 — mirrors pi-tui `fuzzyFilter`'s token semantics.
 * @param tokens - the whitespace-split query tokens.
 * @param text - the text to match against.
 * @param components - the fuzzy helper source.
 * @returns the summed match score, or `null` on any miss.
 */
function scoreTokens(
  tokens: readonly string[],
  text: string,
  components: BlueComponents,
): number | null {
  let score = 0
  for (const token of tokens) {
    const match = components.fuzzyMatch(token, text)
    if (!match.matches) return null
    score += match.score
  }
  return score
}

/**
 * Filter commands by a fuzzy query over their names: every whitespace token
 * of the query must match, survivors sort by summed score (better first),
 * and an empty query keeps every command in registry order.
 * @param commands - the registered command descriptors.
 * @param query - the query text after the leading slash.
 * @param components - the fuzzy helper source.
 * @returns the matching commands, best first.
 */
export function filterSlashCommands<T extends SlashCommandText>(
  commands: readonly T[],
  query: string,
  components: BlueComponents,
): T[] {
  const tokens = query.split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return [...commands]
  return commands
    .map(command => ({ command, score: scoreTokens(tokens, command.name, components) }))
    .filter((entry): entry is { command: T, score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score)
    .map(entry => entry.command)
}
