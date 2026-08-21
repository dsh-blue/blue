# 会话模式

Blue 的交互强度分三档会话模式，编辑器焦点下按 **`Shift+Tab`** 循环切换：

**normal → plan → yolo**

非 normal 时，模式徽标显示在状态栏第一行（`plan` 为 accent 色，有排队消息时带省略号；`yolo` 为 warning 色）。`/yolo [on|off]`（别名 `/yes`）是 yolo 档的命令式开关，效果与循环切换一致。

## normal

默认档。每次工具调用弹出四选项审批面板（允许一次 / 本会话允许 / 拒绝 / 拒绝并说明理由，见[审批与问卷浮层](/features/approval)）；用户提问照常弹出。

## plan —— 先规划，后动手

plan 模式下 agent 先产出计划再执行。计划定稿时，harness 的 `exit_plan_mode` 请求以**计划评审面板**呈现（编辑器槽位替换，同审批面板的挂载方式）：

- 计划全文以 Markdown 渲染在带边框的 `plan` 盒内；
- 下方是编号决策列表，数字键直选或 ↑↓ + `Enter`：

| 选项 | 效果 |
| --- | --- |
| `1. Approve` | 批准计划，退出 plan 模式开始执行 |
| `2. Reject` | 拒绝——模型收到"用户选择继续规划"，在同一轮内回应 |
| `3. Revise <text>` | 内联修改：带上你的意见继续打磨计划 |

## yolo —— 自动放行

yolo 自动放行工具审批——四选项面板不再弹出，agent 全速执行。**用户提问仍然弹出**：yolo 放行的是工具授权，不替你回答问题。`/yolo`、`/yes` 或再按 `Shift+Tab` 随时切回。

::: tip 与 /preset 的关系
plan 模式的供给来自 harness 的 plan-mode 插件，经 agent 预设组合（`/preset`，见[斜杠命令参考](/reference/commands)）——预设决定一个会话"有哪些能力"，会话模式决定"这次交互问多细"。
:::
