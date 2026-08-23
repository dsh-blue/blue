/**
 * Tests for the launcher's main flow (S37): the `-V` three-segment
 * self-answer, the missing-host bootstrap line, the boot surface's
 * calibration (current / installed / dev lane / failed) ahead of the
 * inherited exec, the plugin surface's calibration skip, and the exit
 * code propagation.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { cliInternals, type SpawnOutcome } from '../src/internals.ts'
import { main, shellVersion } from '../src/main.ts'

registerTempDirCleanup()

/** The real seams, restored after every test. */
const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
})

/** The shell's own manifest version — the pin every fixture calibrates to. */
const PIN = '0.1.0-rc.4'

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
 * Stand the launcher up over fixtures: a nested-host directory and an
 * empty `blue` profile under a temp DSH_HOME, with every effect seam
 * captured. Returns the spawn recorders.
 */
function fixtureLauncher(): { calls: { once: Call[], inherit: Call[] }, root: string } {
  const host = mkdtempTracked('blue-cli-main-host-')
  writeFileSync(join(host, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2', bin: { dsh: 'lib/bin.js' } }))
  cliInternals.resolveNestedDshManifest = () => join(host, 'package.json')
  const home = mkdtempTracked('blue-cli-main-home-')
  const root = join(home, 'profiles', 'blue')
  mkdirSync(root, { recursive: true })
  cliInternals.env = { DSH_HOME: home }
  captures.out = []
  captures.err = []
  captures.exits = []
  cliInternals.stdout = text => { captures.out.push(text) }
  cliInternals.stderr = text => { captures.err.push(text) }
  cliInternals.exit = code => { captures.exits.push(code) }
  const calls = { once: [] as Call[], inherit: [] as Call[] }
  return { calls, root }
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

  it('answers -V with "not installed" when the nested host is broken', async () => {
    fixtureLauncher()
    cliInternals.resolveNestedDshManifest = () => undefined
    await main(['--version'])
    expect(captures.out).toEqual([`blue ${PIN} (Blue @dsh-blue/blue@${PIN} · harness @deepseek-ai/dsh@not installed)\n`])
  })

  it('refuses to boot with one line when the pinned host carries no bin entry', async () => {
    const host = mkdtempTracked('blue-cli-main-host-')
    writeFileSync(join(host, 'package.json'), JSON.stringify({ version: '0.1.1-rc.2' }))
    fixtureLauncher()
    cliInternals.resolveNestedDshManifest = () => join(host, 'package.json')
    await main(['task'])
    expect(captures.err).toEqual(['blue: the pinned @deepseek-ai/dsh host is missing — reinstall @dsh-blue/blue-cli\n'])
    expect(captures.exits).toEqual([1])
  })

  it('boots without a word when the profile already carries the pin, marking the child BLUE_LAUNCHER', async () => {
    const { calls, root } = fixtureLauncher()
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
    expect(calls.inherit[0]?.args?.slice(1)).toEqual(['--profile', 'blue', 'fix', 'the', 'build'])
    expect(calls.inherit[0]?.args?.[0]).toMatch(/lib[/\\]bin\.js$/)
    expect(calls.inherit[0]?.env).toEqual({ BLUE_LAUNCHER: 'blue' })
    expect(captures.exits).toEqual([0])
    inherit = { code: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: false }
    captures.exits = []
    await main([])
    expect(captures.exits).toEqual([1])
  })

  it('boots an ahead profile as-is with the reinstall pointer, never downgrading', async () => {
    const { calls, root } = fixtureLauncher()
    installBundle(root, '0.1.0-rc.5')
    let once = false
    cliInternals.spawnOnce = async () => {
      once = true
      return OK
    }
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main(['task'])
    expect(once).toBe(false)
    expect(captures.err).toEqual([
      `blue: profile 'blue' is at @dsh-blue/blue@0.1.0-rc.5, ahead of this shell (${PIN}) — reinstall to advance: npm i -g @dsh-blue/blue-cli@rc\n`,
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

  it('fails bootstrap with the manual pointer and exits non-zero, never execing', async () => {
    fixtureLauncher()
    cliInternals.spawnOnce = async () => ({ code: 1, signal: null, stdout: '', stderr: 'pnpm: ETARGET\n', timedOut: false })
    let inherited = false
    cliInternals.spawnInherit = async () => {
      inherited = true
      return OK
    }
    await main(['task'])
    expect(captures.err).toEqual([
      `blue: bootstrap failed — pnpm: ETARGET\n  manual: dsh plugin --profile blue add @dsh-blue/blue@${PIN}\n`,
    ])
    expect(captures.exits).toEqual([1])
    expect(inherited).toBe(false)
  })

  it('forwards the plugin surface without calibrating', async () => {
    const { calls } = fixtureLauncher()
    let once = false
    cliInternals.spawnOnce = async () => {
      once = true
      return OK
    }
    cliInternals.spawnInherit = async (cmd, args, opts) => {
      calls.inherit.push({ cmd, args, env: opts?.env })
      return OK
    }
    await main(['plugin', 'add', '@dsh-blue/blue@rc'])
    expect(once).toBe(false)
    expect(calls.inherit[0]?.args?.slice(1)).toEqual(['plugin', '--profile', 'blue', 'add', '@dsh-blue/blue@rc'])
    expect(captures.exits).toEqual([0])
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
