# Blue

[![CI](https://github.com/dsh-blue/blue/actions/workflows/ci.yml/badge.svg)](https://github.com/dsh-blue/blue/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-339933)](#quick-start)
[![pnpm](https://img.shields.io/badge/pnpm-11-F69220)](#quick-start)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-dsh--blue.dev-8B5CF6)](https://dsh-blue.dev/en/)

English | [中文](README.zh.md)

Blue is an interactive terminal UI (TUI) plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): a `pi-tui` renderer mounted as an out-of-tree [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) plugin bundle on top of the `dsh-base` bundle. Its core claim: **a TUI is not a package — it is a Cordis plugin tree.** Every render component, interaction provider, command, and status entry is a separate plugin with its own fiber lifecycle, hot-swappable and omittable.

This repository is the standalone home of Blue's five workspace packages under the `@dsh-blue` scope, extracted from the `deepseek-harness` monorepo (`packages/blue/*` and `packages/bundle/blue`). They build and test against the published npm releases of the harness (`0.1.1-rc.2` line) and vendored Cordis.

<p align="center"><img src="docs/assets/demo.gif" width="840" alt="Blue demo: typing a task, a command card, a streaming markdown reply, mode switching, the todo pane, and the command menu"></p>

## Contents

- [Quick start](#quick-start)
- [Features](#features) — [Key bindings](#key-bindings) · [Slash commands](#slash-commands)
- [Screenshots](#screenshots)
- [Positioning](#positioning)
- [Design philosophy](#design-philosophy)
- [Layered architecture](#layered-architecture)
- [The Editor seam, in brief](#the-editor-seam-in-brief)
- [Development](#development)
- [Documentation](#documentation)
- [Known limitations](#known-limitations)
- [Relationship to deepseek-harness](#relationship-to-deepseek-harness)
- [License](#license)

## Quick start

> [!NOTE]
> `0.1.0-rc.2` is the preview release, published under the **`rc` dist-tag** — `latest` stays reserved for the stable line, so install specs carry the `@rc` suffix.

Prerequisites: Node `^22.19 || >=24`, pnpm 11, and a `dsh` CLI ≥ `0.1.1-rc.2` (`npm i -g @deepseek-ai/dsh`).

### Install from npm

```sh
npm i -g @deepseek-ai/dsh
dsh plugin --profile blue add @dsh-blue/blue@rc
```

After installing, see the [quickstart](https://dsh-blue.dev/en/guide/) for launching and a first run; models, providers, themes, and API keys are covered in the [configuration guide](https://dsh-blue.dev/en/guide/config/).

The `@rc` suffix is required: preview releases only carry the `rc` dist-tag, so a bare spec — which resolves `latest` — finds nothing. Upgrading to a newer preview is the same `plugin add` again; the spec re-resolves.

## Features

- **Streaming transcript** — user/assistant messages rendered as Markdown while they stream; tool calls as cards, generic by default with dedicated cards for diffs (`intent-diff`) and terminal output (`intent-terminal`).
- **Input editor** — rounded-box editor with fuzzy slash-command autocomplete, argument ghost hints, `!` bash mode, `@` file completion, `#` skill completion, and Ctrl-V clipboard image paste.
- **Overlays** — four-option approval panel (with session-level "always allow" inheritance) and tabbed user-questionnaire overlays.
- **Two-row status footer** — model name, session-mode badge, git branch, context occupancy `ctx N`; entries are registry contributions, not hardcoded.
- **Bottom dock panes** — activity spinner while the agent runs, queued inbox messages, todo list, a `/btw` side-question pane that forks the live session, and the subagent-group pane.
- **Theming** — `/theme` hot-switching across `dark` / `light` / `auto` (OSC 11 background detection) / `custom` (JSON palette).
- **Extensible by construction** — commands, status entries, and editor enhancements register through the same seams downstream plugins use; the completion menu and `/help` reflect the live registry.

User-facing feature guides live on the documentation website: [dsh-blue.dev/en/features](https://dsh-blue.dev/en/features/) (English) · [dsh-blue.dev/features](https://dsh-blue.dev/features/) (中文).

### Key bindings

The `/help` overlay lists every registered binding live — it is the authoritative source:

| Key | Action |
| --- | --- |
| `Shift+Tab` | Cycle session mode: normal → plan → yolo (`/yolo` auto-approves tool calls; questions still pop) |
| `Ctrl-C` | Clear the draft → interrupt the agent; a second press within 1 s exits |
| `Ctrl-S` | Steer the running turn with the draft |
| `Ctrl-V` | Paste a clipboard image as an `[image #N]` marker |
| `Ctrl-O` | Expand/collapse the last 3 turns of tool output and thinking blocks |
| `Ctrl-T` | Fold/unfold the todo pane |
| `↑` (empty editor) | Recall the most recent queued inbox message |

In the editor, the prefixes `/` `!` `@` `#` trigger command, bash, file, and skill completion respectively; a `#name` token anywhere in the line rewrites to the upstream `/name` skill gesture on submit.

### Slash commands

All commands auto-list in the editor's completion menu; `/help` is the live truth:

| Command | Aliases | Description |
| --- | --- | --- |
| `/quit` | `/q` `/exit` | Exit Blue |
| `/new` | `/clear` | Start a new session |
| `/fork` | — | Fork the current session into a new one |
| `/sessions` | `/resume` | List persisted sessions and switch; an id resumes directly |
| `/btw` | — | Side question: fork the live session and ask |
| `/help` | — | Show available commands and key bindings |
| `/model` | — | Switch the session model (no argument opens the picker) |
| `/effort` | `/thinking` | Switch the thinking effort of the current model |
| `/provider` | — | List providers, switch the route, or add one |
| `/preset` | — | List agent presets or switch (blank sessions only) |
| `/yolo` | `/yes` | Toggle auto-approval of tool calls |
| `/tools` | — | List the tools visible to the current session |
| `/mcp` | — | Browse the MCP servers the host connects to (read-only) |
| `/skills` | — | List available skills (the `#` prompt invokes one) |
| `/theme` | — | Switch the color theme |
| `/init` | — | Analyze the codebase and write `AGENTS.md` |
| `/status` | — | Show the session header, model, and context status |
| `/context` | — | Show token usage and the context window |
| `/version` | — | Show the Blue and harness versions and the live model |
| `/export` | — | Export the current session as a Markdown file |
| `/copy` | — | Copy the last assistant message to the clipboard |

## Screenshots

From a scripted, fully reproducible recording (`pnpm demo:record && pnpm demo:render` — the same mock-LLM harness the smoke tests use):

| Boot with the banner | A turn: tool card + streaming reply | The command menu |
| --- | --- | --- |
| <img src="docs/assets/shot-banner.png" width="360" alt="Boot screen: braille-art banner, metadata block, empty rounded editor, two-row status footer"> | <img src="docs/assets/shot-conversation.png" width="360" alt="Conversation: the user task, a command card with its output, and a streaming markdown answer"> | <img src="docs/assets/shot-panels.png" width="360" alt="The slash-command dropdown with fuzzy matches and argument hints over the editor"> |

Feature walkthroughs with these surfaces in motion: [dsh-blue.dev/en/features](https://dsh-blue.dev/en/features/) (中文: [dsh-blue.dev/features](https://dsh-blue.dev/features/)).

## Positioning

**Versus standalone TUI agents** (Claude Code and friends): Blue is not an agent product — it is the interactive face of one. It runs no model loop of its own; it renders and drives DeepSeek Harness sessions. The claim it stakes is organizational — *a TUI is not a package, it is a plugin tree* — so every capability above is a row you can drop, hot-swap, or replace with your own plugin.

**Versus dsh's stock interaction**: Blue is an out-of-tree profile plugin. It implements the harness's interaction seams (approval, user questions, commands) and opens its own seams downstream — a third-party command, status entry, or editor enhancement registers through exactly the surfaces Blue's own enhancements use.

**For whom**: dsh users who want a polished, keyboard-first, themeable terminal front-end today — and plugin authors who want a TUI whose every surface is an extension point.

## Design philosophy

**A TUI is not a package; it is a Cordis plugin tree.** pi's own coding agent collapsed its pi-tui UI into a 6.5k-line `InteractiveMode` god class. Blue's core claim is the opposite organization:

- **Everything is a plugin** — render components, interaction providers, commands, status entries are all separate plugins with their own fiber lifecycles.
- **Registration is an effect** — component mounts, provider registrations, keybindings bind through `ctx.effect`/`ctx.on`, so plugin unload rolls everything back; HMR and session switching come free.
- **Seams with three roles** — every capability is split into definition / provider / consumer. Blue consumes the harness's seams (`agents`, `sessions`, `commands`, `userQuestions`, approval) and opens its own seams for downstream plugins ([docs/blue-seams.md](docs/blue-seams.md)).
- **Dependency-derived loading** — plugins `inject` what they need and wait until the services exist; a provider hot-swap unloads and reloads its dependents automatically.
- **plain-first** (ADR D21) — every non-trivial surface is a seam plus a plain default implementation. Blue's own enhancements register through the same seams as downstream plugins, and the bundle with every enhancement row removed still boots and works.
- **One pi-tui import** — only `packages/core` imports `@earendil-works/pi-tui`. Its breaking changes cannot propagate out of L0, and no contract mentions a pi-tui type.

The full architecture document is [docs/blue-architecture.md](docs/blue-architecture.md) (Chinese); decisions are recorded in [docs/blue-decisions.md](docs/blue-decisions.md).

## Layered architecture

<!-- BEGIN diagram:blue-layers -->
<!-- single source 单一来源: docs/diagrams/blue-layers.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    subgraph L4["L4 composition 组合层 — @dsh-blue/blue (bundle)"]
        patch["cordis.patch.yml — inserts the Blue rows over dsh-base"]
        app["blue-app · blue-startup — CLI startup + Agent driver"]
    end
    subgraph L3["L3 render 渲染插件 — @dsh-blue/blue-transcript · hot-swappable 可热替换、可省略"]
        fold["event folds → streamed Markdown + tool cards"]
        status["blueStatus registry + two-row footer shell"]
        dock["dock panes — activity · todo · btw · subagents"]
    end
    subgraph L2["L2 interaction 交互插件 — @dsh-blue/blue-interaction · implements harness seams"]
        input["blue-input — editor + completion"]
        cmds["blue-commands — built-in commands"]
        qa["blue-approval · blue-questions — overlays"]
        enh2["enhancements — editor-plus · paste-image · attachments · pane-queue · mode-status"]
    end
    subgraph L1["L1 kernel services 内核服务 — @dsh-blue/blue-core"]
        services["blueScreen · blueTheme · blueKeymap · blueComponents · blueTerminalInfo"]
    end
    subgraph L0["L0 pi-tui adapter 适配 — @dsh-blue/blue-core"]
        adapter["terminal lifecycle ↔ fiber binding — the tree's only pi-tui import"]
    end
    subgraph BASE["dsh-base host bundle 宿主"]
        seams["agents · sessions · commands · userQuestions · approval · agentPresets"]
    end
    pitui["pi-tui ^0.84.2 (npm)"]

    L4 --> L3
    L4 --> L2
    L3 --> L1
    L2 --> L1
    L1 --> L0
    L0 --> pitui
    L2 -. implements interaction seams 实现交互缝 .-> BASE
    L4 -. rides on 骑在 dsh-base 上 .-> BASE
```
<!-- END diagram:blue-layers -->

Dependencies are strictly one-way: `core ← transcript / interaction ← app ← bundle`.

| Package | Layer | Role |
| --- | --- | --- |
| [`@dsh-blue/blue-core`](packages/core) | L0 + L1 | The tree's only `@earendil-works/pi-tui` adapter: terminal lifecycle plus the `blueScreen` / `blueTheme` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` services. |
| [`@dsh-blue/blue-interaction`](packages/interaction) | L2 | Input editor, slash commands, approval and user-question overlays, the queued-inbox pane, plus enhancement subpath plugins (bash mode, image paste, attachments). |
| [`@dsh-blue/blue-transcript`](packages/transcript) | L3 | Folds session events into transcript items and renders them (streamed Markdown, tool cards), the `blueStatus` registry with its footer shell, and the dock panes (activity, todo, `/btw`, subagent group). |
| [`@dsh-blue/blue-app`](packages/app) | L4 | Command-line startup (`[task]`, `--resume <id>`) and the Agent driver publishing `blueSession`. |
| [`@dsh-blue/blue`](packages/bundle/blue) | L4 | The installable bundle: `cordis.patch.yml` inserts the Blue plugin rows over `dsh-base`. |

Each entry point is a Cordis plugin (`export const name`, optional `inject`, `apply(ctx)`); Cordis and the dsh service packages are `peerDependencies` provided by the host `dsh` installation.

**The same tree, seen from the bundle.** `cordis.patch.yml` inserts 23 Blue rows in three segments. The plain baseline (baseline + assembly, 8 rows) boots and works alone; every enhancement row — the whole dashed segment — is individually deletable, which is plain-first (ADR D21) as a picture:

<!-- BEGIN diagram:blue-composition -->
<!-- single source 单一来源: docs/diagrams/blue-composition.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    subgraph bundle["cordis.patch.yml — the 22 Blue rows · 22 条 Blue 行"]
        subgraph baseline["plain baseline 基线 — 8 rows, self-sufficient 自足"]
            core["blue-core"]
            theme["blue-theme-dark"]
            banner["blue-banner"]
            transcript["blue-transcript"]
            sbasic["blue-status-basic"]
            interaction["blue-interaction"]
            startup["blue-startup"]
            bapp["blue-app"]
        end
        subgraph enhancement["enhancement segment 增强段 — every row droppable 每行皆可删"]
            editorPlus["blue-editor-plus"]
            att["blue-attachments · blue-paste-image"]
            statusEnh["blue-status-cwd · -git · -mode · -title · -context"]
            intents["blue-intent-diff · -terminal"]
            panes["blue-pane-activity · -queue · -todo · -btw · -agents"]
        end
    end
    dshbase["dsh-base — agent-plane rows disabled, agents composed behind agent-presets"]
    bundle -.-> dshbase

    classDef optional stroke-dasharray: 4 4;
    class editorPlus,att,statusEnh,intents,panes optional;
```
<!-- END diagram:blue-composition -->

Dock order is plugin-row order — activity → queue → todo → btw → subagents, the editor mounting last. The host's agent plane (tools, plan mode, …) is disabled process-wide and re-composed per agent behind presets (ADR D37 thin host); `/preset` switches the composition.

## The Editor seam, in brief

The input editor walks the whole philosophy in four roles, with no shortcuts between layers:

- **Contract (L1)** — `BlueEditor` is an interface in `packages/core/src/types.ts` that mentions no pi-tui type and no harness type, on purpose.
- **Implementation (L0)** — the only way to obtain one is `ctx.blueComponents.createEditor()`; inside core, an adapter wraps the pi-tui `Editor` and is the only code that knows pi-tui is involved. A future vim-mode editor could implement the same interface without any consumer noticing.
- **Consumer (L2)** — the `blue-input` plugin creates the editor, mounts it, and publishes it through the shared-editor seam, so later plugins find it regardless of row order.
- **Enhancements (L2 subpath plugins)** — `blue-editor-plus` (bash mode, autocomplete providers) and `blue-paste-image` (Ctrl-V markers) are rows in `cordis.patch.yml`: delete either and the plain editor keeps working.

Full walkthrough with code: [docs/blue-editor-walkthrough.md](docs/blue-editor-walkthrough.md) (Chinese). The complete seam catalog — every seam Blue opens, its contract, its plain default: [docs/blue-seams.md](docs/blue-seams.md).

## Development

```sh
pnpm run test           # vitest: unit suites plus the bundle's whole-tree e2e
pnpm run test:coverage  # per-file 100% gate on packages/*/src
pnpm run build          # tsc -b emits lib/types, tsdown bundles lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

Tests run from source: specs import the package under test through relative `../src/*.ts` paths, and every `@deepseek-ai/*` dependency resolves from `node_modules`.

Development install (from a checkout, link-based) and the edit → build → re-run loop live in the contributor guide on the docs site: [dsh-blue.dev/en/plugins/contributing](https://dsh-blue.dev/en/plugins/contributing/) (中文: [dsh-blue.dev/plugins/contributing](https://dsh-blue.dev/plugins/contributing/)).

## Documentation

**User-facing docs** are on the website: <https://dsh-blue.dev/> (中文) · <https://dsh-blue.dev/en/> (English). The design documents below remain repo-internal.

**Design documents** (Chinese) live under [docs/](docs/); the living/archived index is [docs/README.md](docs/README.md):

- [docs/blue-architecture.md](docs/blue-architecture.md) — architecture: philosophy, L0–L4 layers, stability rules.
- [docs/blue-seams.md](docs/blue-seams.md) — the seam catalog: every seam Blue opens (contracts, plain defaults) and which Blue plugin implements each harness-side visual surface.
- [docs/blue-editor-walkthrough.md](docs/blue-editor-walkthrough.md) — the Editor seam worked example: four roles, with code.
- [docs/blue-decisions.md](docs/blue-decisions.md) — decision records (ADR).
- [docs/blue-roadmap.md](docs/blue-roadmap.md) and [docs/blue-commands-plan.md](docs/blue-commands-plan.md) — roadmap, and the built-in slash-command implementation checklist (four-harness reference merge, capability matrix, phasing).
- [AGENTS.md](AGENTS.md) plus each package's own `AGENTS.md` — the authoritative description of the current code (repo-wide conventions at the root; per-package implementation detail in `packages/*/AGENTS.md`).

Archived phase designs and surveys (MVP, P1, P2, pi-tui/harness selection) are under [docs/history/](docs/history/).

## Known limitations

Preview-honest list — the full parked log lives in [docs/blue-roadmap.md](docs/blue-roadmap.md):

- **Main-screen scrolling**: while output streams, dragging the terminal's own scrollback can fight the live conversation (Blue renders on the main screen by design; alt-screen gating is parked).
- **No desktop notifications** yet — bell / OSC 9 / focus tracking are parked.
- **No inline diff preview in the approval panel** yet — the diff card component exists, the wiring does not.
- **Tool output is not streamed**: cards render when the tool completes (the harness has no streaming tool-output seam yet).
- **No in-place rewind (Esc-Esc) or task backgrounding (Ctrl+B)** — both wait on harness primitives.
- **Preview semantics**: packages carry the `rc` dist-tag and pin the harness line, so breaking changes between previews are possible; pnpm 11's `minimumReleaseAge` can resolve `@rc` to the previous version during the first day after a publish (see the [FAQ](https://dsh-blue.dev/en/guide/faq/)).

## Relationship to deepseek-harness

- Runtime and test dependencies (`@deepseek-ai/cordis` 4.0.1, `@deepseek-ai/dsh-*` 0.1.1-rc.2, `@earendil-works/pi-tui` ^0.84.2) come from the npm registry. Blue's own packages publish to npm in lockstep under the `rc` dist-tag — `latest` stays reserved for the stable line: [`@dsh-blue/blue`](https://www.npmjs.com/package/@dsh-blue/blue) plus its library packages at 0.1.0-rc.2; the public-contract package `@dsh-blue/blue-api` joins the set at the next release.
- The harness's repository gates (documentation i18n pairing, README gates, snapshot/e2e lanes) do not apply here; this repo keeps the build, the full test suite, and the per-file 100% src coverage gate.

## License

[MIT](LICENSE). Every package under the `@dsh-blue` scope declares `license: MIT`.
