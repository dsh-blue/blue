/**
 * Version parsing and ordering for the updater (D52): a strict-TypeScript
 * port of the semver comparison `script/harness-drift.mjs` has exercised
 * daily since R1, so the registry-side automation and the runtime updater
 * can never disagree about whether one prerelease outranks another. The
 * one updater-only addition is {@link VERSION_FLOOR}: 0.1.0-rc.1 shipped
 * tarballs that cannot boot (D51), so no update offer and no rollback may
 * ever land on a version below it.
 *
 * @module @dsh-blue/blue-interaction/updater/version
 */

/** A parsed `MAJOR.MINOR.PATCH[-prerelease]` version. */
export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Dot-separated prerelease identifiers, empty for a release. */
  readonly prerelease: readonly string[]
}

/**
 * The lowest version any update may target or roll back to: `0.1.0-rc.1`
 * tarballs are broken (D51 — missing tsdown hash-chunks; the FAQ tells
 * rc.1 installs to upgrade).
 */
export const VERSION_FLOOR = '0.1.0-rc.2'

/**
 * Parse `MAJOR.MINOR.PATCH[-prerelease]`; `undefined` on a foreign shape.
 * @param value - the version string (a registry version key or tag target).
 * @returns the parsed version, or `undefined` when the shape is not semver.
 */
export function parseVersion(value: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value)
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * Semver ordering: core fields numerically, release above prerelease,
 * prerelease identifiers numerically when both are numeric (rc.2 before
 * rc.10) and lexically otherwise, numeric before alphanumeric. A value
 * that does not parse keeps a deterministic total order through plain
 * string comparison — the same fallback the drift monitor uses, so
 * garbage from a registry never turns into a random verdict.
 * @param a - the left version.
 * @param b - the right version.
 * @returns negative when `a < b`, `0` when equal, positive when `a > b`.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === undefined || right === undefined) return a === b ? 0 : a < b ? -1 : 1
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    const ln = /^\d+$/.test(l) ? Number(l) : undefined
    const rn = /^\d+$/.test(r) ? Number(r) : undefined
    if (ln !== undefined && rn !== undefined) {
      if (ln !== rn) return ln < rn ? -1 : 1
    } else if (ln !== undefined) {
      return -1
    } else if (rn !== undefined) {
      return 1
    } else if (l !== r) {
      return l < r ? -1 : 1
    }
  }
  return 0
}

/**
 * Whether a version parses at all — the gate every caller applies before
 * ordering, so an unparseable registry string blocks with a message
 * instead of reaching the comparison fallback.
 * @param value - the version string.
 * @returns `true` when {@link parseVersion} accepts the shape.
 */
export function isVersion(value: string): boolean {
  return parseVersion(value) !== undefined
}

