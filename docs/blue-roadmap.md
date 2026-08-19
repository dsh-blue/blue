# Blue — deepseek-harness TUI 实现路线图

> **仓库形态（2026-08-18 更新）**：Blue 是独立仓库（`blue/` 目录，产品名 blue），以 npm registry 版本依赖 harness（`@deepseek-ai/*@0.1.0-rc.7` 钉版，跟随其 prerelease 节奏升级），经 `dsh plugin --profile blue add @dsh-blue/blue` 挂载为 profile。harness 的 pre-release API 破坏风险由"钉版本 + 升级时适配"承担，与 roadmap 风险登记一致。

> 产品名：**Blue**（deepseek-harness 的官方 TUI surface）
> 技术底座：`@earendil-works/pi-tui`（渲染/输入）+ Cordis 插件树（组合/生命周期）
> 架构分层：L0 pi-tui 适配层 · L1 内核服务 · L2 交互 providers · L3 渲染插件 · L4 组合层
> 启动形态：`dsh --profile blue`
> **P1 设计定稿**：[blue-p1-design.md](./blue-p1-design.md)（层职责重排、缝清单、kimi-code 能力对照、S0-S8 实施序）
> **P2 视觉设计定稿**：[blue-p2-visual-design.md](./blue-p2-visual-design.md)（kimi-code 观感对齐、主题契约 v2、chrome 辅助层、S10-S21 实施序）

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
**设计定稿**：[blue-p1-design.md](./blue-p1-design.md)。本节只保留摘要，实施细节、契约草样与逐项对照以该文档为准。

- **plain-first 纪律**（D21）：每个表面 = 缝 + plain 默认实现；Blue 自家增强经自家缝注册，与下游同权；基线 patch 拔掉增强行后仍完整可用
- **一次性层职责重排**（D17-D20，边界见 p1-design §1.2）：`blueTheme` 拆为契约 + provider 插件；`ctx.blueComponents` 组件工厂缝落地，MVP 期自研件（`BlueInput`/`markdown.ts`/`width.ts`）退役；`BlueSemanticColors` 全量化为 26 token
- **主题**：dark/light/auto/custom 插件族 + `/theme` provider 换装；OSC 11 探测归 L0（raw mode 前查询）
- **键位**：全局动作经 `BlueKeyAction.handler` + L0 全局分发器（Ctrl-O 折叠等）；编辑器语境动作（Esc/Ctrl-C 中断、Ctrl-S steer）经组件内 `matches`
- **编辑器**：换装 pi-tui Editor（多行/历史/kill-ring/补全/Kitty 解码）；shell 模式（`!`）、`@` 文件补全、slash 补全菜单
- **状态栏**：`ctx.blueStatus` 注册表 + 两行 footer 壳 + git/context/basic 条目插件
- **面板与命令**：activity/queue/todo/btw pane 插件；`/sessions` `/fork` `/new` `/help` `/btw`；审批四选项 + session 级继承（Blue 侧协调器）；提问多题 tab 化
- **welcome banner**：启动欢迎横幅（像素鲸鱼 logo + 模型/cwd 信息 + Tips 右栏，铺满全宽；`blue-banner` 基线段行）（✅ S8 已落地，S10 期间重排：全宽三段布局 + 鲸鱼缩小 30%）
- **alt-screen**：`TuiAltScreen` 与主屏运行时热切换（兑现 L0 的 Proxy 预埋）

**验收**：连续 30 分钟真实 coding 会话无渲染错乱、无焦点丢失；主题热切换后 transcript 经快照正确重放且编辑器草稿保留；`/btw` 在 agent 运行中插入旁白且 transcript 正确呈现；plain 基线完整可用；注册冲突在启动期暴露。

---

## Phase 2 — 表现力：呈现密度与性能

**目标**：工具呈现结构化、长会话性能达标、富媒体进入。状态栏/主题/键位已在 P1 落地，本阶段聚焦"内容呈现"。**视觉/UX 打磨工作流**（[blue-p2-visual-design.md](./blue-p2-visual-design.md)，S10-S21）在本阶段立项：主题契约 v2（+`primary`/`textMuted`）、共享 chrome 辅助层、对话框/面板/补全/footer 的观感对齐与常驻按键提示，按视觉影响排序推进（✅ S10 已落地：主题契约 v2 28 token + 消息流/markdown 升级；✅ S11 已落地：编辑框圆角框/提示符/语境变色 + 常驻按键提示行，chrome 辅助层缝随期开出；✅ S12 已落地：对话框 chrome 统一——审批琥珀框/编号选项、问卷 `(○)/(✓)` tab、/help 双列滚动窗、/sessions 列表框 + `← current`、BlueSelect 选中行 selectedBg，framePanel/hintRow 随期开出；✅ S13 已落地：pane 边框 + dock 拼接——/btw 圆角框（边框内标题 + fitBodyLines 尾随/手动滚动 + Esc/↑↓ 编辑器链路由）与编辑框 `├┤` 拼接、todo topRule 框、shell echo 与 terminal 卡 kimi dim 定妆，topRule/padColumns 与 blueScreen.rows 契约随期开出，'blue/editor-connected-above'/'blue/btw-command' 事件通道落地；✅ S14 已落地：补全与列表打磨——斜杠/`@` 补全模糊化（slash-filter 共用匹配语义）、下拉描述 2 行 wrap + 参数幽灵提示 + 行首斜杠 token 加粗、Enter 接受并提交，fuzzy 重导出与 WrappingSelectList 随期开出；✅ S15 已落地：Footer v2（D27）——两空格 slot + 三档灰阶（model/context=text、cwd/git=muted、tips=textMuted）、agent-status 移除、git 全量徽章 `branch [+N -M ↑a↓b]`（TTL 缓存惰性刷新）、tips SWRR 轮换 + `' | '` 配对（10s ticker）、context 百分比 `context: N% (K/M)`（1024 进制，`'request/context'` 撤回降级 `ctx N`），`row`/`align` 条目缝与 `./status-cwd`/`./status-tips` 子路径随期开出）。**会话流对齐立项（2026-08-20，p2-visual §2.6/§7，S16-S21 排期）**：S16 瘦身（spinner 帧与 working tips 迁 S17、`✓/✗` 清扫与首折提示迁 S20，保留 banner 真实 tips + `← current`）；S17 思维链组件（live 尾部 2 行滚动 + 定稿折叠 + ctrl+o）+ 活动模式机（waiting/tool=moon、thinking 空、composing=braille）；S18 用户回显 `✨` 全文 bold roleUser + 助手 `●` bullet + 2 列缩进；S19 注入上下文默认隐藏（D28，合成 source 零呈现）；S20 工具卡 kimi 折叠（Using/Used 动词标签、3/10 行预览、dim chip、ctrl+o 最近 3 turn、Read 分组树、shell 呈现统一）；S21 全局 1 列 gutter（D29，S13 `padColumns` 推迟项消费，定妆 reflow）。

- **render intent 注册表**（`ctx.blueIntents`）：`diff` / `terminal` 呈现器落地，generic 呈现降级为第一个注册者（✅ S7 已落地）
- **transcript 性能（滑动窗口）**：保留最近 N turn，旧 turn 组件与条目整体销毁；turn 内旧 step 折叠为摘要行；渲染缓存策略固化（✅ S7 已落地窗口+step 折叠）
- **图片**：Editor 粘贴图片（L0 `createImage` + 剪贴板工具 + `dsh-attachment` 借力）、`@` 附件（✅ S7 已落地粘贴路径：`blue-attachments` + `blue-paste-image`；`@` 附件待做）
- **弹窗体系完整化**：model selector、审批 diff 全屏预览（100% overlay）、permission preset 设置面板（待上游 `permissionPresets`）
- **外部编辑器**（Ctrl-G，需 L0 渲染器暂停配合）
- **OSC 8 可点链接、OSC 52 复制、鼠标滚轮/文本选择**（alt-screen）
- **模式命令**（`/yolo` `/plan` `/compact` `/model` 会话中切换）：随上游能力缝落地逐个接入
- 子 agent / Task 工具的树形呈现组件（经 intent 缝）

**验收**：5 万行级 session resume 后滚动流畅；参照系产品的常用交互有对应物或明确的"不做"结论。

---

## Phase 3 — 硬化与生态：从"好用"到"可发布"

- **缝冻结**：P1/P2 开出的全部缝（`blueScreen`/`blueKeymap`/`blueComponents`/`blueTerminalInfo`/`blueTheme`/`blueStatus`/`blueIntents`/组合层 + 继承的 harness 缝）逐条过守门评审，签名转入稳定承诺
- 测试体系：`VirtualTerminal`（@xterm/headless）渲染快照测试（届时复审 D13 的 FakeTerminal 决策）+ fake interaction providers 集成测试
- HMR 开发回路：改组件源码热替换（cordis-plugin-hmr）写入开发文档
- 焦点/overlay 协调约定文档化（L1 加 focus 进出事件，核心签名仍不动）
- 文档门禁合规：cordis-surface 生成、doc-sync、子系统文档页
- 发布：`dsh plugin add` 路径验证 + 版本钉住策略（跟随 harness prerelease 节奏）
- 验收对照删除 TUI 决策笔记的四条重引入条件逐条核验：具名部署（`--profile blue`）、明确包边界、具体交互 provider、组装级生命周期与 transcript 验收

**验收**：CI 全绿 + 文档门禁通过 + 一次完整的 `dsh --profile blue` 真实任务 dogfood 记录。

---

## 下游定制能力（显性设计目标）

Blue 不是封闭应用，而是一组可被下游插件定制的 surface。定制发生在三个级别：

1. **贡献缝**（registry + disposer，多贡献共存）：状态栏条目、主题、slash 命令、render intent 呈现器
2. **Provider 替换**（单一活跃 provider，热替换自动重载依赖方）：主题 provider、整个状态栏插件、Editor（vim 模式）
3. **组合层**（profile/bundle patch，零代码）：启停、重排任何 Blue 插件

各阶段需要刻意开出的缝（缺失即视为该阶段未完成）。完整缝清单（契约、归属、plain 默认实现）见 [blue-p1-design.md](./blue-p1-design.md) §6：

| 阶段 | 缝 | 下游能做什么 |
|---|---|---|
| P0 | `ctx.commands` / `ctx.userQuestions` / `approval/request`（harness 现有） | 注册命令、接管提问与审批交互 |
| P0 | `ctx.blueScreen` / `ctx.blueKeymap` / `ctx.blueSession` + 会话事件（Blue 现有） | 挂组件、弹 overlay、注册键位、跟踪/发起会话切换 |
| P1 | `ctx.blueComponents` / `ctx.blueTerminalInfo` | 造 pi-tui 级组件而不碰 pi-tui；读终端能力事实（背景、协议） |
| P1 | `blueTheme` provider 替换（主题插件族 + `/theme`） | 提供整套新主题，运行时切换 |
| P1 | `ctx.blueStatus`（状态栏条目注册表，transcript 提供） | 注册状态栏条目；或整个替换 footer 插件 |
| P1 | `blueKeymap` 全局动作（`BlueKeyAction.handler`） | 注册焦点无关的全局快捷键 |
| P1 | `ctx.permissionPresets`（harness，⛔ S0 已核实 rc.7 不存在，待上游做缝） | 注册自定义 preset mode，Blue 模式 UI 自动列出 |
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
P2 表现力      → 视觉对齐（S10-S21）/ intent / 滑动窗口 / 图片 （体验对齐，S10-S15 已落地，S16-S21 排期中——会话流对齐 2026-08-20 立项；窗口与图片已随 S7）
P3 硬化生态    → 缝冻结 / 测试 / HMR / 文档 / 发布             （可发布）
```
