# `@dsh-blue/blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](../base/README.md) 之上；通过 `dsh --profile blue` 选用（模板为 `['@deepseek-ai/dsh-base', '@dsh-blue/blue']`）。patch 覆盖 `system-prompt` 的 persona、保持共享 HMR 行关闭，并插入十八个 Blue 行，分三段。基线段：`blue-core`（全树唯一的 pi-tui 适配：终端生命周期与 `blueScreen`/`blueKeymap`/`blueTerminalInfo`/`blueComponents` 服务）、`blue-theme-dark`（`blueTheme` provider——内置暗色调色板）、`blue-transcript`（会话事件渲染、`blueStatus` 注册表与 footer 壳）、`blue-status-basic`（基线 `{model} · {status}` footer 条目）。增强段：`blue-editor-plus`（共享编辑器之上的 `!` bash 模式（带 shell 回显）与 slash/`@` 补全）、`blue-attachments`（harness 附件存储——魔数嗅探、媒体类型白名单与上限，文件落 `DSH_BLUE_ATTACHMENT_DIR ?? $DSH_HOME/attachments ?? ~/.dsh/attachments`）、`blue-paste-image`（ctrl+v 剪贴板图片粘贴：经附件存储落盘并插入 `[image #N]` 标记，提交变换器拆成图片块；该行的 `inject: [attachments]` 钉住它在 `blue-attachments` 之后激活）、`blue-status-git`（git 分支 footer 条目）、`blue-status-context`（上下文占用 footer 条目）、`blue-intent-diff`（`'diff'` render intent——可折叠/展开的 diff 卡，inject `blueIntents`）、`blue-intent-terminal`（`'terminal'` render intent——命令/输出卡带 exit 徽章，inject `blueIntents`）、`blue-pane-activity`（挂载 agent 运行时的单行 spinner）、`blue-pane-queue`（agent inbox 排队消息，外加空编辑器 ↑ 召回的无键门控动作）、`blue-pane-todo`（会话 todo 列表，带全局 Ctrl-T 折叠切换）、`blue-pane-btw`（`/btw` 旁路面板：把当前会话 fork 成一次性旁路 agent 并渲染问答）。装配段收尾 plain 基线：`blue-interaction`（输入编辑器、`/quit` `/resume` `/new` `/fork` `/sessions` `/help` `/theme`、用户提问——S24b 起含 plan-review 专用呈现——与审批，另加基于 base 组合权限服务的裸 `/permission` 预设选择器）、`blue-startup`（`@dsh-blue/blue-app/startup`，解析 `[task]` 与 `--resume <id>`）、`blue-app`（Agent 驱动，通过惰性 `!!js ctx.blueStartup.*` 配置插值读取启动值）。plain 基线 = 基线段 + 装配段——整个增强段可以拔除而不破坏基线。底部 pane 经 `blueScreen.addBottomChild` 挂载，而 loader 并发挂载同组行，因此 dock 顺序由 `blueComponents` 激活轮钉住、而非行序本身：两个较轻的 pane 带行级 `inject: [blueComponents]` 钉入与 transcript 行同一轮（绝不能指 `blueStatus`——`/theme` 换装会在途中 dispose 自己 handler 所在的 fiber），从而保持 footer → panes → editor 的 bottom 序。

## 模型体验

间接影响，通过被插入的行：本组合包只是 patch 列表的载体，除 patch 中引用的 persona 覆盖外，自身不贡献任何模型可见文本。

#### KV Cache 影响

persona 覆盖是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖（`tests/e2e.spec.ts`，72 个用例：启动、任务执行、输入路由、审批 overlay（含 session 级放行记忆）、tab 化问卷、编辑器键语义、resume、`/theme` 调色板换装（含草稿保留与转录重渲染）、四个 dock pane、`/help`、`/sessions` + `/new` + `/fork`、`/btw`、diff 卡、terminal 卡（含 exit 徽章）、图片粘贴以图片块传递、step-summary 渲染、S23 模型族——picker 元数据与段控件草稿、session-only 与持久默认、resume 的 header 层、`/provider` 列表/切换、以及走真 settings/credentials/pi-ai 栈与 fixture 发现端点的 Add Provider 向导、卸载），使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal——仅模型与进程终端被替换。
