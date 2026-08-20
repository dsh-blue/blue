/**
 * The Blue-side command alias registry — the kimi `aliases` metadata port.
 * dsh-commands `CommandDefinition` carries no alias field (rc.7), so the
 * alias relation lives here while the dispatch path stays in the harness:
 * aliases are NOT registered as real commands. The input layer rewrites an
 * alias line to its canonical name before `ctx.commands.execute` (kimi's
 * `findBuiltInSlashCommand` equivalent: name or aliases match, the canonical
 * name owns the dispatch), so the session log records the canonical command
 * and every discovery surface — the dropdown, the hint line, `/help` — reads
 * only canonical registrations with zero deduplication. The registry is
 * effect-bound through its disposer, matching the plugin convention that
 * unloading a fiber reverts every contribution; re-registering a canonical
 * replaces the previous relation (last-wins), while an alias claimed by a
 * different canonical is a startup conflict and fails loud.
 *
 * @module @dsh-blue/blue-interaction/command-meta
 */

/** One recorded alias relation; the object itself is the generation token. */
interface AliasEntry {
  readonly canonical: string
  readonly aliases: readonly string[]
}

/** Alias name → the entry that owns it. */
const byAlias = new Map<string, AliasEntry>()
/** Canonical name → its entry. */
const byCanonical = new Map<string, AliasEntry>()

/**
 * Record the aliases of one canonical command. Re-registering the same
 * canonical replaces its previous aliases (the entries of a replaced
 * registration keep pointing at the old entry, so an old disposer cannot
 * clear the new relation); an alias already claimed by a different canonical
 * throws — a startup conflict, surfaced loud like the keymap's.
 * @param canonical - the canonical command name, without a slash.
 * @param aliases - the extra names the command answers to, without slashes.
 * @returns the disposer removing only this registration's entries.
 */
export function registerCommandAliases(canonical: string, aliases: readonly string[]): () => void {
  if (aliases.includes(canonical)) {
    throw new Error(`command alias: /${canonical} cannot be its own alias`)
  }
  const previous = byCanonical.get(canonical)
  for (const alias of aliases) {
    const claimed = byAlias.get(alias)
    if (claimed !== undefined && claimed !== previous) {
      throw new Error(`command alias: /${alias} is already an alias of /${claimed.canonical}`)
    }
  }
  if (previous !== undefined) {
    for (const alias of previous.aliases) {
      // The conflict check above already rejected an alias held by another
      // canonical, so a replaced entry's aliases can only point back at it.
      /* v8 ignore next -- the stale-pointer branch is unreachable */
      if (byAlias.get(alias) === previous) byAlias.delete(alias)
    }
  }
  const entry: AliasEntry = { canonical, aliases: [...aliases] }
  for (const alias of aliases) byAlias.set(alias, entry)
  byCanonical.set(canonical, entry)
  return () => {
    if (byCanonical.get(canonical) === entry) byCanonical.delete(canonical)
    for (const alias of aliases) {
      if (byAlias.get(alias) === entry) byAlias.delete(alias)
    }
  }
}

/**
 * Resolve one typed name to its canonical command name.
 * @param name - a command name, canonical or alias, without a slash.
 * @returns the canonical name when `name` is a registered alias, else
 *   `undefined` — a canonical name itself is not its own alias.
 */
export function canonicalOf(name: string): string | undefined {
  return byAlias.get(name)?.canonical
}

/**
 * The aliases of one command, queried by canonical or alias name alike.
 * @param name - a command name, canonical or alias, without a slash.
 * @returns the command's aliases; empty for an unknown or alias-less command.
 */
export function aliasesOf(name: string): readonly string[] {
  return byCanonical.get(byAlias.get(name)?.canonical ?? name)?.aliases ?? []
}

/**
 * Attach each command's aliases for the shared fuzzy filter, so a query
 * matching an alias still surfaces the canonical command (the S-aliases
 * match semantics: the canonical name scores first, aliases count only when
 * it misses — see `./slash-filter.ts`).
 * @param commands - the registered command descriptors.
 * @returns the same descriptors with their alias lists attached.
 */
export function withCommandAliases<T extends { readonly name: string }>(
  commands: readonly T[],
): Array<T & { readonly aliases: readonly string[] }> {
  return commands.map(command => ({ ...command, aliases: aliasesOf(command.name) }))
}
