/**
 * Keep only the declaration files reachable from a package's public type
 * exports. TypeScript emits declarations for every source module, but private
 * declarations are not consumer-facing artifacts and needlessly inflate the
 * published tarball.
 *
 * @module script/prune-types
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BUILD_PACKAGE_DIRS, ROOT, readManifest } from './package-contract.mjs'

/** Recursively collect declaration files below one directory. */
function declarationFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...declarationFiles(full))
    else if (entry.name.endsWith('.d.ts')) files.push(full)
  }
  return files
}

/** Resolve a relative declaration import emitted by TypeScript. */
function resolveDeclaration(from, specifier) {
  if (!specifier.startsWith('.')) return undefined
  const withoutExtension = specifier.replace(/\.(?:d\.)?tsx?$/u, '').replace(/\.m?js$/u, '')
  const target = resolve(dirname(from), `${withoutExtension}.d.ts`)
  return existsSync(target) ? target : undefined
}

for (const relativeDir of BUILD_PACKAGE_DIRS) {
  const packageRoot = join(ROOT, relativeDir)
  const manifest = readManifest(relativeDir)
  const typesRoot = join(packageRoot, 'lib', 'types')
  const files = declarationFiles(typesRoot)
  const roots = []
  if (typeof manifest.types === 'string' && manifest.types.startsWith('./lib/types/')) roots.push(join(packageRoot, manifest.types.slice(2)))
  for (const value of Object.values(manifest.exports ?? {})) {
    const target = value !== null && typeof value === 'object' && typeof value.types === 'string' ? value.types : undefined
    if (target?.startsWith('./lib/types/')) roots.push(join(packageRoot, target.slice(2)))
  }

  const reachable = new Set()
  const queue = [...new Set(roots)]
  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || reachable.has(file) || !existsSync(file)) continue
    reachable.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/["'](\.{1,2}\/[^"']+)["']/gu)) {
      const dependency = resolveDeclaration(file, match[1])
      if (dependency !== undefined) queue.push(dependency)
    }
  }

  for (const file of files) {
    if (!reachable.has(file)) rmSync(file, { force: true })
  }
  const removed = files.length - reachable.size
  if (removed > 0) console.log(`${manifest.name}: pruned ${removed} private declaration file(s)`)
}
