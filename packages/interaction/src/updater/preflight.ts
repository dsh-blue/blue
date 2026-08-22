/**
 * The update family's pre-flight gates (D52): pure verdicts over facts
 * the caller gathered through the io seam, so every lane rule and
 * release lesson has one testable home. The gates encode, in order:
 * the lane rule (`link:` pollution refuses — the Frankenstein boot),
 * set consistency (the release's set, one version), target existence, the
 * D51 version floor (never rc.1), the host harness line (the global dsh
 * CLI must meet the bundle's pin), and the pnpm cooldown forecast (a
 * fresh release is hard-refused by `minimumReleaseAge`; the user gets
 * an ETA, never a silent bypass).
 *
 * @module @dsh-blue/blue-interaction/updater/preflight
 */

import type { Packument } from './registry.ts'
import type { ProfileFacts } from './profile.ts'
import { compareVersions, isVersion, VERSION_FLOOR } from './version.ts'

/** pnpm 11's default cooldown window, in minutes (the R4 measurement). */
export const DEFAULT_COOLDOWN_MINUTES = 1440

/** A blocking gate's verdict — it stops the update and carries its message. */
export interface BlockingVerdict {
  /** Stable gate id (`link-pollution`, `host-line`, …). */
  readonly code: string
  readonly blocking: true
  /** The user-facing explanation, printed verbatim. */
  readonly message: string
}

/** A passing gate's verdict — optionally a warning that rides along. */
export interface PassingVerdict {
  /** Stable gate id. */
  readonly code: string
  readonly blocking: false
  /** The warning text, when the gate wants to say something anyway. */
  readonly message?: string
}

/** A gate's verdict; blocking gates stop before anything is touched. */
export type Verdict = BlockingVerdict | PassingVerdict

/** The repair recipe every blocking lane/set verdict offers. */
export function repairRecipe(names: readonly string[], version: string): string {
  const specs = names.map(name => `${name}@${version}`).join(' ')
  return `repair: dsh plugin --profile <name> add ${specs} (reinstall the full set by exact version) or delete the profile directory and re-add`
}

/**
 * Gate 1 — the lane rule: a production profile must be npm-only. A
 * `link:`/`file:` spec half-survives the next npm upgrade and boots
 * `ERR_MODULE_NOT_FOUND` (the state found on the maintainer's machine
 * after R1); pnpm warns about nothing.
 */
export function checkLinkPollution(facts: ProfileFacts): Verdict {
  if (facts.linked.length === 0) return { code: 'link-pollution', blocking: false }
  return {
    code: 'link-pollution',
    blocking: true,
    message: `the profile mixes link/file specs (${facts.linked.join(', ')}) — npm upgrades half-overwrite them and boot a broken tree; refuse to update\n${repairRecipe(['<the names above>'], '<version>')}`,
  }
}

/**
 * Gate 2 — set consistency: the DISCOVERED install must be one coherent
 * version. Mixed versions are the Frankenstein tree (a half-overwritten
 * previous update); a bundle that is not installed at all leaves nothing
 * to update from. A merely missing member is benign — the next install
 * pulls the target release's full dependency set — so the gate judges
 * coherence, not membership (the post-install verify owns membership,
 * against the target release's set).
 * @param facts - the profile facts.
 * @param currentVersion - the running version, for the message.
 * @param names - the target release's set, the repair recipe's fallback
 * when nothing is installed to enumerate.
 */
export function checkSetConsistency(facts: ProfileFacts, currentVersion: string, names: readonly string[]): Verdict {
  const discovered = Object.entries(facts.installed).filter(([, version]) => version !== undefined)
  const versions = new Set(discovered.map(([, version]) => version))
  if (facts.installed['@dsh-blue/blue'] !== undefined && versions.size === 1) {
    return { code: 'set-consistency', blocking: false }
  }
  const recipeNames = discovered.length > 0 ? discovered.map(([name]) => name) : names
  const detail = discovered.length === 0
    ? 'no @dsh-blue packages are installed'
    : facts.installed['@dsh-blue/blue'] === undefined
      ? 'the @dsh-blue/blue bundle itself is not installed'
      : `the installed @dsh-blue set mixes versions (${[...versions].join(' + ')}; running ${currentVersion})`
  return {
    code: 'set-consistency',
    blocking: true,
    message: `${detail}\n${repairRecipe(recipeNames, '<version>')}`,
  }
}

/** Gate 3 — the target must exist as a published version. */
export function checkTargetExists(packument: Packument, target: string): Verdict {
  if (packument.versions[target] !== undefined) return { code: 'target-exists', blocking: false }
  return {
    code: 'target-exists',
    blocking: true,
    message: `version ${target} is not published under @dsh-blue/blue (registry knows: ${Object.keys(packument.versions).join(', ')})`,
  }
}

/** Gate 4 — the D51 floor: never offer, install, or roll back onto rc.1. */
export function checkVersionFloor(target: string): Verdict {
  if (compareVersions(target, VERSION_FLOOR) >= 0) return { code: 'version-floor', blocking: false }
  return {
    code: 'version-floor',
    blocking: true,
    message: `version ${target} predates ${VERSION_FLOOR} — 0.1.0-rc.1 shipped broken tarballs and cannot boot (D51); pick >= ${VERSION_FLOOR}`,
  }
}

/** The host-line facts gate 5 reads. */
export interface HostLineInput {
  /** The global dsh CLI's version, `undefined` when unprobeable. */
  readonly hostVersion: string | undefined
  /** The bundle's pinned harness line, `undefined` when the manifest lacks it. */
  readonly requiredLine: string | undefined
}

/**
 * Gate 5 — the host harness line: the global dsh CLI supplies every
 * `dsh-*` peer at runtime, so an older host than the bundle's pin boots
 * broken. A newer host *line* (different major/minor) is a warning —
 * the R1 ruling says minor jumps are never automatic, and the boot
 * smoke still judges the result. An unprobeable host warns, not blocks:
 * the smoke boots the real dsh either way.
 */
export function checkHostLine(input: HostLineInput): Verdict {
  const { hostVersion, requiredLine } = input
  if (hostVersion === undefined || requiredLine === undefined) {
    const detail = hostVersion === undefined
      ? 'could not determine the installed dsh CLI version'
      : `the registry manifest for this release does not name a harness pin`
    return { code: 'host-line', blocking: false, message: `warning: ${detail} — the boot smoke will judge` }
  }
  // The first full version anywhere in the probe output (`dsh --version`
  // prefixes the name and may append the Node build) — prerelease
  // included, or a plain `0.1.1` would outrank `0.1.1-rc.2`.
  const host = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(hostVersion)?.[0]
  if (host === undefined) {
    return { code: 'host-line', blocking: false, message: `warning: unreadable dsh version "${hostVersion}" — the boot smoke will judge` }
  }
  const order = compareVersions(host, requiredLine)
  if (order >= 0) {
    const [hmaj, hmin] = host.split('.')
    const [rmaj, rmin] = requiredLine.split('.')
    if (hmaj === rmaj && hmin === rmin) return { code: 'host-line', blocking: false }
    return {
      code: 'host-line',
      blocking: false,
      message: `warning: dsh ${host} is a different major/minor than the tested line ${requiredLine} — proceeding; the boot smoke will judge`,
    }
  }
  return {
    code: 'host-line',
    blocking: true,
    message: `the installed dsh CLI (${host}) is older than this release's harness line (${requiredLine})\nfirst run: npm i -g @deepseek-ai/dsh@${requiredLine}`,
  }
}

/** The cooldown facts gate 6 reads. */
export interface CooldownInput {
  /** Target's publish time, epoch ms; `undefined` when unrecorded. */
  readonly publishedAt: number | undefined
  /** pnpm's `minimumReleaseAge` in minutes; `undefined` falls to the default. */
  readonly cooldownMinutes: number | undefined
  /** Wall clock, epoch ms. */
  readonly now: number
}

/**
 * Gate 6 — the cooldown forecast: inside pnpm's `minimumReleaseAge`
 * window an exact-version install is hard-refused (the R1 finding), so
 * the gate converts that future pnpm error into an ETA now. Never a
 * bypass: the supply-chain guard is the user's policy.
 */
export function checkCooldown(target: string, input: CooldownInput): Verdict {
  const minutes = input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES
  if (input.publishedAt === undefined) {
    return { code: 'cooldown', blocking: false, message: 'warning: publish time unknown — cooldown cannot be forecast' }
  }
  const windowMs = minutes * 60_000
  const ageMs = input.now - input.publishedAt
  if (ageMs >= windowMs) return { code: 'cooldown', blocking: false }
  const readyAt = new Date(input.publishedAt + windowMs)
  return {
    code: 'cooldown',
    blocking: true,
    message: `v${target} was published ${Math.max(0, Math.round(ageMs / 60_000))} min ago; pnpm's minimumReleaseAge (${minutes} min) refuses installs until ${readyAt.toISOString().replace('T', ' ').slice(0, 16)} UTC — retry later`,
  }
}

/** Everything the composed pre-flight needs. */
export interface PreflightInput {
  readonly facts: ProfileFacts
  /** The target release's lockstep set (see `bundleSetNames`). */
  readonly packageNames: readonly string[]
  /** The running version (`BLUE_VERSION`). */
  readonly currentVersion: string
  /** The candidate target version. */
  readonly target: string
  readonly packument: Packument
  readonly host: HostLineInput
  readonly cooldown: CooldownInput
}

/**
 * Run all gates, lane-first. Every verdict is returned (warnings ride
 * along); callers stop at the first blocking one for their message.
 * @param input - the gathered facts.
 * @returns the verdicts in gate order.
 */
export function runPreflight(input: PreflightInput): Verdict[] {
  return [
    checkLinkPollution(input.facts),
    checkSetConsistency(input.facts, input.currentVersion, input.packageNames),
    checkTargetExists(input.packument, input.target),
    checkVersionFloor(input.target),
    checkHostLine(input.host),
    checkCooldown(input.target, input.cooldown),
  ]
}

/** What the offer resolution concluded. */
export type OfferResolution =
  | { kind: 'offer'; target: string }
  | { kind: 'up-to-date'; target: string }
  | { kind: 'no-tag' }
  | { kind: 'target-below-floor'; target: string }
  | { kind: 'target-unparsable'; target: string }

/**
 * Resolve what a channel offers against the running version: the tag's
 * target when it outranks it, or why not. Reads the tag table — never a
 * package-manager resolution, which silently rolls back inside the
 * cooldown window (R4).
 * @param packument - the normalized packument.
 * @param channel - the dist-tag to follow (`rc`).
 * @param currentVersion - the running version.
 */
export function resolveOffer(packument: Packument, channel: string, currentVersion: string): OfferResolution {
  const target = packument.tags[channel]
  if (target === undefined) return { kind: 'no-tag' }
  if (!isVersion(target)) return { kind: 'target-unparsable', target }
  if (compareVersions(target, currentVersion) > 0) {
    return compareVersions(target, VERSION_FLOOR) >= 0
      ? { kind: 'offer', target }
      : { kind: 'target-below-floor', target }
  }
  return { kind: 'up-to-date', target }
}
