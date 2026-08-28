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
    version: '0.1.1-rc.1',
    summary: 'Blue now exposes a renderer-neutral UI kit and capability-scoped plugin runtime.',
    highlights: [
      'Public renderer-neutral UI kit — the new @dsh-blue/blue-ui package provides frozen node builders and component factories shared by Blue-owned and third-party plugins without exposing pi-tui or terminal objects.',
      'Canonical plugin surfaces — panes, overlays, status entries, commands, notifications, and editor extensions cross one validated BlueUiNode boundary with bounded trees, semantic events, unload cleanup, and narrow-width containment.',
      'Explicit provider ownership — status and editor providers remain inert until selected, swap around preserved frontend state, and retain the active or plain fallback when activation, rendering, or unload fails.',
      'Isolated session capabilities — session.read exposes only frozen revisioned snapshots and subscriptions, while session.act serializes structured writes with abort, stale-session, late-result, and owner-lifecycle fencing.',
      'Actionable legacy migration — the old dock, panels, editor, and tools capabilities are removed from the public runtime and now return targeted replacement guidance instead of silently activating compatibility paths.',
    ],
    knownIssues: [],
  },
  {
    version: '0.1.0-rc.10',
    summary: 'Registry installs now keep the complete Blue release set on one exact version.',
    highlights: [
      'Exact internal Blue dependencies — published packages no longer use prerelease ranges, so an existing internal test version cannot be selected during registry installation.',
      'Deterministic terminal snapshots — renderer tests pin terminal hyperlink capabilities and remain stable across local terminals and CI runners.',
    ],
    knownIssues: [],
  },
  {
    version: '0.1.0-rc.9',
    summary: 'Creative mode now reaches the screen through a capability-safe, fully tested Cordis path.',
    highlights: [
      'Capability-ready creative bridges — bluePluginHost.open() now succeeds only when every requested owner bridge is active. Registrations and notices recheck readiness at write time, return BLUE_CAPABILITY_ABSENT during a bridge gap, and restore retained contributions when the bridge reloads.',
      'Strict creative-realm isolation — dynamic packages retain tools and bluePluginHost, while every Blue owner/runtime service is withheld. A source-derived drift gate fails when a new blue* service is not isolated or explicitly allowlisted.',
      'Real Cordis lifecycle coverage — the whole-tree fixture now drives the published cordis_define, cordis_run, and cordis_stop tools through the host runner VM, covering rendering, slash commands, notifications, unload, restart, update, rollback, process restart, and missing-bridge diagnostics.',
      'Corrected creative-mode skills — examples now show the complete define envelope, the ^[a-z]{3,6}$ prefix rule, apply(ctx) scope, mandatory BlueResult checks, and the prohibition on owner-registry fallbacks.',
      'Stable Host-console rendering — stdout/stderr written outside the renderer now triggers a forced alternate-screen frame, so large dynamic plugin JSON logs cannot remain inside the editor or overwrite the footer; Up history continues to contain only submitted user prompts.',
      'Creative BTW sessions — side sessions now receive the same model and preset setup as the parent, preserving structured tools instead of showing raw DSML as assistant text.',
      'Verified candidate releases restored — tags publish immutable tarballs to candidate, verify exact registry installs on Linux, macOS, and Windows with Node 22 and 24, run a real PTY boot, then promote the verified artifacts.',
      'One-step, bounded launcher installs — @dsh-blue/blue-cli carries the pinned cross-platform dsh closure as common plus native-target archives while its published manifest remains dependency-free. npm no longer solves the Harness graph or runs its lifecycle scripts; first use expands only the current target atomically into a versioned user cache. Synchronous 1 MiB extraction keeps the measured first-use peak near 160 MB RSS instead of the async extractor\'s near-500 MB path-reservation queue.',
    ],
    knownIssues: [
      'Release-day cooldown: pnpm 11\'s default minimumReleaseAge (24h) can refuse the first-run calibration\'s exact-version install on the day of publishing — one line of error, retry after the window or pin minimumReleaseAge: 0. Self-corrects within 24h of this release.',
    ],
  },
  {
    version: '0.1.0-rc.8',
    summary: 'Execution traces and crash-safe updates arrive, with fixes for creative presets and the side-question pane.',
    highlights: [
      'Local /trace timeline — inspect the current session through the harness\'s official query APIs, with streamed reasoning/text chunks merged into readable items. Copy one item with c, copy the complete trace with a, or press Enter to inspect the selected event\'s full scrollable JSON.',
      'Crash-safe /update hardening — concurrent updates are blocked, every swap carries an interrupted-update marker, registry retries stay visible, snapshots are atomic, downgrades install the target release\'s complete package set, and rollback restores and re-verifies the original set.',
      'Creative preset activation fixed — the bundle now mounts and ships the Cordis host runner required by the cordis preset, so switching to the creative preset no longer stalls on missing host services.',
      'More reliable /btw conversations — side agents inherit the parent preset, replacement failures preserve the active pane, session changes dispose the side agent, and the pane frame now joins the editor cleanly.',
      'Built-in /changelog and refreshed docs — release highlights and known issues are available inside Blue, and the README/site now include a short terminal demo plus the new command surfaces.',
    ],
    knownIssues: [
      'Release-day cooldown: pnpm 11\'s default minimumReleaseAge (24h) can refuse the first-run calibration\'s exact-version install on the day of publishing — one line of error, retry after the window or pin minimumReleaseAge: 0. Self-corrects within 24h of this release.',
    ],
  },
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
