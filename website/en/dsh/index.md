# What is dsh

Blue is the terminal interface for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (**dsh**) — understanding a few core dsh concepts makes Blue much easier to use well. This handbook distills the dsh knowledge Blue users need; the complete engineering docs live at the [official reference site](https://deepseek-harness.github.io/deepseek-harness/reference/).

::: info Version basis
This handbook tracks the npm release line `0.1.0-rc.8` / `rc.8` (`npm i -g @deepseek-ai/dsh`). Parts of the official reference site run ahead of the published releases — when in doubt, trust your installed `dsh --version` and `--dump-config`.
:::

## What dsh is

dsh is a **plugin-based agent harness**: model adapters, tool execution, session persistence, approval and sandbox policies, settings, and credentials are all assembled as [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) plugins. Every interface you see — Blue's TUI, the browser web app, the one-shot headless runner — is just a different assembly of the same plugin tree.

Three keywords:

- **Bundle** — a set of plugins shipped with their own mount code, declaring its plugin rows through the package's `cordis.patch.yml`; `dsh-base` is the first layer of every profile.
- **Profile** — a named assembly: the bundles it layers, its own patch overrides, and its independently installed plugins. See [Profiles & directories](/en/dsh/profiles).
- **Blue** — is a bundle: it inserts 21 plugin rows over `dsh-base` and takes over the terminal interface (see the [features overview](/en/features/)).

## CLI cheat sheet

```sh
dsh --profile <name> [task]      # boot a profile; a task argument enters that app
dsh --profile <name> --resume <id>  # resume a session
dsh web                          # alias for --profile web (the browser app)
dsh --profile <name> --patch ./x.yml  # append a patch overlay (repeatable)
dsh --profile <name> --dump-config   # print the fully composed plugin tree
dsh --profile <name> --dump-default-config  # the default tree without user layers
dsh plugin --profile <name> add <pkg>   # install a plugin into the profile (forwards to pnpm)
```

## Handbook chapters

- [Profiles & directories](/en/dsh/profiles) — the layering mechanism and the `DSH_HOME` layout
- [Modes & permissions](/en/dsh/modes) — agent presets, approval policies, sandbox modes, permission presets
- [Built-in tools](/en/dsh/tools) — the complete catalog of dsh's built-in tools
- [Skills](/en/dsh/skills) — discovery directories, file format, and the loading mechanism
