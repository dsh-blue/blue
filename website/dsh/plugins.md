# 官方可选插件

`dsh-base` 的默认装配（78 个插件行）已覆盖完整能力：全部内置工具（shell/文件/搜索/子代理/todo/goal/web/workflow）、沙箱与审批、权限预设、计划模式、上下文压缩、重复工具提醒、Skills、会话标题等。**但以下几类能力官方发布、默认不装**——它们是 Codex / Claude Code 这类 TUI 的常用能力，需要 `dsh plugin --profile <name> add` 显式加入。

## 清单

| 能力 | 需要安装的包 | 提供什么 | 对应 TUI 能力 |
| --- | --- | --- | --- |
| **持久终端（PTY）** | `@deepseek-ai/dsh-terminal-bash` + `@deepseek-ai/dsh-tool-terminal` | `terminal_open` / `send` / `read` / `signal` / `close` / `list` 六个工具 | Codex / Claude Code 的交互式终端：保留 cwd/env 的持久会话、前台进程组、信号 |
| **LSP 导航** | `@deepseek-ai/dsh-lsp-stdio` + `@deepseek-ai/dsh-tool-lsp` | 一个只读 `lsp` 工具：goToDefinition / findReferences / goToImplementation / hover | 精确代码导航——文本匹配含糊或改动前需精确定位时 |
| **PTC 运行时** | `@deepseek-ai/dsh-code-runtime-worker-thread`（TypeScript）或 `@deepseek-ai/dsh-code-runtime-python` | `run_code` 的执行环境 | PTC 模式的前提：**默认无运行时**，`tools.mode: ptc/both` 必须先装其一 |
| **MCP** | `@deepseek-ai/dsh-mcp-client` | `mcp__server__tool` 外部工具 | 外部工具协议，见 [MCP 配置](/dsh/mcp) |
| **ACP** | `@deepseek-ai/dsh-acp` | Agent Client Protocol 服务（JSON-RPC stdio） | 自动化客户端（CLI 等）程序化驱动 harness agent |

## 安装与装配

安装后，在 profile 的 patch 文件加对应行（`id` 自定义、`name` 用包名）：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-terminal-bash @deepseek-ai/dsh-tool-terminal
```

```yaml
# 持久终端：后端 + 模型工具，两行都要
- id: terminal-bash
  name: '@deepseek-ai/dsh-terminal-bash'
- id: tool-terminal
  name: '@deepseek-ai/dsh-tool-terminal'

# LSP：stdio 实现 + 模型工具
- id: lsp-stdio
  name: '@deepseek-ai/dsh-lsp-stdio'
- id: tool-lsp
  name: '@deepseek-ai/dsh-tool-lsp'

# PTC 运行时（TypeScript）：一行业务代码执行环境
- id: code-runtime
  name: '@deepseek-ai/dsh-code-runtime-worker-thread'
  config:
    computeMs: 60000              # 忙时预算（事件循环活跃时间）
    maxWallMs: 600000             # 墙钟上限
    maxOutputBytes: 67108864      # 输出合并上限（64 MiB）
    maxOldGenerationSizeMb: 512   # worker 堆上限
```

要点：

- **PTY 与沙箱联动**：`terminal-bash` 注入 `sandboxPolicy`，受限模式经 `ctx.sandbox` 包装 shell argv；`danger-full-access` 直启。会话级模式降级在持有开放 PTY 时被拒绝——先关终端再降权限；
- **LSP 工作区**：`lsp` 工具要求会话 `cwd` 提供工作区根，缺省即 `LSP_WORKSPACE_REQUIRED`；超时、位置数、结果长度可配置（默认 60s / 100 位置 / 16KB）；
- **PTC 运行时是隔离非安全边界**：`worker-thread` 每次运行一个全新 worker（空环境、堆上限、硬终止）——遏制而非安全边界，信任姿态等同 bash；
- **tool-terminal 的细节**：`run_in_background: true` 复用 `ctx.jobs`（默认就有）；前台发送渲染为终端卡片，后台用通用执行卡；每个操作都要求精确发起 agent，模型无法越权操作他人终端。

## 与 Blue 的关系

- **terminal 工具** → Blue 渲染**专属终端卡**（`$ command` + exit 徽章 + 输出截断，见[流式会话与工具卡片](/features/streaming)）；
- **lsp 工具** → 通用工具卡（暂无专属卡面）；
- **PTC 运行时**：PTC 模式在 Blue 中照常切换，但模型实际能用 `run_code` 之前，profile 必须装运行时——`--dump-config` 里没有 code-runtime 行就是没装；
- 每次请求为已装工具付 schema token 成本（见[系统提示词](/dsh/system-prompt)）。

::: tip 边界说明
本清单聚焦"TUI 常用能力"，非穷尽。完整的官方包目录以 npm registry 的 `@deepseek-ai/dsh-*` 为准；多数可选插件是独立的 `0.0.1-rc.x` 版本线，与 dsh 主版本不同步。装配行写法见各包 README（[packages/mcp](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp)、[packages/terminal](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/terminal)、[packages/lsp](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/lsp)、[packages/code-runtime](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/code-runtime)）。
:::
