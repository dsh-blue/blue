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
  shell is the advancing move). Install retries once with `-w` when pnpm
  refuses a workspace-root write (ERR_PNPM_ADDING_TO_ROOT), and a missing
  pnpm fails with the install suggestion (npm i -g pnpm, or corepack).
  No `blue upgrade` exists by ruling — reinstalling the shell
  is the upgrade.
- The `BLUE_LAUNCHER=blue` child env rebrands the app's help and exit
  epitaph; nothing else in the app tree reads it.
- The updater family (`blue-interaction/src/updater/`, D52) stays the
  in-app surface; the shell deliberately reimplements the ~30 lines of
  profile reading rather than adding an exports subpath to a plugin
  package (the S30 incident family).

Conventions: every side effect goes through `src/internals.ts`
(`cliInternals`, the house seam pattern — specs snapshot REAL and restore
in afterEach); the bin entry (`src/bin.ts`) is shebang + hand-off only,
guarded by a `v8 ignore` for the run-as-binary line; per-file 100%
coverage includes the default spawn shapes, which the io spec drives with
real `node -e` children (the SIGTERM→SIGKILL ladder included).
