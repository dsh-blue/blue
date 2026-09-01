# 会话模式

Blue 的交互强度分三档会话模式，编辑器焦点下按 **`Shift+Tab`** 循环切换：

**normal → plan → yolo**

非 normal 时，模式徽标显示在状态栏第一行（`plan` 为 accent 色，有排队消息时带省略号；`yolo` 为 warning 色）。这三档不是 Blue 自建状态：plan 来自 dsh 原生 `plan` projection，yolo 是原生 `danger-full-access` + `never` 权限预设的显示标签。

## normal

默认档。每次工具调用弹出四选项审批面板（允许一次 / 本会话允许 / 拒绝 / 拒绝并说明理由，见[审批与问卷浮层](/features/approval)）；用户提问照常弹出。

## plan —— 先规划，后动手

plan 模式下 agent 先产出计划再执行。计划定稿时，harness 的 `exit_plan_mode` 请求以**计划评审面板**呈现（编辑器槽位替换，同审批面板的挂载方式）：

- 计划全文以 Markdown 渲染在带边框的 `plan` 盒内；
- 下方是编号决策列表，数字键直选或 ←→ + `Enter`；↑↓ / PageUp / PageDown 只滚动计划正文：

| 选项 | 效果 |
| --- | --- |
| `1. Approve` | 批准计划，退出 plan 模式开始执行 |
| `2. Reject` | 拒绝——模型收到"用户选择继续规划"，在同一轮内回应 |
| `3. Revise <text>` | 内联修改：带上你的意见继续打磨计划 |

## yolo —— 完全访问

yolo 直接选择 dsh 的 `danger-full-access` 权限预设：关闭文件沙箱并使用 `never` 审批策略，四选项审批面板不再弹出。**用户提问仍然弹出**，因为权限策略不会替你回答问题。再次按 `Shift+Tab` 会选择 `workspace-write`；命令式写法分别是 `/permission danger-full-access` 与 `/permission workspace-write`。Blue 不注册额外的 `/yolo` 或 `/yes` 命令。

Shift+Tab 只编排原生命令：normal 执行 `/plan`；plan 先执行 `/plan off`，再选择 full-access 权限预设；yolo 选择 workspace-write 权限预设。若 plan 与 yolo 被其它命令同时打开，循环也会先关闭 plan，保持三档互斥。

::: tip 与 /preset 的关系
plan 模式的供给来自 harness 的 plan-mode 插件，经 agent 预设组合（`/preset`，见[斜杠命令参考](/reference/commands)）——预设决定一个会话"有哪些能力"，会话模式决定"这次交互问多细"。
:::
