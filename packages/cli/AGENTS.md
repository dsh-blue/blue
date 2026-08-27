# `@dsh-blue/blue-cli`

The `blue` launcher shell (S37, decision D50④): a standalone global package,
not a plugin — it never loads inside a dsh tree. Its published manifest is
dependency-free: npm global installation must not resolve the full Harness
graph. The tarball carries that graph as one common archive plus six native
target archives; the first command that needs dsh atomically expands the
common and current-target layers into a versioned user cache, calibrates the
`blue` profile, and execs the pinned host with translated arguments.

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
- The `BLUE_LAUNCHER=blue` child env is the branding seam. `BLUE_DSH_BIN`
  exports the materialized nested host path so in-app `/plugin install`
  delegates to the exact same pinned dsh runtime.
- Creative mode belongs entirely to `@dsh-blue/blue`; the launcher carries
  no preset payload and performs no host-installation writes. This keeps
  `blue` and direct `dsh --profile` launches on the same bundle path.
- The updater family (`blue-interaction/src/updater/`, D52) stays the
  in-app surface; the shell deliberately reimplements the ~30 lines of
  profile reading rather than adding an exports subpath to a plugin
  package (the S30 incident family).

Conventions: every side effect goes through `src/internals.ts`
(`cliInternals`, the house seam pattern — specs snapshot REAL and restore
in afterEach; release CI materializes the payload on Linux, macOS, and
Windows); the bin entry
(`src/bin.ts`) is shebang + hand-off only, guarded by a `v8 ignore` for
the run-as-binary line; per-file 100% coverage includes the default spawn
shapes, which the io spec drives with real `node -e` children (the
SIGTERM→SIGKILL ladder included).

## Distribution contract

The CLI publishes `lib/bin.js`, seven `runtime-*.tgz` payloads, and bilingual README files, with no published runtime dependencies. `packages/cli/runtime/` is a private, independently locked seed with Linux/macOS/Windows x64/arm64 optional binaries. `script/pack-cli-runtime.mjs` installs that seed with scripts disabled and a hoisted layout, splits common packages from six native OS/architecture layers, and emits the payloads. `pnpm check:pack` verifies the executable mode, shebang, one bundled launcher file (400 KB budget), dependency-free manifest, platform sentinels, exact dsh line, and a 150 MB total compressed payload budget.

`src/runtime.ts` extracts the common archive plus only the current native layer below `$DSH_HOME/cache/blue-cli-runtime/<blue>-<dsh>` through the bundled `tar` implementation. Extraction is synchronous with 1 MiB read blocks: async `tar` path reservations retained the 28k-entry closure until completion and measured near 500 MB RSS, while the bounded synchronous path stays streaming and measured near 160 MB. The prepared tree is validated before atomic rename; a concurrent winner is reused and temporary trees are always removed. Version output and locally handled plugin-market commands never extract the payload.

CLI specs that create temporary homes or nested installs register the shared
tracked-temp cleanup hook so Vitest worker reuse does not accumulate fixtures
under the OS temp directory.
