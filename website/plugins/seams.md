# Seam 参考

Blue 的当前架构用显式 Cordis service、projection/action、renderer-neutral model registry 和 patch row 作为 seam。旧 `blueSession` mutable binding、`blue/session-changed`、`blueStatus`、`blueIntents` 和 shared-editor module singleton 已删除。

## 第三方稳定入口

外部插件通过 `ctx.bluePluginHost.open(ctx, manifest)` 申请能力：

| Capability | Contribution | Blue consumer |
|---|---|---|
| `status` | `BlueStatusContribution`，返回 renderer-neutral `BlueView` | view bridge -> footer `StatusModel` |
| `dock` | `BlueDockContribution` | view bridge -> `DockModel` lane |
| `commands` | `BlueCommandContribution` + async `BlueResult` | interaction bridge -> Harness command registry |
| `notifications` | `BlueNotification` | interaction bridge -> editor notice |

Manifest 校验、capability 限权、重复 id、owner namespace 和生命周期都由 `@dsh-blue/blue-api` 处理。注册绑定调用方 Fiber，卸载自动清理。

当前阶段 `open()` 只开放上表四个 capability。manifest  schema 还声明了另外五个（`tools`、`editor`、`panels`、`session.read`、`session.act`），但申请其中任何一个都会被拒绝，返回 `BLUE_CAPABILITY_DENIED`——它们预留给后续阶段，签名未定。

## Blue 内部边界

| Owner | Seam | 用途 |
|---|---|---|
| core | `blueScreen` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` / theme | TUI kernel；只有 core 接触 pi-tui/raw terminal |
| app | `blueSessionReader` | 当前 session 的 readonly snapshot 与 request |
| app | `blueSessionProjections` | consistent-cut projection values、seq、children、subscription |
| app | `blueSessionActions` | followup/steer/interrupt、mode/model/preset/tool/skill/rewind/side-session action |
| conversation | `blueConversation` / `blueConversationFacts` | official replay/live transcript 与 status/dock facts |
| transcript | transcript/status/dock/tool model services | readonly model 到 TUI renderer |
| interaction | `blueEditorHost` / `blueInteractionState` | frontend-tree-scoped editor slot、draft、settings/probe/paste state |
| bundle | `cordis.patch.yml` | 29 条 Blue 自有行和显式依赖顺序 |

Session switch 的 `blue/request-resume`、`-new`、`-fork`、`-rewind` 是发给 app owner 的 command events，不是向 renderer 广播 Session 对象。

## 设计纪律

- frontend model 不含 Promise、ANSI、terminal width、focus handle、Agent、Session 或 renderer object；
- UI 不折叠 Harness event log；
- 注册、listener、timer、screen mount 和 async task 必须有 unload/abort path；
- late result 必须检查 session/provider generation；
- package 间只 import public export；
- optional capability 缺失时返回 structured absent/plain fallback，不阻塞整树。

工程级完整映射见 [`docs/blue-seams.md`](https://github.com/dsh-blue/blue/blob/master/docs/blue-seams.md)。
