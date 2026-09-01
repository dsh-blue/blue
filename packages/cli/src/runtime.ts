/**
 * Lazy materialization of the launcher's prepacked Harness runtime. npm only
 * writes compressed runtime layers; the first command that needs dsh expands
 * the current layers into a versioned user cache and later invocations reuse it.
 *
 * @module @dsh-blue/blue-cli/runtime
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './calibrate.ts'
import { cliInternals } from './internals.ts'

/** The Harness line carried inside the runtime archives. */
export const HARNESS_LINE = '0.1.2-alpha.3'

/** A validated runtime ready to execute. */
export interface BundledDsh {
  /** The dsh JavaScript bin entry. */
  readonly binJs: string
  /** The exact packaged Harness version. */
  readonly version: string
}

/** The common and native archives shipped beside the bundled bin. */
function runtimeArchives(platform: string, arch: string): readonly string[] {
  if (!['linux', 'darwin', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error(`unsupported runtime platform: ${platform}-${arch}`)
  }
  return [
    fileURLToPath(new URL('../runtime-common.tgz', import.meta.url)),
    fileURLToPath(new URL(`../runtime-${platform}-${arch}.tgz`, import.meta.url)),
  ]
}

/** Read and validate the dsh manifest below one materialized runtime root. */
function readRuntime(root: string): BundledDsh | undefined {
  const manifestPath = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  const text = cliInternals.readTextFile(manifestPath)
  if (text === undefined) return undefined
  try {
    const manifest = JSON.parse(text) as { version?: unknown, bin?: unknown }
    if (manifest.version !== HARNESS_LINE || manifest.bin === null || typeof manifest.bin !== 'object') return undefined
    const entry = (manifest.bin as Record<string, unknown>).dsh
    if (typeof entry !== 'string') return undefined
    return { binJs: join(dirname(manifestPath), entry), version: HARNESS_LINE }
  } catch {
    return undefined
  }
}

/**
 * Materialize and validate the bundled host, atomically publishing a complete
 * cache directory so concurrent first launches cannot observe half a tree.
 * @param blueVersion - the launcher's exact package version.
 * @returns the nested dsh facts.
 */
export async function bundledDsh(blueVersion: string): Promise<BundledDsh> {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(blueVersion)) throw new Error('launcher manifest has no valid version')
  const cacheParent = join(dshHome(), 'cache', 'blue-cli-runtime')
  const target = join(cacheParent, `${blueVersion}-${HARNESS_LINE}`)
  const current = readRuntime(target)
  if (current !== undefined) return current

  cliInternals.makeDirectory(cacheParent)
  const temporary = cliInternals.makeTempDirectory(join(cacheParent, '.extract-'))
  let published = false
  try {
    for (const archive of runtimeArchives(cliInternals.platform, cliInternals.arch)) {
      await cliInternals.extractRuntimeArchive(archive, temporary)
    }
    const prepared = readRuntime(temporary)
    if (prepared === undefined) throw new Error(`runtime payload does not contain @deepseek-ai/dsh@${HARNESS_LINE}`)
    try {
      cliInternals.renamePath(temporary, target)
      published = true
      return { ...prepared, binJs: prepared.binJs.replace(temporary, target) }
    } catch (error) {
      const winner = readRuntime(target)
      if (winner !== undefined) return winner
      throw error
    }
  } finally {
    if (!published) cliInternals.removeTree(temporary)
  }
}
