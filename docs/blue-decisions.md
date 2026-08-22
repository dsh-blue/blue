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

详见 [blue-p1-design.md](./history/blue-p1-design.md)。以 kimi-code 为参照系（非视觉复刻目标），行使 roadmap 允许的一次性破坏性层职责重排。

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

详见 [blue-p2-visual-design.md](./history/blue-p2-visual-design.md)。以 kimi-code 为视觉/UX 参照（框架同源 pi-tui，全部效果为应用层实现，逐项可移植），按视觉影响排序分期（S10-S21；S17-S21 为 2026-08-20 立项的会话流对齐期，参照基准 p2-visual §2.6）。

### D24. 主题契约 v2：+`primary`/`textMuted` 两 token，现有 `muted` 即 kimi 的 textDim 层

- **背景**：Blue 的"朴素感"一半来自色彩层级缺失——`accent` 一个青色既做选中又做强调、单层灰阶、`borderFocus`/`selectedBg` 定义后从未使用；而 kimi 的层级感建立在 primary（交互主色）/accent（次强调）/textDim/textMuted（双层灰）的分离上。
- **决策**：`BlueSemanticColors` 增 `primary`（dark #5f87ff——现 border 的品牌蓝转任交互主色）与 `textMuted`（dark #666666——最暗层），**不**新增 `textDim`：现有 `muted`（#808080）的用法（描述/引用/暗提示）就是 kimi 的 textDim 层，改名违反"只增不改"且全渲染器两次翻搅。同时重调一批现值（border→#4a5468 退后、warning/borderFocus→共琥珀 #de935f、roleUser→#f0c674、mdHeading→粗体承载层级等，全表见 p2-visual §4.2），启用闲置的 `borderFocus`（S12 审批）与 `selectedBg`（S12 多选）。
- **理由**：kimi 的四个层级（交互主色/次强调/次级灰/最暗灰）在 26→28 token 内即可完整表达；`theme-palette.ts` 类型自动派生、theme-custom 逐 token `Object.hasOwn` 校验（additive-safe，均已核实），改动面收敛在两 theme 文件 + 映射层。
- **后果**：全部下游主题插件编译期发现缺口；S10 一并落地消息流/markdown 重映射，后续各期消费。色值以 S10 实机目测微调为准，调值不构成契约变更。
- **S10 落地（2026-08-19）**：28 token 全量落地（types/theme-dark/theme-light/components 映射 + transcript 审计：`❯`→roleUser、`▌` 与 spinner 帧→primary、`⎿`/截断行/`… N more lines`→textMuted、运行 `○`→primary）。markdown v2：标题经粗体承载层级（0.84.2 单一 `heading` 函数，kimi 的 h1 下划线不可表达——adapt 判定的落地记录）、无序列表符改写为 `•`、代码围栏经 `highlightCode` 钩子接 **cli-highlight@2.1.11**（core 唯一新运行时依赖；`supportsLanguage` 门控 + `ignoreIllegals: true`，theme 把 cli-highlight 的红系 scope（`string`/`regexp`/`deletion`）与 `default` 一并重置到调色板 base（`mdCodeBlock`，随 `/theme` 换装重建），未知语言或 highlighter 异常回退纯文本 split，行数恒等）。`border` 初按设计稿值 `#4a5468` 落地，实机目测（同日）反馈整体灰暗无生机——根因是初版取值沿 Tomorrow-Night 低饱和系，而 kimi 的观感建立在高亮度中性色 + 高饱和状态色上。**目测定稿**：dark 全表向 kimi 校准——正文/标题/列表符 `#e0e0e0`、muted `#888888`/textMuted `#6b6b6b`、accent `#5bc0be`、primary `#4fa8ff`（品牌蓝仍任交互主色，取 kimi 天蓝亮度）、border `#5a5a5a`（kimi 中性灰）、borderFocus/warning `#e8a838`、roleUser `#ffcb6b`、shellMode `#bd93f9`、success/error `#4ec87e`/`#e85454`（diff 系共用）；light 维持 primer 系不动。token 契约与映射零改动，纯取值变更（全表见 p2-visual §4.2 定稿注）。第二轮目测补两处映射修正：banner frame/castle/欢迎行与编辑框边框由 `border` 改映 `primary`——kimi 欢迎框整个是 primary（仅信息标签灰），编辑框则是"交互锚回蓝"的过渡决策（kimi 灰默认边框靠圆角框结构与语境变色撑观感，S11 落地时复审默认边框值）；`border` token 维持中性灰供 mdHr 与后续 pane 边框。

### D25. chrome 辅助层：core 纯模块 + 子路径导出，不经 blueComponents 服务

- **背景**：圆角编辑框（`withSideBorders`）、边框内标题（`topRule`）、对话框框架（`framePanel`）、提示符/幽灵提示注入等全部是纯 `string[]` 绘制，kimi 侧为应用层函数（`custom-editor.ts` 等）；需要宽度函数但不需要 pi-tui 组件机制。
- **决策**：core 新增 `src/chrome.ts`，子路径导出 `@dsh-blue/blue-core/chrome`，接收色函数参数的主题无关纯函数集；`EditorAdapter.render()`（components.ts）做编辑框后处理（kimi `CustomEditor.render` 的镜像位，无需子类化 pi-tui）；`BlueEditor` 契约增 `setPromptSymbol`/`setBorderLabel`/`setConnectedAbove`/`setGhostHint`。
- **理由**：走 blueComponents 服务会让绘制函数背上服务生命周期；放 interaction/transcript 会重复实现或走私 pi-tui 依赖（违反 D4/L0 唯一适配纪律）；子路径导出与主题插件族先例一致。明确拒绝移植 kimi 的 `GutterContainer`（pi-tui Container 子类，类型越界），以纯 `padColumns` 等价（S13 实测决定启用与否）。
- **后果**：S11 开出该缝（首个消费者），S12-S14 复用；跨包的面板拼接经新事件 `'blue/editor-connected-above'` 协调（pane-btw 发、input-plugin 听）。
- **S11 落地（2026-08-19）**：`chrome.ts` 仅随首个消费者落 `withSideBorders`/`injectPromptSymbol`（其余函数各随 S12-S14 消费者落地，含契约里的 `setGhostHint`——S14）；`EditorAdapter.render` 后处理落地，角/条涂色经**活** `borderColor` 引用（宿主 `setBorderColor` 免重入适配器，kimi 同法）。同轮定稿两事：(1) **默认边框色回归中性灰**——S10 第二轮目测的"编辑框 border→primary"是裸双横线时代的过渡补偿，圆角框 + 语境变色（斜杠 primary / bash shellMode）落地后按预告复审退役；(2) **常驻按键提示的存在性门控**（§6）——`! bash`/`@ files` 片段按 editor-plus 在场（editor-instance 模块级标记）而非全量倾倒，`ctrl+v paste image` 按 keymap action 在场，键名一律 `getKeys` 白名单取值；bash 模式经 draft-stash 的 input-mode 暂存活过 `/theme` 换装（detach 只做视觉恢复不写暂存，重载后三件套连同草稿重建）。
- **S12 落地（2026-08-19）**：`framePanel(body, width, opts)` 与 `hintRow(parts, paint)` 随对话框统一开出（§5 草样签名的两处细化，step log 记录）：规则线宽显式传参（body 可能整体短于视口宽，宽度不能从 body 反推）而非隐含；title/titleHint/footer/footerPaint/rulePaint 均为可选，缺省 identity 保持主题无关。`framePanel` 输出**全宽平 `─` 规则**（圆角框专属于面板/编辑框，对话框是 kimi 的"上下全宽横线 + 左上标题"范式）。五个 overlay 表面统一走 framePanel（审批/问卷//help//sessions/BlueSelect），解剖一致：标题、框、按键行齐备。同轮收口 S10 预告的复审项：`settingsListTheme` 选中行 label/value accent → primary（选中行是交互目标，primary 是它的 token）。
- **S13 落地（2026-08-19）**：`topRule`/`padColumns` 随面板开出（§5 草样签名的细化：`─ ` joiner 仅 title+hint 同时在；复合串 ANSI-safe 截断——pi-tui 空省略号截断附加 `\x1b[0m` reset 是保护性行为，防开放 SGR 污染 fill）。`'blue/editor-connected-above'` 兑现为 pane-btw emit / input-plugin listen（input-plugin 镜像到 `setConnectedAbove` 并门控编辑器键链）；同批开出 `'blue/btw-command'`（编辑器链 → 面板路由）——**对 §7 规格措辞的裁定**：keymap 按 key 查重使"面板开时注册 Esc 全局动作"不可行（`escape`/`up`/`down` 已属列表表面），改走编辑器链路由（kimi 同构，详见 S13 step log）。`padColumns` 落地但**消费推迟**：kimi 的 1 列 gutter 是全局的，启用牵动 transcript/panes/editor，启用与否由后续实机重审并记录——**消费于 S17 dogfood 五轮裁定（2026-08-20）**：见 D29。

### D26. 对话框一律底部上拉面板，弃用居中弹窗（用户裁决定稿）

- **背景**：S12 首版把五个对话框做成居中式模态弹窗（60-80% 宽度、垂直居中）。用户实机对比后否决：「弹窗样式没有上拉框样式效果好」，要求 kimi 式的底部上拉全宽面板（面板从编辑器槽位升起、footer/statusline 保持在最底行可见）。
- **决策**：Blue 的对话框范式定为**底部上拉面板**——`showOverlay` 以 `width: '100%'` + `anchor: 'bottom-center'` + `offsetY: -2`（让出两行 footer 壳）锚定，面板盖住编辑器槽位；全宽平 `─` 规则 + 缩进标题 + 按键行（framePanel）。**除非后续明确说明，一律不使用居中式弹窗**。
- **理由**：上拉框与编辑器的空间关系连续（面板从用户注视的底部升起，操作路径更短），footer 状态保持可见；kimi 参照系同款；居中弹窗在宽终端上显得悬浮、割裂。
- **后果**：dock 顺序翻转为 kimi 同款（`addBottomChild` 增 `position: 'bottom'`，footer 壳钉在最底行）；五个 overlay 表面全部按上拉面板实现（S12 定妆提交）；后续新对话框表面沿用同一锚定约定，例外需显式说明。

### D27. Footer v2 视觉身份：kimi 三档灰阶 + 两空格 slot，弃 v1 平铺（用户裁决定稿）

- **背景**：S15 v1（分支 `p2/s15-footer-v2` 留档，未合并）结构缝正确（band/cluster、优先级让位），视觉被用户否决：单档 muted 平铺 + ` · ` 分隔符 + agent-status 噪声 + 裸分支名，整条 footer 灰成一片。用户裁决三事：(1) 研究 kimi-code 实现后重设计；(2) agent-status 条目移除，只留 model（运行态归 activity spinner）；(3) 开 worktree 从零重写，v1 只作参照不復用代码。
- **决策**：footer 视觉身份对齐 kimi——**两空格 slot 连接**（无 ` · ` 字形、无分隔色）；**三档灰阶**（model 与 context 百分比 = `text` #e0e0e0 最亮，cwd 与 git 徽章 = `muted` #888888，tips = `textMuted` #6b6b6b 最暗）；L1 左簇 model+cwd+git、右簇轮换 tips；L2 右簇 context 百分比。git 徽章取全量 `branch [+N -M ↑a↓b]`（diff 计数 + ahead/behind，不取 kimi 的 PR 徽章）；tips 走 nginx SWRR 加权轮换 + ` | ` 两两配对（solo 旗标与重复守卫），10s 显式 ticker 推进（Blue 渲染纯事件驱动，kimi 靠无关重绘刷帧的路径不成立）。
- **理由**：v1 的失败不是布局而是层级缺失——kimi 的可读性来自亮度差与空格节奏，不来自装饰字形；三档恰好复用 D24 已开的 `textMuted` token，零新色。
- **后果**：`BlueStatusEntry` 增可选 `row`/`align`（additive，谎言值钳位不崩）；footer 条目插件扩为五个（basic/cwd/git/tips/context，后两个新子路径导出）；git 探测 TTL 缓存（branch 5s / status 15s / numstat 仅脏树，惰性刷新于 render 内）；context 的窗口来源定为 adapter `resolveModel().context.contextWindow` 经 `'request/context'` 事件（v1 调研已证 `agentDefaultModel` 无元数据可取），模型切换撤回窗口即降级 `ctx N`。**Dogfood 追加（2026-08-20）**：S11 的编辑框常驻按键提示行（`! bash · / commands · ...`）随本决策退役——kimi 无此行，affordance 教学统一归 footer 轮换 tips（`hint-content.ts` 删除，HintLine 仅瞬态通知/斜杠发现）。

### D28. 注入上下文默认隐藏：合成来源 user 消息零呈现（用户裁决，S19 落地）

- **背景**：harness 把 AGENTS.md 等工作区指令以 `user/message` 事件注入会话，携带结构化 `source`（`agent-instructions`/`plugin` 及 ContextFormed 词汇——instructions/catalog/snapshot/notice/relay/recall；dsh-llm 的 MessageSourceMap 文档明确"颜色、图标、排序与折叠默认是消费者的事"）。Blue 的 fold 忽略 `source`，每条注入渲染成完整展开的 `❯` 用户气泡——会话流开场即被系统级内容淹没。kimi 对模型侧合成消息从不渲染（回放也只用零行 turn 边界占位）。
- **决策**（用户裁决 2026-08-20）：fold 层按消息来源分拣——`source === undefined`（人类输入）照常呈现；有 `source`（合成）**零呈现**（不产条目、不留占位行）。快照回放同规则（D16 一致性）。
- **理由**：对齐 kimi"模型侧内容模型侧消化"的哲学；裁决时明确排除灰色单行占位与"隐藏但可展开"两案（默认态必须干净）；harness 契约把呈现决策完全交给消费者，fold 是唯一正确分拣层。
- **后果**：S19 落地（p2-visual §7）；step-summary 与窗口计数不感知被隐藏消息（fold 层已消化）；与 S13 `todo_write` 抑制正交（一边按消息来源、一边按工具名）。若日后 dogfood 需要某类合成消息可见（如文件变更通知），按 `source.form` 单独加 dim 单行呈现，不回改默认隐藏。

### D29. 消费 1 列 chrome gutter：S13 推迟项定档 S21（✅ 已随 S17 dogfood 拉前落地）

- **背景**：kimi 全部 chrome（transcript/panels/statusline）左右各内收 1 列（`CHROME_GUTTER = 1`，`GutterContainer(1,1)` 包全部容器），与编辑框内列对齐，编辑框本身贴 0 列作为视觉锚。S13 落了纯函数等价 `padColumns` 但**消费显式推迟**——"kimi 的 gutter 是全局的，启用牵动 transcript/panes/editor 全部组件"。
- **决策**：消费该推迟项——transcript 条目、panes、footer 左右各内收 1 列（挂载层统一包装，组件无感知，宽度按 `width-2` 下发），编辑框贴 0 列不动，banner 同步内收；定档 **S21**（会话流组件 S17-S20 定稿后的一次性 reflow，把全量 e2e 锚点改写压缩为一轮）。
- **理由**：用户将"会话流左右边距"列为对齐缺口（2026-08-20 会话流调研，p2-visual §2.6 #7）；gutter 是 kimi 层级感的结构底座——chrome 与终端边缘脱开、左缘与编辑框内列成一条竖线；"先组件后 reflow"的顺序避免中途步骤锚点二次改写。
- **后果**：全量 e2e 布局锚 reflow，并移除 S13 推迟注记（p2-visual §7 S13 step log 与 D25 S13 落地注）及 AGENTS 对应句；后续新组件零成本继承 gutter（包装在挂载层，不在组件内）。
- **落地（2026-08-20，S17 dogfood 五轮裁定拉前——用户实机反馈"右侧还是没有边距"）**：core 新增 `GutterComponent`（`src/gutter.ts`，kimi `GutterContainer` 等价：child 按 `width-2n` 渲染 + `padColumns` 左垫 n 列，样式不动、invalidate 透传），挂载层统一包装全部内收面——transcript 条目（含 step-summary）、banner、activity/todo/btw/queue 四 pane、footer；编辑框/对话框/overlay 贴满宽不动。banner 满宽断言改内收锚、footer 行首 gutter 锚，pane 规格经 strip/unwrapped 助手去沟。按原 S21 档的 reflow 预判为一次性完成；S13 推迟注记与本条"待落地"状态随此移除。

### D30. 对话框挂载改 editor 槽位替换：浮层 overlay 盖不住的编辑器直接退场（用户裁决，S16 dogfood 修订 D26 锚定手法）

- **背景**：S12/D26 把对话框定为 `showOverlay` 浮层（`bottom-center` + `offsetY: -2` 让出 footer 两行，面板"盖住"编辑器槽位）。S16 dogfood 实机暴露两层问题：(1) 浮层只让出 footer，编辑器框（尤其顶栏 `╭──╮`）在面板与 footer 之间露出——dump 证实 row 21 面板底边、row 22 编辑器顶框、row 23 footer；(2) 面板较矮时（/sessions 短列表）编辑器整框暴露更多。用户裁决对齐 kimi："应该直接隐藏 Editor，kimi 的效果是看不见 Editor 的，pane 下面只有 footer"。kimi 源码核实：全部对话框（help/session picker/approval/question/trust）统一走 `mountEditorReplacement` —— `editorContainer.clear()` 后把面板 addChild 进编辑器容器，编辑器组件**离树但状态存活**（草稿/历史保留），关闭时 `restoreEditor` 换回并重设焦点。
- **决策**：对话框挂载从浮层改为**editor 槽位替换**（kimi `mountEditorReplacement` 移植）——`editor-instance` 开 `EditorSlotSwap` 缝（`setEditorSlotSwap` 由 blue-input 挂载期安装、卸载期清除；`mountEditorReplacement(component)` 面板调用并取回恢复 disposer）；blue-input 实现栈式替换（挂面板时摘除 editor+hint 两个 dock 子组件、面板入栈并 `setFocus`；栈弹空恢复 editor 并还焦点；fiber 卸载时未关面板随之下树，其 disposer 变 no-op）。四个调用点（/sessions、/help、approval、questionnaire）全部改走替换，S12 的 `width/anchor/offsetY/maxHeight` 锚定参数随浮层退役。framePanel 全宽上拉的**观感**不变（面板本就自绘框），变化的是挂载机制：面板真实占据 dock 槽位、其下只有 footer。
- **理由**：盖不住是浮层的结构性缺陷（锚定只认 terminal 底行，不认 dock 高度）；替换让"面板下方只有 footer"成为布局事实而非绘制巧合；kimi 同构；编辑器仅离树不清状态，草稿与历史天然存活；替换还消除了浮层 maxHeight 切片与 dock 增长的相互作用（面板高度自管）。
- **后果**：D26 的"底部上拉面板观感"裁定维持（全宽、framePanel、底部上拉的视觉范式不变），其 `showOverlay` 锚定手法句由本决策取代——`showOverlay` 仍保留在 L1 契约（未来 alt-screen 搜索/diff 全屏预览等真浮层表面可用），但对话框表面一律走替换。已知边界：btw 面板开着时对话框替换编辑器，btw 面板悬在对话框上方（`├┤` 拼接指向已离树的编辑器）——dogfood 未报困扰，留待 S17 活动模式机的 `hidden` 态一并定夺（kimi 对话框挂起时 activity pane 亦隐藏）；同因，对话框打开时 pane-activity spinner 行仍在面板上方，S17 收口。e2e 锚随之改写：编辑器顶框 SGR（`38;2;90;90;90`）在面板打开时必须从整帧消失。

### D31. `@` 附件语义层：纯文本 mention（kimi 同构），投资全部落在补全体验（用户裁决，2026-08-20）

- **背景**：roadmap P2 图片条目的"`@` 附件待做"。双侧源码调研（kimi-code `FileMentionProvider`/pi-tui `CombinedAutocompleteProvider` 全链路 + harness rc.7 附件面）结论：(1) **kimi 的 `@` 是纯文本补全**——补全只插入 `@相对路径` 文本，提交零解析，文件内容经模型自助调 Read 工具进入对话，无结构化附件/chip/pending 队列；(2) **harness 无文档附件表面**——`dsh-attachment` 纯图片（4 种栅格格式），ContentBlock 无 FileBlock/DocumentBlock，`read`/`read_image` 工具（信封格式 + 系统提示引导 + 路由模态门控）是官方通路；(3) **DeepSeek 路由 text-only**——含 ImageBlock 的 followup 在序列化时抛 `UNSUPPORTED_CONTENT` 且 `user/message` 事件已先落 session log（毁 turn），故 @ 图片绝不能走结构化通道；(4) **上游 0.84.2 的 `CombinedAutocompleteProvider` 与 kimi vendored 版同源**——fd 管线（scoped query/子串打分/top-20/引号值/目录光标规则）框架层现成，fd 缺失时返回空，kimi 在应用层包 fs fallback。
- **决策**（用户两项裁决：语义层走纯文本 mention；补全体验 kimi 全量对齐）：`@` 引用**语义层维持 kimi 同构的纯文本**——补全插入 `@路径`（带引号变体），提交原样进 text block，模型自助 `read`/`read_image`（后者自带 image-capable 路由门控，DeepSeek 路由安全拒绝）；体验层做 kimi `FileMentionProvider` 全量移植——**core** 增 `blueComponents.createFileMentionProvider(basePath, fdPath)`（上游 combined provider 结构直通，空 commands 构造、仅消费其 @ 分支）与 `EditorAdapter.handleInput` 后的 `reopenAutocompleteAfterInput`（kimi 同名钩子：输入后光标前文本以 `/` 结尾且处于 @ 语境即重开下拉——0.84.2 `tryTriggerAutocomplete` 私有，走 `getHistory` 同款结构 cast，spec 钉住）；**interaction** 新增 `src/file-mention.ts`——`extractAtPrefix`（kimi verbatim 分隔符集）、fd PATH 探测（`fd`→`fdfind`，不做 kimi 的 CDN 托管下载）、fs fallback（kimi 2000/50 上限 + 打分/排序 verbatim）；editor-plus @ 分支改"fd 可用委托 L0 源、缺失/抛错回退扫描器、`applyCompletion` 一律委托"（kimi 组合同构）。
- **理由**："二者结合的最优"恰好收敛于 kimi 的选择——harness 生态侧文本文件的官方通路就是 read 工具（信封 + 系统提示），呈现诚实（内容经 S20 Read 分组卡可见），客户端零大小/二进制/截断风险；替代路线各有硬伤：客户端读文件注入（submit transformer 塞 text block）要自管大小/二进制策略且 transcript 只见 `@path` 不见注入内容；`agent.inject()` 注入按 D28 零呈现、用户不可审计；ImageBlock 通道在默认路由上毁 turn。补全体验层则因上游同源而近乎白得，重写反而违反"框架能力不重造"。
- **后果**：Enter 在 @ 补全上只接受不提交（pi-tui 仅 `/` 前缀 fall-through，天然一致）；`@` 分支优先于 slash 守卫（slash 参数内可弹文件列表，kimi 同构）；已知共同退化角与 kimi 一致——引号路径含空格后逐字重触发失效（应用层 token 提取在空格处断）。**有意偏差三项**：fs fallback 保留 `node_modules` 排除（kimi 仅跳 `.git`——无 gitignore 感知的裸扫描会被 JS 树灌满，kimi 可接受因其 fallback 是 fd 下载期的瞬态，Blue 的可能常驻）；fallback description 用项目相对路径（kimi 用绝对路径，与 fd 路径的相对显示统一）；不做 fd 托管下载（Blue 不从 CDN 拉二进制，PATH 缺失即 fallback 常驻）。fd 管线本身不排除 node_modules（kimi 同——gitignore 覆盖 git 项目，裸目录行为与 kimi 一致，非 bug）。
- **落地（2026-08-20，S22）**：core `createFileMentionProvider` + `EditorAdapter` reopen 钩子（`mentionTokenBeforeCursor` 以 Set 判分隔符）；interaction `file-mention.ts`（探测/fallback/提取）+ editor-plus @ 分支重接；旧 fd 直调机制（`setFdRunner`/`scanFiles`/`listProjectFiles`）退役。927 tests / 63 files，test/coverage（逐文件 100%）/typecheck/lint 全绿；bundle e2e 新增 drill-down 用例（`@docs` → Enter 接受目录 → reopen 列目录内容 → 续打 `blue-arch` 预选 → Enter 接受文件不提交 → 再 Enter 以纯文本提交）。**Dogfood 两轮（同日）**：(1) 用户报"按 @ 无反应、需真实路径前缀"——headless 三种 cwd（小目录/`$HOME`/仓库）裸 `@` 下拉全部正常，定位为触发层环境兜底问题：reopen 钩子扩一条裸 `@` token 也触发（覆盖绕过编辑器 `insertCharacter` 触发检查的输入路径）；(2) 用户复现定位：**session cwd 为空目录**（`/tmp/<hash>`）——fd 零条目 → suggestions 空 → 下拉静默不开（kimi 同款静默，但体验上"@ 像坏了"）。修法：@ 分支空结果（fd 真无匹配与 fallback 无候选同因）经 `shared.notice` 在 hint 行闪现 `no matching files under the session cwd`（abort 的过期轮次不闪）；fd 真无匹配仍不回退扫描器（kimi 语义保持，`fellBack` 旗标区分"无 fd"与"无匹配"）。930 tests / 63 files，空目录 smoke 实证 notice 渲染。**Dogfood 三轮（同日，用户裁定"加稳定序"）**：fd 空查询全 score 1 + 稳定排序保留 fd 输出序，且 **top-20 截断发生在顺序之前**——浅层条目可能根本不在列表里（实测重排后首项漂移至 `packages/`）。裁定：**空尾 token（裸 `@` 与目录下钻 `@dir/`）不走 fd，改一级目录列举**（`listDirectoryMentions`：解析目录（相对/`~`/绝对 base 保留原样进 value）→ readdir 一级 → 目录优先、文件次之、`localeCompare` → 截 50；`.git`/`node_modules` 跳过；symlink 目录计目录、断裂 symlink 计文件；非目录 base/空列表/abort → null 落回 fd/fallback 链）——确定性、直观（恰为"针对 cwd 的相对路径列表"）、与 kimi 的有意偏差（kimi 空查询为 fd 任意 20 条）。查询型 token 维持 fd scoreEntry 序不动。937 tests / 63 files，双轮 smoke 首项一致。

### D32. 文档站：VitePress 双语静态站，zh 根路径 + en 子路径，浏览器语言对称分流（用户裁决，2026-08-20）

- **背景**：Blue 缺少面向用户的文档——README 面向开发者，docs/ 是内部中文设计文档（含实施细节与阶段行文），不应整包公开。上游 deepseek-harness 仓库已有 VitePress + GitHub Pages 成熟形态可镜像。
- **决策**：顶层新增 `website/`（pnpm workspace 成员 `@dsh-blue/website`，VitePress ^1.6.4 + vite ^5.4.14）：**中文挂根路径、英文挂 `/en/`**（中国访问者零 JS 即得中文，与上游同构）；**对称自动分流**——`<head>` 内联脚本按 `localStorage 偏好 > navigator.languages` 在整页加载时做路径映射跳转（英文/其他浏览器落任意中文页跳 `/en/` 等价页；中文浏览器不跳），自动跳转不写偏好；语言切换经 theme 钩子（`router.onBeforeRouteChange`，先剥 `import.meta.env.BASE_URL` 再判 locale）在 SPA 导航时盖章偏好，此后双向粘性。站点显示 `v0.1.0-rc.1 · 预览版`——**自家 rc 线从 rc.1 起计**（版本独立于上游 rc.7/rc.8 线），该版本号即未来五包首次发包的统一版本（发版任务另行执行）。部署 GitHub Pages（project pages 基座 `/blue/`，`DOCS_BASE` 环境变量驱动，sitemap hostname 须含基座且带尾斜杠——sitemap 库按相对解析拼 URL）；CI 三 job（PR 构建检查、push master 构建 + 部署，concurrency 挂 job 级：PR 按 ref 取消、部署串行）。`docs/` 维持仓库内部，不进站点；插件开发指南（seams）留待 API 稳定后二期。
- **理由**：镜像上游已验证形态（同 CI 动作组合、同 locales/local-search/cleanUrls 模式、vitepress 1.6.4 即当前 latest）成本最低；zh 挂根使"中国优先展示中文"成为结构事实而非脚本行为；"偏好优先、浏览器语言兜底、自动跳转不写偏好"三原则使手动选择粘性成立且首访可探测；docs/ 公开收益低、翻译维护成本高。
- **后果**：vitepress/vite 进入根 lockfile（esbuild 构建脚本经审查放行，`allowBuilds: esbuild: true`）；仓内包版本（0.1.0-rc.7）与站点版本（v0.1.0-rc.1）暂时并存——前者是未发布的本地状态，发版时五包统一改为 0.1.0-rc.1；网站成为新的双语同步面（zh 顶层为源、en 镜像逐页跟随，en 侧边栏只列已存在页，防死链断构建）；键位/命令/主题 token 三页内容必须从源码提取（`packages/interaction/src/keys.ts`、`packages/interaction/src/commands-plugin.ts`、`packages/core/src/theme-*.ts`），源码变更需同步改页；github.io 在中国大陆可达性不稳，自定义域名为未来缓解项。


## P2 命令系列决策（四家命令面实施期，2026-08-21）

### D33. `/permission` 与 `/preset` 分立：dsh 的两个 preset 域各归其位（用户裁决，2026-08-21）

- **背景**：dsh 里 "preset" 一词有两个互不相干的域。**permission preset**（`dsh-permission-presets`，dsh-base 装载）：sandbox 模式 + approval policy 的命名束，`/permission` 命令自带（rc.8 base 扩表为 read-only / workspace-write / danger-full-access，`custom` 为只读派生态），`permissions` 投影 + `permission/preset` 事件 + settings 持久化齐全，会话内随时可切。**agent preset**（`dsh-agent-presets`）：插件组合预设（standard/minimal/code/cordis，一个目录 = 一个 `agent.cordis.yml`），决定工具目录/persona/prompt sections；`ctx.agentPresets.list/mount/recompose` 存在但 **`recompose` 仅对未产出任何内容的空会话合法**（`sessionBlank` 检查在 wire 层 apiproxy 强制，进程内直调时责任在调用方），切换后须 append `agent-preset/selected` 事件保持"模型可见⟺已记录"；无 slash 命令、无 CLI flag，且 **该插件行不在 dsh-base**（仅 web-app bundle 装载）——Blue 骑 dsh-base，默认无 `ctx.agentPresets`。
- **决策**（用户裁决，A/B 都做）：A 的命令名是 **`/permission`**——不另注册（上游命令本体随 base 到货，`/help` 自动枚举），Blue 只做**选择器面板**：读 `permissions` 投影渲染选项 + 当前值，选中提交 `/permission <name>`（与命令同一条写路径，Web 端同款范式）+ `danger-full-access` 显式风险确认 gate，排 **S24**（自治授权族同期）。B 的命令名是 **`/preset`**——Blue 自注册新命令，排 **S28**：无参列 `ctx.agentPresets.list()`、带参 `recompose`；Blue bundle 的 `cordis.patch.yml` 增 `agent-presets` 行 + bundle 包依赖 `@deepseek-ai/dsh-agent-presets`（`dsh plugin add` 时随装；CLI 启动器 `profile-boot` 检测到该行会自动注入 shipped preset root，四个内置预设即刻可列）。
- **理由**：命令名一次拆清歧义——用户语义里 "preset" = 换装组合（B），"permission" = 授权束（A）；A 不重复注册是与 `/plan` 同款的"上游自带命令零实现"纪律；B 的组合行由 Blue 自带是因为上游只把它当 web-app 的配置，TUI profile 想要就得自己声明。
- **后果**：`/preset` 必须**自建 sessionBlank 守卫**（进程内直调没有 wire 层 `agent-preset-locked` 强制；会话开始后切换会毁工具调用重放，产品规则即锁死）+ 切换成功后 append `agent-preset/selected` 事件；预设间能力面差异大（minimal 无 plan mode/compaction）——切换后 Blue 的能力探测一律走投影/键缺失而非硬编码预设差异；自定义 permission preset 的运行时注册 API 上游没有（表由组合 YAML 固定，README 明示），残余缝**不请求**（面板消费现成投影已够）；`permission.defaultPreset` settings 只影响新会话，面板上切换的是会话内即时值。
- **实施后记（2026-08-21，S24b 落地）**：① **读面勘误**——面板读 `ctx.permissionPresets` 服务（names/current/resolve/optionOf）而非 `permissions` 投影：`selectFor` 折同一组 knob 事件，`current(events)` ≡ 投影 `currentValue`，服务读保持 Blue 直读服务的既有习惯（planMode.get 同款），投影键留给未来消费者；Blue 加 type-only 依赖（peer+dev rc.7，`import type {}` 携 Context merge，运行时永不 import）。② **开面机制**——裸 `/permission` 由 `blue-input` 提交路径拦截（parseCommand 命中后、别名重写前；服务在场门控），带参行原样走上游命令；零注册零别名纪律保持（/help 与补全枚举上游注册），面板打开不留 command/run 记录（只有真实切换入日志）。③ **行描述派生**——base 表无 name/description，行描述从 `resolve(name)` 派生（`sandbox <mode> · approval <policy>`）。④ **danger gate** = FormPanel typed-y 确认（provider 删除先例），栈式挂载：Esc 回列表、错值留表单。⑤ 随期勘误：provider dismissal 码 `ASK_DISMISSED` → `ASK_CANCELLED`（dsh-plan-mode 只 catch 后者，此前 plan-review Esc 泄漏原始 rethrow；详见 commands-plan §7 #5）。

### D34. `#` 为 skills 提示符：技能不进 slash 命名空间，经上游手势路径消费（用户裁决，2026-08-21）

- **背景**：CC/kimi 把技能做成 slash 命令（`/skill-name`、`/skill:name`）。rc.8 核实：上游的调用机制是**手势路径**——`tool-skill` 的 `agent/pre-step` 监听器扫描本步认领的 user 消息（仅 `source.kind === 'user'`）中的 `/name` token（正则 `/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`，词边界、句中任意位置、去重），命中 user-invocable 技能即把渲染后技能体注入为 instructions 消息；官方契约原话 "every client shares one deterministic path **with no dedicated invocation wire**"。Web 客户端把技能混进 `/` 补全（命令源 order 0、技能源 order 2、同名命令赢、`onPick` 落 `/name ` 字面文本）。Blue 的 `input-plugin.ts:252-274` 对 `parseCommand` 命中但未注册的行拦成 `unknown command`——照抄 web 混排就得改输入层裁决，且 slash 命名空间被动态技能目录污染。
- **决策**（用户裁决）：**`#` 为 skills 提示符，UI 行为与 `@` 文件补全同构**（D31 形态复用）。`#` 弹补全列 user-invocable 技能（`ctx.skills.list({scope})` + `isUserInvocable` 过滤，`skills/change` 失效重拉目录缓存）；选中插入 `#name` 字面文本；**提交时 SubmitTransformer 把 `#name` token 重写为 `/name`**（仅命中目录的技能名；保证重写后 token 前置空白以对手势正则的 `(^|\s)` 边界），消息照常 `agent.followup`——上游 pre-step 确定性注入，resume/replay 语义完整。slash 命名空间保持封闭（只有注册命令）。`/skills` 列表命令仍做（列 name/description/whenToUse/来源层）。排 **S29**。
- **理由**：与 D31 `@` mention 同构的投资结构——提示符只是补全体验投资，语义层零自研解析；手势路径是上游唯一调用通路（无 invoke wire 可调），客户端伪造注入会破坏"一条确定性路径"契约与重放安全；`#` 与 `/` 分流使命名空间天然分层（命令 = 封闭注册面，技能 = 开放发现面），并完全绕开输入层命令裁决的拦截问题（`#` 开头的行不经 `parseCommand`，无 admission miss 可言）。
- **后果**：markdown 标题行是天然误触发面——触发规则须限定 `#` 后紧随非空字符才弹下拉（`# 标题` 的空格形态不触发）🔍 实施期定；未命中技能的 `#tag` 原样保留为普通文本（模型自理）；会话日志记录的是重写后的 `/name` 行，transcript 回显与用户输入差一个前导字符（接受；呈现层映射回来为可选优化 ⚠️）；注入的技能体按 D28（注入上下文默认隐藏）零呈现；**不桥接 `ctx.commands`**——`command/run|done` 是免模型 turn 的本地语义，技能调用必经模型 turn（instructions 注入），桥接是错语义；`ctx.skills`/`skill-filesystem`/`tool-skill` 均在 dsh-base 装载，零上游依赖。

### D35. 用户自建命令 = 技能文件，不做独立 commands-filesystem 机制（用户裁决，2026-08-21）

- **背景**：CC 的 `.claude/commands/*.md` 是用户自建 slash 命令的参照形态。rc.8 核实：上游**无任何**文件系统命令发现机制（`dsh-commands` 仅四源文件，无 fs provider，settings 无命令命名空间）；但 `skill-filesystem` 的六层发现根现成（`.dsh/skills` → `.agents/skills` → `customSkillDirs`（组合配置）→ `~/.dsh/skills` → `~/.agents/skills` → bundled，`SKILL.md` 或平铺 `<name>.md`，frontmatter `name`/`description`/`user-invocable`/`disable-model-invocation`，chokidar watch → `skills/change`）。CC 命令的 prompt 模板语义（`$ARGUMENTS` 展开）与技能 instructions 注入同构；本地 handler 语义（免模型 turn）上游只有 `ctx.commands` 有。
- **决策**（用户裁决）：**不做**。用户自建命令的唯一形态 = 在发现根写技能文件，经 D34 的 `#` 管线调用；不建 `.dsh/commands/*.md` provider，不提上游缝（原"路线 B"撤销）。
- **理由**：一条管线一套文档——`#` 补全 + 手势注入 + `/skills` 列表对内置与自建技能一视同仁，用户零新概念；CC 侧 commands 与 skills 本就在合并；维护两套用户可见自定义面成本不值。
- **后果**：用户文档（website）需给出"自建命令 = 写一个 SKILL.md"的引导页（含 frontmatter 说明与目录表）；`customSkillDirs` 是团队级批量注入面（组合 config，非 settings）；本地脚本命令语义（免模型 turn 的用户命令）不存在，需要时再议。

### D36. `/mcp` 只读列举 + Blue 安装即带 dsh-mcp-client（用户裁决，2026-08-21）

- **背景**：`dsh-mcp-client` 一实例一服务器（stdio / Streamable HTTP），工具自动注册为 `mcp__<server>__<tool>`，指数退避重连 + `tools/list_changed` 重同步；CLI 携带该依赖但**默认组合不启用**（安全姿态：每个服务器命令是沙箱外可信可执行代码）；管理面全缺——不 emit 任何 cordis 事件（状态只写 logger）、无 `listServers`/启停 API（`ConnectionHandle` 模块私有；重连预算耗尽后唯一恢复是 entry 重载或 Host 重启）、无 Resources/Prompts 桥。进程内只读可行：`ctx.loader.entries()` 过滤 `moduleName` 得归一化运行时配置（注意 profile 根 `cordis.yml` 每次启动被重写为空，不可读磁盘那条路）+ `ctx.tools.schemas()` 按 `mcp__` 前缀分组 + `tools/change` 重拉 + fiber phase 近似状态（坑：`failOnStartupError:false` 时 fiber active ≠ 已连接）。
- **决策**（用户裁决）：**做 `/mcp`**，排 **S28**（与 `/tools` 同能力源 `schemas()`）：服务器列表（serverName/transport/命令或 URL/超时/重连参数）+ 每服务器工具清单 + 近似连接状态 + 会话中 `mcp__` 徽章的说明。Blue bundle 的包依赖以 D33 带 `@deepseek-ai/dsh-agent-presets` 的同款方式**加 `@deepseek-ai/dsh-mcp-client`**（上游默认不装，装 Blue 时装上，钉 rc 版本随仓库节奏）；**服务器声明仍走用户 profile patch 层**（上游原生配置通道，HMR 热生效——改文件即运行时增删服务器），Blue 不在 settings 里造平行配置面。管理面缝维持 §7 #6。
- **理由**：只读面零上游依赖即刻可做；配置归配置层（cordis patch 是上游唯一声明的配置形态，settings 无 mcp 命名空间，造平行面会双源漂移）；安全姿态继承上游——声明一个服务器 = 显式同意运行一段沙箱外代码，这个同意动作留在配置文件里可审计。
- **后果**：`/mcp` 面板遇零服务器时引导到 profile patch 文档（而非提供"添加服务器"表单）；重连预算耗尽的服务器只能标注"工具已注销，需重载插件或重启"（无重连 API）；`tools/change` 不在 API gateway 转发白名单（Blue 进程内 `ctx.on` 直接可用，远程形态为架构备忘）；每服务器状态事件与启停 API 维持上游缝请求（§7 #6，P3 nice）。

### D37. 薄宿主迁移：agent 面下放预设层，照 web-app 官方判定（用户裁决，2026-08-21）

- **背景**：dsh-base 把整个 agent 面（tool-bash/fs/jobs/skill/todo/goal/web、plan-mode、compaction 三件套、subagent 全家、workflow、agent-instructions）**全局挂载**；agent preset 组合（standard/code/minimal/cordis）是 harness 为**瘦宿主**设计的（web-app：host 只留注册表/sandbox/approval/持久化/模型路由，工具与 persona 全由预设 standing scope 供给，`recompose` 换父指针即真替换）。Blue 骑 dsh-base，若只加 agent-presets 行，`recompose` 是**叠加**语义——切 minimal 只换 persona 加两工具，~15 个全局工具一个不少，`/preset` 面板会撒谎。官方两哲学在自家 surfaces 互不相撞（CLI 默认 profile 不组预设、web-app 不组 base 工具行）；官方注释明说 TUI（单会话终端）**故意**保留进程级厚基座。D33/commands-plan 写 `/preset` 时引用了 web-app 机制但没意识到基座差异（本期调研发现）。
- **决策**（用户裁决三选一，取"本期做迁移"）：Blue 照 **web-app bundle 的 host-plane ownership 判定**（`packages/bundle/web-app/cordis.patch.yml:280-419`）做薄宿主：① bundle patch 顶部逐行 disable dsh-base 的 23 个 agent 面行（tool-bash/tool-pwsh/tool-jobs/tool-fs/tool-fs-search/tool-str-replace-editor/skill-filesystem/tool-skill/tool-goal/plan-mode/compaction-basic/command-compact/tool-result-pruner/tool-subagent-control/tool-subagent-list-agents/tool-subagent/tool-subagent-fork/workflow-worker-thread/tool-workflow/tool-ralph/agent-instructions/tool-todo/tool-web；`tool-subagent-report` 与 `system-prompt` 按官方判定**保留**宿主面）+ insert `agent-presets` 行（`default: standard`，CLI 启动器见行自动注入 shipped root）；② `blue-app` 建/resume agent 的 setup 里 `presets.mount(agentCtx, resolved)`（上游 `composeAgent` 先例；resolved = 折会话最后 `agent-preset/selected` 事件 > `SessionHeader.agentPreset` > 默认，折页本地 5 行保持 roster 可选性）。
- **理由**：disable 清单是官方维护的（"disable 而非删除是故意的：base 是共享的"），Blue 照抄有人同行；standard ≈ base agent 面全集是 harness 自己保证的设计意图，默认挂 standard 行为等价（persona 与 Blue patch 一字不差）；scope 遮蔽/限制机制本就为此设计。方案 2（只加创建时挂预设、不 disable）因 persona 同文本而无副作用、成为"低风险持久叠加"，但 minimal 不极简的缺口仍在——用户裁决一步到位。
- **后果**：① `/preset` 获得真替换语义（切 minimal 后 `/tools` 面板真实收敛）；② resume/fork 重建组合（日志事件驱动，`/preset` 效果跨重启）；③ **维护税显性化**：bundle.spec 断言 Blue disable 集 ≡ web-app disable 集（漂移守卫：base 新增 agent 面行且官方裁决后，Blue 不跟则红）+ 每个 disable id 必须存在于 base 行集（防拼错静默失效）；依赖 dsh-base/dsh-web-app 两个 patch-file devDep；④ 无 roster 组合（用户删行）= agent 裸建零工具：blue-app 容错跳过 + `/preset` 守卫报错（"薄宿主行被删"是显式误配置）；⑤ minimal 下 pane-todo/plan review 等走优雅退化（能力探测本就走投影/键缺失）；⑥ 挂 standard 后 plan section 文案为预设版（与 base 措辞微差）；⑦ e2e 夹具默认挂真实 roster + 空组合预设（既有用例工具面零变化），/preset 用例换带工具夹具。
- **实施后记（2026-08-21，随 S28 落地）**：迁移与 /tools /preset 同期落地；e2e 钉住「默认挂 alpha→切 beta→resume 重建 beta」全链。官方姿态差异（TUI 厚基座 vs Blue 先行薄宿主）记入 bundle patch 注释与本文——Blue 是第一个要预设切换的终端面。**Dogfood 第一轮发现（scope 双实例）**：真机 `/tools` 面板全空——`scopeOf(agent.ctx)` 在 dev-link 组合下恒为 `undefined`（`kScope` 是 dsh-scope 的模块级 Symbol，CLI 侧实例给 agent ctx 打的标签，经 worktree 链接加载的 Blue 侧 dsh-scope 副本读不回；e2e 单树单实例所以绿）。修复：`/tools` 改经 roster 公开 API `standingKeyFor(composedPreset(agent.ctx))` 取 standing mount 的视图 key（上游注释原话 "for a host reader with no agent"），无 roster/未绑定时回退全局视图；interaction 移除 dsh-scope 运行时依赖。教训：跨 store 边界（CLI store vs dev-link store）的 Symbol 语义 API 不可依赖，公开对象 API 才是契约。

## 已知遗留（MVP 有意为之）


- `/quit` 在 agent attach 前输入会显示 "no active session" 而不退出（input-plugin 在命令分发前检查 current agent）
- alt-screen、自定义键位属 P1/P2


### D38. S23 模型族：modelRef 缝取 getter 三级优先，Alt+S 全语义，Add Provider 走 Web Models 页同款写入序列（用户裁决，2026-08-20；原误编号 D33，2026-08-21 勘误重编——本条属 P2 命令系列决策，保留原位）

- **背景**：blue-commands-plan §4.2.1 为 `/model` `/effort` `/provider` 开 `BlueSessionRef.modelRef` 缝。实施前调研发现两件事：(1) 原方案的纯可变字段无法表达 resume 语义——harness apiproxy（Web 面）对同类缝用 **getter/setter 三级优先**（会话内 picked → 会话日志最近 request header → 进程默认），且 Blue 现有接线存在同名缺陷（resume 机械上切回进程默认，app 注释声称 header wins 但不成立）；(2) kimi 的 Alt+S session-only 通道与底部 thinking 段控件是用户明确要的全语义。
- **决策**（用户四项裁决 + Add Provider 范围扩项）：(1) **modelRef = `createModelSelectionRef` 的 getter 三级优先**（app `src/model-ref.ts`，`current` 恒有值收窄为 `BlueModelSelectionRef`），三个 commit 点与 `current` 一同发布，session-changed 不变式要求 handle 已发布——resume 缺陷随缝修复（e2e `--resume` 后请求模型断言）；(2) **Alt+S session-only 做全语义**（contextual action `blue.interaction.session-only`，三面板提交分支，Enter 持久 / Alt+S 仅会话）；(3) **/model 面板底部带 kimi thinking 段控件**（`thinking-segments.ts` 共享段 chrome，←/→ 调高亮行 effort 草稿，`Off (Unsupported)` 降级）、**/effort 用水平分段**；(4) **/provider v1 即含 Add Provider**（原 ⚠️ 顺延项拉入）：两分支（采纳 pi-ai 目录 vendor / 自定义端点 route+协议+baseURL+掩码 key），openai 协议走 `discoverModels` 端点发现喂多选采纳、其余手填 model id；提交序列 = **`settings.mutate('llm-pi-ai', [set providers.<route>], revision)` 先、`credentials.set(<ROUTE>_API_KEY)` 后**（Web Models 页同序，失败重试只剩一步）；落成后打开限定该路由的模型面板，Esc 保留 provider 不改默认（kimi "provider persists" 同义）。表单面 `form-panel.ts`：kimi 双字段对话框在 Blue editor 上的移植（Tab/↑↓ 字段路由、Enter 前进末字段提交、面板内 error 行不关面板、掩码字段渲染派生 `•` 行永不回显明文）。
- **理由**：三级优先是上游 Web 面已验证的语义（零发明），且是唯一同时修 resume 缺陷的形状；Alt+S/段控件是用户裁决的 kimi 全语义对齐；Add 的写入序列照抄 Web Models 页 = 跨命名空间 `settings.mutate` 有官方先例、校验由注册方 schema 在写入点执行、凭据经 `ctx.credentials` 落 `$DSH_HOME/.credentials.yaml`（0600，env 遮蔽时 set 拒绝并转述上游指引）。
- **后果**：interaction 新增对 `dsh-agent-default-model`/`dsh-settings`/`dsh-credentials` 的 peer 依赖；e2e 另挂真 `dsh-settings-file`/`dsh-credentials-local`/`dsh-llm-pi-ai`（休眠态）+ 本地 fixture HTTP server 承接 discovery（`DUPLICATE_DISCOVERY` 已核实——pi-ai 挂载后不能以假 discovery 覆盖）；生产运行时零新增组合行（宿主 dsh-base 自带三件）。**已知边界**：模型切换若始终未到达一次落盘请求（下一 step 未跑就切会话），picked 随 agent dispose 丢失（dsh 缝只在 `request/header` 落盘时持久化，README 已记）；面板无模糊搜索、命令参数无补全（deferred）；Add 的 revision 冲突 v1 单次尝试。凭据 env 遮蔽行为在 e2e 中真实触发过一次（宿主 shell 恰有同名 `MY_GATEWAY_API_KEY`），守卫文案如实转述。
- **落地（2026-08-20，S23）**：app 缝 + resume 修复（`model-ref.ts`/三 commit 点/不变式）；interaction `thinking-segments.ts`/`model-panel.ts`/`form-panel.ts`/`provider-add.ts`/`model-commands.ts` + keys 三 contextual action（←/→/alt+s）；e2e 10 用例（含 Add 两分支真件落盘断言、resume 回归、跨进程持久、/new 跟随）。1068 tests / 71 files，test/coverage（逐文件 100%）/typecheck/lint 全绿。

### D39. S33 子 agent 分组卡：渲染层成组 + 子会话订阅 live 叠加，瞬态事件弃用（用户裁决，2026-08-21；原分支编号 D37 与 S28 薄宿主撞号，合并 master 时重编 D39）

- **背景**：S33 要把同 step ≥2 个 spawn 类 subagent 调用从 N 张独立工具卡聚合为一张分组卡（kimi `agent-group.ts` 同构）。三路调研 + 设计核实 + 两轮 dogfood（blue-s33 profile，调试插件落 `/tmp/s33-dogfood.log`，会话 `session-56b4318f`/`session-846a852b`）逐项实证。
- **dogfood 实证（2026-08-21，0.1.1-rc.1）**：(1) 子会话 `session/event` **无条件到达**未 scoped 插件 ctx（实测 5500+ 条；cordis 对裸 Session 载体不做隔离过滤），准入键 `header.origin === 'subagent' && header.parentSession === <父会话id>` 实测可用；(2) 同 step 并行成组条件实测（turn=1 step=1 内 `subagent`×2 + `subagent_fork`）；(3) **两类 ack 形态分裂**——spawn 类 result 文本 `started subagent <子会话id>`（id 精确关联），**fork 类只有 `started background subagent job subagent-N`（job 名，无会话 id）**——fork 的唯一关联路径是 prompt 键（子会话首条 live `user/message` src=user 文本 === 父 `args.prompt`，实测成立；委派 prompt 先经 `agent/inbox/spliced` 入队、turn 开始才成 user/message）；(4) 三事件均 **35ms 内立即 ack**——包括 fork（0.1.0-rc.5 源码称 fork 前台阻塞，0.1.1-rc.1 实测已 job 化，源漂移活例）——纯 fold 三态对两类工具都会**早熟**显示 finished；(5) 真实结果由模型经 `job_output {job_id, wait:true}` 在后续 step 收割（job_output 非_spawn 名集，天然不进组）；(6) 四个 kimi 字段全有源：tokens ← 子会话 `assistant/message` per-step `usage`（input/output/cacheRead/reasoning，replace-per-step 求和），toolCount ← 子会话 `tool/call` 计数，model/effort ← 子会话 `request/header` config，phase 权威 ← 子会话 `turn/end` reason.kind（实测 `completed`）；(7) `firstLiveSeq` 种子语义证实（fork 子 live 自 seq 2、spawn 子自 seq 4；fork 种子含父 turn 前缀——种子必须 `slice(firstLiveSeq)` 否则父 usage 灌入子 token）；(8) 瞬态 `subagent/start|end` 实测可达（默认组合 isolate 共享），负载 `{runId, provider: spawn|fork, id, local}`（id==子会话 id）、end 带 `stopReason`+`lastAssistantMessage` 全量——但 carrier 是 SubagentsService（Service 隔离过滤，**契约不保证**可达），且信息被子会话流完全覆盖。
- **决策**（用户三次裁决 + 设计验证）：(1) **渲染层成组**（mount 邻接，ReadGroup 同构克隆），不做 fold 层新 kind（消费者连锁：createPlainComponent 穷举 switch、session-export 非穷举 else、foldStep 孤儿行）；(2) 名集 **spawn 类 `{subagent, subagent_fork}`** 对齐 kimi，控制类（send_message/interrupt_agent/list_agents/report/job_output）普通卡；(3) live 信息深度走**子会话订阅**（用户裁决升级，超出"最小分组卡"原定档，roadmap 档期 2-3d → 3.5-4.5d）：A+ fold 基线（name/description/三态/elapsed）为底，tracker 叠加 kimi 级字段（running/waiting 细分、tokens、toolCount、最新活动行、model/effort）；(4) **瞬态事件 v1 弃用**（isolate 依赖 + 信息被子会话流覆盖）；(5) replay/远程 provider 成员降级 A+ 形态（tracker 只在 live 挂载构造，结构保证）。
- **修正记要**：roadmap L113 "resume/replay 走 tool 折面 + `subagent/descriptor` 持久事件" 的 descriptor 半句有误——descriptor 写在**子会话**日志（"Providers append it turn-enclosed in the child's initial turn"），从不流经父 transcript；replay 是纯 tool 折面。随本条落地一并修 roadmap 措辞。
- **理由**：子会话流是唯一不赌组合隔离契约、又能拿到 kimi 级信息的通道（Blue 侧纯工程，零上游依赖、零新包依赖）；pane-btw side-session 订阅为生产先例；A+ 基线保证 replay 诚实降级与无流回退。
- **后果/边界**：同 prompt 字节级相同的并行成员首见序 tiebreak（最坏两行统计互换）；continuable 唤醒/冷复重开计数为"本 epoch"语义（与 harness epoch 记账一致）；崩溃孤儿 pending 与 ReadGroup 同形既有语义；远程 provider（无本地会话）成员保持 fold-only；`/export` 输出每成员独立 Tool Call 段（分组是挂载层幻象，export 天然降级）。
- **落地（2026-08-21，worktree 待人工验收）**：渲染层成组（`agent-group.ts`，ReadGroup 克隆）+ fold 记录信封 wall clock（`startedAt`/`endedAt`）+ 子会话 tracker（`agent-live.ts`：header 准入、O(1) reducer、两级关联、`firstLiveSeq` 种子）+ 组件第 5 参 live 查询合并（running/waiting 覆盖早熟 ack、kimi stats 行、活动二行、收束 Σ 尾）；1420 tests / coverage 逐文件 100% / typecheck / lint / build 全绿；验收 dogfood 实测 phase 迁移链 `(3 running) → (1 done, 2 running) → … → 3 agents finished · 10 tools · 211k tok · 7s` 与活动行滚动（Thinking…/Using glob/read/bash）。
- **形态修订（2026-08-21，验收反馈裁决）**：kimi 源码核实其 subagent 呈现有两条路径——普通 `Agent` 工具是流内组卡（本实现首版同构），而 **AgentSwarm 是钉住 pane**（挂 transcript 尾=视觉钉 dock 正上方、子事件全吞、下一 `turn.started` 硬删不进历史、replay 一行摘要）。验收裁决采用 Swarm 语义：**`blue-pane-agents` dock pane**（bundle 行序 activity → queue → todo → btw → **agents** → editor，紧贴编辑框上部）+ **fold 抑制 spawn 类**（todo_write 先例，流与 export 均无 spawn 卡，pane 是唯一呈现面）+ **settled 组保留到下一 turn/start**（live overlay 有 running/waiting 成员则跨 turn 保留——后台 ack 早熟但子会话在跑时不清）+ **resume 快照重建收束卡**（无 live 叠加）。mount 层分组与 mountSession tracker 退役；`AgentGroupComponent`/`agent-live.ts` 原样复用为 pane 内件。随批顺修 queue pane 既有缺陷（字符数截断遇 CJK 漏 2 列触发 pi-tui 宽度守卫崩溃，验收首日实锤）。1427 tests / coverage 逐文件 100% 全指标。

### D40. `/mcp` 提前落地：双口径计数与三层面板（用户四裁决，2026-08-22）

- **背景**：`/mcp` 原排 S28（D36 只读列举），S28 落地时顺延。用户裁决提前到现在做。实施前对最新 harness（0.1.1-rc.2，fetch 核实）重读 mcp-client 全源：rc.1→rc.2 零实质变化、管理面（listServers/启停/状态事件）仍全缺——D36 前提在最新版成立，钉 rc.1 无信息损失。接口面新核实三件事：(1) 枚举字段是 `entry.options.name`（非 D36 写的"moduleName"），归一化配置在 `entry.fiber.config`（Schemastery 校验后、默认值已填），原始兜底 `entry.options.config`；(2) loader 侧还有 `loader/entry-init`/`loader/partial-dispose`/`loader/config-update` 三个公共事件（加 `tools/change`）可作面板 live 刷新信号；(3) `FiberState` 是 const enum——编译产物无运行时对象，跨包引用需本地数字常量对齐 .d.ts 契约。
- **决策**（用户四裁决）：**Q1 只读维持**（配置归 profile patch 层，不做"添加服务器"表单——D36 理由原样成立：单一配置源、可审计、HMR 热生效）；**Q2 两步式面板**（/tools 同构）；**Q3 计数口径 = 会话可见**（用户："非会话可见的计数展示出来没啥用"）+ **保留一次全局读作健康信号**（我的补充，用户未否决）：fiber ACTIVE 且全局 0 工具才是"无工具"，全局 N + 会话 0 是"被预设限制"——单看会话口径，切 minimal 预设的用户会看到所有服务器"无工具"而误判 MCP 全挂；**Q4 即刻做**（新 S34 步，无硬前置）。
- **形态**：三层面板走同一次快照——L1 服务器选器（状态注意力序：failed 最前，kimi 同款；尾随诚实注行：无会话/orphan 工具）→ L2 服务器面板（`server config` 伪行 + raw 名工具行 + restricted/blocked 尾行）→ L3 详情（config：状态+双口径计数+恢复提示 / 脱敏连接事实（env/headers 只 key，kimi config-view 纪律）/ 归一化策略；工具 schema：复用 `buildToolDetailSections` 白捡）。空态指路 website dsh/mcp 页。状态推导七态：synced / restricted / no-tools（三义注记：连接中|启动失败被吞|预算耗尽，恢复=重载插件或重启）/ starting / failed / reloading（HMR 换代窗）/ disabled——以全局注册工具存在性为主、fiber phase 为辅（`failOnStartupError:false` 时 active ≠ 已连接）。
- **落地**：`mcp-servers.ts` 薄读层（纯函数 + 窄结构类型，status 推导/脱敏/双口径全可单测）+ `mcp-commands.ts` + scope 解析抽 `tool-scope.ts` 共享件（/tools 等价重构消费）；bundle dependencies 钉版 `@deepseek-ai/dsh-mcp-client@0.1.1-rc.1`（D33 agent-presets 同款，不加 patch 行——服务器声明留用户层），**runtime dependencies 首入 `version.spec.ts` 门禁**（此前只查 devDeps/peer/excludes）；pnpm-workspace `minimumReleaseAgeExclude` 同步入册。
- **测试**：单测覆盖状态推导全表/脱敏/双口径/orphan/无会话退化；e2e 手写 stdio fixture server（零依赖 JSON-RPC：initialize 回显 protocolVersion、tools/list 两工具）走真连接路径——loader 拉真 entry、子进程真握手、工具真注册；**FAILED 形态留单测**：`failOnStartupError:true` 的 entry 会让 `loader.await()` 拒绝整树 boot，e2e 树里不可构造。两处 e2e 基建教训：裸包名从 vitest cwd（仓库根）解析失败——bootBlue 的 Loader 设 `baseUrl` 指向 bundle 包目录（生产同构）；node CLI 不接受 `file://` URL 作入口参数——子进程 args 用普通路径（组合行 `name` 仍要 file URL）。
- **边界与挂起**：快照式面板（SelectListPanel/InfoPanel 构造时定格、无 setRows）——重开面板即新数据；live 原位刷新（四信号订阅 + 面板重建）记挂起，信号清单见上。管理面（每服务器状态事件/启停/重连 API）维持上游缝请求（§7 #6）。重连预算耗尽只能标注"需重载插件或重启"（无重连 API）。`serverName` 可含 `__`（pattern 允许）——分组按 entry 声明名前缀匹配而非 split 解析，入口名的歧义不存在；spec 侧手注册的 `mcp__` 工具（无对应 entry）计 orphan 注行不冒充服务器。

### D41. all-prompts 标题节奏桥：`sessionTitle.refresh` 公开 API 驱动（2026-08-22；编号避开 s34 分支已占的 D40）

- **背景**：S30① 声明"每条用户消息后辅助小模型重新生成会话标题"，但活体验证（blue-footer-swap profile，4 条消息的真实会话）发现标题冻结在首条消息——会话日志里只有 1 条 `session/title-llm-request`（`messageSeqs [7]`），后续消息零请求。
- **根因（上游 `dsh-session-title@0.1.1-rc.1`，非 Blue 侧缺陷）**：服务给 all-prompts 档位的两个启动触发都不通——① `request/header` 事件**每会话只落一条**（首个主请求）；② `onMainRequest`（全局 `llm/stream` 瀑布）的边界闸门 `boundary.seq <= pending.throughSeq`——dsh-agent-loop 的事件序是 `step/start` **先于**当轮 `user/message`（实测 seq 6<7、116<117），所以开轮消息本身恒被拒。首条消息能出标题纯靠 ①；第二条起 all-prompts 退化为 first-prompt。
- **决策**：Blue 侧加桥插件 `blue-session-title-cadence`（interaction，随基线 `blue-interaction` index 挂载，免 patch 行/子路径/tsdown 三处联动）——当前会话的每条人类消息（`user/message` 且 `source.kind === 'user'`）且 `session.requestHeader() !== undefined` 时，`queueMicrotask` 后调 `sessionTitle.refresh(session)`（公开 API：按 provider 选择器全量重派生、supersede 在途生成、连发自动收敛到最后一条）。
- **纪律**：首条消息必须让位给服务自身的 header 路径——header 未落时 refresh 拿不到路由必失败，且 supersede 会把服务自己的 pending 顶掉（两头皆空）；`session.append` 观察者内不可再派发 append 类调用，必须 microtask 离栈（既有纪律）。
- **理由**：修复走公开对象 API，零新依赖、不赌组合隔离契约；上游正修（服务侧边界闸门对 agent-loop 事件序的假设）在 harness 仓库另行立项，Blue 桥在其落地后可平滑移除。
- **后果/边界**：refresh 用**已落 header 的路由**派生（路由不随 alt+m 换档实时更新——与上游行为一致，仅辅助调用身份滞后）；上游修复合入并升 pin 后本桥可退役；e2e 以结构 fake 的 refresh 记录器断言桥行为（真服务不在薄 e2e 树内）。
- **落地（2026-08-22，随 footer 换位 PR）**：`packages/interaction/src/session-title-cadence.ts` + index 挂载 + 单测 6 例 + e2e 桥断言（首轮 0 次、次轮恰 1 次带会话 id）。

### D42. S35 欢迎横幅改 kimi 式单栏：右栏整体退役，logo 暂用 kimi 占位（用户裁决，2026-08-22）

- **背景**：S8/S16 定稿的双栏 banner（左栏 44 列居中欢迎 + 像素 logo + `model · provider` + cwd，右栏 Tips + What's new，标题嵌顶边框）信息密度高但视觉偏重；用户要求改成 kimi-code `welcome.ts` 那种简洁单栏形态。
- **决策**（用户三项裁决）：(1) **单栏形态**——logo 与 "Welcome to Blue!" / "Send /help for help information." 两行并排，其下 Directory/Model/Version 手工对齐标签行（各 11 可见列），不加 Session 行；(2) **右栏整体退役**——tips 唯一内容源归活动面板 spinner 行（`tips-content.ts` 池不动），What's new 文案删除；(3) **logo 暂用 kimi 原版字符画占位**（`▐█▛█▛█▌`/`▐█████▌`，7 列 2 行；两个自设计候选均被否）——`banner-art.ts` 的字面量即未来替换点，`packHalfBlockArt` 折叠器随 12×6 网格一并退役（grep 证实无外部消费者）。
- **不变式**：min-40 渲染零行维持（不移植 kimi 的 <24 纯文本降级——Blue 自 D22 起"宁可不渲染"路线）；Model 行保 `model · provider`（`ModelSelection` 无 displayName，且 `/model`/`/status` 与 e2e 既有断言零冲突）；S24a 模型行活态刷新、patch 行序钉位（banner 先于 `blue-transcript`）、`BLUE_VERSION` 守卫链（`./banner-content` 公共子路径，`/version` 读它）全部不动；版本号从标题行移入 Version 行；高度恒 10 行（与旧版相同，footer 沉底 e2e 数学不变）。
- **理由**：kimi 形态是用户指定的观感基准；单栏把宽度逻辑从双栏规划收缩为 `total`/`innerWidth` 两个字段；占位 logo 避免自设计阻塞本次重构。
- **后果/边界**：占位是 kimi 产品字符画，Blue 专属标记定稿后于 `banner-art.ts` 一处替换（spec golden 跟随）；头部 `/help` 行自 40 列宽起截断（预算 innerWidth−9），信息行值预算 innerWidth−11；e2e 跨色 run 断言（Version 行 muted 标签 + text 值）改走 `stripSgr`。
- **落地（2026-08-22，worktree 待人工验收）**：`banner.ts` 单栏重写 + `banner-art.ts` 占位字面量 + `banner-content.ts` 收缩为版本常量模块 + banner/banner-art spec 重写 + e2e 两段 + README 双语/AGENTS/roadmap/seams 同步。

### D43. hint 行 slash-discovery 退役：dropdown 是唯一命令目录（S34 验收裁决，2026-08-22；原编 D42 与 master 已并的 S35 kimi banner 撞号，重编——D37→D39 先例）

- **背景**：裸 `/` 时命令目录双渲染——pi-tui dropdown（S14 completion polish，editor-plus 装载）与 hint 行 slash-discovery tier（S14 同期的前置产物，横排前 3 条）同屏。首轮修复尝试"dropdown 开启时 hint 让位"（render 期探 `isShowingAutocomplete()`，避开异步竞态），但 Esc 关闭 dropdown 后 discovery 行复现——让位治标不治本，验收二轮仍报冗余。
- **裁决**：彻底退役 discovery tier——dropdown 完全覆盖其功能（同一 `slash-filter.ts` fuzzy filter、可滚动分页、可选中补全），discovery 仅存的出场时机（Esc 后、无 dropdown 的 plain baseline）价值不足。历史注记：S15 已退 persistent key-affordance tier，本条再退 slash-discovery，hint 行只剩 notice 职能。
- **保留面**：`no matching command: /x` 空结果反馈（dropdown 空匹配自关，notice 是唯一信号）与全部一次性 notice（命令执行结果/错误）。alias 标签语义（`/quit (q, exit)`）由 dropdown 侧测试承接（editor-plus.spec 既有覆盖）。
- **后果/边界**：plain baseline（drop 掉 enhancement 段、无 dropdown 的组合）失去 slash 目录预览——`/help` 仍在；实际部署 bundle 恒装 editor-plus。`slashCommandLabel` 从 input-plugin 的消费面退役（editor-plus 仍用）。

### D44.（已撤回）进程 stderr 接管（S34 验收三轮尝试，2026-08-22 用户裁决撤回）

- **问题**：boot 期编辑框闪烁 + 一条来不及看的 `Starting default (STDIO) server...`。取证实锤（冒烟 log 原始字节）：裸文本帧后直写——是 **MCP 服务器子进程的 stderr**；dsh-mcp-client 构造 `StdioClientTransport` 不传 `stderr` 选项，SDK 默认 `'inherit'`。影响一切会写 stderr 的 stdio MCP 服务器。
- **尝试与撤回**：blue-core 曾接管 `process.stderr.write`（行缓冲 → `blue/stderr-line` 事件 → transcript muted 行）。真机冒烟证伪：`'inherit'` 是 **spawn 级 fd 直通**——子进程直接写终端 fd 2，字节不经过父进程 JS 层，`process.stderr.write` 替换拦不到内核级继承。用户裁决撤回（拦不住目标问题）。
- **正路（上游缝，勿在 Blue 侧重试 JS 层拦截）**：harness `packages/mcp/mcp-client`——`StdioConfig` 加 `stderr: 'inherit' | 'pipe'`（默认 `'pipe'`）、`transport.ts` 透传；pipe 下子进程 stderr 进 SDK PassThrough（`transport.stderr`），mcp-client 消费后以 `console.error` 转发回父进程（in-process 写，届时 Blue 可重评接管形态把行送进 transcript；非 TUI 宿主照常终端可见）。上游落地后 Blue 侧接管才有效。

### D45. 渲染宽度崩溃族根治：出口兜底 + 真语义测试网 + 真进程 smoke（#14/#15/#18，2026-08-22 用户裁决）

- **背景（机制）**：pi-tui 0.84.2 主屏差分写屏守卫（`tui-main-screen.js`）对任一 `visibleWidth(line) > terminal.columns` 的行为"写 `~/.pi/agent/pi-crash.log` → `stop()` → throw"，而 throw 位于 setTimeout/nextTick 回调 → uncaughtException → 进程整棵退出（#14/#15/#18 三连崩的结构性代价：用户长会话陪葬）。三层结构性原因：① 防线是约定不是机制（~44 个组件各自手拼行，靠人记得截断）；② 测试网假绿（transcript/interaction 宽度断言全跑在码点计数 fake 上，D39 的 CJK 漏列 bug 结构性测不出）；③ 守卫 fail-loud 崩会话。
- **误诊更正（记档）**：#18 初诊"intent-terminal.ts:158 调了截断仍超宽"系误诊——`pi-crash.log` 第 223 行的字节结构（`$ ` 含于 SGR span 内、`✓ Ran a command` 卡片头）证明真凶是 `components.ts` ToolCallComponent **bash 降级路径**（`run_in_background:true`/出错时 presenter 落 generic）拼行完全未截断；intent-terminal 截断正确，pi-tui `visibleWidth`/`truncateToWidth` 本身（CJK/emoji/ANSI/OSC8）无缺陷，resize 竞态排除。在途 PR #18 修的正是该处。
- **决策（用户三项裁决）**：
  1. **出口兜底（机制层）**：`core/src/frame-clamp.ts` 的 `clampFrame` 挂在 terminal.ts 既有的 dock 填充 render 包装缝（D23 同缝），两条返回路径逐行 `visibleWidth > width` → `sliceByColumn(line,0,width,true)` **硬截断**（不用省略号版——最后防线要绝对安全）+ 按原始行去重记 `blue-overflow.log`（与 pi-crash.log 同目录链 `PI_CODING_AGENT_DIR ?? ~/.pi/agent`，16ms 重渲染不刷盘，fs 错误全吞——兜底不得反噬渲染）。**fail-loud 降级为记录**：dogfood 期"逼你修"的价值由日志保留，代价从"崩溃"降为"条目"。overlay 合成路径上游已自防御（`compositeOverlays` 内 sliceByColumn），不在本决策面。
  2. **门禁第一波 = 真语义 + 崩溃族扫齐**（非全 44 组件）：`core/src/width.ts` 作为 pi-tui 宽度工具唯一转发缝（transcript/interaction 不声明 pi-tui 依赖、版本解析唯一经 core，D4 边界不被测试层打穿）；两包 fake 宽度工具全部改委托真实现（消灭假绿——`'...'` 省略号恒被 `\x1b[0m` 包裹等真语义进 golden）；`width.spec` 语料矩阵 × 宽度 1..120 全扫 + mulberry32 种子随机 500 条，钉死 pi-tui 升级时 blue 契约依赖的不变式；`width-scan` 契约 spec（共享助手 SCAN_WIDTHS × ADVERSARIAL）覆盖 transcript 12 组件（含 #18 崩溃位 bash 降级路径）+ interaction 面板族 + core Gutter/framePanel/WrappingSelectList。
  3. **上游不动，记档跟进**：kimi-code 本地 fork（`kimi-code/packages/pi-tui/src/tui-main-screen.ts:227-262`）已做同款 throw→截断 + asciiVisibleWidth 快路径（其 AGENTS.md 分歧 #3 明令同步上游时勿带回 throw），参考实现现成；上游 PR 为独立跟进项。
- **扫描首跑战果（修复清单，全是 master 活着的潜在崩溃）**：`⏹ interrupted` 固定行零截断（13 列无视视口）；User/Assistant/Thinking 的 bullet+缩进结构在 width ≤ bullet 宽时行必超（拖拽 resize 中途经过 2-3 列即触发一帧崩溃）；FormPanel 20 列地板；framePanel 固定 4 空格缩进家具；ModelPanel 三处裸行（SEGMENT_CAPTION/UNSUPPORTED/Search:）+ nameCap 地板 8+前导 4=12；GutterComponent 向 child 传负宽度。修法统一为 `clampRowsToWidth`（core/chrome.ts，"拼完过截断"家规的机制化）+ 退化宽度条件式——**只在固定家底超过视口宽的退化区间裁剪**，正常宽度零行为变化（标记色测试的 marker 字面量会读出假超宽，无条件 clamp 会把正常 golden 二次截断——banner.spec 的 cwd 84-85 列缝隙误诊同案：插件路径经 scroll 包装预算 83 而纯函数 85，旧断言按 85 校准）。
- **真进程 smoke（oh-my-dsh 两级形态，用户指定参考）**：`script/smoke-happy.mjs`（进 CI）——真 dsh 进程 + 丢弃式 profile（复用 install-dev.sh，`PROFILE_INSTALL_FLAGS=--no-frozen-lockfile` 透传 + temp-HOME pnpm 姿态）+ mock LLM（`@deepseek-ai/dsh-llm-mock-server@0.1.1-rc.1`）吐病态内容（160 列不可断 token/CJK/emoji ZWJ/深路径）+ `COLUMNS=40`，断言 exit 0 + statusline/回复渲染在场 + 无 `exceeds terminal width` + **blue-overflow.log 为空**（严格口径：被兜底裁过的行仍是组件 bug）；`script/smoke-pty.mjs`（手动）——node-pty 40×24 真伪终端 raw-mode 按键路径（对话、`/` dropdown、双 Esc、双 Ctrl-C 退出）。boot marker 用 statusline 模型名（banner 仅会话挂载后出现——首跑实证）。**CLI 以全局安装进 CI 而非 devDep**：`@deepseek-ai/dsh` 作 root devDep 会扰动 hoisting、破坏 S34 /mcp e2e 的裸名解析（二分实锤）。
- **后果/边界**：单行超宽不再杀进程（截一行 + 可追责日志）；`width-scan` 把"该修的组件"变红灯（新组件必须过扫描契约）；宽度 fake 禁止再造码点计数（一律委托 `core/src/width.ts`）；smoke 后 worktree 的 pnpm deps-status 会被 temp-HOME 构建污染——smoke-lib 已内置 ambient 环境自愈 install，本地连续 smoke 后 pnpm 卡 no-TTY purge 提示时同法恢复（`pnpm install --config.confirmModulesPurge=false`）。已知遗留：clipboard-write.spec 一例在本机环境性红（基线同红，EACCES 分类与本分支无关）；roadmap R2 的 VirtualTerminal 快照与 width-scan 互补不互替。
- **落地（2026-08-22，worktree 待人工验收）**：`core/src/frame-clamp.ts` + `core/src/width.ts` + terminal.ts 第 4 参接线 + chrome `clampRowsToWidth`/framePanel 退化裁剪 + gutter 地板 + 6 组件 clamp + model-panel/form-panel 修复 + 两包 fakes 委托真实现 + `width.spec`/`width-scan.ts`/三包扫描 spec + `smoke-lib.mjs`/`smoke-happy.mjs`/`smoke-pty.mjs` + install-dev `PROFILE_INSTALL_FLAGS` + CI smoke 步骤 + 本条记档。
