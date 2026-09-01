# Contributing to Blue

Blue is a pnpm 11 workspace requiring Node
`^22.19.0 || >=24.0.0`. The release set has ten packages: api, ui, frontend,
conversation, app, core, transcript, interaction, bundle, and cli.

Read root `AGENTS.md` and the owning package's `AGENTS.md`. Develop
user-visible behavior, public seams, and Website changes in a dedicated
worktree and branch.

```sh
pnpm install
pnpm run verify:changed -- --plan
pnpm run verify:changed
pnpm run verify:full
```

For publish shape:

```sh
pnpm run check:lib
pnpm run check:pack
pnpm run check:examples
```

Runtime, public, and composition changes require a dedicated profile:

```sh
PROFILE=blue-my-change script/install-dev.sh
dsh --profile blue-my-change
```

Website changes require a build and LAN preview acceptance. Do not merge,
remove the profile, or stop the preview before every applicable human
acceptance completes.
