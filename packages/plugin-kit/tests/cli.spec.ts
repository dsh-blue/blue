/**
 * Published author CLI dispatch and deterministic package generation tests.
 *
 * @module @dsh-blue/blue-plugin-kit/cli-tests
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLUE_API_VERSION, BLUE_VERSION } from '@dsh-blue/blue-api'
import { BLUE_CAPABILITY_CATALOG_V1 } from '@dsh-blue/blue-api/capabilities/v1'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'
import { BLUE_PLUGIN_USAGE, type AuthorRuntime, runBluePluginCli } from '../src/cli.ts'
import { bluePluginRuntimePath } from '../src/index.ts'
import { BLUE_PLUGIN_HARNESS_LINE, BLUE_PLUGIN_SUPPORTED_HARNESS_LINES } from '../src/index.ts'

registerTempDirCleanup()

interface CliResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
  readonly runtimes: readonly { readonly name: AuthorRuntime, readonly args: readonly string[] }[]
}

async function run(args: readonly string[], runtimeStatus = 0): Promise<CliResult> {
  let stdout = ''
  let stderr = ''
  const runtimes: Array<{ name: AuthorRuntime, args: readonly string[] }> = []
  const status = await runBluePluginCli(args, {
    stdout: value => { stdout += value },
    stderr: value => { stderr += value },
    runRuntime: (name, runtimeArgs) => {
      runtimes.push({ name, args: runtimeArgs })
      return runtimeStatus
    },
  })
  return { status, stdout, stderr, runtimes }
}

describe('runBluePluginCli', () => {
  it('resolves both shipped author runtimes from the package boundary', () => {
    expect(bluePluginRuntimePath('validate')).toBe(resolve(import.meta.dirname, '../runtime/validate.mjs'))
    expect(bluePluginRuntimePath('conformance')).toBe(resolve(import.meta.dirname, '../runtime/conformance.mjs'))
  })

  it('prints help for an empty or explicit help command and rejects unknown commands', async () => {
    for (const args of [[], ['--help'], ['-h']] as const) {
      await expect(run(args)).resolves.toEqual({ status: 0, stdout: '', stderr: BLUE_PLUGIN_USAGE, runtimes: [] })
    }
    await expect(run(['unknown'])).resolves.toEqual({ status: 2, stdout: '', stderr: BLUE_PLUGIN_USAGE, runtimes: [] })
  })

  it('emits the published machine catalog only through the explicit JSON form', async () => {
    const result = await run(['catalog', '--json'])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      productVersion: BLUE_VERSION,
      apiVersion: BLUE_API_VERSION,
      harnessLine: BLUE_PLUGIN_HARNESS_LINE,
      supportedHarnessLines: BLUE_PLUGIN_SUPPORTED_HARNESS_LINES,
      capabilities: BLUE_CAPABILITY_CATALOG_V1,
    })
    expect(result.stderr).toBe('')
    for (const args of [['catalog'], ['catalog', '--json', 'extra'], ['catalog', '--text']] as const) {
      await expect(run(args)).resolves.toMatchObject({ status: 2, stderr: BLUE_PLUGIN_USAGE })
    }
  })

  it('creates the canonical no-build package with split and inline names', async () => {
    for (const inline of [false, true]) {
      const parent = mkdtempTracked(`blue-plugin-kit-create-${inline ? 'inline' : 'split'}-`)
      const directory = join(parent, 'plugin')
      const packageName = inline ? '@scope/inline-plugin' : '@scope/split-plugin'
      const args = inline
        ? ['create', directory, `--name=${packageName}`]
        : ['create', directory, '--name', packageName]
      const result = await run(args)
      expect(result).toEqual({ status: 0, stdout: `${resolve(directory)}\n`, stderr: '', runtimes: [] })
      const manifest = JSON.parse(readFileSync(join(directory, 'blue.plugin.json'), 'utf8'))
      const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      expect(manifest).toMatchObject({ id: packageName, api: `^${BLUE_API_VERSION}`, capabilities: { required: [{ name: 'status' }] } })
      expect(pkg).toMatchObject({ name: packageName, type: 'module', blue: { manifest: './blue.plugin.json' } })
      expect(readFileSync(join(directory, 'cordis.patch.yml'), 'utf8')).toContain(`name: '${packageName}'`)
      expect(readFileSync(join(directory, 'src/index.js'), 'utf8')).toContain("opened.value.api.status?.register")
    }
  })

  it('refuses invalid create arguments, package names, files, and non-empty directories', async () => {
    for (const args of [
      ['create'],
      ['create', 'one', 'two', '--name', '@scope/plugin'],
      ['create', 'one', '--unknown', '--name', '@scope/plugin'],
      ['create', 'one', '--name'],
      ['create', 'one', '--name', '--bad'],
      ['create', 'one', '--name='],
    ]) await expect(run(args)).resolves.toMatchObject({ status: 2, stderr: BLUE_PLUGIN_USAGE })

    const root = mkdtempTracked('blue-plugin-kit-refuse-')
    await expect(run(['create', join(root, 'invalid'), '--name', 'Invalid Name'])).resolves.toMatchObject({
      status: 1,
      stderr: 'blue-plugin create: invalid npm package name: Invalid Name\n',
    })
    const file = join(root, 'file')
    writeFileSync(file, 'occupied')
    await expect(run(['create', file, '--name', '@scope/file'])).resolves.toMatchObject({ status: 1, stderr: expect.stringContaining('directory is not empty') })
    const occupied = join(root, 'occupied')
    mkdirSync(occupied)
    writeFileSync(join(occupied, 'keep'), 'occupied')
    await expect(run(['create', occupied, '--name', '@scope/occupied'])).resolves.toMatchObject({ status: 1, stderr: expect.stringContaining('directory is not empty') })
    const empty = join(root, 'empty')
    mkdirSync(empty)
    await expect(run(['create', empty, '--name', '@scope/empty'])).resolves.toMatchObject({ status: 0 })
  })

  it('dispatches static validation and preserves its exit status', async () => {
    await expect(run(['validate', '/tmp/plugin'], 7)).resolves.toEqual({
      status: 7,
      stdout: '',
      stderr: '',
      runtimes: [{ name: 'validate', args: ['/tmp/plugin'] }],
    })
    for (const args of [['validate'], ['validate', '--bad'], ['validate', 'one', 'two']] as const) {
      await expect(run(args)).resolves.toMatchObject({ status: 2, stderr: BLUE_PLUGIN_USAGE, runtimes: [] })
    }
  })

  it('normalizes conformance to an installed exact-Harness fixture', async () => {
    await expect(run(['conformance', '/tmp/plugin'])).resolves.toMatchObject({
      status: 0,
      runtimes: [{ name: 'conformance', args: ['/tmp/plugin', '--install'] }],
    })
    await expect(run(['conformance', '/tmp/plugin', '--harness-line', '0.1.2-alpha.2'], 3)).resolves.toMatchObject({
      status: 3,
      runtimes: [{ name: 'conformance', args: ['/tmp/plugin', '--install', '--harness-line', '0.1.2-alpha.2'] }],
    })
    for (const args of [
      ['conformance'],
      ['conformance', 'one', 'two'],
      ['conformance', 'one', '--bad'],
      ['conformance', 'one', '--harness-line'],
      ['conformance', 'one', '--harness-line', '--bad'],
      ['conformance', 'one', '--harness-line='],
      ['conformance', 'one', '--harness-line', 'latest'],
      ['conformance', 'one', '--harness-line', '0.1.1-rc.2'],
    ]) await expect(run(args)).resolves.toMatchObject({ status: 2, stderr: BLUE_PLUGIN_USAGE, runtimes: [] })
  })
})
