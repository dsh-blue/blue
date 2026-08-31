/**
 * Idempotent registry controller for prebuilt Blue tarballs.
 *
 * Usage: node script/release-packages.mjs publish|verify|promote
 *
 * @module script/release-packages
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_PACKAGE_DIRS, ROOT, readManifest } from './package-contract.mjs'

const mode = process.argv[2]
if (!['publish', 'verify', 'promote'].includes(mode)) throw new Error('usage: release-packages.mjs publish|verify|promote')

const index = JSON.parse(readFileSync(join(ROOT, '.artifacts', 'pack', 'index.json'), 'utf8'))
const packages = index.packages
const expectedNames = RELEASE_PACKAGE_DIRS.map(relativeDir => readManifest(relativeDir).name)
const actualNames = Array.isArray(packages) ? packages.map(pkg => pkg.name) : []
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  throw new Error(`pack index package order mismatch: expected ${expectedNames.join(', ')}, got ${actualNames.join(', ')}`)
}
const versions = new Set(packages.map(pkg => pkg.version))
if (versions.size !== 1) throw new Error(`pack index contains mixed versions: ${[...versions].join(', ')}`)
const version = [...versions][0]
for (const pkg of packages) pkg.filename = join(ROOT, '.artifacts', 'pack', pkg.filename)

function npmView(spec, field) {
  const result = spawnSync('npm', ['view', spec, field, '--json'], { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) return undefined
  const text = result.stdout.trim()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text.replace(/^"|"$/g, '')
  }
}

function localIntegrity(filename) {
  return `sha512-${createHash('sha512').update(readFileSync(filename)).digest('base64')}`
}

async function waitFor(pkg, expectedIntegrity) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const integrity = npmView(`${pkg.name}@${pkg.version}`, 'dist.integrity')
    if (integrity === expectedIntegrity) {
      const attestations = npmView(`${pkg.name}@${pkg.version}`, 'dist.attestations')
      if (attestations === undefined || attestations === null) console.warn(`${pkg.name}@${pkg.version}: npm did not expose dist.attestations; integrity is still verified`)
      console.log(`${pkg.name}@${pkg.version}: registry integrity and provenance verified`)
      return
    }
    if (integrity !== undefined && integrity !== expectedIntegrity) throw new Error(`${pkg.name}@${pkg.version}: registry integrity differs from local tarball`)
    console.log(`${pkg.name}@${pkg.version}: not visible yet (${attempt}/20)`)
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  throw new Error(`${pkg.name}@${pkg.version}: not visible after five minutes`)
}

async function waitForTag(pkg, tag, expectedVersion) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const current = npmView(pkg.name, `dist-tags.${tag}`)
    if (current === expectedVersion) {
      console.log(`${pkg.name}: ${tag} -> ${expectedVersion}`)
      return
    }
    console.log(`${pkg.name}: ${tag} is still ${current ?? 'unset'} (${attempt}/20)`)
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  throw new Error(`${pkg.name}: ${tag} did not converge to ${expectedVersion} after five minutes`)
}

if (mode === 'publish' || mode === 'verify') {
  const publishTag = process.env.RELEASE_TAG ?? (version.includes('-test.') ? 'rc9-test' : 'candidate')
  const testRelease = version.includes('-test.')
  for (const pkg of packages) {
    const expected = localIntegrity(pkg.filename)
    const current = npmView(`${pkg.name}@${pkg.version}`, 'dist.integrity')
    if (current === undefined && mode === 'publish') {
      execFileSync('npm', ['publish', pkg.filename, '--tag', publishTag, '--access', 'public', '--provenance'], { cwd: ROOT, stdio: 'inherit' })
    } else if (current !== undefined && current !== expected && !testRelease) {
      throw new Error(`${pkg.name}@${pkg.version}: immutable registry version has different integrity`)
    } else if (current !== undefined && current !== expected) {
      console.warn(`${pkg.name}@${pkg.version}: test version already exists with a different local tarball; leaving immutable registry content unchanged`)
    } else if (current === undefined) {
      throw new Error(`${pkg.name}@${pkg.version}: version is missing from registry`)
    }
    if (!testRelease) await waitFor(pkg, expected)
  }
  if (testRelease && mode === 'publish') {
    // npm assigns `latest` on a package's first publish even when a custom
    // tag is supplied. Keep production consumers on the previous rc line.
    for (const pkg of packages) {
      const latest = npmView(pkg.name, 'dist-tags.latest')
      if (latest !== version) continue
      const stableRc = npmView(pkg.name, 'dist-tags.rc')
      if (typeof stableRc === 'string' && stableRc !== version) {
        execFileSync('npm', ['dist-tag', 'add', `${pkg.name}@${stableRc}`, 'latest'], { cwd: ROOT, stdio: 'inherit' })
        console.log(`${pkg.name}: restored latest -> ${stableRc}`)
      }
    }
  }
}

if (mode === 'promote') {
  const prereleaseChannel = /-(alpha|rc)(?:\.|$)/.exec(version)?.[1]
  const tags = prereleaseChannel === 'alpha' ? ['alpha'] : prereleaseChannel === 'rc' ? ['rc', 'latest'] : ['latest']
  for (const pkg of packages) {
    for (const tag of tags) {
      const current = npmView(pkg.name, `dist-tags.${tag}`)
      if (current !== version) execFileSync('npm', ['dist-tag', 'add', `${pkg.name}@${version}`, tag], { cwd: ROOT, stdio: 'inherit' })
      await waitForTag(pkg, tag, version)
    }
  }
  for (const pkg of packages) {
    const candidate = npmView(pkg.name, 'dist-tags.candidate')
    if (candidate === version) {
      try {
        execFileSync('npm', ['dist-tag', 'rm', pkg.name, 'candidate'], { cwd: ROOT, stdio: 'inherit' })
      } catch {
        // npm may forbid deleting dist-tags; candidate is harmless after the release tags converge.
        console.warn(`${pkg.name}: candidate cleanup was refused; leaving it at ${version}`)
      }
    }
  }
}
