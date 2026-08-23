# Blue P1 分层设计：kimi-code 能力对照、层职责定稿与缝清单

> **归档说明（2026-08-21，R6b 文档清账）**：本文档已完成历史使命，移入 docs/history/，正文保持归档时点原貌、不做改写。P1（S0-S9）已全部落地，缝清单正典现为 [blue-seams.md](../blue-seams.md)。更正：§4.3 的 ⛔/🚫 判定（/compact、/title 与 /tasks 前提、/yolo `/plan` `/permission`、/settings /reload、"不做"清单含 /provider /init /mcp* 等）为 P1 时点判定、已系统性偏窄，更正正典见 [blue-commands-plan.md](../blue-commands-plan.md) §1.3，运行时状态以 [blue-seams.md](../blue-seams.md) §3 为准。现状以 [blue-roadmap.md](../blue-roadmap.md)、[blue-decisions.md](../blue-decisions.md) 为准；索引见 [docs/README.md](../README.md)。

> 姊妹文档：[blue-architecture.md](../blue-architecture.md)（架构蓝图）、[blue-roadmap.md](../blue-roadmap.md)（阶段路线图）、[blue-decisions.md](../blue-decisions.md)（ADR，本文决策见 D17-D21）
> 本文档回答三个问题：**每层放什么**（§2，允许破坏性重排）、**kimi-code 的每项能力落到哪**（§3-§5）、**下游插件能用哪些缝**（§6）。
> 参照系：kimi-code（MoonshotAI，pi-tui 系 TUI，调研基于其源码，非视觉复刻目标）。

## 1. 总则

### 1.1 plain-first：表面皆插件的可验收形态

任何非平凡的视觉/交互表面不得烤进宿主插件。宿主只提供**缝 + plain 默认实现**；增强实现——包括 Blue 自己的——都是经缝注册的贡献。判别条款：

- **plain 基线**：拔掉所有增强插件行后仍完整可用的最小树（见 §7）。基线的每个表面必须已有对应的缝。
- **自家先当消费者**：Blue 的 footer 条目、主题、render intent 等增强全部经自家缝注册，与下游插件同权。缝好不好用，先拿自己试。

### 1.2 破坏性重排的边界

roadmap 原定"L1 签名 MVP 定稿后只增不改"。本文档行使一次**有边界的破坏性许可**：

- 允许：把 MVP 期误放层内的实现迁出（如 core 内的 dark palette）、退役临时自研件（`BlueInput`/`markdown.ts`/`width.ts`）、扩展契约字段（`BlueSemanticColors` 全量化、`BlueKeyAction.handler`）。
- 不允许：破坏三条纪律（焦点/键位/弹窗）、破坏依赖单向性、让 pi-tui 类型越过 L0。
- 本文档定稿后，L1 恢复"只增不改"，直至 P3 冻结。

### 1.3 标记约定

- ✅ 已核实（dsh `0.1.0-rc.7` 已安装包内确认存在）
- 📖 调研文档记载存在，未在本仓库依赖闭包内核实
- 🔍 S0 检查点，实施前必须验证
- ⛔ 上游缺口，需先在 harness 做能力缝
- 🚫 不做（kimi 产品特定或非 Blue 职责）

## 2. 层职责定稿

### 总览

```
L4  app/bundle   启动参数 · 会话生命周期 · blueSession 契约 · patch 组合
L3  transcript   fold · 消息组件 · blueStatus 服务+footer壳 · pane 插件 · intent 注册表
L2  interaction  编辑器实例 · 输入模式 · 补全 · 命令 · 审批/提问 · 全局键注册
L1  core 契约    BlueComponent · blueScreen · blueKeymap · blueTheme(契约) · blueComponents · blueTerminalInfo
L0  core 内部    终端生命周期 · OSC 11 · alt-screen · 全局键分发器 · pi-tui 组件适配
                 dsh-base（agents/sessions/commands/userQuestions/approval/…）
```

### 2.1 L0 — pi-tui 适配（core 包内部，全树唯一 import pi-tui）

**保留**：终端生命周期（`ProcessTerminal` + `TuiMainScreen`）、stable Proxy 引用、`createTerminalRelease()`、bottom-pin 挂载语义。

**新增**：

- **OSC 11 背景探测**：在 `ProcessTerminal` 进 raw mode **之前**查询（kimi 的硬约束），超时回退 `undefined`；结果发布进 L1 的 `blueTerminalInfo`。✅ S0 已核实（pi-tui 0.84.2）：优先走内置 `queryTerminalBackgroundColor()`（其应答由 pi-tui 计数消费）与 `onTerminalColorSchemeChange`（DEC `CSI ? 997 ; 1/2 n` 上报被无条件消费，`tui.js:627-657`）；Blue 自发查询的应答不在内置计数内，需自挂 input listener 以 `{ consume: true }` 吞掉。终端主题切换时 emit `'blue/terminal-theme-changed'`。
- **alt-screen**：`TuiAltScreen` 作为第二渲染器，经 Proxy 引用运行时热切换；退出 alt-screen 时把转录重放回主屏 scrollback（kimi `stopUiForExit` 同款语义）。
- **全局键分发器**：`addInputListener` 装在焦点路由之前，只消费 `blueKeymap` 中带 `handler` 的全局动作，其余输入原样放行给焦点组件。✅ S0 已核实（`tui.js:553-626`）：listener 链严格先于焦点组件 dispatch；返回 `{ consume: true }` 整体吞掉、`{ data }` 改写给后续 listener 与焦点组件、返回 `undefined` 原样放行——与设计完全吻合。
- **pi-tui 组件适配**（`blueComponents` 的实现侧）：`Editor`、`Markdown`、`SelectList`、`SettingsList` → Blue 类型化组件；`visibleWidth`/`wrapTextWithAnsi`/`truncateToWidth` → 纯函数再导出；`Image`（S7 已落地，附无图像协议终端的样式化文本回退与纯 `imageDimensions` 探针）。
- **可打印键解码**：Kitty CSI-u（`\x1b[113u`）序列 → 字符的解码工具，供不走 Editor 的自研组件使用（kimi `printable-key.ts` 同款；Editor 路径由 pi-tui 内部解决）。

### 2.2 L1 — 契约层（`core/src/types.ts`）

**保留**：`BlueComponent` / `BlueFocusable` / overlay 句柄族 / `blueScreen` / `blueKeymap`。

**破坏性调整**：

- **`blueTheme` 拆为契约 + 独立 provider**。core 只持有 `BlueTheme`/`BlueSemanticColors` 类型；MVP 内嵌的 dark palette 迁出为 `blue-theme-dark` 插件（plain 默认，进基线 patch）。这是 provider 替换（决策 D18）的结构前提：主题 plugin fiber 可独立 dispose/换装，inject `blueTheme` 的插件随之自动 reload。
- **`BlueSemanticColors` 全量化**（26 token，见 §5.1）。破坏性但对下游是编译期可发现的，且此时 Blue 只有自家 provider。

**新增契约**：

- **`BlueComponents`**（`ctx.blueComponents`）：组件工厂接口。Blue 自有类型进、Blue 组件出，pi-tui 类型不越界。
- **`BlueTerminalInfo`**（`ctx.blueTerminalInfo`）：`background: 'dark'|'light'|undefined`、`kittyKeyboard: boolean` 等终端事实。
- **`BlueKeyAction.handler`**（可选字段）：带 handler 的动作成为全局动作，由 L0 分发器在焦点路由前消费。

**移除**：core 内的 dark palette 实现（迁出，见上）。

### 2.3 L2 — interaction 包

**保留**：命令插件骨架（`/quit` `/resume`）、审批 waterfall answerer、userQuestions provider、`ctx.get('blueSession')` 读取纪律、键位全走 `blueKeymap`。

**换装**：

- 编辑器实例改用 `blueComponents.createEditor`——一次获得多行、历史、kill-ring、undo、paste-burst、Kitty 解码。`BlueInput` 退役。
- 单选列表改用 `blueComponents.createSelectList`；`BlueSelect` 收窄为包内多选专用（pi-tui 无多选组件），不再从包根导出；`BluePanel`（纯 header+child 容器）保留为唯一的公开组件导出。

**新增**（均为包内子路径插件入口，不增包）：

- `./editor-plus`：输入模式状态（`prompt|bash`）——`!` 不进 buffer、prompt 符号与边框色切换、提交后自动退回 prompt；`@` 文件补全 provider（fd 优先、fs 扫描回退，上限防爆）；slash 补全 provider（数据来自 `ctx.commands.list`）。
- `./global-keys`：注册全局动作——`ctrl+o` 折叠切换（handler 发事件，transcript 消费）、`shift+tab` 模式切换（待上游 ⛔）、`ctrl+s` steer（✅ `agent.steer`）。编辑器语境动作（`ctrl+c` 中断/双击退出、`esc` 级联）留在编辑器组件内经 `matches` 解析，不进全局分发器——避免与 overlay 的 `escape=cancel` 抢键。
- 审批升级：四选项（allow once / allow session / reject / reject+feedback）、数字键直选、**session 级继承**（Blue 侧队列协调器：同 `toolName` 后续请求自动放行；上游 outcome 无 session 档，照搬 kimi `autoResolveFor` 思路）、弹窗排队互斥协调器、Ctrl-E diff 预览（100% overlay，P2 依赖 diff intent）。✅ S6 已落地前四项（session 级继承落地为 answerer 侧模块级 `WeakMap<Agent, Set<string>>`；排队为 FIFO 数组 + active 标志）；Ctrl-E diff 预览仍 P2。
- 提问 tab 化：多题单弹窗、tab 条状态、Other 自由文本项。✅ S6 已落地。
- 命令扩充：见 §4 对照表。

**纪律**：弹窗只走 `showOverlay`（决策 D19）。全屏对话框 = `width/maxHeight: 100%` 的 overlay；不引入 editor-replacement 范式。

### 2.4 L3 — transcript 包

**保留**：纯折叠器 `fold.ts`（无 UI 依赖）、快照→订阅挂载序（D16）、组件渲染缓存范式。

**换装**：`markdown.ts`、`width.ts` 退役，改用 `blueComponents` 的 Markdown 组件与宽度函数。

**新增**：

- **`ctx.blueStatus` 服务 + footer 壳**（决策 D20）：条目注册表（`{ id, priority, render(width) }`，注册返回 disposer）；footer 两行容器组件负责排序/截断/渲染。**plain 默认条目**（`model · status`）是独立贡献插件 `blue-status-basic`，降级为第一个注册者——现有 `StatusBarComponent` 就此拆分消灭。
- **pane 插件**（子路径入口）：`./pane-activity`（spinner + 状态提示，消费 `agent/status` ✅）、`./pane-queue`（✅ S0 已核实：`agent.inbox` 公开投影——`nextTurn`/`nextStep`/`hasPending` + `remove(messageId)` 召回 + `agent/inbox/inserted|claimed|discarded` 增量事件，durable 可重放；无需弱版本兜底）、`./pane-todo`（⛔ 无 `sessionProjections` 服务；改为自折叠 `todo/write` 会话事件——整表快照 last-write-wins，`TodoItem = { content, status }`；注意 rc.7 尚无生产者发射该事件，pane 先行兼容）、`./pane-btw`（`/btw` 旁路面板，与 L2 的 `/btw` 命令配对）。✅ S6 已落地（四件全出；偏差：pane-queue 归 interaction 包——召回需编辑器缝；`/btw` 由 pane-btw 自注册而非 L2+L3 配对）。pane 不开顺序缝：dock 钉序靠 inject 解析序（Loader 同组行并发挂载，行序≠挂载序；S6 机制修正，见 §7 S6 行），组合层以行级 inject 钉轮次。
- **render intent 注册表**（S7 已落地）：`blueIntents.register({ intent, create })`；generic 呈现器（现 `ToolCallComponent`）降级为第一个注册者；未知 intent 永远回退 generic——与 fold 的 default 忽略同哲学。resolve 链为 exact → 'generic' → 首个注册者，空注册表才抛错；已挂载条目不追溯换装（组件在挂载时解析）。
- **长会话滑动窗口**（S7 已落地）：保留最近 N turn（默认 15），旧 turn 组件+条目整体销毁；turn 内旧 step 折叠为摘要行（kimi `StepSummaryComponent` 同款）——具体为当前 turn 的下一个 `step/start` 到达时折叠上一个 step 的工具条目，turn 的最后一个 step 保持展开（kimi-parity：可见尾部保留工具卡）。
- `./banner`：welcome/banner 插件。✅ S8 已落地（`blue-banner`，基线段行且位于 blue-transcript 前——同 blueComponents 轮按行序激活，保滚动区首子位跨 /theme 换装 reload；`agentDefaultModel` 启动快照 + 像素城堡 half-block + 自适应宽度 + 右栏占位内容，详见 §7 S8 行与 D22）

### 2.5 L4 — app + bundle

**保留**：startup provider（`[task]`、`--resume`）、`blueSession` 契约与 commit-point 语义（D15）、串行 resume 队列。

**新增**：startup flags 按上游核实结果逐个加（`--model` ✅——`cmdlineArgs` 为透传语义，dsh 无内置 app flag 概念，Blue 在自己的 commander program 加 `--model <ref>` 即可，映射到 `agentOptions` + `ModelSelectionRef` 初值；`--yolo/--plan` ⛔ 上游无 presets）；`cordis.patch.yml` 扩展为分段注释结构（S6 落地为基线/增强/装配三段，dock 钉序靠 inject 解析序，见 §7）；默认 patch 插入全部自家增强插件——Blue 的产品形态即"缝 + 插件组合"的示范。

## 3. kimi-code 能力对照：布局与 chrome

| kimi-code 能力 | kimi 实现 | Blue 落点 | 上游依赖 | 阶段 |
|---|---|---|---|---|
| 转录区消息流（Markdown/工具卡/思考块/步骤摘要/shell 回显） | `components/messages/*` | L3 组件 + fold 扩展 | ✅ session 事件 | 部分已有；思考块/摘要 P1，shell 回显 P2 |
| ActivityPane（spinner + loading tip） | `components/chrome/` + `streaming-ui.ts` | L3 `pane-activity` 插件 | ✅ `agent/status` | P1 |
| TodoPanel | `chrome/todo-panel` | L3 `pane-todo` | ⛔ 无 `sessionProjections`；自折叠 `todo/write` 事件（rc.7 尚无生产者） | P1 |
| QueuePane（排队消息 ↑ 召回） | `panes/queue-pane` | L3 `pane-queue` | ✅ `agent.inbox`（`nextTurn`/`nextStep` + `remove()` 召回 + `agent/inbox/*` 事件） | P1 |
| BtwPanel（旁路对话） | `panes/btw-panel` + `controllers/btw-panel.ts` | L2 `/btw` 命令 + L3 `pane-btw` | ✅ `session.fork` + Agent | P1 示范插件（roadmap 原定） |
| 带边框 Editor（模式色边框） | `editor/custom-editor.ts` | L2 工厂 Editor + 边框组件 | 无 | P1 |
| Footer 两行 + 可配置 slot + git/context/tasks 徽章 + 轮换 tips | `chrome/footer.ts` | L3 blueStatus + 条目插件群 | git 用 spawnSync（无依赖）；context 用量 ✅ fold `assistant/message.usage`（最近 step 的 `inputTokens+cacheReadTokens+cacheWriteTokens` 即上下文占用） | P1 |
| 对话框统一承载（选择器/设置/帮助） | editor-replacement | overlay-only（决策 D19），`BluePanel`+SelectList 工厂 | 无 | P1 |
| 全屏接管（diff 预览/任务输出） | `utils/screen-takeover.ts` | 100% overlay | 无 | P2 |
| fullscreen（alt-screen + ScrollView dock） | env 开关实验特性 | L0 alt-screen 热切换 | 无 | P1 |
| welcome banner | `tui/banner/` | L3 `banner` 插件 | 无 | S8 已落地 |
| 滑动窗口（15 turn + step 折叠） | `utils/transcript-window.ts` | L3 fold/mounter 内部 | 无 | S7 已落地 |

## 4. kimi-code 能力对照：编辑器、快捷键、命令、主题、审批

### 4.1 编辑器能力

| 能力 | Blue 落点 | 来源 |
|---|---|---|
| 多行（Shift-Enter/Ctrl-J）、kill-ring、undo、paste-burst | L0 工厂 pi-tui Editor | pi-tui 自带 |
| 历史浏览（↑/↓，bash 模式过滤、草稿存取） | L2 `editor-plus`（pi-tui Editor 历史钩子） | pi-tui 钩子 + L2 状态 |
| slash 补全菜单（alias、参数补全） | L2 补全 provider，数据 `ctx.commands` ✅ | 现成 |
| `@` 文件补全（fd 优先） | L2 补全 provider | 无上游依赖 |
| 图片/视频粘贴（Ctrl-V，占位符+后台压缩） | L2 剪贴板工具 + L0 `createImage` | ⚠️ `dsh-attachment` 是纯缝：`ctx.attachments: AttachmentStore` 抽象服务（`validateImage`/`saveImage(s)`/`readImage`/`imageLimits`），rc.7 无实现随装；剪贴板解码、mime 声明、压缩 Blue 自管，ref 须先于会话事件落盘。视频属模型能力 🚫（首版不做） |
| shell 模式（`!` 不进 buffer，紫色边框） | L2 `editor-plus` inputMode | ⛔ 无上游执行通道（rc.7 全包零 `child_process`/`spawn` 引用）；Blue 在 `editor-plus` 自建 spawn 前台执行，渲染复用 `TerminalCallView` 语义 |
| 外部编辑器（Ctrl-G） | L2 + L0 渲染器暂停配合（P2） | 无 |
| Kitty CSI-u 可打印键 | L0（Editor 内免费；自研组件用解码工具） | pi-tui |

### 4.2 快捷键

| 键 | 动作 | Blue 机制 | 阶段 |
|---|---|---|---|
| Esc / Ctrl-C | 中断流 `agent.cancel()` / 清输入 / 双击退出 | 编辑器语境动作（keymap matches） | P1 ✅ |
| Esc（overlay 内） | 取消/关闭 | overlay 组件自消费（现状） | 已有 |
| Ctrl-S | steer 草稿注入当前 turn | 编辑器语境动作 → `agent.steer()` ✅ | P1 |
| Ctrl-O | 折叠/展开工具输出 | 全局动作（handler）→ transcript 事件 | P1 |
| Shift-Tab | Plan 模式切换 | 全局动作 | ⛔ S0 已核实上游无 presets（rc.7 仅 `ask`/`never` 二元 approval policy） |
| Ctrl-B | 前台任务转后台 | 全局动作 | ⛔ 上游无 background 概念 |
| Ctrl-T | todo 面板展开/折叠 | 全局动作 → pane-todo | P1 |
| Ctrl-G | 外部编辑器 | 编辑器语境动作 | P2 |
| Ctrl-V / Alt-V | 粘贴媒体 | 编辑器语境动作 | S7 已落地（图片；视频 🚫） |
| 对话框内 1-9 | 数字直选 | overlay 组件内（经 L0 可打印键解码） | P1 |

编辑类键（光标/删除/多行/历史）全部由 pi-tui Editor 基类承担，不进 Blue keymap。

### 4.3 命令（kimi 40 内置 → Blue 取舍）

**P1 做（纯 Blue 或上游已具备）**：

| 命令 | Blue 落点 | 上游 |
|---|---|---|
| `/exit`（已有 `/quit`）、`/resume`（已有） | L2 commands-plugin | ✅ |
| `/new` | L2 命令 → app 层事件（dispose + create，复用启动路径） ✅ S6 已落地（`'blue/request-new'`，无载荷） | ✅ `agents.create` |
| `/fork` | L2 命令 → app 层 ✅ S6 已落地（`'blue/request-fork'`，无载荷；idle 守卫；seed=当前 events 全量 + `meta.{cwd,parentSession,seedLength}`，落地走 `agents.create` 而非 `session.fork`） | ✅ `session.fork` |
| `/sessions`（picker + 分页 + 搜索） | L2 命令 + overlay picker ✅ S6 已落地（`sessionPersistence.list` 降序 picker，当前会话标注且不可选，选中 emit `'blue/request-resume'`；分页/搜索未做） | ✅ `ctx.sessionPersistence.list()`/`listSnapshots()` 返回 `SessionHeader{id,createdAt,cwd,parentSession,...}`；无分页/搜索参数，排序分页客户端自做，内容搜索仅逐会话 `inspect`（贵，首版不做） |
| `/help`（快捷键+命令速查） | L2 overlay，数据来自 keymap/commands 注册表 ✅ S6 已落地（`commands.list` + `keymap.list()` 两节 overlay，Esc/Enter/q 关；keymap 为此增 `list()`） | ✅ |
| `/theme` | L2 命令 → 主题 fiber 换装（§5.2） | 无 |
| `/btw` | L2 命令 + L3 pane ✅ S6 已落地（偏差：命令由 `blue-pane-btw` 插件自注册，非 L2+L3 配对；fork 旁路 agent + followup，面板单槽） | ✅ fork |
| `/export-md` | L2 命令，fold 结果 → markdown 文件 | ✅ |
| `/version` `/status` | L2 命令 | ✅（model/provider 读 `session.requestHeader()?.config` 或 `agent.options`；cwd 读 `session.header.cwd`；turn 数 fold `turn/start`；id/创建时间读 `session.header`） |
| `/usage`（token/上下文用量） | L2 命令 + status 条目 | ✅ fold `assistant/message.usage`（`TokenUsage{inputTokens,outputTokens,cacheReadTokens?,cacheWriteTokens?,reasoningTokens?}`，互斥计数，随 step 落事件）；无聚合 API，transcript 自维护累计器 |

**P2 或待上游**：

| 命令 | 状态 |
|---|---|
| `/model` | ✅ `agentDefaultModel`（`currentSelection()`/`saveSelection()`，写 Settings user 层、只影响未来 Agent）+ 会话内切换经 `installModelSelection` 的可变 ref（写 `selection.current`，下一 step 生效）。⚠️ Blue 侧缺口：resume 路径未在 `setup` 里装 `installModelSelection`（`packages/app/src/index.ts:102`），S2 需补 |
| `/compact` | ⛔ 无可调用入口（机制已在：`SurfaceOp replace` + `compaction/*` 事件词表 + `LlmCallConfig.purpose='compaction'`）；Blue 自编排 driver 或推迟 |
| `/undo` `/title` `/tasks` | ⛔/⛔/✅（undo 唯一原语是 `fork(source, boundary)` 产新会话，非原地撤销；title 无字段、无生成链路，`purpose='session-title'` 仅预留；tasks = fold `todo/write`，rc.7 尚无生产者） |
| `/yolo` `/auto` `/plan` `/permission` | ⛔ S0 已核实 rc.7 无 `permissionPresets`：仅 `approval.setPolicy` 的 `ask`/`never` 二元档；`dsh-plan-mode` 仅 README 引用、未随 rc.7 发布。需上游做缝；Blue 侧至多自建"answerer 自动放行"的 yolo |
| `/editor` `/reload` `/settings` `/experiments` | 🚫 kimi 配置体系特定；Blue 侧以 patch/env 覆盖 |

**不做**（产品差异/非 Blue 职责）：`/login` `/logout` `/provider` `/mcp*` `/plugins` `/web` `/init` `/add-dir` `/goal` `/swarm` `/feedback` `/export-debug-zip`、skill/plugin 动态命令（kimi 产品概念；dsh 侧等价物是 cordis 插件直接注册命令，能力已在）。

### 4.4 审批与提问

| 能力 | Blue 落点 | 备注 |
|---|---|---|
| 四选项面板 + 数字键 + Esc=reject | L2 approval-plugin 重写 ✅ S6 已落地（↑↓+Enter+`1`-`4` 直选；Esc 语义由 `'cancelled'` 变更为 `'rejected'`，abort 仍 `'cancelled'`） | outcome 词汇不变 |
| Approve for this session | L2 队列协调器自动继承 ✅ S6 已落地（answerer 侧模块级 `WeakMap<Agent, Set<string>>`，后续同 agent 同 tool 免弹窗直返 `'allowed-once'`） | 上游无 session 档，Blue 侧实现（kimi 同款） |
| reject with feedback | L2 面板内联输入 ✅ S6 已落地（内联编辑器输理由 → `'rejected'` + `agent.steer(createUserMessage('User rejected …: …'))`） | ⛔ outcome 闭集 `'allowed-once'|'rejected'|'cancelled'|'unavailable'`，无 feedback 字段（`ApprovalRequest.reason` 是发问方→UI 方向）；按 `ApprovalService.setPolicy` 先例由 Blue 自行 `agent.inject(createUserMessage(...))` 把理由注入会话（S6 落地用 `steer`） |
| Ctrl-E diff 全屏预览 | L2 100% overlay + L3 diff intent | P2 |
| 审批/提问弹窗互斥排队 | L2 modal 协调器 ✅ S6 部分落地（审批侧 FIFO 队列一次一个弹窗，空队同步启动保 waterfall 同步可见性；提问侧一次 overlay 承载整批题） | 现状各自独立，需协调器 |
| 多题 tab 问卷 + Other 项 | L2 questions-plugin 重写 ✅ S6 已落地（新 `questionnaire.ts`：tab 行 header ?? Q{i+1}、当前 accent、已答 ✓；Tab/Shift-Tab 切题；单选 ↑↓+Enter、multiSelect Space+Enter；固定 Other 伪项进内联编辑器存 custom；无 options 题直接编辑器；全答完自动 resolve；Esc=ASK_DISMISSED/abort=ASK_ABORTED 不变） | 现状为逐题串行 |

## 5. 主题系统设计（决策 D18 落地）

### 5.1 语义 token 表（L1 定稿，26 个，全量 required）

| 组 | tokens |
|---|---|
| 基础 | `text` `textStrong` `muted` `accent` `border` `borderFocus` |
| 状态 | `success` `warning` `error` |
| 列表 | `selectedBg` |
| 角色 | `roleUser` `shellMode` |
| markdown | `mdHeading` `mdLink` `mdLinkUrl` `mdCode` `mdCodeBlock` `mdCodeBlockBorder` `mdQuote` `mdQuoteBorder` `mdHr` `mdListBullet` |
| diff（P2 启用） | `diffAdded` `diffRemoved` `diffAddedStrong` `diffRemovedStrong` `diffGutter` `diffMeta` |

破坏性扩表在 P1 一次完成；此后 token 只增不改，下游主题插件编译期可发现缺口。

### 5.2 provider 替换机制

- 主题插件族（各自独立 fiber，provide `blueTheme`）：`blue-theme-dark`（plain 基线默认）、`blue-theme-light`、`blue-theme-auto`（读 `blueTerminalInfo.background` 选 palette，监听 `'blue/terminal-theme-changed'` 时**dispose 自身 provider 子 fiber 并以新 palette 重新 plugin**，依赖方随之 reload；连续换装经 promise 链序列化）、`blue-theme-custom`（JSON 文件，非法 hex 丢弃回退 base——kimi `custom-theme-loader` 同款）。**S4 落地校验库为 @deepseek-ai/schemastery（harness 依赖惯例），非 zod。**
- `/theme` 命令（L2）：known-themes 表静态 import 各主题入口；切换 = dispose 当前主题 fiber + `ctx.plugin(目标)`。**S4 落地为模块级当前模块引用 + `ctx.registry.delete(...)`（registry 按插件回调身份键入，loader 加载的 patch 行与静态 import 共享模块实例，一次删除即 dispose 其全部 fiber）+ 等待 disposal + `await ctx.plugin(目标)`，挂载失败回退 dark——无需持有 fiber 句柄。**
- **重挂载代价与补偿**：transcript reload = 走 D16 快照重放，行为正确；编辑器草稿经模块级 stash 跨 reload 保留。
- 渲染纪律：组件**禁止缓存样式函数**（kimi 的 CI guard 经验），render 路径从当前 provider 取色。Blue 因采用 reload 而非原地换 palette，此纪律为防御性要求而非硬性依赖。

## 6. 下游插件缝能力清单

### 6.1 Blue 自有缝

| 缝 | ctx 键 / 机制 | 归属 | 形态 | plain 默认 | 下游能做什么 | 阶段 |
|---|---|---|---|---|---|---|
| 组件挂载/overlay/焦点 | `ctx.blueScreen` | core | 服务 | —（核心能力） | 挂组件、弹 overlay、管焦点 | 已有 |
| 键位注册 | `ctx.blueKeymap` | core | 注册表 + disposer | — | 注册语境/全局快捷键，冲突启动期暴露 | 已有；handler 增量 P1 |
| 组件工厂 | `ctx.blueComponents` | core | 能力缝 | — | 造 editor/markdown/select/image 组件而不碰 pi-tui | P1 |
| 终端事实 | `ctx.blueTerminalInfo` | core | 只读服务 | — | 读终端背景/协议能力做适配 | P1 |
| 主题 | `blueTheme` provider 替换 | core 契约 / 主题插件实现 | provider 换装 | `blue-theme-dark` | 提供整套新主题；运行时 `/theme` 切换 | P1 |
| 状态栏条目 | `ctx.blueStatus` | transcript | 注册表 + disposer | `blue-status-basic`（model·status） | 注册自定义条目；footer 壳无独立插件，随 `blue-transcript` 整体替换 | P1 |
| render intent | `ctx.blueIntents` | transcript | 注册表 + disposer | generic 呈现器 | 为新工具类型提供定制呈现 | S7 已落地 |
| 会话事实 | `ctx.blueSession` + `'blue/session-changed'` + `'blue/request-resume'` | app | 服务 + 事件 | — | 读当前 Agent、跟踪/发起会话切换 | 已有 |
| 组合 | `cordis.patch.yml` 行 | bundle | 组合层 | 基线 7 行 | 零代码启停/重排任何 Blue 插件 | 已有 |

### 6.2 继承自 harness 的缝（下游直接用，Blue 不包装）

| 缝 | 用途 | 状态 |
|---|---|---|
| `ctx.commands.register` | 注册 slash 命令，自动进入 Blue 的补全菜单 | ✅ |
| `ctx.userQuestions.registerProvider` | 接管提问交互（Blue 是默认 provider，可被替换） | ✅ |
| `'approval/request'` waterfall | 接管/包裹审批应答 | ✅ |
| `ctx.permissionPresets` | 注册权限模式，Blue 模式 UI 自动列出 | ✅ rc.7+ 已落地（`/permission` 命令 + `permissions` 投影随 base；自定义注册 API 无）。2026-08-21 注：运行时状态以 [blue-seams.md](../blue-seams.md) §3 为准（选择器面板 S24，D33） |
| `ctx.sessionProjections` | 提供 todos 等投影，pane-todo 自动呈现 | ✅ rc.7+ 已落地（`register/onChanged/checkpoint/restore`）；pane-todo 维持 `todo/write` 事件折叠，改挂为可选。2026-08-21 注：以 [blue-seams.md](../blue-seams.md) §3 为准 |
| `ctx.tools.register` / `tools/*` | 定制 agent-loop 工具，经 render intent 自动呈现 | ✅（`dsh-tools`：registry + `ctx.tools.execute`/`guard` + `tools/pre-execute` 瀑布） |
| `ctx.agents` / `ctx.sessions` | 会话与 agent 全量操作 | ✅ |

### 6.3 缝的设计纪律（P1 起生效）

1. 每条缝：契约归宿主包、注册返回 disposer、plain 默认是第一个注册者、未知输入回退 plain。
2. 新缝只在首个真实消费者出现时开（现为 Blue 自家增强插件），P3 冻结签名。
3. 下游插件只允许依赖文档化缝与契约包，不得 import Blue 包内部模块。

## 7. Plain 基线与实施顺序

**Plain 基线 patch**（8 行，S6 起分两段排布，S8 基线段扩入 banner）：基线段 `blue-core`、`blue-theme-dark`、`blue-banner`、`blue-transcript`、`blue-status-basic`（5 行；banner 先于 transcript——滚动区次序 = addChild 挂载次序，二者同 blueComponents 轮按行序激活，`/theme` 换装 reload 时 transcript 快照重放重挂历史，banner 行序在前保首子位）+ 装配段 `blue-interaction`、`blue-startup`、`blue-app`（3 行）；增强段（`blue-editor-plus`、`blue-status-git`、`blue-status-context`、`blue-pane-activity`、`blue-pane-queue`、`blue-pane-todo`、`blue-pane-btw`，7 行）夹在两段之间、可整段拔除。拔掉一切增强后：主屏 + dark + generic 工具呈现 + 基线 footer 条目（model · status，两行壳）+ 工厂编辑器 + `/quit` `/resume` + 审批/提问 overlay。机制修正（S6）：Loader 同组行并发挂载，**行序≠挂载序**；dock 钉序实际靠 inject 解析序——`blue-pane-activity`/`blue-pane-queue` 行级加 `inject: [blueComponents]` 与 transcript 同轮激活，保证 footer→panes→editor 的 bottom 序；行级 inject 不能指 `blueStatus`（`/theme` 换装会连带 dispose 触发命令自己 handler 所在的 fiber）。

| 步 | 内容 | 验收 |
|---|---|---|
| S0 | 验证：pi-tui input listener 语义；`ctx.plugin` 运行时换装 reload 行为；`sessionProjections`/`permissionPresets`/inbox/compaction/usage 上游可用性 | ✅ 已完成（2026-08-18，本文档全部 🔍/📖 项已回写结论；要点：input listener 先于焦点路由且可 consume/改写、`ctx.plugin` 换装自动 reload 注入方、`agent.inbox` 可直接支撑 queue pane；`sessionProjections`/`permissionPresets`/compaction 入口/审批 feedback/undo/title 确认为上游缺口） |
| S1 | L0/L1：blueComponents 工厂、OSC 11、blueTerminalInfo、token 全量化、blueTheme 迁出 | ✅ 已完成（2026-08-18，要点：`ctx.blueComponents` 工厂（createEditor/createMarkdown/createSelectList/createSettingsList + visibleWidth/wrapText/truncateToWidth，内部映射 blueTheme 到 pi-tui theme）与只读 `ctx.blueTerminalInfo`（OSC 11 自发探测背景 + kittyKeyboard）落地；新事件 `'blue/terminal-theme-changed'` 由 DEC 主题上报驱动；`BlueSemanticColors` 全量化为 26 token 全 required（新增 textStrong/borderFocus/roleUser/shellMode + diff 组 6 个）；blueTheme 实现迁出为 core 子路径插件 `./theme-dark`（`blue-theme-dark`，plain 基线段）；transcript 退役 `markdown.ts`/`width.ts`，Markdown 与宽度改经 blueComponents，ellipsize 收进 `fold.ts` 并仍从包根再导出，inject 扩为 `['blueScreen','blueTheme','blueComponents']`；bundle patch 新增 blue-theme-dark 行） |
| S2 | L2 编辑器换装 + 补全 + shell 模式（执行通道 Blue 自建 spawn）；补 resume 路径的 `installModelSelection` | ✅ 已完成（2026-08-18，要点：interaction 主编辑器换装 pi-tui Editor（经 `ctx.blueComponents.createEditor`，多行/历史/kill-ring/undo/粘贴标记内置），`BlueInput`（`src/editor.ts`）与 `text.ts` 退役，hint 行拆为独立 HintLine 组件，宽度函数全走 blueComponents；单选（approval、questions 单选）走 `createSelectList`，`BlueSelect` 收窄为包内多选专用（pi-tui 无多选组件），包导出仅剩 BluePanel；keys.ts 删 cursor-left/right/delete-backward 三 action；新增子路径增强插件 `./editor-plus`（blue-editor-plus）：'!' bash 模式（'!' 不进 buffer、边框切 `colors.shellMode`、提交后自动退回 prompt）+ 自建 child_process 执行（输出 200 行 + 64KB cap）+ ShellEchoComponent 回显进 scroll 区（不进 session transcript）+ 分发式 provider 合并 slash 补全（`ctx.commands.list` 前缀匹配）与 '@' 文件补全（fd 优先、fs 回退、上限 200）；core 的 BlueEditor 契约增 `setAutocompleteProvider(BlueAutocompleteProvider)` 与 `getExpandedText()`，新增 BlueAutocompleteItem/Suggestions/Provider 类型；app 的 create/startup-resume/request-resume 三处统一挂 `modelSelectionSetup`（`installModelSelection`），resume 会话支持运行期模型切换。偏差记录：shell 模式只切边框色（pi-tui Editor 无 prompt 符号载体）；prompt/bash 历史不按模式过滤（pi-tui 内部化）；`onSubmit(text)` 回调参数即粘贴展开后的文本，提交路径无需再调 `getExpandedText()`） |
| S3 | 全局键分发器 + Ctrl-O/Ctrl-S/Esc 语义链 | ✅ 已完成（2026-08-18，要点：`BlueKeyAction` 增可选 `handler`（带 handler = 焦点无关全局动作），`blueKeymap` 增 `dispatch(data): boolean`（带 handler 动作按注册序触发并回报是否消费）；core apply 内挂全局键分发器（pi-tui `addInputListener`，焦点路由前消费 handler 动作）；transcript inject 加 `blueKeymap` 并注册全局动作 `blue.transcript.toggle-collapse`（ctrl+o）折叠/展开全部工具输出（fold 保留未摘要原文 `fullText`，`ToolCallComponent` 增 `setExpanded`，会话切换重置折叠态）；interaction keys 批次增语境动作 `blue.interaction.interrupt`（ctrl+c）/`blue.interaction.steer`（ctrl+s）；主编辑器语义链：Esc=补全弹层放行→清文本→中断运行中 agent，Ctrl-C=清文本→中断→1s 内双击经 `appExit(0)` 退出（单击 hint 提示），Ctrl-S=非空草稿 steer 注入当前 turn 并清空。决策/偏离记录：编辑器语境键走 `BlueEditor.onKey` 前置钩子（另增 `isShowingAutocomplete()`）而非 §2.3"组件内经 matches 解析"的字面表述——pi-tui Editor 吞掉 Ctrl-C 且自身无兜底出口，onKey 在 Editor 处理前拦截；keymap 服务在 core apply 内直接 `new BlueKeymapService(ctx)` 而非 `ctx.plugin`（Cordis Context 代理对未 inject 服务抛错，自供服务无法 inject 自身）。冲突注入测试落在 keymap.spec（handler 动作抢键抛 `BlueKeymapError` 零提交）与 plugin.spec（分发器接线/卸载）） |
| S4 | 主题插件族 + `/theme` | ✅ 已完成（2026-08-18，要点：core 新增内部共享模块 `src/theme-palette.ts`（hex→ANSI truecolor 包装、`colorsFromForegrounds` 冻结 26 token 色表、`defineThemeService` Service 子类工厂），theme-dark 改经其构建并导出 `DARK_COLORS`；新增三个子路径主题插件——`./theme-light`（GitHub light 风格 26 token，导出 `LIGHT_COLORS`）、`./theme-auto`（inject `blueTerminalInfo`，按探测背景选 palette，监听 `'blue/terminal-theme-changed'` 并经 promise 链序列化 dispose+重挂 provider 子 fiber）、`./theme-custom`（schemastery 校验 Config `{path, base}`，JSON 文件 token→`#rrggbb`，未知 token/非法 hex 警告后回退 base 条目，文件不可读整体回退 base）；interaction 基线命令插件新增 `/theme`——无参列出已知主题并标出当前、`dark|light|auto` 热切换、`custom <path> [dark|light]` 带配置挂载，切换经 `ctx.registry.delete(当前模块)` + 等待 fiber disposal + `await ctx.plugin(目标)`，挂载失败回退 dark；编辑器草稿经模块级 stash（`src/draft-stash.ts`，onChange 镜像、submit/steer 清空、apply 时 `setText` 恢复）跨 reload 保留；bundle e2e 新增三用例——/theme 换装后色表身份 DARK→LIGHT 且输出含 light ANSI、草稿跨 swap 保留、转录经 D16 快照重折叠以新 palette 重渲染。偏差记录：§5.2 的 zod 校验落地为 schemastery（harness 依赖惯例）；"当前 fiber 句柄模块级持有"落地为模块级当前模块引用 + `ctx.registry.delete`，无需 fiber 句柄） |
| S5 | blueStatus + footer 壳 + git/context/basic 条目插件 | ✅ 已完成（2026-08-18，要点：transcript 新增 `blueStatus` 服务（`src/status.ts`，`BlueStatusService extends Service` 于 apply 内直接实例化；`register` 查重——重复 id 抛 `BlueStatusError`(DUPLICATE_ENTRY)，返回幂等 disposer；条目按 priority 升序、注册序稳定 tiebreak）与常驻 footer 壳 `FooterShellComponent`（apply 内经 `blueScreen.addBottomChild` 一次性钉底于输入编辑器上方——patch 行序 transcript 先于 interaction 使钉底挂载落在编辑器之上；两行 first-fit、muted ` · ` 连接、两行皆放不下按最低优先级丢弃、空注册表零行；注册/注销 nudge 重渲染）；MVP 的 `StatusBarComponent` 消灭；三条目以子路径插件发布——`./status-basic`（`blue-status-basic`，基线行，优先级 0，muted `{model} · {status}`，model 取 `session.requestHeader()?.config.model ?? agent.options.model ?? agent.options.provider ?? 'no model'`，状态经真实 `'agent/status'` 订阅驱动，`blueSession` 走 `ctx.get` + `'blue/session-changed'` 不 inject）、`./status-git`（`blue-status-git`，增强行，优先级 10，`spawnSync('git', ['branch', '--show-current'], {timeout: 1000})`，cwd 取 session header ?? process.cwd()，模块级 `setGitBranchRunner` 测试注入，非仓库渲染 ''）、`./status-context`（`blue-status-context`，增强行，优先级 20，占用 = 最新 `assistant/message` usage 的 `inputTokens + cacheReadTokens + cacheWriteTokens`，先自扫 `agent.session.events` 快照再订阅 `'session/event'` 增量，格式 `ctx N` / `ctx N.Nk`，无用量渲染 ''）；bundle patch 基线段 7 行（blue-status-basic 随 blue-transcript 之后）、增强段 3 行（blue-status-git/blue-status-context 随 blue-editor-plus 之后），共 10 行；bundle e2e 新增 5 用例——基线 footer 渲染、运行态翻转、下游测试插件注册条目被接受并可见、context 用量（脚本化 usage 流）、git（fake runner），e2e 计 21。偏差记录：① footer 壳经 `addBottomChild` 常驻钉底（原 `StatusBarComponent` 是 `addChild` 滚动区首位）；② context 用量由 status-context 自扫 `session.events` + 订阅增量，未进 `TranscriptFolder`（设计稿 §4 的 "fold assistant/message.usage" 字面表述）） |
| S6 | pane 插件群 + `/sessions` `/fork` `/new` `/help` `/btw`；审批四选项；提问 tab 化 | ✅ 已完成（2026-08-19，要点：core 的 `BlueKeymap` 契约与 `BlueKeymapService` 增 `list(): readonly BlueKeyAction[]`（注册序快照，条目为拷贝），供 `/help` 枚举；app 新增无载荷事件 `'blue/request-new'`（建新会话切换）与 `'blue/request-fork'`（idle 守卫——无 live session 或非 idle 写 stderr 拒绝；`agents.create` seed=当前 events 全量 + `meta.{cwd,parentSession,seedLength}`），二者与 request-resume 同走 enqueue 串行 + commit-point（dispose 旧 → `current` 赋值 → 广播 `'blue/session-changed'`），失败保留旧会话写 stderr；create 参数抽成模块级 helper `createOptions`，startup/request-new/request-fork 三处共用；transcript 新增三个 pane 子路径插件（四件套齐：src + exports/files + tsdown entry + patch 行）——`./pane-activity`（`blue-pane-activity`，inject blueScreen/blueTheme：spinner 行订 `'agent/status'`，running 显示（100ms 帧推进，模块级 `setActivityTimers` 可注入），idle 零行）、`./pane-todo`（`blue-pane-todo`，+blueKeymap/blueComponents：fold `'todo/write'` 整表 last-write-wins；折叠行 `todos N/M`、展开逐条 ☑/◐/☐；默认规则含 in_progress 展开否则折叠；全局动作 `blue.todo.toggle`（ctrl+t））、`./pane-btw`（`blue-pane-btw`，+commands/agents：自注册 `/btw <question>`——fork 旁路 agent（seed + parentSession/seedLength + agentOptions 继承父 provider/model）+ followup 提问；面板显示 `› question` + 回复（封顶 20 行）；单槽，二次 /btw 替换，无参 /btw = dismiss + dispose）；interaction 新增 `./pane-queue` 子路径插件（`blue-pane-queue`：渲染 agent.inbox 排队消息（nextTurn/nextStep，订 `agent/inbox/*` 事件）；注册无键语境动作 `blue.queue.recall`，input-plugin 的 onKey 链在编辑器为空 + 该动作已注册时拦截 ↑ 召回最近一条（nextStep 末尾优先）进编辑器）与基线命令 `/new`、`/fork`（非 idle 报错）、`/sessions`（`sessionPersistence.list` 降序 picker overlay，当前会话标注且不可选，选中 emit `'blue/request-resume'`；经新增 `SharedEditor.notice` 缝闪提示）、`/help`（`commands.list` + `keymap.list()` 两节 overlay，Esc/Enter/q 关）；审批重写（`approval-plugin.ts`）为四选项面板（1 Allow once / 2 Allow {tool} for this session / 3 Reject / 4 Reject with feedback，↑↓+Enter+数字直选，Esc=`'rejected'`、abort 仍 `'cancelled'`；选项 2 记模块级 `WeakMap<Agent, Set<string>>`，后续同 agent 同 tool 免弹窗直返 `'allowed-once'`；选项 4 内联编辑器输理由 → `'rejected'` + `agent.steer(createUserMessage('User rejected …: …'))`；FIFO 队列一次一个弹窗——显式数组 + active 标志，空队同步启动保 waterfall 同步可见性）；提问重写（`questions-plugin.ts` + 新 `questionnaire.ts`）为一次 showOverlay（80%/60%）承载整批题：tab 行（header ?? Q{i+1}，当前 accent，已答 ✓），Tab/Shift-Tab 切题，单选 ↑↓+Enter、multiSelect Space+Enter，固定 Other 伪项进内联编辑器存 custom，无 options 题直接编辑器，全答完自动 resolve，Esc=ASK_DISMISSED/abort=ASK_ABORTED 不变，intent plan-review 仍不消费；commands-plugin 保持 inject `['commands']` 不加 blueTheme（`/theme` 换装会 dispose 自己 handler 所在 fiber 的雷，蓝服务一律 handler 内 `ctx.get` 惰性解析）；bundle patch 重排三段共 14 行——基线段 4 行（core/theme-dark/transcript/status-basic）→ 增强段 7 行（editor-plus/status-git/status-context/pane-activity/pane-queue/pane-todo/pane-btw）→ 装配段 3 行（interaction/startup/app）；e2e 21→29 例（四个 pane 各一、/help、/sessions+/new+/fork、/btw、审批四选项、提问单 overlay）。偏差记录：① approve-for-session 由 Blue answerer 侧 WeakMap 实现（上游 outcome 无 session 档，§4.4 已预告）；② pane-queue 归 interaction 而非 §2.4 的 L3——召回需编辑器 onKey 缝；③ `/btw` 由 pane-btw 自注册（非 §2.4 的 L2 命令 + L3 pane 配对）；④ patch 三段重排 + 机制修正"行序≠挂载序，dock 钉序靠 inject 解析序"（教训"行级 inject 不能指 blueStatus——/theme 换装连带 dispose"已写进 patch 注释）；⑤ 审批 Esc 语义由 `'cancelled'` 变更为 `'rejected'`；⑥ 召回落地为无键语境动作 + onKey 判存在——up 直注册会撞 `blue.interaction.move-up` 的 KEY_CONFLICT） |
| S7 | intent 注册表 + diff/terminal；滑动窗口；图片粘贴 | ✅ 已完成（2026-08-19，要点：transcript 新增 `blueIntents` 服务（`src/intents.ts`，`register({intent, create})` 幂等 disposer、重复 intent 抛 `BlueIntentsError('DUPLICATE_INTENT')`、`resolve` = exact → 'generic' → 首个注册者、空注册表才 NO_INTENTS；内置 generic 呈现器在 apply 中第一个注册，成为 plain 基线），挂载器经它解析 tool 条目组件，Ctrl-O 折叠泛化为任何带 `setExpanded` 的 intent 组件，挂载簿记由 disposers 数组升级为 item→component 条目表（折叠/逐出精确退役被替换组件）；transcript inject 宿主 `'tools'` 服务，fold 条目携带 `parsedArguments`/`rawResult`（重建 ToolResult）与 `view`（call 时 ToolCallView，`presentResult` 返回则替换为 ToolResultView），经包内纯解析器（`src/present.ts`）解析——未知工具/缺 presenter/抛错的 presenter 一律回退 generic；长会话窗口（`src/window.ts`，DEFAULT_WINDOW_TURNS=15 最新已完成 turn 保持挂载，模块级 setter 供测试）在每次折叠事件后静默逐出更旧 turn 的条目+组件（快照重放与增量流同构）；turn 内 step 折叠：下一个 `step/start` 到达时把上一 step 的工具条目折叠为单个 `step-summary` 条目（`… step N · Tool ×M` 行），turn 的最后一个 step 保持展开，模块级 `setStepFoldingEnabled` 可关；用户消息图片块保留为条目上的 `ImageAttachmentRef[]`（文本占位保留），`UserMessageComponent` 经可选 `attachments` 服务（`ctx.get`，非 inject）惰性加载字节，渲染真实图片（≤12 行）或保持 `[image]` 占位；两个 intent 子路径插件——`./intent-diff`（`blue-intent-diff`，inject blueIntents/blueTheme/blueComponents；DiffCardComponent 经纯 LCS 行 diff（`src/line-diff.ts`）渲染 FileDiff 对，theme diff token 着色，折叠 12 行/文件、展开 200）与 `./intent-terminal`（`blue-intent-terminal`；TerminalCardComponent：description/cwd/`$` command 头、输出 10/120 行、exit 徽章走 error/warning 色）；core 增 `createImage`（pi-tui Image 包装 + 无图像协议终端的样式化文本回退）、纯 `imageDimensions`（PNG/JPEG/GIF/WebP 探针）与 `BlueEditor.insertText`（光标处原子插入，供剪贴板图片标记用）；interaction 新增共享编辑器提交变换器缝（`src/editor-instance.ts`，`registerSubmitTransformer(fn)` 返回 disposer、`applySubmitTransformers` 按注册序拼接、空结果保持单 text block；followup 与 steer 都经它构建 content）与两个子路径插件——`./attachments`（`blue-attachments`，inject `[blueComponents]`：提供 harness `attachments` `AttachmentStore`，FilesystemAttachmentStore 魔数嗅探（共享 sniffer 导出）+ 媒体类型白名单 + 上限（10MB/图、8 图/消息、30MB/消息、16M 像素），文件落 `DSH_BLUE_ATTACHMENT_DIR ?? $DSH_HOME/attachments ?? ~/.dsh/attachments` 下 `<uuid>.<ext>`，`AttachmentError` code 对齐 dsh-attachment 词表）与 `./paste-image`（`blue-paste-image`，inject `[attachments, blueKeymap]`：语境 ctrl+v 动作 `blue.image.paste` 经共享编辑器 onKey 链上的 wrapper 解析，剪贴板经可注入 reader（默认 wl-paste → xclip 探测，3s 超时），经 `ctx.attachments` 落盘并插入 `[image #N]` 标记（模块级 map，跨主题换装 reload 存活），提交变换器把标记拆成 ImageBlock；失败闪 notice，卸载后晚到的完成 no-op）；包依赖：transcript 与 interaction 增 peer+dev `@deepseek-ai/dsh-attachment`（transcript 另加 `dsh-tools`，rc.7）；bundle patch 增强段 +4 行（blue-attachments/blue-paste-image 随 blue-editor-plus 后——输入侧，激活序由 paste-image 行 inject attachments 钉住；blue-intent-diff/blue-intent-terminal 随 blue-status-context 后，inject blueIntents）共 18 行，e2e 增 5 用例（diff 卡、terminal 卡+exit 徽章、图片粘贴 → ImageBlock 传递、step-summary 渲染）计 36；性能：`tests/perf.spec.ts` 折叠+挂载合成 200-turn 流——window=15 保持约 90 个挂载组件（无窗口 1200），两者均在数十 ms 量级，仅记录不设时延断言。门禁：558 tests / 49 files、typecheck/lint 全绿、逐文件 100% 覆盖保持。偏差记录：① 无图片压缩（未引入图像库，原始字节原样持久化）；② Ctrl-E 审批 diff 全屏预览仍 P2（按计划不属 S7 范围）；③ intent 注册不追溯已挂载条目（组件挂载时解析，新注册的 intent 只作用于后续条目）；④ step 折叠发生在当前 turn 内的"上一 step"（kimi-parity：每 turn 可见尾部保留工具卡）） |
| S8 | welcome banner | ✅ 已完成（2026-08-19，要点：transcript 新增 `./banner` 子路径插件（`blue-banner`，inject `blueScreen/blueTheme/blueComponents/agentDefaultModel`）——左栏像素城堡 + 'Welcome back!' + `model · provider`（apply 时 `agentDefaultModel.currentSelection()` 快照，不耦合 blueSession）+ `~` 缩写 cwd（本地 `shortenHome`），右栏 Tips/What's new 占位；纯模块拆分 `src/banner-art.ts`（20×20 网格离线生成 16 行位图 + 半块打包纯函数 `packHalfBlockArt`，黄金 spec 钉住）与 `src/banner-content.ts`（`BLUE_VERSION` 常量 + Tips/What's new 占位内容，spec 读 package.json 守卫版本漂移）；自适应宽度 `bannerLayout`（<40 零行、40–99 仅左栏、≥100 右栏固定 52 列、封顶 120；model/cwd/右栏长文本一律 truncate 不折行）；着色仅现有 token（框/城堡 `border`、标题/cwd/右栏正文 `muted`、Welcome `textStrong`、模型行 `accent`、右栏标题 `text`），不扩 26 token 契约；包依赖：transcript 增 peer+dev `dsh-agent-default-model`（rc.7）；bundle patch 基线段 +1 行（blue-banner 位于 blue-transcript 前）共 19 行；e2e 增 3 用例（80 列紧凑启动、resize 120 双栏、/theme 换装后 banner 仍居转录之上）计 39，另四处既有 dock 序断言的编辑器边框 indexOf 改为从 footer/pane 锚点后搜（banner 框同用 border 色）。门禁：593 tests / 51 files、typecheck/lint 全绿、逐文件 100% 覆盖保持。偏差记录：① banner 入基线段而非增强段——激活序要求（滚动区次序 = 挂载次序；`/theme` 换装 reload 时 transcript 经 D16 快照重放抢先重挂历史，行序在前才能保 banner 首子位），banner 视作 plain 基线产品面（Claude Code 同款定位），行本身仍可单独拔除；② 版本走 `banner-content.ts` 常量 + spec 守卫，拒 package.json import（rootDir/emit 布局、无 resolveJsonModule）与 createRequire（bundler 对 import.meta.url 的处理）；③ 右栏内容为占位，真实 tips/release notes 后续只改 `banner-content.ts` 不动布局） |
| S9 | dock 沉底（短内容时底钉块贴视口末行） | ✅ 已完成（2026-08-19，banner 落地后暴露：pi-tui 根 children 自顶向下堆叠，内容不足一屏时 footer/editor 悬在内容正下方。要点：`startBlueTerminal` 内包一层渲染器实例的 `render`——总行数 < 终端行数时重测底钉块行数（footer/editor/hint/panes 共几行，二次渲染仅限廉价 dock 组件），在滚动内容与底钉块之间插入空行补足整屏，dock 恒居末行；整屏内容、空树、无底钉树原样返回（启动空白帧不灌空行）。机制决策 D23：不在组件层加 Spacer（render 无高度语义）、不逐帧双渲染全树（只重测 dock）。core 四用例（沉底/满屏不动/空树不灌/无 dock 不补）+ e2e 一例（无会话启动 24 行帧、footer 落末 8 行内）计 40。门禁：598 tests / 51 files、typecheck/lint 全绿、逐文件 100% 覆盖保持。偏差记录：无——`BlueScreen.addBottomChild` 契约文档原即宣称"pinned to the bottom"，本步使其成真） |

每步门禁：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；README 双语同步；MVP 期 README 中将被废止的 Known Limitations 条目（自研编辑器、无主题切换等）随实现清除。
