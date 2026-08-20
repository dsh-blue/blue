# 内置工具

dsh 自带的工具目录，按用途分组。哪些工具真正出现在你的会话里，取决于 profile 装配与 [Agent 预设](/dsh/modes)（极简模式只有两个工具；Code 模式下多数工具折叠进 `run_code`）；实验性工具默认关闭。

## 交互与计划

| 工具 | 说明 |
| --- | --- |
| `ask_user_question` | 暂停工具调用，向用户提出确认或多选题 |
| `exit_plan_mode` | 提交 Markdown 计划供审阅，批准后退出计划模式 |
| `skill` | 加载某个具名技能的完整指令 |

## Shell

| 工具 | 说明 |
| --- | --- |
| `bash` | 一次性执行 bash 命令（`bash -c`，调用间无状态）；另有保留 cwd/env 的持久变体 |
| `pwsh` | Windows 侧的 PowerShell 等价物（一次性与持久两种） |

## 文件系统

| 工具 | 说明 |
| --- | --- |
| `str_replace_editor` | 查看/创建/编辑文件（view / create / str_replace / insert） |
| `edit` · `write` · `read` · `read_image` | 字面替换编辑、整文件写入、带行号读取、图片读取（需模型具备视觉能力） |
| `glob` · `grep` | glob 文件查找（上限 100）、ripgrep 内容搜索（上限 250 条行号匹配） |

## 终端

| 工具 | 说明 |
| --- | --- |
| `terminal_open` / `terminal_list` / `terminal_close` | 创建/列出/关闭持久终端会话 |
| `terminal_read` / `terminal_send` / `terminal_signal` | 读取保留输出、发送文本、向前台进程组发信号 |

## 子代理与编排

| 工具 | 说明 |
| --- | --- |
| `subagent` / `subagent_fork` | 把自包含任务委派给独立子代理；fork 变体一次性、默认前台 |
| `send_message` / `interrupt_agent` / `list_agents` | 向运行中的后台子代理追加消息、请求取消、列出状态 |
| `job_output` / `job_list` / `job_kill` | 读取/列出/终止任意后台任务 |
| `ralph` · `workflow` | 固定循环的新 agent 工作流；纯 JS 编排脚本（agent/pipeline/parallel 钩子） |
| Team 工具（实验性，默认关闭） | `spawn_teammate`、`team_task_*` 等多 agent 协作组 |

## 导航与知识

| 工具 | 说明 |
| --- | --- |
| `lsp` | LSP 查询：定义、引用、实现、悬停 |
| `session_event_read` / `session_event_search` / `session_event_trace` | 读取/搜索/追踪授权会话内的事件 |
| `session_search` / `session_trace` | 跨历史会话检索与谱系读取 |

## 目标、调度与网络

| 工具 | 说明 |
| --- | --- |
| `create_goal` / `get_goal` / `update_goal` | 管理同会话内持久的目标 |
| `schedule_create` / `schedule_list` / `schedule_delete` | 会话内提醒（一次性或固定频率） |
| `todo_write` | 整表替换结构化任务清单（Blue 中由 [todo 面板](/features/panes)呈现） |
| `web_fetch` · `web_search` | 抓取并解码 URL 为文本；1–4 个查询合并的网页搜索 |

## Code Mode 与动态插件（按需启用）

| 工具 | 说明 |
| --- | --- |
| `run_code` | 执行一段 TypeScript 程序（async 函数体），经绑定调用其他工具——`tools.mode: code/both` 时的保留传输 |
| `cordis_*`（opt-in） | `cordis_define` / `cordis_inspect_*` / `cordis_run` / `cordis_stop` / `cordis_undefine`：运行时定义、检查、启停动态 Cordis 插件 |

::: tip 完整 Schema
每个工具的参数 Schema 由官方[工具目录](https://deepseek-harness.github.io/deepseek-harness/reference/tool-catalog)生成维护——本页是用途速查，字段细节以那边为准。Blue 会话里工具调用的呈现见[流式会话与工具卡片](/features/streaming)。
:::
