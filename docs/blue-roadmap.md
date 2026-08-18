# Blue — deepseek-harness TUI 实现路线图

> **仓库形态（2026-08-18 更新）**：Blue 是独立仓库（`blue/` 目录，产品名 blue），以 npm registry 版本依赖 harness（`@deepseek-ai/*@0.1.0-rc.7` 钉版，跟随其 prerelease 节奏升级），经 `dsh plugin --profile blue add @deepseek-ai/dsh-blue` 挂载为 profile。harness 的 pre-release API 破坏风险由"钉版本 + 升级时适配"承担，与 roadmap 风险登记一致。

> 产品名：**Blue**（deepseek-harness 的官方 TUI surface）
> 技术底座：`@earendil-works/pi-tui`（渲染/输入）+ Cordis 插件树（组合/生命周期）
> 架构分层：L0 pi-tui 适配层 · L1 内核服务 · L2 交互 providers · L3 渲染插件 · L4 组合层
> 启动形态：`dsh --profile blue`

## 命名约定

- 产品/Profile/Bundle 名：`blue`
- 包名（仓库内，遵守 `@deepseek-ai/dsh-*` 命名约定）：
  - `@deepseek-ai/dsh-blue-core` — L0 + L1（pi-tui 适配 + 三个内核服务）
  - `@deepseek-ai/dsh-blue-interaction` — L2（输入、命令、审批、提问 providers）
  - `@deepseek-ai/dsh-blue-transcript` — L3（会话渲染、工具呈现、投影组件、状态栏）
  - `@deepseek-ai/dsh-blue-app` — L4（startup provider + 主 app 插件）
  - `@deepseek-ai/dsh-bundle-blue` — bundle 定义（cordis.patch.yml，骑在 `dsh-base` 上）
- 目录建议：`packages/blue/{core,interaction,transcript,app}` + `packages/bundle/blue`

## 总原则

1. **每个阶段结束都是一棵可启动、可验收的插件树**——不留半成品分支。
2. **核心（L0/L1）的接口在 MVP 就定稿**，后续阶段只加 L2/L3 插件，不改核心签名。
3. 渲染铁律：`session/event` → 组件子树 → `requestRender()`，单向数据流。
4. 能力铁律：需要 harness 新能力时先在上游做能力缝，Blue 只消费文档化 surface。
5. 纪律红线：焦点只经 `tuiScreen.setFocus`；键位一律注册进 keymap；弹窗只走 `showOverlay`。

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

**目标**：覆盖交互式 coding agent 的基本操控面；L1 三个服务全部兑现设计能力。

- `ctx.blueTheme` 完整化：JSON 主题文件 + OSC 11 背景探测自动明暗 + 运行时切换（换 provider，组件插件自动重载）
- `ctx.blueKeymap` 开放：插件经 declaration merging 声明动作 + 启动期冲突检测
- Esc 取消（`agent.cancel()`）、运行中输入排队 / steer（`agent.steer()`）——`/btw` 命令在此阶段作为示范插件落地
- `TuiAltScreen` 模式：ScrollView transcript + 底部 dock，main/alt 运行时热切换（兑现 L0 的 Proxy 引用）
- 会话管理 UI：session selector overlay（fork/resume/list）
- 工具呈现补齐：`diff` / `terminal` intent 组件
- 投影组件：todos 面板、会话标题（消费 `ctx.sessionProjections`）

**验收**：连续 30 分钟真实 coding 会话无渲染错乱、无焦点丢失；主题/键位/渲染器热切换不重启进程；`/btw` 在 agent 运行中插入旁白且 transcript 正确呈现。

---

## Phase 2 — 表现力：向 Claude Code 的体验密度靠拢

- 图片：Editor 粘贴图片（Kitty/iTerm2 `Image` 组件）、`@` 附件
- 弹窗体系完整化：model selector、permission preset 设置面板（`SettingsList` 子菜单）
- 状态栏增强：上下文用量、token 统计、git 分支
- 自定义 slash 命令（md 文件定义，经上游能力缝自动出现在补全里）
- OSC 8 可点链接、OSC 52 复制、鼠标滚轮/文本选择（alt-screen）
- transcript 性能：长会话折叠旧消息为静态 `Text`，渲染缓存策略固化
- 子 agent / Task 工具的树形呈现组件

**验收**：5 万行级 session resume 后滚动流畅；所有 Claude Code 常用交互有对应物。

---

## Phase 3 — 硬化与生态：从"好用"到"可发布"

- 测试体系：`VirtualTerminal`（@xterm/headless）渲染快照测试 + fake interaction providers 集成测试
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

各阶段需要刻意开出的缝（缺失即视为该阶段未完成）：

| 阶段 | 缝 | 下游能做什么 |
|---|---|---|
| P0 | `ctx.commands` / `ctx.userQuestions` / `approval/request`（harness 现有） | 注册命令、接管提问与审批交互 |
| P1 | `ctx.blueStatus`（状态栏条目注册表）、`blueTheme` 主题注册表 | 自定义状态栏条目、贡献新主题 |
| P1 | `blueKeymap` declaration merging | 插件声明自己的键位动作 |
| P1 | `ctx.permissionPresets`（harness 现有） | 注册自定义 preset mode，Blue 设置面板自动列出 |
| P2 | render intent 组件注册表 | 为新工具类型提供定制呈现 |
| 全程 | `ctx.tools.register` / `tools/pre-execute`（harness 现有） | 定制/包裹 agent-loop 的 tools，Blue 经 render intent 自动呈现 |

纪律：凡是"下游可能想换/想加"的表面，一律做成缝，不写死；下游定制路径只依赖文档化 surface，与 Blue 内部实现隔离。

**缝的设计时机**（宪法先行，细则后置）：

- **MVP 必须定稿**：L1 三个服务签名 + 三条纪律（焦点/键位/弹窗）+ "凡表面皆插件"的结构。这些是宪法，改了全员返工。
- **L1 签名守门清单**（定稿评审标准，防"改"、允许"加"）：
  1. L1 只暴露自有最窄接口（如 `BlueComponent`），不透传 pi-tui 类型——pi-tui 破坏性变更不得传导出 L0
  2. 不含任何 harness 业务类型（Session/Agent/Tool 出现在 L1 签名即驳回）
  3. 不含具体实现类（`TuiMainScreen`/`TuiAltScreen` 等只允许出现在 L0 内部）
  4. 方法正交：挂组件（screen）、取色（theme）、键位（keymap）互不越界
  5. 未来的缝（blueStatus、render intent 注册表、focus 事件等）一律作为 L3 插件提供的新服务或 L1 的纯增量方法，不允许修改既有签名
- **缝的清单采用"首个真实消费者驱动"**：表面在 MVP 里可以是写死的内部实现；当第一个具名下游需求出现时才提升为缝（开注册表、默认实现降级为第一个注册者、补文档化签名）。不为假想需求开缝——与 harness "无真实消费者不保留产品表面"的哲学一致。
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
P0 MVP        → 一轮完整对话 + 审批/提问 + resume     （核心定型）
P1 交互完整性  → 主题/键位/alt-screen/steer//btw       （日常可用）
P2 表现力      → 图片/弹窗体系/性能/子agent呈现         （体验对齐）
P3 硬化生态    → 测试/HMR/文档门禁/发布                 （可发布）
```
