/**
 * Shared package contract for build, pack verification, and release order.
 * Manifests are the source of truth: concrete JavaScript exports and bins map
 * to same-named TypeScript sources, so a new subpath cannot miss the build.
 *
 * @module script/package-contract
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Publish order is dependency order; the launcher is always last. */
export const PACKAGE_DIRS = [
  'packages/api',
  'packages/core',
  'packages/app',
  'packages/transcript',
  'packages/interaction',
  'packages/bundle/blue',
  'packages/cli',
]

/** Read one package manifest. */
export function readManifest(relativeDir) {
  return JSON.parse(readFileSync(join(ROOT, relativeDir, 'package.json'), 'utf8'))
}

/** Return a condition-map export's runtime target. */
function defaultTarget(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.default === 'string') return value.default
  return undefined
}

/** Concrete runtime entries declared by exports and bin. */
export function runtimeEntries(relativeDir, manifest = readManifest(relativeDir)) {
  const entries = new Map()
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    if (subpath.includes('*')) continue
    const target = defaultTarget(value)
    if (target === undefined || !/^\.\/lib\/[^/]+\.js$/.test(target)) continue
    entries.set(target.slice('./lib/'.length, -'.js'.length), target)
  }
  const bins = typeof manifest.bin === 'string' ? { [manifest.name]: manifest.bin } : manifest.bin ?? {}
  for (const target of Object.values(bins)) {
    if (typeof target !== 'string' || !/^lib\/[^/]+\.js$/.test(target)) continue
    entries.set(target.slice('lib/'.length, -'.js'.length), `./${target}`)
  }
  return entries
}

/** tsdown input map derived from the public runtime contract. */
export function sourceEntries(relativeDir, manifest = readManifest(relativeDir)) {
  const inputs = {}
  for (const name of runtimeEntries(relativeDir, manifest).keys()) {
    const source = join(ROOT, relativeDir, 'src', `${name}.ts`)
    if (!existsSync(source)) throw new Error(`${manifest.name}: ${name} is exported/binned but ${source} does not exist`)
    inputs[name] = source
  }
  if (Object.keys(inputs).length === 0) throw new Error(`${manifest.name}: no runtime entries found`)
  return inputs
}

/** Absolute package directory. */
export function packageDir(relativeDir) {
  return join(ROOT, relativeDir)
}
