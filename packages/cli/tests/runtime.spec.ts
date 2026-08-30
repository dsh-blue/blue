/** Tests for the archived dsh runtime cache and its atomic publication. */

import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { cliInternals } from '../src/internals.ts'
import { bundledDsh, HARNESS_LINE } from '../src/runtime.ts'

registerTempDirCleanup()

const REAL = { ...cliInternals }
const VERSION = '0.1.1-rc.3'

afterEach(() => {
  Object.assign(cliInternals, REAL)
})

/** A valid packaged-host manifest. */
function hostManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: HARNESS_LINE, bin: { dsh: 'lib/bin.js' }, ...overrides })
}

/** Set a fixture DSH_HOME and return the target and temporary roots. */
function fixturePaths(): { target: string, temporary: string } {
  const home = mkdtempTracked('blue-cli-runtime-home-')
  cliInternals.env = { DSH_HOME: home }
  return {
    target: join(home, 'cache', 'blue-cli-runtime', `${VERSION}-${HARNESS_LINE}`),
    temporary: join(home, 'cache', 'blue-cli-runtime', '.extract-fixture'),
  }
}

describe('bundledDsh', () => {
  it('reuses an already validated cache without filesystem writes', async () => {
    const { target } = fixturePaths()
    cliInternals.readTextFile = path => path.startsWith(target) ? hostManifest() : undefined
    cliInternals.makeDirectory = () => { throw new Error('unexpected write') }
    await expect(bundledDsh(VERSION)).resolves.toEqual({
      binJs: join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      version: HARNESS_LINE,
    })
  })

  it('extracts, validates, and atomically publishes a missing cache', async () => {
    const { target, temporary } = fixturePaths()
    const removed: string[] = []
    const extracted: Array<{ file: string, cwd: string }> = []
    let renamed: { from: string, to: string } | undefined
    cliInternals.readTextFile = path => path.startsWith(temporary) ? hostManifest() : undefined
    cliInternals.makeDirectory = () => {}
    cliInternals.removeTree = path => { removed.push(path) }
    cliInternals.makeTempDirectory = () => temporary
    cliInternals.extractRuntimeArchive = async (file, cwd) => { extracted.push({ file, cwd }) }
    cliInternals.renamePath = (from, to) => { renamed = { from, to } }
    await expect(bundledDsh(VERSION)).resolves.toEqual({
      binJs: join(target, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      version: HARNESS_LINE,
    })
    expect(extracted.map(item => item.file)).toEqual([
      expect.stringMatching(/runtime-common\.tgz$/),
      expect.stringMatching(new RegExp(`runtime-${process.platform}-${process.arch}\\.tgz$`)),
    ])
    expect(extracted.every(item => item.cwd === temporary)).toBe(true)
    expect(renamed).toEqual({ from: temporary, to: target })
    expect(removed).toEqual([])
  })

  it('accepts a concurrent publisher after losing the atomic rename race', async () => {
    const { target, temporary } = fixturePaths()
    let winner = false
    const removed: string[] = []
    cliInternals.readTextFile = path => {
      if (path.startsWith(temporary)) return hostManifest()
      return winner && path.startsWith(target) ? hostManifest() : undefined
    }
    cliInternals.makeDirectory = () => {}
    cliInternals.removeTree = path => { removed.push(path) }
    cliInternals.makeTempDirectory = () => temporary
    cliInternals.extractRuntimeArchive = async () => {}
    cliInternals.renamePath = () => { winner = true; throw new Error('EEXIST') }
    await expect(bundledDsh(VERSION)).resolves.toMatchObject({ version: HARNESS_LINE })
    expect(removed).toEqual([temporary])
  })

  it('cleans the temporary tree and surfaces extraction or rename failures', async () => {
    const { temporary } = fixturePaths()
    const removed: string[] = []
    cliInternals.readTextFile = path => path.startsWith(temporary) ? hostManifest() : undefined
    cliInternals.makeDirectory = () => {}
    cliInternals.removeTree = path => { removed.push(path) }
    cliInternals.makeTempDirectory = () => temporary
    cliInternals.extractRuntimeArchive = async () => {}
    cliInternals.renamePath = () => { throw new Error('disk full') }
    await expect(bundledDsh(VERSION)).rejects.toThrow('disk full')
    expect(removed).toEqual([temporary])

    removed.length = 0
    cliInternals.extractRuntimeArchive = async () => { throw new Error('bad gzip') }
    await expect(bundledDsh(VERSION)).rejects.toThrow('bad gzip')
    expect(removed).toEqual([temporary])
  })

  it.each([
    ['{ broken'],
    [hostManifest({ version: '0.1.0' })],
    [hostManifest({ bin: null })],
    [hostManifest({ bin: 'lib/bin.js' })],
    [hostManifest({ bin: { other: 'x.js' } })],
  ])('rejects a payload with an invalid host manifest %#', async manifest => {
    const { temporary } = fixturePaths()
    cliInternals.readTextFile = path => path.startsWith(temporary) ? manifest : undefined
    cliInternals.makeDirectory = () => {}
    cliInternals.removeTree = () => {}
    cliInternals.makeTempDirectory = () => temporary
    cliInternals.extractRuntimeArchive = async () => {}
    await expect(bundledDsh(VERSION)).rejects.toThrow(`runtime payload does not contain @deepseek-ai/dsh@${HARNESS_LINE}`)
  })

  it('rejects an invalid launcher version before touching the cache', async () => {
    await expect(bundledDsh('unknown')).rejects.toThrow('launcher manifest has no valid version')
  })

  it('rejects an unsupported platform before extraction', async () => {
    fixturePaths()
    cliInternals.platform = 'aix'
    cliInternals.arch = 'ppc64'
    cliInternals.makeDirectory = () => {}
    cliInternals.makeTempDirectory = () => '/temporary'
    cliInternals.removeTree = () => {}
    await expect(bundledDsh(VERSION)).rejects.toThrow('unsupported runtime platform: aix-ppc64')
  })
})
