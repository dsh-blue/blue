# Blue — deepseek-harness TUI 实现路线图

> **仓库形态（2026-08-21 更新）**：Blue 是独立仓库（`blue/` 目录，产品名 blue），以 npm registry 版本依赖 harness（`@deepseek-ai/*@0.1.1-rc.1` 钉版——2026-08-21 随 S26 自 0.1.0-rc.7 迁移，跟随其 prerelease 节奏升级），经 `dsh plugin --profile blue add @dsh-blue/blue` 挂载为 profile。harness 的 pre-release API 破坏风险由"钉版本 + 升级时适配"承担，与 roadmap 风险登记一致。

> 产品名：**Blue**（deepseek-harness 的官方 TUI surface）
> 技术底座：`@earendil-works/pi-tui`（渲染/输入）+ Cordis 插件树（组合/生命周期）
> 架构分层：L0 pi-tui 适配层 · L1 内核服务 · L2 交互 providers · L3 渲染插件 · L4 组合层
> 启动形态：`dsh --profile blue`
> **P1 设计定稿**：[blue-p1-design.md](./history/blue-p1-design.md)（层职责重排、缝清单、kimi-code 能力对照、S0-S8 实施序）
> **P2 视觉设计定稿**：[blue-p2-visual-design.md](./history/blue-p2-visual-design.md)（kimi-code 观感对齐、主题契约 v2、chrome 辅助层、S10-S21 实施序）

## 命名约定

- 产品/Profile/Bundle 名：`blue`
- 包名（仓库内，遵守 `@deepseek-ai/dsh-*` 命名约定）：
  - `@dsh-blue/blue-core` — L0 + L1（pi-tui 适配 + 三个内核服务）
  - `@dsh-blue/blue-interaction` — L2（输入、命令、审批、提问 providers）
  - `@dsh-blue/blue-transcript` — L3（会话渲染、工具呈现、投影组件、状态栏）
  - `@dsh-blue/blue-app` — L4（startup provider + 主 app 插件）
  - `@deepseek-ai/dsh-bundle-blue` — bundle 定义（cordis.patch.yml，骑在 `dsh-base` 上）
- 目录建议：`packages/blue/{core,interaction,transcript,app}` + `packages/bundle/blue`

## 总原则

1. **每个阶段结束都是一棵可启动、可验收的插件树**——不留半成品分支。
2. **核心（L0/L1）的接口在 MVP 就定稿**，后续阶段只加 L2/L3 插件，不改核心签名。
3. 渲染铁律：`session/event` → 组件子树 → `requestRender()`，单向数据流。
4. 能力铁律：需要 harness 新能力时先在上游做能力缝，Blue 只消费文档化 surface。
5. 纪律红线：焦点只经 `tuiScreen.setFocus`；键位一律注册进 keymap；弹窗只走 `showOverlay`。
6. 对话框一律**底部上拉面板**（D26）：全宽 + `bottom-center` 锚定 + 让出 footer 两行，经 `framePanel` 渲染；除非特别说明，不用居中式弹窗。

---

## Phase 0 — MVP：能跑通完整一轮对话的最小 TUI

**目标**：`dsh --profile blue` 启动后，可以输入 prompt、看到流式 Markdown 回复、看到工具调用、处理审批和提问、`/quit` 退出。终端崩溃时能恢复 raw mode。

### 范围

**L0 + L1（`dsh-blue-core`，唯一 import pi-tui 的包）**

- `ProcessTerminal` + `TuiMainScreen`（MVP 只做主屏模式，alt-screen 进 Phase 1）
- 生命周期绑定 fiber：`ctx.effect(() => () => tui.stop())`；接 `installFailLoud(binName, proc, release)` 恢复终端
- Proxy 稳定 TUI 引用（为 Phase 1 渲染器热切换预留，MVP 不实现切换）
- 三个内核服务，签名定稿：
  - `ctx.blueScreen` — addChild/removeChild/setFocus/showOverlay/requestRender
  - `ctx.blueTheme` — 语义色表（`(text) => string` 函数注入，MVP 内置一套暗色，无切换）
  - `ctx.blueKeymap` — 包装 pi-tui `KeybindingsManager`（MVP 用默认键位表）

**L2（`dsh-blue-interaction`）**

- input 插件：pi-tui `Editor` + `CombinedAutocompleteProvider`（slash 来自 `ctx.commands`）→ `agent.followup()`
- commands 插件：注册 `/quit`（走 `appExit`）、`/resume <id>`
- UserQuestionProvider：`ctx.userQuestions.registerProvider()`，`SelectList`/自由输入 overlay
- approval answerer：`ctx.on('approval/request')` waterfall → 确认弹窗

**L3（`dsh-blue-transcript`）**

- transcript 插件：`session/event` → user `Text` / assistant 流式 `Markdown`（增量 setText + 缓存）
- 工具呈现：只实现 `generic` intent（其余原样文本回退）
- 状态栏：`TruncatedText` 单行，显示 model + `agent/status`

**L4（`dsh-blue-app` + bundle）**

- startup provider（inject `cmdlineArgs`，解析 `--resume`）+ 主插件（inject `agents/sessions`）
- `cordis.patch.yml` 骑 `dsh-base` + profile 模板

### 验收标准

- `dsh --profile blue "帮我看下这个目录结构"`：流式 Markdown 渲染正常，CJK 宽度不错位
- 触发写文件工具 → 审批弹窗 → 允许/拒绝均正确回传
- agent 调用 ask-user 工具 → 提问 overlay → 答案回传，对话继续
- `/quit` 退出后终端完全恢复；`kill -9` 之外的所有异常路径经 `installFailLoud` 恢复终端
- `--resume <sessionId>` 能从 session log 重建 transcript
- 核心包零 import 任何 harness package-internal 模块（lint 检查）

### 明确不做（防 scope creep）

alt-screen、主题切换、自定义键位、steer/cancel 的 UI、diff/terminal 呈现、投影组件、图片。

---

## Phase 1 — 交互完整性：达到"日常可用"

**目标**：覆盖交互式 coding agent 的基本操控面；以 kimi-code 为参照系（非视觉复刻）落地核心 UX；本阶段是缝的主要开窗期。
**设计定稿**：[blue-p1-design.md](./history/blue-p1-design.md)。本节只保留摘要，实施细节、契约草样与逐项对照以该文档为准。

- **plain-first 纪律**（D21）：每个表面 = 缝 + plain 默认实现；Blue 自家增强经自家缝注册，与下游同权；基线 patch 拔掉增强行后仍完整可用
- **一次性层职责重排**（D17-D20，边界见 p1-design §1.2）：`blueTheme` 拆为契约 + provider 插件；`ctx.blueComponents` 组件工厂缝落地，MVP 期自研件（`BlueInput`/`markdown.ts`/`width.ts`）退役；`BlueSemanticColors` 全量化为 26 token
- **主题**：dark/light/auto/custom 插件族 + `/theme` provider 换装；OSC 11 探测归 L0（raw mode 前查询）
- **键位**：全局动作经 `BlueKeyAction.handler` + L0 全局分发器（Ctrl-O 折叠等）；编辑器语境动作（Esc/Ctrl-C 中断、Ctrl-S steer）经组件内 `matches`
- **编辑器**：换装 pi-tui Editor（多行/历史/kill-ring/补全/Kitty 解码）；shell 模式（`!`）、`@` 文件补全、slash 补全菜单
- **状态栏**：`ctx.blueStatus` 注册表 + 两行 footer 壳 + git/context/basic 条目插件
- **面板与命令**：activity/queue/todo/btw pane 插件；`/sessions` `/fork` `/new` `/help` `/btw`；审批四选项 + session 级继承（Blue 侧协调器）；提问多题 tab 化
- **welcome banner**：启动欢迎横幅（像素鲸鱼 logo + 模型/cwd 信息 + Tips 右栏，铺满全宽；`blue-banner` 基线段行）（✅ S8 已落地，S10 期间重排：全宽三段布局 + 鲸鱼缩小 30%）
- **alt-screen**：`TuiAltScreen` 与主屏运行时热切换（兑现 L0 的 Proxy 预埋）（⏸️ 暂缓 2026-08-20：暂不考虑实现 TuiAltScreen，主屏为当前唯一运行形态；Proxy 预埋保留，主屏滚动冲突按已知边界接受，解除暂缓时按 p2-visual §7 六轮注记重启立项）

**验收**：连续 30 分钟真实 coding 会话无渲染错乱、无焦点丢失；主题热切换后 transcript 经快照正确重放且编辑器草稿保留；`/btw` 在 agent 运行中插入旁白且 transcript 正确呈现；plain 基线完整可用；注册冲突在启动期暴露。

---

## Phase 2 — 表现力：呈现密度与性能

**目标**：工具呈现结构化、长会话性能达标、富媒体进入。状态栏/主题/键位已在 P1 落地，本阶段聚焦"内容呈现"。**视觉/UX 打磨工作流**（[blue-p2-visual-design.md](./history/blue-p2-visual-design.md)，S10-S21）在本阶段立项：主题契约 v2（+`primary`/`textMuted`）、共享 chrome 辅助层、对话框/面板/补全/footer 的观感对齐与常驻按键提示，按视觉影响排序推进（✅ S10 已落地：主题契约 v2 28 token + 消息流/markdown 升级；✅ S11 已落地：编辑框圆角框/提示符/语境变色 + 常驻按键提示行，chrome 辅助层缝随期开出；✅ S12 已落地：对话框 chrome 统一——审批琥珀框/编号选项、问卷 `(○)/(✓)` tab、/help 双列滚动窗、/sessions 列表框 + `← current`、BlueSelect 选中行 selectedBg，framePanel/hintRow 随期开出；✅ S13 已落地：pane 边框 + dock 拼接——/btw 圆角框（边框内标题 + fitBodyLines 尾随/手动滚动 + Esc/↑↓ 编辑器链路由）与编辑框 `├┤` 拼接、todo topRule 框、shell echo 与 terminal 卡 kimi dim 定妆，topRule/padColumns 与 blueScreen.rows 契约随期开出，'blue/editor-connected-above'/'blue/btw-command' 事件通道落地；✅ S14 已落地：补全与列表打磨——斜杠/`@` 补全模糊化（slash-filter 共用匹配语义）、下拉描述 2 行 wrap + 参数幽灵提示 + 行首斜杠 token 加粗、Enter 接受并提交，fuzzy 重导出与 WrappingSelectList 随期开出；✅ S15 已落地：Footer v2（D27）——两空格 slot + 三档灰阶（model/context=text、cwd/git=muted、tips=textMuted）、agent-status 移除、git 全量徽章 `branch [+N -M ↑a↓b]`（TTL 缓存惰性刷新）、tips SWRR 轮换 + `' | '` 配对（10s ticker）、context 百分比 `context: N% (K/M)`（1024 进制，`'request/context'` 撤回降级 `ctx N`），`row`/`align` 条目缝与 `./status-cwd`/`./status-tips` 子路径随期开出）。**会话流对齐立项（2026-08-20，p2-visual §2.6/§7，S16-S21 排期）**：✅ S16 已落地（瘦身后小步）——banner 右栏真实 tips（自 S15 `tips-content.ts` 派生：非 solo、权重降序取 5，与 footer 轮换共享内容源；what's-new 真实文案三条，5+3 恰满右栏 11 行）+ banner v2 token 复审（七槽零映射变更，banner-art 黄金 spec 未动）+ `← current` 符号清扫（`/theme` 列表弃 `(current)`，interaction 新增 `symbols.ts` 常量模块，kimi `constant/symbols.ts` 移植）；spinner 帧与 working tips 迁 S17、`✓/✗` 清扫与首折提示迁 S20（迁出项见 p2-visual §7 S16 瘦身注）。**Dogfood 二轮（同期）**：影子提示光标门禁（kimi `computeArgumentHint` 补齐——Up 召回光标在行首时 APC 硬件光标标记使 SGR-only 行数学错位、ghost 吃掉召回文本）+ 对话框挂载改 **editor 槽位替换**（D30 修订 D26 锚定手法：kimi `mountEditorReplacement` 移植，`EditorSlotSwap` 缝 + 栈式替换，编辑器对话框期间离树、面板下方只有 footer；四个调用点全部改走替换）；✅ **S17 已落地（2026-08-20）**：思维链组件（`thinking.ts` kimi 同构——live 尾部 2 行滚动 + braille spinner @80ms、终稿原地折叠前 2 行 + ctrl+o 提示、空白终稿零行；fold 把 reasoning 拆出独立 `thinking` 条目，`apply` 升维返回挂载序 update 数组，快照回放一律 finalized）+ 活动模式机（`pane-activity` 改 `hidden|waiting|thinking|composing|tool|idle`：waiting/tool=moon @120ms + SWRR 轮换 tip、thinking 空、composing=braille `working...` + tip（kimi 全量对齐——二轮裁定恢复首轮删除）、idle 一行占位恒显（kimi Spacer 无棘轮）；phase 状态源 = `src/phase.ts` `StreamingPhaseTracker` 纯状态机，attach 时以快照播种；重试明细行按 rc.7 事件面整行裁剪）+ 对话框挂起收口（core 新事件 `'blue/editor-slot-swapped'`，blue-input 面板栈迁移时发；pane-activity hidden、pane-btw 拼接重申——S16 两条已知边界闭合；帧常量提取 `src/spinners.ts`）+ 流式 `▌` 光标退役（三轮裁定：kimi 助手块无光标，composing 信号全归 pane；assistant 条目 `streaming` 标志随其唯一消费者一并移除）+ 正文 chrome 提前（四轮裁定：S18 助手半边——`● ` bullet + 2 列缩进 + markdown 内容宽渲染；core `MarkdownAdapter` 分割线满宽后处理，pi-tui 硬 80 列上限适配掉）；✅ S18 已落地（2026-08-20）：用户回显 `✨` bold roleUser bullet + 全文 bold roleUser + 续行/图片按 bullet 可见宽对齐（助手 `●` bullet + 2 列缩进半边已随 S17 四轮裁定提前落地）+ step-summary 措辞 kimi 对齐（`… step N · thinking X times, call Y tools`，foldStep 折叠面扩到 thinking；措辞终态留 dogfood）；✅ S19 注入上下文默认隐藏（D28，合成 source 零呈现——已随 S17 五轮裁定拉前，fold 按 `source.kind !== 'user'` 分拣）；✅ S20 已落地（2026-08-20）：工具卡 kimi 折叠（Using/Used 动词标签、3/10 行预览、dim chip、ctrl+o 最近 3 turn、30-step 折叠保留窗口、Read 分组树、shell 呈现、Write 行号预览、Read 默认折叠）；✅ S21 全局 1 列 gutter（D29，S13 `padColumns` 推迟项消费，定妆 reflow——已随 S17 五轮裁定拉前：core `GutterComponent` 挂载层统一包装）。

- **render intent 注册表**（`ctx.blueIntents`）：`diff` / `terminal` 呈现器落地，generic 呈现降级为第一个注册者（✅ S7 已落地）
- **transcript 性能（滑动窗口）**：保留最近 N turn，旧 turn 组件与条目整体销毁；turn 内旧 step 折叠为摘要行；渲染缓存策略固化（✅ S7 已落地窗口+step 折叠）
- **图片**：Editor 粘贴图片（L0 `createImage` + 剪贴板工具 + `dsh-attachment` 借力）、`@` 附件（✅ S7 已落地粘贴路径：`blue-attachments` + `blue-paste-image`；✅ S22 已落地 `@` 附件——语义层纯文本 mention（D31，kimi 同构：补全插 `@路径` 文本、提交零解析、模型自助 read/read_image，结构化附件经调研否决——harness 无 FileBlock 且 DeepSeek 路由 text-only 会毁 turn），体验层 kimi 全量对齐：core `createFileMentionProvider`（上游 0.84.2 同源 fd 管线：scoped query/子串打分/top-20/引号值/目录下钻 reopen 钩子）+ interaction `file-mention.ts`（fd PATH 探测 + fs fallback 2000/50））
- **弹窗体系完整化**：model selector、审批 diff 全屏预览（100% overlay）（⏸️ 暂缓 2026-08-20：暂不做，尚未调研清楚——交互形态与参照系对照待调研后再立项）、permission preset 选择器面板（✅ **S24b 已落地 2026-08-21**——上游 `/permission` 命令随 base 零实现，Blue 面板经裸命令输入层拦截开 `SelectListPanel`，服务读 `ctx.permissionPresets`、提交 `/permission <name>` 同一写路径、danger typed-y gate；随期沉淀共享单选列表组件 `select-list.ts` 并回迁 /sessions、/provider、BlueSelect；plan-review 专用呈现（kimi approval 形态：plan 边框盒 + 编号列表 Approve/Reject/Revise，Revise 行内联反馈输入，§7 #5 顺延项）同批落地）
- **外部编辑器**（Ctrl-G）（✅ 排期 **S31**（2026-08-21 裁决做进预览版）：L0 组合既有原语开缝 `blueScreen.suspend(fn)`——pi-tui 0.84.2 已有 `TUI.stop({preserveScreen})/start()/renderNow(force)`（tui.d.ts:140-164），非从零造路径；$VISUAL/$EDITOR 子进程 inherit + 返回全帧重绘，kimi `external-editor.ts` 同构；挂起期停 ticker、resize/信号/`:cq` 异常路径）
- **OSC 8 可点链接、鼠标滚轮/文本选择**（alt-screen，维持门控）
- **OSC 52 复制**（✅ **S26 已落地 2026-08-21**——`core/src/terminal-escape.ts` 纯转义写出，`/copy` OSC 52 先行 + 平台工具验证路径，SSH/无工具环境回退 unverified 报告；原 alt-screen 门控系连坐——OSC 52 不渲染任何内容，与 scrollback/差分渲染无关，`tmux` 内经 DCS passthrough 包装）
- **模式命令**（`/yolo` `/plan` `/compact` `/model` 会话中切换）：随上游能力缝落地逐个接入（实施清单已定稿：[blue-commands-plan.md](./blue-commands-plan.md) 2026-08-20——批次 1 纯 Blue 侧零上游依赖可先行，⛔ 项随缝接入）（✅ 2026-08-20 命令别名机制先行落地：`/quit` 别名 `/q` `/exit`，kimi 式执行时解析，机制见 blue-commands-plan §2.12；✅ 2026-08-20 **S23 模型族落地（2026-08-21 合并 master，含 14 轮 dogfood）**：`blueSession.modelRef` 缝（getter 三级优先——会话内切换 > 日志 header > 进程默认，顺带修复 resume 切回默认模型的缺陷）+ `/model`（kimi tabbed-selector 版式：type-to-search、provider tab 条、ctx 元数据、底部 thinking 段控件）/`/effort`（水平分段，`thinking` 别名）/`/provider`（配置流——Enter 编辑/删除（Ctrl+D y 确认）+ Add Provider 向导：协议感知 base URL、多候选 discovery、models.dev 元数据匹配、defaults 表单、列举失败回表单重试（分类 cause 链 error 红）——settings.mutate 写 llm-pi-ai profile + credentials.set 存 key，用户裁决拉入本期）；Alt+S session-only 通道 kimi 全语义；参数补全 deferred、面板搜索已落；**2026-08-21 四裁决 D33-D36**：`/permission` 选择器面板（✅ S24b 已落地 2026-08-21——裸命令拦截 + danger gate，plan-review 专用呈现同批）；`/preset`（agent 组合预设，空会话切换——Blue bundle 加 agent-presets 行）与 `/mcp`（只读列举——bundle 带 dsh-mcp-client 依赖）排 S28；`#` skills 提示符 + `/skills` 列表排 S29（技能不进 slash 命名空间，调用走上游手势路径）；用户自建命令 = 技能文件，不做独立机制；✅ 2026-08-21 **S25 会话信息落地**：`/status` `/context`（原 `/usage`，用户裁决按 CC 语义更名——注入显隐开关需另取名）/`/version`——`InfoPanel` 两列只读面板（kimi usage/status 报告形态 × /help 版式，`█░` 严重级上下文占用条），数字经 `sessionProjections.snapshot` 读 token-meter/session-stats 投影（跨 resume 重放正确），`usage.ts` 薄读层 + `assistant/*` 纯折回退，Blue 不设累计器；同批建立全局版本管控 `transcript/tests/version.spec.ts`——五包 version + `BLUE_VERSION` + 全部 dsh-* 钉版/peer 区间/workspace excludes 必须 lockstep，漂移即红）。**2026-08-21 发版范围修订（用户裁决）**：S26 `/export` `/copy` 已合并 master（含 harness 线 0.1.0-rc.7→0.1.1-rc.1 迁移 + `commands.execute` images 参数适配）；`/hotkeys` 🚫 不做、`/diff` 发版后；注入显隐开关定名 **`/injections`**（原拟 `/context` 已被 S25 占用面板占用）；S29 前置修复 = input 层未注册 `/xxx` miss 回退 `agent.followup`（`#` 手势路径的卡点在 Blue 输入层非上游）；新增 S30-S33 UX 冲刺步（终端小件批 / 外部编辑器 / 大粘贴折叠 / 子 agent 分组卡），详「预览版发版冲刺」节
- 子 agent / Task 工具的树形呈现组件（经 intent 缝）（✅ 排期 **S33 最小分组卡**（2026-08-21 裁决）：同 step ≥2 个 subagent 调用聚合，kimi `agent-group.ts` 同构（phase 计数+尾摘要+节流）；上游 `ctx.subagents` + ctx 事件面 rc.7 已就绪——步首 🔍 核实两源映射：live 走 ctx `subagent/start/end` 事件、resume/replay 走 tool 折面 + `subagent/descriptor` 持久事件（词表只有 descriptor），replay 侧信息不足则降级普通工具卡回放并记边界；活动查看器（/subagents 族）维持发版后）

**验收**：5 万行级 session resume 后滚动流畅；参照系产品的常用交互有对应物或明确的"不做"结论。（2026-08-20 S17 期间 dogfood 实测：主屏模式下输出中移动终端滚动条会导致会话流乱跳——pi-tui 差分渲染的内部视口记账与终端 scrollback 脱节，主屏模式不可修复；“滚动流畅”验收以 **L0 alt-screen 项目**为前提，详见 p2-visual §7 六轮注记。⏸️ 2026-08-20 裁定暂不考虑实现 TuiAltScreen——该条验收随之挂起，主屏滚动冲突接受为已知边界；OSC 8/鼠标等标注 (alt-screen) 的条目维持门控——OSC 52 已随 S26 解连坐落地（纯转义与 scrollback 无关，见上）。）

---

## Phase 3 — 硬化与生态：从"好用"到"可发布"

- **缝冻结**：P1/P2 开出的全部缝（`blueScreen`/`blueKeymap`/`blueComponents`/`blueTerminalInfo`/`blueTheme`/`blueStatus`/`blueIntents`/组合层 + 继承的 harness 缝）逐条过守门评审，签名转入稳定承诺
- 测试体系：`VirtualTerminal`（@xterm/headless）渲染快照测试（届时复审 D13 的 FakeTerminal 决策）+ fake interaction providers 集成测试
- HMR 开发回路：改组件源码热替换（cordis-plugin-hmr）写入开发文档
- 焦点/overlay 协调约定文档化（L1 加 focus 进出事件，核心签名仍不动）
- 文档门禁合规：cordis-surface 生成、doc-sync、子系统文档页
- 文档站：VitePress 双语站点（zh 根路径 / en 子路径，浏览器语言对称分流）发布至 GitHub Pages（`website/`，见 D32）✅（2026-08-20）
- 发布：`dsh plugin add` 路径验证 + 版本钉住策略（跟随 harness prerelease 节奏）
- 验收对照删除 TUI 决策笔记的四条重引入条件逐条核验：具名部署（`--profile blue`）、明确包边界、具体交互 provider、组装级生命周期与 transcript 验收

**预览版执行口径（2026-08-21 裁决，裁剪版）**：0.1.0-rc.1 发版只做——CI 建立（R0）、VirtualTerminal 快照最小集（R2，复审 D13）、npm 发包 + `dsh plugin add` 安装路径验证（R3-R4）、dogfood 记录（R5）、文档站同步（R6）；**缝冻结评审、fake providers 集成测试、HMR 文档、focus/overlay 约定文档四项延至正式版前**（rc 语义下缝允许继续变）。详「预览版发版冲刺」节。

**验收**：CI 全绿 + 文档门禁通过 + 一次完整的 `dsh --profile blue` 真实任务 dogfood 记录。

---

## 预览版发版冲刺（0.1.0-rc.1，2026-08-21 定稿）

> 目标：npm 发包五包 `@dsh-blue/*@0.1.0-rc.1`（**dist-tag 用专用 `rc` 标签，不占 latest**）。范围经 UI/UX 差距三路调研（Blue 代码面盘点 / 仓库文档挂起账本 / kimi·CC·Codex UX 对照）+ 用户两轮裁决定稿。S26 已合并（含 harness 线迁移）；S27'-S29 命令收尾；S30-S33 为裁决新增的 UX 冲刺步；R0-R6 发版段。P3 按上节裁剪版执行。
>
> 调研修正记要：Blue 已有 queue pane（↑ 收回+Ctrl+S steer）、Shift+Tab 三态循环、todo pane、图片粘贴+渲染——竞品对照报告中易误判缺失；真实缺口裁决见下表与挂起区。

### 排期（合并天然串行——人工验收是门禁）

| 步 | 范围 | 档 | 前置 |
|---|---|---|---|
| ✅ M0 | S26 合并（/export /copy + OSC 52 + harness 线 0.1.1-rc.1 迁移，e1b507d） | — | — |
| ✅ R0 | CI 建立（2026-08-21 落地全绿 run 32477151535）：`ci.yml` typecheck→lint→build→test:coverage（push+PR、钉 pnpm、frozen-lockfile；website-only PR 跳过；runner 无 fd 属有意——唯一覆盖 @ 补全 fs fallback 路径的环境。随批三修：interaction tsconfig 补 transcript 项目引用——本地 typecheck 此前靠 lib/ 历史产物假绿；CI 加 pnpm build——spec 经包名入口需 lib/*.js；@ 下钻 e2e 增量帧断言去竞态） | — | — |
| S27' | 轻命令族（✅ 已落地 2026-08-21）：/init（罐头提示写 AGENTS.md + idle 守卫，`session-init.ts`）、/clear（command-meta 一行别名 = /new）；**/injections 🚫 用户裁决不做**（2026-08-21：注入上下文维持 D28 默认隐藏，不开开关——挂起区有条目） | 1d | M0 |
| S28 | 配置与生态（**partial ✅ 2026-08-21**：/tools + /preset 已落地，含**薄宿主迁移**——bundle patch 照 web-app 官方清单 disable dsh-base 23 行 agent 面行 + agent-presets 行 + blue-app 建 agent 挂预设（resume 折 `agent-preset/selected` 事件重建组合，详 D37）；/settings /reload /tasks /mcp 顺延） | 3d+ | S27' |
| S29 | 技能管线：**前置修复**（input-plugin 未注册 `/xxx` miss → 回退 `agent.followup`，独立 e2e 钉住）+ `#` 提示符（复用 @ 分支形态 + `#name→/name` 提交重写）+ /skills | 2d | S27'（dev 可‖S28，合并串行） |
| S30 | 终端小件批：/title + OSC 0/2（core terminal.ts setTitle helper）、模型热键免清空切换（具体键位步内设计，过 keymap 冲突检测）、/sessions type-to-filter（select-list.ts，跨页搜索仍挂起） | 1.5d | S29 |
| S31 | 外部编辑器 Ctrl-G：L0 `blueScreen.suspend(fn)` 缝 + 草稿往返（**播种/回读用 pi-tui `getExpandedText()`**——粘贴标记展开，2026-08-21 核实）+ 异常路径（`:cq` 草稿不丢、无编辑器 notice、挂起期停 ticker、resize 后强制全帧） | 2d | S29 |
| S32 | 大粘贴折叠（**2026-08-21 重定范围**：编辑器半**原生已有**，无需移植——pi-tui Editor 内置 >10 行/>1000 字符折叠为 `[paste #N +M lines]` 标记、`pastes` Map 存全文、`submitValue` 提交前自动 `expandPasteMarkers`（模型收全文已核实）、`getExpandedText()` 公开；此前"需移植 kimi paste-burst"判定系按 fork 文件名查证失误）。**剩余 = transcript 侧**：长用户消息折叠呈现（chip + ctrl+o 展开；transcript 无"是粘贴"元数据，按长度启发式 >N 行折，手打长消息同样受益；排 S33 合并后，同包错峰）；已知小疣：历史召回为展开全文（大粘贴 Up 召回整段进编辑器，记边界不修） | 0.5-1d | S33 |
| S33 | 子 agent 分组卡（**可砍尾**）：同 step ≥2 聚合；步首 🔍 核实 live（ctx 事件）/replay（tool 折+descriptor）两源映射，不足则降级普通工具卡回放记边界 | 2-3d | 无硬前置（dev‖S31/S32，合并殿后） |
| R1 | 钉版复核：发包时点跟最新 harness rc（现 0.1.1-rc.1）；rc.2+ 小 bump 走全量回归；**不追 minor 之上的跳跃** | 0.5d | G1 |
| R2 | 快照最小集：@xterm/headless VirtualTerminal，5-8 例核心帧（banner 首帧 / 对话+工具卡 / footer / 面板挂载 D30 形态 / CJK 宽度）；复审 D13 结论记 blue-decisions | 1-1.5d | G1（**S30 后拍**，键位面冻结） |
| R3 | npm 发包：五包依赖序 core→interaction→transcript→app→bundle；dry-run 核 files/exports 子路径；dist-tag `rc` | 0.5d | G2 |
| R4 | 安装路径验证：干净环境（临时 DSH_HOME）`dsh plugin add @dsh-blue/blue` → 启动冒烟；guide 补 registry 安装路径 | 0.5d | G3 |
| R5 | dogfood 记录：registry 安装（非 dev link）跑一次完整真实任务归档；阻塞项回修重走 R3-R4 | 0.5d | G4 |
| R6a | 文档站同步（⏸️ 用户裁决 2026-08-21 暂缓，仓库侧 R6b 先行）：website commands/keys/features/guide 四页集中还清（S23-S30 全量，`/help` + `keymap.list()` 枚举 diff 为源）+ 挂起区写入 | 1d | R5 + 解除暂缓 |
| R6b | 仓库文档清账+结构重组（✅ 已落地 2026-08-21，本 PR）：五份完成态文档归档 docs/history/（p2-visual §8 两条被推翻行、p1-design §4.3 过期 ⛔/🚫 行随归档 banner 更正）；blue-decisions D33 编号重复勘误重编 D38；OSC 52 推翻注（roadmap 条目拆分 + survey 归档 banner）；AGENTS.md 拆五个包级文件+根瘦身（63.7KB→15.8KB）；docs/README.md 索引 | — | 无（纯仓库侧，不设发版门禁） |

**门禁链**：G1 = S 步全合并 + CI 绿 + harness 线最新 → G2 = 快照绿 → G3 = 发包成功 → G4 = 安装可启动 → **发版声明** = R5 归档 + R6a website build 绿（R6a 暂缓期间发版声明顺延，门禁语义不变）。

**并行组合**：R0‖S27'（零交集）；S28‖S29 开发（commands-plugin/session-commands 交叠，S29 合并前 rebase 一次）；S33‖S31/S32（transcript vs interaction 零交集）。

**总量与裁剪线**：串行 17-21d，关键路径 14-16d（利用并行+验收滚动）。时间不够时砍序 **S33 → S32 → S30**（砍序即价值/成本比序）；R 步与 M0/S27'-S29 不可砍。

### 预览版后挂起区（parked after 0.1.0-rc.1）

| 条目 | 范围 | 理由 | 解除条件 |
|---|---|---|---|
| 通知体系 | bell / OSC 9 桌面通知 / 失焦门控（OSC 1004 焦点跟踪） | 终端通知能力梯度大（tmux/SSH 行为不一），非核心编码回路（2026-08-21 裁决发版后；kimi `terminal-notification.ts` 同构可照抄） | 正式版 UX 评审，与 alt-screen 门控项一并排期 |
| 审批 diff 预览 | 面板内嵌 diff / Ctrl+E 全屏（DiffCardComponent 已备，只差接入审批面板） | 交互形态与参照系对照未调研定稿（⏸️ 维持 2026-08-20 裁定，2026-08-21 复核维持） | 专项调研后立项 |
| live 工具输出流 | 工具执行中流式呈现（尾行跟随+计时；kimi live 运行卡） | ⛔ 上游无工具输出流事件缝（harness 侧可开） | 上游开出 streaming tool output 事件面 |
| /hotkeys | = /help 别名 | 低价值（2026-08-21 裁决不做） | 键位数再增一档时随命令系列补录 |
| /injections | 注入上下文显隐开关（原 S27' 范围项：fold.ts `source.kind` 分拣可开关 + dsh-settings 'blue' 命名空间持久） | 2026-08-21 用户裁决：注入上下文维持 D28/S19 默认隐藏，不开开关 | 真实需求出现再议（届时为 S28 /settings 的首个 'blue' 命名空间消费面） |
| /diff | 未提交变更面板（DiffCardComponent + line-diff.ts 已备） | 2026-08-21 裁决发版后 | rc.1 dogfood 反馈收集后与审批 diff 预览同评 |
| alt-screen 及门控项 | TuiAltScreen / OSC 8 可点链接 / 鼠标滚轮与选择 / transcript 全屏搜索 / 主屏滚动冲突 | 维持 2026-08-20 裁定（OSC 52 已解连坐） | 按 p2-visual §7 六轮注记重启立项 |
| statusline 自定义脚本 | footer 脚本条目（CC statusLine JSON 契约，kimi 已显式镜像） | blueStatus 缝已备，缺脚本宿主与沙箱约定 | 首个真实消费者出现（"首个真实消费者驱动"纪律） |
| Esc-Esc rewind | 会话原地撤销 / checkpoint（CC 双 Esc、kimi undo selector） | ⛔ persistence 无 truncate 原语（commands-plan §7 #2） | 上游落 `session.truncate` 或官方 undo 语义 |
| Ctrl+B 后台化 | 命令/子 agent 后台 + 任务查看器（kimi+CC 都有） | ⛔ harness 无 background 概念（p1 §4.2） | 上游 subagent 服务出现 background/handle 原语 |
| /sessions 跨页搜索 | 跨会话内容搜索（kimi 跨页 drain） | S30 只落当前列表过滤；`ctx.sessionQuery`（SQLite FTS5）上游现成 | 正式版排期（纯工作量项） |
| paste-burst 检测 | 非 bracketed 终端的快速粘贴识别（kimi fork `paste-burst.ts` 61 行） | pi-tui 折叠走 bracketed paste 路径，现代终端普遍支持；纯健壮性边缘项（2026-08-21 裁决砍出 S32） | 无 bracketed paste 环境的实际用户反馈出现 |
| ADR 拆一决议一文件 | blue-decisions.md 按决议拆单文件 + 索引 | 单文件尚可读，收益在检索与 diff 隔离，非发版阻塞（R6b 评审沉淀） | ADR 数量再增一档或检索痛点出现 |

### D32 同步偏离记录（2026-08-21）

website 参考页（commands/keys）自建站起已欠账（停在初版，S23-S25 命令未入）。执行口径调整为：**仓库文档随每步合并跟改**（纪律不变）；**website 页面集中在 R6a 一次还清**，以 `/help` 与 `keymap.list()` 枚举 diff 为提取源（仍符合 D32"从源码提取"精神）。R6a 之后恢复逐期跟改。

---

## 下游定制能力（显性设计目标）

Blue 不是封闭应用，而是一组可被下游插件定制的 surface。定制发生在三个级别：

1. **贡献缝**（registry + disposer，多贡献共存）：状态栏条目、主题、slash 命令、render intent 呈现器
2. **Provider 替换**（单一活跃 provider，热替换自动重载依赖方）：主题 provider、整个状态栏插件、Editor（vim 模式）
3. **组合层**（profile/bundle patch，零代码）：启停、重排任何 Blue 插件

各阶段需要刻意开出的缝（缺失即视为该阶段未完成）。完整缝清单（契约、归属、plain 默认实现）见 [blue-p1-design.md](./history/blue-p1-design.md) §6：

| 阶段 | 缝 | 下游能做什么 |
|---|---|---|
| P0 | `ctx.commands` / `ctx.userQuestions` / `approval/request`（harness 现有） | 注册命令、接管提问与审批交互 |
| P0 | `ctx.blueScreen` / `ctx.blueKeymap` / `ctx.blueSession` + 会话事件（Blue 现有） | 挂组件、弹 overlay、注册键位、跟踪/发起会话切换 |
| P1 | `ctx.blueComponents` / `ctx.blueTerminalInfo` | 造 pi-tui 级组件而不碰 pi-tui；读终端能力事实（背景、协议） |
| P1 | `blueTheme` provider 替换（主题插件族 + `/theme`） | 提供整套新主题，运行时切换 |
| P1 | `ctx.blueStatus`（状态栏条目注册表，transcript 提供） | 注册状态栏条目；或整个替换 footer 插件 |
| P1 | `blueKeymap` 全局动作（`BlueKeyAction.handler`） | 注册焦点无关的全局快捷键 |
| P1 | `ctx.permissionPresets`（harness，✅ rc.7 已落地——`/permission` 命令 + `permissions` 投影随 base；Blue 选择器面板 ✅ S24b，D33） | 权限预设切换，Blue 面板自动列出 |
| P2 | `ctx.blueIntents`（render intent 注册表，transcript 提供；✅ S7 已落地） | 为新工具类型提供定制呈现 |
| 全程 | `ctx.tools.register` / `tools/pre-execute`（harness 现有） | 定制/包裹 agent-loop 的 tools，Blue 经 render intent 自动呈现 |
| 全程 | `cordis.patch.yml` 组合层 | 零代码启停/重排任何 Blue 插件 |

纪律：凡是"下游可能想换/想加"的表面，一律做成缝，不写死；下游定制路径只依赖文档化 surface，与 Blue 内部实现隔离。

**缝的设计时机**（宪法先行，细则后置）：

- **MVP 必须定稿**：L1 三个服务签名 + 三条纪律（焦点/键位/弹窗）+ "凡表面皆插件"的结构。这些是宪法，改了全员返工。
- **L1 签名守门清单**（定稿评审标准，防"改"、允许"加"）：
  1. L1 只暴露自有最窄接口（如 `BlueComponent`），不透传 pi-tui 类型——pi-tui 破坏性变更不得传导出 L0
  2. 不含任何 harness 业务类型（Session/Agent/Tool 出现在 L1 签名即驳回）
  3. 不含具体实现类（`TuiMainScreen`/`TuiAltScreen` 等只允许出现在 L0 内部）
  4. 方法正交：挂组件（screen）、取色（theme）、键位（keymap）互不越界
  5. 未来的缝（blueStatus、render intent 注册表、focus 事件等）一律作为 L3 插件提供的新服务或 L1 的纯增量方法，不允许修改既有签名
- **缝的清单采用"首个真实消费者驱动"**：表面在 MVP 里可以是写死的内部实现；当第一个具名下游需求出现时才提升为缝（开注册表、默认实现降级为第一个注册者、补文档化签名）。不为假想需求开缝——与 harness "无真实消费者不保留产品表面"的哲学一致。P1 的"首个真实消费者"是 Blue 自家增强插件（plain-first 纪律，D21）：自家 UI 增强必须与下游同权经缝注册。
- **P1 的一次性层职责重排**：blue-p1-design §1.2 行使了一次有边界的破坏性许可（主题拆契约+provider、`blueComponents` 工厂缝落地、token 全量化、MVP 自研件退役；ADR D17-D20）。定稿后 L1 恢复"只增不改"。
- **P3 是缝的冻结点**：进入硬化阶段前缝可随 pre-release 窗口自由调整；P3 起缝的签名转入稳定承诺。

## 风险登记

| 风险 | 阶段 | 对策 |
|---|---|---|
| harness pre-release API 破坏 | 全程 | 只依赖 cordis-surface 文档化 API；核心不 import 内部实现；钉版本 |
| pi-tui 无虚拟化，长 transcript 性能 | P2 | 组件级缓存 + 旧消息静态化，收在 transcript 插件内部 |
| 单焦点模型下弹窗叠弹窗 | P1 起 | `showOverlay` 句柄纪律 + P3 的 focus 事件约定 |
| 键位冲突随插件增多 | P1 | keymap 注册表 + 启动期冲突检测，禁止硬编码 matchesKey |
| 终端能力梯度（老终端无 Kitty 协议） | 全程 | 沿用 pi-tui 的优雅降级路径，Apple Terminal/Windows 用 native addon |

## 里程碑速览

```
P0 MVP        → 一轮完整对话 + 审批/提问 + resume            （核心定型，已完成）
P1 交互完整性  → 缝清单落地 + kimi 对照核心 UX（plain-first） （日常可用，S0-S9 已完成）
P2 表现力      → 视觉对齐（S10-S21）/ intent / 滑动窗口 / 图片 （体验对齐，S10-S21 会话流对齐五期全部落地——S19/S21 随 S17 dogfood 拉前，S18 用户回显+措辞，S20 工具卡（三态卡片头/动词标签/3 行预览/ctrl+o 3-turn 范围/30-step 折叠保留窗口/Read 分组树/shell 呈现）；窗口与图片已随 S7；命令系列 S23-S29（S23-S26 已并 master 含 harness 线 0.1.1-rc.1 迁移，S27'-S29 冲刺中）+ UX 冲刺 S30-S33（2026-08-21 裁决定稿，详「预览版发版冲刺」节））
P3 硬化生态    → 缝冻结 / 测试 / HMR / 文档 / 发布             （可发布；0.1.0-rc.1 按裁剪版执行——R0-R6 发版段进预览版，缝冻结/HMR/focus 文档/fake providers 延至正式版前）
```
