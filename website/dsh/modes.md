# 权限与模式

dsh 里"模式"一词出现在四个层面，各自独立、组合生效：

## 1. Agent 预设（会话形态）

决定这个会话里的 agent 拥有哪些能力、工具如何呈现。dsh 内置四个预设（在宿主应用的模式选择器中切换）：

| 预设 | 说明 |
| --- | --- |
| **标准模式** | 功能完整的编码 Agent：文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流 |
| **PTC 模式** | 标准模式全部能力，并经 Code Mode SDK 呈现工具——模型用一个 TypeScript 程序组合多步操作（`run_code` 传输） |
| **极简模式** | 仅提供持久 bash 与 `str_replace_editor` 的双工具编码 Agent |
| **创造模式** | 面向自定义 Agent 预设的作者：标准能力 + 运行时检查、插件实验与预设创作指导 |

工具呈现方式由 `tools.mode` 配置控制：`native`（默认，函数调用）/ `code`（仅 `run_code` 传输）/ `both`；单个 agent 也可以用自己的选择遮蔽全局默认。

## 2. 审批策略（approval policy）

工具调用需要授权时走 `approval/request`，策略只有两个值：

| 策略 | 语义 |
| --- | --- |
| `ask`（默认） | 请求交给应答方链——**Blue 的四选项审批面板就是应答方**（见[审批与问卷浮层](/features/approval)）；无人应答时失败关闭 |
| `never` | 从不询问，一切 ask 直接拒绝——CI / 无人值守的严格姿态 |

结果只有四种：`allowed-once`（仅本次放行）/ `rejected` / `cancelled` / `unavailable`，缺省一律按拒绝处理（fail-closed）。

## 3. 沙箱模式（sandbox mode）

约束 shell/进程的文件系统影响面（网络与进程可见性不在其管辖内）：

| 模式 | 语义 |
| --- | --- |
| `read-only` | 拒绝一切写入 |
| `workspace-write` | 允许写入工作区根目录与后端定义的临时区 |
| `danger-full-access` | 完全绕过隔离 |

后端按平台自动选择：Linux 用 Landlock/bwrap，macOS 用 Seatbelt，Windows 用 ACL 受限令牌；无法提供沙箱时显式报错，绝不静默放行。部分平台边界（旧 Landlock ABI、Windows 硬链接）会降级为部分强制。

## 4. 权限预设（permission presets）

把沙箱模式与审批策略**打包成具名档位**，让客户端用一个"权限"选择器同时切换两者：

| 预设 | 沙箱 | 审批 |
| --- | --- | --- |
| `workspace-write` | `workspace-write` | `ask` |
| `danger-full-access` | `danger-full-access` | `never` |

::: tip 与 Blue 的关系
权限预设包随 rc.6+ 发布，但是否进入你安装版本的默认装配，以 `dsh --profile <name> --dump-config` 为准。Blue 目前以审批面板承担 `ask` 策略；预设切换器在 Blue 侧的界面化仍在路线上。
:::
