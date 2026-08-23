/**
 * Process-level contract for the machine-readable Blue plugin validator.
 *
 * @module @dsh-blue/blue/tests/plugin-validator
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../../core/tests/temp-dir.ts'

registerTempDirCleanup()

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const validator = join(repositoryRoot, 'script/blue-plugin-validate.mjs')

function fixture(name: string, manifest: object, source: string): string {
  const root = mkdtempTracked(name)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'src/index.ts'), source)
  writeFileSync(join(root, 'lib/index.js'), 'export const built = true\n')
  return root
}

describe('blue plugin validator script', () => {
  it('emits a stable successful report', () => {
    const root = fixture('blue-validator-good-', {
      name: '@dsh-blue/blue-fixture',
      exports: { '.': './lib/index.js' },
      files: ['lib/**/*'],
    }, "export const name = 'blue-fixture'\nexport const inject = ['service']\nexport function apply(ctx: { effect(value: () => () => void): void }): void { ctx.effect(() => () => undefined) }\n")
    const report = JSON.parse(execFileSync(process.execPath, [validator, root], { encoding: 'utf8' }))
    expect(report).toMatchObject({ package: '@dsh-blue/blue-fixture', valid: true, lifecycle: true, groups: { package: 0, architecture: 0, lifecycle: 0 }, violations: [] })
  })

  it('keeps coded findings and reproduction data on failure', () => {
    const root = fixture('blue-adapter-validator-bad-', {
      name: '@scope/plain',
      exports: { '.': './lib/missing.js' },
      files: ['README.md'],
    }, "import '@earendil-works/pi-tui'\nimport type { Agent } from '@deepseek-ai/dsh-agent'\nexport function apply(_ctx: unknown): void {}\nexport type Kept = Agent\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.valid).toBe(false)
    expect(report.violations.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining([
      'PACKAGE_NAME_INVALID',
      'PLUGIN_NAME_UNSTABLE',
      'PACKAGE_EXPORT_TARGET_MISSING',
      'PACKAGE_EXPORT_NOT_SHIPPED',
      'ARCH_RENDERER_BOUNDARY',
      'ARCH_DOMAIN_OBJECT_IMPORT',
      'LIFECYCLE_OWNERSHIP_MISSING',
    ]))
    expect(report.violations[0]).toMatchObject({ package: '@scope/plain', group: expect.any(String), code: expect.any(String), message: expect.any(String), reproduce: expect.stringContaining('blue-plugin-validate.mjs') })
  })

  it('reports a missing manifest through the same JSON envelope', () => {
    const root = mkdtempTracked('blue-validator-empty-')
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false, violations: [{ code: 'PACKAGE_MANIFEST_MISSING' }] })
  })
})
