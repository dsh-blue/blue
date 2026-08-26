# Contributing to Blue

The local development install for **contributors to the Blue repository itself**: checkout, link install into a dsh profile, the iteration loop, and the smoke check. Downstream developers writing Blue plugins in their own repository should read [Writing your first plugin](/en/plugins/) instead — that path does not need this page.

::: info
The user install path is npm — `dsh plugin --profile blue add @dsh-blue/blue@rc`, see [Quickstart](/en/guide/). This page only serves contributors hacking on Blue itself.
:::

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.1-rc.2` (`npm i -g @deepseek-ai/dsh`) |

## One-shot install

```sh
script/install-dev.sh
# overrides: DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

The script builds the workspace and link-installs the authoritative 11-package list from `script/install-dev.sh`: the product plugin closure plus the OpenPencil/Lark validation adapters.

## Manual, equivalent

```sh
pnpm install && pnpm run build   # lib/ is the runtime entry of every package

# One-time profile setup:
dsh plugin --profile blue-dev add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/api \
  link:/path/to/blue/packages/frontend \
  link:/path/to/blue/packages/harness-adapter \
  link:/path/to/blue/packages/conversation \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/openpencil \
  link:/path/to/blue/packages/lark \
  link:/path/to/blue/packages/app

dsh --profile blue-dev [task]           # run a task, or start interactive
dsh --profile blue-dev --resume <id>    # resume a persisted session
```

**Why 11 links**: the bundle's local `workspace:^` closure must be linked explicitly outside the workspace, and OpenPencil/Lark join the dogfood validation lane. Expect a `declares no dsh.bundle` warning for each of the ten non-bundle links. `script/install-dev.sh` is authoritative; context/remote run in independent fixtures instead of the product profile.

::: tip Three lanes — never mix them
- **`blue`** = the production profile, **npm installs only** (`@dsh-blue/blue@rc` / an exact version). Never `link:` into it — a later npm upgrade overwrites only the named packages, the leftover links dangle, and boot dies with `ERR_MODULE_NOT_FOUND` (`pnpm add` does not warn about the mix).
- **`blue-dev`** = the link-dev profile of this checkout (the script's default target).
- **`blue-<tag>`** = a worktree acceptance profile (`PROFILE=blue-<tag> script/install-dev.sh` from inside the worktree); delete the profile directory together with the branch when it merges.

If your profile carries links from before the package rename, or ever mixed link and npm packages: delete a development profile and rerun `script/install-dev.sh`; for production, delete the profile and reinstall `@dsh-blue/blue@<v>` so the package manager resolves the complete dependency closure in one pass.
:::

## Iteration loop

**edit src → `pnpm run build` → re-run `dsh --profile blue-dev`**. The links point at the package directories, so rebuilt `lib/` takes effect with no reinstall; only a dependency-graph change (adding a package or changing `dependencies`) needs another `dsh plugin --profile blue-dev add`/`install`.

Headless smoke check (pseudo-TTY via `script(1)`):

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue-dev" /tmp/blue-smoke.typescript
# Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
```

## Tests and gates

```sh
pnpm run test           # vitest: unit suites plus the bundle's whole-tree e2e
pnpm run test:coverage  # per-file 100% gate on packages/*/src
pnpm run build          # tsc -b emits lib/types, tsdown bundles lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

Tests run from source: specs import the package under test through relative `../src/*.ts` paths, and every `@deepseek-ai/*` dependency resolves from `node_modules`.
