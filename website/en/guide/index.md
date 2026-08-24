# Quickstart

::: info Preview stage
`v0.1.0-rc.7` is published on npm under the **`rc` dist-tag** (`latest` stays reserved for the stable line, so install specs carry the `@rc` suffix). This page is the user install path; the contributor development install (checkout, link install, iteration loop) lives in the developer manual under [Contributing to Blue](/en/plugins/contributing).
:::

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 (needed for first assembly, upgrades, and `plugin` management; an already-calibrated profile does not check it on every boot. Run `npm i -g pnpm@11`, or `corepack enable && corepack prepare pnpm@11.7.0 --activate`) |
| dsh CLI | only for the direct-dsh path: `>=0.1.1-rc.2` (`npm i -g @deepseek-ai/dsh`; on the shell path the host ships with the package) |

## Install (preview)

**Recommended: the `blue` shell** (one command; ships the dsh host pinned to the tested line and installs Blue into its `blue` profile on first run through dsh's official pnpm profile manager). Install the shell with npm, not pnpm — pnpm's strict global layout does not link the nested host's dependencies, and boot fails with `ERR_MODULE_NOT_FOUND`:

```sh
npm i -g @dsh-blue/blue-cli@rc
blue
```

If the first run reports missing pnpm or a non-11 major:

```sh
npm i -g pnpm@11
# or: corepack enable && corepack prepare pnpm@11.7.0 --activate
```

The first `blue` run downloads the full dependency tree into the profile — hundreds of packages; expect minutes on slow links (the budget is ~20 minutes, and re-running `blue` resumes from the cache). npm itself is silent for most of its own install while resolving the tree — that stillness is normal, not a hang.

**Or install over your own dsh** (bring your own host — for existing dsh users):

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
dsh --profile blue
```

After installing, follow the two sections below — one key, then a first run; models, providers, themes, and API keys are covered in detail in [Configuration](/en/guide/config).

- During preview, every verified release advances both `rc` and `latest`, so a bare spec resolves to the same verified version. Use `@rc` when you want to state the preview channel explicitly; after the first stable release, `latest` points only to stable.
- Upgrading to a newer preview: shell users re-run `npm i -g @dsh-blue/blue-cli@rc` (reinstalling is the upgrade — the shell calibrates the profile's Blue to its own version and pins the host line with it); direct-dsh users type `/update` inside Blue (the in-app safe upgrade: pre-flight, snapshot, boot smoke, automatic rollback), or re-run the same `plugin add`.

## One key before you ride

**A single `DEEPSEEK_API_KEY` is all it takes to start using Blue** — the out-of-the-box default talks to the DeepSeek official API (route `deepseek-official`, default model `deepseek-v4-flash`); nothing else to configure:

```sh
export DEEPSEEK_API_KEY=sk-...        # or store it in ~/.dsh/.credentials.yaml, once and for all
```

Switching models, wiring custom gateways, theming, and more: [Configuration](/en/guide/config).

## First run

```sh
blue                        # interactive: welcome banner + input editor
blue fix the null deref on the login page    # run a task directly
# direct-dsh users: dsh --profile blue (the two are equivalent — the shell
# just manages the host and the profile for you)
```

A few things to try first:

- type `/` to see slash-command autocomplete, `/help` for the command and key overview;
- ask something and watch the streaming reply and tool cards;
- `/theme` to open the theme picker — arrow through `dark`/`light`/`ocean`/`paper` with a **live preview** of each palette (the banner whale gradient recolors with it; your draft survives);
- on exit, the last line is the **session epitaph**: the session id and a one-line resume command (a triple-click selects exactly it) — pick the conversation right back up next time.
