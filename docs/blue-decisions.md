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
- **后果**：包数量不变，增强插件以子路径入口挂在 interaction/transcript 包上（`./pane-activity`、`./status-git`、`./editor-plus` 等）；bundle patch 分基线段与增强段。

## 已知遗留（MVP 有意为之）

- `/quit` 在 agent attach 前输入会显示 "no active session" 而不退出（input-plugin 在命令分发前检查 current agent）
- alt-screen、自定义键位属 P1/P2
