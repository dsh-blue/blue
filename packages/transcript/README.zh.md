# `@deepseek-ai/dsh-blue-transcript`

[English](README.md) | 中文

Blue 终端 UI transcript 层，构建于 `dsh-blue-core` 之上：从 session 事件到 transcript 条目（user/assistant/tool）的纯折叠、渲染这些条目的组件，以及把它们挂载到 `blueScreen` 的 Cordis 插件。本包不 import pi-tui——每个组件都是自包含的 `BlueComponent`，返回带样式的 ANSI 行。

## 折叠器

`src/fold.ts` 是纯函数管线，不依赖 UI。`TranscriptFolder.apply(event)` 折叠一个 `SessionEvent`（来自 `@deepseek-ai/dsh-session`，仅类型导入）并报告新建或变更的 `TranscriptItem`；`foldSessionEvents(events)` 是一次性形式。

- `user/message` → user 条目（text 块拼接，图片显示为 `[image]`）。
- `assistant/chunk` 的 text/reasoning 增量累积进每个 step 的流式 assistant 条目；收尾的 `assistant/message` 用权威组装消息重写该条目。
- `tool/call` + `tool/result` 按 `callId` 配对为一个 tool 条目：generic 呈现，参数截断、结果摘要为一行（字符串形式的 `meta` 呈现载荷优先于面向模型的结果文本）。未配对的结果也会渲染。
- turn/step 边界、request 记录、log-only 标记以及 merge 扩展的未知类型一概不渲染。

## 组件与挂载

`src/components.ts` 直接实现 `BlueComponent`：`UserMessageComponent`（accent `❯` 边栏）、`AssistantMessageComponent`（极简 Markdown，见 `src/markdown.ts`；reasoning 为 muted 斜体；流式 `▌` 光标；按 text + width 缓存）、`ToolCallComponent`（`○`/`●` 状态圆点加缩进的 `⎿` 摘要），以及写死的单行 `StatusBarComponent`（model + agent 状态）。文本测宽与换行在 `src/width.ts`（CJK 宽字符、样式感知的换行）。

插件（`name: 'blue-transcript'`，`inject: ['blueScreen', 'blueTheme']`）在 `'blue/session-changed'`（由 `dsh-blue-app` 在 create/resume 完成后发出）时挂载；若加载时 agent 已存在，则从 `blueSession.current` 渲染。它先折叠 `agent.session.events` 快照（resume 的 seed 不重播 `session/event`），再订阅增量事件流并丢弃 seq 不超过快照末尾的事件；每个已应用事件的末尾都调用 `blueScreen.requestRender()`。下一次 session 切换会重挂载，插件卸载时摘除全部组件。

## 模型体验

无影响，因为 transcript 把已落日志的 session 事件渲染到终端，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **宽度工具是 pi-tui 的临时替身**——`src/width.ts` 对 ASCII 与 CJK 宽字符是精确的，但对 emoji 簇与组合附加符号是近似的（无 RGI/spacing-mark 表）；当 `dsh-blue-core` 提供组件工厂后，应以工厂实现替换这些辅助函数。
- **Markdown 子集**——`src/markdown.ts` 覆盖标题、围栏代码块、列表、引用、分隔线以及行内 code/bold/链接；表格、嵌套结构与流式感知的 transform 暂缓。
- **状态栏无扩展缝**——单行 model + 状态为写死实现；`blueStatus` 服务等待首个真实消费者驱动。状态行在 session 事件时刷新而非订阅 `agent/status`，因此状态翻转最晚在下一个 session 事件时显示。
