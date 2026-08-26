# `@dsh-blue/blue`

[English](README.md) | 中文

dsh Blue 组合包：交互式终端 UI profile。[`cordis.patch.yml`](cordis.patch.yml) 直接叠加在 [`dsh-base`](https://github.com/deepseek-ai/deepseek-harness) 之上，共插入 28 条 Blue 自有行：2 条宿主支撑行，加上分为基线、增强、装配三段的 26 条产品行。projection-backed 的 `blue-conversation` 与 `blue-transcript-official` 已是自足基线的一部分；14 条增强行可逐项移除。`blue-context`、`blue-remote`、`blue-openpencil` 与 `blue-lark` 保持为 bundle 之外的 validation-only 包。

bundle 自己持有 Blue 的完整 Agent preset roster。标准、PTC 与极简模式跟随当前固定的 harness 版本；`cordis` / 创造模式携带认识 Blue 的 persona 与受能力约束的插件创作指导。无论通过 `blue` 还是直接 `dsh --profile` 启动，都会读取这份不可变的 bundle payload，不会改写宿主共享 preset。创造模式原型只能通过 `bluePluginHost` 增加 dock、status、command 与 notification 贡献，不能替换 Blue core 或 owner 功能 id。原型验收后，Agent 必须先询问用户是保留本地、创建 GitHub 仓库还是发布 npm 包。

## 模型体验

模型可见 persona 由当前 preset 提供。创造模式会明确说明自己运行在 Blue 中，并约束为“先做会话内原型、持久化前先询问”。

#### KV Cache 影响

fallback persona 是静态前缀；各插入行的前缀影响由所属包各自承担。

## 已知限制与暂缓事项

- **无已知的组合包级限制**——组合后的 profile 由全树 e2e 端到端覆盖（`tests/e2e.spec.ts`，72 个用例：启动、任务执行、输入路由、审批 overlay（含 session 级放行记忆）、tab 化问卷、编辑器键语义、resume、`/theme` 调色板换装（含草稿保留与转录重渲染）、四个 dock pane、`/help`、`/sessions` + `/new` + `/fork`、`/btw`、diff 卡、terminal 卡（含 exit 徽章）、图片粘贴以图片块传递、step-summary 渲染、S23 模型族——picker 元数据与段控件草稿、session-only 与持久默认、resume 的 header 层、`/provider` 列表/切换、以及走真 settings/credentials/pi-ai 栈与 fixture 发现端点的 Add Provider 向导、卸载），使用脚本化 mock LLM adapter 与 core 的录制型 FakeTerminal——仅模型与进程终端被替换。
