# Blue P2 视觉设计：kimi-code 观感对齐、主题契约 v2 与分期实施

> 姊妹文档：[blue-p1-design.md](./blue-p1-design.md)（功能层对照，S0-S9 已完成）、[blue-roadmap.md](./blue-roadmap.md)（阶段路线图）、[blue-decisions.md](./blue-decisions.md)（ADR，本文决策见 D24-D29）。
> 本文档回答三个问题：**kimi-code 的"精致感"由哪些具体元素构成**（§2-§3）、**主题与 chrome 基建怎么改**（§4-§6）、**按视觉影响排序的分期怎么走**（§7）。
> 参照系：kimi-code 本地克隆（`kimi-code/`，MoonshotAI）。与 P1 相同：以源码调研为准，**逐项复刻交互结构，不整体照抄色值**。

## 1. 目标与范围

**目标**：消除 Blue 与 kimi-code 之间的视觉/UX 层差距——消息流（transcript 会话流，§2.6）、编辑框、面板、对话框、补全下拉、footer 的呈现质量，以及无处不在的操作提示。P1 对照表（p1-design §3-§4）覆盖的是功能有无，本文档覆盖的是**呈现质量**；两者维度不同，本文档不是 p1-design 的修订。

**范围**：视觉与交互引导层。**不含**：alt-screen 全屏模式（L0 路线图项）、model selector / permission preset 面板（p1-design P2 清单）、Ctrl-E diff 全屏预览（P2）、Ctrl-G 外部编辑器（P2）——这些是功能项，继续留在原路线图。

**核心事实（本文档全部设计的前提）**：kimi-code 的 TUI 框架就是 pi-tui（vendored 为 `@moonshot-ai/pi-tui`），与 Blue 的 `@earendil-works/pi-tui@0.84.2` 同源。kimi 的全部"精致感"元素——圆角编辑框、边框内标题、面板拼接、内联补全下拉——都是**应用层**对基础组件 render 输出的字符串级后处理（`CustomEditor extends Editor`），不依赖 Blue 缺失的框架能力。因此每一项都可移植，且 Blue 已有对应的插入点（§5）。

### 1.1 标记约定（沿用 p1-design）

- ✅ 已在本仓库依赖闭包内核实（pi-tui 0.84.2 dist 或 blue 源码）
- 🔍 实施前需验证的点
- ⛔ 上游缺口
- 🚫 不做（§8 清单）

## 2. kimi-code 设计 token 参考

调研提取的完整 token 表。实施时按需查阅；**取值仅作层级参照，Blue 侧取值见 §4**。

### 2.1 色板层级（dark；kimi `apps/kimi-code/src/tui/theme/colors.ts`）

| token | kimi dark | 语义（kimi 用法） |
|---|---|---|
| `primary` | `#4FA8FF` | 交互主色：选中行、聚焦边框、链接、内联代码、spinner、`●` 运行点 |
| `accent` | `#5BC0BE` | 次强调：`▶` 指针、BTW/queue 面板 |
| `text` | `#E0E0E0` | 正文 |
| `textStrong` | `#F5F5F5` | 标题/加粗 |
| `textDim` | `#888888` | 次级正文（引用块、thinking、暗提示） |
| `textMuted` | `#6B6B6B` | 最暗层：计数器、滚动指示、对话框按键行、链接 URL、代码围栏 |
| `border` | `#5A5A5A` | chrome 边框（中性暗灰） |
| `borderFocus` | `#E8A838` | 焦点琥珀（与 warning 同值）：审批面板 |
| `success` / `warning` / `error` | `#4EC87E` / `#E8A838` / `#E85454` | 状态 |
| `roleUser` | `#FFCB6B` | 用户消息琥珀 |
| `shellMode` | `#BD93F9` | `!` 模式紫（提示符 + 边框 + `$` 命令行） |

light 版全部按 WCAG AA 重调（文本 ≥4.5:1，chrome ≥3:1）。**双层灰阶（textDim/textMuted）与"chrome 退后、交互色唯一"是 kimi 层级感的两个根**。

### 2.2 符号与边框字符（kimi `constant/symbols.ts`、`constant/rendering.ts`）

| 用途 | 字符 |
|---|---|
| 状态/工具圆点 | `● `（运行）、`✗ `（失败）、`✓ `（成功） |
| 用户消息 | `✨ ` |
| 选择指针 | SelectList `→ `、审批 `▶`、queue `❯` |
| 当前行标注 | `← current` |
| 编辑框 | 圆角 `╭─╮` / `│` / `╰─╯`；拼接时顶角 `├ ┤` |
| 面板边框 | 圆角 + **边框内标题**（如 `╭ BTW ─ Esc close · ↑↓ scroll ─────╮`） |
| 对话框 | 上下全宽 `─` 横线 + 左上标题（无竖线） |
| spinner | braille `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` @80ms（kimi 另有月亮 `🌑🌒…` @120ms） |
| 编辑器滚动 | 边框内嵌 `─── ↑ N more ` / `↓` |
| todo | `●`（进行，primary 粗体）/ `✓`（完成，success + 删除线）/ `○`（待办，textDim） |
| 列表溢出 | `… +N more (X done · Y pending) · ctrl+t to expand` |

### 2.3 布局尺寸与时间参数

| 项 | kimi 值 |
|---|---|
| 编辑框 | `paddingX: 4`（0 边框、1 空隙、2 提示符 `>`/`!`、3 空隙）；高度上限 `max(5, floor(rows × 0.3))` |
| 补全下拉 | 编辑框下边框下内联；5 项可见；宽 >40 双列（主列 12-32，间距 2）；滚动行 `(n/m)`；描述可换行 2 行 |
| btw 面板 | 高度 `max(3, floor(rows/3))`；与编辑框间隔 1 行；markdown 渲染回复 |
| footer | 两行：L1 徽章 + 模型 + cwd（`…/末3段`）+ git + 右侧轮换 tips（10s）；L2 左瞬态警告 + 右 `context: N% (K/M)` |
| 瞬态提示 | 退出二次确认窗口 1.5s |
| chrome 内收 | 全部 chrome 左右各缩进 1 列（`GutterContainer(1)`），与编辑框内列对齐；编辑框本身贴 0 列（"边框是视觉锚"） |

### 2.4 操作提示体系（kimi "用户知道按什么"的三层）

1. **对话框底部按键行**（textMuted，` · ` 连接）：`↑/↓ select · 1/2/3 choose · ↵ confirm · ctrl+e preview`、`tab next · ↑/↓ · space toggle`、`↑↓ navigate · Enter select · Esc exit` —— 每个交互面板都有。
2. **footer 轮换 tips**：10s 轮换的快捷键/命令教学（`shift+enter: newline`、`ctrl+c: cancel`、`/help: show commands` 等 20+ 条）。
3. **就地状态提示**：todo 溢出行带 `ctrl+t to expand`、队列消息带 `↑ to edit · ctrl-s to steer`、工具输出带 `ctrl+o to expand`。

### 2.5 kimi 侧关键文件索引

| 元素 | 路径（`kimi-code/apps/kimi-code/src/tui/` 下） |
|---|---|
| 编辑框侧边框/提示符/幽灵提示 | `components/editor/custom-editor.ts`（`wrapWithSideBorders`/`injectPromptSymbol`/`injectArgumentHint`） |
| 模式边框色切换 | `kimi-tui.ts`（`updateEditorBorderHighlight`） |
| btw 面板 | `components/panes/btw-panel.ts` + `controllers/btw-panel.ts` |
| 审批面板 | `components/dialogs/approval-panel.ts` |
| 帮助面板 | `components/dialogs/help-panel.ts` |
| footer | `components/chrome/footer.ts`；tips 文案 `constant/tips.ts` |
| 欢迎框 | `components/chrome/welcome.ts` |
| 色板 | `theme/colors.ts`；符号 `constant/symbols.ts`；布局常量 `constant/rendering.ts` |
| 补全 provider | `components/editor/file-mention-provider.ts`、`wrapping-select-list.ts` |
| 框架侧（vendored pi-tui） | `kimi-code/packages/pi-tui/src/components/{editor,select-list}.ts` |
| 消息流组件（§2.6 调研对象） | `components/messages/{thinking,user-message,assistant-message,tool-call,step-summary,read-group,shell-execution}.ts`、`components/panes/activity-pane.ts`、`utils/transcript-window.ts` |

### 2.6 消息流呈现调研（messages/*，S17-S21 参照基准，2026-08-20）

调研范围：kimi **会话流**（transcript 消息区）的逐组件解剖。与 §2.1-§2.5 的 chrome 调研互补——S10-S16 覆盖"框"（编辑框/面板/对话框/footer），本节覆盖"框里的内容流"。以源码为准，双侧引用（kimi 侧 `kimi-code/apps/kimi-code/src/tui/` 下、Blue 侧 `packages/transcript/src/` 下）。

| # | 维度 | kimi 实现 | Blue 现状 | 期 |
|---|---|---|---|---|
| 1 | **思维链** | 独立 `ThinkingComponent`（`messages/thinking.ts`），`mode: 'live'/'finalized'`：live = 空行 + braille 帧 @80ms + `thinking...`（textDim）+ **尾部 2 行**滚动（`slice(-THINKING_PREVIEW_LINES=2)`）；finalized = 空行 + `● ` textDim + 全文 italic textDim，>2 行折叠为**前 2 行** + dim `... (N more lines, ctrl+o to expand)`；`setExpanded` 共享 ctrl+o；`finalize()` 原地转换不换组件 | reasoning 内联在 `AssistantMessageComponent`（`components.ts` render）muted+italic **永远全量可见**；无折叠、无 spinner、不在 ctrl+o 集合 | S17 |
| 2 | **活动指示** | `ActivityPaneComponent` 模式机（`panes/activity-pane.ts` + `kimi-tui.ts` `updateActivityPane`/`resolveActivityPaneMode`）：`waiting`/`tool` = **moon spinner** 🌑 @120ms + 轮换 tip + 重试 dim 明细行；`thinking` = **清空 pane**（spinner 归 thinking 块）；`composing`（正文流式）= braille `working...`（primary）；`idle` = 停转但留 Spacer(1) 占位防视口跳；对话框/审批挂起 = `hidden` | `pane-activity.ts` 单态 `⠋ working…`，运行中恒显，与 thinking 双转 | S17 |
| 3 | **用户回显** | 空行 + `✨ `（`constant/symbols.ts` USER_MESSAGE_BULLET）**boldFg(roleUser)** + **全文 boldFg(roleUser)**；续行以 bullet 可见宽对齐；图片同宽缩进（`messages/user-message.ts`） | 空行 + `❯ ` roleUser gutter + 正文默认前景色；续行 2 空格（`components.ts`） | S18 |
| 4 | **助手消息 chrome** | 空行 + `● `（text 色）行首 bullet + 正文缩进 `MESSAGE_INDENT = '  '`（`messages/assistant-message.ts`、`constant/rendering.ts`） | 无 bullet，markdown 正文顶格 | S18 |
| 5 | **注入上下文/系统提示词** | 模型侧合成消息**从不渲染**；回放也只用零行 `ReplayTurnBoundaryComponent` 占位维持 turn 边界（`user-message.ts` 尾部）；请求头 system prompt 无 TUI 呈现面 | harness 以 `user/message` + `source`（agent-instructions/plugin/notice/relay 等 ContextFormed 词汇）注入 AGENTS.md 等；fold **忽略 `source`**（`fold.ts` `case 'user/message'`）→ 整块渲染成 `❯` 用户气泡 | S19（D28） |
| 6 | **工具卡折叠** | 运行态**实心** `● `（text 色，防空心→实心闪烁）；完成 `✓`/`✗ `；标签 `Using/Used ToolName (key-arg)` bold primary；Bash 纯标签 Running/Ran a command；MCP `· MCP/server` dim；dim chip ` · N lines`；结果预览 **3 行**（`RESULT_PREVIEW_LINES`）、Write/Edit dim 行号预览上限 **10 行**（`COMMAND_PREVIEW_LINES`）；统一展开提示 `... (N more lines, M total, ctrl+o to expand)`；**ctrl+o 只作用最近 3 turn**（`TRANSCRIPT_EXPAND_TURNS` 按位置判定，`kimi-tui.ts` `toggleToolOutputExpansion`）；同 step ≥2 Read → `● Read N files · L lines` + `  ├─/└─` 树（`messages/read-group.ts`）；shell `$ ` shellMode + 命令 textDim + 输出 textMuted（`messages/shell-execution.ts`；以上主体在 `messages/tool-call.ts`） | 运行态空心 `○`→`●`；`● name(args≤60)` 无动词标签；结果 `  ⎿ ` 单行 160 字符摘要（`RESULT_SUMMARY_MAX_CHARS`）；ctrl+o 全量翻转不限 turn（`index.ts`）；无分组/行号预览/chip | S20 |
| 7 | **会话流边距** | `CHROME_GUTTER = 1`（`constant/rendering.ts`）：transcript/panels/statusline 左右各内收 1 列（`GutterContainer(1,1)` 包全部容器），与编辑框内列对齐；**编辑框贴 0 列**（"边框是视觉锚"） | 组件满宽渲染（`core/src/terminal.ts`）；`padColumns` S13 已落、**消费显式推迟** | S21（D29） |
| 8 | 次要差异（顺带或明确不做） | step-summary 措辞 `… thinking N times, call M tools, K messages`；窗口 15 turn 带 hysteresis 5；流式 markdown transient 重着色 | `… step N · Read ×2, Edit ×1`；`DEFAULT_WINDOW_TURNS=15` 无 hysteresis；无 transient。**不做**：transcript-mode 历史浮层（L0 否决项维持）、OSC 133 标记（非视觉差异，不引入） | S18 顺带 / 🚫 |

## 3. 差距表（现状 → 目标，按视觉影响排序）

| # | 表面 | Blue 现状（已核实） | kimi 目标 | 期 |
|---|---|---|---|---|
| 1 | 消息流配色与 markdown | `muted` 单灰阶；mdHeading 黄、链接/代码青、`-` 原样、代码块无着色 | 双层灰 + 粗体标题 + primary 链接/代码 + `•` + cli-highlight 代码着色 | S10 |
| 2 | 主题层级 | 26 token 中 `borderFocus`/`selectedBg` 从未使用；`accent` 一个青色既做选中又做强调 | `primary`（交互）/`accent`（次强调）分离；最暗层 textMuted | S10 |
| 3 | 编辑框 | 两条全宽 `─` 裸横线；`!` 模式仅边框变色；无提示符 | 圆角框 + `>`/`!` 提示符 + 模式边框色/边框内标签 | S11 |
| 4 | 空闲操作提示 | HintLine 空闲时为空行；正常操作无任何按键提示 | 编辑框下常驻暗色按键行（idle/运行中两态） | S11 |
| 5 | 对话框 | 无边框、无标题、无按键行；审批 1-4 直选可用但**不显示编号** | 框架 + 标题 + 底部按键行；审批琥珀横线 + `▶` + 可见编号 | S12 |
| 6 | /help | 两节纯文本，无对齐无滚动窗 | primary 边框 + 双列对齐 + `showing 1-N of M` 滚动窗 | S12 |
| 7 | pane（btw/todo） | btw 无框、纯文本行、不与编辑框拼接；todo 无框 | btw 圆角框（边框内标题 + `Esc close · ↑↓ scroll`）+ markdown + 与编辑框 `├┤` 拼接；todo 加框 | S13 |
| 8 | 补全下拉 | `startsWith` 前缀匹配；选中青色；描述单行截断 | 模糊匹配；选中 primary；描述换行 2 行；参数幽灵提示；斜杠 token 加粗 | S14 |
| 9 | footer | 1-2 行纯 muted 文本 | 两行结构：徽章/条目 + 右对齐轮换 tips；L2 context 百分比 | S15 |
| 10 | 欢迎页右栏 | 占位文案 | 真实 tips（复用 S15 文案模块）+ v2 token | S16 |
| 11 | 符号体系 | `●`/`❯`/`⎿` 零散 | `✓/✗/← current`、todo 三态点、展开提示等系统化清扫 | S16 |
| 12 | 思维链与活动指示 | reasoning 永远全量内联可见；activity pane 单态恒显、与 thinking 双转 | live spinner + 尾部 2 行滚动，完成自动折叠 2 行 + ctrl+o；活动模式机（waiting/tool=moon、thinking 空、composing=braille） | S17 |
| 13 | 用户回显 / 助手 chrome | `❯` 着色 gutter + 无色正文；助手无 bullet | `✨` + 全文 bold roleUser；助手 `●` bullet + 2 列缩进 | S18 |
| 14 | 注入上下文 | AGENTS.md 等合成 user 消息整块展开成用户气泡 | 合成来源零呈现（kimi 哲学，D28） | S19 |
| 15 | 工具卡折叠 | `○`→`●` + `name(args)` + 单行摘要；ctrl+o 全量翻转 | `✓/✗` + Using/Used 动词标签 + 3/10 行预览 + dim chip + 最近 3 turn 范围 + Read 分组树 | S20 |
| 16 | 会话流边距 | 组件满宽贴边 | chrome 左右各内收 1 列（`padColumns` 消费，D29） | S21 |

## 4. 主题契约 v2（决策 D24）

### 4.1 变更内容：26 → 28 token，**只增不改结构**

**为什么是 +2 而不是 +3**：kimi 的灰阶是 textDim/textMuted 两层。Blue 现有 `muted`（#808080）的用法（描述、引用、暗提示）恰是 kimi 的 **textDim 层**（#888888）；Blue 缺的是**最暗层**。因此：

- 新增 `textMuted` ≡ kimi textMuted（最暗：计数器、按键行、URL、围栏）；
- 现有 `muted` 语义上就是 kimi 的 textDim，**不改名**（改名 = 违反"只增不改"纪律 + 全渲染器两次翻搅）；
- 新增 `primary` 承接一切"交互主色"用法（今天这些用法错位地落在 `accent` 和 `border` 上）。

| 新 token | dark | light | 承接的用法 |
|---|---|---|---|
| `primary` | `#4fa8ff` | `#0969da` | 补全选中行/指针、编辑框 `/` 语境边框、md 链接与内联代码、spinner 帧、运行 `●`、`→` 游标 |
| `textMuted` | `#6b6b6b` | `#8c959f` | `(n/m)` 滚动行、对话框按键行、`⎿` 连接符、`… output truncated`、footer 分隔、mdLinkUrl、代码围栏 |

`#5f87ff`（现 `border` 的蓝）最初拟转任 `primary`——"品牌蓝从边框转任交互主色"；S10 目测定稿将 primary 校准到 kimi 的天蓝 `#4fa8ff`（暗底更亮），身份仍是"蓝 = 交互色"，层级对齐 kimi（kimi 的 border 反而是中性灰）。

### 4.2 现有 token 重调（取值变更，不改名不改数）

> **S10 目测定稿（2026-08-19）**：初版按 Tomorrow-Night 系推演，dogfood 反馈整体灰暗无生机。定稿将 dark 全表向 kimi 亮度/饱和度校准（正文 `#e0e0e0`、状态色鲜绿/鲜红、accent/roleUser/shellMode 提饱和、border 取 kimi 中性灰 `#5a5a5a`）；下表"新值"即定稿值。light 侧维持 primer 系不动。调值不构成契约变更（D24）。

| token | dark 现值 → 新值 | 理由 |
|---|---|---|
| `border` | `#5f87ff` → `#5a5a5a` | chrome 退后为中性灰（kimi 同值）；初版蓝灰 #4a5468 目测偏闷 |
| `borderFocus` | `#8abeb7`（未用）→ `#e8a838` | kimi 焦点琥珀；S12 审批面板启用 |
| `warning` | `#ffff00` → `#e8a838` | 与 borderFocus 共琥珀（kimi 同值关系）；修正刺眼纯黄 |
| `roleUser` | `#8abeb7` → `#ffcb6b` | 用户角色获得独立亮琥珀（kimi #FFCB6B）；黄从 mdHeading 释放 |
| `mdHeading` | `#f0c674` → `#e0e0e0` | kimi：标题层级由**粗体**承载而非色相，色同正文 |
| `mdLink`、`mdCode` | `#81a2be`/`#8abeb7` → `#4fa8ff`（= primary） | kimi 映射 |
| `mdCodeBlock` | `#b5bd68` → `#e0e0e0` | 代码块正文交给 cli-highlight 着色（§7 S10），底色中性 |
| `mdCodeBlockBorder` | `#808080` → `#6b6b6b`（= textMuted 层） | kimi 映射 |
| `mdHr` | `#808080` → `#5a5a5a`（= border） | kimi：hr ≡ border |
| `mdListBullet` | `#8abeb7` → `#e0e0e0`（= text） | kimi：`•` 用正文色 |
| `text` | `#d4d4d4` → `#e0e0e0` | 正文提亮一档（kimi 同值）——目测调校的主轴 |
| `muted` | `#808080` → `#888888` | 对位 kimi textDim（#888888） |
| `accent` | `#8abeb7` → `#5bc0be` | 低饱和青提饱和（kimi 同值） |
| `primary` | `#5f87ff` → `#4fa8ff` | 交互蓝提亮（kimi 同值；§4.1 定稿注） |
| `success` | `#b5bd68` → `#4ec87e` | 橄榄绿改鲜绿（kimi 同值）：工具圆点/终态观感主因之一 |
| `error` | `#cc6666` → `#e85454` | 灰红改鲜红（kimi 同值） |
| `shellMode` | `#b294bb` → `#bd93f9` | 紫提饱和（kimi 同值） |
| `diff`×6 | → `#4ec87e`/`#e85454`/`#7ad99b`/`#f08585`/`#6b6b6b`/`#888888` | diff 系与状态色共用 kimi 鲜绿/鲜红族，diff 卡不再发闷 |
| `mdQuote`×2、`mdLinkUrl` | `#808080`×2 → `#888888`；`#666666` → `#6b6b6b` | 跟随所属灰阶层（muted 层 / textMuted 层）联动 |
| 其余（`textStrong` `#ffffff`、`selectedBg` `#3a3a4a`） | 不变 | textStrong 比 kimi #F5F5F5 略亮，保留 |

light 侧对应：`primary #0969da`、`textMuted #8c959f`（均 primer 系，与现有一致）、`border #6e7781` 不变、`borderFocus`/`warning` → `#9a6700`、`roleUser` → `#953800`、`mdHeading` → `#1f2328`、mdLink/mdCode → primary、mdCodeBlock → `#24292f`、mdCodeBlockBorder/mdLinkUrl → textMuted、mdHr → border、mdListBullet → text。全部维持 ≥4.5:1 文本 / ≥3:1 chrome。

### 4.3 落地机制（已核实，改动面收敛）

- `core/src/types.ts`：`BlueSemanticColors` +2 键（全 required，编译期驱动全部实现）。
- `core/src/theme-palette.ts`：**零改动**——`BlueForegroundHexes = Record<Exclude<keyof BlueSemanticColors, 'selectedBg'>, ...>` 自动派生。✅
- `theme-dark.ts` / `theme-light.ts`：按 §4.2 表改值。
- `theme-auto.ts`：零改动（import 两常量）。
- `theme-custom.ts`：**零改动且 additive-safe**——✅ 已核实其逐 token 走 `Object.hasOwn(base, token)` 校验（`theme-custom.ts:64`），新 token 自动可覆盖，旧用户文件缺新键自动回退 base 条目。
- `core/src/components.ts`：`selectListTheme`（selected → primary、description/scrollInfo → textMuted、noMatch warning→textMuted 同 kimi 的"无匹配降噪"）、`settingsListTheme` 游标 → primary、`markdownTheme` 重映射（S10）。
- 全渲染器 token 审计：`muted` 用法二分（最暗槽位 → textMuted；次级正文保留 muted），选中/指针槽位 `accent` → `primary`。涉及 transcript（components/status/pane-*）、interaction（select/approval/questionnaire/commands/editor-plus/input-plugin）、banner。
- `/theme` 热切换机制不变；纪律重申：渲染路径禁止缓存样式函数（p1-design §5.2）。

## 5. 共享 chrome 辅助层（决策 D25）

**归属：core 新增纯模块 `src/chrome.ts`，子路径导出 `@dsh-blue/blue-core/chrome`**。理由：边框绘制是纯 `string[]` 数学（需要 `visibleWidth` 一类宽度函数，core 已再导出），不需要 pi-tui 组件机制——不走 `blueComponents` 服务（生命周期是死重），不放 interaction/transcript（会重复实现或走私 pi-tui 依赖）。子路径导出与主题插件族先例一致；按 p1-design §6.3 纪律"新缝在首个真实消费者出现时开"，S11 开出。

API（全部接收色函数参数——主题无关、纯函数、trivially testable）：

| 函数 | 作用 | kimi 移植源 |
|---|---|---|
| `withSideBorders(lines, paint, {connectedAbove?, label?})` | `─` 横线行 → `╭─╮`/`╰─╯`（connectedAbove 时 `├─┤`）；内容行仅当 0 列/末列为**字面空格**时覆盖 `│`（保护反显光标 SGR）；滚动指示行保留文字 | `wrapWithSideBorders` |
| `topRule(width, {title?, hint?, paint, …})` | 边框内标题行：`╭ BTW ─ Esc close ────╮` | btw-panel 顶边框 |
| `framePanel(body, {title?, footerHint?, paints})` | 对话框框架（标题行 + 边框 + 底部按键行），S12 对话框统一用 | approval/help 面板解剖 |
| `injectPromptSymbol(line, symbol, paint?)` | 第 2 列叠加 `>`/`!`（需 paddingX ≥ 4） | `injectPromptSymbol` |
| `injectGhostHint(line, hint, …)` | 光标后插入 textMuted 幽默提示（参数 hint），行宽守恒 | `injectArgumentHint` |
| `highlightLeadingSlashToken(line, paintBold)` | 行首 `/command` token 实时加粗 primary | `highlightFirstSlashToken` |
| `hintRow(parts, paint)` | `key label · key label` 按键行拼装 | 对话框 footer 惯例 |
| `padColumns(lines, n)` | chrome 内收 n 列（kimi `GutterContainer(1)` 的纯函数等价） | — |

**明确拒绝**：移植 kimi 的 `GutterContainer`（pi-tui Container 子类，会让 pi-tui 类型越过 L0 边界）。1 列内收是否启用由 S13 实测决定（§7）。

**EditorAdapter 接线**（core/src/components.ts:189）：`EditorAdapter.render(width)` 在 pi-tui Editor 输出上后处理——这是 kimi `CustomEditor.render()` 的镜像位，**无需子类化 pi-tui**。契约增长（`BlueEditor`）：

- `setPromptSymbol(symbol: '>' | '!' | undefined)` — 提示符；
- `setBorderLabel(text: string | undefined)` — 边框内标签（` ! shell mode `）；
- `setConnectedAbove(connected: boolean)` — 顶角切换 `╭╮`/`├┤`（S13 btw 拼接用）；
- `setGhostHint(text)`（S14）。

边框绘制经**当前** `editor.borderColor` 走色（kimi 同法），`setBorderColor` 语义不变。

## 6. 常驻按键提示（Blue 扩展，kimi 精神）

kimi 没有编辑框下常驻按键行（其提示分布在对话框 footer 与 footer tips）；这是 Blue 在 kimi 提示哲学下的自有设计，填补"空闲时用户看不到任何按键"的缺口。

- **位置**：现有 `HintLine`（`interaction/src/input-plugin.ts`），今日空闲为空行，改为填充常驻提示。
- **优先级**：瞬态通知 > 斜杠建议（输入 `/` 时）> 常驻提示——现有 `refreshHint` 链自然延伸。
- **内容源**：**精选 action-id 白名单 + `blueKeymap.getKeys(action)`**（而非 `keymap.list()` 全量——那会把审批/问卷/todo 的动作也倒进提示行）。新模块 `interaction/src/hint-content.ts`：
  - idle：`! bash · / commands · @ files · ctrl+s steer · ctrl+c exit`
  - running（`agent.status === 'running'`）：`esc interrupt · ctrl+s steer`
  - 存在性门控片段（pane-queue 先例）：如 `blue.image.paste` 已注册时加 `ctrl+v paste image`。
- **样式**：`textMuted`（新 token）——比今日 `muted` 通知更暗一档，常驻不抢注意力。
- bash 模式/补全展开态由 editor-plus / pi-tui 持有；补全展开时下拉本身覆盖提示行的信息职能（下拉渲染于编辑框下边框之下，✅ 已核实 0.84.2 editor render 顺序）。

## 7. 分期实施（S10-S21）

排序原则（用户定夺）：**按视觉影响**，不按功能点名顺序。每期 = 一个可交付切片：core 提交 + bundle 提交 + docs 提交（ADR + p1-design step log 行 + roadmap + AGENTS + 双语 README）+ `pnpm run test` / 逐文件 100% 覆盖 / typecheck / lint 全绿。

### S10 — 主题契约 v2 + 消息流/markdown 升级 ✅（2026-08-19 落地）

**为什么第一**：transcript 是用户注视面积最大的表面；且 `primary`/`textMuted` 是 S11-S16 全部的前置。

- core：§4 token 落地（types/theme-dark/theme-light/components 映射）；`markdownTheme` 重映射 + `listBullet` 的 `-`→`•` 改写 + `highlightCode` 钩子接 **cli-highlight**（唯一新运行时依赖；✅ 已核实 0.84.2 `markdown.d.ts` 有 `highlightCode?: (code, lang) => string[]`；未知语言降级纯文本，着色只改色不改行数）。
- transcript：组件 token 审计——用户消息槽 `❯` → `roleUser`、流式光标与 spinner 帧 → `primary`、`⎿`/截断行 → `textMuted`、工具 `●` 保留 accent/error 语义但运行态点 → `primary`。
- 已知限制（文档记录）：0.84.2 markdown 单一 `heading` 函数无法区分 h1/h2，kimi 的 h1 下划线不可表达。
- 验收：对话含标题/列表/链接/代码块/引用的渲染对比；`/theme light` 全套不刺眼；e2e 色彩断言更新。

**Step log（2026-08-19）**：core 三件（types 26→28、两 theme 表按 §4.2 全表改值、`src/highlight.ts` cli-highlight 包装 + `markdownTheme` 粗体标题/`•` 改写/`highlightCode` 钩子 + select/settings 映射）；transcript 八处 token 审计（components×5、pane-activity、intent-diff、intent-terminal）；bundle e2e 5 处色锚换 v2 值 + 新增 markdown v2 用例（内容级锚：`•`、围栏行、着色行 truecolor SGR 存在性——S8 纪律）。603 tests / 52 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。**范围边界**（按期归位，防 scope creep）：`settingsListTheme` 仅游标换 primary（selected label/value 留 accent，S12 复审）；intent-terminal `$` 前缀与 editor-plus `!` 行的 accent 随 S11；pane-todo `◐` 随 S13；banner token 复审随 S16；interaction 对话框选中 accent（S12）与 status footer muted（S15）不动。色值按 §4.2 落地，`border` #4a5468 实机目测微调随后（调值不构成契约变更）。**目测定稿（同日追加提交）**：dogfood 反馈整体灰暗无生机，dark 全表向 kimi 亮度/饱和度校准（正文 `#e0e0e0`、状态色鲜绿/鲜红、accent/roleUser/shellMode 提饱和、primary `#4fa8ff`、border `#5a5a5a`，diff 系同步），light 不动；token 契约与映射零改动，603 tests / coverage / typecheck / lint 复验全绿。**第二轮目测（同日）**：正文流观感达标，但 banner 与编辑框发闷——kimi 的欢迎框**整个是 primary**（外框、logo、标题全蓝，仅信息标签灰），照此对齐：banner frame/castle/欢迎行 border→`primary`；编辑框边框 border→`primary`（交互锚回蓝的过渡决策：kimi 默认灰边框靠圆角框结构 + 语境变色撑观感，Blue 的裸双横线编辑框配灰只会死气——S11 圆角框与语境边框落地时复审默认值）。`border` token 本体维持 `#5a5a5a`（mdHr 及后续 pane 边框用）。**第三轮目测（同日）**：banner 布局按用户反馈重排——盒子铺满视口全宽（撤销 120 列封顶与 100 列右栏阈值）；logo 格紧贴城堡修剪后的自身宽度（切掉全空白边缘列，16 列），右格拿走其余宽度承载欢迎行/模型行/cwd/Tips 节（右格 ≥30 列时加入，80 列终端即含 Tips）；高度取城堡与右格较高者（默认内容十行，原十六行），右格更高时城堡垂直居中；what's-new 占位节随本轮撤下，S16 真实右栏内容落地时回归。**第四轮目测（同日）**：三处修正——(1) **正名**：logo 从来不是城堡，是喷水的像素鲸鱼（blue 之名的主角）；`CASTLE_PIXELS` 更名 `WHALE_PIXELS`，文档措辞同步。(2) **信息归位**：Welcome/模型/cwd 回到左侧，与鲸鱼并排（logo 格 16 列 + info 格），Tips 独占右侧（左区固定 44 列，视口 ≥77 列时 tips 格 ≥30 列加入）；高度九行。(3) **鲸鱼缩小 30%**（20×8 → 16×7，手工等比 ×0.8）：保住全部不对称设计——喷水行左侧比背部内收 1-2 像素（侧鳍/头部轮廓）、身体缺口与两侧内缩、腹部左凸；水花按用户意见改画为错落小气泡点（5 个 ▀/▄ 单点，两行错位）。重采样方案（并集/多数表决）均会抹掉 1px 细节，手工等比是唯一保真路径。**第五轮目测（同日）**：按用户提供的 Claude Code 参考版重排为经典两栏——居中左栏（Welcome → 鲸鱼 → 模型/cwd 竖排），右栏 Tips + 分隔横线 + What's new（what's-new 节回归）；左栏固定 44 列、视口 ≥77 列起右栏 ≥30 列加入，铺满全宽，默认内容十三行；鲸鱼再压一档：身体 4 行像素（背/缺口身/腹/底），水花改为**文字点**（`· .` 液滴两行，刻意不用像素块——像素半块在小尺寸下太重），共 6 行。

### S11 — 编辑框 chrome + 常驻按键提示 ✅（2026-08-19 落地）

- core：`src/chrome.ts` + 子路径导出（§5）；`EditorAdapter.render` 接 `withSideBorders`/`injectPromptSymbol`；契约增 `setPromptSymbol`/`setBorderLabel`/`setConnectedAbove`。
- interaction：`createEditor({paddingX: 4})`；editor-plus 的 `!` 模式升级为**符号 + 边框标签 + 色**三件套（替今日仅变色，消除 p1-design S2 偏差记录"pi-tui Editor 无 prompt 符号载体"）；输入 `/` 开头时 `setBorderColor(primary)`、清空恢复（onChange 链）；HintLine 常驻提示（§6）+ `hint-content.ts`。
- 风险：反显光标 SGR 行的覆盖保护（chrome 纯函数 spec 全分支）；补全下拉与侧边框同帧输出的 e2e 钉住；`/theme` 换装后 bash 模式状态——draft-stash 先例，扩展暂存或文档记录为重置。
- 验收：空编辑器圆角框 + `>` 提示符 + 下方常驻提示行；`!` 进 shell 模式三件套；`/` 变蓝框。

**Step log（2026-08-19）**：core——`chrome.ts` 仅落 S11 的两个消费者（`withSideBorders`/`injectPromptSymbol`，kimi 逐行移植：边框行剥 SGR 重涂、标签只进纯 `─` 串、滚动指示行免疫、内容行仅字面空格外列叠 `│`；`charAt` 取代索引访问以消不可达分支），`./chrome` 子路径导出（exports/files/tsdown 三处）；`EditorAdapter.render` 后处理（`!` 提示符随边框色、`>` 裸前景，kimi 规则；角/条涂色走**活** `borderColor` 引用，宿主 `setBorderColor` 全框同步），契约三 setter 落地（`setConnectedAbove` 供 S13，`setGhostHint` 留 S14 首消费者）。**默认边框色复审定稿**：S10 第二轮目测的"编辑框 border→primary"过渡决策随圆角框落地退役，默认回 `border` 中性灰（kimi 同法：灰默认 + 语境变色撑观感；斜杠→primary、bash→shellMode）。interaction——input-plugin：`paddingX: 4` + 挂载即 `setPromptSymbol('>')`，onChange 链增斜杠语境解析；HintLine 三层（通知/斜杠建议 `muted`，常驻 `textMuted`，**渲染时重算**——插件后装/键位后注册无需重接线，也让卸载后渲染不再触碰死 ctx 属性）；`hint-content.ts` 纯模块（idle/running 两态，键名一律 `blueKeymap.getKeys` 白名单，`! bash`/`@ files` 按 editor-plus 在场门控、`ctrl+v paste image` 按 action 在场门控）；editor-instance 增强在场标记（`markEditorEnhancement` 幂等 disposer）；editor-plus：bash 三件套，bash 态每次 onChange 重申 shell 色（压过斜杠解析——`/` 在 bash 是路径分隔符），提交/空提交恢复；draft-stash 增 input mode 暂存，detach 只做视觉恢复不写暂存（主题重载后 bash 连同草稿一起重建）。bash 模式经 `/theme` 换装存活由此落地（风险第三条的"扩展暂存"分支）。e2e：新增三用例（圆角框+`>`+常驻行全量片段、`/` 蓝框+下拉行同帧带侧条、bash 三件套+空提交复原）；四处空闲边框锚从 primary #4fa8ff 换 `border` #5a5a5a；/sessions 选择器加宽 240→300（行预算 = 60% 视口宽，worktree 路径比主仓长 ~30 列，cwd 段把 `(current)` 后缀挤出截断——规格对 checkout 路径长度的既有脆弱点，非本轮回归）。640 tests / 54 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。**范围边界**：编辑器滚动指示（`── ↑ N more ──`）成框后视觉由 chrome 纯函数保障，无需单独用例外的 spec 已覆盖；banner/状态栏不动（各自 S16/S15）。**目测追加（同日）**：shell echo 挂载后无重绘（结果要再按一次键才出现）——根因是 `runShell` 的挂载点漏调 `requestRender`（pi-tui 只按请求渲染，异步结算落在输入帧之后）；修复 + 手动结算 executor 的回归规格（红验证过），641 tests。**边界转归**：S10 归位到本期的"intent-terminal `$` 前缀与 `!` 行 accent 复审"本轮未消费（只做了编辑框内 `!` 符号），连同 dogfood 反馈的 shell echo 面板观感（现为 accent 头 + 裸正文，无运行中阶段）一并转归 **S13**——滚动区内容块的边框/标题 chrome 原语（topRule）恰在该期落地，且 kimi 参照为无框 dim 卡（`$ cmd` shellMode 命令行、正文 dim、stderr 仅失败红）与 intent-terminal 卡片两个方向二择，S13 实测定；live 运行卡（尾行/计时/ctrl+b）为功能项，依赖流式输出能力缝，另行排期不入 S13。

### S12 — 对话框 chrome 统一 ✅（2026-08-19 落地）

- interaction：`BluePanel` 升级为 `framePanel`（标题 + 边框 + 底部按键行；按键行泛化 BlueSelect 现有 keymap 驱动 footer 的生成法）；**审批面板 kimi 化**——`borderFocus` 琥珀上下横线 + `▶` 指针 + 可见编号 `1.`-`4.`（直选本就可用）+ 底部 `↑/↓ select · 1-4 choose · ↵ confirm`；问卷加 `(○)`/`(✓)` tab 标记 + 按键行；**/help 移植 HelpPanel**——primary 横线 + ` help ` 标题 + 双列对齐（键 | 说明、命令 | 说明）+ 滚动窗 `showing 1-N of M`（↑/↓/pgup/pgdn）；/sessions 加框 + 当前会话 `← current` 标注 + `esc cancel · ↵ resume` 按键行；`BlueSelect` 光标行启用 `selectedBg`（该 token 首个真实使用，整行 pad 满宽防背景断裂）。
- 纪律：全部仍走 `showOverlay`（D19 overlay-only 不破）；按键行经 `truncateToWidth` ANSI 安全截断。
- 验收：五个 overlay（sessions/help/问卷/审批/多选）视觉解剖一致：标题、框、按键行齐备。

**Step log（2026-08-19）**：core——`chrome.ts` 落 `framePanel(body, width, opts)` 与 `hintRow(parts, paint)`（§5 草样的两处细化：**规则线宽显式传参**——body 可能整体短于视口宽，宽度不能从 body 反推；title/titleHint/footer/footerPaint/rulePaint 全可选，缺省 identity 维持主题无关。全宽平 `─` 规则，圆角框仍专属面板/编辑框）；`settingsListTheme` 选中行 label/value accent→primary（S10 复审项收口，选中行是交互目标）。interaction——**审批 kimi 化**：`borderFocus` 琥珀上下横线 + `▶ Approve bash?` 标题（kimi `headerFor` 语义保留 Blue 的 `Approve <tool>?` 锚）+ 编号选项 `N. label`（选中 `▶ N.` accent、未选中 `  N.` textStrong，kimi 同构）+ 底部 `↑/↓ select · 1-4 choose · ↵ confirm`；feedback 模式按键行 `type feedback · ↵ submit · esc cancel`。**问卷**：primary 横线 + ` question ` 标题 + `(○)`（muted）`(✓)`（success）tab 标记（2 空格分隔，active 无标记取 primary——kimi 的 bg-primary tab 无 bg 等价物）+ 选项游标 accent→primary + 按键行 `↑↓ select · space toggle · ↵ choose · tab switch · esc cancel`；MAX_OPTION_ROWS 8→6（kimi 值，配帧预算）。**/help 移植 HelpPanel**：primary 横线 + ` help ` + textMuted `· Esc / Enter / q to cancel · ↑↓ scroll`；两节双列对齐（Commands 标签 primary、Keys 标签 warning、描述 muted，padEnd 在色 span 内）+ 滚动窗默认 10 行内容（kimi 的 24 超出 60% overlay 预算——FakeTerminal 24 行下 14 行框体），`showing 1-N of M` 行也经 truncate；新模块 `interaction/src/help.ts`（HelpOverlay，↑/↓/`\x1b[5~`/`\x1b[6~` 翻页 10 行）。**/sessions 手写 SessionList**（select.ts 内，BlueSelect 同构）：`❯ ` 指针（选中行 primary）+ `← current` 徽章（kimi CURRENT_MARK，替代 SelectList 标签里的 `(current)` 后缀——不透明 SelectList 无法逐行着色）+ `esc cancel · ↵ resume` 标题提示行。**BlueSelect**：加框 + title 选项（默认 `Select`）+ 光标行 `selectedBg` 全宽 pad（首个真实使用，防背景断裂）+ 指针 `→ ` 换 `❯` + 滚动行/按键行 muted→textMuted。**行数预算**（pi-tui 把 overlay 输出 slice 到 maxHeight，底部横线会被切）：审批/会话 40%→55%（11/13 行），问卷 60%→75%（16 行 ≤ 18）。**边界**：kimi 审批的 ctrl+e preview / 会话搜索（Ctrl+A scope）/ ChoicePicker 的 Page 行均未移植（Blue 无对应输入面，S14 会话搜索另行评估）；help 无按键行 footer（kimi 同款——hint 在标题行）；问卷无 kimi 的 Submit 复审 tab（Blue 的完成语义是"全答完即提交"）。**测试**：chrome.spec +9（framePanel 分支矩阵含 identity 缺省、宽度截断、titleHint 双色）；新 help.spec ×7（导航/翻页/两端 clamp/无 labelPaint 节/fit 无 showing）；select.spec +SessionList 与 selectedBg 行；approval/questionnaire/questions-plugin/commands-plugin 锚全部重写为新解剖；bundle e2e 更新 approval 锚不变（`Approve bash?` 文本锚）+/help 改滚动断言（PageDown ×2 达 Keys 尾行——`ctrl+t` 行在第三窗）+ /sessions 锚换 `Sessions`/`← current`。**e2e 教训**（S11 教训续）：overlay 滚动后的输出断言要 `vi.waitFor`——渲染是节流的，直接读 output 读到滚动前的帧。覆盖门禁逐文件 100%（chrome/help/select 全分支，含 keyless action 行与空 items），666 tests / 54 files（环境性 banner 单测除外——worktree 路径超 44 列左栏截断，master 上全绿），typecheck/lint 全绿。

**上拉框定妆（同日，用户反馈后追加；用户确认定稿）**：用户否决居中式模态弹窗观感，要求 kimi 的**底部上拉全宽面板**（参照 kimi 实机截图：面板从编辑器槽位升起，statusline 保持在最底行可见），并立规：**后续除非特别说明，一律使用上拉面板、不用弹窗样式**（D26）。两处结构性改动：(1) **dock 顺序翻转为 kimi 同款**——核实 kimi 源码 `kimi-tui.ts`：`ui.addChild(transcript, activity, todo, queue, btw, editorContainer)` 后 `mountFooter()` **最后** `ui.addChild(footerWrap)`，statusline 在最底行、编辑器在其上；Blue 原为 footer 在编辑器上方（e2e 'footer above editor' 锚）。`blueScreen.addBottomChild` 增可选 `position: 'bottom'`（contract 增量，默认行为不变），footer 壳以该位置挂载，runtime 保证 pinned 组件渲染在 dock 尾部（`bottomPinned` 集 + TUI children 数组重排：pinned 成员 re-append 末尾、常规成员插到首个 pinned 之前）。(2) **五个对话框 overlay 全量改锚定**——`width: '100%'` + `anchor: 'bottom-center'` + `offsetY: -2`（让出 footer 两行；pi-tui bottom-center 锚 + 负 offset 使面板底边停在终端倒数第 3 行，footer 在最底两行可见，编辑器被面板盖住——kimi 的"dialog 替换编辑器槽"视觉等价）。**framePanel 标题行改 kimi 格式**：`  help · Esc / Enter / q to cancel · ↑↓ scroll`——标题缩进 2 列（在 titlePaint 内）、hint 以 `· ` 开头经单空格接在标题后（调用方改传 `· esc cancel · ↵ resume` 等）。审批/问卷选项行缩进 2 列（kimi 面板体同款）。/help 滚动窗 10→16 行（面板预算 85% 视口 − footer 2 行，24 行最小终端恰好容纳 16+4）。审批/会话 overlay 的 40%→55%、问卷 60%→75% 保持；/help 60%→85%。**测试**：dock 顺序 e2e 三处反转（footer 现为全树最底：'footer on the last rows below the editor'、spinner/todo/queue 断言 footerAt > borderAt > paneAt）；framePanel 标题断言改 `  help` 格式；审批/问卷行缩进断言；/help 'showing 1-16 of 18'。**边界**：offsetY 常量 -2 对应两行 footer 壳——footer 条目为空收缩到 0 行时面板底部会留 2 行空隙（记录，不特殊处理）；面板盖住编辑器期间编辑器不可见（kimi 同行为）；`position: 'bottom'` 为单消费者缝（footer），下游替换 footer 插件时自行选用。

### S13 — pane 边框 + dock 拼接（/btw 效果） ✅（2026-08-19 落地）

**Step log（2026-08-19）**：core——`chrome.ts` 落 `topRule(width, {title, titlePaint, hint, hintPaint, paint})`（kimi `renderTopBorder` 泛化：`─ ` joiner 仅 title+hint 同时在；复合串 ANSI-safe 截断——pi-tui 空省略号截断会附加 `\x1b[0m` reset，属保护性行为，随截断用例钉住；fill 补齐内宽）与 `padColumns(lines, n)`（kimi `GutterContainer(1)` 的纯函数等价，**消费显式推迟**——kimi 的 gutter 是全局 1 列，启用牵动 transcript/panes/editor 全部组件，本期只落 helper + 单测）；`blueScreen` 契约增量 `readonly rows`（service/runtime 双 getter；terminal.ts 的 dock-sink 本已内读 `terminal.rows`）。types.ts Events merge 增两事件：`'blue/editor-connected-above'(connected: boolean)`（D25 预批准的拼接通道，pane-btw 发 / input-plugin 听）与 `'blue/btw-command'('close'|'scroll-up'|'scroll-down')`（编辑器链 → 面板路由通道），均 `@mode emit` JSDoc 标明双方。8 处测试 fake + recordingRuntime 同步补 `rows`（typecheck 即时报错，无漏网）。interaction——**键位墙偏离（对规格措辞的裁定）**：规格写"Esc 走 effect 绑定的全局动作（开时注册、关时注销）"，但 keymap 按 key 查重（KEY_CONFLICT；S3 备注已过期——冲突在注册期而非分发期），`escape`/`up`/`down` 已被 handlerless 的 ACTION_CANCEL/MOVE_UP/DOWN 永久占用。改为 **kimi 同构的编辑器链路由**：input-plugin `handleEditorKey` 由 `connectedAbove` 状态门控——Esc 在 autocomplete 检查后、清草稿/中断前优先 emit close（有草稿也先关面板，草稿存活）；↑/↓ 在 queue-recall 检查前、编辑器空时 emit scroll（**始终消费**，不回落编辑器历史——记录偏差）。shell echo 定妆方向 (a)（kimi dim 风格，两侧一致硬约束）：`ShellExecutor` 契约拆 `{code, stdout, stderr}`（node exec 天然分拆；rejection 挂 `{stdout:'', stderr:message, code:1}` 红 stderr）；新模块 `shell-sanitize.ts`（kimi `sanitizeShellOutput` 四正则移植，非串→''、try/catch 兜底 C0-only、catch 不可达 v8-ignore）；echo 渲染——头 `$ ` shellMode + 命令默认前景（kimi textDim → Blue text 双步映射）、stdout/stderr 行 textMuted（stderr 仅失败 error）、双空 textMuted `(no output)`、按流 caps 合并 truncated 行；**`exit code N` 行保留**（用户裁决：与 terminal 卡 exit 徽章对称、静默失败不丢信息；kimi 无此行，记录偏离）。pane-queue `↑` 字形 → primary（先截断纯文本再按首个 `↑` 切分插 SGR，SGR 在字符截断前会破坏宽度数学）。transcript——**pane-btw 全量重做**：kimi BtwPanelComponent 单轮移植（无 turns[]/error 行）——`topRule` 边框内标题（` BTW ` primary 粗体 + textMuted hint；truncated 才显示 `Esc close · ↑↓ scroll ` 变体——**无编辑器文本空门控**，近似记录）、正文 `│`+空格+clip(`…`)+填充+空格+`│`（contentWidth = width-4）、问题行保留 roleUser `›`（Blue 身份，不换 kimi `Q:`）、回复经 `createMarkdown` 渲染、fitBodyLines 全量移植（bodyLimit = max(3, floor(rows/3))-1，rows 活读随 resize 重排、minBodyLines 棘轮、followTail 尾随、scroll 逐行 clamp、滚动状态随问题重置）、尾空行 spacer（kimi Spacer(1) 等价）；接线——ask emit connected-above(true)、dismiss/卸载 emit false（无条件幂等，防 pane-only 卸载泄漏）、`ctx.on('blue/btw-command')` 路由 close/scroll。pane-todo 加框：topRule（` todos ` primary 粗体 + `ctrl+t ` hint）+ 2 列缩进行，**无侧边无底边框**（避免与 btw 盒、编辑框盒叠盒；kimi todo 亦无框）。intent-terminal 定妆：`$` accent→shellMode（S10/S11 转归收口）、输出 text→textMuted、完成无输出 → textMuted `(no output)` 行；卡侧不 sanitize（记录非目标）。bundle——e2e：shell echo 换三件套 + `$ ` shellMode SGR 锚 + 新增 stderr 失败 echo 用例（error 红 + exit 行在）；/btw 用例加拼接锚（` BTW ` / `Esc close` / `EDITOR_BORDER_SGR├`）+ Esc 关闭（sendInput + waitFor）+ 重开/裸 /btw 往返；queue 锚改内容锚（`↑` 已被 primary SGR 切分，连续串锚失效）。**范围边界**：padColumns 消费推迟（上记）；live 运行卡（流式尾行/计时/转后台）不入本期（依赖流式输出能力缝）；`◐/☑/☐` 三态点系统清扫随 S16；session 搜索（S12 转归 S14）不动；开着面板重跑 S9 dock sink e2e，无填充闪烁（帧行数确定性成立）。669 tests / 55 files（worktree 环境性 banner 单测除外——路径超长左栏截断，master 上全绿），test/coverage（逐文件 100%）/typecheck/lint 全绿。
**续聊补丁（同日，dogfood 反馈）**：用户实测后裁定——面板打开时编辑框的输入应发给 /btw **继续对话**（kimi `sendUserInput` 语义），Esc 仍关闭面板。落地：`'blue/btw-command'` 增 `'submit'` 命令（带 `text` 载荷），`'blue/editor-connected-above'` 增 `busy` 标志；input-plugin 的 `submitPrompt` 在 connected 时把 Enter 路由到 submit（busy 时恢复草稿 + 提示，kimi 忙路径），pane-btw 升级为**多轮 turns**——同一旁路 agent 上追加 follow-up、面板按轮渲染 Q/A 块（turn 间空行分隔），滚动状态随 submit 重置、minBodyLines 棘轮跨轮保持；空闲翻转时重发 busy 标志。同轮修正 spec 的棘轮空行与滚动预算先渲染语义（fake 屏幕只在请求时渲染，滚动前需先 render 使 maxScrollTop 生效）。691 tests / 55 files。
**bash 退出补丁（同日，dogfood 反馈）**：`!` 进 shell mode 后只能靠提交命令退出。按 kimi 语义（custom-editor.ts:492-500）落地：**空提示符的 bash 模式下 Backspace 或 Esc 退出**——`!` 不在 buffer 里，"删掉它"=空 bash 输入上退格。接线：editor-plus 的 onKey 包装器先让 `blue-input` 链跑（面板 Esc 关闭、草稿清空优先），未消费才查 bash 退出；键位经 keymap 匹配，新增 `blue.interaction.backspace` 共享 action（keys.ts 唯一文本编辑键例外，语境门控不派发）。坑位同轮排除：`blueKeymap` 加入 editor-plus inject（包装器在真实 loader 下抛 "cannot get property without inject"，连锁导致 bash 模式泄漏进后续用例）；`/help` 键位列表随 backspace 行更新（padEnd 宽度随最长键名变 9）。
**todo 样式定稿补丁（同日，dogfood 裁决）**：用户提供参考图（扁平横线 + `  Todo` 标题 + ✓/●/○ 三态点），裁定：(1) 图标改 ✓（success）/●（primary 粗体）/○（textMuted）——kimi statusMarker 原版，替换 ☑/◐/☐；(2) 分割线**水平直线**（全宽平 `─`，border），**不要圆角**——替换 topRule 边框内标题方案（btw 面板保留圆角 chrome，两面板观感刻意区分，kimi 同款）。done 行内容 muted（kimi strikethrough 不移植，参考图为纯文本）。ctrl+t 提示随 in-border 标题一并撤下（参考图无提示行）。**默认展开裁决（同日二轮反馈）**：14 条 pending 的列表只显示 `todos 0/14` 摘要（旧"含 in-progress 才展开"默认规则把列表藏了）——裁定任何列表默认展开，Ctrl-T 手动折叠至下次写入重新展开；collapse 摘要行测试改经手动折叠触发。695 tests / 55 files。

**todo 三连补丁（同日三轮反馈，kimi 折叠定稿）**：用户裁定三点，前一轮"默认展开"裁决随之被 kimi 折叠取代。(1) **`todo_write` 调用逐出消息流**——fold 对 `tool/call` name 为 `todo_write`（harness tool-todo 的模型面名字）直接返回 null，其 `tool/result` 经 suppressed-callId 集合同样静默（防 unpaired 回退现身）；step-summary 只计可见卡，纯 todo 步骤无摘要行。kimi 保留调用标题只丢正文，Blue 两者皆隐（用户裁决，面板是列表唯一呈现面）。(2) **done 行删除线**——`\x1b[9m…\x1b[29m` 手写 SGR（BOLD 先例）包在 muted 内容上，kimi styleTitle 同款。(3) **长列表折叠按 kimi selectVisibleTodos**——MAX_VISIBLE=5，先收全部 in_progress（封顶 5），余位以最早 pending 补足、完成后侧留一席（最近 completed 优先，一侧不足另一侧扩），行序保持原序；footer `… +N more (2 done · 1 pending) · ctrl+t to expand`（muted，kimi 措辞，completed 标 done）；展开态 `all N items · ctrl+t to collapse`；展开跨写入保留（kimi setTodos 语义）、会话切换与列表完结时复位。(4) **全完成自动关闭**——列表非空且全 completed → 清空面板（kimi session-event-handler 规则，快照与增量同走 update()），下次写入折叠态重开。Ctrl-T 动作描述改 'Toggle todo list expansion'（/help 锚同步）。707 tests / 55 files（worktree 计，banner 环境性排除；合并后 master 全量复核 729 tests / 56 files，逐文件 100% 覆盖不变）。

- core：`blueScreen` 暴露 `readonly rows: number`（现仅 columns；btw 高度上限需要）。
- transcript：**pane-btw 重做**——`topRule` 边框内标题 ` BTW ─ Esc close · ↑↓ scroll `；回复经 `blueComponents.createMarkdown` 渲染；高度 `max(3, floor(rows/3))` 尾随滚动 + 手动滚动；关闭走 effect 绑定的全局动作（Esc，面板开时注册、关时注销）；面板与编辑框的拼接经**新事件 `'blue/editor-connected-above'(connected: boolean)`**——pane-btw 发、input-plugin 听、调 `editor.setConnectedAbove`（事件是跨包 sanctioned 通道，同 `'blue/input-editor-changed'` 先例）。pane-todo 加框（边框内 ` todos ─ ctrl+t `）；pane-activity/queue 的 spinner 帧 → `primary`。1 列 chrome 内收（`padColumns`）：实测编辑框成框后 0 列 transcript 是否错位，启用或显式推迟并记录。
- interaction：**shell echo 呈现定妆**（S11 dogfood 反馈 + S10 转归的 intent-terminal `$`/`!` accent 复审同轮）——方向二择于实测：kimi 无框 dim 卡（`$ cmd` 命令行 shellMode、正文 muted/textMuted、stderr 仅失败 error、空输出占位）或与 intent-terminal 卡片统一（`$ cmd` 头 + 输出行 + exit 徽章）；两侧 shell 输出表面（`!` echo 与 terminal 工具卡）观感一致是硬约束。live 运行卡（流式尾行/计时/转后台）为功能项，依赖流式输出能力缝，不入本期。
- 风险：S9 dock sink 按行数重测自适配（帧行数变化无碍），但帧行数必须确定性；btw 滚动状态随问题重置；全局 Esc 与编辑器 Esc 链的顺序（编辑器 Esc 是语境动作无 handler，全局分发器先于焦点路由——✅ S3 已核实语义，面板开时无冲突，注销必须 effect 绑定否则编辑器丢 Esc）。
- 验收：`/btw` 出带标题圆角框、与编辑框 `├┤` 融合、Esc 关、↑↓ 滚动；todo 框 + `ctrl+t` 提示。

### S14 — 补全与列表打磨 ✅（2026-08-19 落地）

**Step log（2026-08-19）**：**前置验证（规格 🔍 项）**：0.84.2 的 Editor confirm 分支对斜杠前缀确为"接受并提交"——Enter 先跑 `applyCompletion`（预选项入 buffer），随后 `cancelAutocomplete` 落回 `submitValue`（buffer trim 后提交，`'/btw'` 无尾随空格），无需 onKey hack，kimi 语义直接采用。core——`fuzzyMatch`/`fuzzyFilter` 经 `blueComponents` 契约重导出（`BlueFuzzyMatch` 形状 `{matches, score}`，低分优先；fakes 补同构实现）；`WrappingSelectList` kimi 移植——只替换 render（选择/过滤/按键留在 pi-tui），私有状态（filteredItems/selectedIndex/maxVisible/theme/layout）单点 cast + 0.84.2 钉住 spec；描述列按词边界 wrap 至多 2 行、超出省略号；接线在 `createEditor` 的 own-property shadow（`createAutocompleteList` 按前缀分流：`/` 用 wrapping 列表 + SLASH 布局 `{12,32}`，其余走原版 SelectList）——子类化未越 core（风险第一条兑现）。`setGhostHint` 首消费者落地（chrome `injectGhostHint`：光标块之后的 textMuted 幽灵文本，吃尾随 padding 保行宽、溢出省略号、光标在文中不动）；chrome `highlightLeadingSlashToken`（行首 `/command` 词元经可见索引定位重涂，ANSI 通行——反向光标存活）供 `slashTokenPaint` 粗体 primary。interaction——新模块 `slash-filter.ts`（kimi `scoreTokens` 移植：查询按空白分 token、每 token 都须 subsequence 命中命令名、按 pi-tui 分数求和升序）——下拉 provider 与 hint 行共用，两者"匹配"语义一致；provider 斜杠分支 items 的 value 与返回 prefix 都带斜杠（Enter 接受并提交、pi-tui best-match 预选按用户输入文本键入）；**bash 模式谢绝斜杠补全**（`/` 在 bash 是路径分隔符——Enter-即-提交语义下不设防会跑错命令；记录边界：bash 的 `/` 前缀无下拉，kimi 亦无补全）；`@` 分支 startsWith→`fuzzyFilter`（按路径）；参数幽灵提示 kimi `computeArgumentHint` 规则（`/^\/(\S+)( ?)$/`、未输分隔符时空格前置、bash 谢绝、重挂载对恢复草稿重算、detach 清空）；下拉描述 `hint — description` 拼接（kimi `formatSlashCommandDescription`；注册表 normalizeDefinition 保证 description/hint 非空——空角死分支随实现一并简化）。e2e 新增四用例：模糊命中+次序（`/se` 同中 /sessions+/resume 且连续者先、`/ssns` 乱序命中且 miss 全消）；幽灵+粗体 token（textMuted ` <question>` 起于光标格、词元 `\x1b[1m`+primary）；Enter 接受并提交（`/hel`+Enter → /help overlay）；窄宽换行（**56 列**——下拉渲染宽度是编辑器 contentWidth（paddingX×2 与框条均已削去），desc 列 31 < /sessions 摘要 42 → 第二行空白命令列；47 列实测被 `width > 40` 门挡成无描述行，教训：下拉宽度 = 终端 −2 −8）；既有斜杠用例加 hint 拼接锚（/btw 行——/resume 在首屏 5 行折叠线下）。**边界/推迟**：session 搜索（S12 转归"S14 另行评估"）评估为**推迟**——kimi 的 Ctrl+A scope 搜索依赖其会话选择器内部输入面，Blue 的 /sessions 是 overlay-only 手写列表（D19），引入搜索输入面属功能项非观感项，随会话管理增强另行排期。775 tests / 57 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。

- core：`blueComponents` 重导出 pi-tui 纯函数 `fuzzyFilter`/`fuzzyMatch`（✅ 已核实 0.84.2 从根导出）；斜杠下拉描述换行 2 行——core 内部 `WrappingSelectList`（kimi 移植，子类化 pi-tui **只发生在 core 内**；读私有状态的单点 cast 以 spec 钉住 0.84.2 行为，防升级漂移）。
- interaction：provider 从 `startsWith` 切 `fuzzyFilter`（斜杠按 name+description 文本、@ 按路径）；参数幽灵提示（命令注册已带 `input.hint`，如 `/btw <question>`——✅ 已核实 commands-plugin `input: { hint }` 字段）经 `setGhostHint`；斜杠 token 加粗 primary（chrome `highlightLeadingSlashToken`）。
- 🔍 实施前验证：0.84.2 的 Enter 对斜杠前缀是否"接受并提交"（kimi 语义）；不可达则文档记录为推迟，不改 onKey hack。
- 验收：输 `/b` 出模糊命中；选中行蓝色；`/btw` 后幽灵 `<question>`；行首 `/command` 加粗。

### S15 — Footer v2 ✅（2026-08-19 落地，v1 否决后按 kimi 研究重写，D27）

**Step log（2026-08-19）**：**前置**：v1 视觉否决（D27）→ kimi 源码研究定设计：`footer.ts` slot 以**两空格** join（无 `·` 无分隔色）、tips SWRR 轮换 + `' | '` 配对 + solo 旗标 + 宽度终裁；`git-status.ts` `status --porcelain -b`（`AHEAD_BEHIND_RE`）+ 脏树才 `diff --numstat HEAD` + TTL 缓存（branch 5s / status 15s）+ 500ms spawnSync + `parseNumstatCount`（`-`/不可解析记 0）；`shortenCwd`（`~` 与 `…/末3段`）。用户三项裁定：agent-status 移除（model only，运行态归 spinner）；git 徽章全量（diff 计数 + ↑↓，不取 PR 徽章）；worktree 重写不復用 v1 代码。transcript——`types.ts` 增 `row?: 1|2`/`align?: 'left'|'right'`（默认 1/left，谎言值钳位不崩不丢）；`status.ts` shell 重写：sorted entries 按 band 分左右簇、簇内 first-fit、`FOOTER_SLOT_GAP` 两空格 join、右簇预算 = 宽 − 左用量 − 2（左空则全宽；≤0 整簇不渲）、band pad 全宽不留残影、缓存键含已放置文本（entry 文本变化免 invalidate 重排）；`status-basic` 只留 model（`text` 档，删 `agent/status` 订阅——流式期间 footer 零重绘）；`status-cwd` 新子路径（`shortenCwd` 纯导出 + muted 档 priority 5，session 头 cwd 缺省回落 process.cwd）；`status-git` 重写（`GitCommandRunner`/`GitClock` 模块级可替换、缓存槽惰性刷新于 render——事件驱动渲染下任何重绘捎带分支变化、`formatGitBadge` 纯函数、session-changed 重建缓存）；`tips-content.ts` 13 条 ASCII 教学（只写 Blue 真实特性，solo/priority 字段：`!`/`@` 权 2、`/btw`/`ctrl+s`/`type /` solo）；`status-tips` 新子路径（nginx SWRR 展开确定性序、`tipOffer` 配对含尾回绕 + solo 双侧守卫 + 重复守卫、10s ticker 经可替换 timers、textMuted 右对齐 band 1、宽度回退 pair→primary→''）；`status-context` 升级（1024 进制 `formatTokens`、ceil 百分比钳 [0,100]、`'request/context'` 活窗口拾取 + 模型切换撤回降级 `ctx N`、`text` 档 priority 20 右对齐 band 2）。导出三处同步（package exports/files/tsdown 增 `./status-cwd`、`./status-tips`）。bundle——patch 增 `blue-status-cwd`/`blue-status-tips` 两行（四条 status 行注释同步 v2 语义）；MockAdapter 第 4 参 `defaultContextWindow` → `resolveModel().context`（`'request/context'` 事件链由此走通）。e2e——三档色锚成文（`FOOTER_TEXT_SGR` #e0e0e0 / `FOOTER_MUTED_SGR` #888888 / `FOOTER_TEXTMUTED_SGR` #6b6b6b）；dock 序锚 `mock · idle` → `` `${TEXT_SGR}mock` ``（banner 的 `mock · mock` 走 muted 档，不冲突）；git 用例改注入 `setGitCommandRunner` 合成 `e2e-branch [+7 -2 ↑2]`；context 用例断 `context: 52% (4.1k/8k)` 右贴 row 2；新增 band-1 布局用例（stripped 行 = `mock␣␣{shortenCwd(process.cwd())}␣␣badge` + tip 右贴——cwd 期望现算，checkout 无关）与窄宽让位用例（边界宽度按 cwd 长度 + primary tip 长度现算；教训：`fullFrame` 以 +1 列强制重绘，设界须差 2 列）；`mock · running` 翻转用例改判 footer 全 turn 稳定（agent-status 移除后该职责归 spinner）；downstream 条目用例先拉宽 200——真实脏 worktree 徽章长，80 列把低优先左槽挤出 band 是注册契约行为非回归。单测教训两条：fake clock 起点须远于 TTL（缓存槽 `fetchedAt` 起始 0）；git 缓存探测惰性于 render，断言 cwd 前先 render。821 tests / 59 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。**Dogfood 第二轮（2026-08-20）**：v2 footer 本体过审，但编辑框下多出一行常驻按键提示 `! bash · / commands · @ files · ctrl+s steer · ctrl+v paste image · ctrl+c exit`（S11 的 persistent tier）——kimi 无此行，其教学职能由 footer 右侧轮换 tips 承担（kimi 实机即 `! to run a shell command | /compact ...`）。用户裁定删掉：interaction——`HintLine` 撤 persistent 分支（仅瞬态通知/斜杠发现，其余渲染零行）、`hint-content.ts` 连 spec 删除、`agent/status` 订阅随之退役（session-changed 保留——斜杠发现要按新 agent 重算）、editor-plus/editor-instance 注释去掉 hint 门控措辞；e2e 圆角框用例改断言片段不存在（`! bash · / commands`/`ctrl+c exit`/`ctrl+s steer`——与 tips 文案 `ctrl+s to steer` 无碰撞）；input-plugin 规格改判 idle/running 均零行。811 tests / 58 files，coverage/typecheck/lint 全绿。

- transcript：`BlueStatusEntry` 增可选 `align: 'left' | 'right'` 与 `row: 1 | 2`（默认 left/1，additive）；`FooterShellComponent` 两行布局（右对齐簇）；新子路径插件 `./status-tips`（10s 轮换、可替换定时器——pane-activity 先例；文案模块 `tips-content.ts` 独立，S16 banner 复用）；`status-context` 升级 `context: N% (K/M)`——max-context 来源经 adapter `resolveModel().context` 的 `'request/context'` 事件（无来源时降级现 `ctx N`，文档显式标注降级路径）；cwd 条目 `…/末3段` 缩写（kimi `shortenCwd` 移植，独立小插件 `./status-cwd`）。
- 验收：L1 左状态右 tips 轮换；L2 右 context 百分比（或降级形态）；窄宽度 tips 让位（现有丢弃规则延伸）。

### S16 — 欢迎页 + spinner + 符号收尾 ✅（2026-08-20 落地，瘦身后小步）

**Step log（2026-08-20）**：**kimi 调研前置**：kimi 的 `banner/` 模块是远程 tips 横幅机（URL 拉取 + semver 门控 + once/cooldown 展示态持久化，`banner-provider.ts`/`state.ts`）——Blue 不做远程内容，不移植；其 welcome 组件（`chrome/welcome.ts`）无 tips（教学在 footer `ALL_TIPS` 轮换与 working spinner），Blue 的两栏布局是自家 Claude-Code 式设计（S8/D 决策维持），本期只填真实内容。`← current` 参照 kimi `constant/symbols.ts`（`SELECT_POINTER`/`CURRENT_MARK`）与 choice-picker/model-selector 的用法（badge 尾随、success 色——Blue 侧维持 S12 的行级着色裁定，只统一符号词汇，不改色）。transcript——`banner-content.ts`：`BANNER_TIPS.lines` 改为**从 S15 `tips-content.ts` 派生**（非 solo + 权重降序 + 池序 tiebreak，取前 5——solo 长文案为 footer 全宽槽位而写，栏内只余截断残句，故排除；权重语义与 footer SWRR 轮换共享："重要/新特性更多曝光"），两表面共享单一内容源；what's-new 换真实编辑文案三条（footer v2/`/btw`/图片粘贴——S8 占位含已过期的 "pixel castle" 一并清除）；5 tips + 3 what's-new 恰好填满右栏 11 个正文行（与左栏等高，banner 维持 13 行）。spec 钉住：派生五条的精确文本 + 不变量（全部来自池、无 solo、权重序）+ 右栏行 ≤52 列（100 列默认渲染预算）。**v2 token 复审**：banner 七个样式槽逐一过 §4.2——frame/title/strong/logo/accent/muted/text 全部符合 v2 语义（框/鲸鱼/欢迎行 `primary`=kimi 蓝盒手法、模型行 `accent` 为 Blue 层级保留、标题/正文标签 `muted`、节标题 `text`），**零映射变更**，色值经 S10 校准的主题表自然流动；banner-art 黄金 spec 未动（位图零变化，本期无任何色映射改动故 spec 无需改）。模块头"51 列"硬编码预算措辞改为随活宽度派生的公式（`width − 47 − 1`）。interaction——新模块 `src/symbols.ts`（kimi `constant/symbols.ts` 移植，包内作用域）：`SELECT_POINTER`/`CURRENT_MARK`；`select.ts` 两处 `❯ ` 前缀与 SessionList 徽章改用常量（行为零变化）；`theme-switch.ts` `/theme` 列表 `(current)` 后缀 → `← current`（与 /sessions 徽章同词汇；core 的 `❯` 光标绘与 transcript 的用户 gutter 各自保留——后者 S18 退役）。e2e——banner 用例加真实 tip 锚（`! to run a shell command`，24 列在 80 列终端右栏 32 列预算内存活整条），修掉过期的"61 wide"注释。813 tests / 58 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。

**Dogfood 第二轮（2026-08-20，用户两项反馈）**：(1) **`/theme` Up 召回编辑器错乱**——根因：pi-tui 聚焦编辑器在光标前发射零宽 APC 硬件光标标记 `\x1b_pi:c\x07`（IME 定位用，渲染前由 renderer 剥离），Blue 的 chrome 纯函数只跳过 SGR 序列，标记被当成 7 个可见字符；Up 召回把光标放在文本首字符上（inverse 字形而非 inverse 空格），`injectGhostHint` 的"光标后全是 padding"守卫整体跳过，`visibleIndexToRaw(4+textLength)` 落进标记中间，影子文本+空格**吃掉召回文本与光标**。kimi 解法核实（`custom-editor.ts` `computeArgumentHint`）：**源头光标门禁**——光标必须在第一行行尾才计算 hint（`line !== 0` 或 `col !== currentLine.length` 即 undefined），行数学的 raw-index 路径在 kimi 恒不可达。Blue 补齐同一门禁：core `EditorAdapter` 增 `cursorAtInputEnd()`（读 pi-tui `getCursor()`/`getLines()`），ghost 注入前判定；红验证过（门禁关闭时新 spec 失败），多行光标分支同补。kimi 的 `stripSgr` 同样只处理 SGR——不加固行数学、只做门禁是两侧一致的选择。(2) **对话框打开时编辑器应隐藏**（D30，修订 D26 锚定手法）——浮层 `offsetY: -2` 只让出 footer，编辑器框在面板与 footer 之间露出（e2e 帧 dump 证实）；kimi 全部对话框走 `mountEditorReplacement`（editorContainer 换子，编辑器离树但状态存活）。移植：`editor-instance` 开 `EditorSlotSwap` 缝，blue-input 实现栈式替换（面板入栈摘 editor+hint、弹空恢复还焦，fiber 卸载随树下架未关面板），四个调用点（/sessions、/help、approval、questionnaire）改走替换、浮层锚定参数退役；替换面板在 dock 真实占位、其下只有 footer，framePanel 观感不变。已知边界转 S17：对话框挂起时 pane-activity 仍悬在面板上方、btw 拼接指向离树编辑器（kimi 此时 activity pane 亦隐藏）。e2e 两条新锚：面板打开时编辑器框 SGR（`38;2;90;90;90`）整帧缺席、Escape 后回归；/theme 召回帧含 `theme` 且无 `[dark|light`。**连带测试考古**：banner 真实 tips 使 e2e 既有 `/help`/`/sessions` waitFor 锚被横幅文案**瞬时假满足**（同步语义破坏，全套负载下才显形）——锚改下拉专属文本（`→ /sessions` 指针行、`Show available commands` 描述行）；召回用例收尾补 `clearDraft()`（模块级草稿 stash 不随 tree dispose 清除，泄漏进下一用例编辑器把 follow-up 变斜杠命令）。824 tests / 58 files，coverage（逐文件 100%）/typecheck/lint 全绿。

- transcript：banner 右栏换真实 tips（源 = S15 `tips-content.ts`）+ v2 token 复审（banner-art 黄金 spec 只动色不动位图）；spinner 帧可配置（**默认保持 braille**——月亮 emoji 宽度 2 在宽度数学上是风险项，作可选项记录于 §8）；`✓/✗`（工具完成/失败）、`← current`（model/theme 选择器未来用）等符号清扫；工具卡首次折叠时 `ctrl+o to expand` 就地提示。
- 验收：启动页右栏为真实教学内容；全树符号一致。

**瘦身（2026-08-20，随 S17-S21 会话流立项重划）**：§2.6 调研立项后，本步三个 bullet 迁出——spinner 帧与 working tips 迁 **S17**（braille/moon 帧常量与轮换 tip 随活动模式机落地，§8 月亮判定随此修订）；`✓/✗` 符号清扫与工具卡首折 `ctrl+o to expand` 提示迁 **S20**（工具卡 kimi 折叠一并做，避免同一卡片两期翻搅）。本步保留：banner 右栏真实 tips + v2 token 复审 + `← current` 标注。编号稳定不回收。

### S17 — 思维链组件 + 活动模式机

**为什么在会话流五期中最先**：思维链是会话流中注视面积最大、与 kimi 反差最强的表面；折叠基建（`setExpanded` 集合、finalize 语义）与活动模式机是 S18-S20 组件的挂载底座。

- transcript：新建 `thinking.ts` `ThinkingComponent`（kimi 同构）：`live` = 空行 + braille spinner @80ms（可替换 timers + `requestRender`——pane-activity/tips 先例）+ `thinking...`（muted 层）+ **尾部 2 行**滚动（`THINKING_PREVIEW_LINES = 2`，常量随组件落 transcript，`RESULT_SUMMARY_MAX_CHARS` 先例）；`finalized` = 空行 + `● ` muted + italic muted 正文，>2 行折叠**前 2 行** + textMuted `... (N more lines, ctrl+o to expand)`；`setExpanded`/`finalize`/`dispose`。fold 把 reasoning 从 assistant item 拆出独立挂载，`assistant/message` 终稿时原地 finalize 不换组件；**快照回放一律 finalized**（D16：replay 与 live 收敛结果一致）。
- transcript：`pane-activity.ts` 改造为模式机 `hidden | waiting | thinking | composing | tool | idle`（kimi `resolveActivityPaneMode` 同构）：waiting/tool = **moon spinner** @120ms + 轮换 tip（复用 S15 `tips-content.ts`，kimi working-tips 语义）+ 重试 dim 明细行（`RETRY_DETAIL_MAX_CHARS = 160` 截断，按 harness 事件面裁剪）；thinking = **清空 pane**（spinner 归 thinking 块）；composing = braille `working...`（primary）；idle = 停转但留 1 行占位防视口跳。braille/moon 帧常量从 pane-activity 内联提取为共享常量（月亮宽度 2 显式计入行宽数学）。状态源 = fold 的 streaming 阶段（唯一事实源，不另立状态）。
- transcript：ctrl+o 的 `CollapseToggle` 组件集合纳入 thinking 组件（interaction 无键位变化）。
- bundle e2e：live 尾随 2 行（delta 后断言尾部窗口）、finalize 折叠 + hint、ctrl+o 展开、模式机各态（waiting moon / thinking 空 / composing braille / tool）、resume 回放全 finalized。
- 风险：现有 reasoning 内联断言全量重写（components.spec + e2e streamed/markdown 用例）；spinner 定时器与 perf.spec 基准交互（perf 用例冻结帧序）；同 step 的 thinking/正文混排呈现顺序（kimi：thinking 块在正文块前）。
- 验收：一轮真实对话——思考中尾部 2 行滚动 + activity pane 空；正文开始流式时 pane 转 braille `working...`；turn 结束 thinking 折叠 2 行 + hint，ctrl+o 展开。

### S18 — 用户回显 + 助手消息 chrome

- transcript：`UserMessageComponent` —— `✨ `（USER_MESSAGE_BULLET 入符号常量）`boldFg(roleUser)` + **全文 boldFg(roleUser)**；续行以 bullet 可见宽对齐；图片缩进同宽。`AssistantMessageComponent` —— 行首空行 + `● `（`text` 色）bullet + 正文 `MESSAGE_INDENT = '  '`（2 列）缩进。step-summary 措辞顺带对齐 kimi（`… thinking N times, called M tools`，dogfood 定）。
- bundle e2e：`❯` 锚与 continuation 2 空格锚更新；助手 bullet + 缩进锚。
- 风险：bold 是 SGR 包裹不改宽度（spec 钉住即可）；`❯` 从用户回显退役不影响 /sessions 指针（不同表面、各自常量）。
- 验收：输入回显整块琥珀粗体（含换行续行对齐）；助手回复带 `●` 行首 + 2 列缩进。

### S19 — 注入上下文默认隐藏（D28）

- transcript fold：`case 'user/message'` 读 `event.data.source`——有 source（合成：agent-instructions/plugin/notice/relay/recall 等 ContextFormed 词汇）→ **不产出条目**（零呈现、零占位）；`source === undefined` → 人类输入照常。快照回放同规则（D16）。
- 边界：与 S13 `todo_write` 抑制正交（一边按消息来源、一边按工具名）；step-summary 与窗口计数不感知被隐藏消息（fold 层已消化）；若 dogfood 发现某类合成消息需可见（如文件变更通知），按 `source.form` 单独加 dim 单行，**不改默认隐藏**（D28 预留路径）。
- bundle e2e：含 AGENTS.md 注入的会话流零呈现；resume 回放一致；人类输入不受影响。
- 验收：真实 `dsh --profile blue-s19` 在带 AGENTS.md 的仓库发起对话，会话流只见用户输入与助手内容。

### S20 — 工具卡 kimi 折叠

- transcript（`components.ts` + intents）：卡片头三态——运行**实心** `● `（`text` 色，消空心→实心闪烁）、成功 `✓`（success）、失败 `✗ `（error）；标签 `Using/Used ToolName (key-arg)`（动词 + 工具名 bold primary + 首个关键参数作 key-arg，白名单取参：file_path/command/pattern 优先，未命中取首个短参数兜底）；Bash 卡纯标签 `Running a command`/`Ran a command`（参数进正文预览）；MCP 类 `toolName · MCP/server` dim 后缀；` · N lines` dim chip。
- 预览层级：折叠态结果 **3 行**（`RESULT_PREVIEW_LINES`）+ dim 提示 `... (N more lines, M total, ctrl+o to expand)`；Write/Edit 类新参/旧串预览带 dim 行号（`    N  `）上限 **10 行**（`COMMAND_PREVIEW_LINES`）；intent-diff/intent-terminal 既有上限与之对齐复查；`⎿` 连接符去留随 dogfood（kimi 无此符号，预览行直接缩进）。
- ctrl+o 范围：由全量翻转改为**最近 3 个 turn**（按挂载位置判定——最近 3 个 turn 边界之后的组件才翻，kimi `toggleToolOutputExpansion` 语义；`CollapseToggle` 会话切换重置语义不变）。
- Read 分组：同 step ≥2 个 Read 调用折叠为 `● Read N files · L lines` + `  ├─/└─ path · N lines` 树（kimi `read-group` 移植，挂 fold 的 step 聚合处）。体量若超一期，拆两轮 dogfood：前半（卡片头/预览/ctrl+o 范围）+ 后半（Read 分组 + shell 呈现）。
- shell 呈现：terminal 卡对齐 `shell-execution.ts`——`$ ` shellMode + 命令 textDim + 输出 textMuted（S13 已定妆 `!` echo，本轮统一工具卡侧观感一致）。
- bundle e2e：三态卡、动词标签、3/10 行预览、hint、ctrl+o 最近 3 turn（第 4 个旧 turn 不展开）、Read 分组树、Bash 纯标签。
- 验收：一轮多工具对话的工具区与 kimi 并排目测一致；ctrl+o 只影响近 3 turn。

### S21 — 全局 1 列 gutter（定妆 reflow，D29）

- core/transcript：消费 `padColumns`——transcript 条目、panes（btw/todo/activity/queue）、footer 左右各内收 1 列；实现位在**挂载层统一包装**（组件自身无感知，宽度按 `width-2` 下发）；编辑框贴 0 列不动（kimi"边框是视觉锚"）；banner 同步内收。
- bundle：全量 e2e 布局锚 reflow（列偏移类断言为主——S8/S15 教训：锚内容文本不锚色行）；移除 S13「消费显式推迟」注记（本档 §7 S13 step log 与 D25 S13 落地注）及 AGENTS 对应句。
- 风险：一次性全树 reflow——放会话流五期最后，避免中途步骤锚点二次改写；editor/overlay 等满宽组件与新列宽的边缘对齐；FakeTerminal 列数断言全面 +1 偏移。
- 验收：会话流、面板、footer 左缘与编辑框内列对齐成一条竖线；60 列窄终端无折行错位。

## 8. Adopt / Adapt / Reject

| kimi 元素 | 判定 | 说明 |
|---|---|---|
| 编辑框圆角框/提示符/模式标签 | **adopt** | S11，adapter 后处理，无子类化 |
| btw 圆角框 + connectedAbove 拼接 | **adopt** | S13 |
| 对话框底部按键行、审批 `▶`/编号/琥珀 | **adopt** | S12 |
| markdown 映射（粗体标题、`•`、primary 链接/代码） | **adopt** | S10；h1 下划线因 0.84.2 限制 **adapt 掉** |
| cli-highlight 代码着色 | **adopt** | S10，唯一新依赖，降级路径完备 |
| 模糊匹配、描述换行、幽灵提示、斜杠加粗 | **adopt** | S14 |
| footer 轮换 tips | **adapt** | S15 已落地；SWRR 加权 + `' | '` 配对一次到位，10s ticker 为事件驱动渲染的显式心跳（kimi 靠无关重绘刷帧） |
| context 百分比 | **adapt** | S15 已落地；max 来自 adapter `resolveModel().context` 经 `'request/context'`（`agentDefaultModel` 路线已证无元数据），撤回即降级 `ctx N` |
| 月亮 spinner 🌑🌒 | **adapt** | S17 模式机修订：waiting/tool 活动态用 moon（宽度 2 显式计入行宽数学，单行 pane 风险可控），thinking/composing 用 braille；原"默认一律 braille"判定随活动模式机退役 |
| GutterContainer 1 列内收 | **adapt** | 效果 adopt：纯 `padColumns` 等价，S21 启用（D29）；GutterContainer 组件本体仍拒移植（pi-tui 类型越界，D25） |
| working tips（spinner 后附教学） | **adapt** | S17，文案复用 tips 模块 |
| ThinkingComponent 折叠（live 尾随 / 定稿折叠 + ctrl+o） | **adopt** | S17 |
| 合成消息零呈现（注入上下文隐藏） | **adopt** | S19（D28）——harness 注入面对 kimi"模型侧内容不渲染"哲学的对齐 |
| 工具卡动词标签 / 预览层级 / Read 分组树 | **adopt** | S20；`⎿` 连接符去留随 dogfood |
| status_line 自定义命令 | **reject** | kimi 配置体系特定；Blue 用 patch/env |
| 模式徽章（plan/yolo/swarm/goal） | **reject** | ⛔ 上游无 presets/swarm/goal 概念 |
| 渐变文字、/dance 彩蛋 | **reject** | 产品个性，非对齐项 |
| editor-replacement 对话框范式 | **reject** | D19 overlay-only 纪律不动 |
| 居中模态弹窗（S12 首版） | **reject** | 用户否决（D26）：上拉框效果优于弹窗；对话框一律底部上拉面板，例外需显式说明 |
| alt-screen 全屏 | **reject（本文档）** | L0 路线图项，另行立项 |
| Kitty caps-lock 归一化 | **reject** | kimi 对其 pi-tui 报告 bug 的防御；Blue 未报告则不引入 |
| 内联 skill token 高亮 | **reject** | 无 skills 概念；只做斜杠 token |
| 粘贴标记光标处展开 | **reject** | 行为项非视觉项，另行立项 |
| Ctrl-E diff 预览 | **defer P2** | 原 roadmap 项；S12 审批按键行为其预留槽位 |

## 9. 验收与门禁

- **每期门禁**（同 p1-design §7 尾注）：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；ADR（D24 起）+ p1-design step log 行 + roadmap + AGENTS + 双语 README 同步。
- **e2e 锚点纪律**（S8 教训成文）：dock 序/布局断言锚**内容文本**（footer/pane 文字），不锚 border 色行——边框色被 banner/编辑框/工具卡/todo 框共用。
- **dogfood 清单**（每期跑一遍真实 `dsh --profile blue`）：空会话启动观感、一轮含 markdown 回复的对话、`!` 命令、`/` 与 `@` 补全、`/btw`、审批与问卷、`/theme` 四主题轮换 + 换装后状态保持（或文档记录的重置行为）、窄终端（60 列）降级。

## 10. 横切风险（一次记录，各期引用）

1. **EditorAdapter 与 pi-tui 内部**：全部后处理是字符串级的；唯一越界是 S14 `WrappingSelectList` 的单点私有状态 cast——spec 钉 0.84.2 行为，pi-tui 升级时该 spec 先红。
2. **S9 dock sink 交互**：sink 每帧重测底钉块行数，帧行数变化自适配；但框架行数必须确定性（不得有隐藏状态驱动的条件行）。
3. **/theme 热切换**：跨 reload 存活的视觉状态（bash 模式、connectedAbove、幽灵提示、btw 滚动）要么 apply 时重推导、要么文档记录为重置——draft-stash 是补偿先例。
4. **覆盖门禁**：新文件（chrome.ts、hint-content.ts、tips-content.ts、status-tips、WrappingSelectList、highlight 包装）全分支 spec，含全部降级路径（未知语言、无空间容纳幽灵提示、非空格列覆盖保护）。
5. **色值调校**：§4.2 的值是设计稿推演，`border`（#4a5468）等以 S10 实机目测为准微调——调值不构成契约变更，随 S10 提交定稿。
