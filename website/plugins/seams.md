# Seam 参考

Blue 的当前架构用显式 Cordis service、projection/action、renderer-neutral model registry 和 patch row 作为 seam。旧 `blueSession` mutable binding、`blue/session-changed`、`blueStatus`、`blueIntents` 和 shared-editor module singleton 已删除。

## 第三方 Beta 入口

外部插件通过 `ctx.bluePluginHost.open(ctx, manifest)` 申请当前 `1.0.0-beta.2` 能力：

| Capability | Contribution | Blue consumer |
|---|---|---|
| `commands` | `BlueCommandContribution` + async `BlueResult` | interaction bridge -> Harness command registry |
| `status` | `BlueStatusEntryContribution`，返回 renderer-neutral `BlueStatusNode` | view bridge -> private footer entry registry -> core status compiler |
| `notifications.publish` | publish-only `BlueNotification` | interaction bridge -> editor notice |
| `panes` | `BluePaneContribution` | core surface bridge -> bounded pane mount |
| `overlays` | `BlueOverlayRequest` | core surface bridge -> overlay mount |
| `session.read` | `BluePluginSessionReader`：result-bearing `current` / `subscribe` | app session owner bridge -> exact-field frozen epoch/revision snapshot |
| `session.projections.read` | `BlueSessionProjectionReader`：`current` / `currentMany` / `subscribe` | app projection owner bridge -> exact-key JSON cut with epoch/seq fences |
| `status.provider` (Experimental) | inert `BlueStatusProvider` candidate | status-provider owner -> core status compiler |
| `editor.extensions` (Experimental) | inert `BlueEditorExtensionContribution` | interaction owner -> editor extension binding |
| `editor.provider` (Experimental) | inert `BlueEditorProvider` candidate | editor-provider owner -> core editor-shell compiler |

`@dsh-blue/blue-api` 负责 manifest 校验、capability 裁剪、重复 id、owner namespace 和生命周期。注册绑定调用方 Fiber，卸载自动清理。`commands`、`status`、`panes` 与三个 Experimental/reference facet 使用 inert registration buffer；`overlays` 只有持久 capability definition，每次 open 仍要求 live renderer owner。owner gap 后只恢复最新定义，不 replay action、overlay、gesture、notification 或旧 callback result。

私有 `bluePluginControl.attachCapabilities()` 返回 generation-bound owner lease；重叠 capability 会撤销旧 lease 的全部 authority，snapshot/notification observe、gesture 与 semantic close 都由该 lease 收窄。`notifications.publish`、`session.read` 与 `session.projections.read` 依赖 active owner，缺位操作返回 `BLUE_CAPABILITY_ABSENT`；`null` 只表示 owner 在线但当前无 session。通知 API 只有 publish，没有全局 observe，并执行 32 KiB/20 条每滚动秒的 Host 配额。两个 session facade 都只读；generic `session.act` 已移除，领域写入继续使用所属 Harness service、command 或 feature action。详见[会话只读数据](/plugins/session)。

Provider/editor facet 只保留为 Experimental/reference runtime，不属于 Stable v1 root。它们的 candidate 注册保持 inert，只有 settings 选中的 id 才会激活；持久化选择和 fallback 分别见[状态栏](/plugins/status#独占-status-provider)与[编辑器 Provider](/plugins/editor-providers)。

## Blue 内部边界

下表是产品内部 composition seam，不是第三方绕过 `bluePluginHost` 的入口：

| Owner | Seam | 用途 |
|---|---|---|
| core | `blueScreen` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` / theme | TUI kernel；只有 core 接触 pi-tui/raw terminal |
| app | `blueSessionReader` | 当前 session 的 readonly snapshot；public host 再做 exact-field scope |
| app | `blueSessionProjections` | current-session epoch + consistent-cut seq、children、subscription；public host 再做 exact-key/JSON/size scope |
| app | `blueSessionActions` | followup/steer/interrupt、mode/model/preset/tool/skill/rewind/side-session 等领域 action |
| conversation | `blueConversation` / `blueConversationFacts` | official replay/live transcript 与 status/pane facts |
| transcript | transcript model、private status/bottom-pane registries、tool model service | readonly model/canonical node 到 TUI renderer |
| interaction | `blueEditorHost` / `blueInteractionState` | frontend-tree-scoped editor、completion、submit barrier、draft/settings/paste state |
| API composition | `bluePluginControl` | owner attach、aggregate/notification observe、gesture、semantic close；只在 private realm 中可用 |
| bundle | `cordis.patch.yml` | 34 条 Blue 自有行：3 条 host-support、1 条 private group、30 条 product row |

默认 bundle 的 `blue-runtime-private` 包住完整 product segment，把 `bluePluginControl`、`blueSessionReader`、`blueSessionProjections` 与 `blueSessionActions` 隔离在普通 sibling 之外；public `bluePluginHost` 仍跨过隔离边界供 manifest-scoped facade 使用。普通插件不能通过 service injection 或 Cordis proxy unwrap 获取 management authority。

Session switch 的 `blue/request-resume`、`-new`、`-fork`、`-rewind` 是发给 app owner 的 command events，不是向 renderer 广播 Session 对象。

## 设计纪律

- frontend model 不含 Promise、ANSI、terminal width、focus handle、Agent、Session 或 renderer object；
- UI 不折叠 Harness event log；
- 注册、listener、timer、screen mount 和 async task 必须有 unload/abort path；
- late result 必须检查 session/provider generation；
- package 间只 import public export；
- optional capability 缺失时返回 structured absent/plain fallback，不阻塞整树。

工程级完整映射见 [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md)。
