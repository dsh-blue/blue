/**
 * Update the Blue release line as one transaction. This command is explicit;
 * normal builds never rewrite versions or user-facing release copy.
 *
 * Usage: pnpm release:version <version>
 * @module script/release-version
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_DIRS, ROOT } from './package-contract.mjs'

const next = process.argv[2]
if (next === undefined || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(next)) throw new Error('usage: release:version <semver>')
const old = JSON.parse(readFileSync(join(ROOT, 'packages/api/package.json'), 'utf8')).version
if (old === next) throw new Error(`release line is already ${next}`)

const manifestDirs = [...PACKAGE_DIRS, 'website']
const files = new Set(manifestDirs.map(dir => join(ROOT, dir, 'package.json')))
files.add(join(ROOT, 'packages/api/src/index.ts'))
files.add(join(ROOT, 'packages/api/tests/api.spec.ts'))
files.add(join(ROOT, 'packages/cli/tests/main.spec.ts'))
files.add(join(ROOT, 'packages/transcript/tests/version.spec.ts'))
for (const file of execFileSync('git', ['ls-files', 'README.md', 'README.zh.md', 'website', 'packages'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n')) {
  if (file === '' || file.includes('docs/history/') || file.includes('docs/release-notes/')) continue
  if (/README(?:\.zh)?\.md$|website\/.*\.md$|packages\/bundle\/blue\/tests\/golden\//.test(file)) files.add(join(ROOT, file))
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  if (text.includes(old)) writeFileSync(file, text.replaceAll(old, next))
}
console.log(`release line: ${old} -> ${next}; updated ${files.size} controlled files`)
