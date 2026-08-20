# Quickstart

::: info Preview stage
Blue is not published to npm yet (`v0.1.0-rc.1` will be the first released version). The only supported install today is a local development install against a checkout — that is what this page describes. An npm install section will land here once the preview ships.
:::

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.0-rc.7` (`npm i -g @deepseek-ai/dsh`) |

## One-shot install

```sh
script/install-dev.sh
# overrides: DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

The script builds the workspace and link-installs all five packages into the profile.

## Manual, equivalent

```sh
pnpm install && pnpm run build   # lib/ is the runtime entry of every package

# One-time profile setup:
dsh plugin --profile blue add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/app

dsh --profile blue [task]           # run a task, or start interactive
dsh --profile blue --resume <id>    # resume a persisted session
```

**Why all five links**: the four library packages are the bundle's `workspace:^` dependencies, unresolvable outside this workspace. `dsh plugin` forwards verbatim to pnpm, whose `link:` protocol installs the checkout itself as a symlink; the linked bundle then resolves its siblings through the profile's own `node_modules` links. The four non-bundle links are plain dependencies — expect one `declares no dsh.bundle` warning each; they are libraries, not layers.

::: tip Stale profile cleanup
If your profile was linked before the package rename (when the packages were named `@dsh-blue/blue*`), those links are stale — delete the profile directory (`~/.dsh/profiles/<name>`) or `dsh plugin --profile <name> remove` the old entries, then re-run the script.
:::

## First run

```sh
dsh --profile blue            # interactive: welcome banner + input editor
dsh --profile blue fix the null deref on the login page    # run a task directly
```

A few things to try first:

- type `/` to see slash-command autocomplete, `/help` for the command and key overview;
- ask something and watch the streaming reply and tool cards;
- `/theme light` to feel a hot theme switch (your draft survives).

## Iteration loop

**edit src → `pnpm run build` → re-run `dsh --profile blue`**. The links point at the package directories, so rebuilt `lib/` takes effect with no reinstall; only a dependency-graph change (adding a package or changing `dependencies`) needs another `dsh plugin --profile blue add`/`install`.

Headless smoke check (pseudo-TTY via `script(1)`):

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
# Assert: bracketed-paste on (\x1b[?2004h) at boot, off (\x1b[?2004l) at exit, exit code 0.
```
