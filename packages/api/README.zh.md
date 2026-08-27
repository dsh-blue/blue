# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue Cordis 插件的稳定、renderer-independent 公共契约。本包不含 renderer、终端或 Harness 服务代码。它定义 manifest、结构化结果、安全内容叶 `BlueView`、声明式 `BlueUiNode`、语义事件、surface/provider 契约和 `bluePluginHost` admission 服务，并持有所有 Blue release 包对齐的 `BLUE_VERSION` 常量。

## Manifest 与 capability

插件声明 `{ id, api, capabilities }`，由 `validateBlueManifest` 在不执行插件代码的情况下校验。`api` 面向独立的 Blue API `1.x` 协议，通常写 `^1.0.0`，不跟随产品的 `0.1.x` 版本。

目标 capability 为 `commands`、`notifications`、`status`、`panes`、`overlays`、`editor.extensions`、`session.read`、`session.act`、`status.provider` 与 `editor.provider`。已删除的 `dock`、`panels`、`editor`、`tools` 返回带具体迁移说明的 `BLUE_LEGACY_CAPABILITY`。`tools` 没有替代项，因为公共 tool presentation 没有 registry 或 owner。

`bluePluginHost.open(consumer, manifest)` 先校验 manifest，再返回只暴露所请求表面的 capability-scoped `BluePluginApi`。所有 registration 都绑定消费者的 Cordis effect：插件卸载即释放全部贡献。跨消费者重复的 contribution id 会被拒绝，Blue 的 owner 命名空间（`blue.`、`blue:`、`blue-`、`@dsh-blue/`）被保留。

## UI 契约

`BlueUiNode` 保留 `BlueView` 作为经过清洗的 text/fields/code/diff/sections 内容叶，并增加 rich text、stack、surface、scroll、tabs、list、form、actions、loader、empty、progress、spacer 和 divider。响应式显示只存在于 `BlueUiChild.when`，并相对于获配的 surface viewport 计算。

node、event payload 和 snapshot 是 readonly、JSON-shaped 数据；`render`、`onEvent`、`AbortSignal` 和 registration handle 是进程内执行边界。插件只收到语义事件，不接触 raw key。value/selection/tab change 按 control latest-wins；activate/submit/dismiss 按 surface FIFO。revision、abort、timeout 和合并 refresh 由 Blue 托管。

`BlueStatusNode` 递归只允许 text、rich text、fields、progress 和 stack，`BluePluginApi.status` 已由最终 additive registry 实现。host 同时接纳 pane、overlay、editor extension 和 status/editor provider 候选。每个 contribution 在滚动一秒内最多成功 refresh 20 次，同 tick 调用会合并 owner 通知。capturing overlay 必须携带 host 为 owner 创建的 `BlueUserGesture`；proof 只消费一次，owner 卸载时其未消费 proof 全部失效。

`BlueEditorShellNode` 是 provider-only 独立树，包含 `editor-control` slot；普通 `BlueUiNode` 无法构造该 slot。provider registration 只校验 callback 形状，不调用 `render`、不检查其返回树，也不选择 winner；只有 Blue 持有的用户配置能激活 inert candidate。`session.read` 与 `session.act` 在真正的 owner/API seam 能提供 snapshot 与 action 保证前继续拒绝。

host 暂留 deprecated 内建 `dock` bridge 作为仓库兼容层，供 owner 迁移到 `panes`；发布 manifest 已无法通过 `dock` 的公共校验。
