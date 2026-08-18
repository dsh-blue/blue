# `@deepseek-ai/dsh-blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上；通过 `dsh --profile blue` 选用（模板为 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-blue']`）。patch 覆盖 `system-prompt` 的 persona、保持共享 HMR 行关闭，并插入十个 Blue 行，分两段。plain 基线段：`blue-core`（全树唯一的 pi-tui 适配：终端生命周期与 `blueScreen`/`blueKeymap`/`blueTerminalInfo`/`blueComponents` 服务）、`blue-theme-dark`（`blueTheme` provider——内置暗色调色板）、`blue-transcript`（会话事件渲染、`blueStatus` 注册表与 footer 壳）、`blue-status-basic`（基线 `{model} · {status}` footer 条目）、`blue-interaction`（输入编辑器、`/quit` `/resume` `/theme`、用户提问、审批）、`blue-startup`（`@deepseek-ai/dsh-blue-app/startup`，解析 `[task]` 与 `--resume <id>`）、`blue-app`（Agent 驱动，通过惰性 `!!js ctx.blueStartup.*` 配置插值读取启动值）。增强段：`blue-editor-plus`（共享编辑器之上的 `!` bash 模式（带 shell 回显）与 slash/`@` 补全）、`blue-status-git`（git 分支 footer 条目）、`blue-status-context`（上下文占用 footer 条目）。

## 模型体验

间接影响，通过被插入的行：本组合包只是 patch 列表的载体，除 patch 中引用的 persona 覆盖外，自身不贡献任何模型可见文本。

#### KV Cache 影响

persona 覆盖是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖（`tests/e2e.spec.ts`，15 个用例：启动、任务执行、输入路由、审批 overlay、编辑器键语义、resume、`/theme` 调色板换装（含草稿保留与转录重渲染）、卸载），使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal——仅模型与进程终端被替换。
