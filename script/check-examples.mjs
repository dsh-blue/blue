#!/usr/bin/env node
/** Run static and current/previous packed gates for the ecosystem examples. @module script/check-examples */
import { execFileSync } from 'node:child_process'
import { ECOSYSTEM_PACKAGE_DIRS, ROOT } from './package-contract.mjs'
import { harnessLine } from './smoke-lib.mjs'

const previousHarnessLine = '0.1.1-rc.1'
const scenarios = [
  'user-kit.public-component',
  'header.pane-lifecycle',
  'right-inspector.pane-lifecycle',
  'bottom-log.pane-lifecycle',
  'overlay.gesture-and-late-containment',
  'status-provider.inert-candidate',
  'editor-provider.one-control-candidate',
  'composition.owner-late-durable-replay',
]
const pluginCapabilities = {
  '@dsh-blue-example/header': ['panes'],
  '@dsh-blue-example/right-inspector': ['panes'],
  '@dsh-blue-example/bottom-log': ['panes'],
  '@dsh-blue-example/overlay': ['commands', 'overlays'],
  '@dsh-blue-example/status-provider': ['status.provider'],
  '@dsh-blue-example/editor-provider': ['editor.provider'],
}

function fixtureReport(line) {
  const output = execFileSync(
    process.execPath,
    ['script/blue-examples-fixture.mjs', '--install', '--harness-line', line],
    { cwd: ROOT, encoding: 'utf8' },
  )
  const report = JSON.parse(output)
  if (report.harnessLine !== line) throw new Error(`fixture reported Harness ${String(report.harnessLine)}, expected ${line}`)
  if (JSON.stringify(report.declared) !== JSON.stringify(scenarios)) throw new Error(`fixture declared scenarios differ on Harness ${line}`)
  if (JSON.stringify(report.executed) !== JSON.stringify(scenarios)) throw new Error(`fixture executed scenarios differ on Harness ${line}`)
  if (report.skipped.length !== 0 || report.failures.length !== 0) throw new Error(`fixture skipped or failed scenarios on Harness ${line}`)
  if (!report.fixtureCleaned || !report.cleaned) throw new Error(`fixture cleanup was incomplete on Harness ${line}`)
  const packages = Object.entries(report.harnessPackages)
  if (packages.length === 0 || packages.some(([, version]) => version !== line)) throw new Error(`fixture resolved a mismatched Harness package on ${line}`)
  if (report.hostPeer?.name !== '@dsh-blue/blue' || report.hostPeer.declared !== report.hostPeer.installed || !report.hostPeer.packed) throw new Error(`fixture did not prove the packed Blue host peer on Harness ${line}`)
  if (JSON.stringify(report.pluginCapabilities) !== JSON.stringify(pluginCapabilities)) throw new Error(`fixture capability evidence differs on Harness ${line}`)
  if (!report.valid) throw new Error(`fixture reported invalid on Harness ${line}`)
  process.stdout.write(output)
}

for (const directory of ECOSYSTEM_PACKAGE_DIRS) {
  execFileSync(process.execPath, ['script/blue-plugin-validate.mjs', directory], { cwd: ROOT, stdio: 'inherit' })
}
for (const line of [harnessLine, previousHarnessLine]) {
  if (line === undefined) throw new Error('current Harness line is unavailable')
  fixtureReport(line)
}
