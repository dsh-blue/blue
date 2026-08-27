/**
 * Stable manifest and capability contracts for Blue Cordis plugins.
 *
 * @module @dsh-blue/blue-api/manifest
 */

/** Capabilities a plugin may request from the Blue host. */
export type BlueCapability =
  | 'commands'
  | 'status'
  | 'tools'
  | 'dock'
  | 'editor'
  | 'panels'
  | 'notifications'
  | 'session.read'
  | 'session.act'

/** A plugin's static compatibility declaration. */
export interface BluePluginManifest {
  readonly id: string
  readonly api: string
  readonly capabilities: readonly BlueCapability[]
  /** Versioned on-disk manifest format. Omitted for legacy inline manifests. */
  readonly schemaVersion?: 1
  /** Published package entry, relative to the package root. */
  readonly entry?: string
  /** Blue, Harness, and Node compatibility ranges for distribution. */
  readonly blue?: string
  readonly harness?: string
  readonly node?: string
  /** Optional npm/GitHub tarball integrity recorded by the installer. */
  readonly integrity?: string
}

/** Public definition consumed by the Cordis adapter in a later phase. */
export interface BluePluginDefinition {
  readonly manifest: BluePluginManifest
  readonly apply: (api: unknown) => void | Promise<void>
}

/** Stable manifest validation failures. */
export type BlueManifestErrorCode =
  | 'BLUE_INVALID_MANIFEST'
  | 'BLUE_UNSUPPORTED_MANIFEST_VERSION'
  | 'BLUE_INVALID_PLUGIN_ID'
  | 'BLUE_INVALID_API_RANGE'
  | 'BLUE_INVALID_COMPATIBILITY_RANGE'
  | 'BLUE_INVALID_ENTRY'
  | 'BLUE_INVALID_INTEGRITY'
  | 'BLUE_INVALID_CAPABILITY'
  | 'BLUE_DUPLICATE_CAPABILITY'

/** Structured validation result. */
export type BlueManifestResult =
  | { readonly ok: true }
  | { readonly ok: false, readonly code: BlueManifestErrorCode, readonly message: string }

const ID_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const RANGE_PATTERN = /^[~^=<>*0-9xX|.\-+\s]+$/
const CAPABILITIES = new Set<BlueCapability>([
  'commands', 'status', 'tools', 'dock', 'editor', 'panels',
  'notifications', 'session.read', 'session.act',
])

/** Validate a manifest without executing plugin code. */
export function validateBlueManifest(manifest: BluePluginManifest): BlueManifestResult {
  if (manifest === null || typeof manifest !== 'object') {
    return { ok: false, code: 'BLUE_INVALID_MANIFEST', message: 'manifest must be an object' }
  }
  if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id)) {
    return { ok: false, code: 'BLUE_INVALID_PLUGIN_ID', message: 'plugin id must be a namespaced lowercase identifier' }
  }
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    return { ok: false, code: 'BLUE_UNSUPPORTED_MANIFEST_VERSION', message: 'manifest schemaVersion must be 1' }
  }
  if (typeof manifest.api !== 'string' || manifest.api.trim().length === 0 || !RANGE_PATTERN.test(manifest.api)) {
    return { ok: false, code: 'BLUE_INVALID_API_RANGE', message: 'plugin api must be a semver-compatible range' }
  }
  for (const [field, value] of [['blue', manifest.blue], ['harness', manifest.harness], ['node', manifest.node]] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0 || !RANGE_PATTERN.test(value))) {
      return { ok: false, code: 'BLUE_INVALID_COMPATIBILITY_RANGE', message: `${field} must be a semver-compatible range` }
    }
  }
  if (manifest.entry !== undefined && (typeof manifest.entry !== 'string' || !/^\.\/(?:(?:lib|dist)\/[^/]+|index)\.m?js$/u.test(manifest.entry))) {
    return { ok: false, code: 'BLUE_INVALID_ENTRY', message: 'entry must be a relative index.js, lib/, or dist/ ESM file' }
  }
  if (manifest.integrity !== undefined && (typeof manifest.integrity !== 'string' || !/^sha(?:256|384|512)-[A-Za-z0-9+/=_-]+$/u.test(manifest.integrity))) {
    return { ok: false, code: 'BLUE_INVALID_INTEGRITY', message: 'integrity must be a sha256, sha384, or sha512 digest' }
  }
  if (!Array.isArray(manifest.capabilities)) {
    return { ok: false, code: 'BLUE_INVALID_MANIFEST', message: 'capabilities must be an array' }
  }
  const capabilities = new Set<string>()
  for (const capability of manifest.capabilities) {
    if (typeof capability !== 'string' || !CAPABILITIES.has(capability as BlueCapability)) {
      return { ok: false, code: 'BLUE_INVALID_CAPABILITY', message: `unknown capability "${String(capability)}"` }
    }
    if (capabilities.has(capability)) {
      return { ok: false, code: 'BLUE_DUPLICATE_CAPABILITY', message: `capability "${capability}" is repeated` }
    }
    capabilities.add(capability)
  }
  return { ok: true }
}
