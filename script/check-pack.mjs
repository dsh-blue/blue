/**
 * Build the eleven publishable tarballs once and verify their consumer-facing
 * contract. The resulting .artifacts/pack/index.json is also the release
 * workflow's immutable publish input.
 *
 * @module script/check-pack
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { x as extractTar } from 'tar'
import { PACKAGE_DIRS, ROOT, readManifest } from './package-contract.mjs'
import { buildCliRuntime } from './pack-cli-runtime.mjs'

const outDir = resolve(process.env.BLUE_PACK_DIR ?? join(ROOT, '.artifacts', 'pack'))
const unpackDir = join(outDir, 'unpacked')
const problems = []
const records = []
const tarballs = new Map()
let libraryFiles = 0
let libraryBytes = 0

rmSync(outDir, { recursive: true, force: true })
mkdirSync(unpackDir, { recursive: true })

const cliRuntime = await buildCliRuntime()

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

function verifyExternalUiKit(apiTarball, uiTarball) {
  if (apiTarball === undefined || uiTarball === undefined) {
    fail('external UI kit fixture requires packed API and UI tarballs')
    return
  }
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'blue-ui-kit-pack-'))
  const kitRoot = join(fixtureRoot, 'kit')
  const consumerRoot = join(fixtureRoot, 'consumer')
  const kitTarballs = join(fixtureRoot, 'tarballs')
  try {
    mkdirSync(join(kitRoot, 'lib', 'types'), { recursive: true })
    mkdirSync(consumerRoot)
    mkdirSync(kitTarballs)
    const version = readManifest('packages/ui').version
    writeFileSync(join(kitRoot, 'package.json'), `${JSON.stringify({
      name: '@blue-pack-fixture/user-kit',
      version,
      type: 'module',
      main: 'lib/index.js',
      types: 'lib/types/index.d.ts',
      exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
      files: ['lib/**/*'],
      peerDependencies: { '@dsh-blue/blue-ui': version },
    }, null, 2)}\n`)
    writeFileSync(join(kitRoot, 'lib', 'index.js'), `
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'
export const metric = defineBlueComponent({
  id: '@blue-pack-fixture/metric',
  api: '^1.0.0',
  render: ({ label, value }) => ui.stack.row([
    ui.text(label),
    ui.progress({ value, max: 100 }),
  ]),
})
`)
    writeFileSync(join(kitRoot, 'lib', 'types', 'index.d.ts'), `
import type { BlueComponentFactory } from '@dsh-blue/blue-ui'
export interface MetricProps { readonly label: string, readonly value: number }
export declare const metric: BlueComponentFactory<MetricProps>
`)
    const packedKit = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', kitTarballs], { cwd: kitRoot, encoding: 'utf8' }))[0]
    const kitTarball = join(kitTarballs, packedKit.filename)
    writeFileSync(join(consumerRoot, 'package.json'), `${JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@dsh-blue/blue-api': `file:${apiTarball}`,
        '@dsh-blue/blue-ui': `file:${uiTarball}`,
        '@blue-pack-fixture/user-kit': `file:${kitTarball}`,
      },
    }, null, 2)}\n`)
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumerRoot, stdio: 'ignore' })
    writeFileSync(join(consumerRoot, 'verify.mjs'), `
import { metric } from '@blue-pack-fixture/user-kit'
const node = metric.render({ label: 'Context', value: 42 })
const text = node.children?.[0]?.node
const progress = node.children?.[1]?.node
if (node.kind !== 'stack' || node.direction !== 'row' || node.children?.length !== 2 ||
    text?.kind !== 'text' || text.content !== 'Context' ||
    progress?.kind !== 'progress' || progress.value !== 42 || progress.max !== 100) {
  throw new Error('external UI kit runtime contract failed')
}
for (const value of [node, node.children, node.children[0], node.children[1], text, progress]) {
  if (!Object.isFrozen(value)) throw new Error('external UI kit result was not deeply frozen')
}
`)
    execFileSync('node', ['verify.mjs'], { cwd: consumerRoot, stdio: 'inherit' })
    writeFileSync(join(consumerRoot, 'verify.ts'), `
import { metric, type MetricProps } from '@blue-pack-fixture/user-kit'
import type { BlueUiNode } from '@dsh-blue/blue-ui'
const props: MetricProps = { label: 'Context', value: 42 }
const node: BlueUiNode = metric.render(props)
void node
`)
    writeFileSync(join(consumerRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2024', strict: true, noEmit: true },
      include: ['verify.ts'],
    }, null, 2)}\n`)
    execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', '.'], { cwd: consumerRoot, stdio: 'inherit' })
    console.log('external UI kit: packed install, runtime, and types passed')
  } catch (error) {
    fail(`external UI kit fixture failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
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
  tarballs.set(sourceManifest.name, tarball)
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
    if ((runtime[0]?.size ?? Infinity) > 400_000) fail(`${sourceManifest.name}: lib/bin.js exceeds the 400 KB budget`)
    if (Object.keys(manifest.dependencies ?? {}).length > 0) fail(`${sourceManifest.name}: launcher must remain dependency-free`)
    const payloads = files.filter(file => /^runtime-(?:common|(?:linux|darwin|win32)-(?:x64|arm64))\.tgz$/.test(file.path))
    if (payloads.length !== cliRuntime.archives.length) fail(`${sourceManifest.name}: expected ${cliRuntime.archives.length} runtime archives, got ${payloads.length}`)
    const payloadBytes = payloads.reduce((sum, file) => sum + file.size, 0)
    if (payloadBytes !== cliRuntime.bytes) fail(`${sourceManifest.name}: runtime archives changed after assembly`)
    if (cliRuntime.bytes > 150_000_000) fail(`${sourceManifest.name}: runtime archives exceed the 150 MB budget`)
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

verifyExternalUiKit(tarballs.get('@dsh-blue/blue-api'), tarballs.get('@dsh-blue/blue-ui'))

if (libraryFiles > 210) fail(`library lib output has ${libraryFiles} files; budget is 210`)
if (libraryBytes > 1_500_000) fail(`library lib output has ${libraryBytes} bytes; budget is 1500000`)

if (problems.length > 0) {
  console.error(`pack contract failed with ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

writeFileSync(join(outDir, 'index.json'), `${JSON.stringify({ libraryFiles, libraryBytes, packages: records }, null, 2)}\n`)
console.log(`pack contract: ${records.length} tarballs; library lib ${libraryFiles} files / ${libraryBytes} bytes`)
