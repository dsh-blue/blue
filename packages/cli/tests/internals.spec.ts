/**
 * Tests for the io seam's default bindings: the one-shot spawn (capture,
 * the SIGTERM→SIGKILL ladder, spawn errors), the inherit spawn, the fs
 * defaults.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { cliInternals, safeRuntimeArchivePath } from '../src/internals.ts'

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

  it('exposes the real home directory', () => {
    expect(cliInternals.homedir()).toContain('/')
  })

  it('mirrors the process platform (the win32-branch seam, D56)', () => {
    expect(cliInternals.platform).toBe(process.platform)
    expect(cliInternals.arch).toBe(process.arch)
  })

  it('creates, renames, and removes launcher-owned directories', () => {
    const root = mkdtempTracked('blue-cli-fs-')
    const parent = join(root, 'parent')
    cliInternals.makeDirectory(parent)
    const temporary = cliInternals.makeTempDirectory(join(parent, '.tmp-'))
    const target = join(parent, 'target')
    cliInternals.renamePath(temporary, target)
    expect(existsSync(target)).toBe(true)
    cliInternals.removeTree(target)
    expect(existsSync(target)).toBe(false)
  })

  it('extracts only the runtime node_modules tree', async () => {
    const root = mkdtempTracked('blue-cli-tar-')
    const source = join(root, 'source')
    const output = join(root, 'output')
    mkdirSync(join(source, 'node_modules'), { recursive: true })
    mkdirSync(join(source, 'other'), { recursive: true })
    writeFileSync(join(source, 'node_modules', 'kept.txt'), 'kept')
    writeFileSync(join(source, 'other', 'ignored.txt'), 'ignored')
    const archive = join(root, 'runtime.tgz')
    createTar({ cwd: source, file: archive, gzip: true, sync: true }, ['node_modules', 'other'])
    cliInternals.makeDirectory(output)
    await cliInternals.extractRuntimeArchive(archive, output)
    expect(readFileSync(join(output, 'node_modules', 'kept.txt'), 'utf8')).toBe('kept')
    expect(existsSync(join(output, 'other'))).toBe(false)
  })
})

describe('safeRuntimeArchivePath', () => {
  it('admits only node_modules paths and normalizes Windows separators', () => {
    expect(safeRuntimeArchivePath('node_modules')).toBe(true)
    expect(safeRuntimeArchivePath('node_modules/pkg/index.js')).toBe(true)
    expect(safeRuntimeArchivePath('node_modules\\pkg\\index.js')).toBe(true)
    expect(safeRuntimeArchivePath('other/file')).toBe(false)
  })

  it.each(['/absolute', 'C:/absolute', '../escape', 'node_modules/../escape'])(
    'rejects an unsafe archive path %s',
    path => expect(() => safeRuntimeArchivePath(path)).toThrow('unsafe runtime archive path'),
  )
})
