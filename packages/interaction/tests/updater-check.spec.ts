/**
 * Tests for the boot-check plugin (D52): the offer path (notice rows,
 * state write), the 24h cache gate and re-notify after it, the settings
 * off switch, registry failure recording, the up-to-date and no-tag
 * channels, the unload guards, the state file's tolerant reader, and
 * the apply wiring with a live settings service.
 */

import { afterEach, describe, expect, it } from 'vitest'
import SettingsProvider, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempTracked } from '../../core/tests/temp-dir.ts'
import { fakeBlueContext } from './fakes.ts'
import { updaterInternals } from '../src/updater/io.ts'
import {
  apply,
  DEFAULT_SETTINGS,
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

/** A packument whose `rc` tag offers rc.3 over the running rc.2. */
const OFFER_JSON = JSON.stringify({
  'dist-tags': { rc: '0.1.0-rc.5', latest: '0.1.0-rc.4' },
  versions: {
    '0.1.0-rc.4': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
    '0.1.0-rc.5': { dependencies: { '@deepseek-ai/dsh-agent-presets': '0.1.1-rc.2' } },
  },
  time: {
    '0.1.0-rc.4': '2026-08-20T00:00:00.000Z',
    '0.1.0-rc.5': '2026-08-22T00:00:00.000Z',
  },
})

/** A packument already at the running version. */
const CURRENT_JSON = JSON.stringify({
  'dist-tags': { rc: '0.1.0-rc.4' },
  versions: { '0.1.0-rc.4': {} },
  time: { '0.1.0-rc.4': '2026-08-20T00:00:00.000Z' },
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
  const { ctx, screen } = fakeBlueContext()
  return { home, now, spawns: () => spawns, ctx, screen, statePath: updateCheckStatePath() }
}

describe('updater/check runUpdateCheck', () => {
  it('offers a newer release: mounts the notice and records the state', async () => {
    const world = makeCheck()
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(world.screen.children).toHaveLength(1)
    const rows = world.screen.children[0]!.render(80)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('v0.1.0-rc.5')
    expect(rows[0]).toContain('v0.1.0-rc.4')
    expect(rows[1]).toContain('run /update')
    expect(rows[1]).toContain('dsh plugin --profile blue add @dsh-blue/blue@0.1.0-rc.5')
    expect(world.screen.renderRequests).toBeGreaterThan(0)
    // Stateless render; invalidate is a harmless no-op.
    expect(() => world.screen.children[0]!.invalidate()).not.toThrow()
    const state = readUpdateCheckState()
    expect(state).toEqual({ lastCheckAt: world.now, lastNotifiedVersion: '0.1.0-rc.5' })
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
    writeUpdateCheckState({ lastCheckAt: world.now - 25 * 60 * 60 * 1_000, lastNotifiedVersion: '0.1.0-rc.5' })
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
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: world.now, lastError: 'network' })
  })

  it('keeps the previous notified marker through a failed re-check', async () => {
    const world = makeCheck({ fail: true })
    writeUpdateCheckState({ lastCheckAt: world.now - 25 * 60 * 60 * 1_000, lastNotifiedVersion: '0.1.0-rc.5' })
    await runUpdateCheck(world.ctx, () => DEFAULT_SETTINGS, () => false)
    expect(readUpdateCheckState()).toEqual({
      lastCheckAt: world.now,
      lastNotifiedVersion: '0.1.0-rc.5',
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
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe('0.1.0-rc.5')
  })

  it('skips the mount without throwing when no screen is mounted', async () => {
    makeCheck()
    const bare = new Context()
    await expect(runUpdateCheck(bare, () => DEFAULT_SETTINGS, () => false)).resolves.toBeUndefined()
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe('0.1.0-rc.5')
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
    const full: UpdateCheckState = { lastCheckAt: 5, lastNotifiedVersion: '0.1.0-rc.5', lastError: 'network' }
    writeUpdateCheckState(full)
    expect(readUpdateCheckState()).toEqual(full)
    // Non-string optional fields are dropped, not carried.
    updaterInternals.writeTextFile(world.statePath, JSON.stringify({ lastCheckAt: 5, lastNotifiedVersion: 9, lastError: [] }))
    expect(readUpdateCheckState()).toEqual({ lastCheckAt: 5 })
  })
})

describe('updater/check apply', () => {
  /** A minimal in-memory settings provider so the section wiring runs. */
  class MemorySettings extends SettingsProvider {
    readonly writable = true
    private doc: Record<string, unknown> = {}
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
    expect(readUpdateCheckState()?.lastNotifiedVersion).toBe('0.1.0-rc.5')
    expect(name).toBe('blue-update-check')
  })

  it('registers the blue namespace through a live settings service', async () => {
    const world = makeCheck()
    // The provider's constructor registers the `settings` service itself.
    const settings = new MemorySettings(world.ctx)
    apply(world.ctx)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(settings.describe().map(descriptor => String(descriptor.ns))).toContain('blue')
    expect(world.screen.children).toHaveLength(1)
  })
})
