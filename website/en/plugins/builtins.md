# Built-in plugins

The installable Blue bundle contains 28 Blue-owned rows: two host-support rows and 26 product rows split into baseline, enhancement, and assembly segments. External plugins integrate through the renderer-neutral public API; internal rows connect through explicit `inject` dependencies and model/action seams.

The patch actually carries a 29th insert row — the Harness package `session-title-all-prompts-llm` (the title-cadence swap: the base's `session-title-llm`, which titles once from the first prompt, is disabled in favor of re-titling on every user message, so a mis-derived title self-corrects on the next one). It is a Harness row, not a Blue-owned one, so the 28-row count above excludes it.

<!-- BEGIN diagram:blue-composition -->
<!-- single source 单一来源: docs/diagrams/blue-composition.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    subgraph bundle["cordis.patch.yml - 28 Blue-owned rows · 28 条 Blue 自有行"]
        subgraph host["host support 宿主支撑 - 2 rows"]
            presets["blue-agent-presets"]
            creative["blue-creative-host"]
        end
        subgraph product["product UI 产品 UI - 26 rows"]
            subgraph baseline["baseline 基线 - 8 rows"]
                api["blue-api-host"]
                core["blue-core · blue-theme-dark"]
                chrome["blue-banner · blue-transcript · blue-status-basic"]
                conversation["blue-conversation · blue-transcript-official"]
            end
            subgraph enhancement["enhancement 增强 - 14 droppable rows"]
                editorPlus["blue-editor-plus"]
                att["blue-attachments · blue-paste-image"]
                statusEnh["blue-status-cwd · -git · -mode · -title · -context"]
                panes["blue-pane-activity · -queue · -todo · -btw · -agents"]
                viewBridge["blue-plugin-view-bridge"]
            end
            subgraph assembly["assembly 装配 - 4 rows"]
                interaction["blue-interaction · blue-plugin-interaction-bridge"]
                startup["blue-startup · blue-app"]
            end
        end
    end
    validation["validation-only, not bundle rows\nblue-context · blue-remote · blue-openpencil · blue-lark"]
    dshbase["dsh-base - agent plane composed behind presets"]
    bundle -.-> dshbase

    classDef optional stroke-dasharray: 4 4;
    class editorPlus,att,statusEnh,panes,viewBridge,validation optional;
```
<!-- END diagram:blue-composition -->

## Host support (2 rows)

| Plugin | Description |
|---|---|
| `blue-agent-presets` | Blue-owned preset root composing the standard/ptc/minimal agent planes |
| `blue-creative-host` | isolated dynamic Cordis host whose only UI route is the public plugin host |

## Baseline (8 rows)

These eight rows plus assembly form the minimum usable UI. The conversation producer and consumer are baseline because no legacy event fold remains.

| Plugin | Description |
|---|---|
| `blue-api-host` | manifest validation and capability-scoped command/status/dock/notification registries |
| `blue-core` | only pi-tui/raw-terminal adapter; screen, keymap, components, and terminal facts |
| `blue-theme-dark` | default dark theme provider |
| `blue-banner` | startup welcome banner |
| `blue-transcript` | transcript/status/dock/tool model hosts and TUI renderer |
| `blue-status-basic` | model-name footer `StatusModel` producer |
| `blue-conversation` | official append-origin conversation and shared-facts projections |
| `blue-transcript-official` | semantic consumer of whole projection snapshots/change feeds |

## Enhancements (14 rows)

| Plugin | Description |
|---|---|
| `blue-editor-plus` | bash mode, slash/`@`/`#` completion, and argument hints |
| `blue-attachments` | bounded filesystem image store |
| `blue-paste-image` | Ctrl-V clipboard paste with `[image #N]` markers, split into image blocks on submit (a reversible submit transformation) |
| `blue-status-cwd` | current session cwd (deep-path shortening) |
| `blue-status-git` | TTL-cached git badge `branch [+a -d ↑u↓v]` |
| `blue-status-mode` | plan/yolo mode badge |
| `blue-status-title` | projected session title |
| `blue-status-context` | projected context occupancy |
| `blue-pane-activity` | projection-backed activity model |
| `blue-pane-queue` | app-action-backed queued-message model |
| `blue-pane-todo` | projection-backed todo model (Ctrl-T collapse toggle, auto-close when all done) |
| `blue-pane-btw` | `/btw` side-question pane: fork the live session for a by-the-way question (opaque owned side-session action plus official projection) |
| `blue-pane-agents` | projected subagent-group model (last dock row, the kimi swarm-pane semantics) |
| `blue-plugin-view-bridge` | public status/dock contributions into owner model registries |

## Assembly (4 rows)

| Plugin | Description |
|---|---|
| `blue-interaction` | editor, commands, panels, and question/approval providers |
| `blue-plugin-interaction-bridge` | public command/notification contributions into Harness/editor consumers |
| `blue-startup` | `[task]` and `--resume` startup values |
| `blue-app` | Agent driver providing readonly session reader/projections and structured actions |

## Validation-only packages

`blue-context` and `blue-remote` prove adapter architecture through independent fixtures; `blue-openpencil` and `blue-lark` are exercised by their own vitest suites plus the dev-profile link. None of the four are bundle rows or enter the release dependency closure.

A profile patch can customize composition. Removing a projection-backed baseline row removes a core product capability; the 14 enhancement rows are the layer designed for independent removal.
