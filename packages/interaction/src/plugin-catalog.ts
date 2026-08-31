/**
 * Bounded GitHub index for the `/plugin` catalog tab. Repository metadata is
 * never executable: a pinned commit, package manifest, and Blue distribution
 * manifest are parsed into renderer-neutral rows before installation is
 * offered.
 *
 * @module @dsh-blue/blue-interaction/plugin-catalog
 */

import {
  BLUE_API_VERSION,
  BLUE_VERSION,
  validateBlueManifest,
  type BluePluginManifest,
} from '@dsh-blue/blue-api'
import {
  validateBluePluginManifestV1,
  type BluePluginManifestV1,
} from '@dsh-blue/blue-api/protocol/v1'
import { BLUE_PLUGIN_HARNESS_LINE } from '@dsh-blue/blue-plugin-kit'
import { satisfies, valid } from 'semver'

const FETCH_TIMEOUT_MS = 5_000
const MAX_JSON_BYTES = 128 * 1024
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u

/** Catalog admission state; only `compatible` entries are installable. */
export type PluginCatalogState = 'compatible' | 'incompatible' | 'needs-migration' | 'invalid'

/** One inert plugin record shown by the catalog tab. */
export interface PluginCatalogEntry {
  readonly packageName: string
  readonly version: string
  readonly description: string
  readonly repository: string
  readonly repositoryUrl: string
  readonly branch: string
  readonly commit: string
  readonly capabilities: readonly string[]
  readonly state: PluginCatalogState
  readonly reason: string
  readonly installSpec?: string
}

/** One catalog refresh result with an always-available bundled fallback. */
export interface PluginCatalogResult {
  readonly entries: readonly PluginCatalogEntry[]
  readonly source: 'live' | 'bundled'
  readonly message?: string
}

interface IndexedRepository {
  readonly repository: string
  readonly branch: string
  readonly snapshot: {
    readonly commit: string
    readonly packageManifest: Readonly<Record<string, unknown>>
    readonly blueManifest: Readonly<Record<string, unknown>>
  }
}

type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>

async function defaultFetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-blue-plugin-catalog',
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  })
  if (!response.ok) throw new Error(`GitHub responded ${String(response.status)}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('GitHub metadata exceeds the catalog size limit')
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('GitHub metadata exceeds the catalog size limit')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error('GitHub returned invalid catalog JSON')
  }
}

/** Replaceable network seam used only by catalog tests. */
export const pluginCatalogEffects: { fetchJson: FetchJson } = {
  fetchJson: defaultFetchJson,
}

const INDEXED_REPOSITORIES: readonly IndexedRepository[] = Object.freeze([
  Object.freeze({
    repository: 'dsh-blue/blue-doudizhu',
    branch: 'main',
    snapshot: Object.freeze({
      commit: 'fc99a3b0d634b6288ef89bb528d635ced3537932',
      packageManifest: Object.freeze({
        name: '@dsh-blue/blue-doudizhu',
        version: '0.3.0',
        description: 'Blue Doudizhu: a terminal card table with local-model bots, scores, and a card counter.',
        blue: Object.freeze({ manifest: './blue.plugin.json' }),
      }),
      blueManifest: Object.freeze({
        $schema: 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json',
        schemaVersion: 1,
        id: '@dsh-blue/blue-doudizhu',
        entry: '.',
        api: '^1.0.0-beta.1',
        compatibility: Object.freeze({
          blue: '>=0.1.1-rc.2 <0.2.0',
          harness: '>=0.1.1-rc.1 <=0.1.1-rc.2',
          node: '^22.19.0 || >=24.0.0',
        }),
        capabilities: Object.freeze({
          required: Object.freeze([
            Object.freeze({
              name: 'commands',
              version: '^1.0.0',
              resources: Object.freeze({ names: Object.freeze(['poker']) }),
            }),
            Object.freeze({ name: 'overlays', version: '^1.0.0' }),
          ]),
          optional: Object.freeze([
            Object.freeze({ name: 'notifications.publish', version: '^1.0.0' }),
          ]),
        }),
      }),
    }),
  }),
])

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capabilityNames(manifest: BluePluginManifestV1): readonly string[] {
  return Object.freeze([...manifest.capabilities.required, ...manifest.capabilities.optional].map(value => value.name))
}

function canonicalCompatibility(manifest: BluePluginManifestV1): { readonly state: 'compatible' | 'incompatible', readonly reason: string } {
  const rejected: string[] = []
  if (!satisfies(BLUE_API_VERSION, manifest.api, { includePrerelease: true })) rejected.push(`API ${BLUE_API_VERSION}`)
  if (!satisfies(BLUE_VERSION, manifest.compatibility.blue, { includePrerelease: true })) rejected.push(`Blue ${BLUE_VERSION}`)
  if (!satisfies(BLUE_PLUGIN_HARNESS_LINE, manifest.compatibility.harness, { includePrerelease: true })) rejected.push(`Harness ${BLUE_PLUGIN_HARNESS_LINE}`)
  if (!satisfies(process.versions.node, manifest.compatibility.node, { includePrerelease: true })) rejected.push(`Node ${process.versions.node}`)
  return rejected.length === 0
    ? { state: 'compatible', reason: 'canonical manifest compatible' }
    : { state: 'incompatible', reason: `does not accept ${rejected.join(', ')}` }
}

function entryFrom(
  source: IndexedRepository,
  commit: string,
  packageValue: unknown,
  manifestValue: unknown,
): PluginCatalogEntry {
  const repositoryUrl = `https://github.com/${source.repository}`
  const pkg = record(packageValue)
  const distribution = record(manifestValue)
  const packageName = typeof pkg?.name === 'string' ? pkg.name : source.repository
  const version = typeof pkg?.version === 'string' && valid(pkg.version) !== null ? pkg.version : 'unknown'
  const description = typeof pkg?.description === 'string' && pkg.description.trim().length > 0
    ? pkg.description.trim().slice(0, 240)
    : `Plugin from ${repositoryUrl}`
  const base = {
    packageName,
    version,
    description,
    repository: source.repository,
    repositoryUrl,
    branch: source.branch,
    commit,
  }
  if (!COMMIT_PATTERN.test(commit)) return Object.freeze({ ...base, capabilities: Object.freeze([]), state: 'invalid', reason: 'repository did not resolve to a full commit' })
  const blue = record(pkg?.blue)
  if (blue?.manifest !== './blue.plugin.json') return Object.freeze({ ...base, capabilities: Object.freeze([]), state: 'invalid', reason: 'package.json must point to ./blue.plugin.json' })
  if (distribution === undefined) return Object.freeze({ ...base, capabilities: Object.freeze([]), state: 'invalid', reason: 'blue.plugin.json is not an object' })
  if (distribution.id !== packageName) return Object.freeze({ ...base, capabilities: Object.freeze([]), state: 'invalid', reason: 'manifest id differs from package name' })
  if (!Object.hasOwn(distribution, '$schema')) {
    const legacy = validateBlueManifest(distribution as unknown as BluePluginManifest)
    const capabilities = Array.isArray(distribution.capabilities)
      ? Object.freeze(distribution.capabilities.filter((value): value is string => typeof value === 'string'))
      : Object.freeze([])
    return Object.freeze({
      ...base,
      capabilities,
      state: legacy.ok ? 'needs-migration' : 'invalid',
      reason: legacy.ok
        ? 'legacy manifest; canonical P1 manifest and runtime open are required'
        : legacy.message,
    })
  }
  const parsed = validateBluePluginManifestV1(distribution)
  if (!parsed.ok) return Object.freeze({
    ...base,
    capabilities: Object.freeze([]),
    state: 'invalid',
    reason: parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
  })
  const compatibility = canonicalCompatibility(parsed.value)
  return Object.freeze({
    ...base,
    capabilities: capabilityNames(parsed.value),
    ...compatibility,
    ...(compatibility.state === 'compatible' ? { installSpec: `github:${source.repository}#${commit}` } : {}),
  })
}

function bundledEntries(): readonly PluginCatalogEntry[] {
  return Object.freeze(INDEXED_REPOSITORIES.map(source => entryFrom(
    source,
    source.snapshot.commit,
    source.snapshot.packageManifest,
    source.snapshot.blueManifest,
  )))
}

async function liveEntry(source: IndexedRepository, signal: AbortSignal): Promise<PluginCatalogEntry> {
  const commitValue = record(await pluginCatalogEffects.fetchJson(
    `https://api.github.com/repos/${source.repository}/commits/${source.branch}`,
    signal,
  ))
  const commit = typeof commitValue?.sha === 'string' ? commitValue.sha : ''
  if (!COMMIT_PATTERN.test(commit)) throw new Error(`${source.repository} returned no full commit`)
  const raw = `https://raw.githubusercontent.com/${source.repository}/${commit}`
  const [packageManifest, blueManifest] = await Promise.all([
    pluginCatalogEffects.fetchJson(`${raw}/package.json`, signal),
    pluginCatalogEffects.fetchJson(`${raw}/blue.plugin.json`, signal),
  ])
  return entryFrom(source, commit, packageManifest, blueManifest)
}

/** Return the last release-vetted catalog without performing network I/O. */
export function bundledPluginCatalog(): PluginCatalogResult {
  return Object.freeze({ entries: bundledEntries(), source: 'bundled' })
}

/**
 * Refresh every indexed GitHub repository while retaining its bundled row on
 * failure. Abort is propagated so a closed panel never receives late state.
 * @param signal - panel lifetime signal.
 * @returns immutable live or fallback catalog result.
 */
export async function refreshPluginCatalog(signal: AbortSignal): Promise<PluginCatalogResult> {
  const fallback = bundledEntries()
  const errors: string[] = []
  const entries = await Promise.all(INDEXED_REPOSITORIES.map(async (source, index) => {
    try {
      return await liveEntry(source, signal)
    } catch (error) {
      if (signal.aborted) throw error
      errors.push(`${source.repository}: ${message(error)}`)
      return fallback[index]!
    }
  }))
  return Object.freeze({
    entries: Object.freeze(entries),
    source: errors.length === 0 ? 'live' : 'bundled',
    ...(errors.length === 0 ? {} : { message: errors.join('; ') }),
  })
}

/** Test-only access to deterministic admission and network helpers. */
export const pluginCatalogInternals = {
  entryFrom,
  repositories: INDEXED_REPOSITORIES,
  defaultFetchJson,
}
