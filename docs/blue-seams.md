# Blue 缝（seam）清单：契约、默认实现与插件映射

本文描述**当前代码现状**：Blue 目前开了哪些缝、每条缝的契约在哪、plain 默认是什么、以及上游（harness）开的缝的视觉效果由哪些 Blue 插件实现。缝的设计正典见 [blue-p1-design.md](./blue-p1-design.md) §6，架构背景见 [blue-architecture.md](./blue-architecture.md)，相关 ADR 见 [blue-decisions.md](./blue-decisions.md)（D3/D17/D18/D20/D21/D25/D26）。

## 1. 什么是缝

Blue 没有字面的 `Seam` 类型或 `registerSeam()` API。"缝"是架构术语，指**为替换与贡献而显式留出的接合面**，在代码中以五种形态落地：

1. **Cordis 服务 + 声明合并**——`Service` 子类挂到 `Context` 上（`declare module '@deepseek-ai/cordis' { interface Context { … } }`），即"开缝"。契约声明处：`packages/core/src/types.ts:733`（blueTheme 等合并）、`packages/transcript/src/types.ts:27`（blueStatus/blueIntents）、`packages/app/src/types.ts:23`（blueSession）。
2. **registry + disposer**——`register(entry): () => void`，重复 id 抛专用 Error；插件 fiber 卸载自动回滚（"注册即 effect"）。blueStatus、blueIntents、blueKeymap 都是。
3. **provider 替换**——单一活跃 provider 插件（主题族）；换装时 Cordis 自动 reload 注入方。
4. **模块级缝**——跨插件共享单例而非 Cordis 服务：`packages/interaction/src/editor-instance.ts`（共享编辑器）。
5. **子路径插件 + patch 行**——每条增强是一个包的 subpath export，组合层用 `cordis.patch.yml` 行启停（零代码定制）。

每条缝上的角色分三份：**definition**（契约归宿主包）、**provider / contributor**（实现或贡献者，plain 默认是第一个注册者）、**consumer**（消费方，只依赖契约不依赖实现）。

## 2. Blue 自有缝

Blue 自己向下游开的缝。下游插件只允许 import 这些契约与文档化子路径，不得 import Blue 包内部模块。

| 缝 | ctx 键 / 机制 | 契约位置（源码） | 实现 | plain 默认 | 下游能做什么 |
|---|---|---|---|---|---|
| 屏幕挂载 / overlay / 焦点 | `ctx.blueScreen` | `packages/core/src/types.ts`（`BlueScreen`/`BlueComponent`/`BlueOverlayHandle`） | `core/src/screen.ts`（`BlueScreenService`） | —（核心能力） | 挂组件（`addChild` 返回 disposer）、弹 overlay、`setFocus`、`requestRender` |
| 键位注册 | `ctx.blueKeymap` | `core/src/types.ts`（`BlueKeymap`/`BlueKeyAction`） | `core/src/keymap.ts` | — | 注册语境/全局快捷键；冲突在启动期暴露，而非运行时抢键 |
| 组件工厂 | `ctx.blueComponents` | `core/src/types.ts:649`（`BlueComponents`） | `core/src/components.ts`（`BlueComponentsService`，inject blueTheme，换装自动重建） | — | 造 editor/markdown/select/settings/image 组件 + 宽度/模糊纯函数，全程不碰 pi-tui |
| 终端事实 | `ctx.blueTerminalInfo` | `core/src/types.ts` | `core/src/terminal-info.ts` | — | 读 OSC 11 探测的背景色与 Kitty 键盘协议能力 |
| 主题 | `blueTheme` provider 替换 | `core/src/types.ts`（`BlueTheme`/28 token 的 `BlueSemanticColors`） | 四个 provider 子路径插件：`theme-dark` / `theme-light` / `theme-auto`（inject blueTerminalInfo）/ `theme-custom`（JSON 叠加），共享 `core/src/theme-palette.ts` | `blue-theme-dark` | 提供整套新主题；运行时 `/theme` 热切换，依赖方自动 reload |
| 状态栏条目 | `ctx.blueStatus` | `packages/transcript/src/types.ts`（`BlueStatus`/`BlueStatusEntry`） | `transcript/src/status.ts`（`BlueStatusService` + 常驻两行 footer 壳，priority 升序 first-fit） | `blue-status-basic`（priority 0：`{model} · {status}`） | 注册 footer 条目（现存增强：`status-git` priority 10、`status-context` priority 20） |
| 渲染意图 | `ctx.blueIntents` | `transcript/src/types.ts`（`BlueIntents`/`BlueIntentEntry`/`BlueIntentProps`） | `transcript/src/intents.ts`（exact → generic → 首个注册者回退） | generic 工具卡呈现器（apply 内首个注册） | 为新工具类型提供定制卡片（现存：`intent-diff`、`intent-terminal`） |
| 会话事实 | `ctx.blueSession` + 事件 `blue/session-changed`、`blue/request-resume` / `-new` / `-fork` | `packages/app/src/types.ts:23` | `app/src/index.ts`（`blue-app` 启动即 provide） | — | 读当前 Agent、跟踪会话切换、发起 resume/new/fork |
| 共享编辑器 | 模块级 `editor-instance.ts`（非 Cordis 服务）+ 事件 `blue/input-editor-changed` | `packages/interaction/src/editor-instance.ts`（`SharedEditor`、`SubmitTransformer`、`markEditorEnhancement`） | `blue-input` 挂载编辑器时 `setSharedEditor` 发布 | 工厂 plain 编辑器 | 叠增强：补全 provider、`onKey` 按键拦截、`insertText`、提交变换器（现存：`blue-editor-plus`、`blue-paste-image`） |
| chrome 辅助层 | `@dsh-blue/blue-core/chrome` 子路径（纯函数，不经服务） | `core/src/chrome.ts` | — | — | 主题无关的框/规则/提示绘制（`withSideBorders`、`framePanel`、`topRule`、`injectGhostHint` 等），色函数由调用方注入 |
| 组合 | `cordis.patch.yml` 行 | `packages/bundle/blue/cordis.patch.yml` | bundle `src/index.ts` 不挂任何东西 | 基线 8 行（基线段 5 + 装配段 3） | 零代码启停、重排任何 Blue 插件（§4 全表） |

## 3. 继承自 harness 的缝：上游开缝，Blue 插件实现视觉

harness（dsh-base）自己开的缝，Blue 作为下游插件实现——**用户看到的每个 harness 侧交互表面，都对应 Blue 的一个插件**：

| harness 缝 | 用途 | Blue 实现插件（视觉表面） | 状态 |
|---|---|---|---|
| `ctx.commands.register` | 注册 slash 命令，自动进入编辑器补全菜单 | `blue-interaction` 行内的 commands 内嵌插件（`commands-plugin.ts`：`/quit` `/resume` `/new` `/fork` `/sessions` `/help`；`theme-switch.ts`：`/theme`）；`blue-pane-btw` 自注册 `/btw` | ✅ |
| `ctx.userQuestions.registerProvider` | 接管提问交互 | `blue-interaction` 行内的 questions 内嵌插件（`questions-plugin.ts` + `questionnaire.ts`）：tab 化问卷 overlay | ✅ |
| `'approval/request'` waterfall | 审批应答（不调 `next()` 即短路） | `blue-interaction` 行内的 approval 内嵌插件（`approval-plugin.ts`）：四选项面板、session 级"总是允许"继承、FIFO 队列 | ✅ |
| `attachments`（`AttachmentStore`） | 附件存储——rc.7 是**纯缝**，上游无实现 | `blue-attachments` 子路径插件（`attachments.ts`）：`$DSH_BLUE_ATTACHMENT_DIR`/`$DSH_HOME`/`~/.dsh` 下的文件系统实现，不挂任何屏幕子组件；`blue-paste-image` 是其消费者 | ✅ |
| `ctx.tools` / `tools/*`、`ctx.agents` / `ctx.sessions` | 工具注册/守卫、会话与 agent 操作 | 直接消费方：`blue-app`（创建/恢复 Agent）、`blue-transcript`（工具调用经 `blueIntents` 呈现）、`pane-btw`（fork 旁路会话）；Blue 不包装 | ✅ |
| `ctx.permissionPresets` | 权限预设（sandbox 模式 + approval policy 命名束） | Blue 选择器面板 S24 待做（D33：读 `permissions` 投影渲染、选中提交 `/permission <name>` 同一写路径 + danger 确认 gate）；命令本体 dsh-permission-presets 自带、零实现 | ✅ 服务在（rc.7+ base；rc.8 扩表 read-only） |
| `ctx.planMode` + plan-review 问询 | plan 模式（`/plan` 命令 dsh-plan-mode 自带、`plan/mode` 事件、`plan` 投影、`exit_plan_mode` 工具经 `ctx.userQuestions` 以 `intent.kind === 'plan-review'` 问询） | 命令零实现（随 base 到货）；Blue 可选增强 🔍：plan-review 专用决策卡 + 模式指示器（有效目标 = `pending ? !active : active`） | ✅ 服务在（rc.7+ base）；呈现待裁决 |
| `ctx.skills` + 手势路径 | 技能发现/调用（分层注册表 + skill-filesystem 六层根 + `tool-skill` pre-step `/name` 手势注入） | S29 待做（D34：`#` 提示符补全 + 提交重写 `#name`→`/name` 走手势路径 + `/skills` 列表） | ✅ 服务在（rc.7+ base） |
| `ctx.agentPresets` | agent 组合预设（list/resolve/mount/recompose；`agent-preset/selected` 事件） | S28 待做（D33：`/preset` 命令——空会话 sessionBlank 守卫 + 事件配对）；**插件行不在 dsh-base**（仅 web-app bundle），Blue bundle patch 加行 + 带依赖 | ⚠️ bundle 加行后可用 |
| `ctx.sessionProjections` | 会话投影（register/onChanged/checkpoint/restore） | rc.7+ 已在 base（dsh-session-projection）；`pane-todo` 维持 `todo/write` 会话事件折叠，改挂投影为可选项（未裁决） | ✅ 服务在 |

注意分界：`pane-todo` 消费的是**会话事件流**（`todo/write` 整表快照自折叠），不是一条 harness 缝；harness 未来若开出 `sessionProjections`，`pane-todo` 可平滑改挂。

## 4. 组合层视图：`cordis.patch.yml` 全表

patch 在 `dsh-base` 之上插入三段 19 行。**拔掉整个增强段，基线（基线段 + 装配段 = 8 行）仍是一个完整可用的 Blue UI**；反之每行也可单独删除。

### 基线段（5 行）

| 行（插件 id） | 包子路径 | 缝角色 | 视觉效果 |
|---|---|---|---|
| `blue-core` | `@dsh-blue/blue-core` | 提供 L0 适配 + L1 服务（blueScreen/blueKeymap/blueTerminalInfo/blueComponents） | 终端本身；一切组件的地基 |
| `blue-theme-dark` | `@dsh-blue/blue-core/theme-dark` | `blueTheme` provider（plain 默认） | 全部颜色的内置暗色调色板 |
| `blue-banner` | `@dsh-blue/blue-transcript/banner` | 消费 blueScreen（首个滚动区子组件） | 欢迎横幅：像素城堡、model · provider、cwd、tips |
| `blue-transcript` | `@dsh-blue/blue-transcript` | 提供 `blueStatus`/`blueIntents`；消费 `blueSession` 与 session 事件 | 会话记录主体（流式 Markdown + generic 工具卡）+ 两行 footer 壳 |
| `blue-status-basic` | `@dsh-blue/blue-transcript/status-basic` | 向 `blueStatus` 贡献（priority 0） | footer 第一条目 `{model} · {status}` |

### 增强段（11 行，可整段拔除）

| 行（插件 id） | 包子路径 | 缝角色 | 视觉效果 |
|---|---|---|---|
| `blue-editor-plus` | `@dsh-blue/blue-interaction/editor-plus` | 消费共享编辑器缝（`blue/input-editor-changed` 事件重挂） | `!` bash 模式（提示符与边框变色）+ slash/`@` 补全 |
| `blue-attachments` | `@dsh-blue/blue-interaction/attachments` | 提供 harness `attachments` 纯缝的实现 | 无屏幕子组件（纯数据面） |
| `blue-paste-image` | `@dsh-blue/blue-interaction/paste-image` | 消费共享编辑器缝（onKey + insertText + 提交变换）与 `attachments` | Ctrl-V 贴图：`[image #N]` 标记，提交拆为图像块 |
| `blue-status-git` | `@dsh-blue/blue-transcript/status-git` | 向 `blueStatus` 贡献（priority 10） | git 分支条目（仓库外不渲染） |
| `blue-status-context` | `@dsh-blue/blue-transcript/status-context` | 向 `blueStatus` 贡献（priority 20） | 上下文占用条目 `ctx N` / `ctx N.Nk` |
| `blue-intent-diff` | `@dsh-blue/blue-transcript/intent-diff` | 向 `blueIntents` 贡献 `card:'diff'` | 带标题的 per-file 统一 diff 卡片 |
| `blue-intent-terminal` | `@dsh-blue/blue-transcript/intent-terminal` | 向 `blueIntents` 贡献 `card:'terminal'` | `$ command` shell 卡片（cwd、exit 徽标、封顶输出行） |
| `blue-pane-activity` | `@dsh-blue/blue-transcript/pane-activity` | `blueScreen.addBottomChild`（行级 inject 钉 dock 序） | agent 运行中一行 spinner；空闲零行 |
| `blue-pane-queue` | `@dsh-blue/blue-interaction/pane-queue` | `blueScreen.addBottomChild` + blueKeymap 无键动作 | 排队消息行 + 空编辑器 Up 召回 |
| `blue-pane-todo` | `@dsh-blue/blue-transcript/pane-todo` | 消费 session 事件（`todo/write` 折叠）+ blueKeymap 全局键 | todo 面板 + Ctrl-T 折叠开关 |
| `blue-pane-btw` | `@dsh-blue/blue-transcript/pane-btw` | 消费 `blueSession`/`ctx.agents` + `ctx.commands.register` | `/btw` 旁路问答面板（fork 一次性 side agent） |

### 装配段（3 行，plain 基线的收尾）

| 行（插件 id） | 包子路径 | 缝角色 | 视觉效果 |
|---|---|---|---|
| `blue-interaction` | `@dsh-blue/blue-interaction` | 消费 blueScreen/blueComponents/blueKeymap；实现 harness 的 `commands`/`userQuestions`/`approval` 三缝。行内经 `ctx.plugin()` 装五个内嵌插件（keys/commands/input/questions/approval），各有自己的 fiber | 输入编辑器（经共享编辑器缝发布）、内置命令、提问/审批 overlay |
| `blue-startup` | `@dsh-blue/blue-app/startup` | 提供 `blueStartup`（cmdlineArgs provider） | `[task]` positional 与 `--resume <id>` 解析（无视觉） |
| `blue-app` | `@dsh-blue/blue-app` | 提供 `blueSession` | Agent 创建/恢复驱动；会话切换事件源 |

## 5. 缝的设计纪律（P1 起生效）

1. 每条缝：契约归宿主包、注册返回 disposer、plain 默认是第一个注册者、未知输入回退 plain。
2. 新缝只在首个真实消费者出现时开（现为 Blue 自家增强插件），不为假想需求开缝；P3 冻结签名。
3. 下游插件只允许依赖文档化缝与契约包，不得 import Blue 包内部模块。
4. plain-first（ADR D21）：Blue 自家增强与下游插件同权经缝注册；基线拔掉全部增强行后仍完整可用（§4）。

## 6. 延伸阅读

- [blue-p1-design.md](./blue-p1-design.md) §6——缝清单正典与设计理由（注意其 §7 的行数描述是 P1 时点，现状以本文 §4 与 patch 文件为准）
- [blue-architecture.md](./blue-architecture.md) §2/§5.3/§6——设计哲学、缝的设计时机、下游定制三级
- [blue-decisions.md](./blue-decisions.md)——D3（缝后置）、D17（组件工厂缝）、D18（主题 provider 替换）、D20（blueStatus 归 transcript）、D21（plain-first）、D25（chrome 辅助层）、D26（底部上拉面板）
- 根 [README](../README.md)——以 Editor 缝为例的设计哲学讲解
