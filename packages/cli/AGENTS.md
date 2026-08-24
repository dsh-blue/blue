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
- The `BLUE_LAUNCHER=blue` child env rebrands the app's help and exit
  epitaph; nothing else in the app tree reads it.
- The creative-preset overlay (S39): `src/presets.ts` syncs the payload at
  `packages/cli/presets/cordis/` over the NESTED host's shipped `cordis`
  preset on every boot (id and display name unchanged — Blue's 创造模式 IS
  the Blue one), through the coarse `syncPresetTree` seam (the stamp file
  `.blue-cordis.stamp` beside the target skips an unchanged tree; a
  wholesale replace clears files the payload dropped). The nested host is
  the shell's own dependency, so the overwrite is physically incapable of
  touching another dsh installation — config-based shadowing is impossible
  by upstream design (the dsh launcher's final overlay rewrites the
  roster's `roots` to the shipped root, and the shared user root both
  sorts after it and leaks into every profile). A sync failure (root-owned
  global prefix) warns once and boots with the shipped creative mode; the
  `version`/`plugin` surfaces never sync. The payload itself is the
  shipped `cordis` composition with the persona retargeted at Blue's three
  planes (distributable Blue plugin package via `dsh plugin add` /
  composition rows / dynamic plugins — a real Blue feature never requires
  the dsh-blue source tree; verified by the S39 spike: a plain ESM package
  layered after Blue's bundle mounts and renders, and a live-session probe
  confirmed the dynamic host half reaches all seven Blue L1 services and
  hot-mounts UI). The persona's workflow is prototype-in-session (dynamic
  hot-mount, user sees it immediately) then package-and-ask-distribute.
  Three skills: `blue-plugin-development` (the plugin-package path),
  `editing-cordis-compositions` (adapted), `cordis-plugin-development`
  (host half, including the Blue UI hot-mount surface).
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

The CLI publishes `lib/bin.js`, bilingual README files, and `npm-shrinkwrap.json`. The shrinkwrap is regenerated only by `pnpm release:lock-cli` in an isolated npm project and must contain registry records, never pnpm `link:` entries. `pnpm check:pack` verifies the executable mode, shebang, single runtime file, shrinkwrap root pin, and 30 KB launcher budget.
