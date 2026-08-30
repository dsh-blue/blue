/**
 * Pack a package without executing its lifecycle scripts.
 *
 * @module script/pack-without-scripts
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Pack with npm or pnpm while disabling lifecycle scripts explicitly.
 *
 * @param {string} directory - Package directory to pack.
 * @param {string} destination - Existing tarball output directory.
 * @param {'npm' | 'pnpm'} packageManager - Pack implementation to invoke.
 * @returns {string} Absolute path to the newly created tarball.
 */
export function packWithoutScripts(directory, destination, packageManager) {
  const before = new Set(readdirSync(destination))
  const argumentsList = packageManager === 'pnpm'
    ? ['pack', '--config.ignore-scripts=true', '--pack-destination', destination]
    : ['pack', '--json', '--ignore-scripts', '--pack-destination', destination]
  execFileSync(packageManager, argumentsList, {
    cwd: directory,
    stdio: 'ignore',
  })
  const created = readdirSync(destination).find(name => name.endsWith('.tgz') && !before.has(name))
  if (created === undefined) throw new Error(`no tarball produced for ${directory}`)
  return join(destination, created)
}
