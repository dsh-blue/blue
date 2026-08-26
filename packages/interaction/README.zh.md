# `@dsh-blue/blue-interaction`

[English](README.md) | 中文

Blue 的输入、命令、对话框与通知层。它使用 `@dsh-blue/blue-core` 的 renderer contract 以及 app 所有的 session reader/action/projection 服务，不接收 Harness Agent 或 Session。

主插件挂载 prompt editor、keymap action、内置命令、question/approval panel、settings、provider onboarding、terminal title 更新与启动更新检查。可选 `displayVersion` 配置只用于标识专用验收 profile，不改变 release metadata。

## Editor

Prompt editor 支持多行编辑、history、slash command discovery、排队 follow-up 与 steer、interrupt/retraction、外部编辑，以及由 dialog 替换 editor slot。`EditorHostService` 在单个 frontend tree 内拥有 renderer reference 与 submit transformer。`EditorModelService` 只暴露 readonly editor state 和结构化 set、submit、abort action。

Draft text、prompt/bash mode、history、command alias、settings/theme identity、models.dev cache、update state、file probe cache 以及图片粘贴 marker/cooldown 都由 `InteractionStateService` 持有。Theme swap 可重建 renderer child，而父级 service 继续存活；另一棵 Cordis tree 会得到完全独立的状态。

可选 `./editor-plus` 插件增加 `!` shell mode、slash completion、`@` 文件 mention 与 `#` skill completion。文件 mention 优先使用 `fd`/`fdfind`，不可用时走有界 filesystem fallback；可执行文件 probe 按 frontend tree 缓存。

## 命令与 Panel

内置命令族覆盖会话导航与 rewind、help、theme、model 与 reasoning effort、provider、permission 与 preset、mode、status/context/version/changelog、export/copy、tool、skill、MCP、trace、settings 与 profile update。命令读取不可变 snapshot 并调用 `blueSessionActions`，不会折叠 session event 或直接修改 Harness object。

Dialog 替换 editor slot，并复用 list、form、info、settings、question、approval、model 与 plan-review panel。Question 与 approval 工作绑定 Fiber、支持 abort，并拒绝 unload 或会话切换后的迟到结果。第三方 renderer-neutral command 与 notification 通过 `./plugin-host-bridge` 进入。

可读 export 在 flush 并读取 durable artifact 后使用官方 `blueConversation` projection；full export 则有意输出解码后的审计 event stream。`/copy` 使用官方 conversation 值与 OSC 52/native clipboard 管线。

## 可选子路径

- `./editor-plus`：shell mode 与 completion。
- `./pane-queue`：排队消息 dock model 与空 editor recall。
- `./mode-status`：renderer-neutral footer status model。
- `./attachments`：有界 filesystem image store。
- `./paste-image`：原生 clipboard 图片/文件读取。
- `./command-model`：renderer-neutral command model 与执行 action。
- `./plugin-host-bridge`：公开 command/notification adapter。

所有 registration、异步工作、screen child、alias 与 host contribution 都随所属 Fiber 释放。

## 模型体验

本包不添加 prompt prefix。只有用户明确提交的 editor 内容、回答、审批与命令会影响面向模型的会话。
