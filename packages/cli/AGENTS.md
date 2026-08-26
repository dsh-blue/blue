# `@dsh-blue/blue-cli`

The `blue` launcher shell (S37, decision D50④): a standalone global package,
not a plugin — it never loads inside a dsh tree. It pins `@deepseek-ai/dsh`
as its own dependency (plan A: the nested host IS the runtime host, present
or absent on the user's PATH, always the tested line), calibrates the `blue`
profile to its own manifest version (the version.spec lockstep makes the
shell's version the bundle pin), and execs the host with translated
arguments.

Scope boundaries:

- `--profile` is swallowed and always `blue`; `plugin` gets the flag after
  the subcommand word (the host's own usage rule); `-V` is self-answered
  (shell · Blue pin · harness line). No other surface exists — the shell
  never parses Blue arguments (startup.ts owns that).
- Calibration skips `link:`/`file:` lanes (the three-lane rule: `blue` is
  npm-only; `blue-dev`/`blue-<tag>` are link lanes and must never be
  clobbered), and never downgrades a profile that `/update` advanced past
  the shell (`compareVersions` guard → 'ahead' notice; reinstalling the
  shell is the advancing move). Installs run behind a pnpm pre-flight
  (D56): posix probes `pnpm --version` directly (a true ENOENT is
  decisive), win32 probes through ComSpec — replicating dsh's
  `shell: true` cmd.exe + PATHEXT resolution, because a missing pnpm there
  surfaces as exit 9009, never ENOENT; every inconclusive probe proceeds
  (30s budget) and defers to the install's own classification, which maps
  the win32 9009 exit to the pnpm-missing class too. Install retries once
  with `-w` when pnpm refuses a workspace-root write
  (ERR_PNPM_ADDING_TO_ROOT), and a missing pnpm fails with the install
  suggestion (npm i -g pnpm, or corepack). Failures classify
  (`pnpm-missing` / `timeout` / `install` / `verify`) and carry a bounded
  output tail (≤6 lines × 200 chars, the verdict line deduplicated) —
  D56's failure-form extension of D50④'s one-line contract; the install
  budget is 1200s (the updater swap's parity; slow networks measured at
  18 min for 455 packages). No `blue upgrade` exists by ruling —
  reinstalling the shell is the upgrade.
- The `BLUE_LAUNCHER=blue` child env is a reserved branding seam; nothing
  reads it yet (the exit epitaph still prints `dsh --profile blue --resume`).
- Creative mode belongs entirely to `@dsh-blue/blue`; the launcher carries
  no preset payload and performs no host-installation writes. This keeps
  `blue` and direct `dsh --profile` launches on the same bundle path.
- The updater family (`blue-interaction/src/updater/`, D52) stays the
  in-app surface; the shell deliberately reimplements the ~30 lines of
  profile reading rather than adding an exports subpath to a plugin
  package (the S30 incident family).

Conventions: every side effect goes through `src/internals.ts`
(`cliInternals`, the house seam pattern — specs snapshot REAL and restore
in afterEach; `platform` is a seam field because CI runs ubuntu only, so
the win32 branches are seam-tested, never machine-tested); the bin entry
(`src/bin.ts`) is shebang + hand-off only, guarded by a `v8 ignore` for
the run-as-binary line; per-file 100% coverage includes the default spawn
shapes, which the io spec drives with real `node -e` children (the
SIGTERM→SIGKILL ladder included).

## Distribution contract

The CLI publishes `lib/bin.js` and bilingual README files. Its exact `@deepseek-ai/dsh` dependency is resolved by npm from the registry at install time; no lockfile is shipped because pnpm workspace lock entries are not valid in a globally installed npm package. `pnpm check:pack` verifies the executable mode, shebang, single runtime file, and 30 KB launcher budget.

CLI specs that create temporary homes or nested installs register the shared
tracked-temp cleanup hook so Vitest worker reuse does not accumulate fixtures
under the OS temp directory.
