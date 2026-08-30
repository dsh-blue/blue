/**
 * Process-level contract for the machine-readable Blue plugin validator.
 *
 * @module @dsh-blue/blue/tests/plugin-validator
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mkdtempTracked, registerTempDirCleanup } from '../../../core/tests/temp-dir.ts'

registerTempDirCleanup()

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const validator = join(repositoryRoot, 'script/blue-plugin-validate.mjs')
const pluginFixture = join(repositoryRoot, 'script/blue-plugin-fixture.mjs')
const packageImporter = join(repositoryRoot, 'script/import-from-directory.mjs')
const scriptlessPacker = join(repositoryRoot, 'script/pack-without-scripts.mjs')
const fixtureContract = join(repositoryRoot, 'script/plugin-fixture-contract.mjs')

function fixture(name: string, manifest: object, source: string): string {
  const root = mkdtempTracked(name)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'src/index.ts'), source)
  writeFileSync(join(root, 'lib/index.js'), 'export const built = true\n')
  return root
}

function v1Fixture(name: string, distribution: Record<string, unknown>, source = "export const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n"): string {
  const root = mkdtempTracked(name)
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'lib'))
  const entry = typeof distribution.entry === 'string' && (distribution.entry === '.' || distribution.entry.startsWith('./'))
    ? distribution.entry
    : './blue'
  const packageName = typeof distribution.id === 'string' && /^[a-z0-9@]/u.test(distribution.id) && !distribution.id.includes(' ')
    ? distribution.id
    : '@scope/corpus-fixture'
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    exports: { [entry]: './lib/blue.js' },
    files: ['lib/**/*', 'blue.plugin.json'],
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
    blue: { manifest: './blue.plugin.json' },
  }))
  writeFileSync(join(root, 'blue.plugin.json'), JSON.stringify(distribution))
  writeFileSync(join(root, 'src/private-web.ts'), "import React from 'react'\nexport const privateWeb = React\n")
  writeFileSync(join(root, 'lib/blue.js'), source)
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
      'PLUGIN_NAME_UNSTABLE',
      'PACKAGE_EXPORT_TARGET_MISSING',
      'PACKAGE_EXPORT_NOT_SHIPPED',
      'ARCH_RENDERER_BOUNDARY',
      'ARCH_DOMAIN_OBJECT_IMPORT',
      'LIFECYCLE_OWNERSHIP_MISSING',
    ]))
    expect(report.violations[0]).toMatchObject({ package: '@scope/plain', group: expect.any(String), code: expect.any(String), message: expect.any(String), reproduce: expect.stringContaining('blue-plugin-validate.mjs') })
  })

  it('uses the runtime corpus and inspects only the selected public entry closure', () => {
    const corpus = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')) as {
      cases: { id: string, valid: boolean, code?: string, manifest: Record<string, unknown> }[]
    }
    for (const testCase of corpus.cases) {
      const root = v1Fixture(`blue-validator-${testCase.id}-`, testCase.manifest)
      const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
      const report = JSON.parse(result.stdout)
      expect(report.valid, testCase.id).toBe(testCase.valid)
      expect(result.status, testCase.id).toBe(testCase.valid ? 0 : 1)
      expect(report.manifest, testCase.id).toEqual({ discovered: true, valid: testCase.valid })
      if (!testCase.valid) {
        expect(report.violations.map((finding: { code: string }) => finding.code), testCase.id).toContain(testCase.code)
      }
    }
  }, 15_000)

  it('allows ordinary package and Cordis names while enforcing packed entry peers', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-peer-', base, "import value from 'missing-runtime-peer'\nexport const name = 'cordis-name-not-package-name'\nexport function apply(ctx) { ctx.effect(() => () => value) }\n")
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports['./blue'] = { types: './lib/blue.d.ts', default: './lib/blue.js' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    writeFileSync(join(root, 'lib/blue.d.ts'), "export type { LeakedAgent } from './public-types.js'\nexport declare const name: 'cordis-name-not-package-name'\nexport declare function apply(ctx: unknown): void\n")
    writeFileSync(join(root, 'lib/public-types.d.ts'), "export type LeakedAgent = import('@deepseek-ai/dsh-agent').Agent\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_RUNTIME_DEPENDENCY_UNDECLARED', message: expect.stringContaining('missing-runtime-peer') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('public-types.d.ts') }),
    ]))
    expect(report.violations.some((finding: { code: string }) => finding.code === 'PLUGIN_NAME_PACKAGE_MISMATCH')).toBe(false)
    expect(report.violations.some((finding: { message: string }) => finding.message.includes('private-web'))).toBe(false)
  })

  it('matches native ESM conditional export selection', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const nodeRoot = v1Fixture('blue-validator-node-condition-', base)
    const nodePackage = JSON.parse(readFileSync(join(nodeRoot, 'package.json'), 'utf8'))
    nodePackage.exports['./blue'] = { node: './lib/node.cjs', default: './lib/blue.js' }
    writeFileSync(join(nodeRoot, 'package.json'), JSON.stringify(nodePackage))
    writeFileSync(join(nodeRoot, 'lib/node.cjs'), "const React = require('react')\nexports.name = 'node-entry'\nexports.apply = ctx => { ctx.effect(() => () => React) }\n")
    const nodeResult = spawnSync(process.execPath, [validator, nodeRoot], { encoding: 'utf8' })
    const nodeReport = JSON.parse(nodeResult.stdout)
    expect(nodeResult.status).toBe(1)
    expect(nodeReport.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API', message: expect.stringContaining('node.cjs') }),
    ]))

    const importRoot = v1Fixture('blue-validator-import-condition-', base)
    const importPackage = JSON.parse(readFileSync(join(importRoot, 'package.json'), 'utf8'))
    importPackage.exports['./blue'] = { import: './lib/blue.js', require: './lib/require.cjs' }
    writeFileSync(join(importRoot, 'package.json'), JSON.stringify(importPackage))
    writeFileSync(join(importRoot, 'lib/require.cjs'), "require('react')\nmodule.exports = {}\n")
    const importResult = spawnSync(process.execPath, [validator, importRoot], { encoding: 'utf8' })
    expect(importResult.status, importResult.stdout).toBe(0)

    const syncRoot = v1Fixture('blue-validator-module-sync-condition-', base)
    const syncPackage = JSON.parse(readFileSync(join(syncRoot, 'package.json'), 'utf8'))
    syncPackage.exports['./blue'] = { 'module-sync': './lib/module-sync.js', default: './lib/blue.js' }
    syncPackage.peerDependencies.react = '^18.0.0'
    writeFileSync(join(syncRoot, 'package.json'), JSON.stringify(syncPackage))
    writeFileSync(join(syncRoot, 'lib/module-sync.js'), "import React from 'react'\nexport const name = 'module-sync-entry'\nexport function apply(ctx) { ctx.effect(() => () => React) }\n")
    const syncResult = spawnSync(process.execPath, [validator, syncRoot], { encoding: 'utf8' })
    const syncReport = JSON.parse(syncResult.stdout)
    expect(syncResult.status).toBe(1)
    expect(syncReport.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API', message: expect.stringContaining('module-sync.js') }),
    ]))
  })

  it('uses native import conditions from an installed project scope', () => {
    const root = mkdtempTracked('blue-native-import-condition-')
    const packageRoot = join(root, 'node_modules', 'conditional-fixture')
    mkdirSync(packageRoot, { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: 'conditional-fixture',
      version: '1.0.0',
      type: 'module',
      exports: { import: './import.js', require: './require.cjs' },
    }))
    writeFileSync(join(packageRoot, 'import.js'), "export const selected = 'import'\n")
    writeFileSync(join(packageRoot, 'require.cjs'), "module.exports = { selected: 'require' }\n")
    const probe = `import { createPackageImporter } from ${JSON.stringify(pathToFileURL(packageImporter).href)}\nconst load = await createPackageImporter(${JSON.stringify(root)})\nconst value = await load('conditional-fixture')\nconsole.log(value.selected)\n`
    const selected = execFileSync(process.execPath, ['--input-type=module', '--eval', probe], { encoding: 'utf8' })
    expect(selected.trim()).toBe('import')
  })

  it('disables lifecycle scripts when pnpm packs the local fixture closure', () => {
    const root = mkdtempTracked('blue-scriptless-pack-')
    const marker = join(root, 'prepack-ran')
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'blue-scriptless-pack-fixture',
      version: '1.0.0',
      type: 'module',
      files: ['lib'],
      scripts: { prepack: 'node prepack.mjs' },
    }))
    writeFileSync(join(root, 'lib/index.js'), 'export const packed = true\n')
    writeFileSync(join(root, 'prepack.mjs'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'ran')\n`)
    for (const packageManager of ['pnpm', 'npm']) {
      const tarballRoot = join(root, `tarballs-${packageManager}`)
      mkdirSync(tarballRoot)
      const probe = `import { packWithoutScripts } from ${JSON.stringify(pathToFileURL(scriptlessPacker).href)}\nconsole.log(packWithoutScripts(${JSON.stringify(root)}, ${JSON.stringify(tarballRoot)}, ${JSON.stringify(packageManager)}))\n`
      const tarball = execFileSync(process.execPath, ['--input-type=module', '--eval', probe], { encoding: 'utf8' }).trim()
      expect(existsSync(tarball)).toBe(true)
      expect(existsSync(marker), packageManager).toBe(false)
    }
  })

  it('requires every public entry closure file to ship and stay inside the package', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const omittedRoot = v1Fixture(
      'blue-validator-closure-pack-',
      base,
      "import './feature.js'\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n",
    )
    const omittedPackage = JSON.parse(readFileSync(join(omittedRoot, 'package.json'), 'utf8'))
    omittedPackage.files = ['lib/blue.js', 'blue.plugin.json']
    writeFileSync(join(omittedRoot, 'package.json'), JSON.stringify(omittedPackage))
    writeFileSync(join(omittedRoot, 'lib/feature.js'), 'export const feature = true\n')
    const omittedResult = spawnSync(process.execPath, [validator, omittedRoot], { encoding: 'utf8' })
    const omittedReport = JSON.parse(omittedResult.stdout)
    expect(omittedResult.status).toBe(1)
    expect(omittedReport.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_ENTRY_CLOSURE_NOT_PACKED', message: expect.stringContaining('lib/feature.js') }),
    ]))

    const escapedRoot = v1Fixture(
      'blue-validator-closure-escape-',
      base,
      "import './escape.js'\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n",
    )
    const outsideRoot = mkdtempTracked('blue-validator-outside-')
    const outsideFile = join(outsideRoot, 'escape.js')
    writeFileSync(outsideFile, 'export const escaped = true\n')
    symlinkSync(outsideFile, join(escapedRoot, 'lib/escape.js'))
    const escapedResult = spawnSync(process.execPath, [validator, escapedRoot], { encoding: 'utf8' })
    const escapedReport = JSON.parse(escapedResult.stdout)
    expect(escapedResult.status).toBe(1)
    expect(escapedReport.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_ENTRY_CLOSURE_ESCAPE', message: expect.stringContaining('./escape.js') }),
    ]))

    const referenceRoot = v1Fixture('blue-validator-reference-closure-', base)
    const referencePackage = JSON.parse(readFileSync(join(referenceRoot, 'package.json'), 'utf8'))
    referencePackage.exports['./blue'] = { types: './lib/blue.d.ts', default: './lib/blue.js' }
    referencePackage.files = ['lib/blue.js', 'lib/blue.d.ts', 'blue.plugin.json']
    referencePackage.peerDependencies = { '@deepseek-ai/dsh-agent': '^0.1.1-rc.1' }
    writeFileSync(join(referenceRoot, 'package.json'), JSON.stringify(referencePackage))
    writeFileSync(join(referenceRoot, 'lib/blue.d.ts'), '/// <reference path="./public-types.d.ts" />\nexport declare const name: "fixture-entry"\nexport declare function apply(ctx: unknown): void\n')
    writeFileSync(join(referenceRoot, 'lib/public-types.d.ts'), "export type LeakedAgent = import('@deepseek-ai/dsh-agent').Agent\n")
    const referenceResult = spawnSync(process.execPath, [validator, referenceRoot], { encoding: 'utf8' })
    const referenceReport = JSON.parse(referenceResult.stdout)
    expect(referenceResult.status).toBe(1)
    expect(referenceReport.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_ENTRY_CLOSURE_NOT_PACKED', message: expect.stringContaining('public-types.d.ts') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('public-types.d.ts') }),
    ]))
  })

  it('treats declaration reference types as public dependencies and architecture input', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-reference-types-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports['./blue'] = { types: './lib/blue.d.ts', default: './lib/blue.js' }
    packageManifest.peerDependencies = { '@deepseek-ai/dsh-session': '^0.1.1-rc.1' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    writeFileSync(join(root, 'lib/blue.d.ts'), '/// <reference types="missing-type-peer" />\n/// <reference types="@deepseek-ai/dsh-session" />\nexport declare const name: "fixture-entry"\nexport declare function apply(ctx: unknown): void\n')
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_RUNTIME_DEPENDENCY_UNDECLARED', message: expect.stringContaining('missing-type-peer') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('blue.d.ts') }),
    ]))
    expect(report.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_RUNTIME_DEPENDENCY_UNDECLARED', message: expect.stringContaining('@deepseek-ai/dsh-session') }),
    ]))
  })

  it('maps common type directives to their @types package', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-reference-node-types-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports['./blue'] = { types: './lib/blue.d.ts', default: './lib/blue.js' }
    packageManifest.dependencies = { '@types/node': '^22.0.0' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    writeFileSync(join(root, 'lib/blue.d.ts'), '/// <reference types="node" />\nexport declare const name: "fixture-entry"\nexport declare function apply(ctx: unknown): void\n')
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    expect(result.status, result.stdout).toBe(0)
  })

  it('parses comment-separated static imports instead of trusting regex layout', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-comment-import-', base, "const React = require/* comment */('react')\nconst loadAgent = () => import/* comment */('@deepseek-ai/dsh-agent')\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => { void React; void loadAgent }) }\n")
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.peerDependencies = {
      ...packageManifest.peerDependencies,
      react: '^18.0.0',
      '@deepseek-ai/dsh-agent': '^0.1.1-rc.1',
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API', message: expect.stringContaining('blue.js') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('blue.js') }),
    ]))
  })

  it('includes public JavaScript JSDoc import types in the boundary', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-jsdoc-import-', base, "/** @typedef {import('@deepseek-ai/dsh-agent').Agent} LeakedAgent */\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n")
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.peerDependencies['@deepseek-ai/dsh-agent'] = '^0.1.1-rc.1'
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('blue.js') }),
    ]))
  })

  it('does not accept commented plugin exports as runtime shape evidence', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-comment-export-', base, "// export const name = 'spoofed'\n// export function apply(ctx) { ctx.effect(() => () => undefined) }\nexport const other = true\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining([
      'PLUGIN_NAME_UNSTABLE',
      'PLUGIN_APPLY_MISSING',
      'LIFECYCLE_OWNERSHIP_MISSING',
    ]))
  })

  it('fails closed for indirect CommonJS and createRequire loaders', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const cases = [
      {
        name: 'blue-validator-create-require-',
        source: "import { createRequire } from 'node:module'\nconst load = createRequire(import.meta.url)\nconst React = load('react')\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => React) }\n",
        extension: '.js',
      },
      {
        name: 'blue-validator-cjs-comma-require-',
        source: "const React = (0, require)('react')\nexports.name = 'fixture-entry'\nexports.apply = ctx => { ctx.effect(() => () => React) }\n",
        extension: '.cjs',
      },
      {
        name: 'blue-validator-cjs-module-require-',
        source: "const React = module['require']('react')\nexports.name = 'fixture-entry'\nexports.apply = ctx => { ctx.effect(() => () => React) }\n",
        extension: '.cjs',
      },
      {
        name: 'blue-validator-aliased-require-',
        source: "const load = require\nconst React = load('react')\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => React) }\n",
        extension: '.js',
      },
    ]
    for (const entry of cases) {
      const root = v1Fixture(entry.name, base, entry.source)
      const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      packageManifest.peerDependencies.react = '^18.0.0'
      if (entry.extension === '.cjs') packageManifest.exports['./blue'] = `./lib/entry${entry.extension}`
      writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
      if (entry.extension === '.cjs') {
        unlinkSync(join(root, 'lib/blue.js'))
        writeFileSync(join(root, `lib/entry${entry.extension}`), entry.source)
      }
      const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
      const report = JSON.parse(result.stdout)
      expect(result.status, entry.name).toBe(1)
      expect(report.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API' }),
      ]))
    }
  })

  it('requires apply to be statically callable', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-invalid-apply-', base, "export const name = 'fixture-entry'\nexport const apply = 42\nfunction marker(ctx) { ctx.effect(() => () => undefined) }\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_APPLY_INVALID' }),
      expect.objectContaining({ code: 'LIFECYCLE_OWNERSHIP_MISSING' }),
    ]))
  })

  it('does not count unreachable lifecycle markers', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-dead-lifecycle-', base, "export const name = 'fixture-entry'\nexport function apply() {}\nif (false) ({ effect() {} }).effect()\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'LIFECYCLE_OWNERSHIP_MISSING' }),
    ]))
  })

  it('follows lifecycle calls through a reachable local helper', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-reachable-lifecycle-helper-', base, "export const name = 'fixture-entry'\nexport function apply(ctx) { register(ctx)\n  function register(value) { value.effect(() => () => undefined) }\n}\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(0)
    expect(report.lifecycle).toBe(true)
  })

  it('isolates external packed entry stdout from the fixture report', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-fixture-external-stdio-', {
      ...base,
      id: '@fixture/external-stdio',
    }, "console.log('plugin boot noise')\nexport const name = '@fixture/external-stdio'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n")
    const result = spawnSync(process.execPath, [pluginFixture, root, '--install'], { encoding: 'utf8', timeout: 180_000 })
    expect(result.signal).toBeNull()
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report).toMatchObject({
      package: '@fixture/external-stdio',
      fixtureCleaned: true,
      failures: [expect.objectContaining({ scenario: 'plugin.public-entry-packed-load', code: 'FIXTURE_PLUGIN_STDIO' })],
    })
  }, 180_000)

  it('follows exact runtime and declaration self-reference exports', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-self-reference-', base, "import '@acme/full-plugin/private-runtime'\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n")
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports = {
      './blue': { types: './lib/blue.d.ts', default: './lib/blue.js' },
      './private-runtime': './lib/private-runtime.js',
      './private-types': { types: './lib/private-types.d.ts', default: './lib/private-types.js' },
    }
    packageManifest.peerDependencies = {
      ...packageManifest.peerDependencies,
      react: '^18.0.0',
      '@deepseek-ai/dsh-agent': '^0.1.1-rc.1',
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    writeFileSync(join(root, 'lib/blue.d.ts'), "export type { LeakedAgent } from '@acme/full-plugin/private-types'\nexport declare const name: 'fixture-entry'\nexport declare function apply(ctx: unknown): void\n")
    writeFileSync(join(root, 'lib/private-runtime.js'), "import React from 'react'\nexport const leaked = React\n")
    writeFileSync(join(root, 'lib/private-types.js'), 'export const clean = true\n')
    writeFileSync(join(root, 'lib/private-types.d.ts'), "export type LeakedAgent = import('@deepseek-ai/dsh-agent').Agent\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.files).toBe(4)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API', message: expect.stringContaining('private-runtime.js') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('private-types.d.ts') }),
    ]))
  })

  it('discovers adjacent and root declaration targets without an exports types condition', () => {
    const base = structuredClone(JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest) as Record<string, unknown>
    base.entry = '.'
    const root = v1Fixture('blue-validator-inferred-declarations-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.types = 'lib/public.d.ts'
    packageManifest.peerDependencies = {
      ...packageManifest.peerDependencies,
      react: '^18.0.0',
      '@deepseek-ai/dsh-session': '^0.1.1-rc.1',
    }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    writeFileSync(join(root, 'lib/blue.d.ts'), '/// <reference types="react" />\n/// <reference lib="dom" />\nexport declare const adjacent: true\n')
    writeFileSync(join(root, 'lib/public.d.ts'), "export type LeakedSession = import('@deepseek-ai/dsh-session').Session\n")
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ARCH_RENDERER_PUBLIC_API', message: expect.stringContaining('blue.d.ts') }),
      expect.objectContaining({ code: 'ARCH_DOMAIN_OBJECT_IMPORT', message: expect.stringContaining('public.d.ts') }),
    ]))
  })

  it('fails closed for package imports, pattern self-references, absolute imports, and dynamic loads', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-uninspectable-load-', base, "import '#private'\nimport '@acme/full-plugin/features/a'\nimport '/tmp/outside.js'\nconst target = 'react'\nvoid import(target)\nexport const name = 'fixture-entry'\nexport function apply(ctx) { ctx.effect(() => () => undefined) }\n")
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports['./features/*'] = './lib/features/*.js'
    packageManifest.imports = { '#private': './lib/private.js' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    mkdirSync(join(root, 'lib/features'))
    writeFileSync(join(root, 'lib/features/a.js'), 'export const feature = true\n')
    writeFileSync(join(root, 'lib/private.js'), 'export const privateValue = true\n')
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations.map((finding: { code: string }) => finding.code)).toEqual(expect.arrayContaining([
      'PLUGIN_PACKAGE_IMPORTS_UNSUPPORTED',
      'PLUGIN_SELF_REFERENCE_PATTERN_UNSUPPORTED',
      'PLUGIN_ENTRY_CLOSURE_ESCAPE',
      'PLUGIN_DYNAMIC_IMPORT_UNANALYZABLE',
    ]))
  })

  it('requires host-owned Cordis to be a required peer', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-cordis-singleton-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    delete packageManifest.peerDependencies
    packageManifest.dependencies = { '@deepseek-ai/cordis': '4.0.1' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_HOST_SINGLETON_DEPENDENCY_INVALID' }),
      expect.objectContaining({ code: 'PLUGIN_HOST_PEER_MISSING' }),
    ]))

    const incompatibleRoot = v1Fixture('blue-validator-cordis-range-', base)
    const incompatiblePackage = JSON.parse(readFileSync(join(incompatibleRoot, 'package.json'), 'utf8'))
    incompatiblePackage.peerDependencies['@deepseek-ai/cordis'] = '^3.0.0'
    writeFileSync(join(incompatibleRoot, 'package.json'), JSON.stringify(incompatiblePackage))
    const incompatibleResult = spawnSync(process.execPath, [validator, incompatibleRoot], { encoding: 'utf8' })
    expect(incompatibleResult.status).toBe(1)
    expect(JSON.parse(incompatibleResult.stdout).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_HOST_PEER_RANGE_INCOMPATIBLE' }),
    ]))
  })

  it('rejects source special files without blocking or breaking the JSON envelope', () => {
    const root = fixture('blue-validator-fifo-', {
      name: '@dsh-blue/fifo-fixture',
      exports: { '.': './lib/index.js' },
      files: ['lib/**/*'],
    }, "export const name = 'fifo-fixture'\nexport function apply(ctx: { effect(value: () => () => void): void }): void { ctx.effect(() => () => undefined) }\n")
    execFileSync('mkfifo', [join(root, 'src/hang.ts')])
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8', timeout: 2_000 })
    const report = JSON.parse(result.stdout)
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_SOURCE_NOT_REGULAR_FILE', message: expect.stringContaining('src/hang.ts') }),
    ]))

    const packageRoot = mkdtempTracked('blue-validator-package-fifo-')
    execFileSync('mkfifo', [join(packageRoot, 'package.json')])
    const packageResult = spawnSync(process.execPath, [validator, packageRoot], { encoding: 'utf8', timeout: 2_000 })
    expect(packageResult.signal).toBeNull()
    expect(packageResult.status).toBe(2)
    expect(JSON.parse(packageResult.stdout).violations).toEqual([
      expect.objectContaining({ code: 'PACKAGE_MANIFEST_NOT_FILE' }),
    ])
    const fixtureResult = spawnSync(process.execPath, [pluginFixture, packageRoot, '--install'], { encoding: 'utf8', timeout: 2_000 })
    expect(fixtureResult.signal).toBeNull()
    expect(fixtureResult.status).toBe(1)
    expect(JSON.parse(fixtureResult.stdout)).toMatchObject({
      fixtureCleaned: true,
      failures: [{ code: 'FIXTURE_MANIFEST_NOT_FILE' }],
    })

    const manifestRoot = v1Fixture('blue-validator-manifest-fifo-', JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest)
    unlinkSync(join(manifestRoot, 'blue.plugin.json'))
    execFileSync('mkfifo', [join(manifestRoot, 'blue.plugin.json')])
    const manifestResult = spawnSync(process.execPath, [validator, manifestRoot], { encoding: 'utf8', timeout: 2_000 })
    expect(manifestResult.signal).toBeNull()
    expect(manifestResult.status).toBe(1)
    expect(JSON.parse(manifestResult.stdout).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_MANIFEST_NOT_FILE' }),
    ]))
  })

  it('keeps malformed fixture manifests inside a cleaned machine-readable report', () => {
    const root = mkdtempTracked('blue-fixture-invalid-json-')
    writeFileSync(join(root, 'package.json'), '{')
    const result = spawnSync(process.execPath, [pluginFixture, root, '--install'], { encoding: 'utf8', timeout: 5_000 })
    const report = JSON.parse(result.stdout)
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(report).toMatchObject({
      package: root,
      fixtureCleaned: true,
      valid: false,
      failures: [{ package: root, scenario: 'fixture.setup', code: 'FIXTURE_MANIFEST_INVALID_JSON', reproduce: expect.stringContaining('blue-plugin-fixture.mjs') }],
    })
  })

  it('rejects JSON primitives through validator and fixture report envelopes', () => {
    const packageRoot = mkdtempTracked('blue-validator-primitive-package-')
    writeFileSync(join(packageRoot, 'package.json'), 'null')
    const packageResult = spawnSync(process.execPath, [validator, packageRoot], { encoding: 'utf8' })
    expect(packageResult.status).toBe(2)
    expect(packageResult.stderr).toBe('')
    expect(JSON.parse(packageResult.stdout)).toMatchObject({ valid: false, violations: [{ code: 'PACKAGE_MANIFEST_INVALID' }] })

    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const pluginRoot = v1Fixture('blue-validator-primitive-plugin-', base)
    writeFileSync(join(pluginRoot, 'blue.plugin.json'), 'null')
    const pluginResult = spawnSync(process.execPath, [validator, pluginRoot], { encoding: 'utf8' })
    expect(pluginResult.status).toBe(1)
    expect(pluginResult.stderr).toBe('')
    expect(JSON.parse(pluginResult.stdout).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PLUGIN_MANIFEST_INVALID' }),
    ]))

    const fixtureResult = spawnSync(process.execPath, [pluginFixture, packageRoot, '--install'], { encoding: 'utf8', timeout: 5_000 })
    const fixtureReport = JSON.parse(fixtureResult.stdout)
    expect(fixtureResult.status).toBe(1)
    expect(fixtureResult.stderr).toBe('')
    expect(fixtureReport).toMatchObject({
      package: packageRoot,
      fixtureCleaned: true,
      failures: [{ scenario: 'fixture.setup', code: 'FIXTURE_MANIFEST_INVALID' }],
    })
  })

  it('reports the complete installed Harness tree before rejecting line mismatches', () => {
    const root = mkdtempTracked('blue-fixture-fake-tools-')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const fakePnpm = join(bin, 'pnpm')
    writeFileSync(fakePnpm, `#!/usr/bin/env node
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
const destination = args[args.indexOf('--pack-destination') + 1]
const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
mkdirSync(destination, { recursive: true })
writeFileSync(join(destination, String(manifest.name).replace(/[^a-z0-9]+/gi, '-') + '.tgz'), 'fixture')
`)
    const fakeNpm = join(bin, 'npm')
    writeFileSync(fakeNpm, `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const command = process.argv[2]
if (command === 'view') {
  process.stdout.write('{}')
} else if (command === 'install') {
  for (const [name, version] of [['dsh-agent', '0.0.1'], ['dsh-session', '0.0.2']]) {
    const directory = join(process.cwd(), 'node_modules', '@deepseek-ai', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + name, version }))
  }
} else {
  process.exitCode = 2
}
`)
    chmodSync(fakePnpm, 0o755)
    chmodSync(fakeNpm, 0o755)
    const result = spawnSync(process.execPath, [pluginFixture, join(repositoryRoot, 'packages/api'), '--install'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
      timeout: 20_000,
    })
    const report = JSON.parse(result.stdout)
    expect(result.signal).toBeNull()
    expect(result.status).toBe(1)
    expect(report.fixtureCleaned).toBe(true)
    expect(report.harnessPackages).toEqual({
      '@deepseek-ai/dsh-agent': '0.0.1',
      '@deepseek-ai/dsh-session': '0.0.2',
    })
    expect(report.harnessPackageInstances).toHaveLength(2)
    expect(report.failures).toEqual([
      expect.objectContaining({
        scenario: 'fixture.setup',
        code: 'FIXTURE_HARNESS_LINE_MISMATCH',
        message: expect.stringMatching(/dsh-agent[\s\S]*dsh-session/u),
      }),
    ])
  })

  it('uses production dependency fields for local closure and summarizes every Harness instance', async () => {
    const contract = await import(pathToFileURL(fixtureContract).href) as {
      collectLocalPackageClosure(initialNames: Iterable<string>, hasPackage: (name: string) => boolean, readManifest: (name: string) => object): string[]
      summarizeHarnessPackageInstances(instances: { name: string, version: string, path: string }[]): Record<string, string | string[]>
    }
    const manifests = new Map<string, object>([
      ['root', { dependencies: { runtime: '*' }, optionalDependencies: { optional: '*' }, peerDependencies: { peer: '*' }, devDependencies: { development: '*' } }],
      ['runtime', {}],
      ['optional', {}],
      ['peer', {}],
      ['development', {}],
    ])
    expect(contract.collectLocalPackageClosure(['root'], name => manifests.has(name), name => manifests.get(name) ?? {})).toEqual([
      'root',
      'runtime',
      'optional',
      'peer',
    ])
    expect(contract.summarizeHarnessPackageInstances([
      { name: '@deepseek-ai/dsh-agent', version: '0.1.1-rc.1', path: 'node_modules/a' },
      { name: '@deepseek-ai/dsh-agent', version: '0.1.1-rc.2', path: 'node_modules/b' },
      { name: '@deepseek-ai/dsh-session', version: '0.1.1-rc.2', path: 'node_modules/c' },
    ])).toEqual({
      '@deepseek-ai/dsh-agent': ['0.1.1-rc.1', '0.1.1-rc.2'],
      '@deepseek-ai/dsh-session': '0.1.1-rc.2',
    })
  })

  it('keeps invalid declaration targets inside the JSON report envelope', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-types-directory-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.exports['./blue'] = { types: './lib/types', default: './lib/blue.js' }
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    mkdirSync(join(root, 'lib/types'))
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(report.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PACKAGE_EXPORT_TYPES_TARGET_NOT_FILE', message: expect.stringContaining('./lib/types') }),
    ]))
  })

  it('defers complex files globs to npm pack truth', () => {
    const base = JSON.parse(readFileSync(join(repositoryRoot, 'packages/api/schema/blue.plugin.v1.corpus.json'), 'utf8')).cases[1].manifest as Record<string, unknown>
    const root = v1Fixture('blue-validator-complex-files-', base)
    const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    packageManifest.files = ['lib/blu[e].js', 'blue.plugin.json']
    writeFileSync(join(root, 'package.json'), JSON.stringify(packageManifest))
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    expect(result.status, result.stdout).toBe(0)
  })

  it('reports a missing manifest through the same JSON envelope', () => {
    const root = mkdtempTracked('blue-validator-empty-')
    const result = spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ valid: false, violations: [{ code: 'PACKAGE_MANIFEST_MISSING' }] })
  })
})
