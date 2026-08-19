# `@deepseek-ai/dsh-blue-transcript`

[English](README.md) | 中文

Blue 终端 UI transcript 层，构建于 `dsh-blue-core` 之上：从 session 事件到 transcript 条目（user/assistant/tool）的纯折叠、渲染这些条目的组件，以及把它们挂载到 `blueScreen` 的 Cordis 插件。本包不 import pi-tui——组件要么直接返回带样式的 ANSI 行，要么委托给 `blueComponents` 工厂。

## 折叠器

`src/fold.ts` 是纯函数管线，不依赖 UI。`TranscriptFolder.apply(event)` 折叠一个 `SessionEvent`（来自 `@deepseek-ai/dsh-session`，仅类型导入）并报告新建或变更的 `TranscriptItem`；`foldSessionEvents(events)` 是一次性形式。

- `user/message` → user 条目（text 块拼接，图片显示为 `[image]`；图片块同时以 `ImageAttachmentRef[]` 保留在条目上，组件经可选的 `attachments` 服务（`ctx.get` 惰性解析，非 inject）加载真实字节并渲染实际图片（上限 12 行），服务缺失或加载失败时保持 `[image]` 占位）。
- `assistant/chunk` 的 text/reasoning 增量累积进每个 step 的流式 assistant 条目；收尾的 `assistant/message` 用权威组装消息重写该条目。
- `tool/call` + `tool/result` 按 `callId` 配对为一个 tool 条目：generic 呈现，参数截断、结果摘要为一行（字符串形式的 `meta` 呈现载荷优先于面向模型的结果文本）；fold 同时把未摘要的结果原文保留为 `fullText` 供展开。未配对的结果也会渲染。
- turn/step 边界、request 记录、log-only 标记以及 merge 扩展的未知类型一概不渲染。

## 组件与挂载

`src/components.ts` 实现 `BlueComponent`：`UserMessageComponent`（roleUser `❯` 边栏）、`AssistantMessageComponent`（Markdown 委托给 `blueComponents.createMarkdown`——pi-tui 自带、按 `setText` 缓存；reasoning 为 muted 斜体；primary 流式 `▌` 光标）、`ToolCallComponent`（运行态 primary `○` 或 success/error `●` 状态圆点，加缩进的 textMuted `⎿` 摘要；`setExpanded` 在摘要与未摘要的 `fullText` 之间切换）。文本测宽、换行与截断来自 `blueComponents` 纯函数（`visibleWidth` / `wrapText` / `truncateToWidth`）；`ellipsize` 收在 `src/fold.ts`，并从包根再导出。

## render intent

`ctx.blueIntents`（`src/intents.ts`，`BlueIntentsService`）是 render-intent 注册表：`register({ intent, create(props) })` 返回幂等 disposer（重复 intent 抛 `BlueIntentsError('DUPLICATE_INTENT')`）；`resolve(intent)` 按精确匹配 → `'generic'` 条目 → 首个注册条目的顺序解析，未知 intent 永不抛错（仅空注册表才 `NO_INTENTS`）。挂载器经它解析 tool 条目组件；内置 `'generic'` 呈现器（即上述 `ToolCallComponent`）在 apply 中第一个注册，成为 plain 基线。注册不追溯已挂载条目——组件在挂载时解析，新注册的 intent 只作用于后续条目。插件 inject 宿主 `'tools'` 服务，fold 条目携带 `parsedArguments`、`rawResult`（重建的 `ToolResult`）与 `view`（call 时为 `ToolCallView`，工具的 `presentResult` 返回时替换为 `ToolResultView`），经包内纯解析器（`src/present.ts`）解析——未知工具、缺失 presenter 或抛错的 presenter 一律回退 generic。Ctrl-O 折叠切换泛化为任何暴露 `setExpanded` 的 intent 组件。

两个 intent 呈现器以子路径插件发布：`./intent-diff`（`blue-intent-diff`，inject `['blueIntents', 'blueTheme', 'blueComponents']`）注册 `'diff'` intent——`DiffCardComponent` 经纯 LCS 行 diff（`src/line-diff.ts`）渲染 `FileDiff` 对，用 theme 的 diff token 着色，折叠时每文件 12 行、展开 200 行；`./intent-terminal`（`blue-intent-terminal`）注册 `'terminal'` intent——`TerminalCardComponent`：description/cwd/`$ command` 头，输出行折叠 10、展开 120，exit 徽章经 error/warning 色着色。

## 长会话窗口与 step 折叠

`src/window.ts` 只保持最新已完成 turn 挂载（`DEFAULT_WINDOW_TURNS` = 15；模块级 setter 供测试）。每次折叠事件后——快照重放与增量流同构——挂载器静默逐出更旧 turn 的条目与组件。turn 内：下一个 `step/start` 到达时，上一 step 的工具条目折叠为单个 `step-summary` 条目（`… step N · Tool ×M` 行）；turn 的最后一个 step 保持展开（kimi-parity：每 turn 可见尾部保留工具卡）。step 折叠可经 `setStepFoldingEnabled` 模块级开关。挂载簿记保持 item→component 条目表而非扁平 disposers 数组，折叠与逐出据此精确退役被替换的组件。`tests/perf.spec.ts` 折叠并挂载合成 200-turn 流：窗口保持约 90 个挂载组件（无窗口时 1200），两者均在数十毫秒量级（仅记录，不设时延断言）。

状态行不是写死的组件，而是一条扩展缝。`src/status.ts` 提供 `blueStatus` 服务（`register(entry)`，id 唯一、带 priority；重复 id 抛 `BlueStatusError`，code 为 `DUPLICATE_ENTRY`）与它驱动的 `FooterShellComponent`；插件的 `apply` 经 `blueScreen.addBottomChild` 一次性挂载该壳，底钉在输入编辑器上方（dock 按挂载序渲染 bottom child，bundle patch 经 `blueComponents` 激活轮钉住该顺序——同组 patch 行并发挂载，行序本身不能保证 dock 顺序）。shell 按 priority 升序（同优先级保持注册顺序）把已注册条目排进至多两行，以 muted 的 ` · ` 连接，放不下的溢出到第二行，两行都放不下的按最低优先级丢弃；无注册或无可见条目时渲染零行；注册与注销都会触发重渲染。条目本身以子路径插件发布，供组装 bundle 列为独立 patch 行：`./status-basic`（`blue-status-basic`，优先级 0：`{model} · {agent 状态}`，model 优先取持久化的 request header——`session.requestHeader()?.config.model ?? agent.options.model ?? agent.options.provider ?? 'no model'`——状态由真实的 `'agent/status'` 订阅驱动）、`./status-git`（`blue-status-git`，优先级 10：每次会话挂载时经 `git branch --show-current` 探测当前分支，非 git 仓库不显示）、`./status-context`（`blue-status-context`，优先级 20：最新一步的 context 占用，取最新 `assistant/message` usage 的 `inputTokens + cacheReadTokens + cacheWriteTokens`，格式 `ctx N` / `ctx N.Nk`）。

下游贡献是一条 `BlueStatusEntry`（`src/types.ts`）：`{ id, priority, render(width) }`——`id` 为稳定的点分插件自有字符串；`priority` 决定布局顺序（内置条目占 0/10/20，之间与之后留有空位）；`render(width)` 返回一行带样式文本（允许 ANSI），可见宽度不超过给定预算——或返回 `''` 表示本帧不占位（连分隔符位也不占）。`ctx.blueStatus.register(entry)` 返回幂等 disposer；注册应包在 `ctx.effect` 里，使插件 fiber 卸载时条目随之注销。

另有三个 dock pane 以子路径插件发布；各自经 `blueScreen.addBottomChild` 挂载被动底钉组件，无内容时渲染零行。`./pane-activity`（`blue-pane-activity`，inject `['blueScreen', 'blueTheme']`）是单行 spinner——primary 的 braille 帧加 muted 的 `working…` 标签——仅在挂载的 agent 运行时显示：挂载时读 `agent.status` 作初值，`'agent/status'` 翻转驱动状态迁移，100ms 间隔推进帧（计时原语在模块级可替换的 `setActivityTimers` 之后，沿袭 status-git runner 先例）；idle 时渲染零行。`./pane-todo`（`blue-pane-todo`，inject `['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']`）折叠会话的整表 `todo/write` 快照（last-write-wins；每次挂载先扫持久化事件快照再订增量流）：折叠时渲染一行 muted 的 `todos N/M`（完成数/总数），展开时逐条渲染——`☑` muted 已完成、`◐` accent 进行中、`☐` 待办；含进行中条目的列表默认展开，其余默认折叠；全局动作 `blue.todo.toggle`（Ctrl-T，带 handler）手动翻转，直至下一次写入重新推导默认值。`./pane-btw`（`blue-pane-btw`，inject `['blueScreen', 'blueTheme', 'blueComponents', 'commands', 'agents']`）自注册 `/btw <question>` 命令：把当前会话 fork 成一次性旁路 agent——`agents.create` 以全量事件流为 seed、父会话的 provider/model 为 `agentOptions`、附 fork 谱系 meta（`cwd`、`parentSession`、`seedLength`）——以 follow-up 发出问题，并在面板渲染问答（`roleUser` 的 `› question` 行、流式回复、旁路 agent 回到 idle 前的 muted `thinking…` 行，封顶最近 20 行）。槽位单一：再次 `/btw` 先 dispose 上一个旁路 agent；无参 `/btw` 收起面板并 dispose 槽位。

## 欢迎横幅

`./banner`（`blue-banner`，inject `['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']`）在启动时把 Claude Code 风格的欢迎盒一次性挂载为滚动区第一子。盒子铺满视口整个宽度，分两格：左格紧贴像素城堡自身的修剪宽度（`src/banner-art.ts` 里离线生成的 20×20 网格，经纯函数 `packHalfBlockArt` 打包为八行半块字符后切掉全空白的边缘列），右格拿走其余全部宽度——"Welcome back!" 行、挂载时从 `agentDefaultModel.currentSelection()` 快照的 `model · provider` 行（不读 `blueSession`——实时模型由 footer 呈现）、经本地 `shortenHome` 缩写为 `~` 的 cwd，以及右格宽度 ≥30 列后加入的 `src/banner-content.ts` 快速上手 Tips 节（当前为占位文案；what's-new 占位随 S16 的真实右栏内容回归）；同模块的 `BLUE_VERSION` 常量供给标题行的 `blue v…`，由 spec 对着 `package.json` 守卫防漂移。盒子高度取城堡与右格的较高者（默认内容下十行），右格更高时城堡垂直居中。横幅随视口自适应：低于 40 列渲染零行；一切超宽文本一律截断、绝不折行。着色只用现有 theme token（框、城堡与欢迎行 `primary`——kimi 欢迎框手法，整体一个蓝色单元；模型行 `accent`）。bundle patch 中该行位于 `blue-transcript` 之前，使二者在共同的 `blueComponents` 激活轮内按行序挂载、`/theme` 换装 reload 后横幅仍是滚动区第一子；删除该 patch 行即移除横幅。

插件（`name: 'blue-transcript'`，`inject: ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']`）在 `'blue/session-changed'`（由 `dsh-blue-app` 在 create/resume 完成后发出）时挂载；若加载时 agent 已存在，则从 `blueSession.current` 渲染。它先折叠 `agent.session.events` 快照（resume 的 seed 不重播 `session/event`），再订阅增量事件流并丢弃 seq 不超过快照末尾的事件；每个已应用事件的末尾都调用 `blueScreen.requestRender()`。下一次 session 切换会重挂载，插件卸载时摘除全部组件。插件还注册全局键动作 `blue.transcript.toggle-collapse`（Ctrl-O，带 handler，由 core 的分发器在焦点路由前消费），把全部 tool-call 组件在一行摘要与 `fullText` 之间整体切换；折叠状态在每次会话切换时重置。

## 模型体验

无影响，因为 transcript 把已落日志的 session 事件渲染到终端，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **测宽与 Markdown 归 pi-tui**——测宽/换行经 `blueComponents`，Markdown 经其 `createMarkdown`；pi-tui 自身的精度限制（如 emoji 簇宽度）原样继承，流式感知的 Markdown transform 暂缓。
- **footer 上限两行**——两行都放不下的条目按最低优先级丢弃；git 分支仅在会话挂载时探测（无 fs 监听），会话中途切换分支要等下一次会话切换才显示。
