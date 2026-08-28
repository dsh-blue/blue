# 功能总览

Blue 是一棵 Cordis 插件树。Bundle 当前有 31 条 Blue 自有行：2 条宿主支撑行、8 条基线行、15 条增强行和 6 条装配行。

## 基线

`blue-api-host`、`blue-core`、`blue-theme-dark`、`blue-banner`、`blue-transcript`、`blue-status-basic`、`blue-conversation`、`blue-transcript-official` 组成 projection-backed renderer 基线。Conversation 由 Harness official projection 驱动，不再由 TUI 折叠 session events。

## 增强

- editor/attachment：`blue-editor-plus`、`blue-attachments`、`blue-paste-image`
- status：cwd、git、mode、title、context 五个 canonical `BlueStatusNode` producer
- bottom panes：activity、queue、todo、btw、agents 五个 canonical `BlueUiNode` producer，经私有 bottom-only composition 挂载
- public bridges：transcript bridge 把第三方 status node 接入 footer；core surface bridge 编译并托管 canonical pane/overlay
- status provider owner：按 `blue.statusProvider` 选择一个独占 footer provider，candidate 在未选中时保持 inert
- editor provider owner：按 `blue.editorProvider` 选择一个独占 editor shell，candidate 在未选中时保持 inert

这些 15 行可逐项移除。Tool diff/terminal/search/read/web 呈现来自 canonical `ToolPresentationModel.call/result` nodes，并直接经过 core compiler；不存在独立 intent row 或 frontend `View` adapter。

## plain-first

基线 + 装配段就是完整、自洽的 Blue UI。Blue 自己的增强同样走下游插件可用的缝注册——删掉整个增强段，bundle 照常启动照常工作。这让每一个增强行都经受"没有它世界是否更好"的检验，也是下游插件获得与内置功能同等地位的机制保证。

## 装配

`blue-interaction`、provider/public bridge、`blue-startup`、`blue-app` 和 `blue-plugin-session-bridge` 收口输入、命令、通知、启动、Agent driver 与公开 session capability。App 对 renderer 和第三方 facade 只提供 readonly session reader/projection values 和窄化 structured actions。

`blue-context`、`blue-remote`、`blue-openpencil`、`blue-lark` 是 validation-only packages，不是 bundle row。

## 继续阅读

- [流式会话与工具卡片](/features/streaming)
- [输入编辑器](/features/editor)
- [审批与问卷](/features/approval)
- [状态栏](/features/status-bar)
- [会话模式](/features/modes)
- [底部面板](/features/panes)
