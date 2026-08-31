#!/usr/bin/env node
/** Incrementally emit declarations and bundle only packages with changed runtime source. @module script/build-changed */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { collectChangedFiles, defaultBase } from './change-files.mjs'
import { BUILD_PACKAGE_DIRS, ROOT, readManifest, runtimeEntries } from './package-contract.mjs'
import { isStructuralBuildPath, normalizeChangedFiles, owningPackage } from './test-impact.mjs'

function run(command, args, env) {
  process.stdout.write(`> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, { stdio: 'inherit', env: env === undefined ? process.env : { ...process.env, ...env } })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

let base
let explicitFiles
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index]
  if (value === '--') continue
  if (value === '--base') base = process.argv[++index]
  else if (value === '--files-json') explicitFiles = JSON.parse(process.argv[++index] ?? '[]')
  else throw new Error(`unknown argument: ${value}`)
}
base ??= defaultBase()
const files = normalizeChangedFiles(explicitFiles ?? collectChangedFiles(base))
if (files.some(isStructuralBuildPath)) {
  run('pnpm', ['run', 'build'])
  process.exit(0)
}

const packages = [...new Set(files
  .filter(file => /^(?:packages|examples)\/.+\/src\/.+\.ts$/u.test(file))
  .map(owningPackage)
  .filter(value => value !== undefined))]
if (files.length === 0) {
  process.stdout.write('build:changed: no runtime package source changed\n')
  process.exit(0)
}

const missingBaseline = BUILD_PACKAGE_DIRS.flatMap(packageDir => [
  ...runtimeEntries(packageDir, readManifest(packageDir)).values(),
].filter(target => !existsSync(join(ROOT, packageDir, target))))
if (missingBaseline.length > 0) {
  process.stdout.write(`build:changed: ${missingBaseline.length} runtime entries are missing; creating a full build baseline\n`)
  run('pnpm', ['run', 'build'])
  process.exit(0)
}

if (packages.length === 0) {
  process.stdout.write('build:changed: no runtime package source changed\n')
  process.exit(0)
}

run('pnpm', ['exec', 'tsc', '-b', 'tsconfig.json'])
run('node', ['script/prune-types.mjs'])
const names = packages.map(packageDir => readManifest(packageDir).name)
process.stdout.write(`build:changed: bundling ${names.join(', ')}\n`)
run('pnpm', ['exec', 'tsdown'], { BLUE_BUILD_PACKAGES: packages.join(',') })
