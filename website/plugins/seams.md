# Seam 参考

Blue 的当前架构用显式 Cordis service、projection/action、renderer-neutral model registry 和 patch row 作为 seam。旧 `blueSession` mutable binding、`blue/session-changed`、`blueStatus`、`blueIntents` 和 shared-editor module singleton 已删除。

## 第三方稳定入口

外部插件通过 `ctx.bluePluginHost.open(ctx, manifest)` 申请能力：

| Capability | Contribution | Blue consumer |
|---|---|---|
| `commands` | `BlueCommandContribution` + async `BlueResult` | interaction bridge -> Harness command registry |
| `status` | `BlueStatusEntryContribution`，返回 renderer-neutral `BlueStatusNode` | view bridge -> private footer entry registry -> core status compiler |
| `status.provider` | `BlueStatusProvider`，返回独占的 renderer-neutral `BlueStatusNode` | status-provider owner -> core status compiler |
| `notifications` | `BlueNotification` | interaction bridge -> editor notice |
| `panes` | `BluePaneContribution` | view bridge -> private pane registry -> core bounded pane mount |
| `overlays` | `BlueOverlayRequest` | public overlay host -> core overlay mount |
| `editor.extensions` | `BlueEditorExtensionContribution` | interaction bridge -> editor extension binding |
| `editor.provider` | `BlueEditorProvider`，返回独占的 renderer-neutral editor shell | editor-provider owner -> core editor shell compiler |
| `session.read` | `BlueSessionReader`：`current` / `subscribe` only | app session owner bridge -> frozen revisioned snapshot |
| `session.act` | `BlueSessionRequester`：`request` only | app session owner bridge -> FIFO structured actions |

Manifest 校验、capability 限权、重复 id、owner namespace 和生命周期都由 `@dsh-blue/blue-api` 处理。注册绑定调用方 Fiber，卸载自动清理。

`session.read` 与 `session.act` 的 owner 缺失时，`open()` 返回 `BLUE_CAPABILITY_ABSENT`；owner 激活后两个字段仍严格隔离，生命周期与错误码见[会话读取与动作](/plugins/session)。两个独占 provider 的候选注册都保持 inert，只有 settings 选中的 id 才会激活；持久化选择和失败回退分别见[状态栏](/plugins/status#独占-status-provider)与[编辑器 Provider](/plugins/editor-providers)。

## Blue 内部边界

| Owner | Seam | 用途 |
|---|---|---|
| core | `blueScreen` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` / theme | TUI kernel；只有 core 接触 pi-tui/raw terminal |
| app | `blueSessionReader` / `blueSessionRequester` | 当前 session 的 readonly snapshot / 窄化 action；公开 bridge 不暴露广义 app action |
| app | `blueSessionProjections` | consistent-cut projection values、seq、children、subscription |
| app | `blueSessionActions` | followup/steer/interrupt、mode/model/preset/tool/skill/rewind/side-session action |
| conversation | `blueConversation` / `blueConversationFacts` | official replay/live transcript 与 status/pane facts |
| transcript | transcript model、private status/bottom-pane registries、tool model service | readonly model/canonical node 到 TUI renderer |
| interaction | `blueEditorHost` / `blueInteractionState` | frontend-tree-scoped editor slot、completion multiplexer、pre-clear submit barrier、public extension/provider binding、draft/settings/paste state |
| bundle | `cordis.patch.yml` | 31 条 Blue 自有行和显式依赖顺序 |

Session switch 的 `blue/request-resume`、`-new`、`-fork`、`-rewind` 是发给 app owner 的 command events，不是向 renderer 广播 Session 对象。

## 设计纪律

- frontend model 不含 Promise、ANSI、terminal width、focus handle、Agent、Session 或 renderer object；
- UI 不折叠 Harness event log；
- 注册、listener、timer、screen mount 和 async task 必须有 unload/abort path；
- late result 必须检查 session/provider generation；
- package 间只 import public export；
- optional capability 缺失时返回 structured absent/plain fallback，不阻塞整树。

工程级完整映射见 [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md)。
