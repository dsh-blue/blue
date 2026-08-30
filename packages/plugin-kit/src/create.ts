/**
 * Deterministic local-package generator for an accepted Blue prototype.
 *
 * @module @dsh-blue/blue-plugin-kit/create
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import validateNpmPackageName from 'validate-npm-package-name'
import {
  BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
  validateBluePluginManifestV1,
} from '@dsh-blue/blue-api/protocol/v1'
import { getBlueCapabilityDefinition } from '@dsh-blue/blue-api/capabilities/v1'
import { BLUE_API_VERSION, BLUE_VERSION } from '@dsh-blue/blue-api'
import { BLUE_PLUGIN_HARNESS_LINE, BLUE_PLUGIN_PREVIOUS_HARNESS_LINE } from './index.ts'

interface CreateOptions {
  readonly directory: string
  readonly packageName: string
}

type CreateResult =
  | { readonly ok: true, readonly directory: string }
  | { readonly ok: false, readonly message: string }

const HARNESS_RANGE = `>=${BLUE_PLUGIN_PREVIOUS_HARNESS_LINE} <=${BLUE_PLUGIN_HARNESS_LINE}`
const NODE_RANGE = '^22.19.0 || >=24.0.0'
const STATUS_VERSION = getBlueCapabilityDefinition('status')!.version

function write(path: string, value: string): void {
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, { flag: 'wx' })
}

/** Generate one minimal canonical status plugin without overwriting files. */
export function createPluginPackage(options: CreateOptions): CreateResult {
  const nameResult = validateNpmPackageName(options.packageName)
  if (!nameResult.validForNewPackages) return { ok: false, message: `invalid npm package name: ${options.packageName}` }
  const directory = resolve(options.directory)
  if (existsSync(directory) && (!statSync(directory).isDirectory() || readdirSync(directory).length > 0)) {
    return { ok: false, message: `directory is not empty: ${directory}` }
  }

  const manifest = {
    $schema: BLUE_PLUGIN_MANIFEST_SCHEMA_URL,
    schemaVersion: 1,
    id: options.packageName,
    entry: '.',
    api: `^${BLUE_API_VERSION}`,
    compatibility: {
      blue: `>=${BLUE_VERSION} <0.1.2`,
      harness: HARNESS_RANGE,
      node: NODE_RANGE,
    },
    capabilities: {
      required: [{ name: 'status', version: `^${STATUS_VERSION}` }],
      optional: [],
    },
  } as const
  const parsed = validateBluePluginManifestV1(manifest)
  /* v8 ignore next -- constants come from the same published schema/catalog; their drift is covered by API corpus tests. */
  if (!parsed.ok) return { ok: false, message: parsed.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ') }

  mkdirSync(resolve(directory, 'src'), { recursive: true })
  write(resolve(directory, 'package.json'), JSON.stringify({
    name: options.packageName,
    version: '0.1.0',
    type: 'module',
    exports: { '.': './src/index.js' },
    files: ['src', 'blue.plugin.json', 'cordis.patch.yml'],
    blue: { manifest: './blue.plugin.json' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: {
      '@dsh-blue/blue-api': BLUE_VERSION,
      '@dsh-blue/blue-ui': BLUE_VERSION,
    },
    peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' },
  }, null, 2))
  write(resolve(directory, 'blue.plugin.json'), JSON.stringify(manifest, null, 2))
  write(resolve(directory, 'cordis.patch.yml'), `- insert:\n    - id: '${options.packageName}'\n      name: '${options.packageName}'`)
  write(resolve(directory, 'src/index.js'), `/** Renderer-neutral Blue status contribution. @module ${options.packageName} */
import { validateBluePluginManifestV1 } from '@dsh-blue/blue-api/protocol/v1'
import { ui } from '@dsh-blue/blue-ui'
import manifestSource from '../blue.plugin.json' with { type: 'json' }

export const name = '${options.packageName}'
export const inject = ['bluePluginHost']

const parsed = validateBluePluginManifestV1(manifestSource)
if (!parsed.ok) throw new TypeError(\`invalid blue.plugin.json: \${parsed.issues[0]?.message ?? 'unknown issue'}\`)
const manifest = parsed.value

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, manifest)
  if (!opened.ok) return
  const registered = opened.value.api.status?.register({
    id: 'plugin.ready',
    render: () => ui.text('plugin ready', { tone: 'success' }),
  })
  if (registered !== undefined && !registered.ok) ctx.logger.warn(registered.message)
}
`)
  return { ok: true, directory }
}
