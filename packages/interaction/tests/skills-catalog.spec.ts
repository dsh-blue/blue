/**
 * Tests for the S29 skills catalog: the settled cache's lifecycle (refresh
 * through a fake `skills` service, the complete/incomplete snapshot rule,
 * invalidation on `skills/change` and `blue/session-changed`), the
 * user-invocable filter, and the pure `#`-token helpers — the rewrite's
 * gesture-boundary mirror and the prefix extraction's trigger rules.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  __setCatalogForTest,
  attachSkillsCatalog,
  extractSkillPrefix,
  refresh,
  rewriteSkillTokens,
  userInvocableSkills,
} from '../src/skills-catalog.ts'
import { fakeBlueContext } from './fakes.ts'

/** One summary double; only the fields the catalog reads matter. */
function skill(name: string, options: { userInvocable?: boolean } = {}): SkillSummary {
  return {
    name,
    description: `The ${name} skill`,
    invocation: {
      modelInvocable: true,
      userInvocable: options.userInvocable ?? true,
    },
    source: 'custom',
    provider: 'spec',
  }
}

/** A controllable `skills` service double recording its snapshot reads. */
function fakeSkills(options: {
  result?: () => Promise<{ skills: SkillSummary[], complete: boolean }>
} = {}) {
  const snapshots = vi.fn(options.result ?? (() => Promise.resolve({ skills: [], complete: true })))
  return { snapshots, service: { snapshot: snapshots } }
}

/**
 * A hanging `skills` double: every snapshot waits on its own resolver (FIFO
 * order), so a test can settle settles in a chosen order.
 */
function hangingSkills(names: readonly string[]) {
  const resolvers: Array<() => void> = []
  let call = 0
  const fake = fakeSkills({
    result: () => new Promise(resolve => {
      const index = call
      call += 1
      const name = names[index] ?? names.at(-1) ?? 'skill'
      resolvers.push(() => resolve({ skills: [skill(name)], complete: true }))
    }),
  })
  return {
    ...fake,
    release(count = resolvers.length): void {
      for (const resolve of resolvers.splice(0, count)) resolve()
    },
  }
}

/**
 * Mount the catalog against a real session store, a fake agent, and an
 * optional fake `skills` service.
 */
async function mount(options: {
  withAgent?: boolean
  skills?: ReturnType<typeof fakeSkills>['service']
} = {}): Promise<{ ctx: Context, fiber: { dispose(): Promise<void> } }> {
  const { ctx } = fakeBlueContext()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('skills-catalog-spec'))
  const agent = { id: session.id, session, status: 'idle' } as never
  ctx.provide('blueSession', { current: options.withAgent === false ? null : agent, modelRef: undefined })
  if (options.skills !== undefined) ctx.provide('skills', options.skills)
  const fiber = await ctx.plugin({
    name: 'skills-catalog-spec',
    apply(subCtx: Context) {
      cleanup = attachSkillsCatalog(subCtx)
    },
  })
  return { ctx, fiber }
}

/** The attach cleanup of the most recent mount. */
let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  cleanup = undefined
  __setCatalogForTest(undefined)
})

describe('skills catalog settle', () => {
  it('refresh caches a complete snapshot as the settled catalog', async () => {
    const fake = fakeSkills({ result: () => Promise.resolve({ skills: [skill('deploy-check')], complete: true }) })
    const { ctx } = await mount({ skills: fake.service })
    await refresh(ctx)
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['deploy-check'])
    // The read went through snapshot with the agent's own scope and cwd.
    expect(fake.snapshots).toHaveBeenCalled()
    const call = fake.snapshots.mock.calls[0]?.[0] as { scope: unknown, cwd: unknown }
    expect(call.scope).toBe((ctx.get('blueSession') as { current: unknown }).current)
    expect(call.cwd).toBe((call.scope as { session: { header: { cwd?: string } } }).session.header.cwd)
  })

  it('an incomplete snapshot is not cached and keeps the last good settle', async () => {
    __setCatalogForTest([skill('good-skill')])
    let complete = false
    const fake = fakeSkills({ result: () => Promise.resolve({ skills: [skill('fresh-skill')], complete }) })
    const { ctx } = await mount({ skills: fake.service })
    await refresh(ctx)
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['good-skill'])
    // The next complete observation replaces the survivor.
    complete = true
    await refresh(ctx)
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['fresh-skill'])
  })

  it('a rejecting snapshot keeps the last good settle', async () => {
    __setCatalogForTest([skill('good-skill')])
    const fake = fakeSkills({ result: () => Promise.reject(new Error('service disposed')) })
    const { ctx } = await mount({ skills: fake.service })
    await expect(refresh(ctx)).resolves.toBeUndefined()
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['good-skill'])
  })

  it('drops the catalog without an agent or without the skills service', async () => {
    __setCatalogForTest([skill('stale-skill')])
    const withService = await mount({ withAgent: false, skills: fakeSkills().service })
    await refresh(withService.ctx)
    expect(userInvocableSkills()).toEqual([])
    __setCatalogForTest([skill('stale-skill')])
    const withoutService = await mount({})
    await refresh(withoutService.ctx)
    expect(userInvocableSkills()).toEqual([])
  })

  it('shares one in-flight settle between same-epoch callers', async () => {
    const fake = hangingSkills(['shared'])
    const { ctx } = await mount({ skills: fake.service })
    // The attach preheat opened the flight; the two explicit refreshes
    // share it instead of starting their own snapshots.
    const first = refresh(ctx)
    const second = refresh(ctx)
    expect(fake.snapshots).toHaveBeenCalledOnce()
    fake.release()
    await Promise.all([first, second])
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['shared'])
  })

  it('a settle started before a drop never repopulates the cache', async () => {
    const fake = hangingSkills(['old-session', 'new-session'])
    const { ctx } = await mount({ skills: fake.service })
    // Shares the preheat's flight — the settle under the old session.
    const stale = refresh(ctx)
    // The session switches while that settle hangs: the drop arms the
    // epoch and a fresh settle opens under the new one.
    ctx.emit('blue/session-changed', null)
    fake.release()
    await stale
    await vi.waitFor(() => { expect(userInvocableSkills().map(entry => entry.name)).toEqual(['new-session']) })
  })
})

describe('skills catalog invalidation', () => {
  it('skills/change drops the cache and preheats', async () => {
    const fake = fakeSkills({ result: () => Promise.resolve({ skills: [skill('fresh')], complete: true }) })
    const { ctx } = await mount({ skills: fake.service })
    __setCatalogForTest([skill('previous')])
    ctx.emit('skills/change')
    await vi.waitFor(() => { expect(userInvocableSkills().map(entry => entry.name)).toEqual(['fresh']) })
  })

  it('blue/session-changed drops the cache and preheats', async () => {
    const fake = fakeSkills({ result: () => Promise.resolve({ skills: [skill('next-session')], complete: true }) })
    const { ctx } = await mount({ skills: fake.service })
    __setCatalogForTest([skill('previous')])
    ctx.emit('blue/session-changed', null)
    await vi.waitFor(() => { expect(userInvocableSkills().map(entry => entry.name)).toEqual(['next-session']) })
  })
})

describe('user-invocable filter', () => {
  it('reads only user-invocable skills from the settle', () => {
    __setCatalogForTest([skill('user-facing'), skill('model-only', { userInvocable: false })])
    expect(userInvocableSkills().map(entry => entry.name)).toEqual(['user-facing'])
  })
})

describe('rewriteSkillTokens', () => {
  it('rewrites a recognized token at string start, after whitespace, and at string end', () => {
    __setCatalogForTest([skill('deploy-check')])
    expect(rewriteSkillTokens('#deploy-check')).toBe('/deploy-check')
    expect(rewriteSkillTokens('please #deploy-check now')).toBe('please /deploy-check now')
    expect(rewriteSkillTokens('run #deploy-check')).toBe('run /deploy-check')
    expect(rewriteSkillTokens('a #deploy-check b #deploy-check c')).toBe('a /deploy-check b /deploy-check c')
  })

  it('leaves unknown tags, paste markers, and non-boundary hashes untouched', () => {
    __setCatalogForTest([skill('deploy-check')])
    expect(rewriteSkillTokens('#unknown-tag')).toBe('#unknown-tag')
    // The image marker's `#3` matches the token shape but no catalog name.
    expect(rewriteSkillTokens('see [image #1] and #deploy-check')).toBe('see [image #1] and /deploy-check')
    // A mid-word hash is not a boundary (`C#` never triggers).
    expect(rewriteSkillTokens('C# and F#')).toBe('C# and F#')
    // Uppercase falls outside the skill-name grammar.
    expect(rewriteSkillTokens('#Deploy-check')).toBe('#Deploy-check')
    // A trailing period breaks the end boundary the gesture requires.
    expect(rewriteSkillTokens('run #deploy-check.')).toBe('run #deploy-check.')
    // The markdown heading shape — `#` followed by a space — never matches.
    expect(rewriteSkillTokens('# heading')).toBe('# heading')
    expect(rewriteSkillTokens('## ##')).toBe('## ##')
  })

  it('rewrites tokens on interior lines of a multi-line submission', () => {
    __setCatalogForTest([skill('deploy-check')])
    expect(rewriteSkillTokens('first\n#deploy-check\nlast')).toBe('first\n/deploy-check\nlast')
  })

  it('passes the text through unchanged with nothing settled', () => {
    expect(rewriteSkillTokens('#deploy-check')).toBe('#deploy-check')
  })
})

describe('extractSkillPrefix', () => {
  it('extracts the query after the hash at a boundary', () => {
    expect(extractSkillPrefix('#de')).toBe('de')
    expect(extractSkillPrefix('run #deploy-ch')).toBe('deploy-ch')
    expect(extractSkillPrefix('a #')).toBe('')
    expect(extractSkillPrefix('#')).toBe('')
  })

  it('returns null outside a skill token', () => {
    // A bare `#` in mid-word (`C#`), uppercase or otherwise non-name tails,
    // a closed token, and plain text all decline.
    expect(extractSkillPrefix('C#')).toBeNull()
    expect(extractSkillPrefix('C#d')).toBeNull()
    expect(extractSkillPrefix('#De')).toBeNull()
    expect(extractSkillPrefix('##')).toBeNull()
    expect(extractSkillPrefix('#deploy-check ')).toBeNull()
    expect(extractSkillPrefix('plain text')).toBeNull()
    expect(extractSkillPrefix('')).toBeNull()
  })
})
