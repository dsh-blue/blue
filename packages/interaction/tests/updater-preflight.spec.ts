/**
 * Tests for the updater's pre-flight gates (D52): each verdict's pass
 * and block branches, the repair recipe, the composed run, and the
 * channel offer resolution.
 */

import { describe, expect, it } from 'vitest'
import type { Packument } from '../src/updater/registry.ts'
import { normalizePackument } from '../src/updater/registry.ts'
import type { ProfileFacts } from '../src/updater/profile.ts'
import {
  checkCooldown,
  checkDowngrade,
  checkHostLine,
  checkLinkPollution,
  checkSetConsistency,
  checkTargetExists,
  checkVersionFloor,
  DEFAULT_COOLDOWN_MINUTES,
  repairRecipe,
  resolveOffer,
  runPreflight,
} from '../src/updater/preflight.ts'

/** A packument fixture with two installable versions. */
const PACKUMENT: Packument = normalizePackument({
  'dist-tags': { rc: '0.1.0-rc.3', latest: '0.1.0-rc.2' },
  versions: {
    '0.1.0-rc.1': { dependencies: {} },
    '0.1.0-rc.2': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
    '0.1.0-rc.3': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
  },
  time: {
    '0.1.0-rc.2': '2026-08-20T00:00:00.000Z',
    '0.1.0-rc.3': '2026-08-22T00:00:00.000Z',
  },
})!

/** The rc.2 release set (five packages — blue-api joins with rc.3). */
const RC2_NAMES = [
  '@dsh-blue/blue',
  '@dsh-blue/blue-core',
  '@dsh-blue/blue-interaction',
  '@dsh-blue/blue-transcript',
  '@dsh-blue/blue-app',
]

/** A clean npm-only profile running rc.2. */
function healthyFacts(version = '0.1.0-rc.2'): ProfileFacts {
  const specs: Record<string, string> = {}
  const installed: Record<string, string> = {}
  for (const name of RC2_NAMES) {
    specs[name] = version
    installed[name] = version
  }
  return { manifest: { name: 'profile' }, specs, installed, linked: [] }
}

describe('updater/preflight checkLinkPollution', () => {
  it('passes a clean profile', () => {
    expect(checkLinkPollution(healthyFacts())).toEqual({ code: 'link-pollution', blocking: false })
  })

  it('blocks a link/file mix with the repair recipe', () => {
    const facts: ProfileFacts = { ...healthyFacts(), linked: ['@dsh-blue/blue'] }
    const verdict = checkLinkPollution(facts)
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('@dsh-blue/blue')
    expect(verdict.message).toContain(repairRecipe(['<the names above>'], '<version>'))
  })
})

describe('updater/preflight checkSetConsistency', () => {
  it('passes when all six packages sit at one version', () => {
    expect(checkSetConsistency(healthyFacts(), '0.1.0-rc.2', RC2_NAMES).blocking).toBe(false)
  })

  it('blocks a mixed set', () => {
    const facts: ProfileFacts = {
      ...healthyFacts(),
      installed: { ...healthyFacts().installed, '@dsh-blue/blue-core': '0.1.0-rc.1' },
    }
    const verdict = checkSetConsistency(facts, '0.1.0-rc.2', RC2_NAMES)
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('0.1.0-rc.2')
    expect(verdict.message).toContain('0.1.0-rc.1')
    expect(verdict.message).toContain('running 0.1.0-rc.2')
  })

  it('passes a set with a merely missing member (the install restores it)', () => {
    const facts: ProfileFacts = { ...healthyFacts(), installed: { ...healthyFacts().installed, '@dsh-blue/blue-app': undefined } }
    expect(checkSetConsistency(facts, '0.1.0-rc.2', RC2_NAMES).blocking).toBe(false)
  })

  it('blocks when nothing @dsh-blue is installed, with the target-set recipe', () => {
    const facts: ProfileFacts = { ...healthyFacts(), installed: {} }
    const verdict = checkSetConsistency(facts, '0.1.0-rc.2', RC2_NAMES)
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('no @dsh-blue packages are installed')
    expect(verdict.message).toContain(`@dsh-blue/blue-app@<version>`)
  })
})

describe('updater/preflight checkTargetExists', () => {
  it('passes a published target and blocks an unknown one', () => {
    expect(checkTargetExists(PACKUMENT, '0.1.0-rc.3').blocking).toBe(false)
    const verdict = checkTargetExists(PACKUMENT, '9.9.9')
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('9.9.9')
    expect(verdict.message).toContain('0.1.0-rc.2')
  })

  it('passes targets that exist as bare keys (the npm-view shape)', () => {
    // npm view lists versions as strings — the normalized map carries
    // the key with an undefined value, and a truthiness check would
    // block every real target (the rc.3 live finding).
    const listed = normalizePackument({
      'dist-tags': { rc: '0.1.0-rc.3' },
      versions: ['0.1.0-rc.2', '0.1.0-rc.3'],
      time: {},
    })!
    expect(checkTargetExists(listed, '0.1.0-rc.2').blocking).toBe(false)
    expect(checkTargetExists(listed, '9.9.9').blocking).toBe(true)
  })
})

describe('updater/preflight checkVersionFloor', () => {
  it('passes the floor and everything above, blocks below it', () => {
    expect(checkVersionFloor('0.1.0-rc.2').blocking).toBe(false)
    expect(checkVersionFloor('0.1.0-rc.3').blocking).toBe(false)
    const verdict = checkVersionFloor('0.1.0-rc.1')
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('D51')
  })
})

describe('updater/preflight checkHostLine', () => {
  it('passes when the host meets the tested line', () => {
    const verdict = checkHostLine({ hostVersion: 'dsh 0.1.1-rc.2 (node v24)', requiredLine: '0.1.1-rc.2' })
    expect(verdict.blocking).toBe(false)
    expect(verdict.message).toBeUndefined()
  })

  it('warns without blocking when either side is unreadable', () => {
    const noHost = checkHostLine({ hostVersion: undefined, requiredLine: '0.1.1-rc.2' })
    expect(noHost.blocking).toBe(false)
    expect(noHost.message).toContain('could not determine')
    const noLine = checkHostLine({ hostVersion: '0.1.1-rc.2', requiredLine: undefined })
    expect(noLine.blocking).toBe(false)
    expect(noLine.message).toContain('does not name a harness pin')
    const unreadable = checkHostLine({ hostVersion: 'bleeding-edge', requiredLine: '0.1.1-rc.2' })
    expect(unreadable.blocking).toBe(false)
    expect(unreadable.message).toContain('unreadable dsh version')
  })

  it('warns (not blocks) on a different major/minor host line', () => {
    const verdict = checkHostLine({ hostVersion: '0.2.0', requiredLine: '0.1.1-rc.2' })
    expect(verdict.blocking).toBe(false)
    expect(verdict.message).toContain('different major/minor')
  })

  it('blocks an older host with the exact upgrade command', () => {
    const verdict = checkHostLine({ hostVersion: '0.1.1-rc.1', requiredLine: '0.1.1-rc.2' })
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('npm i -g @deepseek-ai/dsh@0.1.1-rc.2')
  })
})

describe('updater/preflight checkCooldown', () => {
  /** A publish time and clock pair a given number of minutes apart. */
  function times(ageMinutes: number): { publishedAt: number; now: number } {
    const publishedAt = Date.parse('2026-08-22T00:00:00.000Z')
    return { publishedAt, now: publishedAt + ageMinutes * 60_000 }
  }

  it('passes once the window has elapsed, defaulting to 24h', () => {
    const { publishedAt, now } = times(DEFAULT_COOLDOWN_MINUTES + 1)
    const verdict = checkCooldown('0.1.0-rc.3', { publishedAt, cooldownMinutes: undefined, now })
    expect(verdict.blocking).toBe(false)
  })

  it('blocks inside the window with the ETA', () => {
    const { publishedAt, now } = times(300)
    const verdict = checkCooldown('0.1.0-rc.3', { publishedAt, cooldownMinutes: 1_440, now })
    expect(verdict.blocking).toBe(true)
    expect(verdict.message).toContain('300 min ago')
    expect(verdict.message).toContain('2026-08-23 00:00')
  })

  it('honors a tighter configured window and clamps skew to zero', () => {
    const { publishedAt, now } = times(10)
    const inside = checkCooldown('0.1.0-rc.3', { publishedAt, cooldownMinutes: 30, now })
    expect(inside.blocking).toBe(true)
    const outside = checkCooldown('0.1.0-rc.3', { publishedAt, cooldownMinutes: 5, now })
    expect(outside.blocking).toBe(false)
    const skewed = checkCooldown('0.1.0-rc.3', { publishedAt, now: publishedAt - 60_000, cooldownMinutes: 30 })
    expect(skewed.blocking).toBe(true)
    expect(skewed.message).toContain('0 min ago')
  })

  it('warns when the publish time is unknown', () => {
    const verdict = checkCooldown('0.1.0-rc.3', { publishedAt: undefined, cooldownMinutes: 30, now: 0 })
    expect(verdict.blocking).toBe(false)
    expect(verdict.message).toContain('publish time unknown')
  })
})

describe('updater/preflight runPreflight', () => {
  it('runs all gates in order', () => {
    const verdicts = runPreflight({
      facts: healthyFacts(),
      packageNames: RC2_NAMES,
      currentVersion: '0.1.0-rc.2',
      target: '0.1.0-rc.3',
      packument: PACKUMENT,
      host: { hostVersion: '0.1.1-rc.2', requiredLine: '0.1.1-rc.2' },
      cooldown: { publishedAt: 0, cooldownMinutes: 0, now: 1 },
    })
    expect(verdicts.map(verdict => verdict.code)).toEqual([
      'link-pollution',
      'set-consistency',
      'target-exists',
      'version-floor',
      'host-line',
      'cooldown',
      'downgrade',
    ])
    expect(verdicts.every(verdict => !verdict.blocking)).toBe(true)
  })

  it('carries the first blocking verdict for the caller', () => {
    const verdicts = runPreflight({
      facts: { ...healthyFacts(), linked: ['@dsh-blue/blue'] },
      packageNames: RC2_NAMES,
      currentVersion: '0.1.0-rc.2',
      target: '0.1.0-rc.3',
      packument: PACKUMENT,
      host: { hostVersion: '0.1.1-rc.2', requiredLine: '0.1.1-rc.2' },
      cooldown: { publishedAt: 0, cooldownMinutes: 0, now: 1 },
    })
    const blocking = verdicts.filter(verdict => verdict.blocking)
    expect(blocking).toHaveLength(1)
    expect(blocking[0]?.code).toBe('link-pollution')
  })
})

describe('updater/preflight checkDowngrade', () => {
  it('warns without blocking when the target is older than the installed version', () => {
    const verdict = checkDowngrade(healthyFacts('0.1.0-rc.2'), '0.1.0-rc.1')
    expect(verdict.blocking).toBe(false)
    expect(verdict.message).toContain('downgrade reinstalls the full @dsh-blue set')
    expect(verdict.message).toContain('0.1.0-rc.1')
  })

  it('passes silently for same-or-newer targets and absent installs', () => {
    expect(checkDowngrade(healthyFacts('0.1.0-rc.2'), '0.1.0-rc.3').message).toBeUndefined()
    expect(checkDowngrade(healthyFacts('0.1.0-rc.2'), '0.1.0-rc.2').message).toBeUndefined()
    const bare: ProfileFacts = { ...healthyFacts(), installed: {} }
    expect(checkDowngrade(bare, '0.1.0-rc.1').message).toBeUndefined()
  })
})

describe('updater/preflight resolveOffer', () => {
  it('offers a newer tag target above the floor', () => {
    expect(resolveOffer(PACKUMENT, 'rc', '0.1.0-rc.2')).toEqual({ kind: 'offer', target: '0.1.0-rc.3' })
  })

  it('reads up-to-date when the tag does not outrank the running version', () => {
    expect(resolveOffer(PACKUMENT, 'rc', '0.1.0-rc.3')).toEqual({ kind: 'up-to-date', target: '0.1.0-rc.3' })
    expect(resolveOffer(PACKUMENT, 'rc', '0.2.0')).toEqual({ kind: 'up-to-date', target: '0.1.0-rc.3' })
  })

  it('reports a missing channel and an unparsable target', () => {
    expect(resolveOffer(PACKUMENT, 'next', '0.1.0-rc.2')).toEqual({ kind: 'no-tag' })
    const broken = normalizePackument({
      'dist-tags': { rc: 'banana' },
      versions: { banana: {} },
      time: {},
    })!
    expect(resolveOffer(broken, 'rc', '0.1.0-rc.2')).toEqual({ kind: 'target-unparsable', target: 'banana' })
  })

  it('refuses to offer a target below the floor', () => {
    const oldTag = normalizePackument({
      'dist-tags': { rc: '0.1.0-rc.1' },
      versions: { '0.1.0-rc.1': {} },
      time: {},
    })!
    expect(resolveOffer(oldTag, 'rc', '0.1.0-rc.0')).toEqual({ kind: 'target-below-floor', target: '0.1.0-rc.1' })
  })
})
