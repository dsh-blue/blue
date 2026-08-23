/**
 * Tests for managed calibration (D50 decision 4): the matching-version
 * passthrough, the dev-lane skip, the single-transaction install with
 * its post-verify, and the one-line failure shapes.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { calibrate, compareVersions, dshHome } from '../src/calibrate.ts'
import { cliInternals, type SpawnOutcome } from '../src/internals.ts'

registerTempDirCleanup()

/** The real seams, restored after every test. */
const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
})

/** The pin every fixture calibrates to. */
const PIN = '0.1.0-rc.4'

/** One recorded spawn call. */
interface Call {
  cmd: string
  args: readonly string[]
  opts: { timeoutMs?: number } | undefined
}

/** A profile fixture factory: temp DSH_HOME with the given files. */
function fixtureHome(files: Record<string, string>): { home: string, root: string } {
  const home = mkdtempTracked('blue-cli-calibrate-')
  const root = join(home, 'profiles', 'blue')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  cliInternals.env = { DSH_HOME: home }
  return { home, root }
}

/** The profile manifest naming the bundle at one spec. */
function profileManifest(spec: string): string {
  return JSON.stringify({ name: 'blue-profile', dependencies: { '@dsh-blue/blue': spec } })
}

/** The installed-bundle manifest. */
function installedManifest(version: string): string {
  return JSON.stringify({ name: '@dsh-blue/blue', version })
}

/** A successful spawn outcome. */
const OK: SpawnOutcome = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }

describe('calibrate', () => {
  it('passes through with zero spawns when the installed bundle matches the pin', async () => {
    const calls: Call[] = []
    fixtureHome({
      'package.json': profileManifest(PIN),
      'node_modules/@dsh-blue/blue/package.json': installedManifest(PIN),
    })
    cliInternals.spawnOnce = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'current' })
    expect(calls).toEqual([])
  })

  it('skips a link/file dev lane without touching the profile', async () => {
    let spawned = false
    fixtureHome({ 'package.json': profileManifest('link:/checkout/packages/bundle/blue') })
    cliInternals.spawnOnce = async () => {
      spawned = true
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'link-lane',
      spec: 'link:/checkout/packages/bundle/blue',
    })
    expect(spawned).toBe(false)
  })

  it('installs the pin through the nested host and verifies the result', async () => {
    const { root } = fixtureHome({})
    const calls: Call[] = []
    cliInternals.spawnOnce = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    expect(calls).toEqual([{
      cmd: cliInternals.execPath,
      args: ['/nested/dsh/lib/bin.js', 'plugin', '--profile', 'blue', 'add', `@dsh-blue/blue@${PIN}`],
      opts: { timeoutMs: 300_000 },
    }])
  })

  it('never downgrades a profile that /update advanced past the shell', async () => {
    let spawned = false
    fixtureHome({ 'node_modules/@dsh-blue/blue/package.json': installedManifest('0.1.0-rc.5') })
    cliInternals.spawnOnce = async () => {
      spawned = true
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'ahead',
      installed: '0.1.0-rc.5',
    })
    expect(spawned).toBe(false)
  })

  it('retries once with -w when pnpm refuses a workspace-root write', async () => {
    const { root } = fixtureHome({})
    const calls: Call[] = []
    let attempt = 0
    cliInternals.spawnOnce = async (cmd, args, opts) => {
      attempt += 1
      calls.push({ cmd, args, opts })
      if (attempt === 1) {
        return { code: 1, signal: null, stdout: '', stderr: 'ERR_PNPM_ADDING_TO_ROOT', timedOut: false }
      }
      mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    expect(calls.map(call => call.args.join(' '))).toEqual([
      `/nested/dsh/lib/bin.js plugin --profile blue add @dsh-blue/blue@${PIN}`,
      `/nested/dsh/lib/bin.js plugin --profile blue add -w @dsh-blue/blue@${PIN}`,
    ])
  })

  it('translates a missing pnpm into the install suggestion', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = async () => ({
      code: 1, signal: null, stdout: '',
      stderr: 'dsh: pnpm not found on PATH — install pnpm to manage profile plugins\n',
      timedOut: false,
    })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm (or: corepack enable pnpm)',
    })
  })

  it('fails one-line on a rejected install, quoting the output tail', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = async () => ({ code: 1, signal: null, stdout: '', stderr: 'pnpm: install\nETARGET no match\n', timedOut: false })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'ETARGET no match',
    })
  })

  it('fails on a spawn error and on a post-install mismatch', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'ENOENT',
    })
    fixtureHome({})
    cliInternals.spawnOnce = async () => OK
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
    })
  })

  it('reads broken manifests as absent and installs through them', async () => {
    fixtureHome({ 'package.json': '{ broken', 'node_modules/@dsh-blue/blue/package.json': '{ also broken' })
    cliInternals.spawnOnce = async () => OK
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
    })
  })

  it('reads a non-string installed version as absent', async () => {
    fixtureHome({ 'package.json': JSON.stringify({ dependencies: {} }), 'node_modules/@dsh-blue/blue/package.json': JSON.stringify({ version: 3 }) })
    cliInternals.spawnOnce = async () => OK
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
    })
  })

  it('truncates a long output tail to one bounded line', async () => {
    fixtureHome({})
    const long = `x`.repeat(400)
    cliInternals.spawnOnce = async () => ({ code: 1, signal: null, stdout: '', stderr: `${long}\n`, timedOut: false })
    const outcome = await calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })
    expect(outcome).toEqual({ action: 'failed', reason: `${'x'.repeat(197)}...` })
  })

  it('falls back to a generic reason when the install died wordlessly', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = async () => ({ code: 1, signal: null, stdout: '', stderr: '', timedOut: false })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'install failed',
    })
  })
})

describe('dshHome', () => {
  it('reads DSH_HOME and falls back to ~/.dsh', () => {
    cliInternals.env = { DSH_HOME: '/custom/home' }
    expect(dshHome()).toBe('/custom/home')
    cliInternals.env = {}
    cliInternals.homedir = () => '/u'
    expect(dshHome()).toBe(join('/u', '.dsh'))
    cliInternals.env = { DSH_HOME: '' }
    expect(dshHome()).toBe(join('/u', '.dsh'))
  })
})

describe('compareVersions', () => {
  it('orders prerelease numerics, numeric boundaries, and releases', () => {
    expect(compareVersions('0.1.0-rc.4', '0.1.0-rc.5')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.9', '0.1.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.10', '0.1.0-rc.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.4', '0.1.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.4.1', '0.1.0-rc.4.2')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0-rc.4', '0.1.0-rc.4')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0-rc.1', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0', '0.1.0-rc.1')).toBeGreaterThan(0)
  })

  it('ranks numeric prerelease identifiers below alphanumeric ones', () => {
    expect(compareVersions('0.1.0-1', '0.1.0-alpha')).toBeLessThan(0)
    expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0-alpha', '0.1.0-beta')).toBeLessThan(0)
    expect(compareVersions('0.1.0-beta', '0.1.0-alpha')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0-rc.2', '0.1.0-rc.2.1')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.2.1', '0.1.0-rc.2')).toBeGreaterThan(0)
  })

  it('treats unparseable and mismatched shapes as unordered (0)', () => {
    expect(compareVersions('not-a-version', '0.1.0-rc.4')).toBe(0)
    expect(compareVersions('0.1.0-rc.4', 'latest')).toBe(0)
    expect(compareVersions('v0.1.0', '0.1.0')).toBe(0)
  })
})
