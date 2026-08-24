/**
 * Registry metadata for the updater (D52): the `@dsh-blue/blue` packument
 * — dist-tags, per-version dependencies, publish times — read through
 * `npm view --json` first (it honors the user's npmrc mirrors and
 * proxies, which the direct fallback cannot) and the registry HTTP API
 * when npm is unavailable. The read is metadata-only: no auth, no
 * telemetry, exactly one document per check.
 *
 * The R1/R4 cooldown finding shapes the design: dist-tag *resolution*
 * inside pnpm's `minimumReleaseAge` window silently rolls back, so the
 * updater never asks a package manager what is new — it reads the tag
 * table itself and pins exact versions everywhere downstream.
 *
 * @module @dsh-blue/blue-interaction/updater/registry
 */

import { updaterInternals } from './io.ts'

/** The registry package the update family tracks (the installable bundle). */
export const BUNDLE_PACKAGE = '@dsh-blue/blue'

/** The default registry host for the fetch fallback. */
const REGISTRY_URL = 'https://registry.npmjs.org/@dsh-blue/blue'

/** One npm-view attempt: 15s bound, the registry's own read-lag budget. */
const VIEW_TIMEOUT_MS = 15_000

/** The fetch fallback's shorter bound — metadata only, no install traffic. */
const FETCH_TIMEOUT_MS = 8_000

/** Retry backoff between registry attempts (release.yml's read-lag ladder). */
const RETRY_DELAYS_MS = [1_500, 4_000]

/** The normalized packument the pre-flight gates and the offer read. */
export interface Packument {
  /** dist-tag → version (`rc`, `latest`, …). */
  readonly tags: Readonly<Record<string, string>>
  /** version → its manifest's `dependencies` (absent when dependency-free). */
  readonly versions: Readonly<Record<string, Readonly<Record<string, string>> | undefined>>
  /** version (or `created`/`modified`) → ISO publish timestamp. */
  readonly time: Readonly<Record<string, string>>
}

/** Why a registry read failed — the caller picks the user-facing message. */
export type RegistryFailure = 'network' | 'unparseable' | 'not-found'

/** A registry read: the packument, or the failure class. */
export type RegistryResult = { ok: true; packument: Packument } | { ok: false; reason: RegistryFailure }

/**
 * Normalize a raw npm-view or registry-API document into a
 * {@link Packument}; `undefined` when the shape is foreign. The two
 * sources differ in `versions`: the registry API keys full manifests by
 * version string; `npm view --json` emits an ARRAY of version STRINGS
 * (the manifest fields ride only on the top level, for the newest
 * release) — both fold into the version-keyed map, and the npm-view
 * shape leaves per-version dependencies to
 * {@link releaseFacts}'s targeted query.
 * @param raw - the parsed JSON document.
 * @returns the packument, or `undefined` when required fields are absent.
 */
export function normalizePackument(raw: unknown): Packument | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  const tags = record['dist-tags']
  const versions = record.versions
  const time = record.time
  if (typeof tags !== 'object' || tags === null) return undefined
  if (typeof versions !== 'object' || versions === null) return undefined
  if (typeof time !== 'object' || time === null) return undefined
  const normalizedVersions: Record<string, Record<string, string> | undefined> = {}
  const claim = (version: unknown, manifest: unknown): void => {
    if (typeof version !== 'string') return
    const dependencies = typeof manifest === 'object' && manifest !== null
      ? (manifest as Record<string, unknown>).dependencies
      : undefined
    if (typeof dependencies !== 'object' || dependencies === null) {
      normalizedVersions[version] = undefined
      return
    }
    const deps: Record<string, string> = {}
    for (const [name, spec] of Object.entries(dependencies as Record<string, unknown>)) {
      if (typeof spec === 'string') deps[name] = spec
    }
    normalizedVersions[version] = deps
  }
  if (Array.isArray(versions)) {
    // npm view: version strings, or (defensively) full manifests.
    for (const entry of versions) {
      if (typeof entry === 'string') claim(entry, undefined)
      else if (typeof entry === 'object' && entry !== null) claim((entry as Record<string, unknown>).version, entry)
    }
  } else {
    for (const [version, manifest] of Object.entries(versions as Record<string, unknown>)) {
      claim(version, manifest)
    }
  }
  const normalizedTime: Record<string, string> = {}
  for (const [key, value] of Object.entries(time as Record<string, unknown>)) {
    if (typeof value === 'string') normalizedTime[key] = value
  }
  const normalizedTags: Record<string, string> = {}
  for (const [tag, version] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof version === 'string') normalizedTags[tag] = version
  }
  return { tags: normalizedTags, versions: normalizedVersions, time: normalizedTime }
}

/** Parse stdout text into a packument, classifying the failure mode. */
function parseViewOutput(stdout: string): RegistryResult {
  try {
    const packument = normalizePackument(JSON.parse(stdout))
    if (packument === undefined) return { ok: false, reason: 'unparseable' }
    return { ok: true, packument }
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
}

/** Run `npm view <pkg> --json` through the one-shot seam. */
async function npmView(): Promise<RegistryResult | undefined> {
  const outcome = await updaterInternals.spawnOnce('npm', ['view', BUNDLE_PACKAGE, '--json'], {
    timeoutMs: VIEW_TIMEOUT_MS,
  })
  // A missing npm binary cannot be retried into existence — the caller
  // falls through to the direct fetch.
  if (outcome.spawnError !== undefined) return undefined
  // E404 is its own class: the package is unknown to that registry (a
  // misconfigured mirror), not a connectivity problem.
  if (outcome.code !== 0) {
    return { ok: false, reason: outcome.stderr.includes('E404') ? 'not-found' : 'network' }
  }
  return parseViewOutput(outcome.stdout)
}

/** Fetch the packument straight from the registry API. */
async function directFetch(): Promise<RegistryResult> {
  try {
    const text = await updaterInternals.fetchText(REGISTRY_URL, FETCH_TIMEOUT_MS)
    return parseViewOutput(text)
  } catch {
    return { ok: false, reason: 'network' }
  }
}

/** Progress hooks for a packument read; the UI layers wire notices here. */
export interface FetchPackumentHooks {
  /**
   * Fired before each retry attempt (never for the first): `attempt` and
   * `total` are 1-based attempt numbers (2/3, 3/3).
   */
  readonly onRetry?: (attempt: number, total: number) => void
}

/**
 * Read the bundle's packument with bounded retries: up to three attempts
 * total with 1.5s/4s backoff (registry read lag after a publish), npm
 * view first and the direct fetch as fallback when npm is absent. Every
 * failure class collapses to one verdict — silent on the boot-check path,
 * messaged on `/update`.
 * @param hooks - optional progress callbacks (the registry layer stays
 * UI-free; callers flash their own notices).
 * @returns the packument, or the failure class for the caller's message.
 */
export async function fetchPackument(hooks: FetchPackumentHooks = {}): Promise<RegistryResult> {
  let last: RegistryResult = { ok: false, reason: 'network' }
  const total = RETRY_DELAYS_MS.length + 1
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      hooks.onRetry?.(attempt + 1, total)
      await updaterInternals.sleep(RETRY_DELAYS_MS[attempt - 1]!)
    }
    const view = await npmView()
    if (view !== undefined) {
      last = view
      if (view.ok) return view
      continue
    }
    // npm unavailable — the direct fetch is the whole attempt.
    last = await directFetch()
    if (last.ok) return last
  }
  return last
}

/** What a release's own manifest says about its set and harness pin. */
export interface ReleaseFacts {
  /** The release's lockstep set: the bundle plus its `@dsh-blue/*` deps. */
  readonly names: readonly string[]
  /**
   * The exact pinned harness line (`@deepseek-ai/dsh-agent-presets`); a
   * range spec carries no pin and reads as absent.
   */
  readonly harnessLine: string | undefined
}

/**
 * Read one release's facts. The per-version dependency block comes from
 * the packument when the source carries it (the registry API shape) and
 * otherwise from one targeted `npm view <pkg>@<version> dependencies`
 * query (the npm-view shape lists versions without their manifests).
 * The set is derived per release because it GROWS — rc.2 shipped five
 * packages, blue-api joins later — and a hardcoded list would misjudge
 * every install that predates the newest member (the rehearsal
 * finding: the verify step flagged a healthy rc.2 tree and the rollback
 * asked the registry for a package it never served).
 * @param packument - the normalized packument.
 * @param version - the bundle version.
 * @returns the release's set names and harness pin.
 */
export async function releaseFacts(packument: Packument, version: string): Promise<ReleaseFacts> {
  let deps = packument.versions[version]
  if (deps === undefined) {
    deps = await viewDependencies(version)
  }
  const names = [BUNDLE_PACKAGE, ...deps === undefined ? [] : Object.keys(deps).filter(name => name.startsWith('@dsh-blue/'))]
  const spec = deps?.['@deepseek-ai/dsh-agent-presets']
  return {
    names,
    harnessLine: spec === undefined ? undefined : /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec)?.[1],
  }
}

/** One targeted manifest query: `npm view <pkg>@<version> dependencies`. */
async function viewDependencies(version: string): Promise<Record<string, string> | undefined> {
  const outcome = await updaterInternals.spawnOnce('npm', ['view', `${BUNDLE_PACKAGE}@${version}`, 'dependencies', '--json'], {
    timeoutMs: VIEW_TIMEOUT_MS,
  })
  if (outcome.spawnError !== undefined || outcome.code !== 0) return undefined
  try {
    const parsed: unknown = JSON.parse(outcome.stdout)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const deps: Record<string, string> = {}
    for (const [name, spec] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof spec === 'string') deps[name] = spec
    }
    return deps
  } catch {
    return undefined
  }
}

/**
 * When a version was published, in epoch milliseconds.
 * @param packument - the normalized packument.
 * @param version - the bundle version.
 * @returns the publish time, or `undefined` when the registry did not
 * record one.
 */
export function publishedAt(packument: Packument, version: string): number | undefined {
  const stamp = packument.time[version]
  if (stamp === undefined) return undefined
  const parsed = Date.parse(stamp)
  return Number.isNaN(parsed) ? undefined : parsed
}
