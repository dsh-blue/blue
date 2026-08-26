# Quickstart

::: info Preview stage
`v0.1.0-rc.8` is published on npm under the **`rc` dist-tag** (`latest` stays reserved for the stable line, so install specs carry the `@rc` suffix). This page is the user install path; the contributor development install (checkout, link install, iteration loop) lives in the developer manual under [Contributing to Blue](/en/plugins/contributing).
:::

## Prerequisites

| Dependency | Version |
| --- | --- |
| Node | `^22.19.0 \|\| >=24.0.0` |
| pnpm | 11 |
| dsh CLI | `>=0.1.1-rc.2` (`npm i -g @deepseek-ai/dsh`) |

## Install from npm (preview)

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
```

After installing, follow the two sections below — one key, then a first run; models, providers, themes, and API keys are covered in detail in [Configuration](/en/guide/config).

- The `@rc` suffix is required: preview releases only carry the `rc` dist-tag, so a bare spec — which resolves `latest` — finds nothing.
- Upgrading to a newer preview: re-run the same `plugin add` — the `@rc` spec re-resolves to the newest version.

## One key before you ride

**A single `DEEPSEEK_API_KEY` is all it takes to start using Blue** — the out-of-the-box default talks to the DeepSeek official API (route `deepseek-official`, default model `deepseek-v4-flash`); nothing else to configure:

```sh
export DEEPSEEK_API_KEY=sk-...        # or store it in ~/.dsh/.credentials.yaml, once and for all
```

Switching models, wiring custom gateways, theming, and more: [Configuration](/en/guide/config).

## First run

```sh
dsh --profile blue            # interactive: welcome banner + input editor
dsh --profile blue fix the null deref on the login page    # run a task directly
```

A few things to try first:

- type `/` to see slash-command autocomplete, `/help` for the command and key overview;
- ask something and watch the streaming reply and tool cards;
- `/theme light` to feel a hot theme switch (your draft survives).
