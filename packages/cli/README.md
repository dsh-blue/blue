# @dsh-blue/blue-cli

The `blue` launcher is a lightweight shell over a separately installed, tested dsh host. It calibrates the `blue` profile on first use without making npm resolve the full Harness dependency graph as part of the launcher install.

Install the Harness host and pnpm 11 first, then install the lightweight launcher:

```sh
npm i -g @deepseek-ai/dsh@0.1.1-rc.2
npm i -g pnpm@11
npm i -g @dsh-blue/blue-cli@rc
blue
```

The profile is managed by dsh's official pnpm workspace path. Once the profile already carries the shell's exact Blue version, ordinary starts do not invoke pnpm again. Reinstall the shell to upgrade; use `dsh plugin` for explicit profile management.

The shell owns exactly three argument surfaces and forwards everything else to the host untouched. It probes the global `dsh` and refuses an untested version before changing a profile. `blue -V` (or `--version`) names the shell version, the pinned `@dsh-blue/blue` bundle version, and the detected harness line. `blue plugin ...` maps to the host's plugin subcommand with `--profile blue` inserted after the word `plugin`. Any user-supplied `--profile` is swallowed: the profile is always `blue`, so future Blue arguments cannot collide with host flags.

Creative mode is supplied by the `@dsh-blue/blue` bundle itself. `blue` and direct `dsh --profile blue` launches use the same global host and isolated preset roster.
