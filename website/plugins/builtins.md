# 内置插件

Blue bundle 在 `dsh-base` 上插入 36 个普通 Cordis sibling：6 个 dsh 支撑行
与 30 个 Blue product 行。不存在 group/isolate 或私有 service realm。

<!-- BEGIN diagram:blue-composition -->
<!-- single source 单一来源: docs/diagrams/blue-composition.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    BASE["dsh-base"]
    subgraph GRAPH["flat Cordis sibling graph · 36 inserted rows"]
        SUPPORT["dsh support · 6 rows<br/>subagent settings · presets · host runner<br/>workspace · session controller · title"]
        API["blue-api<br/>four direct UI registries"]
        APP["blue-conversation · blue-startup · blue-app"]
        VIEW["blue-frontend · blue-core · theme"]
        PRODUCT["transcript · status · panes · editor · interaction"]
        PLUGINS["external Cordis plugins"]
    end
    NATIVE["native dsh services"]

    BASE --> NATIVE
    NATIVE --> SUPPORT
    NATIVE --> APP
    NATIVE --> PRODUCT
    NATIVE --> PLUGINS
    API --> VIEW
    API --> PRODUCT
    API --> PLUGINS
    APP --> PRODUCT
    VIEW --> PRODUCT
```
<!-- END diagram:blue-composition -->

## 支撑行

- subagent model settings、agent presets；
- dynamic Cordis host runner；
- session controller；
- all-prompts title provider。

## Blue 行

- `blue-api`：四个直接 UI registry；
- `blue-frontend`、`blue-core`、dark theme；
- `blue-conversation`、startup、app/current Agent；
- banner、transcript、official model；
- basic/cwd/git/title/context/mode/jobs/goal status；
- activity/queue/todo/BTW/agents/workflow pane；
- jobs 与 agents command、attachments、paste image、editor-plus、interaction。

外部 plugin row 与这些行处于同一 service graph。启动依赖全部由 `inject`
决定，而不是 YAML 行序。任何内置 status/pane 都使用与外部插件相同的
`blueStatus`/`bluePanes` registry。
