# @dsh-blue/blue-cli

The `blue` launcher carries its tested dsh host as prepacked common and platform runtime archives. npm installs one dependency-free package and never resolves or runs lifecycle scripts from the Harness dependency graph.

Install pnpm 11 for profile management, then install Blue in one command:

```sh
npm i -g pnpm@11
npm i -g @dsh-blue/blue-cli@alpha
blue
```

The first command that needs dsh expands only the common and current-platform layers into a versioned user cache below `DSH_HOME`; later invocations reuse it. This extraction uses bounded memory and atomic publication, and does not contact npm. The profile is managed by dsh's official pnpm workspace path. Once the profile carries the shell's exact Blue version, ordinary starts do not invoke pnpm again. Reinstall the shell to upgrade; use `blue plugin` for explicit profile management.

The shell owns exactly three argument surfaces and forwards everything else to the pinned host untouched. `blue -V` (or `--version`) names the shell version, the pinned `@dsh-blue/blue` bundle version, and the bundled harness line without expanding the runtime. `blue plugin ...` maps to the bundled host's plugin subcommand with `--profile blue` inserted after the word `plugin`. Any user-supplied `--profile` is swallowed: the profile is always `blue`, so future Blue arguments cannot collide with host flags.

Creative mode is supplied by the `@dsh-blue/blue` bundle itself. The launcher only owns host delivery and profile selection.
