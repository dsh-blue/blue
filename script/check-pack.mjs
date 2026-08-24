/**
 * Build the seven publishable tarballs once and verify their consumer-facing
 * contract. The resulting .artifacts/pack/index.json is also the release
 * workflow's immutable publish input.
 *
 * @module script/check-pack
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { x as extractTar } from 'tar'
import { PACKAGE_DIRS, ROOT, readManifest } from './package-contract.mjs'

const outDir = resolve(process.env.BLUE_PACK_DIR ?? join(ROOT, '.artifacts', 'pack'))
const unpackDir = join(outDir, 'unpacked')
const problems = []
const records = []
let libraryFiles = 0
let libraryBytes = 0

rmSync(outDir, { recursive: true, force: true })
mkdirSync(unpackDir, { recursive: true })

function fail(message) {
  problems.push(message)
}

function parsePackOutput(output, packageName) {
  const start = output.indexOf('{')
  if (start < 0) throw new Error(`${packageName}: pnpm pack returned no JSON`)
  return JSON.parse(output.slice(start))
}

function walk(dir, prefix = '') {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const stat = statSync(full)
    if (stat.isDirectory()) files.push(...walk(full, relative))
    else files.push({ path: relative, size: stat.size })
  }
  return files
}

function runtimeTarget(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.default === 'string') return value.default
  return undefined
}

function validateManifest(name, manifest, root) {
  for (const tableName of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [dependency, spec] of Object.entries(manifest[tableName] ?? {})) {
      if (typeof spec === 'string' && /^(workspace|link|file):/.test(spec)) fail(`${name}: packed ${tableName}.${dependency} leaked ${spec}`)
      if (dependency.startsWith('@dsh-blue/') && spec !== manifest.version) {
        fail(`${name}: packed ${tableName}.${dependency} must equal ${manifest.version}, got ${spec}`)
      }
    }
  }
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    const target = runtimeTarget(value)
    if (target !== undefined && !target.includes('*') && !existsSync(join(root, target.replace(/^\.\//, '')))) {
      fail(`${name}: packed export ${subpath} targets missing ${target}`)
    }
    if (value !== null && typeof value === 'object' && typeof value.types === 'string' && !existsSync(join(root, value.types.replace(/^\.\//, '')))) {
      fail(`${name}: packed export ${subpath} types target is missing`)
    }
  }
  const bins = typeof manifest.bin === 'string' ? { [name]: manifest.bin } : manifest.bin ?? {}
  for (const [binName, target] of Object.entries(bins)) {
    const full = join(root, target)
    if (!existsSync(full)) fail(`${name}: bin ${binName} targets missing ${target}`)
    else {
      const text = readFileSync(full, 'utf8')
      if (!text.startsWith('#!/usr/bin/env node\n')) fail(`${name}: bin ${binName} has no Node shebang`)
      if ((statSync(full).mode & 0o111) === 0) fail(`${name}: bin ${binName} is not executable`)
    }
  }
}

for (const relativeDir of PACKAGE_DIRS) {
  const sourceManifest = readManifest(relativeDir)
  const output = execFileSync('pnpm', ['--filter', sourceManifest.name, 'pack', '--json', '--pack-destination', outDir], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const packed = parsePackOutput(output, sourceManifest.name)
  const tarball = resolve(packed.filename)
  const packageRoot = join(unpackDir, sourceManifest.name.replace(/[^a-z0-9]+/gi, '-'))
  mkdirSync(packageRoot, { recursive: true })
  await extractTar({ file: tarball, cwd: packageRoot, strip: 1 })
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  validateManifest(sourceManifest.name, manifest, packageRoot)

  const files = walk(packageRoot)
  for (const file of files) {
    if (/\.(?:map|ts|tsx)$/.test(file.path) && !file.path.endsWith('.d.ts')) fail(`${sourceManifest.name}: forbidden packed file ${file.path}`)
    if (file.path.startsWith('src/')) fail(`${sourceManifest.name}: source directory leaked into tarball`)
  }
  if (sourceManifest.name === '@dsh-blue/blue-cli') {
    const runtime = files.filter(file => file.path.startsWith('lib/'))
    if (runtime.length !== 1 || runtime[0]?.path !== 'lib/bin.js') fail(`${sourceManifest.name}: lib must contain only lib/bin.js`)
    if ((runtime[0]?.size ?? Infinity) > 30_000) fail(`${sourceManifest.name}: lib/bin.js exceeds the 30 KB budget`)
    const shrinkwrap = join(packageRoot, 'npm-shrinkwrap.json')
    if (!existsSync(shrinkwrap)) fail(`${sourceManifest.name}: npm-shrinkwrap.json is missing`)
    else {
      const lock = JSON.parse(readFileSync(shrinkwrap, 'utf8'))
      if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) fail(`${sourceManifest.name}: shrinkwrap root version is stale`)
      if (lock.packages?.['']?.dependencies?.['@deepseek-ai/dsh'] !== manifest.dependencies?.['@deepseek-ai/dsh']) fail(`${sourceManifest.name}: shrinkwrap dsh pin differs from package.json`)
    }
  } else {
    libraryFiles += files.filter(file => file.path.startsWith('lib/')).length
    libraryBytes += files.filter(file => file.path.startsWith('lib/')).reduce((sum, file) => sum + file.size, 0)
  }

  execFileSync(join(ROOT, 'node_modules', '.bin', 'publint'), ['run', tarball, '--strict'], { cwd: ROOT, stdio: 'inherit' })
  if (sourceManifest.name !== '@dsh-blue/blue-cli') {
    const attwArgs = [tarball, '--profile', 'esm-only', '--quiet']
    if (sourceManifest.name === '@dsh-blue/blue') attwArgs.push('--exclude-entrypoints', './cordis.patch.yml')
    execFileSync('pnpm', ['dlx', '--package', '@arethetypeswrong/cli@0.18.5', 'attw', ...attwArgs], { cwd: ROOT, stdio: 'inherit' })
  }
  records.push({ name: manifest.name, version: manifest.version, filename: basename(tarball), files: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0) })
}

if (libraryFiles > 210) fail(`library lib output has ${libraryFiles} files; budget is 210`)
if (libraryBytes > 1_500_000) fail(`library lib output has ${libraryBytes} bytes; budget is 1500000`)

if (problems.length > 0) {
  console.error(`pack contract failed with ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ libraryFiles, libraryBytes, packages: records }, null, 2)}\n`)
console.log(`pack contract: ${records.length} tarballs; library lib ${libraryFiles} files / ${libraryBytes} bytes`)
