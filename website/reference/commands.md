# 斜杠命令参考

输入 `/` 触发模糊补全与发现提示（见[输入编辑器](/features/editor)）；`/help` 浮层实时列出已注册命令——若与本文有出入，以 `/help` 为准。

## 内置命令

| 命令 | 参数 | 描述 | 来源插件 |
| --- | --- | --- | --- |
| `/quit` | — | 退出 Blue | `blue-commands` |
| `/resume` | `<session-id>` | 恢复一个先前的会话 | `blue-commands` |
| `/new` | — | 开始新会话 | `blue-commands` |
| `/fork` | — | 把当前会话 fork 成新会话 | `blue-commands` |
| `/sessions` | — | 列出持久化会话并切换 | `blue-commands` |
| `/help` | — | 显示可用命令与键位 | `blue-commands` |
| `/theme` | 见[主题](/guide/theme) | 列出或切换主题 | `blue-commands`（经 theme-switch） |
| `/btw` | `<question>` | 旁路侧问：fork 当前会话问一个问题 | `blue-pane-btw` |

## 行为细节

- **`/resume <session-id>`** —— 不带参数返回 `usage: /resume <session-id>`。也可以用 `/sessions` 从选择器里挑（按创建时间降序、当前会话标 `← current` 徽章）。
- **`/fork`** —— agent 非 idle（正在运行）时返回 `cannot fork while the agent is running`。
- **`/theme`** —— 完整用法 `usage: /theme [dark|light|auto|custom <path> [dark|light]]`，详见[主题](/guide/theme)。
- **`/btw <question>`** —— 详见[底部面板](/features/panes)；无参 `/btw` 收起面板。
- **`/quit`** —— agent attach 前输入显示 `no active session`（见 [FAQ](/guide/faq)）。

命令不进入模型轮——成功/错误文本在编辑器 hint 行闪现。下游插件经 `ctx.commands` 注册的命令会自动出现在补全菜单与 `/help` 里。
