# Blue MVP（Phase 0）实施计划

> **状态（2026-08-18）**：MVP 已完成验收（219 测试全绿、逐文件 100% 覆盖、typecheck/lint 全过）。本文档保留为实施记录；P1 起的层职责与实施序以 [blue-p1-design.md](./blue-p1-design.md) 为准（ADR D17-D21 记录了一次性层职责重排）。

> **仓库形态（2026-08-18 更新）**：Blue 已落地为独立仓库 `blue/`（本文件同级目录），非 deepseek-harness 仓库内包。依赖经 npm registry 解析（`@deepseek-ai/*@0.1.0-rc.7`，next dist-tag），blue 五包间用 workspace 协议。使用路径为 out-of-tree：`dsh plugin --profile blue add @deepseek-ai/dsh-blue`（不再改 harness 的 PROFILE_TEMPLATES）。本文档的 Step 1/5 中"in-tree profile 注册"相关内容已被该路径取代。

> 前置文档：`blue-roadmap.md`（分层架构、阶段划分、守门清单）
> 目标：`dsh --profile blue` 启动后完成一轮完整对话——流式 Markdown 渲染、工具调用呈现、审批/提问 overlay、`/quit`、`--resume`；终端异常时恢复 raw mode。
> 验收标准与"明确不做"清单以 roadmap P0 节为准，本文档只回答"怎么落地"。

## 0. 关键源码事实（实施时直接引用，不必重新查证）

以下来自仓库源码 verbatim 提取，路径均为 `deepseek-harness/` 下绝对路径的前缀省略。

- **模板**：`packages/bundle/headless/`（cordis.patch.yml、startup.ts、index.ts）是 Blue 的直接模板。
- **启动胶水**：
  - `boot(binName, absoluteConfigPath, patches?, prepare?, bareModuleBaseUrl?)` — `packages/boot/app-boot/src/index.ts:757`
  - `installFailLoud(binName, proc?, release?)` — 同文件 :609；`release` 专为 terminal-owning surface 设计，超时 `FAIL_LOUD_RELEASE_TIMEOUT_MS = 2000`
  - `parseCmdline(ctx, program: Command)` — `packages/boot/cmdline/src/index.ts:98`；commander action 里 `ctx.provide(name, value)` 发布 startup 服务
- **profile 生效**：`PROFILE_TEMPLATES`（`packages/boot/app-boot/src/profile.ts:113-125`）加一行 `blue: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`（in-tree 路线，对 app-boot 的唯一改动）
- **Agent 驱动**（`packages/core/agent/`）：
  - `agents.create(options): Promise<AgentHandle>`、`agents.resume({ resumeSessionId }): Promise<AgentHandle>`
  - `Agent`：`followup/steer/inject(message)`、`cancel(cause)`、`whenIdle()`、`session`、`status: 'idle' | 'running'`
  - `'agent/status'(payload: { agent, status })`，scope-filtered
  - 建 agent 前必须 `await ctx.get('loader')?.await()`（等整棵树 settle，headless 模板原话）
- **会话事件**（`packages/core/session/`）：
  - `'session/event'(session, event)`，fire-and-forget，监听器异常被容忍
  - `SessionEvent` 判别联合：`switch (event.type)` 直接 narrow `event.data`；核心类型：`user/message`、`assistant/chunk`（流式）、`assistant/message`（最终）、`tool/call`、`tool/result`（含 `meta?: JsonValue` 呈现载荷）
  - **resume 语义关键**：seed 历史不重播 `session/event`——先读 `agent.session.events` 快照渲染历史，再订阅增量
- **交互缝**：
  - `ctx.userQuestions.registerProvider({ ask(request) }): () => void`（`packages/interaction/user-questions/src/index.ts:64`）；单活跃 provider，重复注册抛 `DUPLICATE_PROVIDER`；request 含 `questions: AskUserQuestionItem[]`（`{ id, question, detail?, options?: {label, description?}[], multiSelect? }`），返回 `{ answers: [{ id, selected: string[], custom? }] }`
  - `'approval/request'(req, next)` waterfall（`packages/interaction/user-approval/src/index.ts:30`）；req = `{ agent, toolName, callId?, reason?, signal? }`；返回 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`，**不调 next() 即短路**
  - `ctx.commands.register(definition): () => void`（`packages/interaction/commands/src/index.ts:245`）；`CommandDefinition = { name, description, input?, handler(invocation) }`，handler 收 `{ commandId, agent, rawInput, signal }`，返回 `{ kind: 'success', text? } | { kind: 'error', text }`；`parseCommand(line)` 可复用
- **工程约束**（`docs/cookbook/adding-a-package.md` + `packages/AGENTS.md`）：
  - 函数插件 named-export `name`/`inject`/`Config`/`apply`，无 default export
  - 每包必须 `./invariant` 入口（`verify-package-invariants` 门禁）
  - 测试：vitest，包级 `tests/*.spec.ts`，CI 要求 `packages/*/*/src` 逐文件 100% 覆盖
  - 产品可见插件必须 REAL-composition 测试（范式：`packages/bundle/headless/tests/startup.spec.ts:37-81`——临时目录写真 cordis.yml 过 Loader）
  - 测试工具：`packages/test-support/agent-loop-testkit`（`mountAgentLoopTestDependencies` + mock LLM adapter）、`loader-smoke`（子进程真启动 E2E）
  - README 三件套（en/zh/i18n.yaml）+ `## Model Experience` + `## Known Limitations` 段；新 group 需注册 `tsconfig.base.json`（两处 wildcard）和 `tsconfig.host.json`（references）
  - 非平凡变更需附 `.agents/notes/` Agent Note

## 1. 包结构与依赖方向

```
packages/bundle/blue          @deepseek-ai/dsh-bundle-blue   （cordis.patch.yml，骑 dsh-base）
packages/blue/app             @deepseek-ai/dsh-blue-app      → agents, sessions, cmdline
packages/blue/interaction     @deepseek-ai/dsh-blue-interaction → core, commands, user-questions, user-approval
packages/blue/transcript      @deepseek-ai/dsh-blue-transcript  → core, session（类型）
packages/blue/core            @deepseek-ai/dsh-blue-core     → @earendil-works/pi-tui（全树唯一）
```

依赖严格单向：app → {interaction, transcript} → core。core 不 import 任何 harness 包（只依赖 pi-tui + cordis 类型）——这是守门清单第 2 条的结构性落实。

## 2. 实施步骤（按依赖序，每步可独立验收）

### Step 1 — workspace 骨架（0.5 天）

- 建 5 个包的 package.json/tsconfig/空 `src/index.ts`/`src/invariant.ts`/README 三件套
- 注册 `tsconfig.base.json` 两处 wildcard + `tsconfig.host.json` references；`pnpm install && pnpm run build:lib:host` 通过
- app-boot 的 `PROFILE_TEMPLATES` 加 `blue` 行
- 验收：`dsh --profile blue` 能初始化 profile 目录并 boot 一棵空树（无插件挂载，直接退出不报错）

### Step 2 — `dsh-blue-core`：L0 + L1（2-3 天，MVP 最关键的包）

**L0 pi-tui 适配**（全树唯一 import pi-tui 处）：

- `Terminal` 启动/停止封装：raw mode、bracketed paste、Kitty 协商全部委托 pi-tui 的 `ProcessTerminal`
- `TuiMainScreen` 单渲染器（alt-screen 不做）；Proxy 稳定引用（为 P1 热切换预留，MVP 不实现切换）
- 生命周期：`ctx.effect(() => () => tui.stop())`；导出供 bin 使用的 `release` 函数接入 `installFailLoud`

**L1 三个服务（签名定稿，过守门清单评审）**：

```ts
// 自有最窄接口，不透传 pi-tui 类型（守门第 1 条）
export interface BlueComponent {
  render(width: number): string[]
  handleInput?(data: string): void
  invalidate(): void
}

export interface BlueScreen {
  addChild(component: BlueComponent): () => void      // 返回 disposer
  removeChild(component: BlueComponent): void
  setFocus(component: BlueComponent | null): void
  showOverlay(component: BlueComponent, options?: BlueOverlayOptions): BlueOverlayHandle
  requestRender(force?: boolean): void
  readonly columns: number
}

export interface BlueTheme {
  readonly colors: BlueSemanticColors   // accent/border/muted/mdCodeBlock/... (text)=>string
}

export interface BlueKeymap {
  register(actions: BlueKeyAction[]): () => void
  matches(data: string, action: string): boolean
}
```

- 三个 Service 子类（`constructor(ctx){ super(ctx, 'blueScreen') }` 形态），随 fiber 摘除
- 定稿评审逐条过 roadmap 守门清单
- 验收：单测用 pi-tui 的 `VirtualTerminal`（@xterm/headless）驱动，断言 addChild/overlay/dispose 恢复；100% 覆盖

### Step 3 — `dsh-blue-transcript`：渲染管线（2-3 天）

- **会话折叠器**：`SessionEvent[] → TranscriptItem[]` 纯函数（无 UI 依赖，易测）：
  - `user/message` → user 项；`assistant/chunk` 流式累积 → assistant 项；`assistant/message` 定稿；`tool/call`+`tool/result` 配对成工具项（generic 呈现：`name` + 截断参数 + 结果摘要，消费 `meta` 若有）
  - `turn/start/end`、`step/*`、`request/*` 等不渲染（或归入状态栏逻辑）
- **组件层**：`UserMessageComponent`（pi-tui `Text`）、`AssistantMessageComponent`（`Markdown`，chunk 到达时增量 setText）、`ToolCallComponent`（`Text` 组合）——全部实现 `BlueComponent`，经 `ctx.blueScreen.addChild` 挂载
- **挂载插件**：inject `['blueScreen', 'blueTheme', 'agents']`；
  1. `await loader.await()` → `agents.create/resume` 由 app 包完成，transcript 监听 `session/event` 增量 + 首渲染读 `agent.session.events` 快照（resume 不重播，顺序必须是先快照后订阅）
  2. 每个事件分支末尾 `blueScreen.requestRender()`
- **状态栏**：MVP 写死单行（model + `agent/status`），不开 `blueStatus` 缝（遵守"首个真实消费者驱动"）
- 验收：`agent-loop-testkit` + mock LLM adapter 驱动真 AgentLoop，`VirtualTerminal` 快照断言流式渲染序列

### Step 4 — `dsh-blue-interaction`：输入与交互缝（2 天）

- **input 插件**：pi-tui `Editor` 经 core 包一层薄适配暴露为 `BlueComponent`；submit 时：
  1. `parseCommand(line)` 命中 → `ctx.commands` dispatch（不进模型轮）
  2. 否则 `agent.followup(createUserMessage({ content: [{type:'text',text}], source:{kind:'user'} }))`
- **内置命令**：`/quit`（`ctx.get('appExit')(0)`）、`/resume <id>`（调 `agents.resume` 并广播给 transcript 重建）；`commands/change` 事件驱动 Editor 的 slash 补全刷新
- **UserQuestionProvider**：`registerProvider({ ask })` → 按 item 类型出 `SelectList`（有 options）或单行 `Input`（无 options）overlay；`multiSelect` MVP 用空格切换 + Enter 确认；`signal` aborted 时关闭 overlay 并 reject
- **approval answerer**：`ctx.on('approval/request', async (req, next) => …)`——三键弹窗（允许一次/拒绝）；`Esc` → `'cancelled'`；无法交互 → `next()` 下放
- 验收：REAL-composition 测试（临时 cordis.yml 过 Loader）断言 provider 注册/摘除；fake agent 触发 approval waterfall 断言 outcome 回传

### Step 5 — `dsh-blue-app` + bundle（1 天）

- `startup.ts`：inject `['cmdlineArgs']`，commander 声明 `[task]`、`--resume <id>`；action 里 `ctx.provide('blueStartup', { task?, resume? })`；`--help` 时不发布（树不启动，照抄 headless 语义）
- `index.ts`：inject `['blueStartup', 'agentDefaultModel', 'agents', 'sessions', 'blueScreen']`；
  1. `ctx.get('appExit')` 缺失即抛（照抄 headless 的防御）
  2. `await ctx.get('loader')?.await()`
  3. 有 `resume` → `agents.resume({ resumeSessionId })`；否则 `agents.create(...)`（model 用 `agentDefaultModel.currentSelection()`，照抄 headless 的 `installModelSelection` 路径）
  4. 有 `task` → 启动即 followup
  5. `installFailLoud('dsh', process, release)` 的 `release` 由 core 提供（恢复终端）
- `packages/bundle/blue/cordis.patch.yml`：照抄 headless 结构（`insert:` 四个 blue row + hmr 关闭 + system-prompt persona 覆盖）
- 验收：`loader-smoke` 子进程 E2E——`dsh --profile blue "task"` 冒烟（mock 或 replay LLM），断言退出码与终端恢复

### Step 6 — 测试与门禁收口（1-2 天）

- 逐包 100% 覆盖核查（`pnpm run test:coverage`）
- 每包 `./invariant` 入口（事件/数据关系断言或带理由的空 invariant）
- README 三件套 + 必备段落；doc-sync 相关门禁通过
- Agent Note 写入 `.agents/notes/`
- 关键回归用例清单：
  - resume 后历史完整渲染且新事件正确追加（快照→订阅顺序）
  - 审批拒绝/取消路径 agent 行为正确
  - 异常注入（渲染器抛错）后终端 raw mode 恢复
  - dispose fiber 后 userQuestions provider 被摘除（HMR 安全条款）

## 3. 里程碑与人力估算

| 步骤 | 交付 | 估算 |
|---|---|---|
| S1 骨架 | profile 可初始化 | 0.5 天 |
| S2 core | L1 签名定稿 + 单测 | 2-3 天 |
| S3 transcript | 流式渲染 + resume | 2-3 天 |
| S4 interaction | 输入/命令/审批/提问 | 2 天 |
| S5 app+bundle | `dsh --profile blue` 端到端 | 1 天 |
| S6 收口 | 门禁全绿 | 1-2 天 |
| **合计** | | **约 9-13 天**（单人，含门禁摩擦） |

S2 的 L1 签名评审是唯一阻塞后续所有步骤的关口，建议定稿前先写 S3/S4 各一个组件的消费侧伪代码做"签名试吃"，确认够用再冻结。

## 4. MVP 风险与对策（本文档特有，roadmap 风险登记之外）

| 风险 | 对策 |
|---|---|
| `session/event` 种类比预期多（merge 扩展事件如 `approval/asked`） | 折叠器 default 分支忽略未知类型，逐个事件类型显式处理 |
| `session/event` 与快照竞态（resume 完成瞬间有新事件） | 记录快照末尾 `session.seq`，订阅后丢弃 `seq <= snapshotEnd` 的事件 |
| userQuestions 单 provider 与 HMR 冲突 | 注册走 effect，dispose 自动摘除；S6 有专测 |
| `assistant/chunk` 增量 Markdown 渲染闪烁/错排版 | pi-tui `Markdown` 自带缓存；定稿事件（`assistant/message`）到达时整体重渲染一次校正 |
| app-boot 加 profile 行属上游共享文件改动 | 单行纯增量，单独 commit 并在 Agent Note 中说明 |
