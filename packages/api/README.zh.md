# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue Cordis 插件的稳定、renderer-independent 公共契约。本包不含 renderer、终端或 Harness 服务代码。它定义 manifest、结构化结果、安全内容叶 `BlueView`、声明式 `BlueUiNode`、语义事件、surface/provider 契约和 `bluePluginHost` admission 服务，并持有所有 Blue release 包对齐的 `BLUE_VERSION` 常量。

## Manifest 与 capability

插件声明 `{ id, api, capabilities }`，由 `validateBlueManifest` 在不执行插件代码的情况下校验。`api` 面向独立的 Blue API `1.x` 协议，通常写 `^1.0.0`，不跟随产品的 `0.1.x` 版本。

目标 capability 为 `commands`、`notifications`、`status`、`panes`、`overlays`、`editor.extensions`、`session.read`、`session.act`、`status.provider` 与 `editor.provider`。已删除的 `dock`、`panels`、`editor`、`tools` 返回带具体迁移说明的 `BLUE_LEGACY_CAPABILITY`。`tools` 没有替代项，因为公共 tool presentation 没有 registry 或 owner。

`bluePluginHost.open(ctx, manifest)` 直接接受插件真实的 Cordis `Context`，先校验 manifest，再返回只暴露所请求表面的 capability-scoped `BluePluginApi`。所有 registration 都绑定该 Cordis effect：插件卸载即释放全部贡献。跨消费者重复的 contribution id 会被拒绝，Blue 的 owner 命名空间（`blue.`、`blue:`、`blue-`、`@dsh-blue/`）被保留。

## UI 契约

`BlueUiNode` 保留 `BlueView` 作为经过清洗的 text/fields/code/diff/sections 内容叶，并增加 rich text、stack、surface、scroll、tabs、list、form、actions、loader、empty、progress、spacer 和 divider。响应式显示只存在于 `BlueUiChild.when`，并相对于获配的 surface viewport 计算。

node、event payload 和 snapshot 是 readonly、JSON-shaped 数据；`render`、`onEvent`、`AbortSignal` 和 registration handle 是进程内执行边界。插件只收到语义事件，不接触 raw key。value/selection/tab change 按 control latest-wins；activate/submit/dismiss 按 surface FIFO。revision、abort、timeout 和合并 refresh 由 Blue 托管。

`BlueStatusNode` 递归只允许 text、rich text、fields、progress 和 stack，`BluePluginApi.status` 已由最终 additive registry 实现。host 同时接纳 pane、overlay、editor extension 和 status/editor provider 候选。每个 contribution 在滚动一秒内最多成功 refresh 20 次，同 tick 调用会合并 owner 通知。capturing overlay 必须携带 host 为 owner 创建的 `BlueUserGesture`；proof 只消费一次，owner 卸载时其未消费 proof 全部失效。

`BlueEditorShellNode` 是 provider-only 独立树，包含 `editor-control` slot；普通 `BlueUiNode` 无法构造该 slot。provider registration 只校验 callback 形状，不调用 `render`、不检查其返回树，也不选择 winner；只有 Blue 持有的用户配置能激活 inert candidate。`session.read` 与 `session.act` 在真正的 owner/API seam 能提供 snapshot 与 action 保证前继续拒绝。

Editor extension 可贡献静态辅助行、提示、诊断、结构化 action、completion 和异步 submit transform。`before` 与 `after` 保留 G1 的 `BlueUiNode` 源码类型，而 registration 只接纳递归的被动 `BlueEditorExtensionNode` 子集：text/rich-text/fields/code/diff/sections/progress/spacer/divider 加 stack/surface；交互控件会以 `BLUE_INVALID_CONTRIBUTION` 拒绝，extension action 通过独立的 `actions` + `onEvent` 路径处理。兼容 `complete` callback 只接收 `/`、`@` 和手动请求；插件通过 `completeV2` 与 `BlueEditorCompletionRequestV2` 显式选择接收 `#`，两者同时存在时优先 V2。registration 保持 inert：host 会克隆并冻结静态数据、保留 callback identity，但不会调用 callback。submit transform 只读 attachment metadata 且只能返回文本，因此附件继续由 Blue 持有。interaction owner 提供可中止、带 revision fence 的 callback context，并拒绝过期异步结果。

Blue 自有 adapter 会收到 capability-local 的 `statusRevision`、`statusProvidersRevision` 与 `editorExtensionsRevision` snapshot fence。各 capability 独立递增，因此无关 mutation 不会重建当前 status provider 或 editor extension。

host 暂留 deprecated 内建 `dock` bridge 作为仓库兼容层，供 owner 迁移到 `panes`；发布 manifest 已无法通过 `dock` 的公共校验。
