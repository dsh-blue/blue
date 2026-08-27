/**
 * The global version-control guard: Blue has ONE release version (the
 * first release line, `0.1.0-rc.9` — the number the website's tagline and
 * quickstart promise) and ONE harness dependency line (the `dsh-*` pins,
 * which stay on their own prerelease line while Blue's number moves).
 *
 * Blue side: the ten release package.json versions plus the website (whose
 * package.json must agree with its own tagline),
 * and the `BLUE_VERSION` constant the banner title and the `/version`
 * notice read, all equal. The website's user-facing version mentions
 * (index.md tagline, guide/faq) are pinned here too, so the site can
 * never advertise a different number than the code ships.
 *
 * Harness side: every exact-pinned `@deepseek-ai/dsh-*` dev dependency,
 * every `^`-ranged dsh peer, every `pnpm-workspace.yaml`
 * `minimumReleaseAgeExclude` pin, and the `/version` notice's harness
 * line all agree with each other — and are NOT tied to Blue's release
 * number.
 *
 * A bump edits one side at a time: publishing Blue bumps the ten release
 * manifests + BLUE_VERSION + the website copy; upgrading the harness line
 * bumps the dsh pins + HARNESS_LINE. Any drift fails loudly here, so a
 * half-bumped tree can never ship.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLUE_VERSION } from '../src/banner-content.ts'
import { BLUE_VERSION as API_BLUE_VERSION } from '@dsh-blue/blue-api'

/** The published first-release version (the website's advertised number). */
const RELEASE_VERSION = '0.1.0-rc.9'
/** The harness prerelease line the dsh pins ride. */
const HARNESS_LINE = '0.1.1-rc.2'

/** One workspace package manifest. */
interface Manifest {
  readonly name: string
  readonly version: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/** The ten release manifests plus website whose version must equal the release. */
const MANIFESTS: readonly string[] = [
  '../../api/package.json',
  '../../frontend/package.json',
  '../../harness-adapter/package.json',
  '../../conversation/package.json',
  '../../core/package.json',
  '../package.json',
  '../../interaction/package.json',
  '../../app/package.json',
  '../../bundle/blue/package.json',
  '../../cli/package.json',
  '../../../website/package.json',
]
/** Publishable manifests that carry harness dependencies. */
const HARNESS_MANIFESTS = MANIFESTS.filter(rel => !rel.endsWith('/website/package.json'))

/** Read one manifest relative to this spec. */
function manifest(rel: string): Manifest {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Manifest
}

/** The dsh-harness dependency pins of one manifest's dependency table. */
function dshEntries(table: Readonly<Record<string, string>> | undefined): ReadonlyArray<[string, string]> {
  return Object.entries(table ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
}

describe('the Blue release line', () => {
  it('BLUE_VERSION is the version of all release manifests and website', () => {
    expect(MANIFESTS).toHaveLength(11)
    for (const rel of MANIFESTS) {
      const pkg = manifest(rel)
      expect(pkg.version, `${pkg.name} version`).toBe(RELEASE_VERSION)
    }
  })

  it('BLUE_VERSION is the constant', () => {
    expect(BLUE_VERSION).toBe(RELEASE_VERSION)
    expect(API_BLUE_VERSION).toBe(RELEASE_VERSION)
  })

  it('the website never advertises a different number than the code ships', () => {
    const zh = readFileSync(new URL('../../../website/index.md', import.meta.url), 'utf8')
    const en = readFileSync(new URL('../../../website/en/index.md', import.meta.url), 'utf8')
    expect(zh).toContain(`v${RELEASE_VERSION}`)
    expect(en).toContain(`v${RELEASE_VERSION}`)
    // The quickstart/FAQ pages promise the same first release.
    const zhGuide = readFileSync(new URL('../../../website/guide/faq.md', import.meta.url), 'utf8')
    const enGuide = readFileSync(new URL('../../../website/en/guide/index.md', import.meta.url), 'utf8')
    expect(zhGuide).toContain(`v${RELEASE_VERSION}`)
    expect(enGuide).toContain(`v${RELEASE_VERSION}`)
  })
})

describe('the harness dependency line', () => {
  it('every dsh runtime dependency is exact-pinned to one line', () => {
    // The bundle is the only manifest that ships runtime dsh dependencies
    // (agent-presets from D33, mcp-client from S34): they install with Blue,
    // so a range or a drifted line would ship a mixed tree.
    const specs = new Set<string>()
    for (const rel of HARNESS_MANIFESTS) {
      const pkg = manifest(rel)
      for (const [name, spec] of dshEntries(pkg.dependencies)) {
        expect(spec, `${pkg.name} dependencies ${name}`).toMatch(/^0\.1\.[0-9]+-rc\.[0-9]+$/)
        specs.add(spec)
      }
    }
    expect(specs.size, 'runtime dsh pins exist').toBeGreaterThan(0)
    expect([...specs]).toEqual([`${HARNESS_LINE}`])
  })

  it('every dsh dev dependency is exact-pinned to one line', () => {
    const specs = new Set<string>()
    for (const rel of HARNESS_MANIFESTS) {
      const pkg = manifest(rel)
      for (const [name, spec] of dshEntries(pkg.devDependencies)) {
        expect(spec, `${pkg.name} devDependencies ${name}`).toMatch(/^0\.1\.[0-9]+-rc\.[0-9]+$/)
        specs.add(spec)
      }
    }
    expect([...specs]).toEqual([`${HARNESS_LINE}`])
  })

  it('the archived CLI runtime seed and extractor pin the same host line', () => {
    const seed = manifest('../../cli/runtime/package.json')
    expect(seed.dependencies?.['@deepseek-ai/dsh']).toBe(HARNESS_LINE)
    const source = readFileSync(new URL('../../cli/src/runtime.ts', import.meta.url), 'utf8')
    expect(source).toContain(`export const HARNESS_LINE = '${HARNESS_LINE}'`)
  })

  it('every dsh peer dependency ranges exactly one line up from the pins', () => {
    for (const rel of HARNESS_MANIFESTS) {
      const pkg = manifest(rel)
      for (const [name, spec] of dshEntries(pkg.peerDependencies)) {
        expect(spec, `${pkg.name} peerDependencies ${name}`).toBe(`^${HARNESS_LINE}`)
      }
    }
  })

  it('the workspace release-age excludes pin the same line', () => {
    const workspace = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')
    const pins = [...workspace.matchAll(/'(@deepseek-ai\/dsh-[a-z-]+)@([^']+)'/g)]
    expect(pins.length).toBeGreaterThan(0)
    for (const [, name, spec] of pins) {
      expect(spec, `pnpm-workspace exclude ${name}`).toBe(`${HARNESS_LINE}`)
    }
  })

  it('the /version notice carries the harness line, not the Blue number', () => {
    const source = readFileSync(new URL('../../interaction/src/session-commands.ts', import.meta.url), 'utf8')
    expect(source).toContain(`const HARNESS_LINE = '${HARNESS_LINE}'`)
    expect(source).not.toContain("BLUE_VERSION.split('-')")
  })

  it('ci.yml derives the CLI pin from HARNESS_LINE, not a literal', () => {
    // Single-sourcing (R1): a literal version here would drift off this
    // gate, and an automation push touching a workflow file is rejected
    // by GitHub outright (GITHUB_TOKEN cannot update workflows).
    const ci = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
    expect(ci).toContain('$(node script/harness-line.mjs)')
    expect(ci).not.toContain(`@deepseek-ai/dsh@${HARNESS_LINE}`)
  })
})
