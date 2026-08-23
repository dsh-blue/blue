# Quickstart

::: info Preview stage
`v0.1.0-rc.4` is published on npm under the **`rc` dist-tag** (`latest` stays reserved for the stable line, so install specs carry the `@rc` suffix). This page is the user install path; the contributor development install (checkout, link install, iteration loop) lives in the developer manual under [Contributing to Blue](/en/plugins/contributing).
:::

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 (not needed on the `blue` shell path) |
| dsh CLI | only for the direct-dsh path: `>=0.1.1-rc.2` (`npm i -g @deepseek-ai/dsh`) |

## Install (preview)

**Recommended: the `blue` shell** (one command; ships the dsh host pinned to the tested line and installs Blue into its `blue` profile on first run):

```sh
npm i -g @dsh-blue/blue-cli@rc
blue
```

**Or install over your own dsh** (bring your own host — for existing dsh users):

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
dsh --profile blue
```

After installing, follow the two sections below — one key, then a first run; models, providers, themes, and API keys are covered in detail in [Configuration](/en/guide/config).

- The `@rc` suffix is required: preview releases only carry the `rc` dist-tag, so a bare spec — which resolves `latest` — finds nothing.
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
- `/theme light` to feel a hot theme switch (your draft survives).
