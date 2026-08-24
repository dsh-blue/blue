/**
 * Tests for the updater's io seam (D52): the ANSI cleaner, the default
 * one-shot spawn (capture, stdin feed, the SIGTERM→SIGKILL ladder, spawn
 * errors), the default interactive spawn (streamed output, live stdin,
 * kill), the fs defaults, and the environment passthroughs.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempTracked } from '../../core/tests/temp-dir.ts'
import { cleanOutput, updaterInternals } from '../src/updater/io.ts'

/** Child scripts run with the test runner's own Node. */
const NODE = process.execPath

describe('updater/io cleanOutput', () => {
  it('strips ANSI escapes, OSC hyperlinks, and carriage returns', () => {
    expect(cleanOutput('\x1b[1;32mhi\x1b[0m')).toBe('hi')
    expect(cleanOutput('\x1b]8;;https://x\x07link\x1b]8;;\x07')).toBe('link')
    expect(cleanOutput('a\r\nb')).toBe('a\nb')
  })
})

describe('updater/io defaultSpawnOnce', () => {
  it('captures stdout, stderr, and the exit code', async () => {
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', 'process.stdout.write("out"); process.stderr.write("err")'])
    expect(outcome.code).toBe(0)
    expect(outcome.stdout).toBe('out')
    expect(outcome.stderr).toBe('err')
    expect(outcome.timedOut).toBe(false)
    expect(outcome.spawnError).toBeUndefined()
  })

  it('captures a nonzero exit code', async () => {
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', 'process.exit(3)'])
    expect(outcome.code).toBe(3)
  })

  it('feeds stdin input and ends the stream', async () => {
    const script = [
      'let data = ""',
      'process.stdin.on("data", chunk => { data += chunk })',
      'process.stdin.on("end", () => { process.stdout.write(data) })',
    ].join(';')
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', script], { input: 'ping' })
    expect(outcome.stdout).toBe('ping')
  })

  it('kills a runaway child with SIGTERM at the deadline', async () => {
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', 'setTimeout(() => {}, 60000)'], {
      timeoutMs: 150,
    })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.signal).toBe('SIGTERM')
  })

  it('escalates to SIGKILL when the child traps SIGTERM', async () => {
    const script = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', script], {
      timeoutMs: 100,
      killGraceMs: 150,
    })
    expect(outcome.timedOut).toBe(true)
    expect(outcome.signal).toBe('SIGKILL')
  })

  it('layers explicit env entries over the process environment', async () => {
    const outcome = await updaterInternals.spawnOnce(NODE, ['-e', 'process.stdout.write(process.env.BLUE_IO_PROBE ?? "unset")'], {
      env: { BLUE_IO_PROBE: 'marked' },
    })
    expect(outcome.stdout).toBe('marked')
  })

  it('reports a missing binary as a spawn error without throwing', async () => {
    const outcome = await updaterInternals.spawnOnce('definitely-not-a-binary-xyz', [])
    expect(outcome.spawnError).toBeDefined()
    expect(outcome.code).toBeNull()
  })
})

describe('updater/io defaultSpawnInteractive', () => {
  /** An echo child that exits cleanly on the line "exit". */
  function echoChild() {
    const script = [
      'process.stdin.on("data", chunk => {',
      '  const text = String(chunk);',
      '  if (text.includes("exit")) process.exit(0);',
      '  process.stdout.write(text);',
      '});',
    ].join('')
    return updaterInternals.spawnInteractive(NODE, ['-e', script])
  }

  it('streams output while stdin stays writable, then exits', async () => {
    const child = echoChild()
    child.write('hi')
    await updaterInternals.sleep(300)
    expect(child.output()).toContain('hi')
    child.write('exit')
    const outcome = await child.exited
    expect(outcome.code).toBe(0)
    expect(outcome.timedOut).toBe(false)
  })

  it('captures stderr from an interactive child', async () => {
    const child = updaterInternals.spawnInteractive(NODE, ['-e', 'process.stderr.write("note")'])
    await updaterInternals.sleep(300)
    expect(child.output()).toContain('note')
    child.kill()
    await child.exited
  })

  it('kill() escalates to SIGKILL when the child traps SIGTERM', async () => {
    const child = updaterInternals.spawnInteractive(
      NODE,
      ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      { killGraceMs: 150 },
    )
    // Let the child install its trap before the signal races it.
    await updaterInternals.sleep(300)
    child.kill()
    const outcome = await child.exited
    expect(outcome.timedOut).toBe(true)
    expect(outcome.signal).toBe('SIGKILL')
  })

  it('resolves exited for a missing binary', async () => {
    const child = updaterInternals.spawnInteractive('definitely-not-a-binary-xyz', [])
    const outcome = await child.exited
    expect(outcome.spawnError).toBeDefined()
  })

  it('write after exit is harmless', async () => {
    const child = echoChild()
    child.write('exit')
    await child.exited
    expect(() => child.write('late')).not.toThrow()
  })
})

describe('updater/io fs defaults', () => {
  const dir = mkdtempTracked('blue-updater-io-')
  // The rmSync branch never runs through defaults; force a list failure
  // through a genuinely absent path instead of deleting temp state.
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes with parent creation, reads back, and reads missing as undefined', () => {
    const file = join(dir, 'nested', 'state.json')
    updaterInternals.writeTextFile(file, '{"a":1}')
    expect(updaterInternals.readTextFile(file)).toBe('{"a":1}')
    expect(updaterInternals.readTextFile(join(dir, 'absent.txt'))).toBeUndefined()
  })

  it('appends, creating the file on first write', () => {
    const file = join(dir, 'logs', 'update.log')
    updaterInternals.appendTextFile(file, 'one')
    updaterInternals.appendTextFile(file, 'two')
    expect(updaterInternals.readTextFile(file)).toBe('onetwo')
  })

  it('copies with overwrite and directory creation', () => {
    const from = join(dir, 'nested', 'state.json')
    const to = join(dir, 'elsewhere', 'state.json')
    updaterInternals.copyFile(from, to)
    expect(updaterInternals.readTextFile(to)).toBe('{"a":1}')
    writeFileSync(from, '{"a":2}')
    updaterInternals.copyFile(from, to)
    expect(updaterInternals.readTextFile(to)).toBe('{"a":2}')
  })

  it('ensures directories and lists, missing as undefined', () => {
    const target = join(dir, 'a', 'b', 'c')
    updaterInternals.ensureDir(target)
    expect(existsSync(target)).toBe(true)
    expect(updaterInternals.listDir(join(dir, 'a'))).toContain('b')
    expect(updaterInternals.listDir(join(dir, 'nope'))).toBeUndefined()
  })

  it('removes files and directory trees, absent targets being no-ops', () => {
    const file = join(dir, 'gone', 'marker.txt')
    updaterInternals.writeTextFile(file, 'x')
    updaterInternals.removeFile(file)
    expect(existsSync(file)).toBe(false)
    expect(() => updaterInternals.removeFile(file)).not.toThrow()
    updaterInternals.removeDir(join(dir, 'gone'))
    expect(existsSync(join(dir, 'gone'))).toBe(false)
    expect(() => updaterInternals.removeDir(join(dir, 'gone'))).not.toThrow()
  })

  it('renames a directory into place', () => {
    const staging = join(dir, 'staging')
    updaterInternals.ensureDir(staging)
    updaterInternals.writeTextFile(join(staging, 'manifest.json'), '{}')
    updaterInternals.rename(staging, join(dir, 'backup'))
    expect(existsSync(staging)).toBe(false)
    expect(updaterInternals.readTextFile(join(dir, 'backup', 'manifest.json'))).toBe('{}')
  })

  it('reads text written straight to disk', () => {
    const file = join(dir, 'plain.txt')
    writeFileSync(file, 'plain')
    expect(updaterInternals.readTextFile(file)).toBe('plain')
    expect(readFileSync(file, 'utf8')).toBe('plain')
  })
})

describe('updater/io environment passthroughs', () => {
  it('homedir reads the OS home and env is the process environment', () => {
    expect(updaterInternals.homedir()).toBe(homedir())
    expect(updaterInternals.env).toBe(process.env)
  })

  it('sleep resolves', async () => {
    await updaterInternals.sleep(0)
  })

  it('fetchText rejects on a refused connection', async () => {
    await expect(updaterInternals.fetchText('http://127.0.0.1:1/', 500)).rejects.toThrow()
  })

  it('fetchText rejects on a non-OK registry answer', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 503
      response.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no listen address')
      await expect(updaterInternals.fetchText(`http://127.0.0.1:${address.port}/`, 2_000)).rejects.toThrow('503')
    } finally {
      server.close()
    }
  })

  it('fetchText returns the body of an OK answer', async () => {
    const server = createServer((_request, response) => {
      response.end('{"dist-tags":{}}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no listen address')
      await expect(updaterInternals.fetchText(`http://127.0.0.1:${address.port}/`, 2_000)).resolves.toBe('{"dist-tags":{}}')
    } finally {
      server.close()
    }
  })

  it('now() reads the wall clock', () => {
    expect(updaterInternals.now()).toBeGreaterThan(0)
  })
})
