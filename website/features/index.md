# 功能总览

Blue 不是一个大组件，而是一棵 **Cordis 插件树**：bundle 的 `cordis.patch.yml` 以 23 个插件行把 UI 装配到 `dsh-base` 之上。每个视觉表面都是一个可独立增删的插件行——这正是"一切皆插件"的字面意义。

## 三段式装配

### 基线段（5 行）—— 纯净 Blue

去掉整个增强段后依然完整可用的最小 Blue UI：

| 插件行 | 职责 |
| --- | --- |
| `blue-core` | 全树唯一的 pi-tui 适配器：终端生命周期与 `blueScreen` / `blueKeymap` / `blueTerminalInfo` / `blueComponents` 服务 |
| `blue-theme-dark` | 内置 dark 调色板，提供 `blueTheme` 服务 |
| `blue-banner` | 启动欢迎横幅（模型 · provider、cwd、tips、What's new） |
| `blue-transcript` | 会话事件 → transcript 渲染；`blueStatus` 注册表与两行 footer 壳 |
| `blue-status-basic` | footer 基线条目：model 名（优先级 0，最亮档） |

### 增强段（15 行）—— 可整体摘除

在纯基线之上的可选层，逐行可删，整段可删：

| 插件行 | 职责 |
| --- | --- |
| `blue-editor-plus` | `!` bash 模式 + 斜杠/`@` 补全 |
| `blue-attachments` | 附件存储（文件系统图片库） |
| `blue-paste-image` | Ctrl-V 剪贴板贴图，`[image #N]` 标记 |
| `blue-status-cwd` | footer：会话工作目录（优先级 5） |
| `blue-status-git` | footer：git 徽章 `branch [+a -d ↑u↓v]`（优先级 10） |
| `blue-status-mode` | footer：会话模式徽标 `plan`/`yolo`（优先级 2，normal 隐藏） |
| `blue-status-tips` | footer：轮换教学提示（优先级 30） |
| `blue-status-context` | footer：context 占用（优先级 20，第二行右对齐） |
| `blue-intent-diff` | diff 专属工具卡（统一 diff 着色） |
| `blue-intent-terminal` | 终端输出专属工具卡（`$ command` + exit 徽章） |
| `blue-pane-activity` | 活动面板（等待/运行/撰写指示） |
| `blue-pane-queue` | 排队消息面板 + 空编辑器 Up 召回 |
| `blue-pane-todo` | todo 面板（Ctrl-T 折叠切换） |
| `blue-pane-btw` | `/btw` 侧问面板 |
| `blue-pane-agents` | 子代理分组面板（运行中子代理的组卡片，dock 末行） |

### 装配段（3 行）—— 收口

| 插件行 | 职责 |
| --- | --- |
| `blue-interaction` | 输入编辑器、内置命令、问卷 provider、审批应答方 |
| `blue-startup` | 启动值提供方（任务位置参数、`--resume`） |
| `blue-app` | Agent 驱动：创建/恢复会话并发布 `blueSession` |

## plain-first

基线段 + 装配段（共 8 行）就是完整、自洽的 Blue UI。Blue 自己的增强同样走下游插件可用的缝注册——删掉整个增强段，bundle 照常启动照常工作。这让每一个增强行都经受"没有它世界是否更好"的检验，也是下游插件获得与内置功能同等地位的机制保证。

## 底部 dock 顺序

底钉子组件（footer、各面板、编辑器）按挂载顺序渲染。装配上，dock 顺序由 `blueComponents` 激活轮钉住：**activity → queue → todo → btw → agents，编辑器最后**（保证编辑器永远在最底行上方、面板依次叠在其上）。

## 去哪儿看细节

- [流式会话与工具卡片](/features/streaming) —— transcript 渲染
- [输入编辑器](/features/editor) —— 编辑器与增强
- [审批与问卷浮层](/features/approval) —— 交互面板
- [状态栏](/features/status-bar) —— footer 注册表
- [会话模式](/features/modes) —— normal / plan / yolo 与计划评审
- [底部面板](/features/panes) —— 五个 dock pane
