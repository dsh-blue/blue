# Blue

[![CI](https://github.com/dsh-blue/blue/actions/workflows/ci.yml/badge.svg)](https://github.com/dsh-blue/blue/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](#usage)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220)](#usage)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-dsh--blue.dev-8B5CF6)](https://dsh-blue.dev/en/)

English | [中文](README.zh.md)

Blue is an interactive terminal UI (TUI) for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a `pi-tui` renderer mounted as an out-of-tree [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) plugin bundle on top of the `dsh-base` bundle. This repository contains fifteen workspace packages — eleven in the `0.1.1-rc.2` release set and four validation-only adapters — built and tested against the published Harness `0.1.1-rc.2` line.

<p align="center">
  <a href="https://dsh-blue.dev/blue-demo.mp4"><img src="docs/assets/demo.gif" width="720" alt="Blue demo — streaming transcript, tool cards, and dock panes"></a>
</p>
<p align="center"><i>Blue in action: streaming transcript, tool cards, and dock panes — <a href="https://dsh-blue.dev/blue-demo.mp4">watch the full demo video</a>.</i></p>

## Design philosophy

**A TUI is not a package — it is a Cordis plugin tree.** Every render component, interaction provider, command, and status entry is a separate plugin with its own fiber lifecycle: hot-swappable and omittable at will.

- **Registration is an effect** — mounts, provider registrations, and keybindings bind through `ctx.effect`/`ctx.on`, so unloading a plugin rolls everything back; HMR and session switching come free.
- **Dependency-derived loading** — plugins `inject` what they need and wait until the services exist; a provider hot-swap unloads and reloads its dependents automatically.
- **plain-first** — every non-trivial surface is a seam plus a plain default implementation. Blue's own enhancements register through the same seams as downstream plugins; the bundle with every enhancement row removed still boots and works.
- **One pi-tui import** — only `packages/core` imports `@earendil-works/pi-tui`, and no public contract mentions a pi-tui type.

The full story: [docs/blue-architecture.md](docs/blue-architecture.md) · decisions (ADR): [docs/blue-decisions.md](docs/blue-decisions.md) (both Chinese).

## Usage

> [!NOTE]
> This checkout stages the upcoming `0.1.1-rc.2` candidate. It remains
> unpublished until live acceptance and merge; npm's `rc` and `latest` tags
> continue to point to the previous public release.

Prerequisites: Node `^22.19 || >=24` and pnpm 11. The recommended launcher includes its tested dsh runtime.

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
dsh --profile blue
```

Or use the recommended one-command `blue` launcher; it carries the tested Harness tree as common and platform archives, so npm never resolves that graph during installation:

```sh
npm i -g @dsh-blue/blue-cli@rc
blue
```

Set `DEEPSEEK_API_KEY` before the first run. Key bindings and slash commands are listed live by `/help` and documented in the [key reference](https://dsh-blue.dev/en/reference/keys/) and [command reference](https://dsh-blue.dev/en/reference/commands/); the [quickstart](https://dsh-blue.dev/en/guide/) walks through the first run, and the [configuration guide](https://dsh-blue.dev/en/guide/config/) covers providers, models, and themes.

## Architecture

<!-- BEGIN diagram:blue-layers -->
<!-- single source 单一来源: docs/diagrams/blue-layers.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    ROOT["dsh 进程 — 一棵 Cordis 树<br/>Loader · Fiber 生命周期 · 事件/服务总线"]

    subgraph BASE["dsh-base 行 · Harness domain 插件"]
        HAR["agents · sessions · tools · approval<br/>commands · events"]
    end

    subgraph BLUE["Blue 行 — cordis.patch.yml 组合的 32 个 Fiber 插件（卸载回滚 · 可热替换 · 可省略）"]
        direction TB
        subgraph DOM["Domain 侧 — 唯一持有 Agent/Session 对象"]
            direction LR
            CONV["blue-conversation<br/>Harness 事件 → projection 投影"]
            APP["blue-app<br/>blueSessionReader · blueSessionActions"]
        end
        subgraph UI["UI 侧 — 只见 readonly 数据与 action"]
            direction TB
            FE["blue-api · blue-ui · blue-frontend<br/>UI wire/builders · readonly models · provider host"]
            ADP["blue-transcript · blue-interaction<br/>transcript · 命令 · 面板 · 状态栏 · dock"]
            KRN["blue-core — TUI kernel<br/>全树唯一 import pi-tui"]
            FE --> ADP
            ADP --> KRN
        end
        CONV -- "projection · 当前状态" --> FE
        APP -- "readonly snapshot" --> FE
        UI -- "action · 带 BlueResult 的写请求" --> DOM
    end

    TERM["终端 — pi-tui · ANSI · 键盘"]

    ROOT --> BASE
    ROOT --> BLUE
    HAR ==> CONV
    HAR ==> APP
    KRN --> TERM

    linkStyle 2,3,4 stroke:#2bc8e8,stroke-width:3px
```
<!-- END diagram:blue-layers -->

The runtime flow is `Harness domain -> projection/action boundary -> renderer-neutral models -> TUI feature plugins -> core`. Events state facts, projections hold current state, and actions are write requests with structured results; Blue never keeps a second agent truth, and Agent/Session objects never cross into renderers. The row-by-row bundle composition (29 Blue-owned rows over `dsh-base`) is documented in [the bundle guide](https://dsh-blue.dev/en/plugins/builtins/), and the feature tour is on [the website](https://dsh-blue.dev/en/features/).

## Documentation

- **User manual** — [quickstart](https://dsh-blue.dev/en/guide/) · [features](https://dsh-blue.dev/en/features/) · [key & command reference](https://dsh-blue.dev/en/reference/commands/) (中文: [指南](https://dsh-blue.dev/guide/) · [功能](https://dsh-blue.dev/features/) · [参考](https://dsh-blue.dev/reference/commands/))
- **Developer manual** — [writing a plugin](https://dsh-blue.dev/en/plugins/) · [seam reference](https://dsh-blue.dev/en/plugins/seams/) · [contributing](https://dsh-blue.dev/en/plugins/contributing/)
- **Harness handbook** — [dsh concepts, profiles, tools, MCP](https://dsh-blue.dev/en/dsh/)
- **Design documents** (Chinese, repo-internal) — the living/archived index is [docs/README.md](docs/README.md); repo-wide conventions live in [AGENTS.md](AGENTS.md) and each package's own `AGENTS.md`.

## License

[MIT](LICENSE). Every package under the `@dsh-blue` scope declares `license: MIT`.
