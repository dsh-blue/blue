/**
 * The global version-control guard: Blue's release version is ONE lockstep
 * line. The five package.json versions, the `BLUE_VERSION` constant the
 * banner title and the `/version` notice read, every exact-pinned
 * `@deepseek-ai/dsh-*` dev dependency, every `^`-ranged `dsh-*` peer, and
 * the pnpm-workspace `minimumReleaseAgeExclude` pins must all agree. A bump
 * edits the same line in every place at once — any drift fails here loudly,
 * so a half-bumped tree that mixes harness release lines can never ship.
 *
 * The current version line is documented in AGENTS.md ("all at version …")
 * and surfaced by `/version`; this spec is the control that keeps those
 * claims true.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLUE_VERSION } from '../src/banner-content.ts'

/** One workspace package manifest. */
interface Manifest {
  readonly name: string
  readonly version: string
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/** The five publishable packages, in dependency order. */
const MANIFESTS: readonly string[] = [
  '../../core/package.json',
  '../package.json',
  '../../interaction/package.json',
  '../../app/package.json',
  '../../bundle/blue/package.json',
]

/** Read one manifest relative to this spec. */
function manifest(rel: string): Manifest {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Manifest
}

/** The dsh-harness dependency pins of one manifest's dependency table. */
function dshEntries(table: Readonly<Record<string, string>> | undefined): ReadonlyArray<[string, string]> {
  return Object.entries(table ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
}

describe('the global version line', () => {
  it('BLUE_VERSION is the version of all five packages', () => {
    expect(MANIFESTS).toHaveLength(5)
    for (const rel of MANIFESTS) {
      const pkg = manifest(rel)
      expect(pkg.version, `${pkg.name} version`).toBe(BLUE_VERSION)
    }
  })

  it('every dsh dev dependency is exact-pinned to the version', () => {
    for (const rel of MANIFESTS) {
      const pkg = manifest(rel)
      for (const [name, spec] of dshEntries(pkg.devDependencies)) {
        expect(spec, `${pkg.name} devDependencies ${name}`).toBe(BLUE_VERSION)
      }
    }
  })

  it('every dsh peer dependency ranges exactly one line up from the version', () => {
    for (const rel of MANIFESTS) {
      const pkg = manifest(rel)
      for (const [name, spec] of dshEntries(pkg.peerDependencies)) {
        expect(spec, `${pkg.name} peerDependencies ${name}`).toBe(`^${BLUE_VERSION}`)
      }
    }
  })

  it('the workspace release-age excludes pin the same line', () => {
    const workspace = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const pins = [...workspace.matchAll(/'(@deepseek-ai\/dsh-[a-z-]+)@([^']+)'/g)]
    expect(pins.length).toBeGreaterThan(0)
    for (const [, name, spec] of pins) {
      expect(spec, `pnpm-workspace exclude ${name}`).toBe(BLUE_VERSION)
    }
  })
})
