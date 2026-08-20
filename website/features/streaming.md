# 流式会话与工具卡片

transcript 层把会话事件流折叠为条目并渲染。本页描述你会看到什么；事件到条目的规则对所有消费者一致（live 流与快照回放同构）。

## 消息条目

- **用户消息** —— `❯` 边栏气泡（`roleUser` 色）；包含的图片在终端可显示图片时直接渲染（上限 12 行），否则保持 `[image]` 占位。
- **助手消息** —— 流式渲染为 Markdown（标题、链接、行内代码、代码块、引用、列表各有专属 token 着色），空行分隔、首行 `●` bullet、两列缩进续行。
- **思考块** —— reasoning 独立成块挂在正文上方：live 时是 braille spinner + `thinking...` 标签与滚动尾窗；收尾后折叠为前两行斜体与 `... (N more lines, ctrl+o to expand)` 提示。

## 工具卡片

工具调用默认呈现为**通用卡片**：运行态 `○`（primary 色）或收尾 `●`（success/error 着色）状态圆点，加缩进的 `⎿` 一行摘要；Ctrl-O 在摘要与完整输出之间切换。

两个**专属卡片**通过 render intent 注册，工具的呈现视图声明 `diff` 或 `terminal` 时接管：

- **diff 卡** —— 逐文件统一 diff，LCS 行级着色（新增/删除/强调/行号槽各有 token）；折叠时每文件 12 行，展开 200 行。
- **终端卡** —— `$ command` 头（shellMode 色）+ cwd + exit 徽章（error/warning 着色）；输出行折叠 10 行、展开 120 行；完成但无输出的运行显示 `(no output)`。

未知工具、或未注册 presenter 的工具一律回退通用卡片——intent 解析永不抛错。

## step 折叠与长会话窗口

- **step-summary** —— 同一 turn 内，下一个 step 开始时，上一 step 的工具条目折叠为单行 `… step N · Tool ×M`；turn 的最后一个 step 保持展开（每 turn 可见尾部保留工具卡）。
- **Ctrl-O 折叠范围** —— 作用于最近 **3 个 turn** 的工具卡与思考块。
- **滑动窗口** —— 只保持最新 15 个已完成 turn 的挂载，更旧 turn 静默逐出渲染树（事件数据完整保留在会话记录里）。200-turn 量级的会话约 90 个挂载组件，滚动始终流畅。

## 特例

- `todo_write` 工具调用与结果**不出现在会话流里**——todo 面板是它的唯一呈现面（见[底部面板](/features/panes)）。
- harness 注入的合成消息（工作区指令、上下文快照等）**零呈现**——内容照发模型，但会话流不留痕迹（见 [FAQ](/guide/faq)）。
