/**
 * Tests for the boot-check plugin (D52): the offer path (notice rows,
 * state write), the 24h cache gate and re-notify after it, the settings
 * off switch, registry failure recording, the up-to-date and no-tag
 * channels, the unload guards, the state file's tolerant reader, and
 * the apply wiring with a live settings service.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import SettingsProvider, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()
import { BLUE_VERSION } from '../../api/src/index.ts'
import { fakeBlueContext } from './fakes.ts'
import { updaterInternals } from '../src/updater/io.ts'
import { apply as applySettings, DEFAULT_SETTINGS } from '../src/settings.ts'
import {
  apply,
  name,
  readUpdateCheckState,
  runUpdateCheck,
  updateCheckStatePath,
  writeUpdateCheckState,
  type UpdateCheckState,
} from '../src/updater/check.ts'

/** The real seams, restored after every test. */
const REAL = { ...updaterInternals }

afterEach(() => {
  Object.assign(updaterInternals, REAL)
})

/** A synthetic future release that remains ahead across preview bumps. */
const OFFER_VERSION = '0.2.0-alpha.2'

/** A packument whose `alpha` tag offers a release over the running version. */
const OFFER_JSON = JSON.stringify({
  'dist-tags': { alpha: OFFER_VERSION, latest: BLUE_VERSION },
  versions: {
    '0.1.0-rc.6': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
    [BLUE_VERSION]: { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
    [OFFER_VERSION]: { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
  },
  time: {
    '0.1.0-rc.6': '2026-08-20T00:00:00.000Z',
    [BLUE_VERSION]: '2026-08-22T00:00:00.000Z',
    [OFFER_VERSION]: '2026-08-23T00:00:00.000Z',
  },
})

/** A packument already at the running version. */
const CURRENT_JSON = JSON.stringify({
  'dist-tags': { alpha: BLUE_VERSION },
  versions: { [BLUE_VERSION]: {} },
  time: { [BLUE_VERSION]: '2026-08-22T00:00:00.000Z' },
})

/** One check world: temp DSH_HOME, fixed clock, scripted npm view. */
function makeCheck(options: { json?: string; fail?: boolean } = {}) {
  const home = mkdtempTracked('blue-updater-check-')
  const now = 1_800_000_000_000
  let spawns = 0
  updaterInternals.env = { DSH_HOME: home }
  updaterInternals.homedir = () => home
  updaterInternals.now = () => now
  updaterInternals.sleep = () => Promise.resolve()
  updaterInternals.spawnOnce = () => {
    spawns += 1
    if (options.fail === true) {
      return Promise.resolve({ code: 1, signal: null, stdout: '', stderr: 'ETIMEDOUT', timedOut: false })
    }
    return Promise.resolve({ code: 0, signal: null, stdout: options.json ?? OFFER_JSON, stderr: '', timedOut: false })
  }
  const { ctx, screen } = fakeBlueContext({ dock: false })
  /** The profile the boot check inspects (default: absent). */
  const profileRootDir = join(home, 'profiles', 'blue')
  /** Install a profile manifest with the given dependency specs. */
  const writeProfile = (dependencies: Record<string, string>): void => {
    mkdirSync(profileRootDir, { recursive: true })
    writeFileSync(join(profileRootDir, 'package.json'), JSON.stringify({ name: 'profile', dependencies }))
  }
  return { home, now, spawns: () => spawns, ctx, screen, statePath: updateCheckStatePath(), profileRootDir, writeProfile }
}

describe('updater/check runUpdateCheck', () => {
  it('offers a newer release: mounts the notice and records the state', async () => {
    const world = makeCheck()
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(1)
    const rows = world.screen.children[0]!.render(80)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain(`v${OFFER_VERSION}`)
    expect(rows[0]).toContain(`v${BLUE_VERSION}`)
    expect(rows[1]).toContain('run /update')
    expect(rows[1]).toContain(`dsh plugin --profile blue add @dsh-blue/blue@${OFFER_VERSION}`)
    expect(world.screen.renderRequests).toBeGreaterThan(0)
    // Stateless render; invalidate is a harmless no-op.
    expect(() => world.screen.children[0]!.invalidate()).not.toThrow()
    const state = readUpdateCheckState()
    expect(state).toEqual({
      lastCheckAt: world.now,
      lastNotifiedVersion: OFFER_VERSION,
      lastOffer: { version: OFFER_VERSION, publishedAt: Date.parse('2026-08-23T00:00:00.000Z') },
    })
  })

  it('re-mounts the notice from the cached offer inside the 24h window', async () => {
    const world = makeCheck()
    writeUpdateCheckState({
      lastCheckAt: world.now - 1_000,
      lastNotifiedVersion: OFFER_VERSION,
      lastOffer: { version: OFFER_VERSION, publishedAt: Date.parse('2026-08-23T00:00:00.000Z') },
    })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    // No network read, but the notice is back.
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(1)
    expect(world.screen.children[0]!.render(80)[0]).toContain(`v${OFFER_VERSION}`)
  })

  it('stays quiet inside the window when the cached offer does not outrank the running version', async () => {
    const world = makeCheck()
    writeUpdateCheckState({ lastCheckAt: world.now - 1_000, lastOffer: { version: '0.1.0-rc.5' } })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(0)
  })

  it('skips the registry entirely inside the 24h cache window', async () => {
    const world = makeCheck()
    writeUpdateCheckState({ lastCheckAt: world.now - 1_000 })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(0)
  })

  it('re-checks and re-notifies once the cache window has passed', async () => {
    const world = makeCheck()
    writeUpdateCheckState({ lastCheckAt: world.now - 25 * 60 * 60 * 1_000, lastNotifiedVersion: OFFER_VERSION })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.spawns()).toBe(1)
    expect(world.screen.children).toHaveLength(1)
  })

  it('does nothing when the setting is off (the offline switch)', async () => {
    const world = makeCheck()
    await runUpdateCheck(world.ctx, () => ({ updateCheck: false, updateChannel: 'rc' }), () => false)
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(0)
  })

  it('records the failure class and stays silent when the registry fails', async () => {
    const world = makeCheck({ fail: true })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.spawns()).toBe(3)
    expect(world.screen.children).toHaveLength(0)
    // A failed read does NOT stamp the window: the next boot retries.
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: 0, lastError: 'network' })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.spawns()).toBe(6)
  })

  it('keeps the previous window, notified marker, and offer through a failed re-check', async () => {
    const world = makeCheck({ fail: true })
    writeUpdateCheckState({
      lastCheckAt: world.now - 25 * 60 * 60 * 1_000,
      lastNotifiedVersion: '0.1.0-rc.7',
      lastOffer: { version: '0.1.0-rc.7' },
    })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(readUpdateCheckState()).toEqual({
      lastCheckAt: world.now - 25 * 60 * 60 * 1_000,
      lastNotifiedVersion: '0.1.0-rc.7',
      lastOffer: { version: '0.1.0-rc.7' },
      lastError: 'network',
    })
  })

  it('clears the state on an up-to-date read without mounting', async () => {
    const world = makeCheck({ json: CURRENT_JSON })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(0)
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: world.now })
  })

  it('follows the configured channel and stays silent on a missing tag', async () => {
    const world = makeCheck()
    await runUpdateCheck(world.ctx, () => ({ updateCheck: true, updateChannel: 'next' }), () => false)
    expect(world.screen.children).toHaveLength(0)
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: world.now })
  })

  it('returns before the registry read when already unloaded', async () => {
    const world = makeCheck()
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => true)
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(0)
  })

  it('aborts after the registry read when the fiber unloaded', async () => {
    const world = makeCheck()
    let calls = 0
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => {
      calls += 1
      return calls >= 2
    })
    expect(world.spawns()).toBe(1)
    expect(world.screen.children).toHaveLength(0)
    // The unload won the race: not even the state was written.
    expect(readUpdateCheckState()).toBeUndefined()
  })

  it('records the state but mounts nothing when the unload wins before the mount', async () => {
    const world = makeCheck()
    let calls = 0
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => {
      calls += 1
      return calls >= 3
    })
    expect(world.spawns()).toBe(1)
    expect(world.screen.children).toHaveLength(0)
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe(OFFER_VERSION)
  })

  it('skips the mount without throwing when no screen is mounted', async () => {
    makeCheck()
    const bare = new Context()
    await expect(runUpdateCheck(bare, () => DEFAULT_SETTINGS, () => false)).resolves.toBeUndefined()
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe(OFFER_VERSION)
  })

  it('never mounts the offer notice on a link-lane dev profile', async () => {
    const world = makeCheck()
    world.writeProfile({ '@dsh-blue/blue': 'link:../../blue/packages/bundle/blue' })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    // The registry read and the state write still happen; only the
    // notice — which would invite the link-breaking `dsh plugin add` —
    // stays away.
    expect(world.spawns()).toBe(1)
    expect(world.screen.children).toHaveLength(0)
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe(OFFER_VERSION)
  })

  it('mounts the interrupted-update warning when a swap marker survives', async () => {
    const world = makeCheck({ json: CURRENT_JSON })
    const backup = join(world.profileRootDir, '.blue-update-backup')
    mkdirSync(backup, { recursive: true })
    writeFileSync(join(backup, 'pending.json'), JSON.stringify({ from: '0.1.0-rc.6', to: '0.1.0-rc.8', startedAt: 1 }))
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(1)
    const rows = world.screen.children[0]!.render(120)
    expect(rows[0]).toContain('a previous /update to v0.1.0-rc.8 was interrupted')
    expect(rows[1]).toContain(backup)
    expect(rows[1]).toContain('run /update to retry')
  })

  it('warns on an unparseable marker, even with the check switched off, and never throws without a screen', async () => {
    const world = makeCheck({ json: CURRENT_JSON })
    const backup = join(world.profileRootDir, '.blue-update-backup')
    mkdirSync(backup, { recursive: true })
    writeFileSync(join(backup, 'pending.json'), '{nope')
    await runUpdateCheck(world.ctx, () => ({ updateCheck: false, updateChannel: 'rc' }), () => false)
    expect(world.screen.children).toHaveLength(1)
    expect(world.screen.children[0]!.render(120)[0]).toContain('a previous /update was interrupted')
    expect(world.spawns()).toBe(0)
    // No screen: the warning degrades to nothing, silently.
    const bare = new Context()
    await expect(runUpdateCheck(bare, () => ({ updateCheck: false, updateChannel: 'rc' }), () => false)).resolves.toBeUndefined()
  })

  it('warns on a marker that is not an object or carries no string target', async () => {
    const world = makeCheck({ json: CURRENT_JSON })
    const backup = join(world.profileRootDir, '.blue-update-backup')
    mkdirSync(backup, { recursive: true })
    // A bare JSON scalar parses but is no marker object.
    writeFileSync(join(backup, 'pending.json'), '42')
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(1)
    expect(world.screen.children[0]!.render(120)[0]).toContain('a previous /update was interrupted')
    // An object without a string `to` warns without naming the version.
    writeFileSync(join(backup, 'pending.json'), JSON.stringify({ from: '0.1.0-rc.6', to: 9 }))
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(2)
    const rows = world.screen.children[1]!.render(120)
    expect(rows[0]).toContain('a previous /update was interrupted')
    expect(rows[0]).not.toContain('to v')
  })

  it('records the offer without a publish stamp when the registry recorded none', async () => {
    const timeless = JSON.stringify({
      'dist-tags': { alpha: OFFER_VERSION },
      versions: { [OFFER_VERSION]: {} },
      time: {},
    })
    const world = makeCheck({ json: timeless })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(1)
    expect(readUpdateCheckState()).toEqual({
      lastCheckAt: world.now,
      lastNotifiedVersion: OFFER_VERSION,
      lastOffer: { version: OFFER_VERSION },
    })
  })
})

describe('updater/check state reader', () => {
  it('reads what the writer wrote and tolerates foreign shapes', () => {
    const world = makeCheck()
    expect(readUpdateCheckState()).toBeUndefined()
    const cases: string[] = ['{nope', '7', '"text"', '{"lastCheckAt":"yesterday"}', 'null']
    for (const text of cases) {
      updaterInternals.writeTextFile(world.statePath, text)
      expect(readUpdateCheckState(), text).toBeUndefined()
    }
    const full: UpdateCheckState = {
      lastCheckAt: 5,
      lastNotifiedVersion: '0.1.0-rc.8',
      lastError: 'network',
      lastOffer: { version: '0.1.0-rc.8', publishedAt: 42 },
    }
    writeUpdateCheckState(full)
    expect(readUpdateCheckState()).toEqual(full)
    // Non-string optional fields are dropped, not carried.
    updaterInternals.writeTextFile(world.statePath, JSON.stringify({ lastCheckAt: 5, lastNotifiedVersion: 9, lastError: [] }))
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: 5 })
    // Foreign offer shapes are dropped the same way.
    for (const lastOffer of ['rc.8', { version: 9 }, { version: '0.1.0-rc.8', publishedAt: 'soon' }]) {
      updaterInternals.writeTextFile(world.statePath, JSON.stringify({ lastCheckAt: 5, lastOffer }))
      expect(readUpdateCheckState(), JSON.stringify(lastOffer)).toEqual({ lastCheckAt: 5 })
    }
  })
})

describe('updater/check apply', () => {
  /**
   * A minimal in-memory settings provider, mounted as a class plugin with
   * the stored document as its config so init publishes it before the
   * `blue-settings` attach resolves.
   */
  class MemorySettings extends SettingsProvider {
    readonly writable = true
    private readonly doc: Record<string, unknown>

    constructor(ctx: Context, doc?: Record<string, unknown>) {
      super(ctx)
      this.doc = doc ?? {}
    }

    protected async load(): Promise<Record<string, unknown>> {
      return this.doc
    }

    protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
      this.doc[String(ns)] = section
    }
  }

  it('mounts the check with defaults when no settings service exists', async () => {
    const world = makeCheck()
    apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(world.screen.children).toHaveLength(1)
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe(OFFER_VERSION)
    expect(name).toBe('blue-update-check')
  })

  it('reads the off switch through the shared blue-settings thunk', async () => {
    const world = makeCheck()
    await world.ctx.plugin(MemorySettings, { blue: { updateCheck: false } })
    applySettings(world.ctx)
    apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(world.spawns()).toBe(0)
    expect(world.screen.children).toHaveLength(0)
  })

  it('runs the check when the shared thunk leaves the switch on', async () => {
    const world = makeCheck()
    await world.ctx.plugin(MemorySettings, { blue: { updateCheck: true } })
    applySettings(world.ctx)
    apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(world.screen.children).toHaveLength(1)
  })
})
