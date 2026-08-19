# Blue 决策记录（ADR）

> 每条记录：背景 → 决策 → 理由 → 后果。按主题分组，编号稳定不回收。
> 架构总览见 [blue-architecture.md](./blue-architecture.md)；阶段规划见 [blue-roadmap.md](./blue-roadmap.md)。

## 路线决策

### D1. 同进程 Cordis 插件，而非出进程 SDK

- **背景**：给 harness 加 UI 有三条事实存在的路线：(a) 同进程 bundle + app 插件；(b) stdio JSON-RPC SDK 驱动子进程；(c) ACP 自动化服务器。
- **决策**：(a)。
- **理由**：SDK 协议明确缺 mid-turn cancel 和审批回传（server→client requests 是死能力），交互式 TUI 会被提问/审批卡死；ACP 定位 automation-only。架构文档把 "Add UI" 原生定义为 "drive `ctx.agents` and render from `session/event`"——同进程插件是一等公民。
- **后果**：Blue 与 harness 同进程同版本，pre-release API 破坏需钉版跟随（见 D9）。

### D2. Cordis 插件树，而非单体上帝类

- **背景**：pi 自己的 coding-agent 把全部 UI 收进一个 6.5k 行的 `InteractiveMode` 类。
- **决策**：TUI 是一棵 Cordis 插件树——渲染组件、交互 provider、命令、状态栏都是独立插件。
- **理由**：注册即 effect（卸载自动回滚）、依赖推导加载、provider 热替换、HMR 热重载单个功能、坏插件 FAILED 不拖垮整树。Claude Code 量级的功能增长变成"插件数量问题"而非"核心腐化问题"。
- **后果**：需要跨插件契约（`blueSession` / 事件）和三条纪律（焦点/键位/弹窗）来替代单体内的直接调用。

### D3. 核心 = 最小稳定根；缝后置

- **背景**：核心要"足够后续开缝"，但缝的清单无法预先设计全。
- **决策**：MVP 只定稿 L1 三服务签名 + 三条纪律 + "凡表面皆插件"结构；具体缝由首个真实消费者驱动，P3 冻结。
- **理由**：Cordis 服务空间开放——开新缝是加新服务，不需要改 L1。为假想需求开缝会变成文档化维护承诺，与 harness "无真实消费者不保留产品表面"哲学一致。
- **后果**：真正要防的不是"缝开晚了"而是"本该是缝的东西烤进核心"；签名被迫改只有三种原因——抽象错、归属错、粒度错（守门清单针对此）。

## L1 签名定稿决策（S2 实现期，相对计划草案的偏离）

### D4. 不透传 pi-tui 类型

- **决策**：L1 暴露自有最窄接口 `BlueComponent`（render/handleInput/invalidate），与 pi-tui `Component` 结构兼容但类型独立，内部委托。
- **理由**：若 `addChild` 参数直接是 pi-tui 类型，pi-tui 上游破坏会穿过 L0 传导到所有插件，适配层白做。
- **后果**：pi-tui 真破时只有 L0 委托代码要动。

### D5. BlueKeymap 不包装 pi-tui KeybindingsManager

- **决策**：自有 Map 实现 + pi-tui 的 `matchesKey` 判定。
- **理由**：pi-tui 的 KeybindingsManager 定义在构造时冻结、冲突检测只覆盖 userBindings——包装无收益。
- **后果**：Blue 自己的注册表支持整批校验 + 运行期 register/disposer + 冲突即抛（`BlueKeymapError`）。

### D6. 新增 `BlueKeymap.getKeys`

- **理由**：overlay 提示文本（"press ctrl+c to …"）的真实消费者（interaction 包 footer）。

### D7. overlay options 裁剪

- **决策**：裁掉 pi-tui 的 `row`/`col`/`margin`，保留 anchor + offset。
- **理由**：anchor+offset 已覆盖 MVP 定位需求；可选字段日后可增量加回不破坏签名。

### D8. 新增 `BlueFocusable`

- **理由**：Editor 适配需要 `focused` 标记做光标定位/IME 候选窗定位。

### D9. 服务方法 JSDoc 同时写在类和接口上

- **理由**：harness 的 cordis-catalog 生成器不做接口继承查找，而 verify-export-jsdoc 认继承——重复是同时过两个门禁的唯一方式。（独立仓库后此约束已不适用，但代码形态保留。）

## 工程形态决策

### D10. 独立仓库，非 harness in-tree 包

- **背景**：MVP 最初实现在 deepseek-harness monorepo 内（packages/blue/*）；用户决定 Blue 应为独立仓库。
- **决策**：独立 pnpm workspace，依赖从 npm registry 解析（`@deepseek-ai/*@0.1.0-rc.7` 钉版，next dist-tag），blue 五包间用 `workspace:^`；harness 仓库改动全部回退。
- **后果**：使用路径从 `PROFILE_TEMPLATES` 内置变为 out-of-tree `dsh plugin --profile blue add`；不再背 harness 的文档门禁（i18n 三件套、cordis-catalog 等），但保留 src 100% 覆盖标准；升级 harness 版本时全量测试套件即兼容性验收。

### D11. 本地开发安装：五包全部 link:

- **背景**：开发阶段不发 npm 包。
- **决策**：`dsh plugin --profile blue add link:<...>` 五条全部 link（`script/install-dev.sh` 封装）。
- **理由**：bundle 对四个兄弟包是 `workspace:^`，脱离 workspace 不可解析；`link:` 只做符号链接、pnpm 不解析被链接包的依赖，所以单独 link bundle 会缺兄弟包；全部 link 后各包经 blue 仓库自己的 node_modules 解析 harness peer。改代码 → `pnpm run build` → 重跑 dsh 即生效。
- **后果**：依赖图变化才需重装。

### D12. cordis 双拷贝共存是安全的

- **背景**：link 模式下 blue 用仓库内 cordis 4.0.1，dsh 安装内有另一份。
- **决策**：接受双拷贝，不作为问题处理。
- **理由**：vendored cordis 全部内部符号是 `Symbol.for('cordis.*')`，插件识别是鸭子类型，service 以字符串名注册；blue 对 dsh 包的运行时 import 只构造不 instanceof。三个真实冒烟验证无冲突。
- **后果**：若未来出现诡异的类型识别问题，这是第一个嫌疑点。

### D13. VirtualTerminal 不可用 → 手写 FakeTerminal

- **背景**：pi-tui npm dist 不导出 VirtualTerminal（只存在于 pi 源码 test/）。
- **决策**：core 测试用手写录制型 FakeTerminal；不引入 @xterm/headless。
- **理由**：core 测的是委托/生命周期/焦点语义，FakeTerminal 充分；视口快照测试是 transcript 的需求，届时再评估。

### D14. transcript 自实现宽度/Markdown 工具（临时）

- **背景**：pi-tui 禁用（全树只有 core 可 import），transcript 需要 visibleWidth/wrap/Markdown。
- **决策**：transcript 包内自实现 `width.ts`（ASCII/CJK 精确，emoji 簇近似）和 `markdown.ts`（子集）。
- **后果**：已知限制；P2 评估下沉 core（由 core 导出 pi-tui 级精度的工具）。

### D15. 会话生命周期：commit point 发布 + 串行 resume 队列

- **决策**：app 先 `blueSession.current = agent` 再 emit `'blue/session-changed'`；`'blue/request-resume'` 经串行队列执行，先 resume 成功再 dispose 旧 agent。
- **理由**：符合 harness "Publish state only at its commit point" 规则；resume 失败时旧 session 存活。
- **配套 invariant**：session-changed 触发时 blueSession.current 必须已指向被广播的 Agent。

### D16. resume 渲染：快照→订阅顺序

- **决策**：transcript 先读 `agent.session.events` 快照渲染历史，记录末尾 seq，再订阅 `session/event` 增量并丢弃 `seq ≤ 快照末尾` 的事件。
- **理由**：harness 的 seed 机制不重播 `session/event`（"were never published on the firehose"）。

## P1 设计决策（kimi-parity 设计期，2026-08-18）

详见 [blue-p1-design.md](./blue-p1-design.md)。以 kimi-code 为参照系（非视觉复刻目标），行使 roadmap 允许的一次性破坏性层职责重排。

### D17. 组件工厂缝：L0 包装 pi-tui 组件

- **背景**：pi-tui 禁令逼得 transcript 自写 `markdown.ts`/`width.ts`（D14）、interaction 自写单行 `BlueInput`；要复用 pi-tui 的 Editor/Markdown/SelectList 能力又不能放开禁令。kimi 的 `CustomEditor` 直接继承 pi-tui `Editor`，白捡多行/历史/kill-ring/paste-burst/Kitty 解码。
- **决策**：core 新增 `ctx.blueComponents` 能力缝——Blue 自有类型进、Blue 组件出。`BlueInput`、`markdown.ts`、`width.ts` 随之退役。
- **理由**：pi-tui 升级影响仍被 L0 吸收（D4 的延续）；同时修掉 `BlueInput.isPrintable` 拒绝 Kitty CSI-u 序列导致 VSCode 终端丢字符的现存缺陷。
- **后果**：L1 增加一个服务契约；自研组件存活范围收窄到 pi-tui 不提供的少数件（如 `BluePanel` 容器）。

### D18. 主题 = provider 替换，core 只持契约

- **背景**：kimi 用全局单例 `setPalette` + 渲染路径惰性取色实现主题切换。Blue 需要在 Cordis 哲学下选机制。
- **决策**：`blueTheme` 拆为契约（core）+ 独立 provider 插件（`blue-theme-dark` 为 plain 默认，另有 light/auto/custom）。运行时切换 = dispose 当前主题 fiber + `ctx.plugin(目标)`，inject 方自动 reload。不采用"可变 palette + 事件"方案。
- **理由**：provider 替换是 Cordis 原生语义，reload 路径免费且与 HMR 同构；transcript reload 走 D16 快照重放，行为正确。
- **后果**：transcript/interaction 在切换主题时重挂载；编辑器草稿用模块级 stash 补偿。`BlueSemanticColors` 借此次重排一次性全量化（26 token），此后只增不改。OSC 11 探测必须在 raw mode 前，归属 L0（kimi 硬经验）。
- **S0 验证（2026-08-18，cordis 4.0.1 源码 + 运行时探针双确认）**：dispose provider fiber 时 inject 方自动 `_unload()`（fiber 不销毁、回 PENDING），新 provider fiber 转 ACTIVE 经 `notify` 触发注入方 `_reload()`；`await` 旧 fiber 的 `dispose()` 时注入方已完全卸载，重载异步、`await` 新 fiber 即落地。另注意：cordis 无 optional inject——想软依赖主题的功能插件须走 `ctx.get('blueTheme')` + `'internal/service'` 事件，不能声明非必需 inject。
- **S4 落地（2026-08-18）**：换装实现为模块级当前模块引用 + `ctx.registry.delete(...)`（dispose 当前 provider 全部 fiber；registry 按回调身份键入，loader 加载的 patch 行与静态 import 共享模块实例）+ `await ctx.plugin(目标)`，挂载失败回退 dark；编辑器草稿经 interaction 的模块级 stash（`onChange` 镜像、submit/steer 清空、apply 时 `setText` 恢复）跨 reload 保留。

### D19. 弹窗纪律不变：overlay-only

- **背景**：kimi 的对话框主机制是 editor-replacement（替换输入区容器），另有 screen-takeover 全屏接管。
- **决策**：Blue 保持"弹窗只走 `showOverlay` 句柄"（架构 §5.2 三条纪律之一）；全屏对话框以 `width/maxHeight: 100%` overlay 近似 screen-takeover。不引入第二种弹窗范式。
- **理由**：纪律单一比视觉近似重要；overlay 句柄已含焦点恢复语义。

### D20. blueStatus 归属 transcript，不进 L1

- **决策**：状态栏条目注册表（`ctx.blueStatus`）由 transcript 包提供；两行 footer 壳是其容器组件；`model · status` 基本条目拆为独立贡献插件 `blue-status-basic`，降级为第一个注册者。MVP 的 `StatusBarComponent` 消灭。
- **理由**：状态栏是 L3 呈现表面，进 L1 违反"核心最小"（D3）；契约归渲染它的包，与 render intent 注册表同处理。
- **S5 落地（2026-08-18）**：registry 与两行 footer 壳按设计落地——壳经 `blueScreen.addBottomChild` 常驻钉底于输入编辑器上方，注册查重抛 `BlueStatusError`、返回幂等 disposer、priority 升序 + 注册序稳定排序；`StatusBarComponent` 消灭；basic（基线）/git/context（增强）三条目以子路径插件发布，patch 基线 7 行、增强 3 行。

### D21. plain-first：自家 UI 走自家缝

- **决策**：任何非平凡视觉/交互表面 = 缝 + plain 默认实现；Blue 自家增强（footer 条目、主题、intent、pane）全部经缝注册为插件，与下游同权。基线 patch 拔掉增强行后仍完整可用。
- **理由**：缝的质量由自家消费验证（dogfooding）；"表面皆插件"从结构口号变为可验收条款。
- **后果**：包数量不变，增强插件以子路径入口挂在 interaction/transcript 包上（`./pane-activity`、`./status-git`、`./editor-plus` 等）；bundle patch 分段注释。S6 落地校正（2026-08-19，详见 blue-p1-design §7）：pane-queue 挂 interaction（召回需编辑器 onKey 缝），`/btw` 由 pane-btw 自注册；patch 重排为基线/增强/装配三段 14 行，dock 钉序靠 inject 解析序而非行序。

### D22. welcome banner：静态启动快照 + 基线段行序钉位

- **背景**：banner 是 P1 §2.4 预留的最后一个子路径插件（kimi `tui/banner/` 对照）。要定的三件事：数据从哪来（模型/cwd/版本）、行放哪段、版本字符串怎么取。
- **决策**：① banner 是**静态启动快照**——模型行 inject `agentDefaultModel` 在 apply 时 `currentSelection()` 快照（`${model} · ${provider}`），cwd 取 `process.cwd()` + 本地 `shortenHome` 缩写；不读 `blueSession`、不订阅会话事件（实时模型由 footer 的 status-basic 呈现），也因此与 transcript 的历史挂载无排序耦合。② patch 行入**基线段且位于 `blue-transcript` 前**：滚动区次序 = `addChild` 挂载次序，二者同 blueComponents 激活轮按行序激活；`/theme` 换装 reload 时 transcript 经 D16 快照重放抢先重挂全部历史，banner 行序在前才能跨换装保持滚动区首子。banner 由此视作 plain 基线产品面（Claude Code 同款定位），行本身仍可单独拔除。③ 版本走 `banner-content.ts` 的 `BLUE_VERSION` 常量 + spec 读 package.json 断言相等的守卫——拒 JSON import（rootDir/emit 布局、无 resolveJsonModule）与 `createRequire(import.meta.url)`（bundler 对 import.meta.url 的改写风险、多余覆盖分支）。
- **理由**：渲染事实只在启动一刻有意义（Claude Code 语义同款）；行序钉位复用 S6 已验证的"同轮按行序激活"机制，不新开缝；常量 + 守卫是零构建风险的同步手段，漂移在 `pnpm run test` 即失败。
- **后果**：着色只用现有 26 token（框/城堡 `border`、Welcome `textStrong`、模型行 `accent`、右栏 `muted`/`text`），不扩契约；右栏 Tips/What's new 为占位内容，隔离在 `banner-content.ts`，真实文案落地不动布局（`banner.ts` 的 `composeBannerLines` 纯函数）；像素城堡网格离线生成嵌入 `banner-art.ts`（16 行位图 + 半块打包纯函数），黄金 spec 钉住输出。

### D23. dock 沉底：渲染器 render 包装缝，非组件层 Spacer

- **背景**：S8 banner 落地后暴露——pi-tui 根 children 自顶向下堆叠，`addBottomChild` 只是"排在数组尾部"，内容不足一屏（启动无会话、/new 清空）时 footer/editor 悬在内容正下方，`BlueScreen.addBottomChild` 契约宣称的 "pinned to the bottom" 并未成真。pi-tui 无视口感知的填充组件（`Spacer` 固定行数）。
- **决策**：在 `startBlueTerminal`（core，唯一 pi-tui 适配点）包一层渲染器实例的 `render`：总行数 < `terminal.rows` 且存在底钉组件时，重测底钉块行数，在滚动内容与底钉块之间插入空行补足整屏。整屏内容、空树（避免启动空白帧灌 24 行空行）、无底钉树原样返回。
- **理由**：这是 children → 扁平行数组唯一汇合点，能拿到总行数并按"尾部行数 = 底钉块"切分；二次渲染仅限底钉块（footer/editor/hint/panes 几行，纯 render），滚动区（贵）不双渲染。备选均劣：组件层 Spacer 的 `render(width)` 无高度语义无从计算填充量；requestRender 前全树预算 = 每帧双渲染全树。
- **后果**：底钉语义成真且对所有 bottom child（含下游 pane 插件）生效；overlay 合成发生在包装之后，短内容时居中/贴边 overlay 的定位反而更准（行数组本就覆盖整屏）；每帧行数恒 ≥ max(内容, rows)，与 pi-tui 的 clearOnShrink/差分路径兼容（e2e 全数通过）。

## P2 视觉设计决策（kimi-code 观感对齐设计期，2026-08-19）

详见 [blue-p2-visual-design.md](./blue-p2-visual-design.md)。以 kimi-code 为视觉/UX 参照（框架同源 pi-tui，全部效果为应用层实现，逐项可移植），按视觉影响排序分期（S10-S16）。

### D24. 主题契约 v2：+`primary`/`textMuted` 两 token，现有 `muted` 即 kimi 的 textDim 层

- **背景**：Blue 的"朴素感"一半来自色彩层级缺失——`accent` 一个青色既做选中又做强调、单层灰阶、`borderFocus`/`selectedBg` 定义后从未使用；而 kimi 的层级感建立在 primary（交互主色）/accent（次强调）/textDim/textMuted（双层灰）的分离上。
- **决策**：`BlueSemanticColors` 增 `primary`（dark #5f87ff——现 border 的品牌蓝转任交互主色）与 `textMuted`（dark #666666——最暗层），**不**新增 `textDim`：现有 `muted`（#808080）的用法（描述/引用/暗提示）就是 kimi 的 textDim 层，改名违反"只增不改"且全渲染器两次翻搅。同时重调一批现值（border→#4a5468 退后、warning/borderFocus→共琥珀 #de935f、roleUser→#f0c674、mdHeading→粗体承载层级等，全表见 p2-visual §4.2），启用闲置的 `borderFocus`（S12 审批）与 `selectedBg`（S12 多选）。
- **理由**：kimi 的四个层级（交互主色/次强调/次级灰/最暗灰）在 26→28 token 内即可完整表达；`theme-palette.ts` 类型自动派生、theme-custom 逐 token `Object.hasOwn` 校验（additive-safe，均已核实），改动面收敛在两 theme 文件 + 映射层。
- **后果**：全部下游主题插件编译期发现缺口；S10 一并落地消息流/markdown 重映射，后续各期消费。色值以 S10 实机目测微调为准，调值不构成契约变更。
- **S10 落地（2026-08-19）**：28 token 全量落地（types/theme-dark/theme-light/components 映射 + transcript 审计：`❯`→roleUser、`▌` 与 spinner 帧→primary、`⎿`/截断行/`… N more lines`→textMuted、运行 `○`→primary）。markdown v2：标题经粗体承载层级（0.84.2 单一 `heading` 函数，kimi 的 h1 下划线不可表达——adapt 判定的落地记录）、无序列表符改写为 `•`、代码围栏经 `highlightCode` 钩子接 **cli-highlight@2.1.11**（core 唯一新运行时依赖；`supportsLanguage` 门控 + `ignoreIllegals: true`，theme 把 cli-highlight 的红系 scope（`string`/`regexp`/`deletion`）与 `default` 一并重置到调色板 base（`mdCodeBlock`，随 `/theme` 换装重建），未知语言或 highlighter 异常回退纯文本 split，行数恒等）。`border` 初按设计稿值 `#4a5468` 落地，实机目测（同日）反馈整体灰暗无生机——根因是初版取值沿 Tomorrow-Night 低饱和系，而 kimi 的观感建立在高亮度中性色 + 高饱和状态色上。**目测定稿**：dark 全表向 kimi 校准——正文/标题/列表符 `#e0e0e0`、muted `#888888`/textMuted `#6b6b6b`、accent `#5bc0be`、primary `#4fa8ff`（品牌蓝仍任交互主色，取 kimi 天蓝亮度）、border `#5a5a5a`（kimi 中性灰）、borderFocus/warning `#e8a838`、roleUser `#ffcb6b`、shellMode `#bd93f9`、success/error `#4ec87e`/`#e85454`（diff 系共用）；light 维持 primer 系不动。token 契约与映射零改动，纯取值变更（全表见 p2-visual §4.2 定稿注）。第二轮目测补两处映射修正：banner frame/castle/欢迎行与编辑框边框由 `border` 改映 `primary`——kimi 欢迎框整个是 primary（仅信息标签灰），编辑框则是"交互锚回蓝"的过渡决策（kimi 灰默认边框靠圆角框结构与语境变色撑观感，S11 落地时复审默认边框值）；`border` token 维持中性灰供 mdHr 与后续 pane 边框。

### D25. chrome 辅助层：core 纯模块 + 子路径导出，不经 blueComponents 服务

- **背景**：圆角编辑框（`withSideBorders`）、边框内标题（`topRule`）、对话框框架（`framePanel`）、提示符/幽灵提示注入等全部是纯 `string[]` 绘制，kimi 侧为应用层函数（`custom-editor.ts` 等）；需要宽度函数但不需要 pi-tui 组件机制。
- **决策**：core 新增 `src/chrome.ts`，子路径导出 `@deepseek-ai/dsh-blue-core/chrome`，接收色函数参数的主题无关纯函数集；`EditorAdapter.render()`（components.ts）做编辑框后处理（kimi `CustomEditor.render` 的镜像位，无需子类化 pi-tui）；`BlueEditor` 契约增 `setPromptSymbol`/`setBorderLabel`/`setConnectedAbove`/`setGhostHint`。
- **理由**：走 blueComponents 服务会让绘制函数背上服务生命周期；放 interaction/transcript 会重复实现或走私 pi-tui 依赖（违反 D4/L0 唯一适配纪律）；子路径导出与主题插件族先例一致。明确拒绝移植 kimi 的 `GutterContainer`（pi-tui Container 子类，类型越界），以纯 `padColumns` 等价（S13 实测决定启用与否）。
- **后果**：S11 开出该缝（首个消费者），S12-S14 复用；跨包的面板拼接经新事件 `'blue/editor-connected-above'` 协调（pane-btw 发、input-plugin 听）。

## 已知遗留（MVP 有意为之）

- `/quit` 在 agent attach 前输入会显示 "no active session" 而不退出（input-plugin 在命令分发前检查 current agent）
- alt-screen、自定义键位属 P1/P2
