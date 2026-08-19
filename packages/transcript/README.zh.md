# `@dsh-blue/blue-transcript`

[English](README.md) | 中文

Blue 终端 UI transcript 层，构建于 `dsh-blue-core` 之上：从 session 事件到 transcript 条目（user/assistant/tool）的纯折叠、渲染这些条目的组件，以及把它们挂载到 `blueScreen` 的 Cordis 插件。本包不 import pi-tui——组件要么直接返回带样式的 ANSI 行，要么委托给 `blueComponents` 工厂。

## 折叠器

`src/fold.ts` 是纯函数管线，不依赖 UI。`TranscriptFolder.apply(event)` 折叠一个 `SessionEvent`（来自 `@deepseek-ai/dsh-session`，仅类型导入）并报告新建或变更的 `TranscriptItem`；`foldSessionEvents(events)` 是一次性形式。

- `user/message` → user 条目（text 块拼接，图片显示为 `[image]`；图片块同时以 `ImageAttachmentRef[]` 保留在条目上，组件经可选的 `attachments` 服务（`ctx.get` 惰性解析，非 inject）加载真实字节并渲染实际图片（上限 12 行），服务缺失或加载失败时保持 `[image]` 占位）。
- `assistant/chunk` 的 text/reasoning 增量累积进每个 step 的流式 assistant 条目；收尾的 `assistant/message` 用权威组装消息重写该条目。
- `tool/call` + `tool/result` 按 `callId` 配对为一个 tool 条目：generic 呈现，参数截断、结果摘要为一行（字符串形式的 `meta` 呈现载荷优先于面向模型的结果文本）；fold 同时把未摘要的结果原文保留为 `fullText` 供展开。未配对的结果也会渲染——`todo_write` 除外：其调用与结果一律折叠为无（todo 面板拥有该呈现，用户 S13 dogfood 裁决；kimi 保留调用标题、只丢弃正文，Blue 两者皆隐）。
- turn/step 边界、request 记录、log-only 标记以及 merge 扩展的未知类型一概不渲染。

## 组件与挂载

`src/components.ts` 实现 `BlueComponent`：`UserMessageComponent`（roleUser `❯` 边栏）、`AssistantMessageComponent`（Markdown 委托给 `blueComponents.createMarkdown`——pi-tui 自带、按 `setText` 缓存；reasoning 为 muted 斜体；primary 流式 `▌` 光标）、`ToolCallComponent`（运行态 primary `○` 或 success/error `●` 状态圆点，加缩进的 textMuted `⎿` 摘要；`setExpanded` 在摘要与未摘要的 `fullText` 之间切换）。文本测宽、换行与截断来自 `blueComponents` 纯函数（`visibleWidth` / `wrapText` / `truncateToWidth`）；`ellipsize` 收在 `src/fold.ts`，并从包根再导出。

## render intent

`ctx.blueIntents`（`src/intents.ts`，`BlueIntentsService`）是 render-intent 注册表：`register({ intent, create(props) })` 返回幂等 disposer（重复 intent 抛 `BlueIntentsError('DUPLICATE_INTENT')`）；`resolve(intent)` 按精确匹配 → `'generic'` 条目 → 首个注册条目的顺序解析，未知 intent 永不抛错（仅空注册表才 `NO_INTENTS`）。挂载器经它解析 tool 条目组件；内置 `'generic'` 呈现器（即上述 `ToolCallComponent`）在 apply 中第一个注册，成为 plain 基线。注册不追溯已挂载条目——组件在挂载时解析，新注册的 intent 只作用于后续条目。插件 inject 宿主 `'tools'` 服务，fold 条目携带 `parsedArguments`、`rawResult`（重建的 `ToolResult`）与 `view`（call 时为 `ToolCallView`，工具的 `presentResult` 返回时替换为 `ToolResultView`），经包内纯解析器（`src/present.ts`）解析——未知工具、缺失 presenter 或抛错的 presenter 一律回退 generic。Ctrl-O 折叠切换泛化为任何暴露 `setExpanded` 的 intent 组件。

两个 intent 呈现器以子路径插件发布：`./intent-diff`（`blue-intent-diff`，inject `['blueIntents', 'blueTheme', 'blueComponents']`）注册 `'diff'` intent——`DiffCardComponent` 经纯 LCS 行 diff（`src/line-diff.ts`）渲染 `FileDiff` 对，用 theme 的 diff token 着色，折叠时每文件 12 行、展开 200 行；`./intent-terminal`（`blue-intent-terminal`）注册 `'terminal'` intent——`TerminalCardComponent`：description/cwd/`$ command` 头（S13 起 `$` 取 shellMode 色，输出行 textMuted dim 呈现——kimi shell 卡双步映射；完成但无输出的运行显示 `(no output)`），输出行折叠 10、展开 120，exit 徽章经 error/warning 色着色。

## 长会话窗口与 step 折叠

`src/window.ts` 只保持最新已完成 turn 挂载（`DEFAULT_WINDOW_TURNS` = 15；模块级 setter 供测试）。每次折叠事件后——快照重放与增量流同构——挂载器静默逐出更旧 turn 的条目与组件。turn 内：下一个 `step/start` 到达时，上一 step 的工具条目折叠为单个 `step-summary` 条目（`… step N · Tool ×M` 行）；turn 的最后一个 step 保持展开（kimi-parity：每 turn 可见尾部保留工具卡）。step 折叠可经 `setStepFoldingEnabled` 模块级开关。挂载簿记保持 item→component 条目表而非扁平 disposers 数组，折叠与逐出据此精确退役被替换的组件。`tests/perf.spec.ts` 折叠并挂载合成 200-turn 流：窗口保持约 90 个挂载组件（无窗口时 1200），两者均在数十毫秒量级（仅记录，不设时延断言）。

状态行不是写死的组件，而是一条扩展缝。`src/status.ts` 提供 `blueStatus` 服务（`register(entry)`，id 唯一、带 priority；重复 id 抛 `BlueStatusError`，code 为 `DUPLICATE_ENTRY`）与它驱动的 `FooterShellComponent`；插件的 `apply` 经 `blueScreen.addBottomChild(footer, 'bottom')` 一次性挂载该壳——S12 的 kimi dock 顺序把两行状态钉在终端最底行、编辑器之下，上拉对话框面板在它上方升起时保持可见（dock 按挂载序渲染 bottom child、pinned 尾部最后，bundle patch 经 `blueComponents` 激活轮钉住该顺序——同组 patch 行并发挂载，行序本身不能保证 dock 顺序）。shell 把已注册条目排进至多两条带——条目以 `row` 选带（1 为默认，或 2）、以 `align` 选边（`'left'` 为默认，或 `'right'`；不合法值收进范围内）。同一带的左侧簇内按 priority 升序（同优先级保持注册顺序）、以两空格 slot 间距连接——S15 的 kimi footer 身份：没有 ` · `、分隔符也不着色，各条目自带灰阶档位（内置槽位跑三档：model/context 用全强度 `text` 前景，cwd/git 用 muted，tips 用 textMuted；D27）。右侧簇在最少两空格间距后右对齐，宽度压力下先于左侧簇让位。每个条目被给予其簇剩余的宽度预算并自行截断（宽过整行的条目与返回 `''` 的条目一样跳过，不留间距残渣）。无注册或无可见条目时渲染零行；注册与注销都会触发重渲染。条目本身以子路径插件发布，供组装 bundle 列为独立 patch 行：`./status-basic`（`blue-status-basic`，优先级 0：仅 model 名，text 色——agent 状态文本随 S15 退役，运行中的 agent 归 activity spinner 表达，kimi 的 footer 同样不带状态文本——model 优先取持久化的 request header，`session.requestHeader()?.config.model ?? agent.options.model ?? agent.options.provider ?? 'no model'`）、`./status-cwd`（`blue-status-cwd`，优先级 5，muted 色：会话工作目录，home 缩写后在深路径下缩到末三段、其余折叠成前导 `…`——kimi `shortenCwd` 移植——读自持久化会话 header、回退 `process.cwd()`，随 `'blue/session-changed'` 刷新）、`./status-git`（`blue-status-git`，优先级 10，muted 色：完整 kimi 徽章 `branch [+a -d ↑e↓f]`——脏树上 diff 计数取自 `git diff --numstat HEAD --`、ahead/behind 标记取自 porcelain 分支头、numstat 探测本身失败时退为裸 `±`——经 TTL 缓存（branch 5s、status 15s）按会话 cwd 每次渲染惰性探测，非 git 仓库不显示）、`./status-tips`（`blue-status-tips`，优先级 30，带 1 右对齐，textMuted 色：轮换教学提示，宽度允许时以 `' | '` 并列两条——轮换以 smooth weighted round-robin（nginx SWRR，同 kimi-code）摊开 `STATUS_TIPS` 池，`solo` 提示从不配对——以显式 10s ticker 推进索引，因为 Blue 的渲染严格事件驱动，而 kimi 靠无关重绘刷帧）、`./status-context`（`blue-status-context`，优先级 20，带 2 右对齐，text 色：最新一步的 context 占用，会话 request context 带上下文窗口时渲染 `context: N% (K/M)`——N 为向上取整的占用份额，K/M 为 1024 基缩写——无窗口时降级 `ctx N` / `ctx N.Nk`；取最新 `assistant/message` usage 的 `inputTokens + cacheReadTokens + cacheWriteTokens`）。

下游贡献是一条 `BlueStatusEntry`（`src/types.ts`）：`{ id, priority, row?, align?, render(width) }`——`id` 为稳定的点分插件自有字符串；`priority` 决定簇内顺序（内置条目占 0/5/10/20/30，之间与之后留有空位）；`row` 选带（1 或 2）；`align` 选边（`'left'` 或 `'right'`，右侧簇右对齐且最先让位）；`render(width)` 返回一行带样式文本（允许 ANSI），可见宽度不超过给定预算——或返回 `''` 表示本帧不占位（连分隔符位也不占）。`ctx.blueStatus.register(entry)` 返回幂等 disposer；注册应包在 `ctx.effect` 里，使插件 fiber 卸载时条目随之注销。

另有三个 dock pane 以子路径插件发布；各自经 `blueScreen.addBottomChild` 挂载被动底钉组件，无内容时渲染零行。`./pane-activity`（`blue-pane-activity`，inject `['blueScreen', 'blueTheme']`）是单行 spinner——primary 的 braille 帧加 muted 的 `working…` 标签——仅在挂载的 agent 运行时显示：挂载时读 `agent.status` 作初值，`'agent/status'` 翻转驱动状态迁移，100ms 间隔推进帧（计时原语在模块级可替换的 `setActivityTimers` 之后，沿袭 status-git runner 先例）；idle 时渲染零行。`./pane-todo`（`blue-pane-todo`，inject `['blueScreen', 'blueTheme', 'blueKeymap', 'blueComponents']`）折叠会话的整表 `todo/write` 快照（last-write-wins；每次挂载先扫持久化事件快照再订增量流）；fold 已把 `todo_write` 工具调用逐出消息流，面板因此是列表的唯一呈现面。两种状态都置于 kimi todo 框下（S13，用户 dogfood 裁决）——全宽平 `─` 规则 + 粗体 primary 的 `  Todo` 标题 + 两列缩进行，kimi 三态点 `✓` success / `●` primary 粗体 / `○` 暗色，已完成内容 muted 加删除线，无侧边、无圆角、无底边框。长列表按 kimi 选择器折叠：至多五行——先收全部 `in_progress`，再以最早的 `pending` 与最近的 `completed` 补足（两侧并存时为完成侧保留一席）—— footer 一行 muted 的 `… +N more (2 done · 1 pending) · ctrl+t to expand` 统计隐藏条目。全局动作 `blue.todo.toggle`（Ctrl-T，带 handler）切换到整表，footer 换 `all N items · ctrl+t to collapse`；展开态跨写入保留（kimi `setTodos` 语义），会话切换或列表完结时复位。全部条目完成的列表自动关闭面板（kimi session-event-handler 规则），下一次写入重新以折叠态打开。`./pane-btw`（`blue-pane-btw`，inject `['blueScreen', 'blueTheme', 'blueComponents', 'commands', 'agents']`）自注册 `/btw <question>` 命令：把当前会话 fork 成一次性旁路 agent——`agents.create` 以全量事件流为 seed、父会话的 provider/model 为 `agentOptions`、附 fork 谱系 meta（`cwd`、`parentSession`、`seedLength`）——以 follow-up 发出问题，并以 kimi btw-panel 移植形态渲染问答（S13）：`topRule` 边框内标题（` BTW ` + `Esc close`/`Esc close · ↑↓ scroll ` hint，后者仅正文溢出时）下是 `roleUser` 的 `› question` 行、经 `createMarkdown` 渲染的流式回复与 muted `thinking…` 行，套 kimi `fitBodyLines` 机制——行预算 `max(3, floor(rows/3)) - 1` 取自活读的 `blueScreen.rows`（终端 resize 即重排）、minBodyLines 棘轮、尾随 + 手动 ↑/↓ 滚动、滚动状态随问题重置——尾随一个空行 spacer。面板是被动底钉组件、从不消费按键：打开时 emit `'blue/editor-connected-above'`（附侧边 agent 回答中的 busy 标志）使编辑框顶角拼接为 `├┤`，编辑器键链以 `'blue/btw-command'` 把 Esc/↑/↓/Enter 路由回 close/scroll/submit——Enter 在同一旁路 agent 上续问，追加为一轮。槽位单一：再次 `/btw` 先 dispose 上一个旁路 agent；无参 `/btw` 收起面板并 dispose 槽位。

## 欢迎横幅

`./banner`（`blue-banner`，inject `['blueScreen', 'blueTheme', 'blueComponents', 'agentDefaultModel']`）在启动时把欢迎盒一次性挂载为滚动区第一子，采用 Claude Code 式布局：居中的左栏——"Welcome back!"、像素鲸鱼、挂载时从 `agentDefaultModel.currentSelection()` 快照的 `model · provider` 行（不读 `blueSession`——实时模型由 footer 呈现）、经本地 `shortenHome` 缩写为 `~` 的 cwd——旁边是右栏，承载 `src/banner-content.ts` 的 Tips 与 What's new 两节，两节之间一条分隔横线（S16 起 Tips 不再是占位文案——从 S15 的 footer 轮换池 `src/tips-content.ts` 派生，取权重最高的五条可共享条目，横幅与 footer 轮换共享同一内容源；What's new 节保持逐版本手工编辑文案；五条 tips 加三行 what's-new 恰好填满右栏十一个正文行）。盒子铺满视口全宽（视口给右栏留足 30 列起左栏固定 44 列——即 ≥77 列，默认 80 列终端两节齐备）；再窄则左栏吸收全宽，低于 40 列渲染零行。高度取两栏较高者（默认内容下十三行）。鲸鱼（`src/banner-art.ts`）是 blue 之名的喷水鲸鱼：文字点水花（`· .` 液滴，刻意不用像素块）在四行像素身体上方，身体从 S8 网格手工等比缩至 0.8 并保留全部不对称（喷水行左侧内收成侧鳍轮廓、身体保留缺口与两侧内缩、腹部左凸）。同模块的 `BLUE_VERSION` 常量供给标题行的 `blue v…`，由 spec 对着 `package.json` 守卫防漂移。一切超宽文本一律截断、绝不折行。着色只用现有 theme token（框、鲸鱼与欢迎行 `primary`——kimi 欢迎框手法，整体一个蓝色单元；模型行 `accent`）。bundle patch 中该行位于 `blue-transcript` 之前，使二者在共同的 `blueComponents` 激活轮内按行序挂载、`/theme` 换装 reload 后横幅仍是滚动区第一子；删除该 patch 行即移除横幅。

插件（`name: 'blue-transcript'`，`inject: ['blueScreen', 'blueTheme', 'blueComponents', 'blueKeymap']`）在 `'blue/session-changed'`（由 `dsh-blue-app` 在 create/resume 完成后发出）时挂载；若加载时 agent 已存在，则从 `blueSession.current` 渲染。它先折叠 `agent.session.events` 快照（resume 的 seed 不重播 `session/event`），再订阅增量事件流并丢弃 seq 不超过快照末尾的事件；每个已应用事件的末尾都调用 `blueScreen.requestRender()`。下一次 session 切换会重挂载，插件卸载时摘除全部组件。插件还注册全局键动作 `blue.transcript.toggle-collapse`（Ctrl-O，带 handler，由 core 的分发器在焦点路由前消费），把全部 tool-call 组件在一行摘要与 `fullText` 之间整体切换；折叠状态在每次会话切换时重置。

## 模型体验

无影响，因为 transcript 把已落日志的 session 事件渲染到终端，不注册任何模型可见的内容。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **测宽与 Markdown 归 pi-tui**——测宽/换行经 `blueComponents`，Markdown 经其 `createMarkdown`；pi-tui 自身的精度限制（如 emoji 簇宽度）原样继承，流式感知的 Markdown transform 暂缓。
- **footer 上限两行**——两行都放不下的条目按最低优先级丢弃；git 分支仅在会话挂载时探测（无 fs 监听），会话中途切换分支要等下一次会话切换才显示。
