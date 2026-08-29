# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue Cordis 插件的 Beta、renderer-independent 公共契约。本包不含 renderer、终端或 Harness 服务代码。它定义 manifest、结构化结果、安全内容叶 `BlueView`、声明式 `BlueUiNode`、语义事件、surface/reference-provider 契约和 `bluePluginHost` admission 服务，并持有所有 Blue release 包对齐的 `BLUE_VERSION` 常量。

## Manifest 与 capability

插件声明 `{ id, api, capabilities }`，由 `validateBlueManifest` 在不执行插件代码的情况下校验。当前可执行契约是 `1.0.0-beta.1`，manifest 应写 `^1.0.0-beta.1`；它不跟随产品的 `0.1.x` 版本，也不表示 protocol v1 已 Stable。

版本化分发候选通过 `@dsh-blue/blue-api/protocol/v1` 独立发布。该子路径导出
生成的七项 v1 目标名称、readonly manifest 类型、深冻结的 Draft 2020-12 schema、
`validateBluePluginManifestV1`，以及 `1.0.0-beta.1` 对应的 Blue
产品/协议映射。包只能用 `package.json.blue.manifest =
"./blue.plugin.json"` 发现该入口；manifest 使用公开 package export subpath、
required/optional capability 分组、精确 resource 和完整 Blue/Harness/Node
兼容范围。同一 schema 与 corpus 也由两个
`./schema/blue.plugin.v1.*.json` 子路径导出。在 P2 把 host admission 迁移到这套
形状之前，分发 manifest 校验通过不表示当前 beta.1 host 已授予对应 capability。
编辑器使用的 canonical schema 位于
`https://dsh-blue.dev/schema/blue.plugin.v1.schema.json`；共享 corpus 以
`blue.plugin.v1.corpus.json` 同目录发布。

公开 Beta capability 为 `commands`、`notifications.publish`、`status`、`panes`、`overlays` 与 `session.read`。`editor.extensions`、`status.provider`、`editor.provider` 仅保留为 Experimental/reference surface，不属于 Stable v1 目标。generic `session.act` 与全局 notification observe 已移除。旧 `dock`、`panels`、`editor`、`tools` 返回带具体迁移说明的 `BLUE_LEGACY_CAPABILITY`；`tools` 没有替代项，因为公共 tool presentation 没有 registry 或 owner。

`bluePluginHost.open(ctx, manifest)` 直接接受插件真实的 Cordis `Context`，先校验 manifest，再返回只暴露所请求表面的 capability-scoped `BluePluginApi`。所有 registration 都绑定该 Cordis effect，effect callback 返回对应 cleanup：插件卸载即释放全部贡献，并永久封锁被保留的 API 引用；host service teardown 也会在清空状态前应用相同 fence。之后的写操作返回 `BLUE_ACTION_REJECTED`，保留的 list 维持冻结空数组。跨消费者重复的 contribution id 会被拒绝，Blue 的 owner 命名空间（`blue.`、`blue:`、`blue-`、`@dsh-blue/`）被保留。

host 会持久缓冲 `commands`、`status`、`panes`、`overlays` 以及三个 Experimental editor/provider facet 的 inert registration。因此插件可以在对应 frontend-tree owner 尚在启动或重载时注册，active owner 只恢复最新 definition。consumer 卸载仍会删除它的 registration。缓冲不赋予 render、dispatch、gesture、provider selection、last-known-good、breaker 或 fallback 权限。`notifications.publish` 与 `session.read` 不是 registration buffer，owner 缺位时返回 absent/unavailable；notice、overlay、gesture、action 与旧 callback result 都不会 replay。

owner attach、aggregate observe、notification observe、gesture mint、semantic overlay close，以及 raw session/projection/action service 都不是公共插件 API。默认 bundle 通过私有隔离 runtime realm 中 closure-bound 的 `bluePluginControl` 承载这些操作；普通 sibling 只能取得受保护的 `bluePluginHost` facade。

## UI 契约

`BlueUiNode` 保留 `BlueView` 作为经过清洗的 text/fields/code/diff/sections 内容叶，并增加 rich text、stack、surface、scroll、tabs、list、form、actions、loader、empty、progress、spacer 和 divider。响应式显示只存在于 `BlueUiChild.when`，并相对于获配的 surface viewport 计算。

node、event payload 和 snapshot 是 readonly、JSON-shaped 数据；`render`、`onEvent`、`AbortSignal` 和 registration handle 是进程内执行边界。插件只收到语义事件，不接触 raw key。value/selection/tab change 按 control latest-wins；activate/submit/dismiss 按 surface FIFO。revision、abort、timeout 和合并 refresh 由 Blue 托管。

`BlueStatusNode` 递归只允许 text、rich text、fields、progress 和 stack，`BluePluginApi.status` 已由最终 additive registry 实现。host 同时接纳 pane、overlay、editor extension 和 status/editor provider 候选。每个 contribution 在滚动一秒内最多成功 refresh 20 次，同 tick 调用会合并 owner 通知。capturing overlay 必须携带 host 为 owner 创建的 `BlueUserGesture`；proof 只消费一次，owner 卸载时其未消费 proof 全部失效。

`BlueEditorShellNode` 是 provider-only 独立树，包含 `editor-control` slot；普通 `BlueUiNode` 无法构造该 slot。provider registration 只校验 callback 形状，不调用 `render`、不检查其返回树，也不选择 winner；只有 Blue 持有的用户配置能激活 inert candidate。

app 通过私有 control 挂载唯一 active readonly session source。`session.read` 只暴露 `current` 与 `subscribe`。session snapshot 必须携带单调递增的 `revision`，host 会校验、克隆并深冻结数据，不信任 owner 对象。owner gap 中仍存活的 reader 返回 `null`，重载后从当前 generation 恢复；已卸载 consumer 永不恢复。写操作直接使用其所属 Harness service 或 Blue 内部 domain action，不经过 generic public session gateway。

Editor extension 可贡献静态辅助行、提示、诊断、结构化 action、completion 和异步 submit transform。`before` 与 `after` 保留 G1 的 `BlueUiNode` 源码类型，而 registration 只接纳递归的被动 `BlueEditorExtensionNode` 子集：text/rich-text/fields/code/diff/sections/progress/spacer/divider 加 stack/surface；交互控件会以 `BLUE_INVALID_CONTRIBUTION` 拒绝，extension action 通过独立的 `actions` + `onEvent` 路径处理。兼容 `complete` callback 只接收 `/`、`@` 和手动请求；插件通过 `completeV2` 与 `BlueEditorCompletionRequestV2` 显式选择接收 `#`，两者同时存在时优先 V2。registration 保持 inert：host 会克隆并冻结静态数据、保留 callback identity，但不会调用 callback。submit transform 只读 attachment metadata 且只能返回文本，因此附件继续由 Blue 持有。interaction owner 提供可中止、带 revision fence 的 callback context，并拒绝过期异步结果。

Blue 自有 adapter 会收到 capability-local 的 `statusRevision`、`statusProvidersRevision` 与 `editorExtensionsRevision` snapshot fence。各 capability 独立递增，因此无关 mutation 不会重建当前 status provider 或 editor extension。已删除的 `dock` surface 不再保留 host registry 或 snapshot 兼容路径；未类型化的旧 manifest 会收到与 `validateBlueManifest` 相同的可操作迁移拒绝。
