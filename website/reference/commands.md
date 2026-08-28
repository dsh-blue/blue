# 斜杠命令参考

输入 `/` 触发模糊补全与发现提示（见[输入编辑器](/features/editor)）；`/help` 浮层实时列出已注册命令——若与本文有出入，以 `/help` 为准。

## 内置命令

| 命令 | 别名 | 参数 | 描述 | 来源 |
| --- | --- | --- | --- | --- |
| `/quit` | `/q` `/exit` | — | 退出 Blue | `blue-commands` |
| `/new` | `/clear` | — | 开始新会话 | `blue-commands` |
| `/fork` | — | — | 把当前会话 fork 成新会话 | `blue-commands` |
| `/rewind` | — | — | 从当前会话较早的用户回合创建安全分支 | `blue-commands` |
| `/sessions` | `/resume` | `[<session-id>]` | 以 lineage 树列出持久化会话并切换；带 id 直接恢复 | `blue-commands` |
| `/btw` | — | `<question>` | 旁路侧问：fork 当前会话问一个问题 | `blue-pane-btw`（transcript） |
| `/help` | — | — | 显示可用命令与键位 | `blue-commands` |
| `/model` | — | `[id]` | 切换会话模型；无参数打开选择面板 | `blue-commands`（model-commands） |
| `/effort` | `/thinking` | `[level]` | 切换当前模型的思考力度；无参数打开横向选择器 | `blue-commands`（model-commands） |
| `/provider` | — | `[list \| switch <name> \| add]` | 列出 provider、切换路由或新增 | `blue-commands`（model-commands） |
| `/preset` | — | `[name]` | 列出 agent 预设或切换（仅空会话） | `blue-commands`（preset-commands） |
| `/permission` | — | `[name]` | 空参数被输入层拦截、打开权限预设面板；带参数透传给宿主命令 | `blue-input` 拦截裸调用；命令由 `dsh-permission-presets` 注册 |
| `/yolo` | `/yes` | `[on\|off]` | 开关工具调用自动放行（提问照常弹） | `blue-commands`（mode-commands） |
| `/tools` | — | — | 列出当前会话可见的工具 | `blue-commands`（tools-commands） |
| `/mcp` | — | — | 浏览宿主连接的 MCP 服务器与其工具 | `blue-commands`（mcp-commands，S34） |
| `/skills` | — | — | 列出可用技能（`#` 前缀调用） | `blue-commands`（skills-command） |
| `/theme` | — | 见[主题](/guide/theme) | 列出或切换主题 | `blue-commands`（theme-switch） |
| `/init` | — | — | 分析代码库并在项目根写 `AGENTS.md` | `blue-commands`（session-init） |
| `/status` | — | — | 显示会话头、模型与上下文状态 | `blue-commands`（session-commands） |
| `/context` | — | — | 显示 token 用量与上下文窗口 | `blue-commands`（session-commands） |
| `/version` | — | — | 显示 Blue 与 harness 版本及实时模型 | `blue-commands`（session-commands） |
| `/changelog` | — | — | 显示发版 changelog（what's new，逐版本分节，当前版本带 `· current` 徽章） | `blue-commands`（session-commands） |
| `/trace` | — | `[copy <seq> \| copy all]` | 查看当前会话执行轨迹；可复制单项或完整轨迹 | `blue-commands`（trace-command） |
| `/update` | — | `[version]` | 安全升级 Blue（预检/快照/装机冒烟/失败自动回滚；不带参数即只读检查） | `blue-commands`（update-command，D52） |
| `/settings` | — | — | 按命名空间编辑用户设置（两级面板，改动即落盘；详见[配置](/guide/config)） | `blue-commands`（settings-command） |
| `/export` | — | `[path]` | 把当前会话导出为 Markdown 文件 | `blue-commands`（session-export） |
| `/copy` | — | — | 复制最近一条助手消息到剪贴板 | `blue-commands`（session-export） |

## 会话与模型

- **`/resume <session-id>`** —— `/sessions` 的别名：带 id 直接恢复，不带参数与 `/sessions` 一样打开 lineage 树选择器（按 `parentSession` 组织、兄弟节点按创建时间降序、当前会话标 `← current`；当前会话的祖先路径自动展开且不带出旁支，其他分支用 **Space 切换展开/折叠**）。列表按当前工作目录圈定，每行显示会话标题，**直接输入即过滤**且能搜到折叠节点——`Esc` 先清过滤词、再按一次取消。
- **`/fork`** —— agent 非 idle（正在运行）时返回 `cannot fork while the agent is running`。
- **`/rewind`** —— 单层列出当前会话的直接用户回合；选择一个回合会从该完整回合之前创建普通子 session。父会话不截断、不删除，仍可从 `/sessions` 恢复；agent 运行时拒绝。
- **`/model` / `/effort`** —— 无参数分别打开模型选择面板（含 footer 的思考力度 segment 控件）与横向力度选择器；面板内 `←` `→` 步进 segment，**`Alt+S` 以"仅本会话"确认**——下一步路由立即切换、不写回持久默认。带参数直接切换并持久化为新默认。免开面板的快路：**`Alt+M`** 在当前 provider 的模型列表里逐个切换（仅本会话，草稿保留；见[键位参考](/reference/keys)）。
- **`/provider`** —— 三条子命令：`list` 列出可用 provider 与当前路由；`switch <name>` 切换；`add` 进入新增 provider 流程。
- **`/preset`** —— 在薄宿主预设名册（`standard` / `ptc` / `minimal` / `cordis`）上切换 agent 组合：工具面、人格与 plan 模式都来自当前预设。仅在**空会话**允许切换——已开始的会话返回 `cannot switch presets: this session has already started (blank sessions only)`。

## 模式与审批

- **`/yolo [on|off]`** —— 切换 yolo 会话模式的开关；也可以随时用 `Shift+Tab` 循环切换 normal → plan → yolo（见[会话模式](/features/modes)）。yolo 下工具调用自动放行，**用户提问照常弹出**。
- **`/permission`** —— 列出/切换权限预设（sandbox 模式 + 审批策略的命名束）。与 `/preset` 同款单选列表面板；danger 预设需打字 `y` 确认。裸 `/permission` 由输入层拦截开面；命令本身由上游 `dsh-permission-presets` 注册（补全与 `/help` 均会列出），带参调用透传给宿主命令执行切换。
- **`/mcp`** —— 三层面板浏览宿主连接的 MCP 服务器：服务器选择器 → 服务器面板（config 伪行 + 工具行）→ 详情（config 状态/脱敏连接/策略，或工具 schema）。只读——增删服务器走 profile patch（见 [dsh/mcp](/dsh/mcp)）；空态有指路。
- **`/init`** —— 让 agent 分析代码库并把结论写入项目根的 `AGENTS.md`：已存在则先读取、延续仍然准确的内容，重写为一个连贯的最新文件（而非追加），使用项目自身文档的主要语言。

## 信息与导出

- **`/export [path]`** —— 当前会话导出为 Markdown；不带路径时写入默认文件名 `blue-export-{id8}-{YYYYMMDD-HHMMSS}.md`。
- **`/copy`** —— 最近一条助手消息的文本进剪贴板：优先 OSC 52 转义序列（经 stdout 到达本地终端模拟器，**SSH 远程会话也能复制到本地剪贴板**），失败再走回退管线。
- **`/trace`** —— 通过 harness 官方会话查询读取当前执行时间线；↑/↓ 选择条目，Enter 打开完整 JSON，PageUp/PageDown 滚动详情，`c` 复制单项，`a` 复制完整轨迹。
- **`/theme`** —— 完整用法 `usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]`，详见[主题](/guide/theme)。
- **`/quit`** —— agent attach 前输入显示 `no active session`（见 [FAQ](/guide/faq)）。

命令不进入模型轮——成功/错误文本在编辑器 hint 行闪现。下游插件经 `ctx.commands` 注册的命令会自动出现在补全菜单与 `/help` 里；别名不在 `ctx.commands` 注册，由输入层在分发前重写为规范名（kimi `aliases` 移植）。`/permission` 属另一情形：命令由上游 `dsh-permission-presets` 注册进命令表（补全与 `/help` 都会列出），但 Blue 输入层在分发前截获**裸调用**、直接打开预设选择面板。

## 暂缓的命令

以下命令在参照系产品（kimi/Claude Code）中存在，Blue 侧**有意暂缓**——或等上游开出原语，或等真实需求出现（完整裁定见仓库 roadmap 挂起区）：

- `/reload` `/tasks` —— 顺延（任务管理走 profile/config 文件）
- `/archive` `/delete` —— 上游 persistence 暂无删除/归档原语
- `/import` —— 会话格式版本严格性未定
- `/diff`（未提交变更面板）、审批 diff 全屏预览 —— 发版后随 dogfood 反馈同评
- `/debug` —— 需上游诊断导出面
