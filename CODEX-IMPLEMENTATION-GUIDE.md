# Blue 新前端架构 Codex 实施指南

本文用于指导 Codex 在 `p2/frontend-runtime` 分支上实施 Blue 新前端架构。它是操作手册，不替代仓库中的设计文档和 `AGENTS.md`。

## 1. 开发目标

最终目标是把 Blue 演进为符合 Cordis“一切皆插件”设计哲学的 frontend runtime：

```text
Harness domain/plugins -> Blue frontend runtime -> renderer adapter
```

Harness 继续拥有 Agent、Session、工具执行、模型请求等后端 domain 能力。Blue 提供 renderer-neutral 的 projection、action、command、panel、status、dock、notification 和 provider host；TUI 只是其中一个 renderer。只有 `packages/core` 可以接触 pi-tui、ANSI、raw terminal 和 terminal width。

最终系统必须支持：

- provider 的运行时卸载、替换和 plain fallback；
- session binding、projection registry、action coordinator 和 late-result 防护；
- `dsh-context` 的完整垂直切片；
- `dsh-remote` 的 session/proxy adapter；
- 官方 surface 的逐项迁移；
- 外部插件的开发、迁移、fixture 和验证流程；
- master 的必要 bugfix/Harness bump 能以 additive 方式吸收。

## 2. 开始前的准备

### 分支和 worktree

目标分支：`p2/frontend-runtime`

分支地址：<https://github.com/dsh-blue/blue/tree/p2/frontend-runtime>

本地建议创建专用 worktree：

```sh
git fetch origin
git worktree add ../blue-frontend-runtime-agent origin/p2/frontend-runtime
cd ../blue-frontend-runtime-agent
```

不要在 production `blue` profile 中做 link 安装。开发 profile 使用独立 tag，例如：

```sh
PROFILE=blue-frontend-runtime script/install-dev.sh
```

### Codex 必须先阅读的文件

```text
AGENTS.md
docs/blue-frontend-architecture.md
docs/blue-session-runtime.md
docs/blue-interaction-model.md
docs/blue-plugin-ecosystem.md
docs/blue-compatibility-and-rollout.md
docs/blue-fixture-audit.md
docs/history/blue-skills-plan.md
docs/blue-implementation-plan.md
```

若 Codex 无法访问这些文件，应先停止并报告，不得根据猜测开始编码。

## 3. Goal 初始化提示词

将下面内容作为 Goal 的总目标。总目标用于保持方向，不代表一次性实现全部代码。

```text
在分支 p2/frontend-runtime 上，将 Blue 重构为符合 Cordis“一切皆插件”设计哲学的可扩展 frontend runtime。

最终必须满足：
- Harness 拥有 Agent、Session 和 domain 能力；
- Blue 提供 renderer-neutral frontend runtime；
- TUI 是 renderer adapter，只有 core 接触 pi-tui 和终端状态；
- Domain、Frontend Runtime、Renderer、Composition 分层；
- provider 支持 capture -> abort -> dispose -> activate -> restore；
- compatibility adapter 独立、窄化、按能力拆分并可删除；
- frontend model 不依赖 pi-tui、React、DOM、ANSI、terminal width 或 renderer-specific state；
- dsh-context 和 dsh-remote 有完整迁移 fixture；
- 官方 surface 按阶段迁移，旧实现仅在新实现验收后删除；
- 外部插件可以开发、迁移、测试和热插拔；
- 所有新功能遵循 adapter + feature plugin + fixture + renderer consumer 的接入方式。

必须遵守仓库 AGENTS.md、docs/blue-implementation-plan.md 及其引用文档。
必须按 F0-F6 分阶段完成。每阶段独立提交、独立测试、独立报告。
未经人工验收不得合并 master。
```

## 4. 第一次任务：只调查，不改代码

```text
请检查当前分支、工作区、最近提交和现有包结构。

完整阅读 AGENTS.md，以及 docs/blue-frontend-architecture.md、
docs/blue-session-runtime.md、docs/blue-interaction-model.md、
docs/blue-plugin-ecosystem.md、docs/blue-compatibility-and-rollout.md、
docs/blue-fixture-audit.md、docs/history/blue-skills-plan.md、
docs/blue-implementation-plan.md。

本轮只做调查，不修改文件。请输出：
1. 当前代码与目标架构的差距；
2. F0/F1 需要新增或调整的包和服务；
3. 可能阻碍新架构的现有耦合；
4. 本阶段明确不做的内容；
5. 文件级实施计划；
6. 测试、fixture、unload 和 dogfood 计划。

输出后停止，等待确认。
```

## 5. 分阶段实施提示词

### F0：边界和契约

```text
现在只执行 F0：分支基线与契约冻结。

建立最小 frontend runtime/adapter 的包边界、Cordis plugin 入口、Fiber ownership、
capability absent、unload、provider swap 和 plain fallback fixture。

不要迁移 transcript、interaction、editor、dsh-context 或 dsh-remote。
不要修改现有 UI 行为。
完成后运行相关测试并提交一个独立 commit，然后停止。
```

### F1：最小 frontend runtime

```text
现在只执行 F1：最小 frontend runtime。

实现 renderer-neutral 的 Text/Fields/Sections/List/Code/Diff view、CommandModel、
PanelModel、StatusModel、DockModel、NotificationModel 和 provider host。

model 只能包含 readonly 数据和结构化 action，不得包含 pi-tui、React、DOM、ANSI、
terminal width、focus handle、renderer-specific key binding 或 Promise。

必须覆盖 provider capture -> abort -> dispose -> activate -> restore、unload、swap、
失败回退和 late-result rejection。不要进入 F2，完成后停止等待验收。
```

### F2：Harness compatibility adapter

```text
现在只执行 F2：Harness compatibility adapter。

按 session、projection、action、model、question/approval bridge 拆分 adapter。
所有 Harness 版本差异和 capability probing 集中在 adapter 内，不得泄漏到 frontend
runtime 或 renderer。

验证 attach watermark、增量订阅、abort、queue、session/request epoch、stale rejection、
unload 和缺失能力 fallback。不要迁移完整 UI。
```

### F3：dsh-context 垂直切片

```text
现在只执行 F3：dsh-context 第一条完整垂直切片。

链路必须是：
dsh-context domain -> context projection -> context action/command -> interaction model -> TUI renderer。

交付 replay/resume、/context、panel/status、headless fixture、snapshot、unload、width-scan
和真实 profile smoke。数据语义应与 Harness/Web consumer 一致，但 Blue 不实现 Web。
```

### F4-F6

F4-F6 继续严格按照 `docs/blue-implementation-plan.md` 的顺序执行。每次只启动一个阶段，不要让 Codex 自行跨阶段迁移多个 surface。

## 6. 每阶段完成提示词

```text
请按以下格式报告本阶段，不要省略未完成项目：

1. 阶段目标；
2. 修改的文件和包；
3. 新增的 Cordis services/events/plugins；
4. 已实现的架构契约；
5. 测试命令及完整结果；
6. 未覆盖的测试和已知风险；
7. 与 master 的差异；
8. dogfood 命令和人工检查场景；
9. commit hash；
10. 下一阶段的前置条件。

如果某项没有完成，明确写“未完成”，不要使用“基本完成”。完成本阶段后停止，不要自动进入下一阶段。
```

## 7. 独立代码审查提示词

阶段实现后另起一次审查，不要让实现 Agent 自己宣布完成：

```text
请只做代码审查，不修改文件。

重点检查：
- 依赖方向是否违反 Harness domain -> Blue runtime -> renderer；
- 是否有非 core 包接触 pi-tui、ANSI 或 raw terminal；
- renderer-neutral model 是否混入 renderer 状态；
- Cordis Fiber unload 是否清理所有订阅、timer、注册和异步任务；
- provider swap 是否严格执行 capture -> abort -> dispose -> activate -> restore；
- 是否存在重复的 Agent/Session 真相；
- 是否存在 late event、stale result 或 session switch 竞态；
- capability 缺失是否返回 absent/plain fallback；
- fixture、width-scan、bundle 和 coverage 是否充分；
- 是否意外破坏旧 UI 行为。

按严重性列出问题，并给出文件和行号。没有问题时列出剩余风险和测试空白。
```

## 8. 测试和 dogfood 门禁

阶段代码完成后，要求 Codex 依次运行：

```sh
pnpm run test
pnpm run test:coverage
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run smoke:happy
```

然后在独立 profile 中运行：

```sh
PROFILE=blue-frontend-runtime script/install-dev.sh
dsh --profile blue-frontend-runtime
```

Codex 不能代替你的 live acceptance。你需要亲自检查启动、退出、provider 切换、session 切换、窄终端、CJK 文本、fallback、卸载后的晚到事件和旧功能回归。

只有在你明确回复“验收通过”后，才允许进入合并步骤。

## 9. 主线同步和合并

每个阶段完成或 Harness line bump 后再同步 master：

```text
请检查 origin/master 的新提交。

只吸收必要 bugfix、Harness bump 和基础设施修复。
不要直接移植 master 上旧架构 UI；新功能必须按 adapter + feature plugin + fixture 重新接入。
先报告冲突和处理方案，不要自动解决不确定的架构冲突。
```

合并前必须确认：

- 当前 Harness line 和上一兼容 line 的 fixture 均通过；
- 完整测试门禁通过；
- 真实 profile 已验收；
- compatibility seam 有删除条件；
- 未迁移 surface 没有被误标为已完成；
- 你已经明确回复验收通过。

合并后必须在主 checkout 重新运行 `pnpm run build`，因为合并后的 `lib/` 可能是旧的。

## 10. 需要特别注意的事情

- 不要让 Codex 一次性实现 F0-F6。
- 不要把“测试通过”当作架构正确的证明。
- 不要为了兼容上游而建立过宽的 adapter。
- 不要在 frontend model 中放入 pi-tui、React 或终端细节。
- 不要让 module singleton 保存产品级可变状态。
- 不要把 renderer object 放进 domain 或 session service。
- 不要在 provider 切换时保留旧订阅或旧异步任务。
- 不要直接复制旧 transcript/editor 的实现到新 runtime。
- 不要在 production `blue` profile 中 link 开发分支。
- 不要删除旧实现、worktree 或 profile，直到人工验收和合并完成。
- 主线新增能力必须 additive 接入，不能把新架构重新绑回旧 runtime。
- 所有新增 package/subpath 都要同步 exports、files 和 tsdown entry。
- 所有新内容渲染组件都必须遵守 width contract，并加入对应 width-scan。

## 11. 推荐的日常循环

```text
阅读文档
  -> 选择一个阶段
  -> 先输出计划
  -> 实现一个垂直切片
  -> 补 fixture 和测试
  -> 运行完整门禁
  -> 建立独立 profile
  -> Codex 自审
  -> 你进行 live acceptance
  -> 独立 commit
  -> 必要时同步 master
  -> 进入下一阶段
```

如果 Codex 对架构边界、Harness API 形状或迁移策略不确定，应要求它停止、列出证据和选项，先讨论再继续编码。
