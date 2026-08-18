# 调研：deepseek-harness 架构与 Blue 的挂载点

> 调研对象：deepseek-harness 仓库（`0.1.0-rc.7` 开发预览版）。本文是 Blue 分层设计和插件写法的依据存档。
> 服务与 API 参考：<https://deepseek-harness.github.io/deepseek-harness/reference/>

## 1. Cordis 内核

Cordis（上游 cordiverse/cordis，harness vendored 并 rescope 为 `@deepseek-ai/cordis`）同时是**依赖注入容器 + 服务定位器 + 事件总线 + 生命周期管理器**：

- **插件是对象**：named-export `name` / `inject` / `apply(ctx)`（函数插件），或 Service 子类（构造即注册 `ctx` 键，随 fiber 摘除）。两种形态混用会被 Loader 丢弃。
- **inject 声明依赖**：服务不齐就等待，加载顺序由依赖推导；依赖消失 → 插件自动 unload，回来 → 自动 reload（provider 热替换是常态）。
- **类型化事件**：`parallel` / `emit` / `serial` / `bail` / `waterfall` 五种派发模式，TS declaration merging 声明。
- **注册即可逆 effect**：`ctx.on` / `ctx.effect` / registry `register()` 全部随 fiber 卸载回滚；支持 HMR。
- **Fiber 生命周期**：PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED。

## 2. 服务分层（Blue 消费的面）

| 服务 | ctx key | Blue 用途 |
|---|---|---|
| 会话日志 | `ctx.sessions` | 渲染数据源：`session/event` 广播 + `session.events` 快照 + fork/resume |
| Agent 注册表 | `ctx.agents` | `create`/`resume`/`get`/`list`；Agent handle：`followup/steer/inject/cancel/whenIdle/session/status` |
| 人类命令 | `ctx.commands` | slash 命令注册缝（`register(definition): disposer`；`parseCommand(line)`） |
| 审批 | `approval/request` waterfall | Blue 提供 human answerer（不调 `next()` 即短路；outcome 封闭联合，fail-closed） |
| 用户提问 | `ctx.userQuestions` | 唯一活跃 `registerProvider({ask})`，effect 绑定 |
| 权限预设 | `ctx.permissionPresets` | 下游注册 preset，UI 消费方自动列出 |
| 会话投影 | `ctx.sessionProjections` | todos、标题等派生状态 |
| 启动交接 | `cmdlineArgs` / `appExit` | startup provider 用 `parseCmdline` 解析 flag 后 `ctx.provide`；`appExit` 用 `ctx.get` 读取 |

事件分三个域：**session events**（持久事实，fire-and-forget，监听器异常被容忍）、**agent events**（`agent/*`，scope-filtered）、**capability events**（`tools/*` 等 waterfall 拦截点）。

## 3. 关键语义（已核实，影响 Blue 实现）

- **seed 不重播**：resume 加载的历史事件不重新广播 `session/event`——渲染历史必须读 `session.events` 快照，再订阅增量（→ 决策 D16）。
- **SessionEvent 判别联合**：`switch (event.type)` 直接 narrow `event.data`；`SessionEventMap` 可被其他包 merge 扩展（渲染器必须 default 忽略未知类型）。
- **`tool/result.meta`**：工具自带的呈现载荷（render intent），UI 消费它而非自己猜格式。
- **boot 胶水**：`boot()` / `installFailLoud(binName, proc, release)`——release 专为 terminal-owning surface 设计（恢复终端 raw mode，2s 超时）；profile 启动器已内置安装，dispose 整树即触发各插件 effect 清理。
- **建 agent 前 `await ctx.get('loader')?.await()`**：等整棵树 settle，避免半组合状态。

## 4. UI 挂载路线评估（决策 D1 的依据)

| 路线 | 结论 |
|---|---|
| (a) 同进程 bundle + app 插件 | **采用**。架构文档原生定义；profile/bundle 机制为此设计 |
| (b) SDK（stdio JSON-RPC 子进程） | 否决。无 mid-turn cancel、无审批回传（Known Limitations），"无人值守"定位 |
| (c) ACP | 否决。automation-only |

## 5. profile / bundle 组合机制

- 运行中的 dsh 是 boot 时按层组合的插件树：**profile**（`$DSH_HOME/profiles/<name>`）→ **bundle**（`dsh.bundle` manifest 指向 cordis patch 文件）→ 层序：bundles → profile patch → home patch → `--patch` overlay。
- patch 语法：`- id:` + `config:` 覆盖既有 row；`- insert:` 新增 row；`!!js ctx.<service>.<field>` 惰性配置插值（配合 `inject:` 等待服务就绪）。
- startup provider 模式：commander program 声明 flag → `parseCmdline(ctx, program)` → action 里 `ctx.provide(name, values)`；`--help`/解析错误不发布，依赖 row 永不激活（不启动）。
- **out-of-tree 插件路径**：`dsh plugin --profile <name> add <spec>`（纯 pnpm 转发器，npm/git/tarball/link: 均可）；无名 profile 用 DEFAULT_PROFILE_BUNDLES（`dsh-base`）初始化；安装后按 `dsh.bundle` 声明对账加层。profile 用 hoisted linker，blue 开发用 link:（→ 决策 D11）。
- 模板：`packages/bundle/headless/`（startup provider + 主插件 + cordis.patch.yml 的最小完整范例）。

## 6. 稳定性约束

- 开发者预览，明示有破坏性变更；无 semver 承诺。"stable API"的实际形态是**文档化扩展点体系**（cordis-surface 目录 + SessionEventMap merge 规则 + 能力缝三角色契约）；包内部实现是 package-internal，不依赖。
- 持久格式无兼容承诺（SESSION_FORMAT_VERSION 钉 0）。
- **Blue 的对策**：只依赖文档化 surface；钉 `@deepseek-ai/*` 版本；升级时全量测试即兼容性验收。

## 7. 历史背景

harness 曾有官方 TUI（`packages/ui/tui`，基于 pi-tui），2026-08-04 因"无真实部署消费者"删除；删除笔记留下重引入条件：具名产品/部署 + 明确包边界 + 具体交互 provider + 组装级生命周期与 transcript 验收。Blue 的独立仓库形态、包边界、provider 实现和 E2E/冒烟验收逐条对应这些条件。
