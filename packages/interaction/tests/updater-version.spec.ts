/**
 * Tests for the updater's version module (D52): parse shapes, the semver
 * ordering ported from `script/harness-drift.mjs` (core fields, release
 * over prerelease, numeric prerelease identifiers, the string fallback
 * for unparseable input), and the D51 version floor.
 */

import { describe, expect, it } from 'vitest'
import { compareVersions, isVersion, parseVersion, VERSION_FLOOR } from '../src/updater/version.ts'

describe('updater/version parseVersion', () => {
  it('parses a plain release', () => {
    expect(parseVersion('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] })
  })

  it('parses a dotted prerelease into identifiers', () => {
    expect(parseVersion('0.1.0-rc.2')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: ['rc', '2'] })
  })

  it('rejects foreign shapes', () => {
    for (const value of ['', '0.1', '0.1.0.0', 'v0.1.0', '0.1.0-rc.2+build', 'latest', '0.1.0-']) {
      expect(parseVersion(value), value).toBeUndefined()
      expect(isVersion(value), value).toBe(false)
    }
  })

  it('accepts every shape the updater feeds it', () => {
    for (const value of ['0.1.0-rc.2', '1.2.3', '10.20.30-beta.1']) {
      expect(isVersion(value), value).toBe(true)
    }
  })
})

describe('updater/version compareVersions', () => {
  it('orders core fields numerically', () => {
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  it('equals only on identical versions', () => {
    expect(compareVersions('0.1.0-rc.2', '0.1.0-rc.2')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
  })

  it('ranks a release above its prereleases', () => {
    expect(compareVersions('0.1.0-rc.3', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('0.1.0', '0.1.0-rc.3')).toBeGreaterThan(0)
  })

  it('compares numeric prerelease identifiers numerically (rc.2 before rc.10)', () => {
    expect(compareVersions('0.1.0-rc.2', '0.1.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.10', '0.1.0-rc.9')).toBeGreaterThan(0)
  })

  it('ends the shorter identifier list first', () => {
    expect(compareVersions('0.1.0-rc', '0.1.0-rc.1')).toBeLessThan(0)
    expect(compareVersions('0.1.0-rc.1', '0.1.0-rc')).toBeGreaterThan(0)
  })

  it('ranks numeric identifiers before alphanumeric ones', () => {
    expect(compareVersions('0.1.0-1', '0.1.0-alpha')).toBeLessThan(0)
    expect(compareVersions('0.1.0-alpha', '0.1.0-1')).toBeGreaterThan(0)
  })

  it('compares alphanumeric identifiers lexically', () => {
    expect(compareVersions('0.1.0-alpha', '0.1.0-beta')).toBeLessThan(0)
    expect(compareVersions('0.1.0-beta', '0.1.0-alpha')).toBeGreaterThan(0)
  })

  it('falls back to string order only when a side does not parse', () => {
    expect(compareVersions('garbage', 'garbage')).toBe(0)
    expect(compareVersions('aaa', 'zzz')).toBeLessThan(0)
    expect(compareVersions('zzz', 'aaa')).toBeGreaterThan(0)
  })
})

describe('updater/version VERSION_FLOOR', () => {
  it('pins the D51 floor at the first installable release', () => {
    expect(VERSION_FLOOR).toBe('0.1.0-rc.2')
    expect(compareVersions('0.1.0-rc.1', VERSION_FLOOR)).toBeLessThan(0)
    expect(compareVersions(VERSION_FLOOR, VERSION_FLOOR)).toBe(0)
  })
})

