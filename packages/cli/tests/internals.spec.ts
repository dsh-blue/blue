/**
 * Tests for the io seam's default bindings: the one-shot spawn (capture,
 * the SIGTERM→SIGKILL ladder, spawn errors), the inherit spawn, the fs
 * defaults, and the manifest resolution helper.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { cliInternals, resolvePackageManifest } from '../src/internals.ts'

registerTempDirCleanup()

/** Child scripts run with the test runner's own Node. */
const NODE = process.execPath

describe('cli/internals defaultSpawnOnce', () => {
  it('captures stdout, stderr, and the exit code', async () => {
    const outcome = await cliInternals.spawnOnce(NODE, ['-e', 'process.stdout.write("out"); process.stderr.write("err")'])
    expect(outcome.code).toBe(0)
    expect(outcome.signal).toBeNull()
    expect(outcome.stdout).toBe('out')
    expect(outcome.stderr).toBe('err')
    expect(outcome.timedOut).toBe(false)
    expect(outcome.spawnError).toBeUndefined()
  })

  it('captures a nonzero exit code and a signal death', async () => {
    const outcome = await cliInternals.spawnOnce(NODE, ['-e', 'process.exit(3)'])
    expect(outcome.code).toBe(3)
    const killed = await cliInternals.spawnOnce(NODE, ['-e', 'process.kill(process.pid, "SIGKILL")'])
    expect(killed.code).toBeNull()
    expect(killed.signal).toBe('SIGKILL')
  })

  it('kills a runaway child with SIGTERM at the deadline and marks the tail', async () => {
    const outcome = await cliInternals.spawnOnce(NODE, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 150 })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.signal).toBe('SIGTERM')
    expect(outcome.stderr).toContain('blue: install timed out')
  })

  it('escalates to SIGKILL when the child traps SIGTERM', async () => {
    const script = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
    const outcome = await cliInternals.spawnOnce(NODE, ['-e', script], { timeoutMs: 100, killGraceMs: 150 })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.signal).toBe('SIGKILL')
  })

  it('layers explicit env entries over the process environment', async () => {
    const outcome = await cliInternals.spawnOnce(NODE, ['-e', 'process.stdout.write(process.env.BLUE_CLI_PROBE ?? "unset")'], {
      env: { BLUE_CLI_PROBE: 'marked' },
    })
    expect(outcome.stdout).toBe('marked')
  })

  it('reports a missing binary as a spawn error without throwing', async () => {
    const outcome = await cliInternals.spawnOnce('definitely-not-a-binary-xyz', [])
    expect(outcome.spawnError).toBeDefined()
    expect(outcome.code).toBeNull()
  })

  it('captures a synchronous spawn rejection as a spawn error', async () => {
    const outcome = await cliInternals.spawnOnce('', [])
    expect(outcome.spawnError).toContain('ERR_INVALID_ARG_VALUE')
  })
})

describe('cli/internals defaultSpawnInherit', () => {
  it('resolves with the child exit code and no captures', async () => {
    const outcome = await cliInternals.spawnInherit(NODE, ['-e', 'process.exitCode = 7'], { env: { BLUE_CLI_PROBE: 'x' } })
    expect(outcome).toEqual({ code: 7, signal: null, stdout: '', stderr: '', timedOut: false })
  })

  it('reports a missing binary as a spawn error without throwing', async () => {
    const outcome = await cliInternals.spawnInherit('definitely-not-a-binary-xyz', [])
    expect(outcome.spawnError).toBeDefined()
    expect(outcome.code).toBeNull()
  })

  it('captures a synchronous spawn rejection as a spawn error', async () => {
    const outcome = await cliInternals.spawnInherit('', [])
    expect(outcome.spawnError).toContain('ERR_INVALID_ARG_VALUE')
  })
})

describe('cli/internals fs and resolution defaults', () => {
  it('reads a file, and reads missing/unreadable paths as undefined', () => {
    const dir = mkdtempTracked('blue-cli-io-')
    const file = join(dir, 'probe.txt')
    writeFileSync(file, 'content')
    expect(cliInternals.readTextFile(file)).toBe('content')
    expect(cliInternals.readTextFile(join(dir, 'absent.txt'))).toBeUndefined()
  })

  it('resolves the nested dsh manifest and reads an unresolvable specifier as undefined', () => {
    expect(resolvePackageManifest('@deepseek-ai/dsh/package.json')).toMatch(/@deepseek-ai[/\\]dsh[/\\]package\.json$/)
    expect(resolvePackageManifest('@dsh-blue/definitely-not-a-package-x/package.json')).toBeUndefined()
    expect(cliInternals.homedir()).toContain('/')
  })

  it('mirrors the process platform (the win32-branch seam, D56)', () => {
    expect(cliInternals.platform).toBe(process.platform)
  })
})
