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
import type { SpawnOutcome } from './internals.ts'
import { PROFILE } from './translate.ts'

/** The calibration install's deadline (the updater swap's parity) — 20 min; slow networks measured at 18 min for 455 packages. */
const INSTALL_TIMEOUT_MS = 1_200_000

/** The pnpm pre-flight's deadline — inconclusive probes never block, they defer to the install's own classification. */
const PNPM_PROBE_TIMEOUT_MS = 30_000

/** The output-tail line budget for failed installs (D56: the failure-form extension). */
const DETAIL_LINES = 6

/** The pnpm-missing verdict — D50④'s suggestion, hoisted for the pre-flight and the install classification to share. */
const PNPM_MISSING_REASON = 'pnpm is missing on PATH — npm i -g pnpm@11 (or: corepack enable pnpm@11)'
const PNPM_VERSION_REASON = 'pnpm 11 is required — npm i -g pnpm@11 (or: corepack enable pnpm@11)'

/** How a failed calibration classifies — `main`'s manual-pointer key (D56). */
export type CalibrationFailureKind = 'pnpm-missing' | 'pnpm-version' | 'timeout' | 'install' | 'verify'

/** What calibration decided. */
export type CalibrationOutcome =
  | { readonly action: 'current' }
  | { readonly action: 'ahead', readonly installed: string }
  | { readonly action: 'link-lane', readonly spec: string }
  | { readonly action: 'installed' }
  | {
      readonly action: 'failed'
      /** One-line verdict, bounded to 200 characters (the D50④ contract's line). */
      readonly reason: string
      /** The failure class — `main` routes the manual pointer on it. */
      readonly kind: CalibrationFailureKind
      /** The last few output lines as context, each bounded, the verdict line excluded; absent when nothing survived. */
      readonly detail?: readonly string[] | undefined
    }

/** What calibration needs: the pin and the nested host entry. */
export interface CalibrateOptions {
  /** The pinned Blue bundle version (the shell's own manifest version). */
  readonly version: string
  /** The nested dsh CLI entry (see `nestedDsh()`). */
  readonly dshBinJs: string
}

/**
 * The pnpm pre-flight's argv per platform (D56): posix spawns `pnpm` directly —
 * dsh's own no-shell semantics there make ENOENT decisive; win32 goes through
 * ComSpec because dsh's `shell: true` resolves through cmd.exe + PATHEXT, and
 * only the same resolution judges corepack shims and standalone installs
 * fairly. The probe proves unreachability, never reachability: whatever it
 * cannot establish defers to the install's own classification.
 * @param platform - the process platform (the `cliInternals` seam).
 * @param comspec - `ComSpec` from the environment, `undefined` when absent.
 * @returns the command to probe `pnpm --version` with.
 */
export function pnpmProbeCommand(platform: string, comspec: string | undefined): { cmd: string, args: readonly string[] } {
  return platform === 'win32'
    ? { cmd: comspec ?? 'cmd.exe', args: ['/d', '/c', 'pnpm', '--version'] }
    : { cmd: 'pnpm', args: ['--version'] }
}

/**
 * Whether a probe outcome *establishes* pnpm unresolvable: on posix only a
 * true ENOENT (an EACCES means present-but-broken — the install reports it
 * better); on win32 only cmd's not-found exit codes (9009 from cmd.exe, 127
 * defensively) with no spawn error — everything inconclusive (probe spawn
 * error, odd exits, timeouts) proceeds and lets the install classify.
 * @param probe - the probe's spawn outcome.
 * @param platform - the process platform (the `cliInternals` seam).
 * @returns whether pnpm is established missing.
 */
export function isPnpmMissing(probe: SpawnOutcome, platform: string): boolean {
  if (platform === 'win32') return probe.spawnError === undefined && (probe.code === 9009 || probe.code === 127)
  return probe.spawnError !== undefined && probe.spawnError.includes('ENOENT')
}

/** Return pnpm's major when its version output is parseable. */
export function pnpmMajor(probe: SpawnOutcome): number | undefined {
  const text = `${probe.stdout}\n${probe.stderr}`.trim()
  const match = /(?:^|\n)\s*(\d+)\./.exec(text)
  return match === null ? undefined : Number(match[1])
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
 * Calibrate the `blue` profile to the pin. Installs run behind a pnpm
 * pre-flight (D56). Every failure shape returns `{ action: 'failed' }` with
 * a one-line reason, a failure class, and an optional bounded output tail —
 * `main` prints the verdict, the tail, and the class's manual pointer, then
 * exits non-zero (D50 decision 4's bootstrap contract, failure form extended
 * by D56).
 * @param options - the pin and the nested host entry.
 * @returns what calibration did.
 */
export async function calibrate(options: CalibrateOptions): Promise<CalibrationOutcome> {
  const root = blueProfileRoot()
  const spec = bundleSpec(root)
  if (spec !== undefined && /^(link|file):/.test(spec)) return { action: 'link-lane', spec }
  const installed = installedBundleVersion(root)
  if (installed === options.version) return { action: 'current' }
  // Direction guard: the profile may have advanced via /update — the shell
  // never downgrades what it does not own the latest word on (reinstalling
  // the shell is the advancing move, D50④).
  if (installed !== undefined && compareVersions(installed, options.version) > 0) {
    return { action: 'ahead', installed }
  }
  // The pnpm pre-flight (D56): dsh's win32 `shell: true` spawn turns a
  // missing pnpm into exit 9009, so its "not found" branch — and the
  // translation below — never fires there. Probing with dsh's own resolution
  // semantics first blocks fast, with zero profile side effects.
  const probeCommand = pnpmProbeCommand(cliInternals.platform, cliInternals.env.ComSpec)
  const probe = await cliInternals.spawnOnce(probeCommand.cmd, probeCommand.args, { timeoutMs: PNPM_PROBE_TIMEOUT_MS })
  if (isPnpmMissing(probe, cliInternals.platform)) {
    return { action: 'failed', reason: PNPM_MISSING_REASON, kind: 'pnpm-missing' }
  }
  const major = pnpmMajor(probe)
  if (major !== undefined && major !== 11) return { action: 'failed', reason: PNPM_VERSION_REASON, kind: 'pnpm-version' }
  const runInstall = (extra: readonly string[]) => cliInternals.spawnOnce(cliInternals.execPath, [
    options.dshBinJs, 'plugin', '--profile', PROFILE, 'add', ...extra, `@dsh-blue/blue@${options.version}`,
  ], { timeoutMs: INSTALL_TIMEOUT_MS })
  let install = await runInstall([])
  if (install.spawnError === undefined && install.code !== 0) {
    // pnpm refuses writes into a workspace root without -w (dsh-TUI's
    // issue #239 class) — the profile IS a workspace root, so retry once
    // with the flag before declaring bootstrap failed.
    if (`${install.stderr}\n${install.stdout}`.includes('ERR_PNPM_ADDING_TO_ROOT')) install = await runInstall(['-w'])
  }
  if (install.spawnError !== undefined) return { action: 'failed', reason: install.spawnError, kind: 'install' }
  if (install.code !== 0) {
    const output = `${install.stderr}\n${install.stdout}`
    if (/pnpm not found/i.test(output) || (cliInternals.platform === 'win32' && install.code === 9009)) {
      return { action: 'failed', reason: PNPM_MISSING_REASON, kind: 'pnpm-missing', detail: tailLines(output, PNPM_MISSING_REASON) }
    }
    if (install.timedOut) {
      const reason = `install timed out after ${INSTALL_TIMEOUT_MS / 60_000} minutes`
      return { action: 'failed', reason, kind: 'timeout', detail: tailLines(output, reason) }
    }
    const reason = lastLine(install.stderr, install.stdout)
    return { action: 'failed', reason, kind: 'install', detail: tailLines(output, reason) }
  }
  if (installedBundleVersion(root) !== options.version) {
    return { action: 'failed', kind: 'verify', reason: `profile reports @dsh-blue/blue@${installedBundleVersion(root) ?? 'uninstalled'} after install` }
  }
  return { action: 'installed' }
}

/**
 * Compare two semver versions, prereleases included: negative when `a` is
 * older, `0` when equal (or unparseable — "cannot order" reads as "do not
 * touch" to the direction guard), positive when newer. The standard
 * prerelease rules: numeric identifiers compare numerically and rank below
 * alphanumeric; a prerelease ranks below its release.
 * @param a - one version string.
 * @param b - the other version string.
 * @returns the ordering of `a` relative to `b`.
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === undefined || pb === undefined) return 0
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  if (pa.pre === null && pb.pre === null) return 0
  if (pa.pre === null) return 1
  if (pb.pre === null) return -1
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let index = 0; index < n; index += 1) {
    const x = pa.pre[index]
    const y = pb.pre[index]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const delta = Number(x) - Number(y)
      if (delta !== 0) return delta
    } else if (xn !== yn) return xn ? -1 : 1
    else if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Parse `x.y.z[-pre]`; `undefined` when the shape is not semver. */
function parseVersion(version: string): { major: number, minor: number, patch: number, pre: readonly string[] | null } | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  return match === null ? undefined : {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? null : match[4].split('.'),
  }
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
  return boundLine(lines[lines.length - 1] ?? 'install failed')
}

/** One output line capped at 200 characters for the failure form's budget. */
function boundLine(line: string): string {
  return line.length > 200 ? `${line.slice(0, 197)}...` : line
}

/**
 * The last few non-empty output lines as failure context — each bounded, the
 * verdict line excluded (it already leads the block), `undefined` when
 * nothing survived (the `detail` key stays absent). D56's failure-form
 * extension of the D50④ one-line contract.
 */
function tailLines(output: string, verdict: string): readonly string[] | undefined {
  const lines = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .slice(-DETAIL_LINES)
    .map(boundLine)
    .filter(line => line !== verdict)
  return lines.length > 0 ? lines : undefined
}
