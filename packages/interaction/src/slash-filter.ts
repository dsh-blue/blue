/**
 * The S14 slash-command fuzzy filter: one pure helper shared by the editor's
 * autocomplete provider (`editor-plus.ts`) and the input hint line's
 * discovery list (`input-plugin.ts`), so the dropdown and the hint row
 * always agree on what "matches" means. The semantics are the kimi
 * `scoreTokens` port: the query splits on whitespace, every token must
 * subsequence-match the command name, and survivors rank by summed
 * pi-tui score (lower is better). The S-aliases extension adds the kimi
 * match rule for `aliases`: the canonical name scores first, aliases count
 * only when it misses, the best alias score wins, and a tie keeps the
 * canonical-name match ahead of the alias match.
 *
 * @module @dsh-blue/blue-interaction/slash-filter
 */

import type { BlueComponents } from '@dsh-blue/blue-core'

/** The command-registry shape the filter reads. */
export interface SlashCommandText {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Extra names the command answers to; each is matched like the name. */
  readonly aliases?: readonly string[]
}

/** One filtered command with the match provenance the display needs. */
export interface SlashCommandMatch<T extends SlashCommandText> {
  readonly command: T
  /** True when the query matched an alias, not the canonical name. */
  readonly viaAlias: boolean
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
 * Score one command against the query tokens: the canonical name scores
 * first (the kimi rule), and only when it misses are the aliases tried —
 * the best alias score wins — so an alias query surfaces the canonical
 * command it stands for.
 * @param tokens - the whitespace-split query tokens.
 * @param command - the command to match.
 * @param components - the fuzzy helper source.
 * @returns the best match score with its provenance, or `null` on a miss.
 */
function matchCommand(
  tokens: readonly string[],
  command: SlashCommandText,
  components: BlueComponents,
): { score: number, viaAlias: boolean } | null {
  const nameScore = scoreTokens(tokens, command.name, components)
  if (nameScore !== null) return { score: nameScore, viaAlias: false }
  let best: number | null = null
  for (const alias of command.aliases ?? []) {
    const score = scoreTokens(tokens, alias, components)
    if (score !== null && (best === null || score < best)) best = score
  }
  return best === null ? null : { score: best, viaAlias: true }
}

/**
 * Filter commands by a fuzzy query over their names (aliases included):
 * every whitespace token of the query must match one name, survivors sort by
 * summed score (better first) with a canonical-name match breaking a score
 * tie ahead of an alias match, and an empty query keeps every command in
 * registry order.
 * @param commands - the registered command descriptors.
 * @param query - the query text after the leading slash.
 * @param components - the fuzzy helper source.
 * @returns the matching commands, best first, each with its match provenance.
 */
export function filterSlashCommands<T extends SlashCommandText>(
  commands: readonly T[],
  query: string,
  components: BlueComponents,
): SlashCommandMatch<T>[] {
  const tokens = query.split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return commands.map(command => ({ command, viaAlias: false }))
  return commands
    .map(command => ({ command, match: matchCommand(tokens, command, components) }))
    .filter((entry): entry is { command: T, match: { score: number, viaAlias: boolean } } => entry.match !== null)
    .sort((a, b) => a.match.score - b.match.score || Number(a.match.viaAlias) - Number(b.match.viaAlias))
    .map(entry => ({ command: entry.command, viaAlias: entry.match.viaAlias }))
}

/**
 * The display label for one match (the kimi rule): a canonical-name match
 * shows the command alone; an alias match appends the alias list in
 * parentheses so the user sees why the command surfaced.
 * @param match - one filtered match.
 * @returns the label, leading slash included.
 */
export function slashCommandLabel<T extends SlashCommandText>(match: SlashCommandMatch<T>): string {
  const { command, viaAlias } = match
  // An alias hit implies a non-empty alias list — the filter only reports
  // viaAlias when an alias scored — so the nullish fallback never fires.
  /* v8 ignore next -- the fallback guards a shape the filter cannot produce */
  return viaAlias ? `/${command.name} (${(command.aliases ?? []).join(', ')})` : `/${command.name}`
}
