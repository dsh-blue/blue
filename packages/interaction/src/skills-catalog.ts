/**
 * The S29 skills catalog: the module-level cache of the current session's
 * user-invocable skills (the `draft-stash.ts` shape — module state surviving
 * fiber reloads), the pure `#`-token helpers, and the attach helper keeping
 * the cache warm. The catalog feeds three consumers from one settle: the
 * `blue-editor-plus` `#` autocomplete branch (fuzzy over the same
 * `./slash-filter.ts` the slash dropdown uses), the `blue-input` submit
 * rewrite (`#name` → `/name`, mirroring the harness tool-skill gesture
 * boundary verbatim so every rewritten token is one the upstream pre-step
 * recognizes), and the `/skills` listing panel (`./skills-command.ts`).
 *
 * The seam is the harness `skills` service (`@deepseek-ai/dsh-skill`, read
 * optionally through `ctx.get('skills')` — never injected, so a degraded
 * host without skill support keeps every Blue fiber loadable). Settling
 * goes through `snapshot` rather than `list`: an incomplete observation
 * (`complete: false` — a provider mid-revision) is never cached, and the
 * last good catalog survives until a complete one replaces it. Invalidation
 * rides the registry's `skills/change` event (no payload — consumers refetch
 * for their own options) and Blue's own `blue/session-changed` (a different
 * agent may resolve a different layered catalog); both drop the cache and
 * preheat, and an epoch counter keeps a refresh that started under the old
 * session from repopulating the cache after the drop.
 *
 * @module @dsh-blue/blue-interaction/skills-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { currentBlueAgent } from './session.ts'

/**
 * A `#name` skill token: the harness tool-skill gesture boundary with `#`
 * in place of its `/` — string start or whitespace before, whitespace or
 * string end after (the `(?=\\s|$)` lookahead), and the public kebab-case
 * skill-name grammar between. Mirroring the boundary verbatim guarantees
 * every token {@link rewriteSkillTokens} rewrites is one the upstream
 * pre-step regex recognizes, and no other (`#heading` in mid-sentence
 * prose, `#3` of a paste marker, a trailing `#name.` period — none match).
 */
const SKILL_TOKEN = /(^|\s)#([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/**
 * A `#`-token in progress at the cursor: string start or whitespace, the
 * `#`, then a partial query of name characters reaching the cursor. The
 * captured query may be empty (a bare `#` just typed); callers decide
 * whether an empty query opens the dropdown.
 */
const SKILL_PREFIX = /(^|\s)#([a-z0-9-]*)$/

/** One settled catalog: the owning agent, its cwd, and the complete snapshot. */
interface SkillsCache {
  /** The agent whose layered registry produced the settled list. */
  readonly key: Agent | undefined
  /** The session cwd the settle read (project-scoped roots key on it). */
  readonly cwd: string | undefined
  /** The complete snapshot's summaries, invocation-neutral as delivered. */
  readonly settled: readonly SkillSummary[]
}

/** The settled catalog; `undefined` until a complete snapshot lands. */
let cache: SkillsCache | undefined

/** Invalidation epoch: bumped on every drop, so a stale in-flight settle cannot write. */
let epoch = 0

/** The in-flight settle; same-epoch callers share it (single-flight per epoch). */
let flight: Promise<void> | undefined

/**
 * Read the settled user-invocable skills. Synchronous by design — the
 * `#` autocomplete branch answers within the editor's suggestion round;
 * warmth is `attachSkillsCatalog`'s job, not the reader's.
 * @returns the settled user-invocable summaries, or an empty list while
 *   nothing has settled (no session, no skills service, or mid-refresh).
 */
export function userInvocableSkills(): readonly SkillSummary[] {
  return cache?.settled.filter(skill => skill.invocation.userInvocable) ?? []
}

/**
 * Rewrite every `#name` token naming a settled user-invocable skill into the
 * harness gesture form `/name` (the submit-side half of the `#` pipeline:
 * the rewritten token rides the follow-up message, where the tool-skill
 * pre-step loads the skill body as an injected `skill-invocation` message —
 * resume/replay-safe because the injection is an ordinary session event).
 * Tokens naming anything else — unknown tags, `[image #3]` markers, pasted
 * prose — pass through untouched, and the rewritten text keeps the original
 * leading boundary (string start or whitespace) so the gesture regex still
 * sees the token it was handed.
 * @param text - the submitted line.
 * @returns the line with recognized skill tokens rewritten.
 */
export function rewriteSkillTokens(text: string): string {
  const names = new Set(userInvocableSkills().map(skill => skill.name))
  if (names.size === 0) return text
  return text.replace(SKILL_TOKEN, (token, lead: string, name: string) =>
    names.has(name) ? `${lead}/${name}` : token)
}

/**
 * Extract the `#`-skill query in progress before the cursor.
 * @param textBeforeCursor - the line's text up to (not including) the cursor.
 * @returns the query after the `#`, or `null` when the cursor does not sit
 *   in a skill token. A bare `#` yields the empty string; callers requiring
 *   at least one typed character treat that as no trigger (markdown `#`
 *   headings — `#` followed by a space — never match, and neither does a
 *   mid-word `#` like `C#`).
 */
export function extractSkillPrefix(textBeforeCursor: string): string | null {
  const match = SKILL_PREFIX.exec(textBeforeCursor)
  /* v8 ignore next -- a successful exec always defines the capture group */
  return match === null ? null : match[2] ?? ''
}

/**
 * Drop the settled catalog (and arm the epoch against a stale in-flight
 * settle). Called on `skills/change` and `blue/session-changed` ahead of
 * the preheat, so readers see an honest empty catalog instead of the
 * previous session's skills.
 */
function dropCatalog(): void {
  epoch += 1
  cache = undefined
}

/**
 * Settle the catalog from the live session: the current agent's layered
 * registry read through `snapshot`, cached only when the observation is
 * complete. Never rejects — a throwing or missing service keeps the last
 * good catalog (the same resilience posture as an incomplete snapshot).
 * Same-epoch callers share one in-flight settle (the registry dedupes
 * snapshots behind its own collect cache; the guard just avoids stampedes).
 * @param ctx - any context in the tree.
 * @returns a promise settling when the refresh attempt is done.
 */
export function refresh(ctx: Context): Promise<void> {
  if (flight !== undefined && settledEpoch === epoch) return flight
  const ticket = epoch
  const attempt = settle(ctx, ticket)
  flight = attempt
  settledEpoch = ticket
  void attempt.finally(() => {
    flight = undefined
  })
  return attempt
}

/** The epoch the in-flight settle started under. */
let settledEpoch = -1

/**
 * One settle attempt: resolve the agent and service, snapshot, and write the
 * cache only when the attempt is current and the observation complete.
 * @param ctx - any context in the tree.
 * @param ticket - the epoch this attempt started under.
 */
async function settle(ctx: Context, ticket: number): Promise<void> {
  const agent = currentBlueAgent(ctx)
  const skills = ctx.get('skills')
  if (agent === undefined || skills === undefined) {
    // No session (or a host without skill support): the honest catalog is
    // empty, not stale — drop whatever an earlier session settled.
    cache = undefined
    return
  }
  const cwd = agent.session.header.cwd
  try {
    const snapshot = await skills.snapshot({ cwd, scope: agent })
    if (ticket === epoch && snapshot.complete) {
      cache = { key: agent, cwd, settled: snapshot.skills }
    }
  } catch {
    // A disposed service or aborted discovery keeps the last good catalog.
  }
}

/**
 * Keep the catalog warm for one fiber's lifetime: preheat once, drop and
 * preheat on every `skills/change` (filesystem skill edits land there after
 * the watcher's stability threshold) and on `blue/session-changed` (a new
 * agent resolves its own layered catalog).
 * @param ctx - plugin context.
 * @returns the cleanup dropping the listeners and the cache; call inside a
 *   `ctx.effect` so unloading the fiber tears the attachment down.
 */
export function attachSkillsCatalog(ctx: Context): () => void {
  const offSkills = ctx.on('skills/change', () => {
    dropCatalog()
    void refresh(ctx)
  })
  const offSession = ctx.on('blue/session-changed', () => {
    dropCatalog()
    void refresh(ctx)
  })
  void refresh(ctx)
  return () => {
    offSkills()
    offSession()
    dropCatalog()
  }
}

/**
 * Replace the settled catalog directly (the tests' seam — the
 * `setFdProbe`/`setShellExecutor` idiom: unit suites without a live
 * `skills` service pin the settled list and assert the pure readers).
 * @param skills - the summaries to settle, or `undefined` to drop.
 */
export function __setCatalogForTest(skills: readonly SkillSummary[] | undefined): void {
  cache = skills === undefined ? undefined : { key: undefined, cwd: undefined, settled: [...skills] }
}
