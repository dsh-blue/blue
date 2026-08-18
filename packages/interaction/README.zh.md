# `@deepseek-ai/dsh-blue-interaction`

[English](README.md) | 中文

Blue 终端 UI 交互层，构建于 [`dsh-blue-core`](../../blue/core/README.md) 之上：带斜杠命令分发的底部输入编辑器、内置 `/quit` 与 `/resume` 命令、`ctx.userQuestions` 的 overlay 提供方，以及 `approval/request` 的交互式应答方。本包不 import pi-tui：主编辑器是 `ctx.blueComponents.createEditor` 背后的 pi-tui Editor（多行、历史、kill-ring、undo 与粘贴标记内置），单选列表来自 `ctx.blueComponents.createSelectList`，`BlueSelect` 仅留存为包内多选专用列表（pi-tui 无多选组件）。`BluePanel` 是本包唯一的公开组件导出；overlay 键位经 `ctx.blueKeymap` 解析，样式经 `ctx.blueTheme` 着色。

## 插件

单一入口插件 `blue-interaction` 挂载五个子插件；所有注册均经 effect 绑定，因此卸载 fiber 会摘除全部贡献（HMR 安全：provider/命令/键位注册随 fiber 消失）。

- **`blue-interaction-keys`** —— 在 `ctx.blueKeymap` 上作为一个校验单元注册共享键位批次（`blue.interaction.submit/cancel/move-up/move-down/toggle`），另加两个编辑器语境动作 `blue.interaction.interrupt`（Ctrl-C）与 `blue.interaction.steer`（Ctrl-S）。后两者不带 handler——保持语境属性，由主编辑器的 `onKey` 钩子解析，绝不进全局分发器，因此不会与 overlay 的 `escape=cancel` 抢键。多选列表 `BlueSelect` 针对这些 action 解析键位并用 `getKeys` 生成底部提示；文本编辑键位归 pi-tui Editor 自身所有。
- **`blue-input`** —— 挂载聚焦的底部编辑器：来自 `ctx.blueComponents.createEditor` 的 pi-tui Editor，muted 的 hint 行拆为独立的 `HintLine` 组件钉在其下方。提交时用 `parseCommand` 解析该行：斜杠命令经 `ctx.commands.execute` 分发（不进入模型轮；成功/错误文本在 hint 行闪现），其余内容作为 `createUserMessage({ source: { kind: 'user' } })` follow-up 提交给当前 agent——agent 运行中时由 harness inbox 排队。`onSubmit` 回调参数携带的已是粘贴展开、trim 后的文本。以 `/` 开头的输入会从 `ctx.commands.list` 显示最多三条匹配命令作为发现提示。挂载的编辑器与其提交路由经包内共享 ref 发布，供 `blue-editor-plus` 在同一组件上叠加输入模式与补全。编辑器的 `onKey` 前置拦截钩子解析编辑器语境键链：Escape 先放行正在显示的补全弹层，其次清空草稿，最后中断运行中的 agent；Ctrl-C 先清草稿，再中断运行中的 agent，1 秒内第二次按下经启动器持有的 `appExit(0)` 退出（单击时在 hint 行闪现双击提示）；Ctrl-S 把非空草稿 steer 注入当前 turn 并清空 buffer。
- **`blue-commands`** —— 注册 `/quit`（经启动器持有的 `ctx.appExit` 请求退出；启动器未提供时返回错误结果）与 `/resume <session-id>`（emit `blue/request-resume`；真正的 resume 由 app 层执行）。
- **`blue-questions`** —— 注册唯一的 `ctx.userQuestions` provider。每个问题打开一个模态 overlay：带 options 时是选择列表（multiSelect 模式下 Space 切换、Enter 确认），否则是单行输入（文本成为答案的 `custom`）。Escape 以 `ASK_DISMISSED` 拒绝；请求 signal 中止时关闭 overlay 并以 `ASK_ABORTED` 拒绝。
- **`blue-approval`** —— 为当前挂载到 UI 的 agent 应答 `approval/request` waterfall：模态的 Allow once / Reject overlay（`'allowed-once'` / `'rejected'`；Escape 或 signal 中止得到 `'cancelled'`）。其它 agent 的请求、或会话挂载前到达的请求，用 `next()` 下放——不调 `next()` 即短路 waterfall。

**`./editor-plus`** 子路径插件（`blue-editor-plus`）是共享编辑器之上的可选增强层：入口插件不挂载它——由宿主 patch 加行选用。它经 `'blue/input-editor-changed'` 事件附着与重附着，保留 `blue-input` 已装的 handler。

- **`!` bash 模式** —— buffer 恰为 `!` 时切入 bash 模式且 `!` 不进 buffer；边框切换为 `colors.shellMode`（唯一的模式提示——pi-tui Editor 没有 prompt 符号载体），每次 bash 提交先自动退回 prompt 模式。命令经本包自建的 `child_process` 执行器运行（合并输出上限 200 行 + 64KB），以 `ShellEchoComponent` 回显进 scroll 区——刻意不进 session transcript。
- **分发式补全** —— 单个 `BlueAutocompleteProvider` 同时服务 slash 命令补全（对 `ctx.commands.list` 前缀匹配）与 `@` 文件补全（fd 优先、fs 扫描回退、上限 200 条），经 `BlueEditor.setAutocompleteProvider` 安装。
- **共用历史** —— prompt 与 bash 提交共用 pi-tui Editor 的内部历史；组件不暴露按模式过滤。

## `blueSession` 契约

当前 agent 通过 `ctx.get('blueSession')` 读取（绝不用 `inject`），因为 app 插件可能晚于本包激活。`BlueSessionRef` 与 `blue/request-resume` 事件由 `@deepseek-ai/dsh-blue-app` 拥有并声明；本包经 type-only import 消费。

## 模型体验

无直接影响，因为交互层面向用户渲染提示与 overlay；在此收集的答案若产生模型可见影响，由审批与提问 seam 拥有。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **bash 模式仅有边框色提示** —— pi-tui Editor 没有 prompt 符号载体，bash 模式只能通过 `colors.shellMode` 边框色体现。
- **无按模式历史过滤** —— prompt 与 bash 提交共用 pi-tui Editor 的内部历史；组件不暴露按模式过滤。
- **补全范围** —— 补全覆盖 slash 命令名与 `@` 文件路径；参数补全暂缓。
