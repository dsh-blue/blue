/**
 * The S29 skills catalog: a frontend-tree-scoped cache of the current
 * session's user-invocable skills, the pure `#`-token helpers, and the
 * service keeping the cache warm. The catalog feeds three consumers from one settle: the
 * `blue-editor-plus` `#` autocomplete branch (fuzzy over the same
 * `./slash-filter.ts` the slash dropdown uses), the `blue-input` submit
 * rewrite (`#name` → `/name`, mirroring the harness tool-skill gesture
 * boundary verbatim so every rewritten token is one the upstream pre-step
 * recognizes), and the `/skills` listing panel (`./skills-command.ts`).
 *
 * The seam is the app-owned skill snapshot and invalidation boundary; no
 * Harness Agent, scope key, or registry object reaches interaction. An
 * incomplete observation
 * (`complete: false` — a provider mid-revision) is never cached, and the
 * last good catalog survives until a complete one replaces it. Invalidation
 * rides the app's skill-change registration and session reader; both drop the cache and
 * preheat, and an epoch counter keeps a refresh that started under the old
 * session from repopulating the cache after the drop.
 *
 * @module @dsh-blue/blue-interaction/skills-catalog
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@dsh-blue/blue-app'

declare module '@deepseek-ai/cordis' {
  interface Context { blueSkillsCatalog: SkillsCatalogService }
}

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

/** Frontend-tree-scoped skill cache and invalidation owner. */
export class SkillsCatalogService extends Service {
  private settled: readonly SkillSummary[] | undefined
  private epoch = 0
  private flight: { readonly epoch: number, readonly promise: Promise<void> } | undefined
  private observedSessionId: string | undefined
  private readonly sessionRegistration: () => void
  private readonly skillRegistration: () => void
  private disposed = false

  /** @param ctx - interaction-root context carrying app session services. */
  constructor(ctx: Context) {
    super(ctx, 'blueSkillsCatalog')
    this.observedSessionId = ctx.blueCurrentAgent.current()?.id
    this.sessionRegistration = ctx.blueCurrentAgent.subscribe(agent => {
      const next = agent?.id
      if (next === this.observedSessionId) return
      this.observedSessionId = next
      this.drop()
      void this.refresh()
    })
    this.skillRegistration = ctx.on('skills/change', () => {
      this.drop()
      void this.refresh()
    })
    void this.refresh()
  }

  /** Settled user-invocable skills, synchronously readable by autocomplete. */
  userInvocable(): readonly SkillSummary[] {
    return this.settled?.filter(skill => skill.invocation.userInvocable) ?? []
  }

  /** Refresh once per epoch, preserving a last-good complete observation. */
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const currentId = this.ctx.blueCurrentAgent.current()?.id
    if (currentId !== this.observedSessionId) {
      this.observedSessionId = currentId
      this.drop()
    }
    if (this.flight?.epoch === this.epoch) return this.flight.promise
    const ticket = this.epoch
    const promise = this.settle(ticket)
    this.flight = { epoch: ticket, promise }
    void promise.finally(() => {
      if (this.flight?.promise === promise) this.flight = undefined
    })
    return promise
  }

  /** Release listeners and prevent late refreshes from publishing. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sessionRegistration()
    this.skillRegistration()
    this.drop()
  }

  /** Test-only direct settlement seam, scoped to this service instance. */
  setForTest(skills: readonly SkillSummary[] | undefined): void {
    this.epoch += 1
    this.settled = skills === undefined ? undefined : [...skills]
  }

  private drop(): void {
    this.epoch += 1
    this.settled = undefined
  }

  private async settle(ticket: number): Promise<void> {
    const agent = this.ctx.blueCurrentAgent.current()
    if (agent === null) {
      this.settled = undefined
      return
    }
    let result: Awaited<ReturnType<typeof this.ctx.skills.snapshot>>
    try {
      result = await this.ctx.skills.snapshot({ cwd: agent.session.header.cwd, scope: agent })
    } catch {
      return
    }
    if (this.disposed || ticket !== this.epoch) return
    if (this.ctx.blueCurrentAgent.current() !== agent) return
    if (result.complete) this.settled = result.skills
  }
}

/** Read the current tree's settled user-invocable skills. */
export function userInvocableSkills(ctx: Context): readonly SkillSummary[] {
  return ctx.blueSkillsCatalog.userInvocable()
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
export function rewriteSkillTokens(ctx: Context, text: string): string {
  const names = new Set(userInvocableSkills(ctx).map(skill => skill.name))
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

export function refresh(ctx: Context): Promise<void> {
  return ctx.blueSkillsCatalog.refresh()
}

/**
 * Replace the settled catalog directly (the tests' seam — the
 * `setFdProbe`/`setShellExecutor` idiom: unit suites without a live
 * `skills` service pin the settled list and assert the pure readers).
 * @param skills - the summaries to settle, or `undefined` to drop.
 */
export function __setCatalogForTest(ctx: Context, skills: readonly SkillSummary[] | undefined): void {
  ctx.blueSkillsCatalog.setForTest(skills)
}
