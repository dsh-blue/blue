/**
 * Tests for the launcher's main flow (S37, failure form extended by D56):
 * the `-V` three-segment self-answer, the missing-host bootstrap line, the
 * boot surface's calibration (current / installed / dev lane / failed with
 * its classified manual pointer and output tail) ahead of the inherited
 * exec, the plugin surface's calibration skip, and exit code propagation.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { cliInternals, type SpawnOutcome } from '../src/internals.ts'
import { main, shellVersion } from '../src/main.ts'

registerTempDirCleanup()

/** The real seams, restored after every test. */
const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
  vi.unstubAllGlobals()
})

/** The shell's own manifest version — the pin every fixture calibrates to. */
const PIN = '0.1.1-rc.3'
const AHEAD = '0.1.1-rc.199'

/** One captured write or exit. */
const captures: { out: string[], err: string[], exits: number[] } = { out: [], err: [], exits: [] }

/** One recorded spawn call (either shape). */
interface Call {
  cmd: string
  args: readonly string[]
  env?: Record<string, string>
}

/** A successful spawn outcome. */
const OK: SpawnOutcome = { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
/**
 * Stand the launcher up over a materialized nested host and an empty `blue`
 * profile under a temp DSH_HOME,
 * with every effect seam
 * captured. Returns the spawn recorders.
 */
function fixtureLauncher(): { calls: { once: Call[], inherit: Call[] }, root: string, hostBin: string } {
  const home = mkdtempTracked('blue-cli-main-home-')
  const root = join(home, 'profiles', 'blue')
  const host = join(home, 'cache', 'blue-cli-runtime', `${PIN}-0.1.1-rc.2`, 'node_modules', '@deepseek-ai', 'dsh')
  const hostBin = join(host, 'lib', 'bin.js')
  mkdirSync(root, { recursive: true })
  mkdirSync(host, { recursive: true })
  writeFileSync(join(host, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2', bin: { dsh: 'lib/bin.js' } }))
  cliInternals.env = { DSH_HOME: home }
  captures.out = []
  captures.err = []
  captures.exits = []
  cliInternals.stdout = text => { captures.out.push(text) }
  cliInternals.stderr = text => { captures.err.push(text) }
  cliInternals.exit = code => { captures.exits.push(code) }
  cliInternals.spawnOnce = async () => OK
  const calls = { once: [] as Call[], inherit: [] as Call[] }
  return { calls, root, hostBin }
}

/** Install the bundle at the pin inside a fixture profile root. */
function installBundle(root: string, version: string): void {
  mkdirSync(join(root, 'node_modules', '@dsh-blue', 'blue'), { recursive: true })
  writeFileSync(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'), JSON.stringify({ name: '@dsh-blue/blue', version }))
}

describe('main', () => {
  it('answers -V with the shell, Blue pin, and harness line in one line', async () => {
    fixtureLauncher()
    await main(['-V'])
    expect(captures.out).toEqual([`blue ${PIN} (Blue @dsh-blue/blue@${PIN} · harness @deepseek-ai/dsh@0.1.1-rc.2)\n`])
    expect(captures.exits).toEqual([])
  })

  it('refuses to boot when the bundled runtime cannot be materialized', async () => {
    fixtureLauncher()
    cliInternals.readTextFile = path => path.includes('@deepseek-ai') ? undefined : REAL.readTextFile(path)
    cliInternals.extractRuntimeArchive = async () => { throw new Error('corrupt payload') }
    await main(['task'])
    expect(captures.err).toEqual(['blue: bundled dsh runtime is unavailable — corrupt payload; reinstall @dsh-blue/blue-cli\n'])
    expect(captures.exits).toEqual([1])
  })

  it('boots without a word when the profile already carries the pin, marking the child BLUE_LAUNCHER', async () => {
    const { calls, root, hostBin } = fixtureLauncher()
    installBundle(root, PIN)
    let inherit: SpawnOutcome = OK
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return inherit
    }
    await main(['fix', 'the', 'build'])
    expect(captures.err).toEqual([])
    expect(calls.inherit).toHaveLength(1)
    expect(calls.inherit[0]?.cmd).toBe(cliInternals.execPath)
    expect(calls.inherit[0]?.args).toEqual([hostBin, '--profile', 'blue', 'fix', 'the', 'build'])
    expect(calls.inherit[0]?.env).toMatchObject({ BLUE_LAUNCHER: 'blue' })
    expect(calls.inherit[0]?.env?.BLUE_DSH_BIN).toBe(hostBin)
    expect(captures.exits).toEqual([0])
    inherit = { code: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: false }
    captures.exits = []
    await main([])
    expect(captures.exits).toEqual([1])
  })

  it('boots an ahead profile as-is with the reinstall pointer, never downgrading', async () => {
    const { calls, root } = fixtureLauncher()
    installBundle(root, AHEAD)
    let once = false
    cliInternals.spawnOnce = async () => { once = true; return OK }
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main(['task'])
    expect(once).toBe(false)
    expect(captures.err).toEqual([
      `blue: profile 'blue' is at @dsh-blue/blue@${AHEAD}, ahead of this shell (${PIN}) — reinstall to advance: npm i -g @dsh-blue/blue-cli@rc\n`,
    ])
    expect(calls.inherit).toHaveLength(1)
    expect(captures.exits).toEqual([0])
  })

  it('announces a first install, then execs; and skips a dev link lane with a notice', async () => {
    const { calls, root } = fixtureLauncher()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { '@dsh-blue/blue': 'link:/checkout' } }))
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main([])
    expect(captures.err).toEqual(["blue: profile 'blue' is a dev link lane — calibration skipped\n"])
    expect(calls.inherit).toHaveLength(1)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: {} }))
    cliInternals.spawnOnce = async () => {
      installBundle(root, PIN)
      return OK
    }
    captures.err = []
    await main([])
    expect(captures.err).toEqual([`blue: installed @dsh-blue/blue@${PIN} into profile 'blue'\n`])
  })

  it('fails bootstrap with the classified manual pointer and output tail, never execing', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async () => ({ code: 1, signal: null, stdout: '', stderr: 'pnpm: ETARGET\n', timedOut: false })
    let inherited = false
    cliInternals.spawnInherit = async () => {
      inherited = true
      return OK
    }
    await main(['task'])
    expect(captures.err).toEqual([
      `blue: bootstrap failed — pnpm: ETARGET\n  manual: fix the cause and re-run blue (with a global dsh: dsh plugin --profile blue add @dsh-blue/blue@${PIN})\n`,
    ])
    expect(captures.exits).toEqual([1])
    expect(inherited).toBe(false)
  })

  it('routes a pnpm-missing bootstrap to the pnpm manual line', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async (cmd, args) => args[args.length - 1] === '--version'
      ? { code: null, signal: null, stdout: '', stderr: '', timedOut: false, spawnError: 'Error: spawn pnpm ENOENT' }
      : OK
    let inherited = false
    cliInternals.spawnInherit = async () => {
      inherited = true
      return OK
    }
    await main(['task'])
    expect(captures.err).toEqual([
      'blue: bootstrap failed — pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)\n  manual: npm i -g pnpm@11 (or: corepack enable pnpm@11), then re-run blue\n',
    ])
    expect(captures.exits).toEqual([1])
    expect(inherited).toBe(false)
  })

  it('routes an unsupported pnpm major to the pnpm 11 manual line', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async (cmd, args) => args[args.length - 1] === '--version'
      ? { code: 0, signal: null, stdout: '10.4.1\n', stderr: '', timedOut: false }
      : OK
    await main(['task'])
    expect(captures.err).toEqual([
      'blue: bootstrap failed — pnpm 11 is required — npm i -g pnpm@11 (or: corepack enable pnpm@11)\n  manual: npm i -g pnpm@11 (or: corepack enable pnpm@11), then re-run blue\n',
    ])
    expect(captures.exits).toEqual([1])
  })

  it('routes a timed-out bootstrap to the resume manual line', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async () => ({ code: null, signal: null, stdout: '', stderr: 'blue: install timed out', timedOut: true })
    await main(['task'])
    expect(captures.err).toEqual([
      'blue: bootstrap failed — install timed out after 20 minutes\n  blue: install timed out\n  manual: re-run blue — downloaded packages are cached and the install resumes\n',
    ])
    expect(captures.exits).toEqual([1])
  })

  it('prints the failure tail as indented lines between verdict and manual', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async (cmd, args) => args[args.length - 1] === '--version'
      ? OK
      : { code: 1, signal: null, stdout: '', stderr: 'first line\nsecond line\nETARGET no match\n', timedOut: false }
    await main(['task'])
    expect(captures.err).toEqual([
      'blue: bootstrap failed — ETARGET no match\n  first line\n  second line\n  manual: fix the cause and re-run blue (with a global dsh: dsh plugin --profile blue add @dsh-blue/blue@'
      + `${PIN})\n`,
    ])
    expect(captures.exits).toEqual([1])
  })

  it('forwards the plugin surface without calibrating', async () => {
    const { calls } = fixtureLauncher()
    let once = false
    cliInternals.spawnOnce = async () => { once = true; return OK }
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main(['plugin', 'add', '@dsh-blue/blue@rc'])
    expect(once).toBe(false)
    expect(calls.inherit[0]?.args?.slice(1)).toEqual(['plugin', '--profile', 'blue', 'add', '@dsh-blue/blue@rc'])
    expect(captures.exits).toEqual([0])
  })

  it('handles read-only plugin commands without probing or execing dsh', async () => {
    fixtureLauncher()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ plugins: [] }), { status: 200 })))
    await main(['plugin', 'list'])
    expect(captures.err).toEqual([])
    expect(captures.exits).toEqual([])
  })

  it('skips calibration on the version and plugin surfaces', async () => {
    const { calls } = fixtureLauncher()
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main(['-V'])
    await main(['plugin', 'add', '@dsh-blue/blue@rc'])
  })
})

describe('shellVersion', () => {
  it('reads the real manifest version', () => {
    expect(shellVersion()).toBe(PIN)
  })

  it('reads a broken manifest as unknown', () => {
    cliInternals.readTextFile = () => undefined
    expect(shellVersion()).toBe('unknown')
    cliInternals.readTextFile = () => '{ not json'
    expect(shellVersion()).toBe('unknown')
    cliInternals.readTextFile = () => JSON.stringify({ version: 3 })
    expect(shellVersion()).toBe('unknown')
  })
})
