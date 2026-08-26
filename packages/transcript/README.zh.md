# `@dsh-blue/blue-transcript`

[English](README.md) | 中文

Blue 的 projection-backed transcript、status、tool 与 dock model 终端渲染器。本包是 renderer adapter：Harness domain state 在进入本包前已完成 projection，且只有 `@dsh-blue/blue-core` 接触 pi-tui。

## Transcript

`./official-model` 插件通过 app 所有的 `blueSessionProjections` 消费完整 `blueConversation` 值。它把 user、assistant、thinking、tool、error、interruption、image 与 retraction fact 映射为稳定的 renderer-neutral entry，并在 domain projection 之外解析官方 tool presentation。过期、畸形、异会话与卸载后的值都会被丢弃。

`TranscriptModelService` 按稳定 id 协调 semantic component，把每个 model 限制为最新 200 项，缓存稳定的已完成 frame，应用配置后的 turn window，只向最近若干 turn 转发 Ctrl-O 展开，并在条目退役时释放 timer。User message 折叠阈值、thinking/tool 默认展开状态、turn window 与展开范围都属于 frontend-tree-scoped presentation policy，因此 theme/provider reload 可保留设置，同时不同 tree 之间不会泄漏状态。

当前 runtime 不折叠 Harness session event，也没有旧 tool-intent registry。Generic、terminal、diff、search、read 与 web tool 形态通过 canonical projection/presentation model 到达渲染层，同时保留共享的状态、参数、命令与展开 chrome。BTW pane 与连接的 editor 共用对齐的左右边框，不再插入 spacer 行。

## Status 与 Dock

主插件拥有四个 renderer bridge：

- `BlueStatusModelService` 在两行 footer 中渲染 readonly `StatusModel` contribution。
- `BlueDockModelService` 按 placement、priority 与 id 排列有界 dock contribution。
- `BlueModelToolService` 把官方 tool presentation fact 转换为 readonly frontend view。
- `TranscriptModelService` 渲染官方 semantic conversation model。

Footer 子插件提供 model、cwd、git、title、context 与 session mode 信息。Activity、todo 与 agents pane 通过 `blueSessionFacts` 消费 `blueConversationFacts` projection；BTW pane 通过 `blueSessionActions` 获取可释放的旁路会话并渲染其官方 conversation projection。任何 pane 都不会接收 Agent 或 Session。

`./plugin-host-bridge` 是第三方 renderer-neutral dock/status contribution 的 owner adapter。所有 registration、subscription、timer 与 screen child 都绑定 Fiber，并在 unload 时移除。

## 其他子路径

`./banner` 挂载欢迎横幅。`./status-basic-model`、`./status-cwd`、`./status-title`、`./status-git` 与 `./status-context` 发布 footer model。`./pane-activity`、`./pane-todo`、`./pane-btw` 与 `./pane-agents` 发布 dock model。`./dock-model`、`./tool-model` 与 `./transcript-model` 提供组合所需的 renderer-neutral registry。

所有渲染行都遵守 core 的 visible-width 契约，包括窄窗口与 CJK viewport。

## 模型体验

无。本包只渲染已有 projection 值，不添加 prompt 或 request prefix。
