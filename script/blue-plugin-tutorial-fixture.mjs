/**
 * Generate the Website tutorial package through the built author bin, then
 * close static and current/previous Harness packed conformance gates.
 *
 * @module script/blue-plugin-tutorial-fixture
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const bin = join(root, 'packages/plugin-kit/lib/bin.js')
const fixtureRoot = mkdtempSync(join(tmpdir(), 'blue-plugin-tutorial-'))
const pluginRoot = join(fixtureRoot, 'blue-status-tutorial')

function run(args) {
  return execFileSync(process.execPath, [bin, ...args], { cwd: fixtureRoot, encoding: 'utf8', timeout: 240_000 })
}

function assertReport(report, line) {
  if (report.valid !== true || report.harnessLine !== line || report.peerResolution !== 'normal' ||
      report.fixtureCleaned !== true || report.skipped?.length !== 0 || report.failures?.length !== 0 ||
      JSON.stringify(report.declared) !== JSON.stringify(report.executed)) {
    throw new Error(`tutorial conformance failed for Harness ${line}: ${JSON.stringify(report)}`)
  }
}

try {
  const catalog = JSON.parse(run(['catalog', '--json']))
  if (typeof catalog.harnessLine !== 'string' || typeof catalog.previousHarnessLine !== 'string') {
    throw new Error('author catalog has no current/previous Harness lines')
  }
  run(['create', pluginRoot, '--name', '@dsh-blue-tutorial/status'])
  const validation = JSON.parse(run(['validate', pluginRoot]))
  if (validation.valid !== true || validation.package !== '@dsh-blue-tutorial/status') {
    throw new Error(`tutorial validation failed: ${JSON.stringify(validation)}`)
  }
  for (const line of [catalog.harnessLine, catalog.previousHarnessLine]) {
    const report = JSON.parse(run(['conformance', pluginRoot, '--harness-line', line]))
    assertReport(report, line)
  }
  console.log(`tutorial fixture: generated, validated, and packed on Harness ${catalog.harnessLine} / ${catalog.previousHarnessLine}`)
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
