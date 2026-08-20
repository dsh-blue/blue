# Blue 内置命令实施清单：四家参照系合并、能力支撑矩阵与 S23-S28 分期

> 姊妹文档：[blue-p1-design.md](./blue-p1-design.md)（§4.3 命令对照前身，本文档是其全量升级）、[blue-roadmap.md](./blue-roadmap.md)（P2"模式命令随上游能力缝落地逐个接入"条目）、[blue-seams.md](./blue-seams.md)（缝清单）、[blue-decisions.md](./blue-decisions.md)（ADR；本文档为规划文档，实施期的决策记入 ADR）
> 参照系：kimi-code（MoonshotAI，本地源码 `apps/kimi-code/src/tui/commands/registry.ts` 逐条核实，40 内置）、pi（Earendil Works，官方文档 pi.dev/docs/latest/usage，23）、Claude Code（官方文档 code.claude.com/docs/en/commands，~80 内置 + [Skill]/[Workflow] 标记）、Codex（OpenAI，官方 developer-commands 文档，~30 会话内）
> 核实基准：`@deepseek-ai/*@0.1.0-rc.7` 已安装包 .d.ts 逐符号核实（2026-08-20）；本文 ✅/⚠️/⛔/🚫 均带证据
> 本文档回答三个问题：**命令面扩到哪**（四家合并去重后的取舍）、**每条命令的证据**（能力支撑矩阵）、**按什么序做**（S23-S28 分期）。

## 1. 目标与范围

### 1.1 标记约定（沿用 p1-design §1.3，新增 ⚠️）

- ✅ 已核实（rc.7 已安装包内确认存在）
- ⚠️ 可做但语义近似或需前置（实施时可降级/调整）
- 📖 调研文档记载存在，未在本仓库依赖闭包内核实
- 🔍 S 步实施前必须验证
- ⛔ 上游缺口，需先在 harness 做能力缝（清单见 §7）
- 🚫 不做（参照系产品特定或非 Blue 职责）

### 1.2 范围边界

只覆盖 **slash 命令**。已存在的非 slash 输入面——`!` shell 模式（editor-plus）、`@` 文件补全（D31/S22）、Ctrl-O/S/Esc/Ctrl-C 键位链（S3）——不在本文档范围内，不因命令实施而改动。**命令 = `ctx.commands.register` 注册、经 slash 补全 + 回车触发的表面**；动态 surface（skill 命令、plugin 命令，kimi 的 `/skill:name`、`/pluginId:name`）因 harness 无对应系统，一并归入 ⛔（§7 #7）。

### 1.3 与 p1-design §4.3 的关系（两处修正）

p1-design §4.3 是本文档的前身（MVP 后命令面调研）。本次逐符号核实发现**两处过期记录，以本文档为准**：

1. **`LlmCallConfig.purpose='compaction'` 不存在**：rc.7 `dsh-llm/lib/types/call-config.d.ts` 的 `LlmCallConfig` 仅有 `provider/model/reasoningEffort/temperature/maxTokens/stop`（无 purpose 字段），`compaction/start…end` 事件词表只出现在 dsh-session types.d.ts 的 doc comment 里、不在 `SessionEventMap` 中。p1 §4.3 "`/compact` 机制已在（`SurfaceOp replace` + `compaction/*` 事件词表 + purpose 标记）"的结论**过期**——compaction 从请求标记到事件到入口全线缺位，`/compact` 确认 ⛔（§7 #1）。
2. **S2 的 resume 路径模型切换缺口已闭**：p1 记载"补 resume 路径的 `installModelSelection`"；rc.7 中 `packages/app/src/index.ts:72-75` 的 `modelSelectionSetup` 已在 create / startup-resume / request-resume 三条建会话路径统一挂好。残余缺口是 **UI 侧拿不到 `ModelSelectionRef` 句柄**（闭包在 setup 内），这是 S23 开新缝的全部理由（§4.2.1）。

## 2. 参照系命令面对照表（四家合并去重）

合并四家、去重后的全命令面，按 8 组排表。每行：命令 | 各家出现（kimi / pi / CC / Codex）| Blue 现状/去向（已发货 / S 步 / ⛔ / 🚫）。参照系完整清单以官方为准（Claude Code 命令随版本演进，本文按 2026-08 官方文档）；Blue 去向栏与 §4 实施清单、§6 不做表、§7 缝请求互链。

### 2.1 模型与推理

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/model` | ✅ | ✅ | ✅ | ✅ | **S23** 待建（新缝 BlueSessionRef.modelRef） |
| `/effort` (`thinking`) | ✅ | — | ✅ | — | **S23** 待建（LlmModelReasoningInfo.efforts 补全） |
| `/provider` (`providers`) | ✅ | — | — | — | **S23** 待建（list/switch；add/refresh ⚠️ 顺延） |
| `/secondary-model` (`subagent-model`) | ✅ 隐藏 | — | — | — | 🚫 无子 agent 模型概念 |
| `/scoped-models` | — | ✅ | — | — | 🚫 目录级模型无概念（agent 级 selection 已有） |
| `/fast` | — | — | — | ✅ | 🚫 无快速模型切换概念 |
| `/advisor` | — | — | ✅ | — | 🚫 双模型顾问无上游 |
| `/autocompact` | — | — | ✅ | — | 🚫 = /compact 的自动化形态，随 §7 #1 |

### 2.2 会话生命周期

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/new` (`clear` 别名) | ✅ | ✅ | ✅ | ✅ | ✅ 已发货（commands-plugin.ts，`blue/request-new`） |
| `/clear` | 别名 | — | 别名 | ✅ | **S27** 别名注册（command-meta 层） |
| `/resume` | 别名 `/sessions` | ✅ | ✅ | ✅ | ✅ 已发货（commands-plugin.ts，`blue/request-resume`） |
| `/sessions` | ✅ | ✅ | — | — | ✅ 已发货（picker overlay，D30 挂载） |
| `/fork` | ✅ | ✅ | ✅ | — | ✅ 已发货（idle 守卫，`blue/request-fork`） |
| `/btw` | ✅ | — | ✅ | — | ✅ 已发货（pane-btw.ts 自注册） |
| `/undo` | ✅ | — | `/rewind` | — | ⛔ §7 #2（会话原地撤销） |
| `/title` (`rename`) | ✅ | `/name` | — | `/rename` | ⛔ §7 #3（SessionHeader 无 title 字段） |
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
| `/export` (`export-md`) | ✅ | ✅ | ✅ | — | **S26** 待建（fold.ts → Markdown；readRaw 已核实） |
| `/export-debug-zip` | ✅ | — | — | — | 🚫 /debug 覆盖诊断导出 |
| `/import` | — | ✅ | ✅ | ✅ | ⚠️ 顺延（SESSION_FORMAT_VERSION=0 格式严格性） |
| `/copy` | ✅ | ✅ | ✅ | ✅ | **S26** 待建（剪贴板写管线） |
| `/share` | — | ✅ | — | — | 🚫 gist 分享无上游 |
| `/web` | ✅ | — | — | — | 🚫 web 服务非 Blue 职责 |
| `/zip-archive` | — | — | ✅ | — | 🚫 文件工具，`!` shell 覆盖 |

### 2.4 信息与用量

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/status` | ✅ | — | ✅ | ✅ | **S25** 待建 |
| `/usage` | ✅ | — | ✅ | — | **S25** 待建（fold assistant/message.usage 累计器） |
| `/cost` | — | — | ✅ (别名 /usage) | — | 🚫 无 usage/cost 服务，定价表维护不值 |
| `/version` | ✅ | — | — | — | **S25** 待建（banner-content.ts 常量） |
| `/help` (`h`,`?`) | ✅ | — | ✅ | ✅ | ✅ 已发货（HelpOverlay 双列） |
| `/hotkeys` | — | ✅ | — | — | **S27** 别名 → /help（低价值可选） |
| `/keybindings` / `/keymap` | — | — | ✅ | ✅ | 🚫 /help 已覆盖查看；编辑面不做 |
| `/changelog` | — | ✅ | — | — | 🚫 banner what's-new 已承担（面板形式 ⚠️ 顺延） |
| `/whereami` | — | — | ✅ | — | 🚫 = /status 子集 |
| `/recap` | — | — | ✅ | — | 🚫 会话摘要无上游 |

### 2.5 模式与策略

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/yolo` (`yes`) | ✅ | — | — | — | **S24** 待建（approval.setPolicy('never') + Blue answerer 模式） |
| `/auto` | ✅ | — | — | — | **S24** 待建（同上 + questions 自动应答） |
| `/permission` | ✅ | — | `/permissions` | ✅ | ⛔ §7 #4（仅 ask/never 二元，无 presets） |
| `/plan` | ✅ | — | ✅ | ✅ | ⛔ §7 #5（dsh-plan-mode 未随 rc.7 发布） |
| `/goal` | ✅ | — | ✅ | — | 🚫 需持久化目标引擎 + 自治循环 |
| `/swarm` | ✅ | — | — | — | 🚫 多 agent 编排；单 agent fiber（/btw fork 已是侧车极限） |
| `/approve` | — | — | — | ✅ | 🚫 审批面板已承担 |
| `/raw` / `/personality` / `/mute` / `/memories` | — | — | — | ✅ | 🚫 产品特定（memory 无上游） |
| `/experiments` / `/experimental` | ✅ | — | — | ✅ | 🚫 无实验特性管线 |

### 2.6 配置

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/settings` (`config`) | ✅ | ✅ | `/config` | — | **S28** 待建（Blue 自有命名空间可写，harness 命名空间只读列出，⚠️） |
| `/theme` | ✅ | — | ✅ | — | ✅ 已发货（theme-switch.ts） |
| `/editor` | ✅ | — | — | — | 🚫 外部编辑器 Ctrl-G 未实现（roadmap P2 挂起） |
| `/context` | — | — | ✅ | — | **S27** 待建（注入上下文显隐开关，D28/S19 语义反向） |
| `/add-dir` | ✅ | — | ✅ | — | 🚫 会话 cwd 无附加目录原语（roadmap 层无 surface） |
| `/vim` | — | — | ✅ | ✅ | 🚫 需编辑器 provider 实现（P3 缝槽，rc.7 无） |
| `/color` | — | — | ✅ | — | 🚫 主题契约已覆盖 |

### 2.7 生态与运维

| 命令 | kimi | pi | CC | Codex | Blue 现状/去向 |
|---|---|---|---|---|---|
| `/mcp` | ✅ | — | ✅ | ✅ | ⛔ §7 #6（无 dsh-mcp 包） |
| `/skills` | — | — | ✅ | ✅ | ⛔ §7 #7（无 skills 系统） |
| `/plugins` | ✅ | — | ✅ | ✅ | 🚫 cordis 组合层已承担启停（patch 零代码） |
| `/apps` | — | — | — | ✅ | 🚫 无 connector 概念 |
| `/hooks` | — | — | ✅ | ✅ | 🚫 无 hooks 管理面（harness hook 瀑布经组合层） |
| `/tools` | ✅ | — | — | — | **S28** 待建（⚠️ interim：fold request/header.tools；真枚举需 §7 #8） |
| `/tasks` (`task`) | ✅ | — | ✅ | ✅ | **S28** 待建（⚠️ Adapt：映射为 todo 面板，pane-todo 同源） |
| `/init` | ✅ | — | ✅ | ✅ | **S27** 待建（罐头提示 followup 生成 AGENTS.md） |
| `/login` / `/logout` | ✅ | ✅ | ✅ | — | 🚫 认证面由 harness settings/凭据承担 |
| `/doctor` | — | — | ✅ | ✅ | 🚫 与 /debug 合并（做一不做二） |
| `/debug` | — | — | ✅ | — | 🚫 需诊断导出面（⛔ 顺延，随 §7 #10 后的诊断缝） |
| `/feedback` (`bug`) | ✅ | — | ✅ | ✅ | 🚫 反馈通道无上游 |
| `/upgrade` / `/update` | — | — | ✅ | — | 🚫 更新面由 dsh 包管理承担 |

### 2.8 产品特定（不进入命令面合并）

| 命令 | 来源 | 理由 |
|---|---|---|
| `/llama` | pi | 本地模型运行；harness 无本地模型后端 |
| `/dance` | kimi | 隐藏彩蛋 |
| `/radio` / `/powerup` / `/passes` / `/mobile` / `/desktop` | CC | 无关功能/账户产品/远程 surface |
| `/background` / `/subtask` / `/agent` / `/subagents` / `/list-agents` | CC/Codex | 后台/子 agent 模型不存在（单 agent fiber） |
| `/batch` / `/autofix-pr` | CC | 批量编排/CI 集成产品 |
| `/teleport` / `/remote-control` / `/ide` | CC/Codex | 远程/桌面 surface 不存在 |
| `/import` (CC/Codex 语义) | CC/Codex | 配置迁移面（pi 的 JSONL /import 在 §2.3 已单列） |

### 2.9 Blue 已发货命令映射（8 条）

| 命令 | 各家同义 | Blue 注册位置 | 落地 |
|---|---|---|---|
| `/quit` | kimi/pi/CC/Codex `exit`/`quit`/`q` | `packages/interaction/src/commands-plugin.ts` → `ctx.get('appExit')(0)` | ✅ S6 |
| `/resume <id>` | 四家 | `commands-plugin.ts` → `'blue/request-resume'` | ✅ S6 |
| `/new` | kimi `clear`、CC `clear`/`reset` | `commands-plugin.ts` → `'blue/request-new'` | ✅ S6 |
| `/fork` | kimi/pi/CC | `commands-plugin.ts` → `'blue/request-fork'`（idle 守卫） | ✅ S6 |
| `/sessions` | kimi `sessions`、pi `resume` | `commands-plugin.ts` → `sessionPersistence.list` picker（D30 editor-slot 替换） | ✅ S6 |
| `/help` | kimi `help`/`h`/`?`、CC/Codex | `commands-plugin.ts` → `HelpOverlay`（commands + keys 双列） | ✅ S6 |
| `/theme` | kimi/CC | `packages/interaction/src/theme-switch.ts`（provider 换装） | ✅ S4 |
| `/btw <question>` | kimi/CC | `packages/transcript/src/pane-btw.ts`（fork 旁路 agent） | ✅ S6 |

### 2.10 kimi registry 元数据字段 vs dsh-commands rc.7

kimi `KimiSlashCommand`（`apps/kimi-code/src/tui/commands/types.ts`）声明的元数据：`argumentHint`（补全行内提示）、`completeArgs(prefix)`（参数补全器）、`availability: 'always' | 'idle-only' | fn`（流式期间可用性）、`experimentalFlag`（实验门控隐藏）、`aliases`。dsh-commands rc.7 `CommandDefinition`（`dsh-commands/lib/index.js` `normalizeDefinition`）仅有 `name/description/input?/recordInput?/handler`，**无元数据字段**。差距与 Blue 侧落点：

- `input.hint` 已有（`/resume` 已用）→ 补全行内提示 ✅ 现成
- `aliases` → Blue 侧 `command-meta.ts` 注册表（S27，§4.1）；同时列上游 nice-to-have 缝（§7 #9）
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
| dsh-tools ToolRuntime（register/presentAs/restrict/guard；**无 list()**） | — | — | — | — | — | ⚠️ /tools interim fold request/header.tools（§7 #8） |
| dsh-settings（settingsNamespace + register + get/patch） | — | — | — | — | ✅ /context 开关持久 | ⚠️ /settings 仅 Blue 自有命名空间可写 |
| 会话事件面（turn/step/user/assistant/tool/todo/request/command/approval 全系） | — | ✅ 'approval/policy' 折叠 | ✅ fold turn/assistant-message.usage/request-context | — | ✅ fold 注入上下文（source.kind!=='user'，D28） | ✅ fold todo/write（pane-todo 同源） |
| dsh-cmdline（appExit + cmdlineArgs） | — | — | — | — | — | —（/quit 已用） |
| attachments（dsh-attachment 纯图片） | — | — | — | — | — | —（与命令面无关） |

### 3.1 已排除能力面（逐条证据）

| 能力面 | rc.7 证据 | 影响 |
|---|---|---|
| compaction 入口 | `dsh-agent-loop/lib/types/` 全目录 grep 零 compact 符号；`LlmCallConfig` 无 purpose 字段（call-config.d.ts:16-23） | /compact ⛔（§7 #1）；p1 §4.3 说法过期（§1.3） |
| 会话原地撤销 | 唯一原语是 fork 产新会话（`agents.create` seed 语义） | /undo ⛔（§7 #2） |
| 会话标题 | `SessionHeader`（dsh-session types.d.ts:40-78）9 字段无 title | /title /name ⛔（§7 #3） |
| 权限预设 | 仅 `approval.setPolicy(agent, 'ask'\|'never')` 二元；permissionPresets 全仓零命中 | /permission ⛔（§7 #4） |
| plan 模式 | dsh-plan-mode 未随 rc.7 发布（仅 README 引用） | /plan ⛔（§7 #5） |
| MCP 管理 | pnpm store 无 @deepseek-ai/dsh-mcp | /mcp ⛔（§7 #6） |
| skills 系统 | 无 dsh-skill 包；kimi 的 skill 命令面无对映 | /skills ⛔（§7 #7） |
| 工具枚举 | `ToolRuntime`（dsh-tools index.d.ts:493-640）仅 register/presentAs/restrict/guard，无 list() | /tools ⚠️ interim（§7 #8） |
| usage/cost 服务 | 无 dsh-usage 包；用量信息只存在于 `assistant/message.usage`（TokenUsage）事件字段 | /usage 需 Blue 自维护累计器（S25） |
| 命令元数据 | `normalizeDefinition` 仅 name/description/input/recordInput/handler | 别名/可用性落 Blue 侧 command-meta（§4.1；§7 #9） |

## 4. 实施清单（逐命令）

### 4.1 命令注册纪律（新命令共同遵守）

1. **effect-bound 注册**：沿用 commands-plugin.ts 现有模式——`ctx.effect(() => { ... register ...; return disposers })`，fiber 卸载即注销。
2. **display 服务一律 handler 内 `ctx.get` 惰性解析**，不 inject `blueTheme` 等显示服务——`/theme` 换装会 dispose 自己 handler 所在 fiber 的雷（S6 教训）。
3. **会话切换类命令 idle 守卫**（/fork 先例：`blueSession.current.status !== 'idle'` 报错）；**模型类命令无需守卫**（installModelSelection 下一 step 生效，语义天然安全）。
4. **新模块 `interaction/src/command-meta.ts`**：Blue 侧命令元数据注册表（别名 → 主命令名、可选 availability 提示），slash 补全与 editor-plus 消费；与 dsh-commands 注册并行（每条别名仍实际注册一条命令，语义一致），上游缝 #9 落地后可退化为声明。
5. **/help 自动枚举**（`commands.list` + `keymap.list()`），新命令零维护。
6. **对话框一律 D30 editor-slot 替换挂载**（`mountEditorReplacement`），非浮层；列表类面板复用 `SessionList`/`BlueSelect` + `framePanel`/`topRule` chrome。
7. **门禁**（每 S 步）：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；README 双语同步；bundle e2e 用例随步增加。

### 4.2 待建命令表（S23-S28，20 条）

| 命令 | 来源 | 参数与补全 | 行为 | UI 表面 | 能力依赖 | S 步 | 备注 |
|---|---|---|---|---|---|---|---|
| `/model [name]` | kimi/CC/Codex | 无参=列表；补全=llm.listModels | 切换当前会话模型；无参打开选择器；`saveSelection` 持久默认 | BlueSelect 面板（mountEditorReplacement，/sessions 模式） | ✅ 新缝 BlueSessionRef.modelRef（§4.2.1）；llm.listModels/resolveModelInfo；agentDefaultModel.saveSelection | S23 | 无需 idle 守卫（下一 step 生效）；选项显示 context window + reasoning 元数据 |
| `/effort [level]` | kimi/CC | 补全=resolveModelInfo().reasoning.efforts | 写 selection.current.reasoningEffort | 列表面板 | ✅ 同 /model；LlmModelReasoningInfo{efforts, defaultEffort} | S23 | 无效 effort 报错（adapter 也拒） |
| `/provider [list\|switch <name>]` | kimi | 无参=列表 | 列 providers、切换活跃 route（重置 model 为 provider 默认） | 列表面板 | ✅ llm.listProviders + listConfigurableProviders | S23 | add/refresh 需 discoverModels + 凭据输入面 + settings 命名空间 → ⚠️ 顺延 |
| `/yolo` | kimi/CC | — | 切换自动放行工具审批 | notice + blueStatus 新条目（当前策略徽章） | ✅ approval.setPolicy(agent,'never')；'approval/policy' 事件折叠，resume 恢复 | S24 | 提问仍弹（userQuestions 独立服务）——kimi 语义一致；关闭恢复 'ask' |
| `/auto` | kimi/CC | — | 完全自治 = 'never' + questions answerer 自动默认应答 | 同上 | ✅ setPolicy('never') + user-questions 注册自动应答 provider | S24 | 关闭恢复 'ask' + 自动应答卸载 |
| `/status` | kimi/CC/Codex | — | 会话 id/cwd/创建时间、模型/provider、turn 数、agent 状态、版本 | HelpOverlay 式两列只读面板 | ✅ session.header、requestHeader()?.config、fold turn/start 计数、agent.status | S25 | |
| `/usage` | kimi/CC | — | 累计 input/output/cacheRead/cacheWrite/reasoning tokens + contextWindow 百分比 | 面板 | ✅ fold assistant/message.usage（TokenUsage）+ requestContext()?.contextWindow；新模块 transcript/src/usage.ts 累计器（status-context 的 contextTokens 复用提升） | S25 | status-context 只算最新一步占用，/usage 是会话总额；跨 resume 累计正确 |
| `/version` | kimi | — | BLUE_VERSION + harness rc.7 + 当前模型 | notice | ✅ banner-content.ts 常量（spec 守卫 package.json 先例） | S25 | |
| `/export [path]` | kimi/pi/CC | 默认路径 | fold.ts 折叠 → Markdown 文件写 | notice + 路径回显 | ✅ persistence.readRaw（jsonl 后端 supportsRawArtifacts=true 已核实）+ fs | S26 | kimi /export-md 同款；debug-zip 不做 |
| `/copy` | kimi/CC/Codex | — | 复制最近一条 assistant 消息文本 | notice | ✅ Blue 侧剪贴板写管线（新模块 interaction/src/clipboard-write.ts，注入式探测 wl-copy/xclip/pbcopy/clip.exe，沿 paste-image reader 先例）；OSC 52 主屏不可用（roadmap 挂起项） | S26 | |
| `/init` | kimi/CC/Codex | — | 罐头提示 followup（分析代码库写 AGENTS.md） | notice | ✅ agent.followup；idle 守卫 | S27 | 罐头提示族（/security-review 等）只做这一个，留缝 |
| `/clear` | kimi(别名)/CC/Codex | — | = /new 语义（kimi 同款；CC"清 transcript 留会话"无原语） | — | ✅ 经 command-meta 别名注册同 handler | S27 | 别名机制落 command-meta |
| `/context` | CC | — | 切换注入上下文显隐（D28/S19 默认隐藏的反向开关） | notice + 状态栏 | ✅ fold 注入上下文开关（fold.ts，source.kind!=='user' 分拣）+ settings 持久 | S27 | |
| `/diff` | CC/Codex | — | git status + git diff（未提交变更）面板 | 全宽面板，复用 DiffCardComponent + line-diff.ts | ✅ spawnSync('git')（status-git 先例，TTL 缓存可复用） | S27 | 非 git 仓库报错 |
| `/hotkeys` | pi | — | 别名 → /help | — | ✅ command-meta | S27 | 低价值可选 |
| `/settings` | kimi(别名 config)/pi/CC | 列表导航 | 编辑 Blue 自有命名空间（theme custom 路径等）；其他命名空间只读列出 | 列表面板 + 内联编辑（questionnaire 模式） | ⚠️ dsh-settings settingsNamespace + register(schemastery) + patch()；仅 Blue 自有命名空间可写 | S28 | harness 命名空间归其 owner 插件 |
| `/reload` | kimi/pi | — | 重读 Blue settings + 主题重挂 | notice | ⚠️ theme-switch 换装机制已有；kimi 的 config.toml/tui.toml 语义不存在 | S28 | |
| `/tools` | kimi | — | 列出当前会话工具集 | 面板 | ⚠️ interim：折叠最近 request/header 的 EpochHeader.tools（ToolSchema[]）；真枚举需上游 ToolRuntime.list()（§7 #8） | S28 | 升级点：上游缝落地后换真枚举 |
| `/tasks` | kimi/CC/Codex | — | 映射为 todo 面板（todo/write 折叠，pane-todo 同源） | 面板（pane-todo 复用） | ⚠️ 无后台任务模型（单 agent fiber）；真实任务语义等上游 | S28 | Adapt 裁决：Blue 的 /tasks = todo 列表 |
| `/import` | pi/CC/Codex | 文件路径 | 外部 JSONL 解析+校验 → sessionPersistence.prepare + agents.create(seed) | 面板/notice | ⚠️ SESSION_FORMAT_VERSION=0 严格性、ignorable 标记、校验成本高 | 顺延 | 不阻塞主线 |

#### 4.2.1 S23 新缝：BlueSessionRef.modelRef

`/model` `/effort` `/status` 的地基。现状：`packages/app/src/index.ts:72-75` `modelSelectionSetup` 把 `installModelSelection(agentCtx, selection)` 挂在三条建会话路径上，`selection: ModelSelectionRef` 闭包在 setup 内，UI 拿不到句柄。

**方案**：`blueSession` 服务（app 层）增 `modelRef: ModelSelectionRef | undefined` 可变引用——`modelSelectionSetup` 创建 selection 时写入 `blueSession.modelRef`，会话切换（`'blue/session-changed'`）时随 current agent 更新。契约沿 `blueSession` 既有形态（服务 + 事件），L1 核心签名不动（"只增不改"）。新命令 handler 经 `ctx.get('blueSession')?.modelRef` 读写 `current`（下一 step 生效，天然无竞态）。

#### 4.2.2 S24 语义说明

`approval.setPolicy('never')` 是"永不询问、一律拒绝"（fail-closed 姿态，dsh-user-approval index.d.ts:77-80），**不是**自动允许。/yolo /auto 的"自动放行"由 Blue 侧实现：**approval answerer 是 Blue 插件**（approval-plugin.ts），在 answerer 内加 auto 模式（policy 'never' 时仍弹窗？否——设计为：/yolo 置 policy 'never' + Blue answerer 观察到 'never' 时自动回 `'allowed-once'`；harness 的 'never' 语义是"不问即拒"，answerer 不参与。**因此 /yolo 的实现面在 answerer 而非 policy**：/yolo 切换 Blue answerer 的 auto-approve 开关（模块级 + 持久化 'approval/policy' 事件旁挂 Blue 自己的会话事件），/auto = /yolo + questions 自动应答。harness policy 仍 'ask' 不动，保证 answerer 可接管。此点 S24 实施时验证（🔍）。

### 4.3 ⛔ 等上游命令（互链 §7）

| 命令 | 上游缝 | 消费依赖 |
|---|---|---|
| `/compact [instruction]` | #1 压缩 API | agent.compact + compaction/* 事件 |
| `/undo` | #2 会话原地撤销 | session 截断原语 |
| `/title` `/name` | #3 SessionHeader.title | 字段 + 持久化 |
| `/permission` | #4 permissionPresets | 注册表 + 模式切换 |
| `/plan` | #5 plan mode | dsh-plan-mode 发布 |
| `/mcp` | #6 MCP 状态 | 注册表 + 状态列举 |
| `/skills` | #7 skills 系统 | skill 注册表 + 加载 |

### 4.4 🚫 明确不做命令（互链 §6）

见 §6 全表。要点：产品特定（/llama /swarm /web /share /dance /radio /mobile /desktop /powerup /passes /autofix-pr /batch）、无上游能力（/login /logout /goal /cd /vim /memory /trust /scoped-models /tree /branch /clone /session /cost /fast /approve /raw /personality /mute /memories）、既有面覆盖（/plugins /apps /hooks = 组合层；/hotkeys → /help；/changelog → banner；/git → `!` shell；/export-debug-zip → /debug；/keybindings → /help 查看）、评审/诊断族留缝（/security-review /code-review /doctor 仅做 /init 一个罐头提示）。

## 5. 分期实施（S23-S28）

每步一棵可启动、可验收的插件树（总原则 #1）。依赖链：**S23 的 BlueSessionRef 缝是 S25 /status 读模型的地基，必须第一步开**；S24 无前置；S26 依赖 S25 的 fold/累计器；S27 的 command-meta 是 S28 别名/可用性机制的地基。

| 步 | 内容 | 能力依赖 | UI 复用 | 验收要点 |
|---|---|---|---|---|
| **S23** 模型与强度 | `/model` `/effort` `/provider`(list/switch) | 新缝 BlueSessionRef.modelRef（§4.2.1）；llm.listModels/listProviders + LlmResolvedModelInfo | BlueSelect 面板 + mountEditorReplacement + notice | 面板列模型含 context/reasoning 元数据；切换后下一 step 生效；saveSelection 持久跨进程；switch session 后 selection 跟随新 agent |
| **S24** 自治与授权 | `/yolo` `/auto` | approval answerer 自动模式（§4.2.2 🔍）；'approval/policy' 折叠；questions 自动应答 | notice + 新 blueStatus 条目（策略徽章） | 会话内审批免弹窗（answerer 自动放行）；resume 后模式恢复；/auto 下提问自动作答；切会话回默认 |
| **S25** 会话信息 | `/status` `/usage` `/version` | session.header / requestHeader / requestContext；fold assistant/message.usage；新模块 transcript/src/usage.ts 累计器 | HelpOverlay 式两列面板 + notice | 数字与 fold 事件一致；usage 累计跨 resume 正确；/version 与 banner 常量一致 |
| **S26** 导出与复制 | `/export` `/copy` | persistence.readRaw（supportsRawArtifacts=true）；fold.ts 折叠→Markdown；新模块 interaction/src/clipboard-write.ts（注入式探测） | notice + 路径回显 | 导出文件可独立阅读；复制文本与最近 assistant 消息一致；无剪贴板工具时优雅报错（notice） |
| **S27** 轻命令族 | `/init` `/clear` `/context` `/diff`（+可选 `/hotkeys`） | 新模块 interaction/src/command-meta.ts（别名表，slash-filter/editor-plus 消费）；fold 注入上下文开关；git spawnSync（status-git 先例） | notice / DiffCardComponent 全宽面板 / HelpOverlay 分组表头（kimi priority 精神） | 别名可补全可执行（/clear = /new）；/context 开关即时生效且跨会话持久；/diff 面板滚屏正常 |
| **S28** 配置与生态 | `/settings` `/reload` `/tools` `/tasks` | dsh-settings 注册 'blue' 命名空间；theme-switch 换装复用；request/header.tools 折叠；todo/write 折叠（pane-todo 同源） | 列表+内联编辑面板（questionnaire 模式）/ notice / pane 面板 | 设置持久生效；/reload 只影响 Blue 自有面；/tools 列表与 request/header 一致；/tasks = todo 折叠一致 |

每步门禁：`pnpm run test` / `test:coverage`（逐文件 100%）/ `typecheck` / `lint` 全绿；README 双语同步；bundle e2e 用例随步增加（每命令 ≥1 用例：注册可见 + 主路径行为 + 守卫路径）。

## 6. 明确不做（🚫）与理由

| 命令 | 来源 | 理由 |
|---|---|---|
| `/llama` | pi | 本地模型运行；harness 无本地模型后端 |
| `/swarm` | kimi | 多 agent 编排；单 agent fiber 模型（/btw fork 已是侧车极限） |
| `/web` `/share` | kimi/pi | 无 web/gist 服务，非 Blue 职责 |
| `/dance` | kimi | 隐藏彩蛋 |
| `/radio` `/powerup` `/passes` | CC | 无关功能 / 账户与 API 信用产品 |
| `/mobile` `/desktop` `/ide` `/teleport` `/remote-control` `/background` | CC/Codex | 远程/桌面/后台 surface 不存在 |
| `/subtask` `/agent` `/subagents` `/list-agents` | CC/Codex | 子 agent 模型不存在（单 agent fiber） |
| `/batch` `/autofix-pr` | CC | 批量编排 / CI 集成产品 |
| `/login` `/logout` | kimi/pi/CC | 认证面由 harness settings/凭据承担；无平台认证流程 |
| `/export-debug-zip` | kimi | /debug 覆盖诊断导出（/debug 亦顺延） |
| `/plugins` `/apps` `/hooks` | kimi/CC/Codex | 插件管理；cordis 组合层已承担启停（patch 零代码） |
| `/editor` | kimi | 外部编辑器 Ctrl-G 未实现（roadmap P2 挂起项） |
| `/experiments` `/experimental` | kimi/Codex | 无实验特性管线 |
| `/goal` | kimi/CC | 需持久化目标引擎 + 自治循环（runMaintenance 不足成立产品语义） |
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
| `/autocompact` | CC | = /compact 的自动化形态，随 §7 #1 |
| `/fast` | Codex | 无快速模型切换概念 |
| `/add-dir` | kimi/CC | 会话 cwd 无附加目录原语 |

## 7. 上游缝请求清单（⛔，完整草案）

每条：期望 API 签名草案 + 消费命令 + rc.7 证据 + 优先级。提交给 harness 仓库（`@deepseek-ai/dsh-*`）时按本表逐条转 issue/PR。

### #1 压缩 API（P0）— 消费：/compact

- **期望**：`dsh-agent-loop` 增 `agent.compact(instruction?: string): Promise<void>`——压缩历史 turn 为摘要（`SurfaceOp replace` + 摘要 user 消息），期间 `agent/status` 进入 compacting、阻塞新输入；`dsh-llm` `LlmCallConfig` 增可选 `purpose?: 'compaction'` 请求标记；dsh-session 事件面落地 `compaction/start` + `compaction/end`（含摘要文本）。
- **rc.7 证据**：agent-loop lib/types 零 compact 符号；call-config 无 purpose；`compaction/*` 词表仅 doc comment（§1.3）。

### #2 会话原地撤销（P0）— 消费：/undo

- **期望**：`dsh-session`（或 persistence）增会话截断原语：`session.truncate(boundarySeq: number, cause)`——删除 boundary 之后的事件（含 fork/undo 审计事件），或官方承认的 undo 语义（如 kimi 的"撤回最近 prompt"= 删最后 user/assistant 对）。
- **rc.7 证据**：唯一原语是 fork 产新会话（agents.create seed 语义）；无截断/删除 API。

### #3 会话标题（P1）— 消费：/title /name /rename

- **期望**：`SessionHeader` 增 `title?: string` 字段 + persistence 更新原语（`rename(id, title)` 追加标题事件或 header 修订）；可选标题自动生成请求标记（`purpose: 'session-title'`）。
- **rc.7 证据**：SessionHeader（dsh-session types.d.ts:40-78）9 字段无 title；无 header 修订 API。

### #4 权限预设（P1）— 消费：/permission

- **期望**：`ctx.permissionPresets` 注册表（register({id, label, policy, description}) + list()）+ `approval.setPreset(agent, id)` 一键切换组合策略；Blue 模式 UI 自动列出。
- **rc.7 证据**：仅 `setPolicy('ask'|'never')` 二元；permissionPresets 全仓零命中（p1 §6.2 已记录 ⛔）。

### #5 plan 模式（P1）— 消费：/plan

- **期望**：`dsh-plan-mode` 插件随 harness 发布：plan 模式下 agent 只读（工具调用走 guard 拒写）/只输出计划；`agent.planMode` 切换 + 会话事件。
- **rc.7 证据**：仅 README 引用；无包。

### #6 MCP 状态（P1）— 消费：/mcp

- **期望**：`dsh-mcp` 服务：服务器注册表 + `mcp.listServers()`（id/状态/工具数）+ 启停。
- **rc.7 证据**：pnpm store 无 dsh-mcp 包。

### #7 skills 系统（P1）— 消费：/skills、`/skill:name` 动态命令

- **期望**：skill 注册表 + 加载（`ctx.skills.register/list/load`），命令面自动枚举为 `/skill:name`。
- **rc.7 证据**：无 dsh-skill 包；kimi 的 skill 命令面无对映。

### #8 工具枚举（P2）— 消费：/tools（升级 interim）

- **期望**：`ToolRuntime` 增 `list(): ToolDescriptor[]`——name/description/参数 schema/restricted/guarded 状态；`/tools` 从 fold `EpochHeader.tools` 升级为真枚举。
- **rc.7 证据**：ToolRuntime（dsh-tools index.d.ts:493-640）仅 register/presentAs/restrict/guard。

### #9 命令元数据（P3 nice）— 消费：全体命令

- **期望**：`CommandDefinition` 可选字段 `aliases?: string[]` / `availability?: 'always'|'idle-only'` / `argumentHint?: string`（已有 input.hint）/ `completeArgs?(prefix)`。Blue 侧 command-meta 先行不阻塞（§4.1）。
- **rc.7 证据**：normalizeDefinition 仅 name/description/input/recordInput/handler。

### #10 会话删除/归档（P3 nice）— 消费：未来 /delete /archive

- **期望**：`SessionPersistence` 增 `delete(id)` / `archive(id)` 原语。
- **rc.7 证据**：persistence 仅 list/create/append/prepare/readRaw/locate。

## 8. Adopt / Adapt / Reject 总表

按四家参照系各一列，最终裁决一列（互链 §4/§6）。

| 命令 | kimi | pi | CC | Codex | 最终裁决 |
|---|---|---|---|---|---|
| `/model` | ✅ | ✅ | ✅ | ✅ | **Adopt**（S23） |
| `/effort` | ✅ | — | ✅ | — | **Adopt**（S23） |
| `/provider` | ✅ | — | — | — | **Adopt**（S23，list/switch） |
| `/yolo` | ✅ | — | — | — | **Adopt**（S24） |
| `/auto` | ✅ | — | — | — | **Adopt**（S24） |
| `/status` | ✅ | — | ✅ | ✅ | **Adopt**（S25） |
| `/usage` | ✅ | — | ✅ | — | **Adopt**（S25） |
| `/version` | ✅ | — | — | — | **Adopt**（S25） |
| `/export` | ✅ | ✅ | ✅ | — | **Adopt**（S26，折叠 Markdown） |
| `/copy` | ✅ | ✅ | ✅ | ✅ | **Adopt**（S26） |
| `/init` | ✅ | — | ✅ | ✅ | **Adopt**（S27） |
| `/clear` | 别名 | — | 别名 | ✅ | **Adopt**（S27，= /new 别名） |
| `/context` | — | — | ✅ | — | **Adopt**（S27，显隐开关） |
| `/diff` | — | — | ✅ | ✅ | **Adopt**（S27） |
| `/settings` | ✅ | ✅ | ✅ | — | **Adapt**（S28，仅 Blue 命名空间可写） |
| `/reload` | ✅ | ✅ | — | — | **Adapt**（S28，仅 Blue 自有 settings） |
| `/tools` | ✅ | — | — | — | **Adapt**（S28，interim fold request/header） |
| `/tasks` | ✅ | — | ✅ | ✅ | **Adapt**（S28，→ todo 面板） |
| `/import` | — | ✅ | ✅ | ✅ | **Adapt**（顺延，JSONL 校验严格） |
| `/hotkeys` | — | ✅ | — | — | **Adapt**（S27 可选，→ /help 别名） |
| `/compact` | ✅ | ✅ | ✅ | ✅ | **Defer**（⛔ §7 #1） |
| `/undo` | ✅ | — | ✅ | — | **Defer**（⛔ §7 #2） |
| `/title` | ✅ | ✅ | — | ✅ | **Defer**（⛔ §7 #3） |
| `/permission` | ✅ | — | ✅ | ✅ | **Defer**（⛔ §7 #4） |
| `/plan` | ✅ | — | ✅ | ✅ | **Defer**（⛔ §7 #5） |
| `/mcp` | ✅ | — | ✅ | ✅ | **Defer**（⛔ §7 #6） |
| `/skills` | — | — | ✅ | ✅ | **Defer**（⛔ §7 #7） |
| 其余 ~45 | 见 §2/§6 | | | | **Reject**（§6 全表） |

## 9. 验收与门禁

- **S28 完成后验收**：全部 ⚠️ 命令有明确近似语义记录（§4.2 备注列）；⛔ 项与 §7 缝 #1-#10 一一对应；30 分钟真实 coding 会话中新命令无渲染错乱、无焦点丢失（沿用 P1 验收句式）。
- **每步门禁**：§4.1 第 7 条（test / coverage 逐文件 100% / typecheck / lint / README 双语 / e2e 随步增加）。
- **命令面维护**：`/help` 自动枚举（零维护）；command-meta 注册表是别名唯一事实源；本文档表 B 是 S 步进度跟踪（沿用 p2-visual §7 的 ✅ 落地注模式）。

## 10. 横切风险

| 风险 | 对策 |
|---|---|
| dsh-commands 无元数据 → 别名靠注册第二条命令 | command-meta 层先行（§4.1），上游缝 #9 落地后退化；不阻塞 |
| 外部剪贴板工具梯度（wl-copy/xclip/pbcopy/clip.exe 缺失） | clipboard-write 注入式探测 + 优雅 notice（沿 paste-image reader 先例） |
| /import 的格式严格性（SESSION_FORMAT_VERSION=0、ignorable 标记） | 顺延不阻塞主线（§4.2 表 B 末行） |
| 命令数增长后 /help 双列拥挤 | S27 顺带 HelpOverlay 分组表头（kimi priority 精神） |
| /yolo /auto 的"自动放行"语义与 harness policy 'never' 的"不问即拒"冲突 | answerer 侧实现（§4.2.2），不动 harness policy 语义；S24 实施时 🔍 验证 |
| 模型类命令无 idle 守卫的竞态 | installModelSelection 下一 step 生效语义天然安全（§4.1 第 3 条） |
