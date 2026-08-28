# Blue 能力补齐调研手册（2026-08-28）

> 三路调研汇总：①dsh Web 端插件生态（外网）②dsh-TUI 源码功能对比（本地）③harness 插件机制能力面（本地）。
> 用途：本体/插件形态划分 + 补齐排期输入。与 tui-pain-points.md、directories.md 互为补充（两册为本地工作文件，未随库）。
> 口径：Blue 现状以 2026-08-28 工作树源码为准（marketplace/launch 分支，rc.8 线 + 插件市场）；dsh-TUI 与 harness 以本地 checkout（0.1.1-rc.2 线）为准。

## 〇、格局三句话

1. **Web 生态**：官方无市场，目录站即事实市场（dshdocs npm 直抓 1179 包、dsh.so featured、awesome-dsh-plugin.com 11.8k★）。插件分两栖：纯 Web UI 层（侧边栏/看板/皮肤）与 **host 侧能力插件**（视觉桥/搜索/浏览器/记忆——任何 profile 可装，含 blue）。
2. **dsh-TUI 竞品**：18 项缺口里只有 2 个 L 级（远程接入用户面、i18n）；遥测行、/doctor、随包技能等是 S 级高杠杆。Blue 反向有 15 项自有优势（插件生态、frontend runtime、子 agent live pane、/fork 谱系、原地换模型、审批四选项、图片体验、/update 安全更新……）。
3. **机制**：harness 一切皆 Cordis 插件；Web 浏览器半是另一套 API（slots + remote 白名单 RPC）；Blue 插件窄门四能力（commands/status/dock/notifications），tools/editor/panels/session.read/session.act 已声明未开放（phase 1 一律 DENIED）。

## 一、本体 vs 插件判据（裁决链，按序检查）

1. **机制硬判据**（不可取舍）：落在渲染树/输入循环/键位表/终端层/会话生命周期/wire 白名单/sealed 参数上的，**只能进本体**——入口不存在，不是取舍问题。（证据：website plugins/seams.md 内部边界表；api-remotes README；interception note）
2. **核心回路判据**：核心对话回路体验（输入、呈现、会话管理、模型切换、运维命令族）→ 本体默认 bundle 行。
3. **独立演进判据**：功能域自包含 + 数据自维护（价目表、registry、分析逻辑）+ 迭代节奏与本体解耦 → 插件包。
4. **生态战略判据**：刻意做成插件喂 marketplace 故事；官方插件 = "首个真实消费者"，用它们驱动 phase 2 能力开放（session.read 等），符合既有"首个真实消费者驱动"纪律。
5. **红利优先判据**：Web 生态已证明的 host 侧需求，先验证零成本承接（装进 blue profile），不够再自研——1179 包生态是 Blue 的"零成本能力池"。

## 二、进本体（Blue core / 默认 bundle 行）

| 能力 | 来源 | 量级 | 理由 |
|---|---|---|---|
| **遥测行**：TPS gauge+sparkline、缓存命中率、实时 in/out token | dsh-TUI A3 | S(footer)/M(完整形态) | session-stats 投影已消费（/status 用），纯呈现差距；常驻遥测 Blue 一项都没有；状态栏条目=本体默认行体验 |
| **/doctor 环境自检** | dsh-TUI A5 | S | 运维命令族（/update /version 同族）；要读 Blue 内部状态（壳/harness 线/profile/终端探测）；Blue 装机坑史（pnpm 冷却期、profile 语法、镜像延迟）比 dsh-TUI 更需要它；website FAQ 散装知识可收敛进来 |
| **远程接入用户面**：/connect /attach /detach /channel，daemon/live 双模式，bootstrap 向导，SSH 目录浏览 | dsh-TUI A1 + Web 生态 dsh-pocket | **L** | 唯一 L 级缺口；attach/detach 涉及会话生命周期（blueSession），机制上只能本体；**wire 底座已在**（packages/remote F4 适配器，现仅库层无 UI）；三路信号撞车：Web 热门插件（dsh-pocket 手机远程）+ dsh-TUI 最大差异化 + 底座已备 |
| **i18n**：/lang 中英切换、全 UI 文案热切换 | dsh-TUI A2（469 条字典、默认 zh） | **L**（分阶段：高频面 M） | 文案在渲染树里，机制上只能本体；中文社区=主宣传阵地，dsh-TUI 默认中文对获客有直接帮助；可先做 footer/面板标题/notice/审批问卷选项 |
| **剪贴板读取面补齐**：读剪贴板文本插入、复制任意文件→插路径 | dsh-TUI B 区（Ctrl+V 三合一） | S-M | 输入循环=本体；现状：Ctrl+V 只管图片（+图片文件批量），纯文本依赖 bracketed paste；图片侧 Blue 反而更强（内联渲染/多类型探测/六级失败分类） |
| **低垂果实批**：Ctrl+R 历史搜索（A7）、Esc-Esc rewind 手势（A9，命令层已齐只差手势）、goal 阶段面板（A11，goal/change 事件与 ctx.goals 现成，pane-todo 扩展）、OSC 8 可点链接（A13，terminal-escape.ts 基建在） | dsh-TUI | 各 S | 输入层/键位/terminal 层，全是本体域 |
| **通知体系**：bell / OSC 9 桌面通知 / OSC 1004 失焦门控 | 挂起区解除 + Web 生态 dsh-notifier 类 | S-M | terminal 层=本体；kimi terminal-notification.ts 同构可照抄；解除条件=正式版 UX 评审 |
| **@ 内容附加**（发送时把 @file 内容以文本拼入消息） | dsh-TUI A4 | S（先裁决） | 输入层=本体；**需重过产品裁决**：D31 否决的是"结构化附件"（harness 无 FileBlock 且 DeepSeek text-only 毁 turn），文本拼接不受该裁决约束，但属同一问题域，须明确裁定 |

## 三、官方插件（@dsh-blue scope，上自家 marketplace）

| 插件 | 对标 | 量级 | 理由与注意 |
|---|---|---|---|
| **blue-plugin-market**：/plugins 浏览/搜索/一键装卸 | dsh-market（★563）、webui-market-plugin（npm 2.1k/wk）、该域 65 个插件在卷 | S-M | 生态飞轮入口（TUI 内发现→安装→生态滚动）；数据源= dsh-blue/marketplace registry.json（网站同一源）；安装翻译 `blue plugin add` 已有；四能力完美示范（commands+dock+notifications） |
| **blue-context-inspector**：上下文透视深度面板（组成占比明细、token 趋势、压缩/剪枝事件） | dsh-context（★0.6-1k、dsh.so Gold、五篇推荐文全命中）——Web 生态最强单一缺口信号 | M | /context 基础面（四桶+启发式分解条）本体已有；深度版做插件；**注意**：需 session-projection/token-meter 数据，phase 1 的 session.read 是 DENIED——这正是"官方插件=首个真实消费者、驱动 phase 2 开放 session.read"的教科书案例（或官方插件直接 inject harness 服务，机制上没拦，但要在收录规则里说清官方/第三方口径差异） |
| **blue-cost-meter**：会话/当日费用、预算、token 热力图 | dsh-cost-meter（dsh.so featured、atlascloud 七件套） | S | 价目数据自维护（models.dev 元数据 S23 已在用）、迭代节奏独立=典型插件形态 |
| **随包技能包** | dsh-TUI A6（7 个内置 SKILL.md；Blue # 管线齐全但目录是空的） | S（零代码纯内容） | **裁决点**：本体随包（开箱体验，dsh-TUI 证明价值）vs 独立 blue-skills 包（内容迭代解耦+marketplace 示范）；可折中=本体带 3 核心+扩展包 |

## 四、生态承接（不自己写，验证+适配+收录）

1. **host 侧头部插件 blue profile 兼容验证**（最高杠杆）：ModLens（视觉桥 ★2.4-3.4k）、dsh-vision-toolkit/router、modsearch（搜索桥）、dsh-browser/BrowserSkill、dsh-agent-teams、dsh-mnemon（记忆 npm ~1k/wk）——机制上零改动可装进 blue profile。实测清单：boot 无 pending、工具呈现（generic fallback 够不够、presentCall 投影 TUI 可否消费）、审批/问卷正常、卸载干净。**这是 frontend-runtime 第一性目的（dsh 多端第三方插件最小代价迁入）的实证点。**
2. **marketplace 收录策略扩展**：现门槛"只用四能力+包名含 blue/frontend/adapter"把纯 harness 域插件排除在外——而它们恰恰是 Blue 的供给池。建议开 **blue-compatible 认证类**（实测兼容即可收录，不要求改包名/四能力）。
3. **记忆类适配示范**：@dsh-blue/mnemon-blue 式 dock 呈现层（或官方文档指南），验证"Web 生态插件+薄 TUI adapter"模式。
4. **会话迁移**（dsh-chat-import 13 Agent 无损导入）：社区域，文档承接即可。

## 五、维持不做（既有定性/裁决）

- genui/Mermaid 内联、任务看板、Git 图谱、桌宠、多会话并排——Web 固有优势，正面承认（tui-pain-points 已定性）。
- inline 模式（A15）、注入上下文显隐开关（A10）、/rename 手动标题（A16）——既有产品裁决维持，动前需推翻。
- /vim /hooks /memory 等 dsh-TUI 占位命令——对端自己声明无对应能力，不是真缺口。

## 六、待核实后立项

- **Windows 启动/渲染矩阵**：dsh-TUI 有 ConPTY 强制覆盖验证 + dsh-tui.cmd 启动器；Blue R4 装机验证只在 Linux（S39 剪贴板三平台有了，但整体启动/渲染无等价验证记录）。
- **macOS ⌘ 修饰键**：pi-tui Kitty 协议解码能否拿到 ⌘（dsh-TUI 有 ⌘V/⌘O/⌘Enter 映射）。
- **ANSI-16 色降级档**：四调色板无 16 色回退，待核实 pi-tui 低色终端表现。

## 七、依赖上游（先开缝再立项）

- **Provider OAuth/订阅复用**（dsh-plugin-subscriptions、dsh-codex-auth 双插件 + tui-pain-points Roadmap Top3 #2 交叉印证，缺口强度升级）：credentials seam + openUrl；凭证敏感不适合第三方。
- **live 工具输出流**：上游无 streaming tool output 事件面（已记挂起）。

## 八、建议执行顺序

1. **第一梯队（S 级收割）**：遥测行 + 低垂果实批（Ctrl+R/Esc-Esc/goal/OSC8）→ /doctor → 随包技能（裁决后）→ 剪贴板补齐
2. **第二梯队（生态飞轮）**：blue-plugin-market → host 侧插件兼容验证 + marketplace 收录策略 → blue-context-inspector + blue-cost-meter
3. **第三梯队（L 级战略）**：远程接入用户面（可再拆 live 先行/daemon 后续）→ i18n 分阶段 → 通知体系
4. 待核实/上游依赖项并行推进核实，不占主线。

## 九、低垂高感插件目录（2026-08-28 补充）

> 筛选标准：插件形态（四能力或 harness 缝注入）、低工作量（数据源/上屏面现成）、高感知价值（用户天天看见）。机制断言已对源码核实：/permission 面板动态枚举 `presets.names`（permission-panel.ts:86）；status 注册表收 `StatusModel`（status-model.ts:60 register）；/theme 列表为静态 KNOWN_KEYS（theme-switch.ts:52）——主题包需先开缝。

### 甲、零 UI 型（注册即上屏，当天级工作量）

| 插件 | 做什么 | 为什么低垂 | 对标 |
|---|---|---|---|
| **blue-permission-packs** | 权限预设内容包（frontend-dev / read-only-audit / data-work / ci-runner…策划包） | `ctx.permissionPresets` 动态枚举已核实——注册即出现在 /permission 面板，danger gate 语义自动继承；纯内容工作 | dsh-permission-rules |
| **blue-statusline** | CC statusLine JSON 契约的自定义脚本宿主（用户脚本产 footer 行） | status 能力纯四能力实现（StatusModel 可闭包注入数据）；**直接解除挂起区"statusline 自定义脚本"**（缝已备缺宿主，官方插件=首个真实消费者）；待核对：status 渲染上下文喂给脚本的数据面 | CC statusLine 生态 |

### 乙、先开一小缝再零 UI 型

| 插件 | 做什么 | 缝 | 对标 |
|---|---|---|---|
| **blue-theme-packs** | 主题包族（nord/gruvbox/solarized/高对比/色盲友好…） | provider 替换在组合层已可用（D54 四调色板=四行），但 /theme 列表静态——先把列表改注册表枚举（S 级 core 缝），之后每包零 UI；/theme 实时预览面板刚落地正好接住 | Web 生态 Themes 93 条=第一大类 |

### 丙、dock 面板型（数据源现成）

| 插件 | 做什么 | 数据源 | 附带 |
|---|---|---|---|
| **blue-jobs** | 后台任务查看器（running/queued/done + 完成通知） | harness jobs/jobs-local/tool-jobs 缝现成 | **解除 S28 顺延的 /tasks** |
| **blue-context-inspector** | 上下文透视（组成占比/趋势/压缩事件） | session-projection/token-meter | 驱动 phase 2 开 session.read（前报告已定） |
| **blue-cost-meter** | 费用/预算/token 热力图 | token-meter × models.dev | 对标 dsh-cost-meter |
| **blue-agents-history** | 子 agent 历史查看器（model/tokens/toolCount/时长） | S33 A+ fold 基线现成 | **解除"活动查看器维持发版后"挂起** |
| **blue-cron** | 定时任务（/cron 命令 + next-run 行 + 完成通知） | harness schedule 包现成 | 对标 dsh-automation |
| **blue-workflow-runs** | workflow 运行查看器 | tool-workflow 在 base、Web 有 ui-workflow-run 槽而 TUI 零呈现 | 待核对 workflow 事件面形状 |

### 丁、命令+检索型

| 插件 | 做什么 | 数据源 | 附带 |
|---|---|---|---|
| **blue-session-search** | 跨会话内容搜索（命令→dock 结果列表 id+标题+摘要+`/resume <id>` 提示） | ctx.sessionQuery（SQLite FTS5）上游现成 | **解除"/sessions 跨页搜索"挂起**（roadmap 自记纯工作量项） |
| **blue-notifier** | turn 完成 IM 推送（飞书/TG/邮件） | packages/lark 骨架已在（validation-only）；notifications+status 双能力 | 对标 dsh-notifier/dsh-feishu-bot/dsh-im-hub；OSC 9 桌面通知归本体，此包管 IM 侧 |
| **blue-plugin-market** | /plugins 浏览/搜索/一键装卸 | marketplace registry.json（网站同源） | 前报告已定 |

### 戊、host 侧安全包（typed events 全套可订阅，blue profile 直接受益）

| 插件 | 做什么 | 机制 |
|---|---|---|
| **blue-guard**（可拆包） | secret-redactor（tools/result 改写脱敏）+ poison-guard（pre-step 注入启发式拦截）+ fail-closed auto-mode | typed events 订阅 + status 徽标 + 拦截通知呈现；对标 Web 生态安全族 |

留给社区：整活 dock（blue-doudizhu 已示范）、chat-import 适配、mnemon 薄 adapter、stock-watch 式玩具。

### 三个机制洞见

1. **上屏面已存在的就低垂**：五个上屏面（/permission 动态枚举、/help 命令自动列、footer status 注册表、dock lane、notices）插件注册即达用户，零 UI 投资。
2. **官方插件=挂起区解除器**：本目录直接解除 roadmap 挂起区/S28 顺延共 4 条（statusline、/tasks、跨页搜索、agents 查看器）——全是"纯工作量、无产品争议"条目，插件形态做掉还顺便喂 marketplace。
3. **缝毕业飞轮**：需要超出四能力数据的官方插件（context-inspector/jobs/session-search/agents-history 都要会话或投影数据）就是 session.read/sessionQuery 类能力从 DENIED 转开放的第一个真实消费者——符合"首个真实消费者驱动"纪律，毕业一个解锁一片第三方同类。

### 建议顺序

① permission-packs + statusline（零 UI）→ ② jobs + session-search + agents-history（解除三挂起）→ ③ /theme 注册表缝 + theme-packs → ④ context-inspector + cost-meter → ⑤ notifier + cron + guard → ⑥ workflow-runs（先核对事件面）。

## 十、dsh host 自有能力 vs Blue 集成面 diff（2026-08-28 补充）

> 口径：blue profile = dsh-base 80 行 + blue bundle patch。三层区分——①23 行 agent 面 disable 是 D37 薄宿主 preset 路由（presets/standard/agent.cordis.yml 已核实全量供给，非缺失）；②base 在跑但 Blue **零用户面** = 真未集成；③web-app 专属 host 行 = 形态差异桶。已核实：spill = 超长工具输出落盘+内联预览+取回定位器（packages/spill/README.md）。

### 真未集成清单（base 服务在跑、用户看不见）

| # | host 能力 | 是什么 | Blue 现状 | 承接位 |
|---|---|---|---|---|
| 1 | jobs-local + tool-jobs | 后台任务注册表与工具 | 零面（/tasks 顺延） | blue-jobs 插件（§九丙） |
| 2 | workflow-worker-thread + tool-workflow | 工作流执行 | 零面（standard preset 含"工作流"） | blue-workflow-runs（§九丙，先核对事件面） |
| 3 | goal + goal-round-driver | 目标引擎阶段推进 | bare /goal、todo pane 无阶段徽标 | goal 面板（本体，§二 A11） |
| 4 | compaction 事件 + spill-local/policy | 压缩事件可视化；超长工具输出落盘（内联预览+取回定位器） | /compact 命令在；压缩事件零呈现；**spill 取回入口零**（工具卡 3/10 行预览是 Blue 自己的折叠，spill 文件的完整输出无打开路径） | context-inspector（事件）+ spill 取回小项（新浮出） |
| 5 | session-query-sqlite（FTS5） | 跨会话内容全文索引 | 只用于 /sessions 列表过滤 | blue-session-search（§九丁） |
| 6 | token-meter | 计量 | footer % + /status /context 浅消费 | cost-meter + context-inspector |
| 7 | session-checkpoint-policy | 会话检查点 | 用户完全不可见 | 与 /rewind 深化合并评估（新浮出） |
| 8 | session-telemetry-otel | OTel 遥测导出 | 纯 config 零面 | ops 向，低优先（新浮出） |
| 9 | message-feedback（web-app 行） | 消息级 👍👎 反馈 | Web 有 UI、TUI 零 | 小型集成候选：assistant 消息上键位（新浮出） |
| 10 | web/web-search-deepseek/tool-web | 联网与搜索 | 工具卡 generic 呈现 | 基本够用；intent 增强可选 |

### web-app 专属行（无 TUI 对应、也无必要）

webserver/apiproxy/client-*（浏览器半）、storage+json/domain（infra）、code-runtime-worker-thread（Web genui 侧）、directory-picker（Blue `@` mention 补全已覆盖）、plugin-inventory（→ blue-plugin-market 已列）、session-log-export（Blue 自有 /export ✓）、cordis-host-runner（blue-creative-host 包裹版 ✓）。

### 结论

真未集成收敛为 10 项，其中 6 项已有承接位（上表右列）；本节**新浮出 4 个小项**：spill 取回入口、checkpoint 可视化、message-feedback 键位、otel 开关。另注意 bundle 注释的维护纪律：base 长出新 agent 面行时 blue 与 web-app 两边都要裁定（bundle/blue/cordis.patch.yml:39-40）——harness drift 监控目前只盯版本，**base 行增减也应进 drift 检查项**（防"新能力悄悄无人集成"）。

## 十一、TUI 竞品功能对照矩阵（2026-08-28，源码级核实）

> 五竞品：**dsh-TUI**（ccch1mneyyy，★2.4k，Ink/React，本地源码）、**tianshu**（huiliyi37/dsh-tianshu-tui，★243，自研 ANSI 引擎，当天仍在发版）、**Martty**（openma-ai/Martty，★64，Rust ratatui+Node Cordis 双进程 ACP client）、**oh-my-dsh**（agi-fans/oh-my-dsh，★26，"不造第二套 Agent Core"哲学；同名仓 20+ 勿混淆）、**dsh-tui-pro**（lk251066/dsh-tui-pro，★3，多会话工作台定位）。图例：✅ 完整 / ⚠️ 部分 / ❌ 无；Blue 列含承接位。

### A. host 能力域

> "host 提供"列 = dsh-base（rc.2 线）宿主侧已具备的服务与原语——竞品在同一宿主上要么消费它、要么绕开自建；Blue 的承接位也以此为界。

| # | 功能 | host 提供 | Blue | dsh-TUI | tianshu | Martty | oh-my-dsh | dsh-tui-pro |
|---|---|---|---|---|---|---|---|---|
| 1 | jobs 后台任务 | `jobs-local` 注册表 + `tool-jobs` 工具；wire 定义了 `session/jobs` 帧 | ❌→blue-jobs | ❌（wire 帧定义了"v1 never reads"） | ✅ /tasks 面板 | ❌ | ❌ | ✅ /jobs |
| 2 | workflow 查看 | `workflow-worker-thread` 引擎 + `tool-workflow` 工具 + 运行事件（Web 侧另有 ui-workflow-run 槽） | ❌→blue-workflow-runs | ❌ generic 卡 | ✅ /workflow+终态缓存 | ❌（plan/todo 视图替代） | ⚠️ 仅 Default/Plan 切换 | ❌ |
| 3 | goal 可视化 | `goal`/`goal-round-driver`/`tool-goal` + `goal/change` 事件 + ctx.goals | ⚠️→本体 A11 | ✅ 四态徽标+轮次+todo 树（事件驱动） | ✅ /goal 创建/暂停/阻塞/完成全管理 | ❌ | ⚠️ /todo | ✅ goal-bar 单行常驻 |
| 4 | compaction 呈现 | `compaction-basic`（compactNow 服务）+ `command-compact` + `tool-result-pruner` + checkpoint 事件（`source.plugin='compact'`） | ⚠️ 仅 /compact 命令 | ✅ checkpoint 折叠摘要+20k 一次性警告 | ✅ /compact+glance 占用条 | ⚠️ 仅 context% | ✅ /compact+/context 构成明细 | ✅ 实时"compacting…"状态行+critical 提示 |
| 5 | 长输出取回 | `spill-local`/`spill-policy`（落盘+有界预览+取回定位器）+ `tool-result-pruner` 裁剪 | ⚠️ ctrl+o、spill 文件无入口 | ⚠️ 内存展开、无 spill | ✅ 折叠计数+Ctrl+O+/scroll 分页搜索 | ⚠️ Ctrl+O 全展开 | ✅ Agent Hub+/trajectory 全文账本 | ✅ Ctrl+O 全文 |
| 6 | 跨会话内容搜索 | `session-query-sqlite`（SQLite FTS5 全文索引，ctx.sessionQuery） | ❌→blue-session-search | ❌ | ❌ | ❌ | ⚠️ picker 五字段过滤 | ⚠️ picker 可搜 |
| 7 | 成本统计 | `token-meter` 计量投影；**无金额换算**（价目表须消费侧自建） | ❌→blue-cost-meter | ⚠️ 仅 token（明言 harness 无费用计量） | ✅✅ /cost+内置 $/MTok 价目表+未知模型诚实降级 | ❌ | ❌ | ❌ |
| 8 | TPS 遥测 | session-stats 投影（llmMs/decode 计数/cacheRead）——原始计时在，速率由前端推导，无现成 TPS 字段 | ❌→本体遥测行 | ✅ gauge+sparkline+语义色 | ❌ | ✅ tok/s | ✅ TTFT+tok/s+Cache%（可逐项显隐重排） | ✅ tok/s 常驻 |
| 9 | checkpoint 可视化 | `session-checkpoint-policy` + jsonl 持久化；**无文件快照原语**（rc.2 核实零命中） | ⚠️ /rewind 安全分支 | ⚠️ /trace 时间线 | ✅ 两阶段回滚+**文件回退**（自建快照层） | ❌ | ❌ | ✅ 双击 Esc checkpoint 选择器 |
| 10 | 消息反馈 👍👎 | `message-feedback` 行为 **web-app bundle 专属**，base/TUI profile 默认不挂 | ❌ | ❌（注册表 /feedback 文本） | ❌ | ❌ | ❌ | ❌ |
| 11 | web 搜索呈现 | `web` + `web-search-deepseek`（provider）+ `tool-web`（模型面工具，结构化结果进工具输出） | ⚠️ generic 卡 | ❌ generic | ❌ | ❌ | ❌ | ❌ |

### B. 交互/运维域

| # | 功能 | Blue | dsh-TUI | tianshu | Martty | oh-my-dsh | dsh-tui-pro |
|---|---|---|---|---|---|---|---|
| 12 | /doctor | ❌→本体 | ✅ | ✅ 终端诊断+修复指引 | ❌ | ❌ | ❌（/status 是会话诊断） |
| 13 | 界面 i18n | ❌→本体 L | ✅ 469 条+/lang 热切换 | ❌（UI 中文硬编码） | ✅ en/zh | ❌ | ❌ |
| 14 | 剪贴板 | ⚠️ 图片强；文本/文件路径缺 | ✅ 三合一 | ✅ 图+OSC52 复制 | ✅✅ 原生+OSC52 兜底+拖选 | ✅ /copy 三目标+图 | ⚠️ 拖选+OSC52+图 |
| 15 | 输入历史搜索 | ❌（仅 ↑↓） | ✅ Ctrl+R 对话框 | ✅ Ctrl+F/R+fish 式 ghost 建议 | ⚠️ 仅↑↓ | ⚠️ 仅↑↓ | ⚠️ 仅 Up |
| 16 | Esc-Esc rewind | ⚠️ 命令有手势无 | ✅ RewindPicker | ✅+grace 守卫 | ❌ | ✅ 分支式 | ✅ 分支式 |
| 17 | OSC 8 链接 | ❌（挂起） | ✅ Ink 渲染器 | ✅ 引擎原生+截断补闭合 | ❌（链接渲染纯文本） | ✅ 带 spec 测试 | ❌ |
| 18 | 通知 | ❌（挂起） | ⚠️ 基建齐**零接线**（BEL/OSC9/kitty hook 全无消费者） | ✅ 桌面三平台+BEL（osascript/notify-send/PowerShell） | ❌ | ✅ OSC9+策略（off/long-running/always+阈值） | ⚠️ 标题动画+任务栏进度（setProgress） |
| 19 | 远程接入 | ⚠️ wire 库在、用户面无 | ✅✅ daemon/live+bootstrap | ❌ | ❌ | ❌ | ❌ |
| 20 | @ 内容附加 | ⚠️ D31 零解析（待裁决） | ✅ fs 服务展开+50k/200k 限额+attached-file 块 | ✅ 补全+展开 | ❌（#62 open 诉求） | ✅ 文件+**会话**提及 | ⚠️ 刻意只补路径（注释与 D31 同构） |
| 21 | 随包技能 | ❌ 目录空（待裁决） | ✅ 7 个 | ❌（伴生插件 lsp/vision-ask 代替） | ✅ 1 个+evals（教 agent 写 TUI 插件） | ❌ | ❌ |

### C. 生态/插件域

| # | 功能 | Blue | dsh-TUI | tianshu | Martty | oh-my-dsh | dsh-tui-pro |
|---|---|---|---|---|---|---|---|
| 22 | 应用内插件市场 | ⚠️ 网站 marketplace+CLI（→blue-plugin-market） | ❌ | ❌（仅 /update 自更新） | ⚠️ 无市场但**插件体系最强**（tuiTheme.register/Slot/Overlay 全插件化+/liang 运行时生成插件闭环） | ⚠️ CLI 安装器（omdsh plugin add） | ❌ |
| 23 | 第三方主题 | ⚠️ 4+custom+/theme 预览；列表静态（→缝+theme-packs） | ✅ 用户 JSON（base 继承+坏文件跳过+防逃逸） | ✅ 16 内置+custom+WCAG 对比度警告 | ✅✅ Theme Plugin register API+6 配色包 | ⚠️ 10 内置锁死（等"第二个贡献者"） | ⚠️ 4 内置 |
| 24 | statusline 脚本 | ❌（缝已备→blue-statusline） | ❌ 固定状态栏 | ✅✅ CC 协议子集（JSON payload 含 cost；节流 3s+单飞+超时 kill+300 字符截断） | ❌（Slot 体系替代） | ⚠️ /settings 逐项显隐/重排/着色 | ❌ |
| 25 | 权限预设 | ✅ /permission 面板+审批四选项（并列最强） | ⚠️ 文本往返+会话模式循环 | ✅ 三态+六档审批梯度 | ✅ /permission+shift+tab | ✅ Access 三档 | ✅ 常驻底部选择器 |
| 26 | 安全增强 | ❌→blue-guard | ⚠️ 分散 fail-closed+问卷 redact+key 掩码 | ⚠️ secrets 脱敏+通知 sanitize | ❌ | ❌（仅 ${ENV} 展开） | ⚠️ 粘贴净化+secrets 脱敏 |

### 读表结论

1. **全生态空白仅 2 项**：消息反馈（5/5 全无）、web 搜索专门呈现（5/5 全无）。远程接入是"独家俱乐部"——仅 dsh-TUI 一家，其余四家全空：Blue 补它=对四家差异化、对一家平起。
2. **Blue 落后于生态共识的**：TPS 遥测（4/5 有，Blue 零）、compaction 呈现（4/5 有，Blue 只剩命令）、Esc-Esc（3/5）、OSC 8（2/5）、/doctor 与成本（各 1 家但做满的都很扎实）。**compaction 从"归 context-inspector"提级为本体小额**（竞品形态=常驻状态行"compacting…"+低上下文警告，S 级）。
3. **Blue 领先/独有**：插件市场+四能力生态（Martty 的 register API+/liang 生成式闭环是最紧的生态位对手，须盯）、图片体验、审批四选项+会话级继承、/provider 全生命周期向导、/update 安全更新、fork/谱系树、壳包、btw 侧问、外部编辑器。
4. **tianshu=功能密度之王**（✅ 数最多），并贡献两份可直接抄的规格：**statusline CC 协议实现**（节流 3s/单飞/超时 kill/300 字符截断/JSON payload 含 cost.total_yuan）与**内置价目表+未知模型诚实降级**（blue-cost-meter/blue-statusline 的实现蓝本）。
5. **checkpoint 核实结果**（本轮实测）：上游 rc.2 线**无** fs-snapshot 原语（本地全仓 `rewindToBoundary` 零命中+npm 无 `@deepseek/ai/dsh-fs-snapshot` 包）——tianshu 的文件回退 rewind 是**自建快照层**。含义：文件级 rewind 不必等上游，Blue 可自建（trackEdit 打点+boundary 回退）；roadmap"原地 truncate 无上游原语"记档维持，但" rewind 深化"多了一条不依赖上游的路。
6. **@ 内容附加的生态佐证**：2 家附内容（dsh-TUI fs 展开+限额 / tianshu 补全+展开）、1 家刻意只补路径（dsh-tui-pro 文件头注释与 D31 论证同构：内容留给模型 read）、1 家扩展到会话提及（omdsh）。两个立场都有竞品背书——裁决是产品取向，不是技术对错。
7. **通知三味皆廉**：桌面+BEL（tianshu 三平台实现）/ OSC9+策略（omdsh off/long-running/always+阈值）/ 任务栏进度 setProgress（dsh-tui-pro，即 OSC 9;4——dsh-TUI 未接线的 hook 里也有）。挂起解除时建议：OSC9+策略为主+BEL，9;4 进度可选。
8. **纪律共鸣**：oh-my-dsh 的 TUI 贡献层显式"等第一个真实 bundle"才开放——与 Blue"首个真实消费者驱动"同款；生态位竞争在"谁先养出第一个第三方"。

### 对排期的三个即时修订（并入 §八执行顺序）

- **compaction 常驻状态行提级进本体第一梯队**（竞品 4/5 佐证、S 级成本：压缩状态行+低上下文一次性警告），深度可视化仍归 context-inspector。
- **checkpoint/rewind 深化**：从"与 /rewind 合并评估"升级为"评估自建快照层"（tianshu 证明不依赖上游可行）。
- **blue-statusline/blue-cost-meter 的实现规格直接采 tianshu 蓝本**（statusline 协议细节+价目表降级策略），省一轮设计。

## 附：信源与方法

- 三路调研原始报告（2026-08-28 会话）：Web 生态（dsh.so/dshdocs/awesome-dsh-plugin.com/五篇英文测评/鱼皮实测/linux.do 摘要级）；dsh-TUI 源码逐文件（src/commands.ts、src/remote/*、docs/*）；harness 机制（capability-seams.md 总表、client-modules/ui-slots/api-remotes、Blue api/host.ts）。
- 信源质量分级与反爬未读声明见 Web 生态路报告（linux.do 正文未读，仅搜索摘要级证据；知乎两篇正文超时）。
