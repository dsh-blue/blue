# @dsh-blue/blue-cli

The `blue` launcher ships a tested dsh host and calibrates the `blue` profile on first use.

Install with npm, then install pnpm 11 before the first boot:

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

The profile is managed by dsh's official pnpm workspace path. Once the profile already carries the shell's exact Blue version, ordinary starts do not invoke pnpm again. Reinstall the shell to upgrade; use `dsh plugin` for explicit profile management.

The shell owns exactly three argument surfaces and forwards everything else to the host untouched. `blue -V` (or `--version`) is answered by the shell itself — one line naming the shell version, the pinned `@dsh-blue/blue` bundle version, and the harness host line. `blue plugin ...` maps to the host's plugin subcommand with `--profile blue` inserted after the word `plugin`. Any user-supplied `--profile` is swallowed: the profile is always `blue`, so future Blue arguments can never collide with host flags. The child process carries `BLUE_LAUNCHER=blue`, which rebrands the app's help text and exit epitaph from `dsh --profile blue` to `blue`.

Creative mode is supplied by the `@dsh-blue/blue` bundle itself. The shell does not rewrite its nested dsh installation, so `blue` and direct `dsh --profile` launches use the same isolated preset roster.
