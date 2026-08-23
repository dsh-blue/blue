#!/usr/bin/env node
// ensure-loader-entries.mjs — keep a dsh profile bootable when the Blue
// bundle patch references harness packages by name.
//
// The cordis loader imports every patch entry from the profile root, and the
// global dsh CLI bundles only the packages dsh-base needs. Any patch entry
// outside that closure must resolve from the profile's own node_modules or
// boot dies with ERR_MODULE_NOT_FOUND (first hit: dsh-session-title-all-
// prompts-llm, S30). Entries the CLI already carries are deliberately left
// alone — installing them here as well would duplicate the module across the
// CLI and profile stores (the S28 cross-store Symbol lesson).
//
// Usage: ensure-loader-entries.mjs <bundle-pkg-dir> <profile-dir> <dsh-bin>
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const [bundleDir, profileDir, dshBin] = process.argv.slice(2)

const patch = readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(bundleDir, 'package.json'), 'utf8'))
const versions = {
  ...manifest.dependencies,
  ...manifest.peerDependencies,
  ...manifest.devDependencies,
}

// Loader entries the patch names by package (`name: '@deepseek-ai/…'`),
// pinned somewhere in the bundle manifest.
const referenced = [...patch.matchAll(/name: '(@deepseek-ai\/[a-z0-9-]+)'/g)]
  .map(match => match[1])
  .filter(id => versions[id] !== undefined)

// Walk up from the real dsh bin to the CLI package root (the directory whose
// node_modules carries its bundled dependencies). A plain-name dshBin is
// resolved through PATH first — readlink on a bare name would otherwise
// canonicalize against the caller's cwd and probe the wrong tree.
const onPath = dshBin.includes('/') ? dshBin : execFileSync(
  'bash', ['-c', `command -v ${JSON.stringify(dshBin)}`], { encoding: 'utf8' },
).trim()
const realBin = execFileSync('readlink', ['-f', onPath], { encoding: 'utf8' }).trim()
let cliRoot = dirname(realBin)
for (let i = 0; i < 5 && !existsSync(join(cliRoot, 'node_modules', '@deepseek-ai')); i++) {
  cliRoot = dirname(cliRoot)
}
if (!existsSync(join(cliRoot, 'node_modules', '@deepseek-ai'))) {
  console.error(`error: could not locate the dsh CLI package root from '${realBin}' — set DSH_BIN to the dsh binary's absolute path`)
  process.exit(1)
}
const cliRequire = createRequire(join(cliRoot, 'probe.cjs'))

const pkgPath = join(profileDir, 'package.json')
const profile = JSON.parse(readFileSync(pkgPath, 'utf8'))
const added = []
for (const id of referenced) {
  if (profile.dependencies[id] !== undefined) continue
  try {
    cliRequire.resolve(id)
    continue // the CLI bundles it; a profile copy would be a second instance
  } catch { /* not bundled — the profile must carry it */ }
  profile.dependencies[id] = versions[id]
  added.push(`${id}@${versions[id]}`)
}
if (added.length > 0) writeFileSync(pkgPath, JSON.stringify(profile, null, 2) + '\n')
console.log(added.length === 0
  ? '  profile already resolves every patch loader entry'
  : `  added to profile: ${added.join(', ')}`)
