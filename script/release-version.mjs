/**
 * Update the Blue release line without touching the independent Harness line.
 * Package manifests and the product/protocol map are structured data; source
 * constants and advertised Website versions are narrow textual replacements.
 *
 * Usage: pnpm release:version <version>
 * @module script/release-version
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_DIRS, ROOT } from './package-contract.mjs'

const next = process.argv[2]
if (next === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) throw new Error('usage: release:version <semver>')
const apiManifestPath = join(ROOT, 'packages/api/package.json')
const old = JSON.parse(readFileSync(apiManifestPath, 'utf8')).version
if (old === next) throw new Error(`release line is already ${next}`)

for (const directory of [...PACKAGE_DIRS, 'website']) {
  const path = join(ROOT, directory, 'package.json')
  const source = readFileSync(path, 'utf8')
  const updated = source.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`)
  if (updated === source) throw new Error(`${directory}/package.json: top-level version not found`)
  writeFileSync(path, updated)
}

const schemaPath = join(ROOT, 'packages/api/schema/blue.plugin.v1.schema.json')
const schemaSource = readFileSync(schemaPath, 'utf8')
const schema = JSON.parse(schemaSource)
const protocol = schema['x-blue-protocol-version']
const previousMapping = `    ${JSON.stringify(old)}: ${JSON.stringify(protocol)}`
if (!schemaSource.includes(previousMapping)) throw new Error(`schema product mapping is missing ${old}`)
writeFileSync(schemaPath, schemaSource.replace(previousMapping, `${previousMapping},\n    ${JSON.stringify(next)}: ${JSON.stringify(protocol)}`))

const replacements = new Map([
  ['packages/api/src/index.ts', [`BLUE_VERSION = '${old}'`, `BLUE_VERSION = '${next}'`]],
  ['packages/api/tests/api.spec.ts', [`expect(BLUE_VERSION).toBe('${old}')`, `expect(BLUE_VERSION).toBe('${next}')`]],
  ['packages/cli/tests/main.spec.ts', [`const PIN = '${old}'`, `const PIN = '${next}'`]],
  ['packages/cli/tests/runtime.spec.ts', [`const VERSION = '${old}'`, `const VERSION = '${next}'`]],
  ['packages/transcript/tests/version.spec.ts', [`const RELEASE_VERSION = '${old}'`, `const RELEASE_VERSION = '${next}'`]],
])
for (const [relativePath, [from, to]] of replacements) {
  const path = join(ROOT, relativePath)
  const source = readFileSync(path, 'utf8')
  if (!source.includes(from)) throw new Error(`${relativePath}: release marker not found: ${from}`)
  writeFileSync(path, source.replace(from, to))
}

for (const relativePath of ['website/index.md', 'website/en/index.md', 'website/guide/faq.md', 'website/en/guide/index.md']) {
  const path = join(ROOT, relativePath)
  const source = readFileSync(path, 'utf8')
  writeFileSync(path, source.replaceAll(`v${old}`, `v${next}`).replaceAll(`@dsh-blue/blue@${old}`, `@dsh-blue/blue@${next}`))
}

console.log(`release line: ${old} -> ${next}; updated ${PACKAGE_DIRS.length} packages, Website, constants, and product mapping`)
