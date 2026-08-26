# 功能总览

Blue 是一棵 Cordis 插件树。Bundle 当前有 28 条 Blue 自有行：2 条宿主支撑行、8 条基线行、14 条增强行和 4 条装配行。

## 基线

`blue-api-host`、`blue-core`、`blue-theme-dark`、`blue-banner`、`blue-transcript`、`blue-status-basic`、`blue-conversation`、`blue-transcript-official` 组成 projection-backed renderer 基线。Conversation 由 Harness official projection 驱动，不再由 TUI 折叠 session events。

## 增强

- editor/attachment：`blue-editor-plus`、`blue-attachments`、`blue-paste-image`
- status：cwd、git、mode、title、context 五个 `StatusModel` producer
- dock：activity、queue、todo、btw、agents 五个 `DockModel` producer
- public view bridge：把第三方 status/dock `BlueView` 接入 owner registry

这些 14 行可逐项移除。Tool diff/terminal/search/read/web 呈现来自 canonical `ToolPresentationModel`，不存在独立 intent row。

## 装配

`blue-interaction`、`blue-plugin-interaction-bridge`、`blue-startup` 和 `blue-app` 收口输入、命令、通知、启动与 Agent driver。App 对 renderer 只提供 readonly session reader/projection values 和 structured actions。

`blue-context`、`blue-remote`、`blue-openpencil`、`blue-lark` 是 validation-only packages，不是 bundle row。

## 继续阅读

- [流式会话与工具卡片](/features/streaming)
- [输入编辑器](/features/editor)
- [审批与问卷](/features/approval)
- [状态栏](/features/status-bar)
- [会话模式](/features/modes)
- [底部面板](/features/panes)
