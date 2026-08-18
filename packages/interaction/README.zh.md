# `@deepseek-ai/dsh-blue-interaction`

[English](README.md) | 中文

Blue 终端 UI 交互层，构建于 [`dsh-blue-core`](../../blue/core/README.md) 之上：带斜杠命令分发的底部输入编辑器、内置 `/quit` 与 `/resume` 命令、`ctx.userQuestions` 的 overlay 提供方，以及 `approval/request` 的交互式应答方。本包不 import pi-tui；其组件（`BlueInput`、`BlueSelect`、`BluePanel`）是 L1 `BlueComponent`/`BlueFocusable` 契约的自包含实现，键位经 `ctx.blueKeymap` 解析，样式经 `ctx.blueTheme` 着色。

## 插件

单一入口插件 `blue-interaction` 挂载五个子插件；所有注册均经 effect 绑定，因此卸载 fiber 会摘除全部贡献（HMR 安全：provider/命令/键位注册随 fiber 消失）。

- **`blue-interaction-keys`** —— 在 `ctx.blueKeymap` 上作为一个校验单元注册共享键位批次（`blue.interaction.submit/cancel/cursor-left/cursor-right/delete-backward/move-up/move-down/toggle`）。所有交互组件针对这些 action 解析键位，并用 `getKeys` 生成底部提示。
- **`blue-input`** —— 挂载聚焦的底部编辑器。提交时用 `parseCommand` 解析该行：斜杠命令经 `ctx.commands.execute` 分发（不进入模型轮；成功/错误文本在 hint 行闪现），其余内容作为 `createUserMessage({ source: { kind: 'user' } })` follow-up 提交给当前 agent——agent 运行中时由 harness inbox 排队。以 `/` 开头的输入会从 `ctx.commands.list` 显示最多三条匹配命令作为发现提示。
- **`blue-commands`** —— 注册 `/quit`（经启动器持有的 `ctx.appExit` 请求退出；启动器未提供时返回错误结果）与 `/resume <session-id>`（emit `blue/request-resume`；真正的 resume 由 app 层执行）。
- **`blue-questions`** —— 注册唯一的 `ctx.userQuestions` provider。每个问题打开一个模态 overlay：带 options 时是选择列表（multiSelect 模式下 Space 切换、Enter 确认），否则是单行输入（文本成为答案的 `custom`）。Escape 以 `ASK_DISMISSED` 拒绝；请求 signal 中止时关闭 overlay 并以 `ASK_ABORTED` 拒绝。
- **`blue-approval`** —— 为当前挂载到 UI 的 agent 应答 `approval/request` waterfall：模态的 Allow once / Reject overlay（`'allowed-once'` / `'rejected'`；Escape 或 signal 中止得到 `'cancelled'`）。其它 agent 的请求、或会话挂载前到达的请求，用 `next()` 下放——不调 `next()` 即短路 waterfall。

## `blueSession` 契约

当前 agent 通过 `ctx.get('blueSession')` 读取（绝不用 `inject`），因为 app 插件可能晚于本包激活。`BlueSessionRef` 与 `blue/request-resume` 事件由 `@deepseek-ai/dsh-blue-app` 拥有并声明；本包经 type-only import 消费。

## 模型体验

无直接影响，因为交互层面向用户渲染提示与 overlay；在此收集的答案若产生模型可见影响，由审批与提问 seam 拥有。

#### KV Cache 影响

无；本包不向任何模型请求前缀添加内容。

## 已知限制与暂缓事项

- **MVP 编辑器** —— `BlueInput` 支持插入/退格/光标移动/提交与单 chunk 粘贴（bracketed paste）；kill-ring、撤销、按词移动与多行编辑暂缓。宽字符在宽度计算中按一列计。
- **仅斜杠提示** —— 输入对 `/` 前缀显示匹配命令提示；完整 autocomplete（选择弹窗、参数补全）暂缓。
- **无 Esc 取消 agent** —— Escape 关闭 overlay 但不会取消运行中的 agent；该绑定暂缓。
