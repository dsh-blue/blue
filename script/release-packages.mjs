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
import { ROOT } from './package-contract.mjs'

const mode = process.argv[2]
if (!['publish', 'verify', 'promote'].includes(mode)) throw new Error('usage: release-packages.mjs publish|verify|promote')

const index = JSON.parse(readFileSync(join(ROOT, '.artifacts', 'pack', 'index.json'), 'utf8'))
const packages = index.packages
if (!Array.isArray(packages) || packages.length !== 7) throw new Error('pack index must contain exactly seven packages')
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
      if (attestations === undefined || attestations === null) throw new Error(`${pkg.name}@${pkg.version}: provenance attestation is missing`)
      console.log(`${pkg.name}@${pkg.version}: registry integrity and provenance verified`)
      return
    }
    if (integrity !== undefined && integrity !== expectedIntegrity) throw new Error(`${pkg.name}@${pkg.version}: registry integrity differs from local tarball`)
    console.log(`${pkg.name}@${pkg.version}: not visible yet (${attempt}/20)`)
    await new Promise(resolve => setTimeout(resolve, 15_000))
  }
  throw new Error(`${pkg.name}@${pkg.version}: not visible after five minutes`)
}

if (mode === 'publish' || mode === 'verify') {
  for (const pkg of packages) {
    const expected = localIntegrity(pkg.filename)
    const current = npmView(`${pkg.name}@${pkg.version}`, 'dist.integrity')
    if (current === undefined && mode === 'publish') {
      execFileSync('npm', ['publish', pkg.filename, '--tag', 'candidate', '--access', 'public', '--provenance'], { cwd: ROOT, stdio: 'inherit' })
    } else if (current !== undefined && current !== expected) {
      throw new Error(`${pkg.name}@${pkg.version}: immutable registry version has different integrity`)
    } else if (current === undefined) {
      throw new Error(`${pkg.name}@${pkg.version}: version is missing from registry`)
    }
    await waitFor(pkg, expected)
  }
}

if (mode === 'promote') {
  const tags = version.includes('-') ? ['rc', 'latest'] : ['latest']
  for (const pkg of packages) {
    for (const tag of tags) {
      const current = npmView(pkg.name, `dist-tags.${tag}`)
      if (current !== version) execFileSync('npm', ['dist-tag', 'add', `${pkg.name}@${version}`, tag], { cwd: ROOT, stdio: 'inherit' })
      const verified = npmView(pkg.name, `dist-tags.${tag}`)
      if (verified !== version) throw new Error(`${pkg.name}: ${tag} did not converge to ${version}`)
      console.log(`${pkg.name}: ${tag} -> ${version}`)
    }
  }
  for (const pkg of packages) {
    const candidate = npmView(pkg.name, 'dist-tags.candidate')
    if (candidate === version) execFileSync('npm', ['dist-tag', 'rm', pkg.name, 'candidate'], { cwd: ROOT, stdio: 'inherit' })
  }
}
