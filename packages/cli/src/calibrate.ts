/**
 * Managed calibration (D50 decision 4): the shell's own version is the
 * bundle version (the version.spec lockstep), and the `blue` profile
 * must carry exactly that. On boot the shell reads the profile's
 * manifest once — installed bundle matching the pin means zero work
 * (the "zero overhead passthrough"), anything else is one
 * `dsh plugin --profile blue add @dsh-blue/blue@<pin>` away. A
 * `link:`/`file:` spec is the dev lane by the three-lane rule
 * (fe8512c): calibration never touches it. There is no `blue upgrade`
 * — upgrading means reinstalling the shell, which moves the pin.
 *
 * @module @dsh-blue/blue-cli/calibrate
 */

import { join } from 'node:path'
import { cliInternals } from './internals.ts'
import { PROFILE } from './translate.ts'

/** The calibration install's deadline (the updater swap's parity). */
const INSTALL_TIMEOUT_MS = 300_000

/** What calibration decided. */
export type CalibrationOutcome =
  | { readonly action: 'current' }
  | { readonly action: 'link-lane', readonly spec: string }
  | { readonly action: 'installed' }
  | { readonly action: 'failed', readonly reason: string }

/** What calibration needs: the pin and the nested host entry. */
export interface CalibrateOptions {
  /** The pinned Blue bundle version (the shell's own manifest version). */
  readonly version: string
  /** The nested dsh CLI entry (see `nestedDsh()`). */
  readonly dshBinJs: string
}

/** `$DSH_HOME` (default `~/.dsh`) — the updater family's resolution. */
export function dshHome(): string {
  const home = cliInternals.env.DSH_HOME
  return home !== undefined && home !== '' ? home : join(cliInternals.homedir(), '.dsh')
}

/** The calibrated profile's workspace root. */
export function blueProfileRoot(): string {
  return join(dshHome(), 'profiles', PROFILE)
}

/**
 * Calibrate the `blue` profile to the pin. Every failure shape returns
 * `{ action: 'failed' }` with a one-line reason — `main` prints it with
 * the manual-install pointer and exits non-zero (D50 decision 4's
 * bootstrap contract).
 * @param options - the pin and the nested host entry.
 * @returns what calibration did.
 */
export async function calibrate(options: CalibrateOptions): Promise<CalibrationOutcome> {
  const root = blueProfileRoot()
  const spec = bundleSpec(root)
  if (spec !== undefined && /^(link|file):/.test(spec)) return { action: 'link-lane', spec }
  if (installedBundleVersion(root) === options.version) return { action: 'current' }
  const install = await cliInternals.spawnOnce(cliInternals.execPath, [
    options.dshBinJs, 'plugin', '--profile', PROFILE, 'add', `@dsh-blue/blue@${options.version}`,
  ], { timeoutMs: INSTALL_TIMEOUT_MS })
  if (install.spawnError !== undefined) return { action: 'failed', reason: install.spawnError }
  if (install.code !== 0) return { action: 'failed', reason: lastLine(install.stderr, install.stdout) }
  if (installedBundleVersion(root) !== options.version) {
    return { action: 'failed', reason: `profile reports @dsh-blue/blue@${installedBundleVersion(root) ?? 'uninstalled'} after install` }
  }
  return { action: 'installed' }
}

/** The profile's `@dsh-blue/blue` dependency spec, when its manifest names one. */
function bundleSpec(root: string): string | undefined {
  const text = cliInternals.readTextFile(join(root, 'package.json'))
  if (text === undefined) return undefined
  try {
    const manifest = JSON.parse(text) as { dependencies?: Record<string, unknown>, devDependencies?: Record<string, unknown> }
    for (const block of [manifest.dependencies, manifest.devDependencies]) {
      const spec = block?.['@dsh-blue/blue']
      if (typeof spec === 'string') return spec
    }
  } catch {
    // A broken manifest reads as "no spec" — the version check below and
    // the install decide what happens next.
  }
  return undefined
}

/** The profile's installed bundle version, `undefined` when absent. */
function installedBundleVersion(root: string): string | undefined {
  const text = cliInternals.readTextFile(join(root, 'node_modules', '@dsh-blue', 'blue', 'package.json'))
  if (text === undefined) return undefined
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' ? version : undefined
  } catch {
    return undefined
  }
}

/** The last non-empty output line, kept to one line for the one-line contract. */
function lastLine(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`.split('\n').map(line => line.trim()).filter(line => line !== '')
  const line = lines[lines.length - 1] ?? 'install failed'
  return line.length > 200 ? `${line.slice(0, 197)}...` : line
}
