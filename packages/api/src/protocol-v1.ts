/**
 * Versioned distribution manifest contract for Blue frontend plugins.
 *
 * @module @dsh-blue/blue-api/protocol-v1
 */

import Ajv2020, { type AnySchema, type ErrorObject } from 'ajv/dist/2020.js'
import { validRange } from 'semver'
import validateNpmPackageName from 'validate-npm-package-name'
import {
  BLUE_PLUGIN_CAPABILITIES_V1,
  BLUE_PLUGIN_MANIFEST_V1_SCHEMA_SOURCE,
  BLUE_PLUGIN_PROTOCOL_VERSION,
  BLUE_PRODUCT_PROTOCOL_VERSIONS_SOURCE,
  type BluePluginCapabilityNameV1,
  type BluePluginCapabilityRequestV1,
  type BluePluginCompatibilityV1,
  type BluePluginManifestV1,
  type BluePluginManifestSchemaV1,
} from './manifest-v1.generated.ts'

export {
  BLUE_PLUGIN_CAPABILITIES_V1,
  BLUE_PLUGIN_PROTOCOL_VERSION,
  type BluePluginCapabilityNameV1,
  type BluePluginCapabilityRequestV1,
  type BluePluginCompatibilityV1,
  type BluePluginManifestV1,
  type BluePluginManifestSchemaV1,
}

/** The only manifest schema version accepted by this protocol subpath. */
export const BLUE_PLUGIN_MANIFEST_SCHEMA_VERSION = 1

/** Canonical immutable schema URL used by author manifests. */
export const BLUE_PLUGIN_MANIFEST_SCHEMA_URL = 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json'

/** Exact product releases and the plugin protocol each one exposes. */
export const BLUE_PRODUCT_PROTOCOL_VERSIONS = deepFreeze({
  ...BLUE_PRODUCT_PROTOCOL_VERSIONS_SOURCE,
} as const)

/** A stable manifest validation failure. */
export type BluePluginManifestV1IssueCode =
  | 'BLUE_PLUGIN_MANIFEST_SCHEMA_INVALID'
  | 'BLUE_PLUGIN_MANIFEST_DUPLICATE_CAPABILITY'

/** One deterministic validation issue. */
export interface BluePluginManifestV1Issue {
  readonly code: BluePluginManifestV1IssueCode
  readonly path: string
  readonly message: string
}

/** Parsed immutable manifest or its complete validation issue list. */
export type BluePluginManifestV1Result =
  | { readonly ok: true, readonly value: BluePluginManifestV1 }
  | { readonly ok: false, readonly issues: readonly BluePluginManifestV1Issue[] }

function deepFreeze<Value extends object>(value: Value): Value {
  for (const child of Object.values(value)) {
    if (typeof child === 'object') deepFreeze(child as object)
  }
  return Object.freeze(value)
}

function isNpmPackageName(value: string): boolean {
  return validateNpmPackageName(value).validForNewPackages
}

function isPackageExportSubpath(value: string): boolean {
  return value === '.' || /^\.\/[A-Za-z0-9](?:[A-Za-z0-9._@-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._@-]*)*$/u.test(value)
}

function isSemverRange(value: string): boolean {
  return value.trim().length > 0 && validRange(value, { loose: false }) !== null
}

const schema = deepFreeze(BLUE_PLUGIN_MANIFEST_V1_SCHEMA_SOURCE)

/** Deeply immutable canonical Draft 2020-12 schema. */
export const BLUE_PLUGIN_MANIFEST_V1_SCHEMA = schema

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true })
ajv.addKeyword({ keyword: 'x-blue-protocol-version', schemaType: 'string', valid: true })
ajv.addKeyword({ keyword: 'x-blue-product-versions', schemaType: 'object', valid: true })
ajv.addFormat('npm-package-name', { type: 'string', validate: isNpmPackageName })
ajv.addFormat('package-export-subpath', { type: 'string', validate: isPackageExportSubpath })
ajv.addFormat('semver-range', { type: 'string', validate: isSemverRange })
const validateSchema = ajv.compile(structuredClone(schema) as AnySchema)

function schemaIssue(error: ErrorObject): BluePluginManifestV1Issue {
  const path = error.instancePath === '' ? '/' : error.instancePath
  return Object.freeze({
    code: 'BLUE_PLUGIN_MANIFEST_SCHEMA_INVALID',
    path,
    message: `${error.keyword}: ${String(error.message)}`,
  })
}

/**
 * Parse and freeze a v1 distribution manifest without executing plugin code.
 *
 * @param value - Untrusted JSON-shaped manifest input.
 * @returns The immutable manifest or stable schema/semantic issues.
 */
export function validateBluePluginManifestV1(value: unknown): BluePluginManifestV1Result {
  if (!validateSchema(value)) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze(validateSchema.errors!.map(schemaIssue)),
    })
  }

  const manifest = value as BluePluginManifestV1
  const seen = new Set<BluePluginCapabilityNameV1>()
  for (const [group, capabilities] of Object.entries(manifest.capabilities) as [
    'required' | 'optional',
    readonly BluePluginCapabilityRequestV1[],
  ][]) {
    for (const capability of capabilities) {
      if (seen.has(capability.name)) {
        return Object.freeze({
          ok: false,
          issues: Object.freeze([Object.freeze({
            code: 'BLUE_PLUGIN_MANIFEST_DUPLICATE_CAPABILITY',
            path: `/capabilities/${group}`,
            message: `capability "${capability.name}" is declared more than once`,
          })]),
        })
      }
      seen.add(capability.name)
    }
  }

  return Object.freeze({ ok: true, value: deepFreeze(structuredClone(manifest)) })
}
