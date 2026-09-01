# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue Cordis 插件的 Beta、renderer-independent 公共契约。本包不含 renderer、终端或 Harness 服务代码。它定义 manifest、结构化结果、安全内容叶 `BlueView`、声明式 `BlueUiNode`、语义事件、surface/reference-provider 契约和 `bluePluginHost` admission 服务，并持有所有 Blue release 包对齐的 `BLUE_VERSION` 常量。

## Manifest 与 capability

插件声明 `{ id, api, capabilities }`，由 `validateBlueManifest` 在不执行插件代码的情况下校验。当前可执行契约是 `1.0.0-beta.2`，使用富文档或图表节点的 manifest 应写 `^1.0.0-beta.2`；它不跟随产品的 `0.1.x` 版本，也不表示 protocol v1 已 Stable。

版本化分发候选通过 `@dsh-blue/blue-api/protocol/v1` 独立发布。该子路径导出
生成的七项 v1 目标名称、readonly manifest 类型、深冻结的 Draft 2020-12 schema、
`validateBluePluginManifestV1`，以及 `1.0.0-beta.2` 对应的 Blue
产品/协议映射。包只能用 `package.json.blue.manifest =
"./blue.plugin.json"` 发现该入口；manifest 使用公开 package export subpath、
required/optional capability 分组、精确 resource 和完整 Blue/Harness/Node
兼容范围。同一 schema 与 corpus 也由两个
`./schema/blue.plugin.v1.*.json` 子路径导出。当前 beta host 已直接按这套形状执行
admission：required capability 原子处理，optional capability 可以 unavailable 或只获得
resource 子集。`BluePluginOpen.grants` 报告精确 version、resources、limits、quotas、
availability 与 owner generation；`unavailableOptional` 记录稳定的
unsupported/version/resource/policy/owner-gap 原因。P4 composition 已安装
`session.projections.read`；admission 只授予 manifest 明确声明的 key，app bridge
不可用期间报告 owner gap。
编辑器使用的 canonical schema 位于
`https://dsh-blue.dev/schema/blue.plugin.v1.schema.json`；共享 corpus 以
`blue.plugin.v1.corpus.json` 同目录发布。

公开 Beta capability 为 `commands`、`notifications.publish`、`status`、`panes`、`overlays`、`session.read` 与 `session.projections.read`。`editor.extensions`、`status.provider`、`editor.provider` 仅保留为 Experimental/reference surface，不属于 Stable v1 目标。generic `session.act` 与全局 notification observe 已移除。旧 `dock`、`panels`、`editor`、`tools` 返回带具体迁移说明的 `BLUE_LEGACY_CAPABILITY`；`tools` 没有替代项，因为公共 tool presentation 没有 registry 或 owner。

`bluePluginHost.open(ctx, manifest)` 直接接受插件真实的 Cordis `Context`，先校验 manifest，再返回只暴露所请求表面的 capability-scoped `BluePluginApi`。所有 registration 都绑定该 Cordis effect，effect callback 返回对应 cleanup：插件卸载即释放全部贡献，并永久封锁被保留的 API 引用；host service teardown 也会在清空状态前应用相同 fence。之后的写操作返回 `BLUE_ACTION_REJECTED`，保留的 list 维持冻结空数组。跨消费者重复的 contribution id 会被拒绝，Blue 的 owner 命名空间（`blue.`、`blue:`、`blue-`、`@dsh-blue/`）被保留。

Canonical manifest 还会返回 `BluePluginOpen`：`api` 是只含 facet 的视图，`grants`
与 `unavailableOptional` 是不可变 admission 记录。command 名称由插件定义并受
resource fence 约束；pane registration 只能使用获准 placement。过渡期间旧 inline
manifest 保持原返回面。

当前可执行的 P3 候选会落实 catalog budget：每个 consumer 最多注册 64 个 command
和 64 个 additive status contribution，notification view 最大 32 KiB，并且滚动一秒
最多发布 20 条 notification。notification grant 还会公开 bounded clone 上限：深度
64、4096 个容器、8192 个属性、32 KiB primitive/key bytes；通过预检后仍执行最终
JSON UTF-8 精确字节检查。每个 consumer 最多 8 个 pane，全局 overlay stack
最多 4 个，每个 consumer 最多 1 个 capturing overlay；status、pane 与 overlay 的
refresh handle 各自每滚动秒接受 20 次成功调用，并把同一 microtask 的调用合并。
异步 command settlement（包括 callback rejection）在 abort、插件卸载或 command
owner 替换后会被丢弃。

host 会持久缓冲 `commands`、`status`、`panes` 以及三个 Experimental editor/provider facet 的 inert registration；`overlays` 只安装 canonical capability definition，不缓冲 overlay open。插件可以在对应 frontend-tree owner 尚在启动或重载时注册 definition，active owner 只恢复最新 definition。consumer 卸载仍会删除它的 registration。缓冲不赋予 render、dispatch、gesture、provider selection、last-known-good、breaker 或 fallback 权限。overlay open、`notifications.publish`、`session.read` 与 `session.projections.read` 都要求 live owner，owner 缺位时返回 absent/unavailable；notice、overlay、gesture、action 与旧 callback result 都不会 replay。

owner attach、aggregate observe、notification observe、gesture mint、semantic overlay close，以及未收窄的 session/projection/action source 都不是公共插件 API。projection owner 的 source 类型同样不会从 package root 导出；composition-private 代码只通过 `bluePluginControl` 的 contextual typing 取得它。默认 bundle 通过私有隔离 runtime realm 中 closure-bound 的 control 承载这些操作；普通 sibling 只能取得受保护的 `bluePluginHost` facade。

## UI 契约

`BlueUiNode` 保留 `BlueView` 作为经过清洗的 text/fields/code/diff/sections 内容叶，并增加 rich text、document、chart、stack、surface、scroll、tabs、list、form、actions、loader、empty、progress、spacer 和 divider。`document` 选择 Markdown 或 Mermaid 源码；`chart` 支持 line、point、grouped/stacked/normalized bar、sparkline 与 heatmap，且不暴露 renderer options。这两类富内容只能进入普通 pane/overlay，不能进入 status、notification、section body 或 editor shell。响应式显示只存在于 `BlueUiChild.when`，并相对于获配的 surface viewport 计算。

node、event payload 和 snapshot 是 readonly、JSON-shaped 数据；`render`、`onEvent`、`AbortSignal` 和 registration handle 是进程内执行边界。插件只收到语义事件，不接触 raw key。value/selection/tab change 按 control latest-wins；activate/submit/dismiss 按 surface FIFO。revision、abort、timeout 和合并 refresh 由 Blue 托管。

`BlueStatusNode` 递归只允许 text、rich text、fields、progress 和 stack，`BluePluginApi.status` 已由最终 additive registry 实现。host 同时接纳 pane、overlay、editor extension 和 status/editor provider 候选。每个 contribution 在滚动一秒内最多成功 refresh 20 次，同 tick 调用会合并 owner 通知。capturing overlay 必须携带 host 为 owner 创建的 `BlueUserGesture`；proof 只消费一次，owner 卸载时其未消费 proof 全部失效。

`BlueEditorShellNode` 是 provider-only 独立树，包含 `editor-control` slot；普通 `BlueUiNode` 无法构造该 slot。provider registration 只校验 callback 形状，不调用 `render`、不检查其返回树，也不选择 winner；只有 Blue 持有的用户配置能激活 inert candidate。

app 通过私有 control 挂载唯一 active readonly session 与 projection source。Canonical `session.read` 提供带结果的 `current` 与 `subscribe`，始终携带用于 fencing 的 `revision` 和 `sessionEpoch`，且只包含精确获准的 `identity`/`cwd`/`status`/`mode`/`model` 字段。host 会校验、克隆并深冻结 snapshot，不信任 owner 对象。每个字符串最多 16,384 UTF-8 bytes，完整 snapshot 最多 65,536 encoded bytes。`null` 只表示 owner 在线但当前没有 session；owner gap 返回 `BLUE_CAPABILITY_ABSENT`，consumer 卸载后永久返回 `BLUE_ACTION_REJECTED`。同 id session 只有在 epoch 前进后才能从较低 revision 重新开始。

session high-water 会跨 owner gap 保留。同一 epoch 内 session id 不得改变；相同 epoch/revision 只有在完整 canonical snapshot 不变时才能恢复。发布 `null` 会立即 replay projection subscriber，清除旧 session 数据。

`session.projections.read` 为精确获准的 projection key 提供带结果的 `current`、一致 cut 的 `currentMany` 与 key-set `subscribe`。resource key 使用 canonical ASCII syntax，最长 128 字符。每个 cut 携带 `sessionEpoch` 与 `asOfSeq`；value 必须是有限、无环的 JSON，并会被分离和深冻结。bounded clone 对整份 cut 最多接纳 64 层、16,384 个 JSON value 和 16,384 个被检查的 own property；单 primitive 最多 262,144 encoded bytes，嵌套 object key 最多 1,024 UTF-8 bytes。clone 后仍以单 value 262,144 encoded bytes、整 cut 1,048,576 bytes 为最终权威上限。key 缺失或卸载返回 `BLUE_CAPABILITY_ABSENT` 且不复用旧值；owner 重载会 replay 当前 cut，旧 epoch、过期 seq 与迟到 owner callback 会被拒绝。写操作直接使用其所属 Harness service 或 Blue 内部 domain action，不经过 generic public session gateway。

请求 key 数会在遍历 key 前受 exact grant 上界约束。projection high-water 同样跨 owner gap 保留；相同位置的值按 canonical JSON 比较（不受 object key 顺序影响），冲突值返回 `BLUE_STALE`。同一 epoch/sequence 位置最多保留 256 个 key fingerprint 和 4,194,304 UTF-8 bytes；位置前进时清空这组有界记录。active session owner 报告 `null` 时，projection read 直接返回 `null`，不会查询可能过期的 projection backing data。

Editor extension 可贡献静态辅助行、提示、诊断、结构化 action、completion 和异步 submit transform。`before` 与 `after` 保留 G1 的 `BlueUiNode` 源码类型，而 registration 只接纳递归的被动 `BlueEditorExtensionNode` 子集：text/rich-text/fields/code/diff/sections/progress/spacer/divider 加 stack/surface；交互控件会以 `BLUE_INVALID_CONTRIBUTION` 拒绝，extension action 通过独立的 `actions` + `onEvent` 路径处理。兼容 `complete` callback 只接收 `/`、`@` 和手动请求；插件通过 `completeV2` 与 `BlueEditorCompletionRequestV2` 显式选择接收 `#`，两者同时存在时优先 V2。registration 保持 inert：host 会克隆并冻结静态数据、保留 callback identity，但不会调用 callback。submit transform 只读 attachment metadata 且只能返回文本，因此附件继续由 Blue 持有。interaction owner 提供可中止、带 revision fence 的 callback context，并拒绝过期异步结果。

Blue 自有 adapter 会收到 capability-local 的 `statusRevision`、`statusProvidersRevision` 与 `editorExtensionsRevision` snapshot fence。各 capability 独立递增，因此无关 mutation 不会重建当前 status provider 或 editor extension。已删除的 `dock` surface 不再保留 host registry 或 snapshot 兼容路径；未类型化的旧 manifest 会收到与 `validateBlueManifest` 相同的可操作迁移拒绝。
