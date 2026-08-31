#!/usr/bin/env node
/** Execute the smallest fail-closed repository gate justified by a change set. @module script/verify-changed */

import { spawnSync } from 'node:child_process'
import { collectChangedFiles, collectDeletedFiles, defaultBase } from './change-files.mjs'
import { classifyChanges, promoteToFull } from './test-impact.mjs'

function parseArgs(argv) {
  const options = { base: undefined, execute: true, forceFull: false, files: undefined, smoke: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--base') options.base = argv[++index]
    else if (value === '--files-json') options.files = JSON.parse(argv[++index] ?? '[]')
    else if (value === '--plan') options.execute = false
    else if (value === '--full') options.forceFull = true
    else if (value === '--smoke') options.smoke = true
    else throw new Error(`unknown argument: ${value}`)
  }
  return options
}

function run(command, args) {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`)
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function runPnpm(...args) {
  run('pnpm', args)
}

function runFull(smoke, website) {
  for (const script of [
    'test:repo-workflow',
    'typecheck',
    'lint',
    'diagrams:check',
    'build',
    'check:lib',
    'check:agent-docs',
    'check:plugin-authoring-docs',
    'fixture:plugin-tutorial',
    'check:examples',
    'test:coverage',
  ]) runPnpm('run', script)
  if (website) runPnpm('run', 'website:build')
  if (smoke) runPnpm('run', 'smoke:happy')
}

function runChanged(plan) {
  if (plan.checks.repoWorkflowTests) runPnpm('run', 'test:repo-workflow')
  if (plan.checks.agentDocs) runPnpm('run', 'check:agent-docs')
  if (plan.checks.lint) {
    const lintFiles = plan.files.filter(file => /^(?:packages|examples)\/.+\.(?:[cm]?ts|tsx)$/u.test(file))
    if (lintFiles.length > 0) runPnpm('exec', 'oxlint', ...lintFiles)
  }
  if (plan.checks.typecheck && !plan.checks.build) runPnpm('run', 'typecheck')
  if (plan.checks.diagrams) runPnpm('run', 'diagrams:check')
  if (plan.checks.website) runPnpm('run', 'website:build')
  if (plan.checks.build) runPnpm('run', 'build:changed', '--', '--files-json', JSON.stringify(plan.files))
  if (plan.checks.authorDocs) runPnpm('run', 'check:plugin-authoring-docs')
  if (plan.checks.checkLib) runPnpm('run', 'check:lib')
  for (const packageDir of plan.validatePackages) run('node', ['script/blue-plugin-validate.mjs', packageDir])

  const coverage = []
  if (plan.tests.coverage.length > 0) {
    coverage.push('--coverage', '--coverage.reporter=text')
    for (const file of plan.tests.coverage) coverage.push('--coverage.include', file)
  }
  if (plan.tests.packageTests.length > 0) {
    const focused = [...new Set([...plan.tests.packageTests, ...plan.tests.direct])]
    runPnpm('exec', 'vitest', 'run', ...focused, ...coverage, '--reporter=dot', '--silent=passed-only')
  } else if (plan.tests.related.length > 0) {
    const related = [...new Set([...plan.tests.related, ...plan.tests.direct])]
    runPnpm('exec', 'vitest', 'related', ...related, '--run', ...coverage, '--reporter=dot', '--silent=passed-only')
  } else if (plan.tests.direct.length > 0) {
    runPnpm('exec', 'vitest', 'run', ...plan.tests.direct, '--reporter=dot', '--silent=passed-only')
  }
}

const options = parseArgs(process.argv.slice(2))
const base = options.base ?? defaultBase()
const files = options.files ?? collectChangedFiles(base)
let plan = classifyChanges(files)
if (options.files === undefined && collectDeletedFiles(base).some(file => /\.(?:[cm]?ts|tsx)$/u.test(file))) {
  plan = promoteToFull(plan, 'deleted TypeScript requires the full gate')
}
if (options.forceFull) plan = promoteToFull(plan, '--full requested')
process.stdout.write(`${JSON.stringify({ base, ...plan }, null, 2)}\n`)
if (!options.execute || plan.mode === 'none') process.exit(0)
if (plan.mode === 'full') runFull(options.smoke, plan.checks.website)
else {
  runChanged(plan)
  if (options.smoke) runPnpm('run', 'smoke:happy')
}
