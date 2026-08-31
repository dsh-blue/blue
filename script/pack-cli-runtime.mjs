/**
 * Assemble the pinned Harness host into common and native-target archives for
 * the Blue launcher. The release runner pays dependency resolution once; npm
 * users download and extract only the outer CLI package during installation.
 *
 * @module script/pack-cli-runtime
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { c as createTar } from 'tar'
import { ROOT } from './package-contract.mjs'

const CLI_DIR = join(ROOT, 'packages', 'cli')
const SEED_DIR = join(CLI_DIR, 'runtime')
const HARNESS_LINE = '0.1.2-alpha.2'
const TARGETS = [
  ['linux', 'x64'],
  ['linux', 'arm64'],
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['win32', 'x64'],
  ['win32', 'arm64'],
]

/** Representative native packages required by the six supported targets. */
const PLATFORM_PACKAGES = [
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-arm64',
  '@img/sharp-win32-x64',
  '@koromix/koffi-darwin-arm64',
  '@koromix/koffi-darwin-x64',
  '@koromix/koffi-linux-arm64',
  '@koromix/koffi-linux-x64',
  '@koromix/koffi-win32-arm64',
  '@koromix/koffi-win32-x64',
  '@vscode/ripgrep-darwin-arm64',
  '@vscode/ripgrep-darwin-x64',
  '@vscode/ripgrep-linux-arm64',
  '@vscode/ripgrep-linux-x64',
  '@vscode/ripgrep-win32-arm64',
  '@vscode/ripgrep-win32-x64',
  'node-addon-require-builtin-darwin-arm64',
  'node-addon-require-builtin-darwin-x64',
  'node-addon-require-builtin-linux-arm64-gnu',
  'node-addon-require-builtin-linux-x64-gnu',
  'node-addon-require-builtin-win32-arm64-msvc',
  'node-addon-require-builtin-win32-x64-msvc',
]

/** Resolve a package manifest below one deployed node_modules root. */
function manifestPath(nodeModules, name) {
  return join(nodeModules, ...name.split('/'), 'package.json')
}

/** Every top-level package root in a hoisted node_modules tree. */
function packageRoots(nodeModules) {
  const roots = []
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (!entry.name.startsWith('@')) {
      roots.push(join('node_modules', entry.name))
      continue
    }
    const scope = join(nodeModules, entry.name)
    for (const child of readdirSync(scope, { withFileTypes: true })) {
      if (child.isDirectory()) roots.push(join('node_modules', entry.name, child.name))
    }
  }
  return roots.sort()
}

/** Whether a positive/negative npm platform list admits one value. */
function admits(values, value) {
  if (!Array.isArray(values)) return true
  if (values.includes(`!${value}`)) return false
  const positive = values.filter(item => typeof item === 'string' && !item.startsWith('!'))
  return positive.length === 0 || positive.includes(value)
}

/** Platform restrictions from one installed package manifest. */
function packagePlatform(deployment, relative) {
  const manifest = JSON.parse(readFileSync(join(deployment, relative, 'package.json'), 'utf8'))
  return { cpu: manifest.cpu, libc: manifest.libc, os: manifest.os }
}

/** Write one deterministic internal runtime archive. */
function writeArchive(deployment, filename, paths) {
  const output = join(CLI_DIR, filename)
  rmSync(output, { force: true })
  createTar({
    cwd: deployment,
    file: output,
    gzip: { level: 9 },
    mtime: new Date(0),
    portable: true,
    sync: true,
    strict: true,
  }, paths)
  return statSync(output).size
}

/**
 * Build the immutable runtime payload from the workspace lockfile.
 * @returns payload metadata used by the pack gate.
 */
export async function buildCliRuntime() {
  const deployment = mkdtempSync(join(tmpdir(), 'blue-cli-runtime-deploy-'))
  try {
    for (const filename of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      cpSync(join(SEED_DIR, filename), join(deployment, filename))
    }
    execFileSync('pnpm', [
      'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline',
      '--config.node-linker=hoisted',
      '--config.minimumReleaseAge=0',
    ], { cwd: deployment, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 })

    const nodeModules = join(deployment, 'node_modules')
    const hostManifestPath = manifestPath(nodeModules, '@deepseek-ai/dsh')
    if (!existsSync(hostManifestPath)) throw new Error('deployed runtime is missing @deepseek-ai/dsh')
    const hostManifest = JSON.parse(readFileSync(hostManifestPath, 'utf8'))
    if (hostManifest.version !== HARNESS_LINE) {
      throw new Error(`deployed dsh is ${hostManifest.version ?? 'unknown'}, expected ${HARNESS_LINE}`)
    }
    const missing = PLATFORM_PACKAGES.filter(name => !existsSync(manifestPath(nodeModules, name)))
    if (missing.length > 0) throw new Error(`deployed runtime is missing platform packages: ${missing.join(', ')}`)

    const roots = packageRoots(nodeModules)
    const platformRoots = roots.filter(relative => {
      const platform = packagePlatform(deployment, relative)
      return platform.os !== undefined || platform.cpu !== undefined || platform.libc !== undefined
    })
    const commonRoots = roots.filter(relative => !platformRoots.includes(relative))
    const archives = [{ filename: 'runtime-common.tgz', bytes: writeArchive(deployment, 'runtime-common.tgz', commonRoots) }]
    for (const [os, cpu] of TARGETS) {
      const paths = platformRoots.filter(relative => {
        const platform = packagePlatform(deployment, relative)
        return admits(platform.os, os) && admits(platform.cpu, cpu)
      })
      const filename = `runtime-${os}-${cpu}.tgz`
      archives.push({ filename, bytes: writeArchive(deployment, filename, paths) })
    }
    const bytes = archives.reduce((sum, archive) => sum + archive.bytes, 0)
    console.log(`cli runtime: dsh ${HARNESS_LINE}; ${PLATFORM_PACKAGES.length} platform sentinels; ${archives.length} archives / ${bytes} compressed bytes`)
    return { archives, bytes, harnessVersion: HARNESS_LINE, platformPackages: PLATFORM_PACKAGES.length }
  } finally {
    rmSync(deployment, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildCliRuntime()
