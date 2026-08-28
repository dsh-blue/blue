# Built-in plugins

The installable Blue bundle contains 31 Blue-owned rows: two host-support rows and 29 product rows split into baseline, enhancement, and assembly segments. External plugins integrate through the renderer-neutral public API; internal rows connect through explicit `inject` dependencies and model/action seams.

The patch actually carries a 32nd insert row — the Harness package `session-title-all-prompts-llm` (the title-cadence swap: the base's `session-title-llm`, which titles once from the first prompt, is disabled in favor of re-titling on every user message, so a mis-derived title self-corrects on the next one). It is a Harness row, not a Blue-owned one, so the 31-row count above excludes it.

<!-- BEGIN diagram:blue-composition -->
<!-- single source 单一来源: docs/diagrams/blue-composition.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    subgraph bundle["cordis.patch.yml - 31 Blue-owned rows · 31 条 Blue 自有行"]
        subgraph host["host support 宿主支撑 - 2 rows"]
            presets["blue-agent-presets"]
            creative["blue-creative-host"]
        end
        subgraph product["product UI 产品 UI - 29 rows"]
            subgraph baseline["baseline 基线 - 8 rows"]
                api["blue-api-host"]
                core["blue-core · blue-theme-dark"]
                chrome["blue-banner · blue-transcript · blue-status-basic"]
                conversation["blue-conversation · blue-transcript-official"]
            end
            subgraph enhancement["enhancement 增强 - 15 droppable rows"]
                editorPlus["blue-editor-plus"]
                att["blue-attachments · blue-paste-image"]
                statusEnh["blue-status-cwd · -git · -mode · -title · -context"]
                panes["blue-pane-activity · -queue · -todo · -btw · -agents"]
                viewBridge["blue-plugin-view-bridge"]
                statusOwner["blue-status-provider-owner"]
            end
            subgraph assembly["assembly 装配 - 6 rows"]
                interaction["blue-interaction · blue-plugin-interaction-bridge"]
                editorOwner["blue-editor-provider-owner"]
                startup["blue-startup · blue-app"]
                sessionBridge["blue-plugin-session-bridge"]
            end
        end
    end
    validation["validation-only, not bundle rows\nblue-context · blue-remote · blue-openpencil · blue-lark"]
    dshbase["dsh-base - agent plane composed behind presets"]
    bundle -.-> dshbase

    classDef optional stroke-dasharray: 4 4;
    class editorPlus,att,statusEnh,panes,viewBridge,statusOwner,validation optional;
```
<!-- END diagram:blue-composition -->

## Host support (2 rows)

| Plugin | Description |
|---|---|
| `blue-agent-presets` | Blue-owned preset root composing the standard/code/minimal agent planes |
| `blue-creative-host` | isolated dynamic Cordis host whose only UI route is the public plugin host |

## Baseline (8 rows)

These eight rows plus assembly form the minimum usable UI. The conversation producer and consumer are baseline because no legacy event fold remains.

| Plugin | Description |
|---|---|
| `blue-api-host` | manifest validation and scoped registries for all eight public capabilities |
| `blue-core` | only pi-tui/raw-terminal adapter; screen, keymap, components, and terminal facts |
| `blue-theme-dark` | default dark theme provider |
| `blue-banner` | startup welcome banner |
| `blue-transcript` | transcript model, canonical status/bottom-pane hosts, tool model, and TUI renderer |
| `blue-status-basic` | model-name footer canonical status-node producer |
| `blue-conversation` | official append-origin conversation and shared-facts projections |
| `blue-transcript-official` | semantic consumer of whole projection snapshots/change feeds |

## Enhancements (15 rows)

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
| `blue-plugin-view-bridge` | public additive status contributions into the footer owner registry |
| `blue-status-provider-owner` | exclusive status-provider selection, session/settings handoff, and fallback lifecycle owner |

## Assembly (6 rows)

| Plugin | Description |
|---|---|
| `blue-interaction` | editor, commands, panels, and question/approval providers |
| `blue-editor-provider-owner` | selects the exclusive editor shell through `blue.editorProvider`, preserving the editor engine and owning fallback/rollback |
| `blue-plugin-interaction-bridge` | public command/notification/editor-extension contributions into Harness/editor consumers |
| `blue-startup` | `[task]` and `--resume` startup values |
| `blue-app` | Agent driver providing readonly session reader/projections and structured actions |
| `blue-plugin-session-bridge` | attaches the app's strict reader/requester facets as public `session.read` / `session.act` |

## Validation-only packages

`blue-context` and `blue-remote` prove adapter architecture through independent fixtures; `blue-openpencil` and `blue-lark` are exercised by their own vitest suites plus the dev-profile link. None of the four are bundle rows or enter the release dependency closure.

A profile patch can customize composition. Removing a projection-backed baseline row removes a core product capability; the 15 enhancement rows are the layer designed for independent removal.
