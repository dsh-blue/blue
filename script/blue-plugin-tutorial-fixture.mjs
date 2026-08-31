/**
 * Generate the Website tutorial package through the built author bin, then
 * close static and supported-Harness packed conformance gates.
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
  if (typeof catalog.harnessLine !== 'string' || !Array.isArray(catalog.supportedHarnessLines) ||
      catalog.supportedHarnessLines.length !== 1 || catalog.supportedHarnessLines[0] !== catalog.harnessLine) {
    throw new Error('author catalog does not declare exactly one supported Harness line')
  }
  run(['create', pluginRoot, '--name', '@dsh-blue-tutorial/status'])
  const validation = JSON.parse(run(['validate', pluginRoot]))
  if (validation.valid !== true || validation.package !== '@dsh-blue-tutorial/status') {
    throw new Error(`tutorial validation failed: ${JSON.stringify(validation)}`)
  }
  for (const line of catalog.supportedHarnessLines) {
    const report = JSON.parse(run(['conformance', pluginRoot, '--harness-line', line]))
    assertReport(report, line)
  }
  console.log(`tutorial fixture: generated, validated, and packed on Harness ${catalog.harnessLine}`)
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}
