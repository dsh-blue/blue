# Blue 内置命令实施清单：四家参照系合并、能力支撑矩阵与 S23-S29 分期

> 姊妹文档：[blue-p1-design.md](./history/blue-p1-design.md)（§4.3 命令对照前身，本文档是其全量升级）、[blue-roadmap.md](./blue-roadmap.md)（P2"模式命令随上游能力缝落地逐个接入"条目）、[blue-seams.md](./blue-seams.md)（缝清单）、[blue-decisions.md](./blue-decisions.md)（ADR；本文档为规划文档，实施期的决策记入 ADR）
> 参照系：kimi-code（MoonshotAI，本地源码 `apps/kimi-code/src/tui/commands/registry.ts` 逐条核实，40 内置）、pi（Earendil Works，官方文档 pi.dev/docs/latest/usage，23）、Claude Code（官方文档 code.claude.com/docs/en/commands，~80 内置 + [Skill]/[Workflow] 标记）、Codex（OpenAI，官方 developer-commands 文档，~30 会话内）
> 核实基准：三源复核——① Blue 已安装 `@deepseek-ai/*@0.1.0-rc.7` 包 .d.ts；② npm 已发布清单（`next` 标签达 rc.8）；③ harness 源码 + CLI base 组合（`apps/cli/composition.md`、`agent.cordis.yml`）。2026-08-20 首轮后补一轮系统复核（plan-mode 漏检 + 初版 ⛔/🚫 判定偏窄，见 §1.3 ③④）；本文 ✅/⚠️/⛔/🚫 均带证据
> 本文档回答三个问题：**命令面扩到哪**（四家合并去重后的取舍）、**每条命令的证据**（能力支撑矩阵）、**按什么序做**（S23-S29 分期）。

## 1. 目标与范围

### 1.1 标记约定（沿用 p1-design §1.3，新增 ⚠️）

- ✅ 已核实（rc.7 已安装包内确认存在）
- ⚠️ 可做但语义近似或需前置（实施时可降级/调整）
- 📖 调研文档记载存在，未在本仓库依赖闭包内核实
- 🔍 S 步实施前必须验证
- ⛔ 上游缺口，需先在 harness 做能力缝（清单见 §7）
- 🚫 不做（参照系产品特定或非 Blue 职责）

### 1.2 范围边界

只覆盖 **slash 命令**。已存在的非 slash 输入面——`!` shell 模式（editor-plus）、`@` 文件补全（D31/S22）、Ctrl-O/S/Esc/Ctrl-C 键位链（S3）——不在本文档范围内，不因命令实施而改动。**命令 = `ctx.commands.register` 注册、经 slash 补全 + 回车触发的表面**。技能**不进 slash 命名空间**——`#` 提示符管线（D34，UI 行为与 `@` 同构，调用走上游手势路径），属 S29 但不占命令名；plugin 命令（kimi 的 `/pluginId:name`）无对应系统，维持不做；用户自建命令 = 技能文件（D35），不设独立机制。（例外：dsh-plan-mode 自注册的 `/plan` 是首例 harness 插件自带命令，随组合直接可用，见 §7 #5。）

### 1.3 与 p1-design §4.3 的关系（两处修正）

p1-design §4.3 是本文档的前身（MVP 后命令面调研）。本次逐符号核实发现**两处过期记录 + 两处本文漏检/偏窄，以本文档为准**：

1. **`LlmCallConfig.purpose='compaction'` 不存在**：rc.7 `dsh-llm/lib/types/call-config.d.ts` 的 `LlmCallConfig` 仅有 `provider/model/reasoningEffort/temperature/maxTokens/stop`（无 purpose 字段），`compaction/start…end` 事件词表只出现在 dsh-session types.d.ts 的 doc comment 里、不在 `SessionEventMap` 中。p1 §4.3 "`/compact` 机制已在（`SurfaceOp replace` + `compaction/*` 事件词表 + purpose 标记）"的结论**过期**——compaction 从请求标记到事件到入口全线缺位，`/compact` 确认 ⛔（§7 #1）。
2. **S2 的 resume 路径模型切换缺口已闭**：p1 记载"补 resume 路径的 `installModelSelection`"；rc.7 中 `packages/app/src/index.ts:72-75` 的 `modelSelectionSetup` 已在 create / startup-resume / request-resume 三条建会话路径统一挂好。残余缺口是 **UI 侧拿不到 `ModelSelectionRef` 句柄**（闭包在 setup 内），这是 S23 开新缝的全部理由（§4.2.1）。
3. **`/plan` 判 ⛔ 为本文漏检，已修正**：初版断"dsh-plan-mode 未随 rc.7 发布（仅 README 引用）；无包"。实际 `dsh@0.1.0-rc.7` 的 dependencies 即含 `dsh-plan-mode@^0.1.0-rc.7`（核实基准 `.smoke/dsh-install` 内就有 rc.7 安装包；npm 另已发 rc.8，`next` 标签），且该插件**自注册 `/plan [message]` + `/plan off`**——`/plan` 从 ⛔ 转 ✅（§2.5 行、§7 #5 已解决注记）。
4. **初版 ⛔/🚫 判定系统性偏窄，已复核修正**：初版"已排除能力面"以 Blue 已安装依赖闭包为限，而 rc.7 家族实际已发布大量能力包（见 §3.2 全表）且多数随 harness CLI base 组合默认装载。复核结果：`/compact` `/permission` `/goal` `/feedback` 已随上游自带命令落地（§2.10）；`/title` `/skills` `/tools` `/usage` `/tasks` `/mcp` 的能力面现成、仅命令层待 Blue（§7 对应注记）；"单 agent fiber"前提已过时（subagent/jobs/workflow 现成）。

## 2. 参照系命令面对照表（四家合并去重）

合并四家、去重后的全命令面，按 8 组排表。每行：命令 | 各家出现（kimi / pi / CC / Codex）| Blue 现状/去向（已发货 / S 步 / ⛔ / 🚫）。参照系完整清单以官方为准（Claude Code 命令随版本演进，本文按 2026-08 官方文档）；Blue 去向栏与 §4 实施清单、§6 不做表、§7 缝请求互链。

### 2.1 模型与推理

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/model` | ✅ | ✅ | ✅ | ✅ | ✅ 已发货（S23 落地 2026-08-20：`model-commands.ts` 的 picker + 直切，缝 BlueSessionRef.modelRef） |
| `/effort` (`thinking`) | ✅ | — | ✅ | — | ✅ 已发货（S23 落地 2026-08-20：水平分段选择器 + 直切，`thinking` 别名） |
| `/provider` (`providers`) | ✅ | — | — | — | ✅ 已发货（S23 落地 2026-08-20：面板 list/switch + Add Provider 向导——settings.mutate 写 llm-pi-ai profile + credentials.set 存 key，用户裁决将原 ⚠️ 顺延项拉入本期） |
| `/secondary-model` (`subagent-model`) | ✅ 隐藏 | — | — | — | 🚫 无子 agent 模型概念 |
| `/scoped-models` | — | ✅ | — | — | 🚫 目录级模型无概念（agent 级 selection 已有） |
| `/fast` | — | — | — | ✅ | 🚫 无快速模型切换概念 |
| `/advisor` | — | — | ✅ | — | 🚫 双模型顾问无上游 |
| `/autocompact` | — | — | ✅ | — | 🚫 = /compact 的自动化形态，随 §7 #1 |

### 2.2 会话生命周期

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/new` (`clear` 别名) | ✅ | ✅ | ✅ | ✅ | ✅ 已发货（commands-plugin.ts，`blue/request-new`） |
| `/clear` | 别名 | — | 别名 | ✅ | ✅ 已发货（S27' 落地 2026-08-21：`registerCommandAliases('new', ['clear'])` 一行别名——补全下拉别名标注（`/new (clear)`）+ 提交重写 canonical，语义 = /new，§2.12） |
| `/resume` | 别名 `/sessions` | ✅ | ✅ | ✅ | ✅ 已发货——2026-08-21 S24a dogfood 裁决：/resume 与 /sessions 本是一条命令，注册并入 `/sessions [<id>]`（无参开 picker、带参直发 `blue/request-resume`），/resume 走 command-meta 别名重写 |
| `/sessions` | ✅ | ✅ | — | — | ✅ 已发货（picker overlay，D30 挂载） |
| `/fork` | ✅ | ✅ | ✅ | — | ✅ 已发货（idle 守卫，`blue/request-fork`） |
| `/btw` | ✅ | — | ✅ | — | ✅ 已发货（pane-btw.ts 自注册） |
| `/undo` | ✅ | — | `/rewind` | — | ⛔ §7 #2（会话原地撤销；checkpoint-policy 仅崩溃恢复、session-reference 仅跨会话引用，均非撤销） |
| `/title` (`rename`) | ✅ | `/name` | — | `/rename` | 🚫 **命令不做（2026-08-22 用户裁决，S30 拆步①）**：标题全自动——bundle 换 all-prompts 节奏（随会话流更新、歪标题自纠），展示走 OSC 0 终端标题 + footer 条目；无手动改名入口（roadmap「预览版发版冲刺」S30 行） |
| `/session` | — | ✅ | — | — | 🚫 /status + /sessions 覆盖 |
| `/tree` | — | ✅ | — | — | 🚫 /sessions + /fork 覆盖（lineage 仅可作 /sessions 可选增强列） |
| `/branch` | — | — | ✅ | — | 🚫 同上（会话分叉 = fork 新会话） |
| `/clone` | — | ✅ | — | — | 🚫 同上 |
| `/archive` / `/delete` | — | — | — | ✅ | ⛔ 顺延（persistence 无删除原语，§7 #10） |
| `/rename` | 别名 | — | — | ✅ | ⛔ §7 #3 |
| `/cd` | — | — | ✅ | — | 🚫 会话 cwd 创建时钉死，无切换原语 |
| `/trust` | — | ✅ | — | — | 🚫 信任文件夹无 harness 概念 |
| `/reload` | ✅ | ✅ | — | — | **S28** 待建（Blue 自有 settings + 主题重挂，⚠️ 语义近似） |
| `/reload-tui` | ✅ | — | — | — | 🚫 = /reload 子集，不做独立命令 |

### 2.3 导出导入与复制

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/export` (`export-md`) | ✅ | ✅ | ✅ | — | ✅ **S26 已落地（2026-08-21）**：fold.ts 折叠 → Markdown（readRaw + session flush 先行）；上游另有 Web-only ZIP 版 dsh-session-log-export，TUI 独立实现，§3.2 |
| `/export-debug-zip` | ✅ | — | — | — | 🚫 /debug 覆盖诊断导出 |
| `/import` | — | ✅ | ✅ | ✅ | ⚠️ 顺延（SESSION_FORMAT_VERSION=0 格式严格性） |
| `/copy` | ✅ | ✅ | ✅ | ✅ | ✅ **S26 已落地（2026-08-21）**：剪贴板写管线（clipboard-write.ts，OSC 52 先行 + wl-copy/xclip/pbcopy/clip.exe 验证路径，SSH 回退 unverified 报告） |
| `/share` | — | ✅ | — | — | 🚫 gist 分享无上游 |
| `/web` | ✅ | — | — | — | 🚫 web 服务非 Blue 职责 |
| `/zip-archive` | — | — | ✅ | — | 🚫 文件工具，`!` shell 覆盖 |

### 2.4 信息与用量

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/status` | ✅ | — | ✅ | ✅ | ✅ 已发货（S25 落地 2026-08-21：`InfoPanel` 两列只读面板——header 事实 + sessionStats 投影 turns/steps（边界事件折回退）+ modelRef 选择 + 版本行 + 上下文窗占用条，§4.2） |
| `/context`（原 `/usage`） | ✅（名为 /usage） | — | ✅ | — | ✅ 已发货（S25 落地 2026-08-21，**2026-08-21 用户裁决更名 `/context`**——CC 的 /context 本就是上下文占用面板；同 `InfoPanel`——四桶 + 总数 + 占用条 + **CC 式构成分节**（2026-08-21 验收轮用户裁决补入：`contextBreakdown` 投影的启发式 system/tools/message 构成，`█▓▒░` 堆叠条 + 组件行 + free 余量，标题标 heuristic；仅投影主机有此节）；`sessionProjections.snapshot` 读投影（跨 resume 重放正确），降级主机走 `usage.ts` 纯折，§4.2） |
| `/cost` | — | — | ✅ (别名 /usage) | — | 🚫 无 usage/cost 服务，定价表维护不值 |
| `/version` | ✅ | — | — | — | ✅ 已发货（S25 落地 2026-08-21：notice——`BLUE_VERSION` + harness rc 尾 + 当前模型（无会话时省略）） |
| `/help` (`h`,`?`) | ✅ | — | ✅ | ✅ | ✅ 已发货（HelpOverlay 双列） |
| `/hotkeys` | — | ✅ | — | — | 🚫 不做（用户裁决 2026-08-21：低价值，/help 已覆盖键位面） |
| `/keybindings` / `/keymap` | — | — | ✅ | ✅ | 🚫 /help 已覆盖查看；编辑面不做 |
| `/changelog` | — | ✅ | — | — | 🚫 banner what's-new 已承担（面板形式 ⚠️ 顺延） |
| `/whereami` | — | — | ✅ | — | 🚫 = /status 子集 |
| `/recap` | — | — | ✅ | — | 🚫 会话摘要无上游 |

### 2.5 模式与策略

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/yolo` (`yes`) | ✅ | — | — | — | ✅ 已发货（S24a 落地 2026-08-21：answerer 侧自动放行——`approval.setPolicy('never')` 是『不问即拒』且在 waterfall 派发前即拒，故 policy 保持 `'ask'`、`approval-plugin.ts` 的 answerer 即 yolo 面；持久化折 `command/run`（name='yolo'）事件，见 §4.2.2 勘误；Shift+Tab 三态循环 normal→plan→yolo 与 `blue-status-mode` 徽标一并落地） |
| `/auto` | ✅ | — | — | — | 🚫 暂不做（用户裁决 2026-08-21：/yolo 语义即 dsh 对应面；questions 自动应答另立项再议——需要时复用 /yolo 开关 + user-questions 自动应答 provider 即可，无上游缝） |
| `/permission` | ✅ | — | `/permissions` | ✅ | ✅ 已发货（S24b 落地 2026-08-21）：命令随上游现成零实现（dsh-permission-presets，§2.10）；裸 `/permission` 经输入层拦截开选择器面板（读 `ctx.permissionPresets`——服务读 ≡ `permissions` 投影 fold，D33 措辞勘误），选中提交 `/permission <name>` 同一写路径；danger-full-access 必经 typed-y 确认 gate |
| `/plan` | ✅ | — | ✅ | ✅ | ✅ 随上游现成（dsh-plan-mode 随 rc.7 发布，插件自注册 /plan [msg]+off、exit_plan_mode 工具；Blue 零实现，plan-review 专用呈现 ✅ S24b 落地，见 §7 #5） |
| `/goal` | ✅ | — | ✅ | — | ✅ 上游现成（ctx.goals + round-driver + /goal 命令 + tool-goal，均在 base，§2.10） |
| `/swarm` | ✅ | — | — | — | 🚫 编排面现成（workflow 引擎 + tool-workflow 模型工具，门控"仅用户明确要求"，§3.2）但无 swarm 命令形态；Blue 不建 |
| `/approve` | — | — | — | ✅ | 🚫 审批面板已承担 |
| `/raw` / `/personality` / `/mute` / `/memories` | — | — | — | ✅ | 🚫 产品特定（memory 无上游） |
| `/experiments` / `/experimental` | ✅ | — | — | ✅ | 🚫 无实验特性管线 |

### 2.6 配置

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/preset [name]` | — | — | — | — | ✅ **S28 已落地（2026-08-21，D33+D37）**：agent 组合预设切换——`ctx.agentPresets.list/recompose`，自建空会话守卫（`turn/start` 缺席）+ `agent-preset/selected` 事件配对；bundle patch 加 agent-presets 行 + 包依赖，**薄宿主迁移（D37）后为真替换语义**，blue-app 建 agent 挂预设、resume 折事件重建 |
| `/settings` (`config`) | ✅ | ✅ | `/config` | — | **S28** 待建（Blue 自有命名空间可写，harness 命名空间只读列出，⚠️） |
| `/theme` | ✅ | — | ✅ | — | ✅ 已发货（theme-switch.ts） |
| `/editor` | ✅ | — | — | — | 🚫 外部编辑器 Ctrl-G 未实现（roadmap P2 挂起） |
| `/injections`（原拟 `/context`，注入显隐） | — | — | ✅ | — | 🚫 不做（**2026-08-21 用户裁决**：注入上下文维持 D28/S19 默认隐藏，不开显隐开关——原 S27' 范围项撤销，roadmap「预览版后挂起区」有条目；真实需求出现再议） |
| `/add-dir` | ✅ | — | ✅ | — | 🚫 会话 cwd 无附加目录原语（roadmap 层无 surface） |
| `/vim` | — | — | ✅ | ✅ | 🚫 需编辑器 provider 实现（P3 缝槽，rc.7 无） |
| `/color` | — | — | ✅ | — | 🚫 主题契约已覆盖 |

### 2.7 生态与运维

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/mcp` | ✅ | — | ✅ | ✅ | **✅ S34 已落地（2026-08-22，S28 顺延项提前——用户裁决 + 三裁决 D40：只读维持、两步面板、双口径计数）**：`mcp-servers.ts` 薄读层——`ctx.loader.entries()` 过滤 `options.name === '@deepseek-ai/dsh-mcp-client'`（修正 D36 的"moduleName"措辞；归一化配置读 `entry.fiber.config`、原始兜底 `options.config`）+ 双口径计数（**会话可见 = 展示口径（用户裁决）+ 全局注册 = 健康信号（restricted ≠ dead 可区分）**，scope 解析抽 `tool-scope.ts` 与 /tools 共享）+ 状态推导七态（synced/restricted/no-tools/starting/failed/reloading/disabled）+ env/headers 只显 key（kimi config-view 脱敏纪律）；`mcp-commands.ts` 三层面板（选器 → 服务器面板（config 伪行 + raw 名工具行）→ config/工具 schema 详情，后者复用 `buildToolDetailSections`）；空态指路 website dsh/mcp 页（非表单——服务器声明留 profile patch，D36 维持）；bundle dependencies 带钉版 dsh-mcp-client（**runtime deps 首入 version.spec 门禁**）；管理面维持 ⛔ §7 #6；快照式（live 四信号刷新记 D40 挂起） |
| `/skills` | — | — | ✅ | ✅ | ✅ **S29 已落地（2026-08-21）**（D34：`#` skills 提示符管线 + `/skills` 列表命令；技能**不进 slash 命名空间**，调用走上游手势路径（tool-skill pre-step `/name` 注入）；§7 #7 缝撤销） |
| `/plugins` | ✅ | — | ✅ | ✅ | 🚫 组合层已承担启停；CLI 另有 `dsh plugin --profile add`（安装外部插件包） |
| `/apps` | — | — | — | ✅ | 🚫 无 connector 概念 |
| `/hooks` | — | — | ✅ | ✅ | 🚫 命令不做；上游现成 hooks 兼容桥（dsh-hooks-claude-code / hooks-codex 方言，rc.5 未随 rc.6 发布，§3.2） |
| `/tools` | ✅ | — | — | — | ✅ **S28 已落地（2026-08-21，dogfood 二轮改为两段式）**：选择器面板（工具名 + 首句简介）→ Enter 叠详情 InfoPanel（name/server、描述折行、参数逐行 + required 标注，Esc 逐层退回）；枚举经 `schemas(roster.standingKeyFor(...))`（跨 store 安全，D37 后记）；fold 兜底路线未采用 |
| `/tasks` (`task`) | ✅ | — | ✅ | ✅ | **S28** 待建（⚠️ Adapt：todo 面板 + jobs 视图；ctx.jobs + tool-jobs 现成，§3.2） |
| `/init` | ✅ | — | ✅ | ✅ | ✅ 已发货（S27' 落地 2026-08-21：`interaction/src/session-init.ts` 罐头提示 followup 写 AGENTS.md + idle 守卫拒绝并发） |
| `/login` / `/logout` | ✅ | ✅ | ✅ | — | 🚫 认证面由 harness settings/凭据承担 |
| `/doctor` | — | — | ✅ | ✅ | 🚫 与 /debug 合并（做一不做二） |
| `/debug` | — | — | ✅ | — | 🚫 需诊断导出面（⛔ 顺延，随 §7 #10 后的诊断缝） |
| `/feedback` (`bug`) | ✅ | — | ✅ | ✅ | ✅ 上游现成（/feedback 命令 + feedback/record 事件，telemetry 共享状态，§2.10） |
| `/upgrade` / `/update` | — | — | ✅ | — | 🚫 更新面由 dsh 包管理承担 |

### 2.8 产品特定（不进入命令面合并）

| 命令 | 来源 | 理由 |
|---|---|---|
| `/llama` | pi | 本地模型运行；harness 无本地模型后端 |
| `/dance` | kimi | 隐藏彩蛋 |
| `/radio` / `/powerup` / `/passes` / `/mobile` / `/desktop` | CC | 无关功能/账户产品/远程 surface |
| `/background` / `/subtask` / `/agent` / `/subagents` / `/list-agents` | CC/Codex | 子 agent 系统现成（ctx.subagents + spawn/fork + 全套工具，base，§3.2）；命令视图可做但非本期（⚠️ 顺延） |
| `/batch` / `/autofix-pr` | CC | 批量编排/CI 集成产品 |
| `/teleport` / `/remote-control` / `/ide` | CC/Codex | 远程/桌面 surface 不存在 |
| `/import` (CC/Codex 语义) | CC/Codex | 配置迁移面（pi 的 JSONL /import 在 §2.3 已单列） |

### 2.9 Blue 已发货命令映射（15 条）

| 命令 | 各家同义 | Blue 注册位置 | 落地 |
|---|---|---|---|
| `/quit`（别名 `/q` `/exit`） | kimi/pi/CC/Codex `exit`/`quit`/`q` | `packages/interaction/src/commands-plugin.ts` → `ctx.get('appExit')(0)` | ✅ S6（别名 ✅ 2026-08-20，§2.12 首例） |
| `/sessions [<id>]`（别名 `/resume`） | 四家 | `commands-plugin.ts`（带参直发 `'blue/request-resume'`，无参走 picker；2026-08-21 并入） | ✅ S6 · S24a |
| `/new`（别名 `/clear`） | kimi `clear`、CC `clear`/`reset` | `commands-plugin.ts` → `'blue/request-new'`（别名 S27' 2026-08-21） | ✅ S6 |
| `/fork` | kimi/pi/CC | `commands-plugin.ts` → `'blue/request-fork'`（idle 守卫） | ✅ S6 |
| `/sessions` | kimi `sessions`、pi `resume` | `commands-plugin.ts` → `sessionPersistence.list` picker（D30 editor-slot 替换） | ✅ S6 |
| `/help` | kimi `help`/`h`/`?`、CC/Codex | `commands-plugin.ts` → `HelpOverlay`（commands + keys 双列） | ✅ S6 |
| `/theme` | kimi/CC | `packages/interaction/src/theme-switch.ts`（provider 换装） | ✅ S4 |
| `/btw <question>` | kimi/CC | `packages/transcript/src/pane-btw.ts`（fork 旁路 agent） | ✅ S6 |
| `/model [name]` | 四家 | `packages/interaction/src/model-commands.ts`（picker：`model-panel.ts`，底部 thinking 段控件） | ✅ S23（2026-08-20） |
| `/effort [level]`（别名 `thinking`） | kimi/CC | `model-commands.ts`（`EffortPanel` 水平分段，`thinking-segments.ts` 共享段 chrome） | ✅ S23（2026-08-20） |
| `/provider [list\|switch <name>\|add]` | kimi | `model-commands.ts` + `provider-add.ts`（ProviderPanel + 向导；`form-panel.ts` 表单面） | ✅ S23（2026-08-20，含 Add） |
| `/status` | kimi/CC/Codex | `packages/interaction/src/session-commands.ts`（`InfoPanel` 两列只读面板：`info-panel.ts`；数字读 `usage.ts` 薄层） | ✅ S25（2026-08-21） |
| `/context`（kimi `/usage` 同款） | kimi/CC | `session-commands.ts`（同 `InfoPanel`；tokenUsage/contextPressure 投影 + `assistant/*` 折回退） | ✅ S25（2026-08-21，落地后用户裁决由 /usage 更名） |
| `/version` | kimi | `session-commands.ts` → notice（`BLUE_VERSION` + harness rc 行 + 当前模型） | ✅ S25（2026-08-21） |
| `/init` | kimi/CC/Codex | `packages/interaction/src/session-init.ts`（罐头提示 followup + idle 守卫） | ✅ S27'（2026-08-21） |

### 2.10 上游插件自带命令（6 条，随 base 组合自动注册，Blue 零实现）

| 命令 | 注册包 | 参数 | 行为 | Blue 侧 |
|---|---|---|---|---|
| `/compact` | dsh-command-compact | 无参（带参报 Usage） | `ctx.compaction.compactNow(agent, signal, commandId)`；回执 shadowed 条数/token 数 | 零实现，/help 自动枚举 |
| `/plan [message]` / `/plan off` | dsh-plan-mode | 见 §7 #5 | 进入/退出 plan 模式；`<message>` 先进入再 steer | 零实现（plan-review 专用呈现 ✅ S24b：interaction `plan-review-panel.ts`） |
| `/goal [obj\|clear\|edit <obj>\|pause\|resume]` | dsh-command-goal | 见左 | 查看/创建/替换持久化同会话目标（GoalRef CAS） | 零实现 |
| `/permission [preset]` | dsh-permission-presets | read-only / workspace-write / danger-full-access（rc.8 base 组合扩表）+ custom 派生态 | 捆绑 sandbox 模式 + approval policy 预设切换，`permission/preset` 事件 | 命令零实现；选择器面板 ✅ S24b（D33：裸命令输入层拦截 + typed-y danger gate） |
| `/feedback <text>` | dsh-command-feedback | 必填 | 追加 `feedback/record` 日志事件（telemetry 共享状态） | 零实现 |
| `/export` | dsh-session-log-export | 无参 | Web-only：流式 ZIP 会话日志下载（浏览器下载管理器） | Blue TUI 版 S26 独立实现 |

> 全部为人类命令面（log-only、模型不可见、零 token）；`/help` 自动枚举已覆盖，Blue 无注册成本。§2.9 已发货表只列 Blue 自注册命令，本条与之正交。

### 2.12 命令别名机制（✅ 已落地 2026-08-20，提前于 S23）

**形态**（kimi 同构，见 §2.11 的 `aliases` 差距）：dsh-commands rc.7 的 `CommandDefinition` 无别名元数据，别名关系由 Blue 侧 `interaction/src/command-meta.ts` 注册表持有；**别名不注册为独立命令**——`blue-input` 提交时经 `parseCommand` 解析出名字后查 `canonicalOf`，命中则把行重写为 `/canonical` + 原 rawInput 再走 `ctx.commands.execute`（input-plugin 是唯一执行入口，已核实），因此 `command/run` 生命周期事件恒记 canonical 名，显示面天然只有 canonical 注册（零去重）。

**kimi 对齐逐项**（以 kimi-code `apps/kimi-code/src/tui/commands/` 源码核实）：

| 面 | 行为 |
|---|---|
| 执行解析 | `canonicalOf(alias)` → 重写 `/canonical`（kimi `findBuiltInSlashCommand`：name 或 aliases 命中，canonical 名拥有 handler） |
| 补全/hint 匹配 | canonical 名先 scoreTokens，miss 才逐个试别名取最佳分（slash-filter `matchCommand`）；同分 canonical 命中排在别名命中前（kimi 排序规则） |
| 下拉/hint label | 仅别名命中时显示 `/${canonical} (alias, alias)`（kimi label 规则，别名不带斜杠）；canonical 命中显示纯名；value 恒补全为 canonical 名 |
| /help | 恒显示 `/${canonical} (/alias, /alias)`（kimi help-panel 规则，别名带斜杠） |
| 参数幽灵提示 | `/alias ` 经 `canonicalOf` 解析到 canonical 的 `input.hint`（与执行重写同一解析） |
| 冲突 | 别名被其它 canonical 占用 → 启动期 fail-loud；alias 等于自身 canonical → 拒绝；同 canonical 重注册 = last-wins 替换（disposer 分代，旧 fiber 的 disposer 不清新注册） |

**首例**：`/quit` 别名 `q`、`exit`（commands-plugin.ts 注册 `registerCommandAliases('quit', ['q', 'exit'])`）。第二消费者已落地：S27' `/clear` = `/new` 别名（§4.2，2026-08-21，`registerCommandAliases('new', ['clear'])`，无真实注册——补全下拉别名标注 + 执行语义等同 /new 均有 e2e）。上游缝 #9（`CommandDefinition.aliases`）落地后本层可退化为声明式（§4.1 第 4 条修正注记）。

### 2.11 kimi registry 元数据字段 vs dsh-commands rc.7

kimi `KimiSlashCommand`（`apps/kimi-code/src/tui/commands/types.ts`）声明的元数据：`argumentHint`（补全行内提示）、`completeArgs(prefix)`（参数补全器）、`availability: 'always' | 'idle-only' | fn`（流式期间可用性）、`experimentalFlag`（实验门控隐藏）、`aliases`。dsh-commands rc.7 `CommandDefinition`（`dsh-commands/lib/index.js` `normalizeDefinition`）仅有 `name/description/input?/recordInput?/handler`，**无元数据字段**。差距与 Blue 侧落点：

- `input.hint` 已有（`/resume` 已用）→ 补全行内提示 ✅ 现成
- `aliases` → Blue 侧 `command-meta.ts` 注册表（✅ 已落地 2026-08-20，机制与消费见 §2.12；S27' `/clear` 已消费 2026-08-21）；上游 nice-to-have 缝（§7 #9）维持
- `availability` → Blue 侧 handler 内 idle 守卫（/fork 先例），不做声明式
- `argumentHint` 幽灵提示 → S14 已实现 `setGhostHint` + `computeArgumentHint`，新命令参数提示走该链路

## 3. harness 能力支撑矩阵

行 = rc.7 能力面（逐符号核实）；列 = 命令族；格 = 可行性 + 一句证据。

| 能力面 | 模型族 /model /effort /provider | 自治族 /yolo /auto | 信息族 /status /usage /version | 导出族 /export /copy /import | 轻命令族 /init /clear /context /diff | 配置族 /settings /reload /tools /tasks |
|---|---|---|---|---|---|---|
| `ctx.commands`（register/list/scoped/command-run+done 事件） | ✅ 现成 | ✅ 现成 | ✅ 现成 | ✅ 现成 | ✅ 现成 | ✅ 现成 |
| Agent（followup/steer/send/inject/cancel/whenIdle/status/inbox） | — | ✅ /auto 需 questions 自动应答 | ✅ /status 读 status | — | ✅ /init followup + idle 守卫 | — |
| ModelSelection + installModelSelection（app 已挂三条路径） | ⚠️ 需新缝 BlueSessionRef.modelRef（§4.2.1） | — | ✅ /status 读 selection | — | — | — |
| dsh-llm（listProviders/listModels/listConfigurableProviders + LlmResolvedModelInfo{context,reasoning}） | ✅ 现成（列表+元数据+补全源） | — | ✅ /status 显示 model/provider | — | — | — |
| dsh-agent-default-model（saveSelection 持久默认） | ✅ 现成 | — | — | — | — | — |
| approval（setPolicy 'ask'/'never' + 'approval/policy' 事件 + effectiveApprovalPolicy 折叠） | — | ✅ 现成（'never' + Blue answerer 侧自动模式） | — | — | — | — |
| user-questions（registerProvider/ASK_*） | — | ✅ 现成（/auto 自动作答） | — | — | — | — |
| sessionPersistence（list/readRaw/supportsRawArtifacts/prepare） | — | — | — | ✅ /export 现成（jsonl 后端 supportsRawArtifacts=true 已核实）；/import ⚠️ prepare+seed 可行但格式严格 | — | — |
| dsh-tools ToolRuntime（register/presentAs/restrict/guard + **schemas(scope)** 可见工具枚举，§7 #8 已解决） | — | — | — | — | — | ✅ /tools 消费 schemas() 真枚举（S28） |
| dsh-settings（settingsNamespace + register + get/patch） | — | — | — | — | ✅ /context 开关持久 | ⚠️ /settings 仅 Blue 自有命名空间可写 |
| 会话事件面（turn/step/user/assistant/tool/todo/request/command/approval 全系） | — | ✅ 'approval/policy' 折叠 | ✅ fold turn/assistant-message.usage/request-context | — | ✅ fold 注入上下文（source.kind!=='user'，D28） | ✅ fold todo/write（pane-todo 同源） |
| dsh-cmdline（appExit + cmdlineArgs） | — | — | — | — | — | —（/quit 已用） |
| attachments（dsh-attachment 纯图片） | — | — | — | — | — | —（与命令面无关） |

### 3.1 已排除能力面（逐条证据）

| 能力面 | 现状证据（2026-08-20 复核） | 影响 |
|---|---|---|
| 会话原地撤销 | 唯一原语仍是 fork 产新会话（`agents.create` seed）；dsh-session-checkpoint-policy 仅崩溃恢复（wrap llm/stream + tools/execute 落盘 flush，失败 fail-closed），非撤销语义；dsh-session-reference 仅跨会话引用 | /undo ⛔（§7 #2）维持 |
| MCP 管理面 | dsh-mcp-client 现成（每插件实例连一个外部服务器，stdio/HTTP，`mcp__<server>__<tool>` 自动注册）；**无 listServers/启停管理 API**；默认组合不启用（服务器命令是沙箱外可信可执行代码） | /mcp ⚠️ 收窄（§7 #6） |
| 命令元数据 | `normalizeDefinition` 仍仅 name/description/input/recordInput/handler | 别名/可用性落 Blue 侧 command-meta（§4.1；§7 #9 维持） |
| 会话删除/归档 | persistence 仍无 delete/archive 原语（locate/create/append/prepare/load/inspect/readFrom/list/listSnapshots） | /delete /archive ⛔ 顺延（§7 #10 维持） |

> 初版本表其余行（compaction 入口、会话标题、权限预设、skills 系统、工具枚举、usage/cost 服务）已随 rc.7 家族落地，移入 §3.2 能力全景表，不再列入排除。

### 3.2 新增现成能力面（2026-08-20 系统复核追加）

行 = rc.7 家族已发布且（除标注外）随 harness CLI base 组合默认装载的能力面；列 = 关键 API/事件 + 对本文档命令判定的影响。补充 §3 矩阵之未列（§3 矩阵建于初版依赖闭包，未含以下各行）。

| 能力面 | 包 | 默认组合 | 关键 API / 事件 | 文档影响 |
|---|---|---|---|---|
| 压缩 | dsh-compaction / compaction-basic / command-compact / compaction-tool-result-pruner | ✅ base | `ctx.compaction.compactIfNeeded/compactNow/compactRegion`；`/compact` 命令（无参）；SessionStartSource 含 'compact' | §7 #1 已解决；/compact 零实现 |
| 会话标题 | dsh-session-title / -first-prompt-llm | ✅ base | `ctx.sessionTitle.get/rename/refresh/register`；`session/title` 事件（log-only）；title 投影；客户端 `session.rename` RPC | §7 #3 收窄为命令层 |
| 权限预设 | dsh-permission-presets | ✅ base | `ctx.permissionPresets.set/current/optionOf/names/defaultPreset`；`/permission` 命令；`permission/preset` 事件；PERMISSION_SETTINGS_NAMESPACE | §7 #4 已解决 |
| skills 系统 | dsh-skill / skill-filesystem / skill-badge / tool-skill | ✅ base | `ctx.skills.list/snapshot/get/registerProvider`；tool `skill`；手势路径（tool-skill pre-step 扫 user 消息 `/name` token 注入技能体，`isUserInvocable` 过滤）；`skills/change` | §7 #7 已撤销（D34：`#` 提示符消费，S29） |
| 后台任务 | dsh-jobs / jobs-local / tool-jobs | ✅ base | `ctx.jobs.start/get/list/kill/wait`（owner 按 SessionId 隔离）；tool `job_output/job_list/job_kill`；进程内无持久化 | /tasks 映射扩展（todo 面板 + jobs 视图） |
| 目标引擎 | dsh-goal / goal-round-driver / command-goal / tool-goal | ✅ base | `ctx.goals.create/edit/pause/resume/complete/blocked/clear`（GoalRef CAS）；`/goal` 命令；`goal/change` 事件 | /goal 转 ✅ |
| 子 agent | dsh-subagent / spawn-in-process / fork-in-process / tool-subagent(-control/-report) | ✅ base | `ctx.subagents.start/startContinuable/followup/interrupt/reportFrom/listChildren/listDescendants`；`subagent/start+end`；tool `subagent/subagent_fork/send_message/interrupt_agent/list_agents/report` | "单 agent fiber"前提过时；视图命令 ⚠️ 顺延 |
| 工作流编排 | dsh-workflow / workflow-worker-thread / tool-workflow | ✅ base | `ctx.workflowEngine.start`；tool `workflow`（门控"仅用户明确要求"；worker 非安全边界） | /swarm 理由更新（模型工具非命令） |
| 用量计量 | dsh-token-meter / session-stats | ✅ base | `ctx.tokenMeter.measure`（重放感知）；tokenUsage/contextPressure/contextBreakdown 投影；sessionStats（turns/steps/llmMs/toolMs/ttft/decode） | /usage /status 消费现成（S25） |
| 会话查询 | dsh-session-query / session-query-sqlite | ✅ base | `ctx.sessionQuery.searchSessions/searchEvents/listSessions/readSurface/traceSession`（SQLite FTS5） | /status、/sessions 增强现成 |
| 会话投影 | dsh-session-projection (+cache) | ✅ base | `ctx.sessionProjections.register/onChanged/checkpoint/restore` | UI 消费基座现成 |
| 反馈 | dsh-command-feedback / message-feedback | ✅ base | `/feedback <text>` 命令；`feedback/record` 事件；侧车赞踩存储（CAS） | /feedback 转 ✅ |
| 遥测 | dsh-session-telemetry / -otel | ✅ base（默认 DISABLED） | `ctx.sessionTelemetry`；DSH_TELEMETRY_MODE=FULL/FEEDBACK_ONLY；OTLP 导出 | /feedback 共享 sharing 状态 |
| 会话引用 | dsh-session-reference | ⚠️ 未入 base 列表 | `ctx.sessionReferenceResolver`；`dsh-session:` URI + `@[label](uri)` mention | @ 补全扩展面（非命令） |
| AGENTS.md 加载 | dsh-agent-instructions | ✅ base+preset | 基线/嵌套发现/变更注入（system-reminder 框架，持久 user/message） | /init 只做写文件侧（S27） |
| 预设系统 | dsh-agent-presets | ✅（CLI 组合） | `ctx.agentPresets.list/mount/recompose`；settings 命名空间 `agent-presets` | 组合面（非命令） |
| MCP 客户端 | dsh-mcp-client | ⚠️ CLI 依赖，默认不启用 | 每实例一服务器（stdio/HTTP）；`mcp__*` 工具自动注册；指数退避重连 | §7 #6 收窄 |
| 钩子桥 | dsh-hooks-claude-code / hooks-codex（源码 rc.5） | ❌ 未随 rc.6 | CC/Codex hooks.json 方言 → harness 拦截点（Decision 映射） | /hooks 理由更新 |
| Web/远程面 | dsh-web + tool-web + web-search-deepseek / client-connection + api-gateway + api-remotes | ✅ base / ✅ web 组合 | `ctx.web.search/fetch`；tool `web_search/web_fetch`；浏览器 RPC `/api` 桥 + 信任栅栏；11 事件白名单转发 | /web 🚫 维持；远程 surface 存在（非命令） |
| 其他 | dsh-persona / dsh-schedule / dsh-time-context / dsh-tmux-context | ✅ preset / ⚠️ 可选 | persona prompt 段（{{model}}/{{cwd}}）；schedule_create/list/delete 工具；opt-in 时间/tmux 上下文 | 非命令，维持 🚫/无关 |

## 4. 实施清单（逐命令）

### 4.1 命令注册纪律（新命令共同遵守）

1. **effect-bound 注册**：沿用 commands-plugin.ts 现有模式——`ctx.effect(() => { ... register ...; return disposers })`，fiber 卸载即注销。
2. **display 服务一律 handler 内 `ctx.get` 惰性解析**，不 inject `blueTheme` 等显示服务——`/theme` 换装会 dispose 自己 handler 所在 fiber 的雷（S6 教训）。
3. **会话切换类命令 idle 守卫**（/fork 先例：`blueSession.current.status !== 'idle'` 报错）；**模型类命令无需守卫**（installModelSelection 下一 step 生效，语义天然安全）。
4. **新模块 `interaction/src/command-meta.ts`**：Blue 侧命令元数据注册表（别名 → 主命令名、可选 availability 提示），slash 补全与 editor-plus 消费。（✅ 已落地 2026-08-20，机制见 §2.12；初版"每条别名仍实际注册一条命令"已修正为 kimi 式执行时解析——别名不注册，`blue-input` 提交时经 `canonicalOf` 重写为 canonical 行再 execute，语义一致且显示面零去重；`/clear` 别名与 `availability` 提示的消费随 S27 落地），上游缝 #9 落地后可退化为声明。
5. **/help 自动枚举**（`commands.list` + `keymap.list()`），新命令零维护。
6. **对话框一律 D30 editor-slot 替换挂载**（`mountEditorReplacement`），非浮层；列表类面板复用 `SessionList`/`BlueSelect` + `framePanel`/`topRule` chrome。
7. **门禁**（每 S 步）：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；README 双语同步；bundle e2e 用例随步增加。

### 4.2 待建命令表（S23-S29，23 条；2026-08-21 修订：/hotkeys 🚫 /diff 发版后移出，/title 随 S30 移入预览版冲刺——发版范围净 22 条）

| 命令 | 来源 | 参数与补全 | 行为 | UI 表面 | 能力依赖 | S 步 | 备注 |
|---|---|---|---|---|---|---|---|
| `/model [name]` | kimi/CC/Codex | 无参=列表；补全=llm.listModels | 切换当前会话模型；无参打开选择器；`saveSelection` 持久默认 | BlueSelect 面板（mountEditorReplacement，/sessions 模式） | ✅ 新缝 BlueSessionRef.modelRef（§4.2.1）；llm.listModels/resolveModelInfo；agentDefaultModel.saveSelection | S23 | 无需 idle 守卫（下一 step 生效）；选项显示 context window + reasoning 元数据 |
| `/effort [level]` | kimi/CC | 补全=resolveModelInfo().reasoning.efforts | 写 selection.current.reasoningEffort | 列表面板 | ✅ 同 /model；LlmModelReasoningInfo{efforts, defaultEffort} | S23 | 无效 effort 报错（adapter 也拒） |
| `/provider [list\|switch <name>]` | kimi | 无参=列表 | 列 providers、切换活跃 route（重置 model 为 provider 默认） | 列表面板 | ✅ llm.listProviders + listConfigurableProviders | S23 | add/refresh 需 discoverModels + 凭据输入面 + settings 命名空间 → ⚠️ 顺延 |
| `/yolo` | kimi/CC | — | 切换自动放行工具审批 | notice + blueStatus 新条目（策略徽章 `blue-status-mode`：plan accent / plan… pending / yolo warning，normal 隐藏） | ✅ answerer 分支（approval-plugin.ts，§4.2.2 勘误：policy 保持 'ask'）；持久化折 `command/run`（name='yolo'）——裸关重派发显式 `/yolo off` 落定折记录；resume/fork 折回、/new 归零 | ✅ S24a（2026-08-21） | 提问仍弹（userQuestions 独立服务）——kimi 语义一致；Shift+Tab 三态循环与互斥见 §4.2.2 |
| `/auto` | kimi/CC | — | 完全自治 = yolo + questions answerer 自动默认应答 | 同上 | ✅ yolo 开关复用 + user-questions 注册自动应答 provider | 🚫 暂不做 | 用户裁决（2026-08-21，以后再考虑）；关闭恢复提问 |
| `/status` | kimi/CC/Codex | — | 会话 id/cwd/创建时间、模型/provider、turn 数、agent 状态、版本 | HelpOverlay 式两列只读面板（`InfoPanel`） | ✅ session.header、modelRef/requestHeader()?.config、sessionStats 投影（边界事件折回退）、agent.status | ✅ S25（2026-08-21） | |
| `/context`（原 `/usage`，2026-08-21 用户裁决更名——CC 语义） | kimi(/usage)/CC(/context) | — | 累计 input/output/cacheRead/cacheWrite/reasoning tokens + contextWindow 百分比 + **CC 式构成分解**（验收轮裁决：system/tools/messages/free，`contextBreakdown` 投影） | 面板（`InfoPanel`） | ✅ sessionProjections.snapshot 读 tokenUsage/contextPressure/contextBreakdown 投影（§3.2）；`usage.ts` 纯折 assistant/* usage 兜底（replace-per-step 语义），构成节无投影即省略（估算器归上游，Blue 不复刻） | ✅ S25（2026-08-21） | 投影折整条持久日志，跨 resume 重放正确；Blue 不设累计器；构成节标题标 heuristic |
| `/version` | kimi | — | BLUE_VERSION + harness rc.7 + 当前模型 | notice | ✅ banner-content.ts 常量（spec 守卫 package.json 先例；经新增 `./banner-content` 子路径导出跨包读取）；**版本管控**（2026-08-21 用户裁决）：`packages/transcript/tests/version.spec.ts` 守卫五包 version + BLUE_VERSION + 全部 dsh-* dev 钉版/peer 区间/workspace excludes 同一 lockstep 线 | ✅ S25（2026-08-21） | |
| `/export [full] [path]` | kimi/pi/CC | 默认路径 | fold.ts 折叠 → Markdown 文件写；`full` 关键字 = 事件流直出完整版（不折叠不过滤，注入带 source 标注） | notice + 路径回显 | ✅ persistence.readRaw（jsonl 后端 supportsRawArtifacts=true 已核实）+ `ctx.sessions.flush` 先冲刷 + fs | S26 | kimi /export-md 同款；debug-zip 不做；上游 Web-only ZIP 版（dsh-session-log-export，§2.10）仅供浏览器面，TUI 独立实现 |
| `/copy` | kimi/CC/Codex | — | 复制最近一条 assistant 消息文本 | notice（native 计数 / osc52 unverified） | ✅ Blue 侧剪贴板写管线（interaction/src/clipboard-write.ts，注入式探测 wl-copy/xclip/pbcopy/clip.exe，沿 paste-image reader 先例）；OSC 52 ✅ 随批落地（core/terminal-escape.ts 先行发射、工具全败时回退 unverified 报告——原"主屏不可用"经核实系 alt-screen 连坐，纯转义与 scrollback 无关） | S26 | |
| `/init` | kimi/CC/Codex | — | 罐头提示 followup（分析代码库写 AGENTS.md） | notice | ✅ agent.followup；idle 守卫 | ✅ S27'（2026-08-21） | AGENTS.md 加载面已上游（dsh-agent-instructions，base，§3.2）；/init 仅罐头提示写文件（kimi 文案精神，英文正文，`session-init.ts`）；罐头提示族（/security-review 等）只做这一个，留缝 |
| `/clear` | kimi(别名)/CC/Codex | — | = /new 语义（kimi 同款；CC"清 transcript 留会话"无原语） | — | ✅ 经 command-meta 别名（§2.12） | ✅ S27'（2026-08-21） | `registerCommandAliases('new', ['clear'])` 一行落地；e2e：下拉别名标注 `/new (clear)` + 执行后 sessionChanges 增长（同 /new） |
| `/injections`（2026-08-21 定名——原拟 `/context` 已被 S25 按 CC 语义用于占用面板） | CC | — | 切换注入上下文显隐（D28/S19 默认隐藏的反向开关） | — | 🚫 | 🚫 不做 | **2026-08-21 用户裁决**：注入上下文维持 D28 默认隐藏，不开开关（roadmap「预览版后挂起区」有条目）；fold 分拣与 settings 持久能力面保留不动 |
| `/diff` | CC/Codex | — | git status + git diff（未提交变更）面板 | 全宽面板，复用 DiffCardComponent + line-diff.ts | ✅ spawnSync('git')（status-git 先例，TTL 缓存可复用） | 发版后 | **2026-08-21 用户裁决移出发版范围**（roadmap「预览版后挂起区」有条目）；非 git 仓库报错 |
| `/hotkeys` | pi | — | 别名 → /help | — | ✅ command-meta（机制已就绪） | 🚫 | **2026-08-21 用户裁决不做**（低价值，/help 已覆盖） |
| `/settings` | kimi(别名 config)/pi/CC | 列表导航 | 编辑 Blue 自有命名空间（theme custom 路径等）；其他命名空间只读列出 | 列表面板 + 内联编辑（questionnaire 模式） | ⚠️ dsh-settings settingsNamespace + register(schemastery) + patch()；仅 Blue 自有命名空间可写 | S28 | harness 命名空间归其 owner 插件 |
| `/reload` | kimi/pi | — | 重读 Blue settings + 主题重挂 | notice | ⚠️ theme-switch 换装机制已有；kimi 的 config.toml/tui.toml 语义不存在 | S28 | |
| `/tools` | kimi | — | 列出当前会话工具集 | 面板 | ✅ ctx.tools.schemas(scopeOf(agent.ctx))（每可见工具一个深拷贝 schema，§7 #8 已解决）——真枚举 | ✅ S28（2026-08-21，InfoPanel + mcp__ 分节） | §7 #8 缝撤销；fold EpochHeader.tools 仅兜底/对比 |
| `/tasks` | kimi/CC/Codex | — | 映射为 todo 面板 + jobs 视图 | 面板（pane-todo 复用） | ✅ ctx.jobs（job_output/list/kill，owner 按 SessionId 隔离，§3.2）+ todo/write 折叠 | S28 | Adapt 裁决：/tasks = todo 列表（默认）+ jobs 视图（可选，进程内无持久化） |
| `/import` | pi/CC/Codex | 文件路径 | 外部 JSONL 解析+校验 → sessionPersistence.prepare + agents.create(seed) | 面板/notice | ⚠️ SESSION_FORMAT_VERSION=0 严格性、ignorable 标记、校验成本高 | 顺延 | 不阻塞主线 |
| `/preset [name]` | Blue 原创（D33） | 无参=列表；补全=`ctx.agentPresets.list()` | 列出/切换 agent 组合预设（standard/minimal/code/cordis…）；空会话限定 | BlueSelect 面板（mountEditorReplacement，/sessions 模式） | ⚠️ `ctx.agentPresets.list/recompose` **不在 dsh-base**（仅 web-app bundle）——Blue bundle patch 加 `agent-presets` 行 + 包依赖（CLI 启动器见行即自动注入 shipped preset root）；sessionBlank 守卫 + `agent-preset/selected` 事件配对（进程内直调无 wire 层强制） | ✅ S28（2026-08-21，SelectListPanel + `/preset <id>` 重派发写路径；薄宿主迁移 D37 使替换语义为真） | UI 能力探测走投影/键缺失（预设间能力面差异大：minimal 无 plan mode/compaction）；自定义 permission preset 注册 API 无（组合 YAML 固定），残余缝不请求 |
| `/mcp` | kimi/CC/Codex | 无参 | 服务器列表（serverName/transport/命令或 URL/超时/重连）+ 每服务器工具清单 + 近似连接状态 | 面板 | ✅ `ctx.loader.entries()` 过滤 `options.name === '@deepseek-ai/dsh-mcp-client'`（归一化配置读 `entry.fiber.config`；profile 根 `cordis.yml` 每次启动重写为空，不可读磁盘）+ `ctx.tools.schemas()` 双口径（会话可见展示 / 全局注册健康信号，`tool-scope.ts` 共享 scope 解析）；bundle 包依赖带 dsh-mcp-client（D36，S34 落地并首入 version.spec runtime-deps 门禁） | ✅ S34（2026-08-22，D40） | 状态为近似（`failOnStartupError:false` 时 fiber active ≠ 已连接；重连预算耗尽后工具消失）——状态推导以全局注册工具存在性为主、fiber phase 为辅；快照式面板（live 四信号刷新挂起，D40）；启停维持 ⛔ §7 #6，服务器声明走 profile patch（HMR 热生效） |
| `/skills` | CC/Codex | 无参 | 列出 user-invocable 技能（name/description/whenToUse/来源层） | 面板 | ✅ `ctx.skills.snapshot({cwd, scope})` + `invocation.userInvocable` 过滤 + `skills/change`/`blue/session-changed` 失效重拉（目录缓存与 `#` 补全共享，D34） | ✅ S29（2026-08-21） | 随 `#` 提示符管线同期落地（InfoPanel 只读面板按来源层分节）；`#name` 提交重写 `/name` 走上游手势注入（resume/replay 安全） |

#### 4.2.1 S23 新缝：BlueSessionRef.modelRef

`/model` `/effort` `/status` 的地基。现状：`packages/app/src/index.ts:72-75` `modelSelectionSetup` 把 `installModelSelection(agentCtx, selection)` 挂在三条建会话路径上，`selection: ModelSelectionRef` 闭包在 setup 内，UI 拿不到句柄。

**方案**：`blueSession` 服务（app 层）增 `modelRef` 可变引用。**✅ 已落地（2026-08-20，S23）**，实施期一项修正：modelRef 不是 §4.2.1 原案的纯可变字段，而是 **getter/setter 三级优先**（会话内 picked → 会话日志最近 request header → 进程默认，harness apiproxy `selectionFor` 同款）——`packages/app/src/model-ref.ts` 的 `createModelSelectionRef`；此举同时修复了 resume 路径的既有缺陷（原接线机械上把 resume 会话切回进程默认模型而非沿用日志 header，app 注释声称 header wins 但不成立），e2e 以 `--resume` 后请求模型断言钉住。三个 commit 点（startup / request-resume / commitSwitch）统一发布 `current` 与 `modelRef`，session-changed 不变式要求 handle 已发布。

#### 4.2.2 S24 语义说明

`approval.setPolicy('never')` 是“永不询问、一律拒绝”（fail-closed 姿态，dsh-user-approval index.d.ts:77-80），**不是**自动允许。/yolo /auto 的“自动放行”由 Blue 侧实现：**approval answerer 是 Blue 插件**（approval-plugin.ts）。**✅ S24a 实施验证与勘误（2026-08-21）**：🔍 已核实——`'never'` 在 waterfall 派发**之前**就把 ask 定为 `'rejected'`（answerer 根本收不到请求），坐实“实现面在 answerer 而非 policy”：harness policy 保持 `'ask'` 不动，`answer()` 在 sessionAllowances 检查后加 yolo 分支（aborted 先回 `'cancelled'`）。**持久化方案同日勘误**：初版“持久化 'approval/policy' 事件旁挂 Blue 自己的会话事件”两条路都被上游机制否决——(1) Blue 自有会话事件不可行：`KNOWN_SESSION_EVENT_TYPES` 是闭集（generated），持久化读取路径拒读含未知类型的日志，除非事件带 envelope `ignorable: true`，而运行时 `session.append` 无法设置该标记（仅持久化 coordinator 原始路径可设）；(2) `'approval/policy'` 事件不能挪用：permissions 投影折它推导当前 preset，写入会把 preset 污染成 custom。**落地方案：折 `command/run` 事件**（name='yolo'、last-wins、`args.trim()==='off'`→off 否则 on、args 未记录则跳过——上游 plan 投影同款词汇与纪律）；裸 `/yolo` 关闭时 handler 重派发显式 `/yolo off`（`commands.register` 无 commandId 句柄 + dsh-commands invariant 要求 commandId 唯一且 done 配对 run，手工 append 不可行），Shift+Tab 循环每步恰好派发一条显式命令（`/plan` / `/yolo on` / `/yolo off`）。**三态循环（同日用户裁决）**：normal→plan→yolo→normal 互斥（`currentMode` 以 yolo 为先——瞬态重叠时 yolo 是生效面；互斥监视器在 `session/event` 观察到 plan 激活且 yolo 开时经 `queueMicrotask` 派发 `/yolo off`——`session.append` 禁止重入且观察者在 append 内同步运行）；徽标 `blue-status-mode`（interaction 子路径插件，priority 2：plan accent / plan… pending / yolo warning / normal 隐藏）。/auto 🚫 暂不做（用户裁决 2026-08-21，以后再考虑）。

### 4.3 ⛔ 等上游命令（互链 §7）

| 命令 | 上游缝 | 消费依赖 | 状态 |
|---|---|---|---|
| `/undo` | #2 会话原地撤销 | session 截断原语 | ⛔ 维持 |
| `/title` `/name` | #3 标题服务已现成（收窄） | ctx.sessionTitle.rename + title 投影 | ⚠️ 命令层 |
| `/mcp` | #6 MCP 管理面（收窄） | 只读列举 ✅ S34 已落地（D36 定档 D40 落地：loader entries + 双口径 schemas()）；管理面（状态事件/启停）维持 ⛔ | ✅ S34 只读 |
| `/skills` | #7（撤销） | `#` 提示符管线（D34）+ `/skills` 列表命令 | ✅ S29 已落地（缝撤销） |
| `/compact` | #1 压缩 API | — | ✅ 已解决（§2.10） |
| `/permission` | #4 permissionPresets | — | ✅ 已解决（§2.10） |

### 4.4 🚫 明确不做命令（互链 §6）

见 §6 全表。要点：产品特定（/llama /swarm /web /share /dance /radio /mobile /desktop /powerup /passes /autofix-pr /batch）、无上游能力（/login /logout /goal /cd /vim /memory /trust /scoped-models /tree /branch /clone /session /cost /fast /approve /raw /personality /mute /memories）、既有面覆盖（/plugins /apps /hooks = 组合层；/hotkeys → /help；/changelog → banner；/git → `!` shell；/export-debug-zip → /debug；/keybindings → /help 查看）、评审/诊断族留缝（/security-review /code-review /doctor 仅做 /init 一个罐头提示）。

## 5. 分期实施（S23-S29；S27 于 2026-08-21 两度砍剩——首砍 S27'：/hotkeys 🚫、/diff 发版后、注入显隐定名 /injections；再砍 /injections 🚫（用户裁决维持 D28 默认隐藏），S27' 终版仅 /init /clear，✅ 已落地 2026-08-21）

每步一棵可启动、可验收的插件树（总原则 #1）。依赖链：**S23 的 BlueSessionRef 缝是 S25 /status 读模型的地基，必须第一步开**；S24a 无前置（✅ 已落地 2026-08-21，S24 拆 a/b：用户裁决 /auto 与 /permission 面板顺延）；**S24b（✅ 已落地 2026-08-21，范围收窄——用户裁决 /auto 暂不做，改为 plan-review 专用呈现补入本期）**；S26 依赖 S25 的 fold/累计器；S27 的 command-meta 是 S28 别名/可用性机制的地基（✅ command-meta 已提前落地 2026-08-20，§2.12；S27' 消费已落地 2026-08-21：`/clear` 别名——HelpOverlay 分组表头未随期，顺延）。S29（`#` 技能管线，D34/D35）无 S 步前置（上游能力全在 base），✅ 已落地 2026-08-21（排期上原在 S28 后收尾，开发期与 S28 并行——合并序以人工验收为准）。

| 步 | 内容 | 能力依赖 | UI 复用 | 验收要点 |
|---|---|---|---|---|
| **S23** 模型与强度 | `/model` `/effort` `/provider`(list/switch/add) | 新缝 BlueSessionRef.modelRef（§4.2.1，getter 三级优先落地）；llm.listModels/listProviders/listConfigurableProviders/discoverModels + settings.mutate + credentials.set | ModelPanel/EffortPanel/ProviderPanel/FormPanel + mountEditorReplacement + notice（e2e 另挂真 dsh-settings-file/dsh-credentials-local/dsh-llm-pi-ai） | ✅ 全部达成（2026-08-20 落地，2026-08-21 合并）：面板行含 `· ctx Nk` 与 thinking 段控件；下一 step 生效（e2e 断言请求模型/effort）；saveSelection 跨进程持久（banner 读回）；/new 后 modelRef 跟随新 agent；Add 落盘 settings.yaml/.credentials.yaml 且路由激活；Alt+S session-only 通道（用户裁决 kimi 全语义）；dogfood 14 轮追加——kimi 版式（tab 搜索/tab 条/圆角表单盒）、provider 编辑/删除流、协议感知 base URL、models.dev 元数据匹配、列举失败回表单重试（分类 cause 链 error 红） |
| **S24a** 自治开关与三态循环 | `/yolo`（+别名 `yes`）+ Shift+Tab 循环 normal→plan→yolo + `blue-status-mode` 徽标；`/plan` 零实现（上游随 base 组合） | ✅ 全部现成：answerer 分支（§4.2.2 勘误）；`command/run` fold 持久化；`ctx.planMode.get/set`；`shift+tab` 键位（pi-tui 独立 KeyId，无人占用）；e2e 挂真 PlanModeController | notice + blueStatus 徽标条目（plan accent / plan… pending / yolo warning / normal 隐藏） | ✅ 全部达成（2026-08-21）：会话内审批免弹窗（e2e 断言 waterfall 直回 allowed-once 且无 overlay）；提问仍弹；裸切换日志记录 `['', '', ' off']`（重派发落定折）；\x1b[Z 三循环 + 徽标随行；互斥双向（含延迟派发 microtask）；resume 恢复 yolo（command/run fold）与 plan（plan/mode fold）；/new 归零；fork 继承；/help 列出命令与键位 |
| **S24b** /permission 面板 + plan-review 呈现 + 通用列表组件（✅ 已落地，范围收窄 2026-08-21） | `/permission` 选择器面板（D33）+ plan-review 专用面板（§7 #5 顺延项提前消费）+ **共享单选列表组件沉淀**（`select-list.ts`：SelectListPanel + cycle/windowedRange/counterRow，回迁 /sessions、/provider、BlueSelect；ModelPanel 保持自有几何）；`/auto` 🚫 暂不做（用户裁决） | `ctx.permissionPresets`（names/current/resolve/optionOf——服务读 ≡ permissions 投影 fold，D33 措辞勘误）；`/permission <name>` 命令写路径（`ctx.commands.execute`，command/run+done 免费入日志）；user-questions `intent {kind:'plan-review'}`（detail=计划 Markdown，答案编码同通用）；type-only 依赖 `@deepseek-ai/dsh-permission-presets`（peer+dev rc.7） | SelectListPanel（D30 挂载）+ FormPanel typed-y danger gate + PlanReviewPanel（kimi approval 形态：plan 边框盒 + 编号列表 Approve/Reject/Revise，Revise 行内联反馈输入） | ✅ 全部达成（2026-08-21）：裸 `/permission` 开面板（e2e：三行 + ← current + knob 派生描述 + Esc 零派发）；danger 必经 typed-y（Esc 回列表、错值留表单）；切换落 `permission/preset`+`sandbox/mode`+`approval/policy` 事件；带参直通命令；plan-review 渲染 Markdown 于 plan 边框盒 + Enter/数字键批准（`plan/mode{active:false}`）/ Reject 本轮拒绝（"chose to keep planning" 入下请求）/ Revise 行内联反馈往返（"their feedback" 入下请求）/ Esc dismissal 走 crafted "speak instead" 消息（ASK_CANCELLED 勘误一并落地） |
| **S25** 会话信息（✅ 已落地 2026-08-21；`/usage` 落地后经用户裁决更名 `/context`——CC 语义，kimi /usage 同款内容；同批裁决建立全局版本管控 `transcript/tests/version.spec.ts`） | `/status` `/context` `/version` | session.header / requestContext；`sessionProjections.snapshot` 读 tokenUsage/contextPressure/sessionStats 投影（token-meter/session-stats 均在 base）；`usage.ts` 薄读层 + `assistant/*` 纯折回退，不设累计器 | `InfoPanel`（`info-panel.ts`，kimi usage/status 报告形态 × /help 版式：两列 segment 行 + `█░` 严重级占用条 + showing 滚动窗，D30 editor-slot 挂载）+ notice | ✅ 全部达成：数字与投影一致（e2e 断言 64.2k 总数 + 4.1k/60k 分桶）；usage 跨 resume 重放正确（e2e：resume 后同总数）；/version 与 banner 常量一致（同一常量，`./banner-content` 子路径导出）；降级主机回退折 e2e 另证 |
| **S26** 导出与复制（✅ 已落地 2026-08-21） | `/export` `/copy` | persistence.readRaw（supportsRawArtifacts=true）+ `ctx.sessions.flush` 先冲刷（write-behind coordinator）；fold.ts 折叠→Markdown（`decodeStorageRecord` 展开 chunk 行，新 peer+dev dep dsh-session）；新模块 interaction/src/clipboard-write.ts（注入式探测 wl-copy/xclip/pbcopy/clip.exe） | notice + 路径回显 | ✅ 全部达成：导出文件独立阅读（e2e 断言内容与 turn 结构）；复制文本与最近 assistant 消息一致（e2e 断言 fake writer 收到原文）；无剪贴板工具优雅报错（notice）；readRaw 守卫全分类（无会话/无 persistence/非 raw 后端/无 artifact/空折/坏行/写失败） |
| **S27'** 轻命令族（✅ 已落地 2026-08-21；范围两度修订——首砍：用户裁决 `/hotkeys` 🚫 不做、`/diff` 移发版后、注入显隐定名 `/injections`；再砍：用户裁决 `/injections` 🚫 不做（维持 D28 默认隐藏），终版 `/init` `/clear` 两条） | `/init` `/clear` | command-meta 别名消费（`registerCommandAliases('new', ['clear'])`）；AGENTS.md 加载面已上游（dsh-agent-instructions，§3.2），/init 仅罐头提示写文件（`session-init.ts`，kimi 文案精神英文正文） | notice | ✅ 全部达成：/clear 别名可补全（下拉 `/new (clear)` 标注）可执行（e2e 断言 sessionChanges 增长同 /new）；/init 注册可见（/help 列出）+ idle 时罐头提示作为请求发出（e2e 断言 adapter.requests 消息含 exploration brief 与 AGENTS.md）+ 运行中拒绝（notice 断言，followup 不发） |
| **S28** 配置与生态（**partial ✅ 2026-08-21**：/tools /preset + 薄宿主迁移 D37 已落地；/settings /reload /tasks 顺延；**/mcp 提前为 S34 落地 2026-08-22，详 D40**） | ~~`/settings` `/reload`~~ `/tools` ✅ ~~`/tasks`~~ + `/preset`（D33）✅ + ~~`/mcp`（D36）~~ | dsh-settings 注册 'blue' 命名空间；theme-switch 换装复用；ctx.tools.schemas()（§7 #8 已解决）；todo/write 折叠 + ctx.jobs（pane-todo 同源）；**agent-presets 行（bundle patch 新增 + 包依赖）**；**loader.entries + tools.schemas() mcp__ 分组 + bundle 带 dsh-mcp-client 依赖** | 列表+内联编辑面板（questionnaire 模式）/ notice / pane 面板 | 设置持久生效；/reload 只影响 Blue 自有面；/tools 列表与 schemas() 一致；/tasks = todo 折叠 + jobs 视图一致；/preset 空会话切换成功 + 非空会话守卫报错 + `agent-preset/selected` 事件入日志；/mcp 面板与 loader/tools 实况一致；上游自带命令（/compact /plan /goal /permission /feedback，§2.10）随组合可见且 /help 自动枚举 |
| **S29** 技能管线（✅ 已落地 2026-08-21；范围改判——原「前置修复 = input 层未注册 `/xxx` miss 回退 followup」经 2026-08-21 用户裁决**不做**：行首斜杠维持严格命令域，技能调用经 `#` 走 followup 分支） | `#` skills 提示符 + `/skills` 列表命令（D34/D35） | ✅ 上游手势路径（tool-skill pre-step `/name` 注入，base）；ctx.skills.snapshot（complete 才入缓存，incomplete 保上次 good）+ userInvocable 过滤 + skills/change/blue-session-changed 失效重拉（`skills-catalog.ts` 模块级缓存 + single-flight，与 `#` 补全、提交重写、/skills 三消费方共享）；重写为 **submitPrompt/steer 级**纯文本替换（`rewriteSkillTokens`，非 SubmitTransformer——transformer 是内容块拼接语义会内容重复；仅命中目录的 user-invocable 名字，词边界逐字镜像上游手势正则） | 补全 UI 复用 slash 分支的 `filterSlashCommands` fuzzy（`@` 分支形态先例）+ InfoPanel 只读面板（/status 先例，按来源层分节） | ✅ 全部达成：`#` 弹补全列 user-invocable 技能（e2e 增量帧断言）、Enter 接受不提交（pi-tui 非 slash 前缀语义）再 Enter 提交、applyCompletion 行中替换带尾随空格；提交重写后手势注入生效（e2e 断言请求含 `/name` 用户消息 + `<skill_content>` 注入）且 resume 重放正确（下一轮请求仍含注入，注入体按 D28 零呈现）；markdown 标题行（`# ` 空格形态）/大写/`C#`/`##`/未知 `#tag` 原样（单测+e2e 钉住）；/skills 面板与补全目录同源（分节/两行/whenToUse/user-only 标记）；bash mode 下 `#` 补全拒绝 |

| **S34** `/mcp` 只读面板（✅ 已落地 2026-08-22；S28 顺延项经用户裁决提前，四裁决详 D40——Q1 只读维持（配置归 profile patch，无添加表单）/ Q2 两步式面板 / Q3 双口径计数（会话可见展示 + 全局注册健康信号）/ Q4 即刻做） | `/mcp` | ✅ loader entries（`options.name` 过滤，归一化配置 `entry.fiber.config`）+ `tools.schemas()` 双口径（scope 经 `tool-scope.ts` 与 /tools 共享）+ bundle 钉版依赖 dsh-mcp-client（runtime deps 首入 version.spec） | SelectListPanel/InfoPanel 全复用（`buildToolDetailSections` 白捡工具 schema 详情）；kimi mcp-status-panel 形态参照 + config-view 脱敏纪律（env/headers 只 key） | ✅ 全部达成：e2e 手写 stdio fixture server 真连接路径（picker→服务器面板→config/工具详情三级 + 脱敏断言）+ dead/空态（FAILED 形态留单测——`loader.await()` 会拒整树 boot）；单测状态推导全表 + 双口径 + orphan/无会话退化 |

每步门禁：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；README 双语同步；bundle e2e 用例随步增加（每命令 ≥1 用例：注册可见 + 主路径行为 + 守卫路径）。

**S29 之后（2026-08-21 定稿）**：命令系列随 S27'-S29 收尾后，进入 roadmap「预览版发版冲刺」的 UX 步与发版段——**S30** 终端小件批（含命令 `/title`（§7 #3 收窄项落消费）+ 模型热键 + /sessions type-to-filter）、**S31** 外部编辑器 Ctrl-G、**S32** 大粘贴折叠、**S33** 子 agent 分组卡，**R0-R6** 发版段（CI/快照最小集/发包/安装验证/dogfood/文档站清账）。排期、门禁链与裁剪线见 [blue-roadmap.md](./blue-roadmap.md)「预览版发版冲刺」节；发版后挂起项（/hotkeys /diff/通知/审批 diff 预览/live 输出流等）见同文档「预览版后挂起区」。

## 6. 明确不做（🚫）与理由

| 命令 | 来源 | 理由 |
|---|---|---|
| `/llama` | pi | 本地模型运行；harness 无本地模型后端 |
| `/swarm` | kimi | 编排面现成（workflow 引擎 + tool-workflow 模型工具，门控"仅用户明确要求"，§3.2）但无 swarm 命令形态；Blue 不建 |
| `/web` `/share` | kimi/pi | 无 web/gist 服务，非 Blue 职责 |
| `/dance` | kimi | 隐藏彩蛋 |
| `/radio` `/powerup` `/passes` | CC | 无关功能 / 账户与 API 信用产品 |
| `/mobile` `/desktop` `/ide` `/teleport` `/remote-control` `/background` | CC/Codex | 远程 RPC 面现成（client-connection/api-gateway/api-remotes，§3.2）但非 Blue 职责；/background 视图 ⚠️ 顺延 |
| `/subtask` `/agent` `/subagents` `/list-agents` | CC/Codex | 子 agent 系统现成（ctx.subagents + spawn/fork + 全套工具，§3.2）；视图命令可做但非本期（⚠️ 顺延） |
| `/batch` `/autofix-pr` | CC | 批量编排 / CI 集成产品 |
| `/login` `/logout` | kimi/pi/CC | 认证面由 harness settings/凭据承担；无平台认证流程 |
| `/export-debug-zip` | kimi | /debug 覆盖诊断导出（/debug 亦顺延） |
| `/plugins` `/apps` `/hooks` | kimi/CC/Codex | 插件管理；组合层已承担启停 + CLI `dsh plugin --profile add`；hooks 兼容桥现成（§3.2）非命令 |
| `/editor` | kimi | 外部编辑器 Ctrl-G 未实现（roadmap P2 挂起项） |
| `/experiments` `/experimental` | kimi/Codex | 无实验特性管线 |
| `/goal` | （已转 Adopt，§2.10/§8） | 上游 ctx.goals + /goal 命令现成，零实现 |
| `/tree` `/branch` `/clone` | pi | /sessions + /fork 覆盖；lineage 仅可作 /sessions 可选增强列 |
| `/session` | pi | /status + /sessions 覆盖 |
| `/scoped-models` | pi | 目录级模型无概念（agent 级 selection 已有，不做目录维度） |
| `/trust` | pi | 信任文件夹无 harness 概念 |
| `/changelog` | pi | banner-content 的 what's-new 已承担；面板形式可选（⚠️ 顺延） |
| `/cd` | CC | 会话 cwd 创建时钉死，无切换原语 |
| `/cost` | CC | 无 usage/cost 服务；定价表 Blue 侧维护不值 |
| `/vim` `/keymap` `/keybindings` | CC/Codex | vim 需编辑器 provider 实现（P3 缝槽，rc.7 无）；keymap 编辑面不做（/help 已覆盖查看） |
| `/memory` `/memories` | CC/Codex | 无 memory 服务 |
| `/personality` `/raw` `/approve` `/mute` `/memories` | Codex | 产品特定（approve 由审批面板承担） |
| `/security-review` `/code-review` `/doctor` `/debug` | CC | 罐头提示族只做 /init 一个（S27 留缝）；需要时复用同管线 |
| `/git` | CC | `!` shell 模式已覆盖 git 工作流 |
| `/autocompact` | CC | = /compact 自动化形态；上游 compaction-basic 已在 base 自动压缩（§3.2）——维持不做 |
| `/skill:name`（技能进 slash 命名空间） | kimi/CC 形态 | D34：`#` 提示符分流域，slash 命名空间保持封闭（仅注册命令）；桥接 `ctx.commands` 是错语义（command/run\|done 免模型 turn，技能调用必经模型 turn） |
| 用户自建命令文件（`.dsh/commands/*.md`） | CC | D35：= 技能文件——发现根（`.dsh/skills`、`~/.dsh/skills`、customSkillDirs…）写 SKILL.md 经 `#` 管线调用；不做独立 commands-filesystem 机制，不提上游缝 |
| `/fast` | Codex | 无快速模型切换概念 |
| `/add-dir` | kimi/CC | 会话 cwd 无附加目录原语 |

## 7. 上游缝请求清单（⛔，完整草案）

每条：期望 API 签名草案 + 消费命令 + rc.7 证据 + 优先级。提交给 harness 仓库（`@deepseek-ai/dsh-*`）时按本表逐条转 issue/PR（✅ 已解决/⚠️ 收窄条目注明即可，不转）。

### #1 压缩 API（✅ 已解决：随 0.1.0-rc.7 发布）— 消费：/compact

**2026-08-20 修正**：初版以 dsh-agent-loop 无 compact 符号推断 /compact 不可做，实际压缩已独立成包族并随 base 组合默认装载。**本缝撤销，不再请求。**

已落地能力（与初版期望的差异 ⚠️ 标注）：
- `dsh-compaction` 接缝：`ctx.compaction.compactIfNeeded(agent, trigger, signal)` / `compactNow(agent, signal, sourceCommandId?)` / `compactRegion(start, end, agent, ...)`（⚠️ 服务面而非初版期望的 `agent.compact()` 方法面）
- `dsh-command-compact` 注册 `/compact`（⚠️ 无参数，初版期望可选 instruction；带参报 Usage）
- `dsh-compaction-basic` 自动压缩 + `dsh-compaction-tool-result-pruner` 工具结果修剪（thresholdChars/headChars/tailChars）
- SessionStartSource 含 'compact'；`LlmCallConfig.purpose` 仍无（⚠️ 但不需要——压缩不走请求标记）；`compaction/start+end` 事件词表仍缺（折叠以 surface 为准）

### #2 会话原地撤销（P0）— 消费：/undo

- **期望**：`dsh-session`（或 persistence）增会话截断原语：`session.truncate(boundarySeq: number, cause)`——删除 boundary 之后的事件（含 fork/undo 审计事件），或官方承认的 undo 语义（如 kimi 的"撤回最近 prompt"= 删最后 user/assistant 对）。
- **rc.7 证据**：唯一原语仍是 fork 产新会话（agents.create seed）；dsh-session-checkpoint-policy 仅崩溃恢复（wrap llm/stream + tools/execute 落盘 flush，失败 fail-closed），非撤销语义；dsh-session-reference 仅跨会话引用；persistence 无截断/删除 API。（维持 ⛔）

### #3 会话标题（✅ 已解决：全自动展示，2026-08-22 S30 拆步①）— 消费：OSC 终端标题 + footer 条目

**2026-08-20 修正**：标题能力已随 rc.7 落地（`dsh-session-title`，base），落点在事件面而非 SessionHeader。**缝收窄**：不再请求字段/持久化 API，剩余缺口仅为命令注册。

- **已落地**：`ctx.sessionTitle.get/rename/refresh/register`；`session/title` 事件（log-only；user 源 rename 会 pin 住标题，停自动修订）；title 投影（客户端列表行/`useProjection('title')`）；`session.rename` RPC；first-prompt-llm 自动标题 provider（fork 继承父标题）。
- **2026-08-22 终态（S30 拆步①，用户裁决）**：**`/title`/`/name` 命令 🚫 不做**——标题全自动无手动入口；Blue bundle patch 换 **all-prompts** 节奏（disable first-prompt-llm + `dsh-session-title-all-prompts-llm`，CC 式随会话流更新，歪标题下条消息自纠）；展示两路——interaction `terminal-title.ts`（OSC 0 终端标题，fold 驱动，回退 `blue`）+ transcript `status-title.ts`（footer 第 2 行左簇条目）；`SessionHeader.title` 字段与 persistence 修订 API 不再需要。

### #4 权限预设（✅ 已解决：随 0.1.0-rc.7 发布）— 消费：/permission

**2026-08-20 修正**：初版"全仓零命中"为依赖闭包偏窄所致（Blue 已安装闭包外存在该包）。**本缝撤销，不再请求。**

- **已落地**：`dsh-permission-presets`（base）——`ctx.permissionPresets.set(agent/session, name)/current/optionOf/names/defaultPreset`；自带 `/permission [preset]` 命令（§2.10）；默认表 workspace-write（workspace-write+ask）、danger-full-access（danger-full-access+never），`custom` 为派生态；`permission/preset` 事件；PERMISSION_SETTINGS_NAMESPACE（新会话默认预设）。
- **与初版期望差异**：无 `register({id, label, ...})` 自定义注册 API（预设表固定 + custom 派生）；无 `setPreset` 批量切换（单预设 `set` 写各 knob 规范 setter）。**2026-08-21 注记（D33）**：残余 register 缝**不请求**——S24 选择器面板消费现成 `permissions` 投影 + `/permission <name>` 命令写路径已够；rc.8 base 组合已扩表 read-only。

### #5 plan 模式（✅ 已解决：随 0.1.0-rc.7 发布）— 消费：/plan

**2026-08-20 修正**：初版误断"dsh-plan-mode 未随 rc.7 发布（仅 README 引用）；无包"。实际 `dsh@0.1.0-rc.7` 的 dependencies 即含 `dsh-plan-mode@^0.1.0-rc.7`，核实基准 `.smoke/dsh-install` 内即有 rc.7 安装包（npm 已发 rc.6/rc.7/rc.8，`next`=rc.8）；harness CLI standard preset（`apps/cli/config/agent-presets/standard/agent.cordis.yml`）已组合 plan-mode。**本缝撤销，不再请求。**

已落地能力（与初版期望的差异 ⚠️ 标注）：
- `ctx.planMode: PlanModeController`：`get(agent)` / `set(agent, active)` → 'committed'|'queued'|'cancelled'|'noop'（⚠️ 初版期望 `agent.planMode` 方法面，实际是 ctx 服务面）
- 会话事件 `plan/mode: {active: boolean}`（log-only、last-wins）+ `foldPlanMode(events, end?)`——resume/fork/compaction 从日志恢复，无 live mirror
- **插件自注册 `/plan [message]` 与 `/plan off`**（ctx.commands 组合时）：裸 `/plan` 进入；`/plan <msg>` 先进入再 `agent.steer()`；`/plan off` 直接退出（不送模型输入）
- `exit_plan_mode` 工具常驻注册（工具目录跨模式稳定），退出前经 `ctx.userQuestions` 以 `plan-review` presentation intent 请求用户确认
- `plan:policy` prompt section（部署方 config.section 必填非空）
- 语义是**软引导**：sandbox 模式与 approval policy 独立强制限制、不读写 plan 状态（⚠️ 初版期望"agent 只读、工具走 guard 拒写"，实际不 enforce 只读，靠 section 引导 + sandbox/approval 兜底）
- ~~包内另随带 session modes TUI 面（default/plan/full Shift+Tab 循环，`SessionModeSpec.plan` 联动 /plan）~~ **2026-08-21 勘误**：该记载有误——`SessionModeSpec` 在 rc.5/rc.6/rc.8 源码与全部 git 历史零命中，不存在通用 session-modes 框架；plan 的既有 UI 面是 React 浏览器包 `dsh-client-ui-plan`（`useProjection('plan')` + composer 座位），不可被 Blue 复用。若 Blue 要 default/plan/full 式三态循环，是纯 Blue 侧 UI 概念（`plan` 投影 + permissions 投影拼装，上游无联动机制）

**Blue 侧残余**：命令零实现（随插件到达，/help 自动枚举）；**plan-review 专用呈现 ✅ S24b 落地（2026-08-21）**：`interaction/plan-review-panel.ts`——questions-plugin 对单问 `intent.kind === 'plan-review'` 分流（配对畸形/未来 intent kind/多问题批回退通用问卷），两轮 dogfood 后定 **kimi approval 形态**：计划体（question.detail）经 `createMarkdown` 渲染进带边框 `plan` 盒（btw 面板盒惯用法，窗口按视口占满 + showing 尾行 + pgup/pgdn——轮 3 裁决），其下编号决策列表 `1. Approve`（`intent.approve` 命名，绝不硬编码）/`2. Reject`（另一选项标签作答，模型本轮内收到"chose to keep planning"）/`3. Revise`——该行**内联**反馈输入（kimi `3. Revise  <text>`：真 editor 持键、行显示派生自跟踪文本 + 光标块 + `Type feedback · ↵ submit.` 提示；非空提交 `{selected:[], custom}` 即 keep-planning-with-feedback，空提交纯拒绝）；↑/↓ 环绕、数字键跳选即发（输入聚焦时数字作为文本）、Enter 激活、Esc 走 `ASK_CANCELLED` dismissal（本轮停止、plan 模式保留、模型等用户下一条消息）。**随期勘误**：provider dismissal 码原为 Blue 自造 `ASK_DISMISSED`，而 dsh-plan-mode 只 catch `ASK_CANCELLED`（dsh-host-apiproxy 同码拒 dismissal）——此前 Esc 泄漏原始 rethrow 给模型，全局改 `ASK_CANCELLED` 后模型收到 crafted "user dismissed the plan review to speak instead; stay in plan mode" 消息（e2e 断言下请求消息含该文案）。

### #6 MCP 状态（⚠️ 收窄：客户端现成，管理面仍缺）— 消费：/mcp

**2026-08-20 修正**：`dsh-mcp-client`（rc.6）已发布——每插件实例连接**一个**外部服务器（stdio 子进程 / Streamable HTTP），工具自动注册为 `mcp__<serverName>__<rawName>`（冲突加 SHA-256 尾缀）；配置走 cordis.yml（非 settings）；指数退避重连（500ms→30s，10 次上限）。**但无服务器注册表、无 `listServers()`、无启停管理面**；且默认组合不启用——CLI 仅以依赖形式携带供 patch layers，每个服务器命令是沙箱外可信可执行代码（安全姿态，CLI reference README 明示）。

- **缝收窄**：只请求管理面（注册表 + 状态列举 + 启停，P2 降级）；Blue `/mcp` 只读列举已落地（✅ S34 2026-08-22，D36/D40）。
  - **S23 注（2026-08-20）**：管理面的 list/switch/add 已由 Blue `/provider` 落地（消费 `listProviders`/`listConfigurableProviders`/`discoverModels` + settings `llm-pi-ai` 命名空间写入，Web Models 页同款跨命名空间 `settings.mutate` 先例）；删除/刷新与 MCP 侧仍缺。

**2026-08-21 注记（D36）**：只读列举已定 S28——数据源为进程内 `ctx.loader.entries()`（moduleName 过滤，读 Schemastery 归一化运行时配置）+ `ctx.tools.schemas()` 按 `mcp__` 前缀分组 + `tools/change` 重拉 + fiber phase 近似状态；Blue bundle 包依赖带 `@deepseek-ai/dsh-mcp-client`（上游默认不装，装 Blue 即装）；服务器声明维持用户 profile patch 层（上游原生通道，HMR 热生效）。缝进一步收窄为**纯管理面**：每服务器状态事件（现只有 logger）+ 启停/重连 API（`ConnectionHandle` 私有；预算耗尽后仅 entry 重载/Host 重启可恢复）+ 服务器注册表服务。

### #7 skills 系统（✅ 2026-08-21 撤销：D34 裁定经 `#` 提示符消费）— 消费：`#` 技能提示符、/skills 列表

**2026-08-20 修正**：skills 系统已随 rc.7 落地（base）——`ctx.skills` 分层注册表（global+per-scope 合并 provider 目录，同名按层就近、层内按 rank）；`dsh-skill-filesystem` 本地发现（project/user/custom 根目录，frontmatter `user-invocable`/`disable-model-invocation` 调用面开关）；`dsh-tool-skill` 模型工具 `skill` + 持久化可用目录；宿主注入 `skill-invocation`（`isUserInvocable` 过滤供 human-facing command catalogs 消费）；`skills/change` 事件。

**2026-08-21 撤销**：rc.8 源码核实补全调用机制——`tool-skill` 的 `agent/pre-step` 监听器扫描本步认领的 user 消息（仅 `source.kind === 'user'`）中的 `/name` token（词边界正则，句中任意位置），命中 user-invocable 技能即注入渲染后技能体，官方契约 "every client shares one deterministic path with no dedicated invocation wire"。**D34 裁定技能不进 slash 命名空间**：`#` 提示符（UI 与 `@` 同构）+ 提交时 `#name`→`/name` 重写走手势路径，human-facing command catalog 缝不再请求；`/skills` 为 Blue 自建列表命令（S29）。用户自建命令 = 技能文件（D35），commands-filesystem 缝同样不提。

### #8 工具枚举（✅ 已解决：schemas(scope) 现成）— 消费：/tools（升级 interim）

**2026-08-20 修正**：`ToolRuntime.schemas(scope?: ScopeKey): ToolSchema[]` 现成——"project visible definitions onto the allowlisted model-facing schema fields… one deep-cloned schema per visible tool"。**本缝撤销，不再请求。**

- `/tools` 实现改消费 `ctx.tools.schemas()`（按可见工具逐个 schema，含 scope 视图）；fold `EpochHeader.tools` 仅作兜底/对比。

### #9 命令元数据（P3 nice）— 消费：全体命令

- **期望**：`CommandDefinition` 可选字段 `aliases?: string[]` / `availability?: 'always'|'idle-only'` / `argumentHint?: string`（已有 input.hint）/ `completeArgs?(prefix)`。Blue 侧 command-meta 先行不阻塞（§4.1）。
- **rc.7 证据**：CommandDefinition 仍仅 name/description/input/recordInput/handler（2026-08-20 复核确认，维持 ⛔）。

### #10 会话删除/归档（P3 nice）— 消费：未来 /delete /archive

- **期望**：`SessionPersistence` 增 `delete(id)` / `archive(id)` 原语。
- **rc.7 证据**：persistence 方法面仍为 locate/create/append/prepare/load/inspect/readFrom/list/listSnapshots，无 delete/archive（2026-08-20 复核确认，维持 ⛔）。

## 8. Adopt / Adapt / Reject 总表

按四家参照系各一列，最终裁决一列（互链 §4/§6）。

| 命令 | kimi | pi | CC | Codex | 最终裁决 |
|---|---|---|---|---|---|
| `/model` | ✅ | ✅ | ✅ | ✅ | **Adopt**（S23） |
| `/effort` | ✅ | — | ✅ | — | **Adopt**（S23） |
| `/provider` | ✅ | — | — | — | **Adopt**（S23，list/switch） |
| `/yolo` | ✅ | — | — | — | **Adopt**（S24） |
| `/auto` | ✅ | — | — | — | **不做**（用户裁决 2026-08-21，以后再考虑——/yolo 已覆盖主路径） |
| `/status` | ✅ | — | ✅ | ✅ | **Adopt**（S25，消费 session-stats/query） |
| `/usage` | ✅ | — | ✅ | — | **Adopt**（S25，消费 ctx.tokenMeter） |
| `/version` | ✅ | — | — | — | **Adopt**（S25） |
| `/export` | ✅ | ✅ | ✅ | — | **Adopt**（S26，折叠 Markdown；上游 Web-only ZIP 另注 §2.10） |
| `/copy` | ✅ | ✅ | ✅ | ✅ | **Adopt**（S26） |
| `/init` | ✅ | — | ✅ | ✅ | **Adopt**（✅ S27' 2026-08-21） |
| `/clear` | 别名 | — | 别名 | ✅ | **Adopt**（✅ S27' 2026-08-21，= /new 别名） |
| `/context` | — | — | ✅ | — | **不做**（2026-08-21 用户裁决：注入显隐维持 D28 默认隐藏，定名 /injections 后再砍——挂起区有条目） |
| `/diff` | — | — | ✅ | ✅ | **Adopt**（发版后，roadmap 挂起区） |
| `/settings` | ✅ | ✅ | ✅ | — | **Adapt**（S28，仅 Blue 命名空间可写） |
| `/reload` | ✅ | ✅ | — | — | **Adapt**（S28 顺延，仅 Blue 自有 settings） |
| `/tools` | ✅ | — | — | — | **Adapt**（S28，消费 ctx.tools.schemas() 真枚举） |
| `/tasks` | ✅ | — | ✅ | ✅ | **Adapt**（S28，todo 面板 + jobs 视图） |
| `/import` | — | ✅ | ✅ | ✅ | **Adapt**（顺延，JSONL 校验严格） |
| `/hotkeys` | — | ✅ | — | — | **不做**（2026-08-21 用户裁决：低价值，/help 已覆盖） |
| `/compact` | ✅ | ✅ | ✅ | ✅ | **Adopt**（上游自带 /compact，零实现） |
| `/goal` | ✅ | — | ✅ | — | **Adopt**（上游自带 /goal，零实现） |
| `/feedback` | ✅ | — | ✅ | ✅ | **Adopt**（上游自带 /feedback，零实现） |
| `/swarm` | ✅ | — | — | — | **Reject**（workflow 是模型工具非命令，§3.2/§6） |
| `/undo` | ✅ | — | ✅ | — | **Defer**（⛔ §7 #2） |
| `/title` | ✅ | ✅ | — | ✅ | **Adapt**（消费 ctx.sessionTitle 注册 /title，S 步顺延） |
| `/permission` | ✅ | — | ✅ | ✅ | **Adopt**（上游自带 /permission，零实现；选择器面板 ✅ S24b，D33） |
| `/preset` | — | — | — | — | **Adopt**（Blue 原创，S28，D33：agent 组合预设空会话切换） |
| `/plan` | ✅ | — | ✅ | ✅ | **Adopt**（随上游插件零实现；plan-review 专用呈现 ✅ S24b，§7 #5 已解决） |
| `/mcp` | ✅ | — | ✅ | ✅ | **Adopt**（✅ S34 2026-08-22 只读列举，D36 定档 D40 落地——loader entries + 双口径 schemas() + bundle 带包；管理面维持 ⛔ §7 #6） |
| `/skills` | — | — | ✅ | ✅ | **Adopt**（✅ S29 已落地 2026-08-21：`#` 提示符管线 + /skills 列表，D34——技能不进 slash 命名空间；§7 #7 缝撤销） |
| 其余 ~45 | 见 §2/§6 | | | | **Reject**（§6 全表；/subagents 族 ⚠️ 顺延见 §3.2） |

## 9. 验收与门禁

- **S29 完成后验收**（命令系列收尾；✅ 代码/单测/e2e 已随期达成 2026-08-21，真实 dogfood 验收待人工门禁）：全部 ⚠️ 命令有明确近似语义记录（§4.2 备注列）；⛔ 项与 §7 缝一一对应（#1/#4/#5/#8 已解决、#7 撤销（D34）、#3 收窄为命令层、#6 收窄为纯管理面（D36），见各条注记）；30 分钟真实 coding 会话中新命令无渲染错乱、无焦点丢失（沿用 P1 验收句式）。
- **每步门禁**：§4.1 第 7 条（test / coverage 逐文件 100% / typecheck / lint / README 双语 / e2e 随步增加）。
- **命令面维护**：`/help` 自动枚举（零维护）；command-meta 注册表是别名唯一事实源；本文档表 B 是 S 步进度跟踪（沿用 p2-visual §7 的 ✅ 落地注模式）。

## 10. 横切风险

| 风险 | 对策 |
|---|---|
| dsh-commands 无元数据 → 别名靠 Blue 侧解析 | command-meta 层先行（✅ 已落地，§2.12：提交时重写 canonical、显示面零去重），上游缝 #9 落地后退化；不阻塞 |
| 外部剪贴板工具梯度（wl-copy/xclip/pbcopy/clip.exe 缺失） | clipboard-write 注入式探测 + 优雅 notice（沿 paste-image reader 先例） |
| /import 的格式严格性（SESSION_FORMAT_VERSION=0、ignorable 标记） | 顺延不阻塞主线（§4.2 表 B 末行） |
| 命令数增长后 /help 双列拥挤 | HelpOverlay 分组表头（kimi priority 精神）——原排 S27' 顺带，未随期（拥挤实感出现再做） |
| /yolo /auto 的"自动放行"语义与 harness policy 'never' 的"不问即拒"冲突 | answerer 侧实现（§4.2.2），不动 harness policy 语义；S24 实施时 🔍 验证 |
| 模型类命令无 idle 守卫的竞态 | installModelSelection 下一 step 生效语义天然安全（§4.1 第 3 条） |
| 上游命令面持续扩张（/compact /plan /goal /permission /feedback 随 base 自动注册，rc.8 可能再增） | 命令面核对以 /help 自动枚举为准（§2.10）；本文表 B 仅跟踪 Blue 自注册命令；上游自带命令 Blue 侧只做验收不注册 |
| `#`→`/name` 重写的词边界（手势正则要求 `(^|\s)` 前置空白）与误触发（markdown 标题 `# `） | ✅ S29 落地：submitPrompt/steer 级 `rewriteSkillTokens` 仅重写命中目录的 user-invocable 名字（保留原前置边界字符，逐字镜像手势正则——非 SubmitTransformer 拼接语义）；触发规则限定 `#` 后紧随名字字符才弹下拉（裸 `#` 除外，列表发现）；单测+e2e 钉住（D34） |
| `/preset` 切换后能力面漂移（minimal 无 plan mode/compaction）与空会话守卫竞态 | UI 能力探测一律走投影/键缺失，不硬编码预设差异；sessionBlank 守卫沿 /fork idle 守卫先例（S28，D33） |
| /mcp 近似状态误导（fiber active ≠ 已连接；预算耗尽后工具消失 fiber 仍 active） | 面板状态推导以 `mcp__` 命名空间下**全局注册**工具存在性为主、fiber phase 为辅（D40 双口径），`no tools` 附"需重载插件"恢复提示（D36；S34 落地） |
