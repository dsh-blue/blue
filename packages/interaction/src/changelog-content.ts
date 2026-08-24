/**
 * The `/changelog` panel's content module: the release notes embedded as
 * data, newest first. `docs/release-notes/` lives at the repository root
 * and never ships in the package tarballs (the `files` whitelist carries
 * `lib/` only), so an installed profile has no markdown to read at runtime
 * — this module is the single runtime source, and
 * `tests/changelog-content.spec.ts` is the drift guard keeping it in
 * lockstep with the markdown files (the `version.spec.ts` pattern): every
 * `v*.md` maps to exactly one entry, section bullets compared after
 * marker-stripping normalization. The `## Install` section is deliberately
 * not carried (the reader is already inside the app).
 *
 * @module @dsh-blue/blue-interaction/changelog-content
 */

/** One release's panel content, transcribed from its release-notes file. */
export interface ChangelogEntry {
  /** The release version without the file's `v` prefix, e.g. `0.1.0-rc.5`. */
  readonly version: string
  /** The lead paragraph under the `# Blue <version>` title. */
  readonly summary: string
  /** The `## Highlights` bullets, markdown markers stripped. */
  readonly highlights: readonly string[]
  /** The `## Known issues` bullets, markdown markers stripped. */
  readonly knownIssues: readonly string[]
}

/** All shipped releases, newest first. */
export const CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    version: '0.1.0-rc.7',
    summary: 'Packaging hygiene: the published tarballs are now mechanically gated.',
    highlights: [
      'pnpm check:pack packaging gate — the exact seven publish tarballs are created and validated on every check: publint, ATTW, manifest/bin checks, protocol leakage, shrinkwrap, and size budgets.',
      'Release workflow hardening — publishing goes to a candidate tag, runs registry install smoke across Linux/macOS/Windows, then promotes rc and latest; the workflow never rebuilds a second artifact, and the candidate promotion gains recovery paths.',
      '@dsh-blue/blue-cli ships npm-shrinkwrap.json — the shell\'s pinned dsh host tree is locked, and pnpm release:lock-cli refreshes it in an isolated npm project so workspace links cannot enter the published lock.',
    ],
    knownIssues: [
      'Release-day cooldown: pnpm 11\'s default minimumReleaseAge (24h) can refuse the first-run calibration\'s exact-version install on the day of publishing — one line of error, retry after the window or pin minimumReleaseAge: 0. Self-corrects within 24h of this release.',
    ],
  },
  {
    version: '0.1.0-rc.6',
    summary: 'Themes and clipboard images land on every desktop platform.',
    highlights: [
      'Four built-in themes and a live-preview /theme picker (D54) — dark, light, ocean, and paper palettes, a theme-driven banner logo, and a bare /theme that opens a picker live-applying every highlighted palette: Enter keeps it, Escape reverts to the opening theme. /theme custom <path> [dark|light] mounts a file-backed palette.',
      'Native clipboard image paste on Windows and macOS (S39, D55) — the paste-image plugin gains win32 (PowerShell WinForms with a staging handoff) and darwin (osascript/sips) probes behind a platform seam, joining the Linux Wayland/X11 backends; copied-file batches are admitted on all three platforms with magic-byte identification.',
      'Shell bootstrap hardening (D56) — the blue launcher\'s first-run calibration gains a pnpm preflight with the exact install suggestion, win32 exit-9009 classification, preserved failure context, a manual-lane fallback, and a 1200s budget.',
    ],
    knownIssues: [
      'Release-day cooldown: pnpm 11\'s default minimumReleaseAge (24h) can refuse the first-run calibration\'s exact-version install on the day of publishing — one line of error, retry after the window or pin minimumReleaseAge: 0. Self-corrects within 24h of this release.',
    ],
  },
  {
    version: '0.1.0-rc.5',
    summary: 'The blue shell arrives: installing Blue is now one command.',
    highlights: [
      'New package @dsh-blue/blue-cli (S37) — the blue launcher. npm i -g @dsh-blue/blue-cli@rc ships the dsh host pinned to the tested harness line, installs Blue into its blue profile on first run, and boots it; the direct path (dsh plugin --profile blue add @dsh-blue/blue@rc) remains fully supported. Upgrading = reinstalling the shell; /update keeps serving direct-install users, and a profile that /update advanced past the shell is never downgraded (direction guard).',
      'Launcher hardening: a pnpm-less first run now fails with the exact install suggestion (npm i -g pnpm, or corepack enable pnpm), and a workspace-root install refusal (ERR_PNPM_ADDING_TO_ROOT) retries once with -w.',
      'Docs catch-up (R6a): the website reference pages are current again — /mcp and /permission documented (with the input-layer interception distinction), Ctrl-G external editor and Alt+M model cycling in the key reference, the editor page covers # skills, large-paste folding and the external editor, the approval page covers the plan-review and permission panels, and a "parked commands" section makes the deferral rulings public.',
      'Records: D53 settles the follow-up cadence (upstream releases never force a Blue release — pinned installs are immune by construction) and the lockstep retirement conditions for the stable era; D37 gains the tools.restrict() review addendum.',
    ],
    knownIssues: [
      'Release-day cooldown: pnpm 11\'s default minimumReleaseAge (24h) can refuse the first-run calibration\'s exact-version install on the day of publishing — one line of error, retry after the window or pin minimumReleaseAge: 0. Self-corrects within 24h of this release.',
      'latest dist-tags on npm may lag this release until re-pointed; install specs carry @rc and are unaffected.',
    ],
  },
]
