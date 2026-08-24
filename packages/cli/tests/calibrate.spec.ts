/**
 * Tests for managed calibration (D50 decision 4, failure form extended by
 * D56): the matching-version passthrough, the dev-lane skip, the pnpm
 * pre-flight (posix ENOENT / win32 ComSpec 9009), the single-transaction
 * install with its post-verify, and the classified failure shapes with
 * their bounded detail tails.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { calibrate, compareVersions, dshHome, isPnpmMissing, pnpmMajor, pnpmProbeCommand } from '../src/calibrate.ts'
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

/** A probe outcome reporting a true posix ENOENT (pnpm unresolvable). */
const PROBE_ENOENT: SpawnOutcome = { code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'Error: spawn pnpm ENOENT' }

/**
 * Wrap an install stub with the pnpm pre-flight dispatch: the probe is the
 * call whose last argument is `--version` (both platforms), the install
 * calls end in the bundle spec.
 */
function withProbe(
  install: (cmd: string, args: readonly string[], opts: { timeoutMs?: number } | undefined) => Promise<SpawnOutcome>,
  probe: SpawnOutcome = OK,
): typeof cliInternals.spawnOnce {
  return (cmd, args, opts) => args[args.length - 1] === '--version' ? Promise.resolve(probe) : install(cmd, args, opts)
}

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
    cliInternals.spawnOnce = withProbe(async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
      return OK
    })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    expect(calls).toEqual([{
      cmd: cliInternals.execPath,
      args: ['/nested/dsh/lib/bin.js', 'plugin', '--profile', 'blue', 'add', `@dsh-blue/blue@${PIN}`],
      opts: { timeoutMs: 1_200_000 },
    }])
  })

  it('probes pnpm once before the install with the 30s probe budget', async () => {
    const { root } = fixtureHome({})
    const calls: Call[] = []
    cliInternals.spawnOnce = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      if (args[args.length - 1] === '--version') return OK
      mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    expect(calls[0]).toEqual({ cmd: 'pnpm', args: ['--version'], opts: { timeoutMs: 30_000 } })
    expect(calls).toHaveLength(2)
  })

  it('never downgrades a profile that /update advanced past the shell', async () => {
    let spawned = false
    fixtureHome({ 'node_modules/@dsh-blue/blue/package.json': installedManifest('0.1.0-rc.6') })
    cliInternals.spawnOnce = async () => {
      spawned = true
      return OK
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'ahead',
      installed: '0.1.0-rc.6',
    })
    expect(spawned).toBe(false)
  })

  it('retries once with -w when pnpm refuses a workspace-root write', async () => {
    const { root } = fixtureHome({})
    const calls: Call[] = []
    let attempt = 0
    cliInternals.spawnOnce = withProbe(async (cmd, args, opts) => {
      attempt += 1
      calls.push({ cmd, args, opts })
      if (attempt === 1) {
        return { code: 1, signal: null, stdout: '', stderr: 'ERR_PNPM_ADDING_TO_ROOT', timedOut: false }
      }
      mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
      writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
      return OK
    })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    expect(calls.map(call => call.args.join(' '))).toEqual([
      `/nested/dsh/lib/bin.js plugin --profile blue add @dsh-blue/blue@${PIN}`,
      `/nested/dsh/lib/bin.js plugin --profile blue add -w @dsh-blue/blue@${PIN}`,
    ])
  })

  it('translates a missing pnpm into the install suggestion, keeping the dsh line as detail', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => ({
      code: 1, signal: null, stdout: '',
      stderr: 'dsh: pnpm not found on PATH — install pnpm to manage profile plugins\n',
      timedOut: false,
    }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-missing',
      detail: ['dsh: pnpm not found on PATH — install pnpm to manage profile plugins'],
    })
  })

  it('rejects an installed pnpm major other than 11 before touching the profile', async () => {
    fixtureHome({})
    let installSpawned = false
    cliInternals.spawnOnce = withProbe(async () => {
      installSpawned = true
      return OK
    }, { ...OK, stdout: '10.4.1\n' })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm 11 is required — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-version',
    })
    expect(installSpawned).toBe(false)
  })

  it('blocks fast with the pnpm suggestion when the posix probe ENOENTs, never spawning dsh', async () => {
    fixtureHome({})
    let installSpawned = false
    cliInternals.spawnOnce = withProbe(async () => {
      installSpawned = true
      return OK
    }, PROBE_ENOENT)
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-missing',
    })
    expect(installSpawned).toBe(false)
  })

  it('probes through ComSpec on win32 and blocks on the cmd 9009 verdict', async () => {
    fixtureHome({})
    const { env } = cliInternals
    cliInternals.env = { ...env, ComSpec: 'C:\\Windows\\system32\\cmd.exe' }
    cliInternals.platform = 'win32'
    const probes: Call[] = []
    cliInternals.spawnOnce = async (cmd, args, opts) => {
      probes.push({ cmd, args, opts })
      return { code: 9009, signal: null, stdout: '', stderr: "'pnpm' is not recognized as an internal or external command\r\n", timedOut: false }
    }
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-missing',
    })
    expect(probes).toEqual([{ cmd: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/c', 'pnpm', '--version'], opts: { timeoutMs: 30_000 } }])
  })

  it('treats 127 from a win32 shell as missing too', async () => {
    fixtureHome({})
    cliInternals.platform = 'win32'
    cliInternals.spawnOnce = async () => ({ code: 127, signal: null, stdout: '', stderr: 'pnpm: not found\n', timedOut: false })
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-missing',
    })
  })

  it('proceeds when the win32 probe is inconclusive (spawn error, odd exit, timeout)', async () => {
    const inconclusive: SpawnOutcome[] = [
      { code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'Error: spawn cmd.exe ENOENT' },
      { code: 1, signal: null, stdout: '', stderr: '', timedOut: false },
      { code: null, signal: null, stdout: '', stderr: '', timedOut: true },
    ]
    for (const probe of inconclusive) {
      const { root } = fixtureHome({})
      const install = async (): Promise<SpawnOutcome> => {
        mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
        writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), installedManifest(PIN))
        return OK
      }
      cliInternals.platform = 'win32'
      cliInternals.spawnOnce = withProbe(install, probe)
      await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({ action: 'installed' })
    }
  })

  it('classifies the win32 shell-not-found exit 9009 after a failed install as pnpm-missing, keeping the dsh line as detail', async () => {
    fixtureHome({})
    cliInternals.platform = 'win32'
    cliInternals.spawnOnce = withProbe(async () => ({
      code: 9009, signal: null, stdout: '',
      stderr: 'dsh: pnpm failed in profile directory C:\\Users\\x\\.dsh\\profiles\\blue\n',
      timedOut: false,
    }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)',
      kind: 'pnpm-missing',
      detail: ['dsh: pnpm failed in profile directory C:\\Users\\x\\.dsh\\profiles\\blue'],
    })
  })

  it('reports a timed-out install with the timeout class and the marker tail', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => ({
      code: null, signal: null, stdout: '',
      stderr: 'pnpm: downloading…\nblue: install timed out',
      timedOut: true,
    }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'install timed out after 20 minutes',
      kind: 'timeout',
      detail: ['pnpm: downloading…', 'blue: install timed out'],
    })
  })

  it('fails one-line on a rejected install, quoting the output tail', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => ({ code: 1, signal: null, stdout: '', stderr: 'pnpm: install\nETARGET no match\n', timedOut: false }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'ETARGET no match',
      kind: 'install',
      detail: ['pnpm: install'],
    })
  })

  it('fails on a spawn error and on a post-install mismatch', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'ENOENT',
      kind: 'install',
    })
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => OK)
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
      kind: 'verify',
    })
  })

  it('reads broken manifests as absent and installs through them', async () => {
    fixtureHome({ 'package.json': '{ broken', 'node_modules/@dsh-blue/blue/package.json': '{ also broken' })
    cliInternals.spawnOnce = withProbe(async () => OK)
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
      kind: 'verify',
    })
  })

  it('reads a non-string installed version as absent', async () => {
    fixtureHome({ 'package.json': JSON.stringify({ dependencies: {} }), 'node_modules/@dsh-blue/blue/package.json': JSON.stringify({ version: 3 }) })
    cliInternals.spawnOnce = withProbe(async () => OK)
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'profile reports @dsh-blue/blue@uninstalled after install',
      kind: 'verify',
    })
  })

  it('bounds each detail line and drops the verdict duplicate', async () => {
    fixtureHome({})
    const long = `y`.repeat(400)
    cliInternals.spawnOnce = withProbe(async () => ({ code: 1, signal: null, stdout: '', stderr: `${long}\nETARGET no match\n`, timedOut: false }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'ETARGET no match',
      kind: 'install',
      detail: [`${'y'.repeat(197)}...`],
    })
  })

  it('truncates a long output tail to one bounded line', async () => {
    fixtureHome({})
    const long = `x`.repeat(400)
    cliInternals.spawnOnce = withProbe(async () => ({ code: 1, signal: null, stdout: '', stderr: `${long}\n`, timedOut: false }))
    const outcome = await calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })
    expect(outcome).toEqual({ action: 'failed', reason: `${'x'.repeat(197)}...`, kind: 'install' })
  })

  it('falls back to a generic reason when the install died wordlessly', async () => {
    fixtureHome({})
    cliInternals.spawnOnce = withProbe(async () => ({ code: 1, signal: null, stdout: '', stderr: '', timedOut: false }))
    await expect(calibrate({ version: PIN, dshBinJs: '/nested/dsh/lib/bin.js' })).resolves.toEqual({
      action: 'failed',
      reason: 'install failed',
      kind: 'install',
    })
  })
})

describe('pnpmProbeCommand', () => {
  it('spawns pnpm directly on posix and through ComSpec on win32', () => {
    expect(pnpmProbeCommand('linux', undefined)).toEqual({ cmd: 'pnpm', args: ['--version'] })
    expect(pnpmProbeCommand('darwin', '/bin/zsh')).toEqual({ cmd: 'pnpm', args: ['--version'] })
    expect(pnpmProbeCommand('win32', 'C:\\Windows\\system32\\cmd.exe')).toEqual({
      cmd: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/c', 'pnpm', '--version'],
    })
    expect(pnpmProbeCommand('win32', undefined)).toEqual({ cmd: 'cmd.exe', args: ['/d', '/c', 'pnpm', '--version'] })
  })
})

describe('isPnpmMissing', () => {
  it('takes only cmd not-found exits as missing on win32', () => {
    expect(isPnpmMissing({ ...OK, code: 9009 }, 'win32')).toBe(true)
    expect(isPnpmMissing({ ...OK, code: 127 }, 'win32')).toBe(true)
    expect(isPnpmMissing(OK, 'win32')).toBe(false)
    expect(isPnpmMissing({ ...OK, code: 1 }, 'win32')).toBe(false)
    expect(isPnpmMissing({ ...OK, code: null, spawnError: 'Error: spawn cmd.exe ENOENT' }, 'win32')).toBe(false)
    expect(isPnpmMissing({ ...OK, code: null, timedOut: true }, 'win32')).toBe(false)
  })

  it('takes only a true ENOENT as missing on posix', () => {
    expect(isPnpmMissing({ ...OK, code: null, spawnError: 'Error: spawn pnpm ENOENT' }, 'linux')).toBe(true)
    expect(isPnpmMissing({ ...OK, code: null, spawnError: 'Error: spawn pnpm EACCES' }, 'linux')).toBe(false)
    expect(isPnpmMissing(OK, 'linux')).toBe(false)
    expect(isPnpmMissing({ ...OK, code: 1 }, 'linux')).toBe(false)
  })
})

describe('pnpmMajor', () => {
  it('reads a version from stdout and ignores unparseable output', () => {
    expect(pnpmMajor({ ...OK, stdout: '11.7.0\n' })).toBe(11)
    expect(pnpmMajor({ ...OK, stderr: '10.4.1\n' })).toBe(10)
    expect(pnpmMajor(OK)).toBeUndefined()
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
    expect(compareVersions('0.1.0-rc.4', '0.1.0-rc.6')).toBeLessThan(0)
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
