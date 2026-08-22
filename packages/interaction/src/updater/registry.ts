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
export type RegistryFailure = 'network' | 'unparseable'

/** A registry read: the packument, or the failure class. */
export type RegistryResult = { ok: true; packument: Packument } | { ok: false; reason: RegistryFailure }

/**
 * Normalize a raw npm-view or registry-API document into a
 * {@link Packument}; `undefined` when the shape is foreign.
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
  for (const [version, manifest] of Object.entries(versions as Record<string, unknown>)) {
    if (typeof manifest !== 'object' || manifest === null) continue
    const dependencies = (manifest as Record<string, unknown>).dependencies
    if (typeof dependencies !== 'object' || dependencies === null) {
      normalizedVersions[version] = undefined
      continue
    }
    const deps: Record<string, string> = {}
    for (const [name, spec] of Object.entries(dependencies as Record<string, unknown>)) {
      if (typeof spec === 'string') deps[name] = spec
    }
    normalizedVersions[version] = deps
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
  if (outcome.code !== 0) return { ok: false, reason: 'network' }
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

/**
 * Read the bundle's packument with bounded retries: up to three attempts
 * total with 1.5s/4s backoff (registry read lag after a publish), npm
 * view first and the direct fetch as fallback when npm is absent. Every
 * failure class collapses to one verdict — silent on the boot-check path,
 * messaged on `/update`.
 * @returns the packument, or the failure class for the caller's message.
 */
export async function fetchPackument(): Promise<RegistryResult> {
  let last: RegistryResult = { ok: false, reason: 'network' }
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await updaterInternals.sleep(RETRY_DELAYS_MS[attempt - 1]!)
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

/**
 * The exact pinned harness line a bundle version rides, read from its
 * published manifest: the `@deepseek-ai/dsh-agent-presets` dependency
 * every Blue release pins exactly (lockstep, the version.spec model).
 * A range spec (`^…`) carries no pin and reads as absent — the host
 * gate then warns instead of comparing against a guess.
 * @param packument - the normalized packument.
 * @param version - the bundle version to inspect.
 * @returns the pinned harness line, or `undefined` when unknown.
 */
export function harnessLineOf(packument: Packument, version: string): string | undefined {
  const spec = packument.versions[version]?.['@deepseek-ai/dsh-agent-presets']
  if (spec === undefined) return undefined
  return /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(spec)?.[1]
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
