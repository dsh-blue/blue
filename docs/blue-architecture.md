# Blue 架构设计

> 本文描述当前 frontend-runtime cutover 架构。历史阶段设计保存在 `docs/history/`；旧 `blueSession`、event fold、`blueStatus` 和 `blueIntents` 方案已被本架构取代。

## 1. 核心方向

Blue 把 Harness domain 转换为 renderer-neutral frontend model，再由 TUI adapter 呈现：

```text
Harness domain -> projection/action boundary -> frontend model -> TUI adapter -> terminal
```

Harness 继续拥有 Agent、Session、工具、持久化、权限、模型路由和业务事件。Blue 不保存第二套 Agent 真相。事件表示已经发生的事实，projection 表示当前状态，action 表示带结构化结果的写请求。

## 2. 分层

<!-- BEGIN diagram:blue-layers -->
<!-- single source 单一来源: docs/diagrams/blue-layers.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    subgraph C["Composition 组合 - @dsh-blue/blue"]
        patch["cordis.patch.yml · presets · explicit inject ordering"]
    end
    subgraph H["Harness domain 宿主领域"]
        harness["agents · sessions · projections · commands · tools · approval"]
    end
    subgraph D["Domain and action boundary 领域与动作边界"]
        conversation["blue-conversation\nblueConversation + blueConversationFacts"]
        app["blue-app\nreadonly session reader/projections + structured actions"]
    end
    subgraph F["Renderer-neutral frontend runtime"]
        api["blue-api\nmanifest · capability-scoped contributions"]
        models["blue-frontend\nreadonly status · dock · transcript · editor models"]
    end
    subgraph R["TUI feature adapters TUI 功能适配"]
        transcript["blue-transcript\nprojection/model consumers · footer · dock"]
        interaction["blue-interaction\ncommands · panels · tree-scoped editor state"]
    end
    subgraph K["TUI kernel - @dsh-blue/blue-core"]
        core["blueScreen · blueTheme · blueKeymap · blueComponents · width truth"]
    end
    pitui["pi-tui · raw terminal"]

    H --> D
    D --> F
    F --> R
    R --> K
    K --> pitui
    C -. composes .-> H
    C -. composes .-> D
    C -. composes .-> R
```
<!-- END diagram:blue-layers -->

依赖方向是单向的：

- `blue-conversation` 是 Harness-domain projection，不依赖 frontend 或 renderer。
- `blue-app` 独占 Agent/Session 对象，只向外提供 readonly reader/projection values 和 structured actions。
- `blue-api`、`blue-frontend` 只包含 renderer-neutral contract/model/provider lifecycle。
- `blue-transcript` 与 `blue-interaction` 把 model/action 适配到 TUI feature。
- `blue-core` 是全树唯一 pi-tui、ANSI、raw terminal、focus、layout 和 width-truth owner。
- `blue` bundle 只负责 composition、preset、disable list 和显式依赖顺序。

`blue-context`、`blue-remote`、`blue-openpencil`、`blue-lark` 是 validation-only package，不进入正式 bundle dependency closure。

## 3. 数据流

### Conversation 与 transcript

```text
session/event
  -> blue-conversation (official SessionProjectionRegistry)
  -> blueConversation + blueConversationFacts
  -> app blueSessionProjections values/seq boundary
  -> official transcript / SessionFactsService
  -> TranscriptModel + StatusModel + DockModel
  -> transcript TUI components
```

只有 domain/app owner 可以观察原始 session events。Transcript、status 和 pane 不折叠 event log。`blueConversation` 覆盖 user/assistant/thinking/tool/image/error/interruption/retraction 的 replay/live 收敛；`blueConversationFacts` 覆盖 phase、usage、todo、request model 和 child-agent call facts。

### Interaction 与写请求

```text
input / command / panel
  -> blueSessionActions or public Blue action
  -> app-owned Agent operation
  -> Harness durable event/projection
  -> model refresh
```

Renderer 不持有 Agent/Session。切换、followup、steer、interrupt、mode/model/preset/tool/skill、rewind 和 side-session 操作都经过 app action boundary。会话切换以 reader epoch 和 projection seq 驱逐旧 callback。

### 外部插件

```text
manifest
  -> bluePluginHost.open()
  -> capability-scoped status/dock/command/notification contribution
  -> owner bridge
  -> standard model registry / Harness command registry / notice consumer
```

第三方 contribution 与内置 consumer 使用同一 renderer-neutral view vocabulary，但不能访问 Loader、root renderer、Agent 或 Session。

## 4. Scope 与生命周期

| Scope | Owner state |
|---|---|
| host | plugin contribution registries、models/credentials/MCP registries |
| agent | tool/persona/preset composition，始终留在 Harness/app owner |
| session | official projection cells、durable actions 和 watermark |
| frontend tree | editor host、draft、alias/settings cache、paste state、transcript presentation policy |
| provider Fiber | subscription、timer、abort controller、renderer component cache |

Provider swap 必须遵循 `capture -> abort -> dispose -> activate -> restore`。每个 async callback 都检查 generation/session epoch；卸载后不得重新挂载 UI 或写入替换 session。

## 5. Renderer 边界

`blue-core` 提供 `blueScreen`、`blueKeymap`、`blueComponents`、`blueTerminalInfo` 和 theme provider。其它包不得 import pi-tui 或自行实现 visible-width math。

`blue-transcript` 拥有：

- semantic `TranscriptModelService` 与最多 200 项的 renderer reconciliation；
- `BlueStatusModelService` 两行 footer；
- `BlueDockModelService` 的 left/right/bottom lane；
- canonical tool presentation conversion；
- frontend-tree-scoped `TranscriptPresentationPolicy`。

`blue-interaction` 拥有：

- input/editor 与通用 panel components；
- frontend-tree-scoped `EditorHostService` 和 `InteractionStateService`；
- command/question/approval workflows；
- abort、unload 和 late-result rejection。

旧 `fold.ts`、`BlueStatusEntry`、`blueIntents`、intent subpath、child event tracker 和 shared-editor singleton 已删除。

## 6. 包职责

| Package | Role |
|---|---|
| `@dsh-blue/blue-api` | 稳定 manifest、`BlueResult`、readonly public views 与 capability-scoped plugin host |
| `@dsh-blue/blue-frontend` | readonly command/panel/status/dock/editor/transcript/tool/theme models 与 provider host |
| `@dsh-blue/blue-harness-adapter` | session/projection/action/model/question 的窄兼容 adapter |
| `@dsh-blue/blue-conversation` | append-origin conversation 与 shared facts official projections |
| `@dsh-blue/blue-app` | CLI startup、Agent driver、session reader/projection/action boundary |
| `@dsh-blue/blue-core` | 唯一 TUI kernel 与 terminal adapter |
| `@dsh-blue/blue-transcript` | transcript/status/dock/tool model consumer 与 TUI renderer |
| `@dsh-blue/blue-interaction` | editor、commands、panels、question/approval 与 tree-scoped interaction state |
| `@dsh-blue/blue` | installable composition、thin-host preset 和 row-order assertions |
| `@dsh-blue/blue-cli` | standalone launcher 与 profile calibration |

## 7. Bundle composition

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

28 条 Blue 自有行由 2 条 host-support 和 26 条 product row 组成。产品段内：

- baseline 8 行，包含 conversation projection 与 official transcript consumer；
- enhancement 14 行，可逐项移除；
- assembly 4 行，提供 interaction、public bridge、startup 与 app。

Dock 的稳定顺序由 model priority/id 加显式 row-level `inject` 共同约束，不依赖 Cordis sibling 碰巧按文件顺序完成。

## 8. 验证门禁

每个新 surface 必须同时有 official consumer、headless fixture、unload/swap、replay/late-result、width scan、bundle composition 和 real-profile evidence。Subpath export 必须同步 package `exports`、`files` 和 `tsdown.config.ts`。完整 cutover 状态见 [blue-runtime-cutover-ledger.md](./blue-runtime-cutover-ledger.md)。
