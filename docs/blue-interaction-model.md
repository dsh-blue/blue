# Blue Interaction Model

> Renderer-neutral 交互协议。本文不实现 Web，也不把 pi-tui 类型变成公共 API；Blue 当前只提供 TUI renderer。

## 分层

```text
Domain data       TodoItem / ToolRun / ModelInfo / ContextUsage
Interaction model Command / Panel / Status / Dock / Notification
Renderer model    pi-tui component / React element / DOM / ANSI rows
```

共享 frontend model 只到第二层。它是 readonly 数据和结构化动作描述，不包含 focus handle、terminal width、ANSI、React ref、键位解释或 Promise。

## 首批模型

- `TextView`、`RichTextView`、`FieldsView`、`SectionsView`、`ListView`、`CodeView`、`DiffView`；
- `CommandModel`：名称、描述、参数 schema、可用状态、执行 action；
- `PanelModel`：select、form、info、loading、error、submit/cancel action；
- `StatusModel`：纯文本/字段、优先级、band、可见条件；
- `DockModel`：placement、优先级、建议行数、折叠状态和 view；
- `NotificationModel`：severity、plain message、duration、dedupe key；
- `ProviderModel`：provider id、capabilities、可迁移的 renderer-neutral state。

TUI renderer 负责布局、输入、焦点、宽度、主题和 fallback。模型提交 action 后由 domain/action runtime 执行，结果再通过 projection 或 notification 回流。

## Provider 替换

provider host 持续存活；替换流程为 `capture -> abort -> dispose -> activate -> restore`。provider 不得拒绝卸载；状态迁移 best-effort；激活失败回退 plain provider，只影响该 surface，不影响 Agent loop。

Editor、theme、transcript 和主 panel provider 使用同一生命周期规则，但各自拥有窄 contract，不合并成万能 provider。

