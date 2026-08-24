# 斜杠命令参考

输入 `/` 触发模糊补全与发现提示（见[输入编辑器](/features/editor)）；`/help` 浮层实时列出已注册命令——若与本文有出入，以 `/help` 为准。

## 内置命令

| 命令 | 别名 | 参数 | 描述 | 来源 |
| --- | --- | --- | --- | --- |
| `/quit` | `/q` `/exit` | — | 退出 Blue | `blue-commands` |
| `/new` | `/clear` | — | 开始新会话 | `blue-commands` |
| `/fork` | — | — | 把当前会话 fork 成新会话 | `blue-commands` |
| `/sessions` | `/resume` | `<session-id>` | 列出持久化会话并切换；带 id 直接恢复 | `blue-commands` |
| `/btw` | — | `<question>` | 旁路侧问：fork 当前会话问一个问题 | `blue-pane-btw` |
| `/help` | — | — | 显示可用命令与键位 | `blue-commands` |
| `/model` | — | `[id]` | 切换会话模型；无参数打开选择面板 | `blue-model-commands` |
| `/effort` | `/thinking` | `[level]` | 切换当前模型的思考力度；无参数打开横向选择器 | `blue-model-commands` |
| `/provider` | — | `[list \| switch <name> \| add]` | 列出 provider、切换路由或新增 | `blue-model-commands` |
| `/preset` | — | `[name]` | 列出 agent 预设或切换（仅空会话） | `blue-preset-commands` |
| `/yolo` | `/yes` | `[on\|off]` | 开关工具调用自动放行（提问照常弹） | `blue-mode-commands` |
| `/tools` | — | — | 列出当前会话可见的工具 | `blue-tools-commands` |
| `/skills` | — | — | 列出可用技能（`#` 前缀调用） | `blue-skills-command` |
| `/theme` | — | 见[主题](/guide/theme) | 列出或切换主题 | `blue-commands`（经 theme-switch） |
| `/update` | — | `[version]` | 安全升级 Blue（预检/快照/装机冒烟/失败自动回滚） | `blue-commands`（经 update-command，D52） |
| `/settings` | — | — | 打开设置面板并编辑 settings.yaml | `blue-commands`（经 settings-command） |
| `/init` | — | — | 分析代码库并在项目根写 `AGENTS.md` | `blue-session-init` |
| `/status` | — | — | 显示会话头、模型与上下文状态 | `blue-commands` |
| `/context` | — | — | 显示 token 用量与上下文窗口 | `blue-usage` |
| `/version` | — | — | 显示 Blue 与 harness 版本及实时模型 | `blue-commands` |
| `/export` | — | `[path]` | 把当前会话导出为 Markdown 文件 | `blue-session-export` |
| `/copy` | — | — | 复制最近一条助手消息到剪贴板 | `blue-session-export` |

## 会话与模型

- **`/resume <session-id>`** —— 不带参数返回 `usage: /resume <session-id>`。也可以用 `/sessions` 从选择器里挑（按创建时间降序、当前会话标 `← current` 徽章）。
- **`/fork`** —— agent 非 idle（正在运行）时返回 `cannot fork while the agent is running`。
- **`/model` / `/effort`** —— 无参数分别打开模型选择面板（含 footer 的思考力度 segment 控件）与横向力度选择器；面板内 `←` `→` 步进 segment，**`Alt+S` 以"仅本会话"确认**——下一步路由立即切换、不写回持久默认。带参数直接切换并持久化为新默认。
- **`/provider`** —— 三条子命令：`list` 列出可用 provider 与当前路由；`switch <name>` 切换；`add` 进入新增 provider 流程。
- **`/preset`** —— 在薄宿主预设名册（`standard` / `code` / `minimal` / `cordis`）上切换 agent 组合：工具面、人格与 plan 模式都来自当前预设。仅在**空会话**允许切换——已开始的会话返回 `cannot switch presets: this session has already started (blank sessions only)`。

## 模式与审批

- **`/yolo [on|off]`** —— 切换 yolo 会话模式的开关；也可以随时用 `Shift+Tab` 循环切换 normal → plan → yolo（见[会话模式](/features/modes)）。yolo 下工具调用自动放行，**用户提问照常弹出**。
- **`/init`** —— 让 agent 分析代码库并把结论写入项目根的 `AGENTS.md`：已存在则先读取、延续仍然准确的内容，重写为一个连贯的最新文件（而非追加），使用项目自身文档的主要语言。

## 信息与导出

- **`/export [path]`** —— 当前会话导出为 Markdown；不带路径时写入默认文件名 `blue-export-{id8}-{YYYYMMDD-HHMMSS}.md`。
- **`/copy`** —— 最近一条助手消息的文本进剪贴板：优先 OSC 52 转义序列（经 stdout 到达本地终端模拟器，**SSH 远程会话也能复制到本地剪贴板**），失败再走回退管线。
- **`/theme`** —— 完整用法 `usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]`，详见[主题](/guide/theme)。
- **`/settings`** —— 打开设置面板：`↑↓` 选择、`Enter`/`Space` 步进预设值；默认主题实时生效并作为启动默认持久化，宿主未注册的命名空间会隐藏。
- **`/quit`** —— agent attach 前输入显示 `no active session`（见 [FAQ](/guide/faq)）。

命令不进入模型轮——成功/错误文本在编辑器 hint 行闪现。下游插件经 `ctx.commands` 注册的命令会自动出现在补全菜单与 `/help` 里；别名不在 `ctx.commands` 注册，由输入层在分发前重写为规范名（kimi `aliases` 移植）。
