#!/usr/bin/env node
// check-lib-exports.mjs — the lib/export integrity gate (the S30 lesson).
//
// lib/ is git-ignored build output, and three independent manifests claim
// things about it: each package.json's "exports" routes consumers into
// lib/*.js, its "files" whitelist decides what an npm tarball ships, and
// the root tsdown.config.ts entry enumeration decides what tsdown actually
// bundles. Nothing ties the three together — tsc happily emits types for a
// subpath tsdown never bundles, the specs run source-plane (../src/*.ts
// relative imports) so no test ever walks lib/, and a dev profile links
// the source checkout so the files list stays invisible until the first
// publish. Each gap shipped once (S30: ./status-title missed the tsdown
// entry list — every real install boot-crashed — and then missed files/ —
// the tarball gap); this gate makes the three-way sync rule mechanical.
//
// Run after `pnpm build` (CI does, right between build and the test run;
// locally a missing lib/ is an error, never a silent pass). Exits 1 with
// one line per violation.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every workspace package under packages/ carrying an exports map — the
 * lib-producing set (a group directory without package.json is skipped
 * naturally, and future packages join the check without an edit here).
 * @returns the package directory, manifest name, and parsed manifest.
 */
function packagesWithExports() {
  const found = []
  const visit = dir => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue
      const full = join(dir, entry)
      if (!statSync(full).isDirectory()) continue
      const manifestPath = join(full, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.exports !== undefined) found.push({ dir: full, name: manifest.name, manifest })
    }
  }
  visit(join(root, 'packages'))
  visit(join(root, 'examples'))
  return found
}

/**
 * The runtime target of every concrete exports key: the string form
 * directly, the conditions form through its `default`. Wildcard subpaths
 * (`./src/*`) and non-lib targets (`./package.json`) are not lib claims
 * and pass through untouched.
 * @param exports - the package.json exports map.
 * @returns [subpath, relative-target] pairs.
 */
function exportTargets(exports) {
  const pairs = []
  for (const [key, value] of Object.entries(exports)) {
    if (key.includes('*')) continue
    if (typeof value === 'string') {
      pairs.push([key, value])
    } else if (value !== null && typeof value === 'object' && value.default !== undefined) {
      pairs.push([key, value.default])
    }
  }
  return pairs
}

const problems = []
let checked = 0

/**
 * npm files-list matching: a literal entry compares directly, a `**`
 * segment spans directories, and a lone `*` stays within one path segment
 * (the packages mix styles — literal lists, `lib` + `*.js`, and nested
 * `lib` + `types` + `*.d.ts` wildcard shapes).
 * @param entry - one files-list string.
 * @param rel - the lib-relative path to test.
 * @returns whether the entry claims the path.
 */
function filesEntryMatches(entry, rel) {
  if (!entry.includes('*')) return entry === rel
  let pattern = ''
  for (let index = 0; index < entry.length;) {
    if (entry.startsWith('**/', index)) { pattern += '(?:.*/)?'; index += 3; continue }
    if (entry.startsWith('**', index)) { pattern += '.*'; index += 2; continue }
    if (entry[index] === '*') { pattern += '[^/]*'; index += 1; continue }
    pattern += entry[index].replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    index += 1
  }
  return new RegExp(`^${pattern}$`).test(rel)
}

for (const pkg of packagesWithExports()) {
  if (!existsSync(join(pkg.dir, 'lib'))) {
    problems.push(`${pkg.name}: no lib/ — run pnpm build before this check`)
    continue
  }
  const files = pkg.manifest.files ?? []

  // The entry point behind "main" is a lib claim like any export.
  const claims = [...exportTargets(pkg.manifest.exports)]
  if (typeof pkg.manifest.main === 'string') claims.push(['(main)', pkg.manifest.main])

  for (const [subpath, target] of claims) {
    const rel = target.replace(/^\.\//, '')
    if (!rel.startsWith('lib/')) continue
    checked += 1
    if (!existsSync(join(pkg.dir, rel))) {
      problems.push(`${pkg.name} ${subpath}: exports → ${rel} — NOT BUILT (missing from lib/; is it in the root tsdown.config.ts entry list?)`)
      continue
    }
    if (!files.some(entry => filesEntryMatches(entry, rel))) {
      problems.push(`${pkg.name} ${subpath}: exports → ${rel} — not in the files list, so the npm tarball would omit it`)
    }
  }

  // Literal files entries must name real outputs; wildcard entries are
  // patterns, not paths, and verify nothing against the filesystem.
  for (const rel of files) {
    if (!rel.includes('*') && rel.startsWith('lib/') && !existsSync(join(pkg.dir, rel))) {
      problems.push(`${pkg.name}: files lists ${rel} — no such build output`)
    }
  }

  // Reverse direction (the rc.1 lesson): tsdown emits hashed chunks that no
  // exports entry names, so the walk above cannot see them. A files list
  // narrower than the built lib/ ships entry points whose first import is a
  // chunk the tarball never carried, and every real install boot-crashes —
  // a dev-profile link never notices. Every built file must be claimed.
  const walkLib = (dir, prefix) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      const rel = prefix === '' ? entry : `${prefix}/${entry}`
      if (statSync(full).isDirectory()) {
        walkLib(full, rel)
        continue
      }
      if (!files.some(f => filesEntryMatches(f, `lib/${rel}`))) {
        problems.push(`${pkg.name}: built lib/${rel} is not in the files list — the npm tarball would omit it`)
      }
    }
  }
  walkLib(join(pkg.dir, 'lib'), '')
}

if (problems.length > 0) {
  console.error(`✗ lib/export integrity: ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(`✓ lib/export integrity: ${checked} lib claims built and shipped`)
