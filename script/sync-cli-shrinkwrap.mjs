/**
 * Resolve the CLI host graph in an isolated npm project and commit the result
 * as a publishable shrinkwrap. Running npm inside packages/cli is forbidden:
 * its pnpm node_modules symlink would be recorded as link:true.
 *
 * @module script/sync-cli-shrinkwrap
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, readManifest } from './package-contract.mjs'

const cliDir = join(ROOT, 'packages', 'cli')
const manifest = readManifest('packages/cli')
const temp = mkdtempSync(join(tmpdir(), 'blue-cli-shrinkwrap-'))

try {
  writeFileSync(join(temp, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false'], {
    cwd: temp,
    stdio: 'inherit',
  })
  execFileSync('npm', ['shrinkwrap', '--workspaces=false'], { cwd: temp, stdio: 'inherit' })
  const text = readFileSync(join(temp, 'npm-shrinkwrap.json'), 'utf8')
  const lock = JSON.parse(text)
  const packages = Object.entries(lock.packages ?? {})
  if (packages.length < 100) throw new Error(`resolved only ${packages.length} package records; expected the complete dsh host graph`)
  for (const [path, record] of packages) {
    if (record.link === true || (typeof record.resolved === 'string' && /^(?:file:|\.\.?[/\\])/.test(record.resolved))) {
      throw new Error(`non-publishable shrinkwrap entry ${path}: ${record.resolved ?? 'link:true'}`)
    }
  }
  writeFileSync(join(cliDir, 'npm-shrinkwrap.json'), text)
  console.log(`CLI shrinkwrap: ${packages.length} package records for ${manifest.dependencies['@deepseek-ai/dsh']}`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}

