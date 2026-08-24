/**
 * Tests for the io seam's default bindings: the one-shot spawn (capture,
 * the SIGTERM→SIGKILL ladder, spawn errors), the inherit spawn, the fs
 * defaults, and the manifest resolution helper.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/** Stand a payload source tree up inside a fresh temp root. */
function payloadSource(): { root: string, source: string } {
  const root = mkdtempTracked('blue-cli-sync-')
  const source = join(root, 'payload')
  mkdirSync(join(source, 'skills', 'one'), { recursive: true })
  writeFileSync(join(source, 'agent.cordis.yml'), '- id: persona\n')
  writeFileSync(join(source, 'preset.yml'), 'name: 创造模式\n')
  writeFileSync(join(source, 'skills', 'one', 'SKILL.md'), '# One\n')
  return { root, source }
}

describe('cli/internals syncPresetTree (S39)', () => {
  it('copies the payload tree wholesale and writes the stamp beside the target', () => {
    const { root, source } = payloadSource()
    const target = join(root, 'host', 'config', 'agent-presets', 'cordis')
    expect(cliInternals.syncPresetTree(source, target, 'blue-cli 0.1.0-rc.7')).toBe('synced')
    expect(readFileSync(join(target, 'agent.cordis.yml'), 'utf8')).toBe('- id: persona\n')
    expect(readFileSync(join(target, 'skills', 'one', 'SKILL.md'), 'utf8')).toBe('# One\n')
    expect(readFileSync(join(root, 'host', 'config', 'agent-presets', '.blue-cordis.stamp'), 'utf8')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('skips an unchanged tree as fresh, and re-syncs on a payload or stamp change, clearing stale files', () => {
    const { root, source } = payloadSource()
    const target = join(root, 'cordis')
    expect(cliInternals.syncPresetTree(source, target, 'v1')).toBe('synced')
    expect(cliInternals.syncPresetTree(source, target, 'v1')).toBe('fresh')
    // A stale stamp read failure (corrupt stamp file is unreadable content)
    // takes the same re-sync path as a missing one.
    writeFileSync(join(root, '.blue-cordis.stamp'), 'garbage')
    writeFileSync(join(target, 'stale.md'), 'leftover')
    expect(cliInternals.syncPresetTree(source, target, 'v1')).toBe('synced')
    expect(existsSync(join(target, 'stale.md'))).toBe(false)
    writeFileSync(join(source, 'preset.yml'), 'name: 新模式\n')
    expect(cliInternals.syncPresetTree(source, target, 'v1')).toBe('synced')
    expect(readFileSync(join(target, 'preset.yml'), 'utf8')).toBe('name: 新模式\n')
    expect(cliInternals.syncPresetTree(source, target, 'v2')).toBe('synced')
  })

  it('reports an unwalkable source as an error instead of throwing', () => {
    const root = mkdtempTracked('blue-cli-sync-')
    const outcome = cliInternals.syncPresetTree(join(root, 'absent'), join(root, 'target'), 'v1')
    expect(outcome).not.toBe('fresh')
    expect(outcome).not.toBe('synced')
    expect(typeof outcome === 'object' && outcome.error).toContain('ENOENT')
  })
})
