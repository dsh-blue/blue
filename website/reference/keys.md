# 键位参考

键位经 `blueKeymap` 服务注册，重复绑定会被拒绝；`/help` 浮层实时列出当前注册的全部键位（这就是本表的权威来源——若与本文有出入，以 `/help` 为准）。

## 全局动作

任意焦点下生效：

| 键 | 动作 | 说明 |
| --- | --- | --- |
| `Ctrl-O` | 切换工具输出展开 | 在最近 **3 个 turn** 的工具卡与思考块的一行摘要与完整输出之间切换 |
| `Ctrl-T` | 切换 todo 面板折叠 | 五行折叠视图 ↔ 整表视图 |
| `F6` / `Shift+F6` | 切换 surface 焦点 | 按布局顺序在 Editor 与 pane lane 间前进/后退；到边界回到 Editor，capturing overlay 打开时由 overlay 独占焦点 |

## 共享交互键位

聚焦 surface 使用分层导航：外层 tabs → 内层 tabs → 内容控件组 → 编辑态。底部上下文提示只在该 surface 聚焦时显示，并会随当前层、编辑、调整和确认状态变化：

| 键 | 动作 | 说明 |
| --- | --- | --- |
| `←` / `→` | 水平层内导航 | 在 tabs、actions 与 select 调整态内移动，到边界不循环 |
| `Enter` | 下钻 / 提交 / 确认 | 在 tab 条进入下一层；激活列表、action 或输入确认 |
| `Tab` / `Shift-Tab` | 切换内容组 | 只在内容层循环 list/form/actions 等语义组并记忆组内焦点；在 tab 条上无动作 |
| `Escape` | 返回 / 取消 / 关闭 | 编辑态 → 内容 → 内层 tabs → 外层 tabs → 关闭，每次只退一层；回到 Editor 后仍沿用补全、撤回与中断链 |
| `↑` / `↓` | 垂直层内导航 | list 与 form 导航态，到边界不循环；disabled 行会跳过 |
| `Space` | 多选切换 | 多选列表中切换聚焦项，`Enter` 确认整组 |

## 编辑器语境

文本编辑键（光标移动、多行、undo、kill-ring）归底层编辑器所有；此外：

| 键 | 动作 | 说明 |
| --- | --- | --- |
| `Ctrl-C` | 清空 → 中断 → 退出 | 先清草稿，再中断运行中的 agent；**1 秒内第二次按下**退出 Blue |
| `Ctrl-S` | steer 注入 | 把非空草稿作为转向指令注入当前 turn，并清空 buffer |
| `Ctrl-V` | 粘贴图片 | 剪贴板图片入附件库，光标处插入 `[image #N]` 标记 |
| `Ctrl-G` | 外部编辑器 | 草稿交给外部编辑器全屏编辑（`blue.editorCommand` 设置 → `$VISUAL` → `$EDITOR`；Blue 挂起让出终端）；以 `:cq` 退出则草稿原样保留 |
| `Alt+M` | 循环会话模型 | 当前 provider 的模型列表里逐个切换（**仅本会话**、不写默认；按键被消费，草稿不动） |
| `Backspace` | 退格 / 退模式 | 空的 `!` bash 提示符上退格即退回 prompt 模式 |
| `Shift+Tab` | 循环会话模式 | normal → plan → yolo（见[会话模式](/features/modes)）。仅在编辑器焦点下生效——面板与问卷保留各自的 Tab 导航 |

## 面板语境

| 表面 | 键位 |
| --- | --- |
| `/help` 浮层 | ↑↓ / PageUp / PageDown 翻页；`Escape` / `Enter` / `q` 关闭 |
| `/sessions` 选择器 | ↑↓ 不循环导航，`Enter` 恢复；输入筛选后 `Esc` 只结束筛选并保留 query，聚焦 `Clear filter` 才清空，再按层级退出 |
| 审批面板 | ↑↓ 不循环 + `Enter`，或数字键 `1`–`4` 直选；`Escape` 拒绝 |
| 问卷面板 | 问题 tabs 用不循环的 `←` / `→` 切题、`Enter` 进入内容；Tab 在问题 tabs 上无动作；单选 ↑↓ + `Enter`，多选 `Space` + `Enter`，Other 编辑器内 `Esc` 返回列表 |
| 表单面板 | `↑` / `↓` 在导航态不循环切字段；文本第一次 `Enter` 进入编辑，编辑态 `Enter` 或合法值上的 `Tab` 确认，非法值停在原字段，textarea 用 `Alt+Enter` 换行；select 用 `Enter` 进入、`←` / `→` 调整、`Enter`/合法 `Tab` 确认；内容态 `Tab` 切语义组，`Escape` 逐层返回 |
| 计划评审 | `←` / `→` 或 `1`–`3` 选决策，`↑` / `↓` / `PageUp` / `PageDown` 滚动计划，`Enter` 确认 |
| `/model` 面板 | 唯一 tab 层是 provider：`←` / `→` 不循环切换，`Enter` 进入模型列表；列表中 `↑` / `↓` 选模型，`←` / `→` 调当前模型的思考等级，`Tab` 进入同级提交动作 |
| `/effort` 面板 | `←` / `→` 在思考等级间不循环移动，`Enter` 下钻；选择 `Set as default` 持久化，或选择 `Use for this session` 仅改当前会话 |
| `/btw` 面板 | `Esc` 关闭；滚轮 / `PageUp` / `PageDown` 滚动；`Enter` 续问 |

## 自定义键位

暂缓（属后续阶段）。当前没有面向用户的键位配置；键位冲突由 keymap 注册时直接拒绝来保证。
