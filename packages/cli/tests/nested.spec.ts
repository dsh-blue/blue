/**
 * Tests for the nested-host resolution (D50 decision 4, plan A): the
 * pinned `@deepseek-ai/dsh` manifest is found through the seam, its bin
 * map (string or `dsh`-keyed object) is joined onto its directory, and
 * every broken-install shape reads as `undefined` fields.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempTracked } from '../../core/tests/temp-dir.ts'
import { cliInternals } from '../src/internals.ts'
import { nestedDsh } from '../src/nested.ts'

/** The real seams, restored after every test. */
const REAL = { ...cliInternals }

afterEach(() => {
  Object.assign(cliInternals, REAL)
})

/** Point the resolution seam at a fixture manifest and return its directory. */
function fixtureHost(manifest: string): string {
  const dir = mkdtempTracked('blue-cli-nested-')
  writeFileSync(join(dir, 'package.json'), manifest)
  cliInternals.resolveNestedDshManifest = () => join(dir, 'package.json')
  return dir
}

describe('nestedDsh', () => {
  it('reads the version and joins the dsh-named bin entry', () => {
    const dir = fixtureHost(JSON.stringify({ version: '0.1.1-rc.2', bin: { dsh: 'lib/bin.js', other: 'x.js' } }))
    expect(nestedDsh()).toEqual({ binJs: join(dir, 'lib/bin.js'), version: '0.1.1-rc.2' })
  })

  it('accepts the string bin form and the first map entry without a dsh key', () => {
    const dir = fixtureHost(JSON.stringify({ version: '1.2.3', bin: 'cli.js' }))
    expect(nestedDsh().binJs).toBe(join(dir, 'cli.js'))
    const dirMap = fixtureHost(JSON.stringify({ version: '1.2.3', bin: { host: 'h.js' } }))
    expect(nestedDsh().binJs).toBe(join(dirMap, 'h.js'))
  })

  it('reports the version with no usable bin entry', () => {
    fixtureHost(JSON.stringify({ version: '1.2.3' }))
    expect(nestedDsh()).toEqual({ binJs: undefined, version: '1.2.3' })
    fixtureHost(JSON.stringify({ version: '1.2.3', bin: { dsh: 7 } }))
    expect(nestedDsh()).toEqual({ binJs: undefined, version: '1.2.3' })
    fixtureHost(JSON.stringify({ version: '1.2.3', bin: {} }))
    expect(nestedDsh()).toEqual({ binJs: undefined, version: '1.2.3' })
  })

  it('reads a broken install as undefined fields', () => {
    cliInternals.resolveNestedDshManifest = () => undefined
    expect(nestedDsh()).toEqual({ binJs: undefined, version: undefined })
    const dir = mkdtempTracked('blue-cli-nested-')
    cliInternals.resolveNestedDshManifest = () => join(dir, 'package.json')
    expect(nestedDsh()).toEqual({ binJs: undefined, version: undefined })
    fixtureHost('{ not json')
    expect(nestedDsh()).toEqual({ binJs: undefined, version: undefined })
    const dirBad = fixtureHost(JSON.stringify({ version: 3, bin: 'x.js' }))
    expect(nestedDsh()).toEqual({ binJs: join(dirBad, 'x.js'), version: undefined })
  })

  it('resolves the real nested host of this workspace', () => {
    const nested = nestedDsh()
    expect(nested.version).toBe('0.1.1-rc.2')
    expect(nested.binJs).toMatch(/@deepseek-ai[/\\]dsh[/\\]lib[/\\]bin\.js$/)
  })
})

