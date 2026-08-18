# `@deepseek-ai/dsh-blue-transcript`

[English](README.md) | 中文

Blue 终端 UI transcript 层，构建于 `dsh-blue-core` 之上：从 session 事件到 transcript 条目（user/assistant/tool）的纯折叠、渲染这些条目的组件，以及把它们挂载到 `blueScreen` 的 Cordis 插件。本包不 import pi-tui——组件要么直接返回带样式的 ANSI 行，要么委托给 `blueComponents` 工厂。

## 折叠器

`src/fold.ts` 是纯函数管线，不依赖 UI。`TranscriptFolder.apply(event)` 折叠一个 `SessionEvent`（来自 `@deepseek-ai/dsh-session`，仅类型导入）并报告新建或变更的 `TranscriptItem`；`foldSessionEvents(events)` 是一次性形式。

- `user/message` → user 条目（text 块拼接，图片显示为 `[image]`）。
- `assistant/chunk` 的 text/reasoning 增量累积进每个 step 的流式 assistant 条目；收尾的 `assistant/message` 用权威组装消息重写该条目。
- `tool/call` + `tool/result` 按 `callId` 配对为一个 tool 条目：generic 呈现，参数截断、结果摘要为一行（字符串形式的 `meta` 呈现载荷优先于面向模型的结果文本）；fold 同时把未摘要的结果原文保留为 `fullText` 供展开。未配对的结果也会渲染。
- turn/step 边界、request 记录、log-only 标记以及 merge 扩展的未知类型一概不渲染。

## 组件与挂载

`src/components.ts` 实现 `BlueComponent`：`UserMessageComponent`（accent `❯` 边栏）、`AssistantMessageComponent`（Markdown 委托给 `blueComponents.createMarkdown`——pi-tui 自带、按 `setText` 缓存；reasoning 为 muted 斜体；流式 `▌` 光标）、`ToolCallComponent`（`○`/`●` 状态圆点加缩进的 `⎿` 摘要；`setExpanded` 在摘要与未摘要的 `fullText` 之间切换），以及写死的单行 `StatusBarComponent`（model + agent 状态）。文本测宽、换行与截断来自 `blueComponents` 纯函数（`visibleWidth` / `wrapText` / `truncateToWidth`）；`ellipsize` 收在 `src/fold.ts`，并从包根再导出。

插件（`name: 'blue-transcript'`，`inject: ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']`）在 `'blue/session-changed'`（由 `dsh-blue-app` 在 create/resume 完成后发出）时挂载；若加载时 agent 已存在，则从 `blueSession.current` 渲染。它先折叠 `agent.session.events` 快照（resume 的 seed 不重播 `session/event`），再订阅增量事件流并丢弃 seq 不超过快照末尾的事件；每个已应用事件的末尾都调用 `blueScreen.requestRender()`。下一次 session 切换会重挂载，插件卸载时摘除全部组件。插件还注册全局键动作 `blue.transcript.toggle-collapse`（Ctrl-O，带 handler，由 core 的分发器在焦点路由前消费），把全部 tool-call 组件在一行摘要与 `fullText` 之间整体切换；折叠状态在每次会话切换时重置。

## 模型体验

无影响，因为 transcript 把已落日志的 session 事件渲染到终端，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **测宽与 Markdown 归 pi-tui**——测宽/换行经 `blueComponents`，Markdown 经其 `createMarkdown`；pi-tui 自身的精度限制（如 emoji 簇宽度）原样继承，流式感知的 Markdown transform 暂缓。
- **状态栏无扩展缝**——单行 model + 状态为写死实现；`blueStatus` 服务等待首个真实消费者驱动。状态行在 session 事件时刷新而非订阅 `agent/status`，因此状态翻转最晚在下一个 session 事件时显示。
