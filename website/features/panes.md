# 底部面板

状态栏与输入编辑器之间是**底部 dock**：五个被动面板按挂载顺序依次叠放（activity → queue → todo → btw → agents，编辑器最后）。无内容时各面板渲染零行——dock 不会跳变。

## 活动面板（activity）

挂在会话事件流上的模式机，告诉你 agent 现在在干什么：

| 模式 | 呈现 |
| --- | --- |
| waiting / tool | 月亮 spinner + 轮换教学提示（loading 种类变化时换提示） |
| composing | braille `working...` 行（primary 色帧 + 随行提示）——没有输出光标，这行就是"正在写"的信号 |
| thinking | 清空（spinner 归 transcript 的思考块） |
| idle | 一行占位（dock 边缘稳定） |
| 对话框打开 | 整行隐藏（面板占据编辑器槽位时） |

## 排队消息面板（queue）

你在 agent 运行中提交的 follow-up 进入 harness inbox 排队——面板把队列列出来：每条一行 `queued ↑ turn:|step:` 前缀。队列空时零行。

**Up 召回**：编辑器 buffer 为空时按 ↑，移除最近一条排队消息并把其文本放回草稿（steer 意图优先于 next-turn）。未加载 queue 面板时，↑ 归编辑器历史浏览。

## todo 面板（todo）

会话的 todo 列表（整表快照，last-write-wins）在 kimi 风格的平线框下呈现：`Todo` 标题 + 三态点——`✓` 已完成（muted 加删除线）、`●` 进行中（primary 粗体）、`○` 待办。

- **五行折叠** —— 长列表先收全部进行中，再以最早的待办与最近的完成补足；footer 一行 `… +N more (2 done · 1 pending) · ctrl+t to expand` 统计隐藏项。
- **Ctrl-T** 在折叠/整表之间切换（`all N items · ctrl+t to collapse`）；展开态跨写入保留，会话切换或列表完结时复位。
- **全部完成自动收起**——下一次写入重新以折叠态打开。

`todo_write` 工具调用不出现在会话流里，这个面板是 todo 的唯一呈现面。

## 侧问面板（/btw）

`/btw <question>` 把当前会话 fork 成一次性旁路 agent——以全量事件流为种子、继承父会话的 provider/model——在不打扰主线的情况下问一个"顺便一提"的问题：

- 面板标题 ` BTW ` + 按键提示（`Esc close`，正文溢出时加 `PgUp/PgDn or wheel`）；
- `› 问题` 行 + 流式 Markdown 回复 + thinking 行；行预算随终端高度自适应（resize 即重排）；
- 打开期间编辑器顶角与面板拼接为 `├┤`；**Esc** 关闭（草稿存活）、滚轮 / **PageUp** / **PageDown** 滚动、**Enter** 在同一旁路 agent 上续问；
- 槽位单一：再次 `/btw` 会先销毁上一个旁路 agent；无参 `/btw` 直接收起面板。

## 子代理分组面板（agents）

agent 派生的**子代理组**（subagent group）运行时，组卡片钉在编辑器正上方——dock 的最后一行（kimi swarm-pane 语义）。与 todo 面板对 `todo_write` 的关系一样：spawn 类工具调用被 step 折叠从会话流里隐去，本面板是运行中子代理的唯一呈现面——你能看到派生了谁、各自在干什么，而不必在会话流里翻工具卡。
