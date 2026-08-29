#!/usr/bin/env node
/**
 * Generate the public TypeScript manifest contract from the canonical v1
 * JSON Schema. The schema remains the only hand-edited shape.
 *
 * @module script/generate-blue-plugin-contract
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const schemaPath = resolve(root, 'packages/api/schema/blue.plugin.v1.schema.json')
const corpusPath = resolve(root, 'packages/api/schema/blue.plugin.v1.corpus.json')
const outputPath = resolve(root, 'packages/api/src/manifest-v1.generated.ts')
const websiteSchemaPath = resolve(root, 'website/public/schema/blue.plugin.v1.schema.json')
const websiteCorpusPath = resolve(root, 'website/public/schema/blue.plugin.v1.corpus.json')
const check = process.argv.includes('--check')
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))

function fail(message) {
  throw new Error(`blue plugin contract generation failed: ${message}`)
}

function definition(name) {
  const value = schema.$defs?.[name]
  if (value === undefined) fail(`missing schema definition ${name}`)
  return value
}

function dereference(value) {
  if (typeof value?.$ref !== 'string') return value
  const prefix = '#/$defs/'
  if (!value.$ref.startsWith(prefix)) fail(`unsupported reference ${value.$ref}`)
  return definition(value.$ref.slice(prefix.length))
}

function literal(value) {
  return JSON.stringify(value)
}

function typeOf(value, aliases = new Map()) {
  const alias = typeof value?.$ref === 'string' ? aliases.get(value.$ref) : undefined
  if (alias !== undefined) return alias
  const schemaValue = dereference(value)
  let result
  if (Array.isArray(schemaValue.oneOf)) {
    result = schemaValue.oneOf.map(option => typeOf(option, aliases)).join(' | ')
  }
  else if (schemaValue.const !== undefined) result = literal(schemaValue.const)
  else if (Array.isArray(schemaValue.enum)) result = schemaValue.enum.map(literal).join(' | ')
  else if (schemaValue.type === 'string') result = 'string'
  else if (schemaValue.type === 'array') {
    const item = typeOf(schemaValue.items, aliases)
    result = `readonly ${item.includes(' | ') ? `(${item})` : item}[]`
  }
  else if (schemaValue.type === 'object') {
    const requiredFields = new Set(schemaValue.required ?? [])
    const fields = Object.entries(schemaValue.properties ?? {}).map(([name, property]) =>
      `readonly ${JSON.stringify(name)}${requiredFields.has(name) ? '' : '?'}: ${typeOf(property, aliases)}`,
    )
    result = `{ ${fields.join(', ')} }`
  } else fail(`unsupported schema fragment ${JSON.stringify(schemaValue)}`)
  return result
}

const capabilityRefs = definition('capability').oneOf
if (!Array.isArray(capabilityRefs)) fail('capability.oneOf must be an array')
const capabilities = capabilityRefs.map(reference => {
  const value = dereference(reference)
  const name = value.properties?.name?.const
  if (typeof name !== 'string') fail('every capability must have a literal name')
  return { name, type: typeOf(value) }
})

const stableNames = capabilities.map(value => value.name)
const capabilityType = capabilities.map(value => `  | ${value.type}`).join('\n')
const compatibility = typeOf(definition('compatibility'))
const manifestType = typeOf(schema, new Map([
  ['#/$defs/compatibility', 'BluePluginCompatibilityV1'],
  ['#/$defs/capability', 'BluePluginCapabilityRequestV1'],
]))
const protocolVersion = schema['x-blue-protocol-version']
const productVersions = schema['x-blue-product-versions']
if (typeof protocolVersion !== 'string' || protocolVersion.length === 0) fail('schema protocol version annotation is missing')
if (productVersions === null || typeof productVersions !== 'object' || Array.isArray(productVersions)) fail('schema product version mapping is missing')
if (Object.values(productVersions).some(value => value !== protocolVersion)) fail('every product mapping must select the schema protocol version')
if (corpus.protocol !== protocolVersion) fail('corpus protocol version differs from the schema')
const content = `/**
 * Generated from schema/blue.plugin.v1.schema.json.
 *
 * @module @dsh-blue/blue-api/manifest-v1-generated
 */

/** Protocol version stamped into the canonical manifest schema. */
export const BLUE_PLUGIN_PROTOCOL_VERSION = ${JSON.stringify(protocolVersion)}

/** Product-to-protocol mapping stamped into the canonical manifest schema. */
export const BLUE_PRODUCT_PROTOCOL_VERSIONS_SOURCE = ${JSON.stringify(productVersions, null, 2)} as const

/** Capability names present in the v1 target machine catalog. */
export const BLUE_PLUGIN_CAPABILITIES_V1 = Object.freeze(${JSON.stringify(stableNames)} as const)

/** A capability name in the v1 target catalog. */
export type BluePluginCapabilityNameV1 = typeof BLUE_PLUGIN_CAPABILITIES_V1[number]

/** One required or optional capability request. */
export type BluePluginCapabilityRequestV1 =
${capabilityType}

/** Blue, Harness, and Node compatibility ranges. */
export type BluePluginCompatibilityV1 = ${compatibility}

/** The distribution manifest described by the canonical v1 schema. */
export type BluePluginManifestV1 = ${manifestType}

/** Public type of the canonical schema without expanding every JSON literal. */
export interface BluePluginManifestSchemaV1 extends Readonly<Record<string, unknown>> {
  readonly '$schema': ${JSON.stringify(schema.$schema)}
  readonly '$id': ${JSON.stringify(schema.$id)}
}

/** Canonical Draft 2020-12 schema source consumed by the public runtime. */
export const BLUE_PLUGIN_MANIFEST_V1_SCHEMA_SOURCE: BluePluginManifestSchemaV1 = ${JSON.stringify(schema, null, 2)}
`
const websiteSchema = `${JSON.stringify(schema, null, 2)}\n`
const websiteCorpus = `${JSON.stringify(corpus, null, 2)}\n`

if (check) {
  if (readFileSync(outputPath, 'utf8') !== content) fail('generated TypeScript is stale; run pnpm generate:plugin-contract')
  if (readFileSync(websiteSchemaPath, 'utf8') !== websiteSchema) fail('website schema is stale; run pnpm generate:plugin-contract')
  if (readFileSync(websiteCorpusPath, 'utf8') !== websiteCorpus) fail('website corpus is stale; run pnpm generate:plugin-contract')
} else {
  writeFileSync(outputPath, content)
  mkdirSync(dirname(websiteSchemaPath), { recursive: true })
  writeFileSync(websiteSchemaPath, websiteSchema)
  writeFileSync(websiteCorpusPath, websiteCorpus)
}
