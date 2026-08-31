/** Repository verification planner and agent-document drift tests. @module script/tests/repository-workflow */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { auditAgentDocs } from '../check-agent-docs.mjs'
import { classifyChanges, isStructuralBuildPath, owningPackage, promoteToFull } from '../test-impact.mjs'

describe('change impact planning', () => {
  test('CLI entry points accept pnpm argument separators', () => {
    const verify = execFileSync(process.execPath, [
      'script/verify-changed.mjs', '--plan', '--', '--files-json', '[]',
    ], { encoding: 'utf8' })
    assert.equal(JSON.parse(verify).mode, 'none')
    const build = execFileSync(process.execPath, [
      'script/build-changed.mjs', '--', '--files-json', '[]',
    ], { encoding: 'utf8' })
    assert.match(build, /no runtime package source changed/u)
  })

  test('fails closed when the requested comparison base is invalid', () => {
    assert.throws(() => execFileSync(process.execPath, [
      'script/verify-changed.mjs', '--plan', '--base', 'refs/heads/does-not-exist',
    ], { encoding: 'utf8', stdio: 'pipe' }))
  })

  test('keeps documentation-only edits out of Vitest', () => {
    const plan = classifyChanges(['packages/core/AGENTS.md'])
    assert.equal(plan.mode, 'changed')
    assert.equal(plan.checks.agentDocs, true)
    assert.deepEqual(plan.tests.related, [])
  })

  test('builds Website documentation without selecting runtime tests', () => {
    const plan = classifyChanges(['website/guide/index.md'])
    assert.equal(plan.mode, 'changed')
    assert.equal(plan.checks.website, true)
    assert.equal(plan.checks.build, false)
    assert.deepEqual(plan.tests.related, [])
  })

  test('routes retired skill documentation through the agent drift gate', () => {
    const plan = classifyChanges(['docs/skills/plugin-validation.md'])
    assert.equal(plan.checks.agentDocs, true)
    assert.deepEqual(plan.tests.related, [])
  })

  test('selects related coverage for an ordinary leaf implementation', () => {
    const plan = classifyChanges(['packages/frontend/src/locale.ts'])
    assert.equal(plan.mode, 'changed')
    assert.equal(plan.checks.build, true)
    assert.deepEqual(plan.tests.coverage, ['packages/frontend/src/locale.ts'])
    assert.deepEqual(plan.tests.related, ['packages/frontend/src/locale.ts'])
  })

  test('adds width and lifecycle package gates where required', () => {
    const renderer = classifyChanges(['packages/transcript/src/tool-card.ts'])
    assert.ok(renderer.tests.direct.includes('packages/transcript/tests/width-scan.spec.ts'))
    const lifecycle = classifyChanges(['packages/frontend/src/provider-host.ts'])
    assert.ok(lifecycle.tests.packageTests.includes('packages/frontend/tests'))
    const userKit = classifyChanges(['examples/blue-user-kit/src/index.ts'])
    assert.ok(userKit.tests.direct.includes('examples/blue-user-kit/tests/width-scan.spec.ts'))
  })

  test('widens public contracts and global configuration to full', () => {
    assert.equal(classifyChanges(['packages/api/src/index.ts']).mode, 'full')
    assert.equal(classifyChanges(['vitest.config.ts']).mode, 'full')
  })

  test('routes package metadata through build and validation', () => {
    const plan = classifyChanges(['packages/context/package.json'])
    assert.equal(plan.checks.build, true)
    assert.equal(plan.checks.checkLib, true)
    assert.deepEqual(plan.validatePackages, ['packages/context'])
    const plugin = classifyChanges(['examples/header/blue.plugin.json'])
    assert.deepEqual(plugin.validatePackages, ['examples/header'])
  })

  test('widens executable compositions and verifies shipped presets', () => {
    assert.equal(classifyChanges(['packages/bundle/blue/cordis.patch.yml']).mode, 'full')
    const preset = classifyChanges(['packages/bundle/blue/presets/blue-cordis/preset.yml'])
    assert.equal(preset.checks.authorDocs, true)
    assert.equal(preset.checks.build, true)
    assert.ok(preset.tests.direct.includes('packages/bundle/blue/tests/presets.spec.ts'))
  })

  test('recognizes every package manifest shape as structural', () => {
    assert.equal(isStructuralBuildPath('packages/core/package.json'), true)
    assert.equal(isStructuralBuildPath('packages/bundle/blue/package.json'), true)
    assert.equal(isStructuralBuildPath('examples/header/package.json'), true)
  })

  test('preserves checks when later paths do not require lint', () => {
    const plan = classifyChanges(['packages/frontend/src/locale.ts', 'script/test-impact.mjs'])
    assert.equal(plan.checks.lint, true)
  })

  test('promotes all deterministic checks without mutating the source plan', () => {
    const changed = classifyChanges(['packages/frontend/AGENTS.md'])
    const full = promoteToFull(changed, 'test')
    assert.equal(changed.mode, 'changed')
    assert.equal(full.mode, 'full')
    assert.equal(full.checks.build, true)
  })

  test('recognizes nested bundle package ownership', () => {
    assert.equal(owningPackage('packages/bundle/blue/src/index.ts'), 'packages/bundle/blue')
  })
})

describe('agent documentation drift', () => {
  const roots = []
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  function fixture(agent) {
    const root = mkdtempSync(join(tmpdir(), 'blue-agent-docs-'))
    roots.push(root)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {
      'verify:changed': '',
      'verify:full': '',
      'check:agent-docs': '',
      'website:preview:lan': '',
    } }))
    writeFileSync(join(root, 'AGENTS.md'), agent)
    return root
  }

  test('accepts durable instructions without project skills', () => {
    const root = fixture([
      'Use `pnpm run verify:changed`, `pnpm run verify:full`, and `pnpm run check:agent-docs`.',
      'Use `pnpm run website:preview:lan` for Website acceptance.',
      'Documentation-only changes do not require a Blue profile.',
      'Profile handoff includes a change-specific acceptance checklist.',
      '',
    ].join('\n'))
    assert.deepEqual(auditAgentDocs(root, { packageDirs: [], checkPreset: false }), [])
  })

  test('rejects expiring snapshots, dead links, and project skills', () => {
    const root = fixture('As of 2026-01-01, 10 passed. [missing](./missing.md)\nverify:changed verify:full check:agent-docs website:preview:lan\nDocumentation-only changes do not require a Blue profile. Include a change-specific acceptance checklist.\n')
    mkdirSync(join(root, '.agents', 'skills', 'old'), { recursive: true })
    writeFileSync(join(root, '.agents', 'skills', 'old', 'SKILL.md'), '---\nname: old\n---\n')
    const problems = auditAgentDocs(root, { packageDirs: [], checkPreset: false })
    assert.ok(problems.some(problem => problem.includes('expiring verification snapshot')))
    assert.ok(problems.some(problem => problem.includes('dead link')))
    assert.ok(problems.some(problem => problem.includes('.agents/skills')))
  })

  test('rejects prerelease literals outside the maintained version set', () => {
    const root = fixture('Use verify:changed verify:full check:agent-docs website:preview:lan. Documentation-only changes do not require a Blue profile. Include a change-specific acceptance checklist. Old `0.1.1-rc.9`.\n')
    const problems = auditAgentDocs(root, { packageDirs: [], checkPreset: false, allowedVersions: ['1.0.0-beta.1'] })
    assert.ok(problems.some(problem => problem.includes('stale prerelease 0.1.1-rc.9')))
  })
})
