# Blue 缝（seam）清单：当前契约与组合映射

本文描述当前代码。目标原则见 [blue-frontend-architecture.md](./blue-frontend-architecture.md)，包内实现细节见各 `packages/*/AGENTS.md`。

## 1. 缝的代码形态

Blue 的 seam 不是单一类型，而是五类显式边界：

1. **Cordis service + declaration merge**：服务随 Fiber 提供和销毁。
2. **registry + disposer**：注册返回可重复调用的清理函数或 `BlueRegistration`，重复 id 在注册期失败。
3. **projection / action**：projection 表示当前只读事实，action 表示有结构化结果的写请求；renderer 不读取 Harness event log。
4. **provider replacement**：provider 的资源按 `capture -> abort -> dispose -> activate -> restore` 生命周期替换。
5. **subpath plugin + patch row**：组合层显式决定启用、顺序与依赖。

产品级可变状态只存在于 host、session、frontend tree 或 provider Fiber 的明确 owner 中。当前代码没有共享编辑器 module singleton，也没有向 renderer 暴露 Agent 或 Session 的 session binding。

## 2. 稳定公共插件 API

第三方插件通过 `ctx.bluePluginHost.open(ctx, manifest)` 申请能力。契约归 `@dsh-blue/blue-api` 所有，入口只接受 renderer-neutral `BlueView` 和结构化 action/result。

| Capability | 公共对象 | 当前 consumer bridge | 行为 |
|---|---|---|---|
| `status` | `BlueStatusEntryContribution` | `blue-plugin-view-bridge` -> `BlueStatusEntryService` | 贡献 canonical `BlueStatusNode`；重复 id、越权 namespace 和非法 payload 被拒绝 |
| `status.provider` | inert `BlueStatusProvider` candidate | `blue-status-provider-owner` -> `BlueStatusCompositionService` | 仅持久化用户选择可激活；实际宽度 dry-render 后原子替换，失败保留同会话 last-known-good 或回落 `blue.default` |
| `dock` | `BlueDockContribution` | `blue-plugin-view-bridge` -> core bounded dock mount | 贡献有界 `BlueView`；支持 priority、preferred/min rows 和 collapsed |
| `commands` | `BlueCommandContribution` | `blue-plugin-interaction-bridge` -> Harness commands | 注册结构化异步命令；卸载时撤销，late result 不回写 |
| `notifications` | `BlueNotification` | `blue-plugin-interaction-bridge` -> editor notice | 发布 renderer-neutral 通知，不暴露编辑器对象 |

`session.read`、`session.act`、`tools`、`editor` 和 `panels` 仍是 manifest vocabulary，不属于 phase-one 已开放能力；请求它们会得到明确的 capability-denied/absent 结果。

## 3. 产品内部 seam

这些 seam 供 Blue 官方包组合使用，不是第三方绕过 `bluePluginHost` 的捷径。

| Owner | Seam | Contract / provider | Consumer |
|---|---|---|---|
| core | `blueScreen`、`blueKeymap`、`blueComponents`、`blueTerminalInfo`、`blueTheme` | `packages/core/src/types.ts` 与主题 provider | transcript、interaction 的 TUI adapter；只有 core 接触 pi-tui/raw terminal |
| app | `blueSessionReader` | readonly `BlueSessionSnapshot`、订阅和文本 request；切换后发布新 snapshot | transcript、interaction、context adapter |
| app | `blueSessionProjections` | `current/currentMany/children/subscribe`，只返回 immutable projection values + seq | conversation/status/dock/context consumers |
| app | `blueSessionActions` | followup/steer/interrupt、session details、mode/model/preset/tool/skill、side session 等结构化 action | interaction commands 和 BTW pane |
| app | `blueRetractions` / `blueRequests` | request/session epoch guard 与 retract lifecycle | input、conversation/transcript lifecycle |
| conversation | `blueConversation`、`blueConversationFacts` + `blueConversationProjection` readiness | official `SessionProjectionRegistry` owns replay/live/checkpoint/watermark | official transcript model、status 和 dock facts |
| transcript | `blueTranscriptModels`、`blueStatusEntries`、`blueStatusComposition`、`blueBottomPanes`、tool model service | transcript model + canonical node + effect-bound registration + selected-provider composition | semantic TUI components、default/provider footer、Blue-owned bottom panes |
| interaction | `blueEditorHost`、`blueInteractionState` | frontend-tree-scoped editor slot/enhancements/transformers and mutable product state | input and interaction child Fibers |
| frontend | theme/notification/provider hosts | renderer-neutral model registries and generation-scoped provider swap | renderer adapters |
| bundle | `cordis.patch.yml` | 29 Blue-owned rows with explicit `inject` ordering where lifecycle order matters | dsh profile composition |

Session switch requests remain events such as `blue/request-resume`, `blue/request-new`, `blue/request-fork`, and `blue/request-rewind`. They are commands addressed to the app owner, not a raw session-fact broadcast. The deleted `blue/session-changed` and `blue/session-binding-changed` events must not be restored.

## 4. Harness seams consumed by Blue

| Harness seam | Blue use |
|---|---|
| `sessionProjections` | owns `blueConversation` and `blueConversationFacts`; app exposes only values/seq to renderers |
| `agents` / `sessions` / persistence | app creates, resumes, forks, flushes and disposes Agents while keeping those objects private |
| `commands` | interaction registers built-ins and the public command bridge |
| `userQuestions` / `approval/request` | interaction owns effect-bound question and approval providers |
| `tools` | transcript asks for canonical call/result presentation, then converts it to `ToolPresentationModel` |
| `permissionPresets` / `planMode` / `agentPresets` | app actions expose renderer-neutral current state and mutations |
| `attachments` | optional filesystem store and image-paste flow |
| `settings` / credentials / session query | settings, onboarding, trace and session-tree actions behind bounded adapters |

## 5. Bundle mapping

The patch owns 29 Blue rows: two host-support rows plus 27 product rows.

- Baseline, 8 rows: API host, core/theme, banner, transcript model hosts/footer, conversation projection, official transcript consumer.
- Enhancement, 15 rows: editor/attachment helpers, five status producers, five dock panes, the public view bridge, and the exclusive status-provider owner.
- Assembly, 4 rows: interaction, public interaction bridge, startup and app.
- Validation-only, not bundle rows: `blue-context`, `blue-remote`, `blue-openpencil`, `blue-lark`.

`blue-conversation` and `blue-transcript-official` are baseline rows because no legacy event-fold renderer remains. Tool diff/terminal/search/read/web cards are canonical `ToolPresentationModel` conversions inside the model path; there is no `blueIntents` registry or intent subpath.

## 6. Lifecycle rules

- Every registration, screen mount, listener, timer and async owner has an unload path.
- Async work captures session/provider generation and rejects stale or late completion.
- Missing optional capability returns absent/plain behavior; it must not leave the Cordis tree pending.
- Renderer-neutral models contain readonly data and structured actions only: no Promise, ANSI, terminal width, focus handle, Agent, Session or renderer object.
- Downstream packages import public exports only. Package-internal cross-imports and implicit row ordering are release-gate violations.
