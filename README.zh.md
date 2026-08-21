# Blue

[English](README.md) | 中文

Blue 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的一个交互式终端 UI（TUI）插件：以 out-of-tree [Cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) 插件 bundle 的形式、骑在 `dsh-base` bundle 之上的 `pi-tui` 渲染器。**尚未发布到 npm**——项目以五个 `@dsh-blue` scope 下的 workspace 包形式存在于本仓库，目前唯一的运行方式是本地开发安装（见[安装](#安装开发)）。

本仓库是这五个包的独立 home：它们从 `deepseek-harness` monorepo 抽出（原 `packages/blue/*` 与 `packages/bundle/blue`），现按 npm 上发布的 harness（`0.1.1-rc.1` 线）与 vendored Cordis 构建测试。

## 功能

- **流式会话记录** —— 用户/助手消息边流式边渲染 Markdown；工具调用渲染为卡片，默认 generic 呈现，diff（`intent-diff`）与终端输出（`intent-terminal`）有专属卡片。
- **输入编辑器** —— 圆角框编辑器：slash 命令模糊补全、参数幽灵提示、`!` bash 模式、`@` 文件补全、Ctrl-V 剪贴板贴图（`[image #N]` 标记在提交时拆为图像块）。
- **Overlay** —— 四选项审批面板（session 级"总是允许"继承）与 tab 化用户问卷 overlay。
- **两行状态栏** —— 模型名（priority 0）、会话模式徽标 `plan`/`yolo`（priority 2，normal 态隐藏）、git 分支（priority 10）、上下文占用 `ctx N`（priority 20）；条目是注册表贡献，不是写死的。Shift+Tab 循环会话模式 normal → plan → yolo（`/yolo` 自动放行工具审批，提问照常弹）。
- **底部 dock 面板** —— agent 运行中的活动 spinner、排队消息（空编辑器上键召回）、todo 列表（Ctrl-T 折叠开关）、fork 当前会话的 `/btw` 旁路问答面板。
- **Slash 命令** —— `/quit` `/new`（`/clear` 为其别名）`/fork` `/sessions`（`/resume` 为其别名）`/help` `/theme` `/btw` `/model` `/effort` `/provider` `/yolo` `/init` `/status` `/context` `/version` `/export` `/copy` `/tools` `/preset`，全部自动进入编辑器补全菜单。`/preset` 在薄宿主预设名册上切换 agent 组合（仅空会话）；`/tools` 列出当前会话的实时工具目录。
- **主题** —— `/theme` 热切换：`dark` / `light` / `auto`（OSC 11 背景探测）/ `custom`（JSON 调色板）。

## 设计哲学

**TUI 不是一个包，而是一棵 Cordis 插件树。** pi 自家的 coding agent 把它的 pi-tui UI 收成了一个 6.5k 行的 `InteractiveMode` 上帝类。Blue 的核心主张恰恰相反：

- **Everything is a plugin** —— 渲染组件、交互 provider、命令、状态栏条目都是独立插件，各有自己的 fiber 生命周期。
- **注册即 effect** —— 组件挂载、provider 注册、键位注册全部经 `ctx.effect`/`ctx.on` 绑定，插件卸载自动回滚；HMR 和会话切换是免费的。
- **能力缝三角色** —— 每项能力拆成 definition / provider / consumer。Blue 消费 harness 的缝（`agents`、`sessions`、`commands`、`userQuestions`、审批），也向下游开自己的缝（[docs/blue-seams.md](docs/blue-seams.md)）。
- **依赖推导加载** —— 插件 `inject` 所需服务，不齐就等待；provider 热替换时依赖方自动 unload/reload。
- **plain-first**（ADR D21）—— 每个非平凡表面 = 缝 + plain 默认实现。Blue 自家增强与下游插件经同一条缝注册；拔掉全部增强行的 bundle 仍能启动、可用。
- **全树唯一 pi-tui import** —— 只有 `packages/core` import `@earendil-works/pi-tui`。pi-tui 的破坏性变更传导不出 L0，任何契约都不出现 pi-tui 类型。

完整架构文档见 [docs/blue-architecture.md](docs/blue-architecture.md)；决策记录见 [docs/blue-decisions.md](docs/blue-decisions.md)。

## 分层架构

```
┌──────────────────────────────────────────────────────┐
│ L4  组合层：bundle/blue —— cordis.patch.yml            │  骑在 dsh-base 上
├──────────────────────────────────────────────────────┤
│ L3  渲染插件：transcript（折叠器 + 状态栏）            │  可热替换、可省略
├──────────────────────────────────────────────────────┤
│ L2  交互插件：input / commands / approval              │  实现 harness 交互缝
├──────────────────────────────────────────────────────┤
│ L1  内核服务：blueScreen · blueTheme · …               │  稳定核心（core 包）
├──────────────────────────────────────────────────────┤
│ L0  pi-tui 适配：终端生命周期 ↔ fiber 绑定             │  全树唯一 import pi-tui
├──────────────────────────────────────────────────────┤
│ dsh-base（agents / sessions / commands / …）           │
└──────────────────────────────────────────────────────┘
```

依赖严格单向：`core ← transcript / interaction ← app ← bundle`。

| 包 | 层 | 职责 |
| --- | --- | --- |
| [`@dsh-blue/blue-core`](packages/core) | L0 + L1 | 全树唯一 `@earendil-works/pi-tui` 适配器：终端生命周期 + `blueScreen` / `blueTheme` / `blueKeymap` / `blueComponents` / `blueTerminalInfo` 服务。 |
| [`@dsh-blue/blue-interaction`](packages/interaction) | L2 | 输入编辑器、slash 命令、审批与提问 overlay，以及增强子路径插件（bash 模式、贴图、附件）。 |
| [`@dsh-blue/blue-transcript`](packages/transcript) | L3 | 会话事件折叠为 transcript 项并渲染（流式 Markdown、工具卡片）、`blueStatus` 注册表与 footer 壳、dock 面板。 |
| [`@dsh-blue/blue-app`](packages/app) | L4 | 命令行启动（`[task]`、`--resume <id>`）与发布 `blueSession` 的 Agent 驱动。 |
| [`@dsh-blue/blue`](packages/bundle/blue) | L4 | 可安装 bundle：`cordis.patch.yml` 在 `dsh-base` 之上插入 Blue 插件行。 |

每个入口都是 Cordis 插件形态（`export const name`、可选 `inject`、`apply(ctx)`）；Cordis 与 dsh 服务包是 `peerDependencies`，由宿主 `dsh` 安装提供。

## 实例：Editor 缝

输入编辑器是走通这套哲学最清晰的一条路径。四个角色、四个位置，层间没有捷径：

**1. 契约（L1）。** `BlueEditor` 是 `packages/core/src/types.ts:437` 里的接口——刻意不含任何 pi-tui 类型、任何 harness 类型：

```ts
export interface BlueEditor extends BlueFocusable {
  onSubmit?: ((text: string) => void) | undefined
  onChange?: ((text: string) => void) | undefined
  onKey?: ((data: string) => boolean) | undefined   // 前置拦截钩子
  getText(): string
  setBorderColor(color: BlueColorFn): void
  setGhostHint(hint: string | undefined): void
  setAutocompleteProvider(provider: BlueAutocompleteProvider): void
  insertText(text: string): void                    // 光标处原子插入
  getExpandedText(): string                         // 粘贴标记展开，提交时使用
  // …
}
```

**2. 实现（L0）。** 获得编辑器的唯一入口是 `ctx.blueComponents.createEditor()`（`packages/core/src/types.ts:655`）。core 内部，`EditorAdapter`（`packages/core/src/components.ts:162`）包装 pi-tui `Editor`，每次 render 后经 chrome 辅助层后处理，画出圆角框、提示符与幽灵提示。适配器是唯一知道背后是 pi-tui 的代码；未来的 vim 模式编辑器可以实现同一接口，消费者毫无感知。

**3. 消费（L2）。** `blue-input` 插件（`packages/interaction/src/input-plugin.ts:169`）创建编辑器、把它挂为屏幕底部子组件（`input-plugin.ts:469`），并经共享编辑器缝（`editor-instance.ts`）发布——提交路由、增强在场标记，以及让后挂插件无论行序如何都能找到编辑器的 `blue/input-editor-changed` 事件。

**4. 增强（L2 子路径插件）。** `blue-editor-plus` 在共享编辑器上叠 `!` bash 模式与 slash/`@` 补全 provider；`blue-paste-image` 经 `onKey` 钩子拦截 Ctrl-V、用 `insertText` 插入 `[image #N]` 标记、提交时经提交变换器展开。两者都不碰 core——它们是 `cordis.patch.yml` 里的行，可以单独删掉，plain 编辑器照常工作。

契约在 L1、实现锁在 L0、增强经缝在 L2——这就是"凡表面皆插件"在实践中的含义。完整清单——Blue 开的每条缝、契约位置、plain 默认、每个视觉表面由哪个插件实现——见 [docs/blue-seams.md](docs/blue-seams.md)。

## 安装（开发）

目前唯一受支持的安装方式是针对本地 checkout 的开发安装。前置：Node `^22.19 || >=24`、pnpm 11、`dsh` CLI ≥ `0.1.1-rc.1`（`npm i -g @deepseek-ai/dsh`）。

### 一键

```sh
script/install-dev.sh
# 覆盖: DSH_BIN=/path/to/dsh PROFILE=my-profile DSH_HOME=/custom/home script/install-dev.sh
```

脚本构建 workspace 并把五个包全部 link 安装进 profile。

### 手动等价流程

```sh
pnpm install && pnpm run build   # lib/ 是每个包的运行时入口

# 一次性 profile 设置：
dsh plugin --profile blue add \
  link:/path/to/blue/packages/bundle/blue \
  link:/path/to/blue/packages/core \
  link:/path/to/blue/packages/interaction \
  link:/path/to/blue/packages/transcript \
  link:/path/to/blue/packages/app

dsh --profile blue [task]           # 跑一个任务，或进入交互
dsh --profile blue --resume <id>    # 恢复持久化会话
```

为什么要链五个包：四个库包是 bundle 的 `workspace:^` 依赖，出了本 workspace 解析不了。`dsh plugin` 原样转发给 profile 目录下的 pnpm，其 `link:` 协议把 checkout 本身装成符号链接；被链的 bundle 再经 profile 自己的 `node_modules` 链接解析兄弟包。四条非 bundle 链接是普通依赖——各有一条 `declares no dsh.bundle` 警告属预期（它们是库，不是层）。

如果你的 profile 是在包改名前（当时包名为 `@dsh-blue/blue*`）链的，那些链接已失效——删掉 profile 目录（`~/.dsh/profiles/<name>`）或 `dsh plugin --profile <name> remove` 旧条目，再重跑脚本。

### 迭代环

**edit src → `pnpm run build` → 重跑 `dsh --profile blue`**。链接指向包目录，重建的 `lib/` 无需重装即生效；只有依赖图变化（新增包或改 `dependencies`）才需要再跑 `dsh plugin --profile blue add`/`install`。

Headless 冒烟检查（经 `script(1)` 伪 TTY）：

```sh
(sleep 10; printf '/quit\r'; sleep 3) \
  | timeout 90 script -qec "dsh --profile blue" /tmp/blue-smoke.typescript
# 断言：启动时 bracketed-paste 开（\x1b[?2004h）、退出时关（\x1b[?2004l）、退出码 0。
```

## 开发

```sh
pnpm run test           # vitest：单元套件 + bundle 的全树 e2e
pnpm run test:coverage  # packages/*/src 逐文件 100% 覆盖率门禁
pnpm run build          # tsc -b 产 lib/types，tsdown 打包 lib/
pnpm run lint           # oxlint
pnpm run typecheck      # tsc -b
```

测试从源码跑：spec 经相对 `../src/*.ts` 路径 import 被测包，所有 `@deepseek-ai/*` 依赖从 `node_modules` 解析。

## 文档

- **文档站**：<https://dsh-blue.dev/>（中文）· <https://dsh-blue.dev/en/>（English）—— 面向用户的文档。下方设计文档仍仅在仓库内。

全部设计文档（中文）在 [docs/](docs/)：

- [docs/blue-seams.md](docs/blue-seams.md) —— 缝清单：Blue 开的每条缝（契约、plain 默认），以及 harness 侧每个视觉表面由哪个 Blue 插件实现。
- [docs/blue-architecture.md](docs/blue-architecture.md) —— 架构：哲学、L0–L4 分层、稳定性规则。
- [docs/blue-decisions.md](docs/blue-decisions.md) —— 决策记录（ADR）。
- [docs/README.md](docs/README.md) —— 文档索引（在用 / 历史存档）。各阶段设计与实施记录：[docs/blue-roadmap.md](docs/blue-roadmap.md)、[blue-commands-plan.md](docs/blue-commands-plan.md)（现行——内置命令实施清单：四家参照系合并、harness 能力矩阵、S23–S28 分期、上游缝请求），以及已归档的 [blue-p1-design.md](docs/history/blue-p1-design.md)、[blue-p2-visual-design.md](docs/history/blue-p2-visual-design.md)、[blue-mvp-plan.md](docs/history/blue-mvp-plan.md)。
- [AGENTS.md](AGENTS.md) 与各包自带的 `AGENTS.md` —— 当前代码的权威描述（仓库级约定在根文件；包级实现细节在 `packages/*/AGENTS.md`）。

## 与 deepseek-harness 的关系

- 运行时与测试依赖（`@deepseek-ai/cordis` 4.0.1、`@deepseek-ai/dsh-*` 0.1.1-rc.1、`@earendil-works/pi-tui` ^0.84.2）来自 npm registry；Blue 自身五包未发布，在本仓保持 workspace 链接。
- harness 仓库的门禁（文档 i18n 配对、README 门禁、snapshot/e2e 车道）不适用于本仓库；本仓保留构建、全量测试套件与逐文件 100% src 覆盖率门禁。
