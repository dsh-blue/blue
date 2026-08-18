# Blue

Blue is the interactive terminal UI for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a pi-tui renderer over the harness's Cordis plugin architecture, shipped as five `@deepseek-ai/dsh-blue-*` packages. This repository is the standalone home of those packages; they were extracted from the `deepseek-harness` monorepo (`packages/blue/*` and `packages/bundle/blue`) and now build and test against the published npm releases of the harness (`0.1.0-rc.7` line) and vendored Cordis.

## Packages

| Package | Role |
| --- | --- |
| [`@deepseek-ai/dsh-blue-core`](packages/core) | The tree's only `@earendil-works/pi-tui` adapter: terminal lifecycle plus the `blueScreen` / `blueTheme` / `blueKeymap` L1 services. |
| [`@deepseek-ai/dsh-blue-transcript`](packages/transcript) | Folds session events into transcript items and renders them (streamed Markdown, tool calls) through blue-core. |
| [`@deepseek-ai/dsh-blue-interaction`](packages/interaction) | Input editor, slash commands (`/quit`, `/resume`), approval and user-question overlays. |
| [`@deepseek-ai/dsh-blue-app`](packages/app) | Command-line startup (`[task]`, `--resume <id>`) and the Agent driver wiring sessions to the UI. |
| [`@deepseek-ai/dsh-blue`](packages/bundle/blue) | The installable bundle: `cordis.patch.yml` inserts the five Blue rows over `dsh-base`. |

Each package keeps the Cordis plugin shape: `@deepseek-ai/cordis` and the dsh service packages are `peerDependencies` provided by the host `dsh` installation, not bundled.

## Develop

Requires Node `^22.19 || >=24` and pnpm 11.

```sh
pnpm install            # resolves every dependency from the npm registry
pnpm run test           # vitest: unit suites plus the bundle's whole-tree e2e
pnpm run test:coverage  # per-file 100% gate on packages/*/src
pnpm run build          # tsc -b emits lib/types, tsdown bundles lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

Tests run from source: specs import the package under test through relative `../src/*.ts` paths, and every `@deepseek-ai/*` dependency resolves from `node_modules`.

## Use with dsh

Blue no longer ships inside the `dsh` installation, so the `blue` profile is initialized from the default bundle set (`@deepseek-ai/dsh-base`) and the Blue bundle is added out-of-tree (see [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/develop/basic/publish.md)):

```sh
# From a registry release, once published:
dsh plugin --profile blue add @deepseek-ai/dsh-blue
```

`dsh plugin` initializes the profile directory (default bundles, including `@deepseek-ai/dsh-base`) on first use, installs the package into the profile with pnpm, and appends `@deepseek-ai/dsh-blue` to the profile's `dsh.profile.bundles` list because the package declares `dsh.bundle`. Then:

```sh
dsh --profile blue [task]           # run a task, or start interactive
dsh --profile blue --resume <id>    # resume a persisted session
dsh --profile blue --dump-config    # inspect the composed patch layers
```

`dsh plugin --profile blue remove @deepseek-ai/dsh-blue` removes both the dependency and the layer.

### Local development install (no npm publish)

One-shot setup (builds the workspace and link-installs all five packages into the profile):

```sh
script/install-dev.sh
# overrides: DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

The script wraps the manual flow below. `dsh plugin` forwards verbatim to pnpm in the profile directory, so pnpm's `link:` protocol installs the checkout itself as a symlink. Because the four library packages are the bundle's `workspace:^` dependencies — unresolvable outside this workspace — link all five packages; the symlinked bundle resolves its siblings through the profile's own `node_modules` links, and each linked package resolves the harness peers through this repository's installed `node_modules`:

```sh
pnpm install && pnpm run build   # lib/ is the runtime entry of every package

# One-time profile setup (any dsh ≥ 0.1.0-rc.7; npm i -g @deepseek-ai/dsh works):
dsh plugin --profile blue add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/app

dsh --profile blue                # boot the checkout
```

Iteration loop: **edit src → `pnpm run build` → re-run `dsh --profile blue`**. The links point at the package directories, so rebuilt `lib/` takes effect with no reinstall; only a dependency-graph change (adding a package or changing `dependencies`) needs another `dsh plugin --profile blue add`/`install`. The four non-bundle links are plain dependencies (expect one `declares no dsh.bundle` warning each — they are libraries, not layers).

Smoke script for a headless check (pseudo-TTY via `script(1)`):

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
# Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
```

## Relationship to deepseek-harness

- Runtime and test dependencies (`@deepseek-ai/cordis` 4.0.1, `@deepseek-ai/dsh-*` 0.1.0-rc.7, `@earendil-works/pi-tui` ^0.84.2) come from the npm registry; Blue's own five packages stay workspace-linked here.
- The harness's repository gates (documentation i18n pairing, README gates, snapshot/e2e lanes) do not apply here; this repo keeps the build, the full test suite, and the per-file 100% src coverage gate.
