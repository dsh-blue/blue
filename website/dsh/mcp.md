# MCP 配置

[MCP（Model Context Protocol）](https://modelcontextprotocol.io/)是把外部工具接进 dsh 的标准协议。dsh 经官方桥接插件 **`@deepseek-ai/dsh-mcp-client`** 连接 MCP server，并把它的工具注册为原生工具——模型看到的名字是 `mcp__<serverName>__<工具名>`（与 Claude Code / Codex 相同的限定形状）。

::: info 版本
桥接插件是独立版本线（npm 当前 `0.0.1-rc.1`），与 dsh 主版本线不同步。**只桥接 Tools**——MCP 的 Resources 与 Prompts 暂无 harness 消费者，官方暂缓。
:::

## 快速开始

**一个 MCP server = 一个插件实例**，在 profile 的 patch 文件（`$DSH_HOME/profiles/<name>/cordis.patch.yml`）里加一行。先安装插件，再配两例：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-mcp-client
```

**stdio（本地程序）——以 GitHub server 为例：**

```yaml
- id: mcp-github
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: github
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN
```

**streamable-http（远程或已运行的 HTTP 服务）：**

```yaml
- id: mcp-web
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: web
    transport: streamable-http
    url: http://localhost:3000/mcp
    headers:
      Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

模型将看到 `mcp__github__create_issue`、`mcp__web__search` 之类的工具名。

## 配置字段

| 字段 | 传输 | 必填 | 说明 |
| --- | --- | --- | --- |
| `transport` | 两者 | 是 | `"stdio"` 或 `"streamable-http"` |
| `serverName` | 两者 | 是 | 该 server 模型侧工具名的命名空间：`[A-Za-z0-9_-]{1,32}`，跨活动实例唯一 |
| `command` | stdio | 是 | 要启动的可执行文件 |
| `args` | stdio | 否 | 传给命令的参数 |
| `env` | stdio | 否 | 附加环境变量（叠加在已清洗的环境之上） |
| `cwd` | stdio | 否 | 子进程工作目录 |
| `url` | http | 是 | MCP server 地址 |
| `headers` | http | 否 | 附加请求头（如鉴权令牌） |
| `toolCallTimeoutMs` | 两者 | 否 | 每次 `callTool` 超时（默认 60000） |
| `failOnStartupError` | 两者 | 否 | 初始连接/同步失败时拒绝插件激活（默认 `false`，激活但无工具） |
| `reconnect.enabled` | 两者 | 否 | 断线自动重连（默认 `true`） |
| `reconnect.initialDelayMs` | 两者 | 否 | 首次重连延迟，此后每次失败翻倍（默认 500） |
| `reconnect.maxDelayMs` | 两者 | 否 | 退避上限；也是重试预算重置所需存活时长（默认 30000） |
| `reconnect.maxAttempts` | 两者 | 否 | 每次故障期内连续失败次数上限（默认 10，超限放弃） |

**凭证一律走环境变量**（`!!js process.env.XXX` 或模板字符串插值），不要把密钥写进配置文件。

## 命名与多 server

- 公开名经规范化（DeepSeek 函数名契约：64 字符、`[A-Za-z0-9_-]`）；改名时追加 `(serverName, rawName)` 的确定性 12 位十六进制哈希，**不同工具永不坍缩为同名**；
- 名字是 `(serverName, rawName)` 的**纯函数**：连接顺序、重同步、其他 server 都不会改到既有工具名；
- 两个 server 发布同名工具（如都叫 `search`）在各命名空间下和平共存；`serverName` 重复会使后加载的实例**启动即失败**；
- 同一个 server 重复列出同名工具会被判非法工具列表拒绝。

## 行为与运维

- **HMR 热替换**：改配置条目即触发断开 + 重连，**无需重启进程**；`serverName` 不变则工具名保持一致；
- **注册时机**：插件激活时先 `listTools()` 再注册，首次 turn 开始前完成；发现失败默认"激活但无工具"（`failOnStartupError: true` 则拒绝激活）；
- **重连预算**：`maxAttempts` 次连续失败后注销该 server 的工具并停止重连（直到 HMR 重载）；连接存活超过 `maxDelayMs` 则重置预算——偶尔崩溃的 server 无限恢复，崩溃循环的 server 终会停手；
- **故障期间**：上一代（最近一次成功的）工具保持注册，调用失败直到恢复；`notifications/tools/list_changed` 触发重新同步；
- **KV Cache**：工具集与 schema 不变时前缀稳定（友好）；重同步增删改工具会使从首个变更 schema 起的复用失效；恢复出相同列表的重连保持前缀稳定。

## 限制

- 只桥接 **Tools**；Resources / Prompts 暂缓；
- 连接/发现超时继承 MCP SDK 的 60 秒默认（dsh 未暴露连接超时配置）；
- 重连在 transport 关闭时触发——stdio 子进程崩溃会触发；HTTP 服务不可达按请求重试；
- **图片是唯一持久富结果桥接**（PNG/JPEG/WebP/GIF，且须挂载 `ctx.attachments` 并证明模型路由显式支持图片输入）；音频、内嵌资源、资源链接与未知块一律降级为有界诊断文本，绝不出现在会话事件里。

## 与 Blue 的关系

- MCP 工具注册进 `ctx.tools` 后，在 Blue 会话里就是普通工具调用——按[通用工具卡](/features/streaming)呈现（Blue 当前无 MCP 专属卡面）；
- 满足上述图片条件时，MCP 返回的图片块可在 Blue 会话里渲染（Blue 的 `blue-attachments` 就是 `ctx.attachments` 的实现方）；
- 每次请求都会为已注册的 MCP 工具 schema 付出 token 成本——挂的 server 越多，系统提示词越长（见[系统提示词](/dsh/system-prompt)）。

::: tip 来源
字段与行为以官方 [@deepseek-ai/dsh-mcp-client README](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client) 为基准。
:::
