# 配置：模型、Provider 与主题

Blue 的配置分两层：**界面内的斜杠命令**（日常切换，推荐）与 **dsh 的文件体系**（`settings.yaml`、`.credentials.yaml`、profile patch——持久化真相就在这些文件里）。界面命令写下去的也是文件；两层从不打架。本页把两层串成一条路。

| 想配什么 | 界面内 | 落盘位置 |
| --- | --- | --- |
| API key | `/provider add`、Providers 面板编辑 | `~/.dsh/.credentials.yaml` |
| 默认模型 / 思考力度 | `/model`、`/effort`、`Alt+M` | `settings.yaml` 的 `agent-default-model:` 段 |
| 新增 provider / 自定义网关 | `/provider add` | `settings.yaml` 的 `llm-pi-ai:` 段 + 凭据文件 |
| DeepSeek 官方端点微调 | —（文件专属） | `settings.yaml` 的 `llm-deepseek:` 段 |
| 主题 | `/theme`（会话级）；`/settings` 或文件写持久默认 | `settings.yaml` 的 `blue:` 段（[主题](/guide/theme)） |
| 更新检查 / 折叠默认等 Blue 偏好 | `/settings` | `settings.yaml` 的 `blue:` 段 |
| 插件行 / 装配 | — | profile 的 `cordis.patch.yml`（[Profile 与目录](/dsh/profiles)） |

## 最小可用：一个 DEEPSEEK_API_KEY

开箱即用的默认装配是 **DeepSeek 官方 API**（provider 路由 `deepseek-official`，端点 `https://api.deepseek.com`，默认模型 `deepseek-v4-flash`，思考默认开启、力度 `high`）。所以从零到第一句对话，只需要一个 key：

```sh
export DEEPSEEK_API_KEY=sk-...
dsh --profile blue
```

不想每次 export，就把 key 写进凭据文件 `~/.dsh/.credentials.yaml`（整份文件就是一个「引用名 → 值」的映射，没有别的结构）：

```yaml
DEEPSEEK_API_KEY: sk-...
```

同一个 key 有四种放置方式，按**优先级从高到低**：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 进程环境变量（`export DEEPSEEK_API_KEY=… dsh …`） | 单次覆盖：CI secret、临时换 key |
| 2 | `~/.dsh/.credentials.yaml` | 常规存放处；`/provider add` 存的 key 也在这里 |
| 3 | 当前目录 `./.env` | 项目级 |
| 4 | `~/.dsh/.env` | 用户级兜底 |

::: tip 首次启动会引导配置
Blue 在会话就绪后检查所有已注册 provider 的凭据。若一个可用 key 都没有，会直接弹出 DeepSeek 快速配置框；只需填入 `DEEPSEEK_API_KEY`，Blue 使用 `deepseek-official` 的官方端点 `https://api.deepseek.com`。按 Esc 可跳过本次引导，进入 Blue 后用 `/provider add` 配置其他 provider；在仍无可用 key 时，下次启动会再次提示。

key 仍在**每次请求时**解析，因此运行期间补充或轮换凭据无需重启；`MISSING_CREDENTIAL` 保留为凭据被移除或失效时的兜底错误。
:::

`~/.dsh` 称为 Harness home，可用 `DSH_HOME` 改址（目录全表见 [Profile 与目录](/dsh/profiles)）。

## 界面内配置（日常推荐）

### 模型与思考力度

- **`/model`** —— 无参数打开模型选择面板（`←` `→` 步进思考力度 segment）；带 id 直接切换。切换会持久化为新默认。
- **`Alt+M`** —— 不开面板直接循环切换模型。
- **`Alt+S`**（面板内）—— **仅本会话**确认：下一步路由立即切换，但不写回持久默认。
- **`/effort`**（别名 `/thinking`）—— 切换当前模型的思考力度；`default` 恢复 provider 默认。

`/model` 的持久化写入 settings.yaml 的 `agent-default-model:` 段（形状见[下文](#settings-yaml-三个核心段)）。

### Provider：列出、切换、新增

```
/provider                  # 打开 Providers 面板（列出已配置路由 + Add 入口）
/provider list             # 命令行列出可用 provider 与当前路由
/provider switch <name>    # 切换路由
/provider add              # 新增 provider 向导
```

Providers 面板里**选中一个已配置的路由即进入编辑**：可改显示名、baseURL、key（留空保留原值），`Ctrl+D` 删除整个路由（需键入 `y` 二次确认）。内置的 `deepseek-official` 路由没有可编辑的存储档案（面板会提示 nothing to edit）——调整它走 `settings.yaml` 的 `llm-deepseek:` 段。

`/provider add` 有两条分支：

- **Known provider**（anthropic、openai 等）—— 从宿主的可配置目录里挑一家，只填 key；Base URL 不可编辑，始终使用宿主目录提供的厂商默认端点。
- **Custom endpoint**（自建网关、任意 OpenAI 兼容端点）—— 声明协议与地址：
  - 协议三选一：`anthropic-messages` / `openai-completions` / `openai-responses`；
  - baseURL 约定：anthropic 协议**不带**尾缀 `/v1`（客户端自己拼 `/v1/messages`）；openai 系协议**要带** `/v1`；
  - 向导会现场向端点拉取模型列表（`GET /models`）让你勾选，并用 [models.dev](https://models.dev) 目录自动补全上下文窗口与思考力度，补不全的再问你一次（两项都可回车跳过）；
  - key 存进凭据文件，引用名按路由 id 大写折叠推导：`my-gateway` → `MY_GATEWAY_API_KEY`。

新增完成后弹出新路由的模型选择器；取消选择不会撤销新增（provider 留在原处，`/provider list` 可见）。

## 文件体系：settings.yaml 与凭据

界面命令之外，dsh 的全部配置落在 Harness home 的几个文件里，**外部编辑实时热生效**（watcher 默认开启）：

| 文件 | 内容 |
| --- | --- |
| `~/.dsh/settings.yaml` | 所有插件的设置段（一个文档承载全部命名空间） |
| `~/.dsh/.credentials.yaml` | 凭据（权限强制 `0600`，目录 `0700`） |
| `~/.dsh/.env` | 用户级环境变量层 |
| `~/.dsh/profiles/<name>/cordis.patch.yml` | profile 的装配覆盖层（见 [Profile 与目录](/dsh/profiles)） |

启动时文档已存在但格式非法 → 启动失败（fail loud）；运行中的非法编辑 → 保留上一份好快照并告警。手工编辑 settings.yaml 的注释会尽量保留（写入按叶子级 diff 落笔）。

### settings.yaml 三个核心段

```yaml
# 默认模型——/model、/effort 写到这里
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash
  reasoningEffort: high      # 可省略

# DeepSeek 官方端点（llm-deepseek 适配器）——全部字段可省略
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY    # 凭据引用名（默认值就是它）
  baseURL: https://api.deepseek.com
  thinking: enabled              # enabled | disabled（disabled 锁死 off）
  reasoningEffort: high          # off | high | max
  maxTokens: 256000              # 每请求输出上限
  defaultContextWindow: 1000000  # 模型未声明容量时的兜底
  models:                        # 省略则内置 V4 Flash / V4 Pro 两条
    - id: deepseek-v4-flash
      name: DeepSeek-V4-Flash
      contextWindow: 1000000

# 自定义 provider 路由（pi-ai 适配器）——/provider add 写到这里
llm-pi-ai:
  providers:
    my-gateway:
      displayName: 公司网关
      api: openai-completions          # anthropic-messages | openai-completions | openai-responses
      baseURL: https://gw.example.com/v1
      apiKeyEnv: MY_GATEWAY_API_KEY    # 凭据引用名，对应 .credentials.yaml 里的键
      models:
        - id: glm-5.3
          contextWindow: 1000000       # 目录/端点都没声明时的容量声明
          maxTokens: 131072
          reasoningEfforts:            # 模型支持的思考力度 → 线上拼写
            low: low
            high: high
            max: max
```

要点：

- **`llm-deepseek:` 与 `llm-pi-ai:` 是两个独立适配器**：前者独占 `deepseek-official` 路由直连官方 API；后者按 `providers:` 字典注册任意路由（路由名就是字典键，小写 kebab-case）。两者可并存。
- 用户 settings 段**逐字段覆盖**装配基线（bundle 带来的默认），没有的字段继续用基线值。
- pi-ai 路由还有进阶字段：`modelOverrides:`（按模型 id 微调目录模型而不替换整个列表）、`compat:`（推理参数格式开关）、`defaultContextWindow:` / `defaultMaxTokens:`（整路由兜底）等，完整清单见[上游配置目录](https://deepseek-harness.github.io/deepseek-harness/reference/)。
- 列表类字段（如 `models:`）是**整体替换**而非逐条合并。

### blue: Blue 自己的设置段

`/settings` 面板写到这段（全部可省略，默认值如下）：

```yaml
blue:
  updateCheck: true        # 启动时的 Blue 更新检查（false 即离线开关）
  updateChannel: rc        # 更新检查跟踪的 dist-tag
  theme: dark              # 持久默认主题：dark | light | ocean | paper | auto（启动时应用）
  collapseThinking: true   # thinking 块默认折叠
  collapseToolCalls: true  # 工具输出默认折叠（ctrl+o 在会话内切换）
  windowTurns: 15          # transcript 窗口：只挂载最近 N 个已完成回合
  recentStepsRetention: 30 # 回合内步骤折叠：保留最近 N 步的卡片展开
  expandTurns: 3           # ctrl+o 展开的作用范围（自末尾起的回合数）
  userFoldLines: 10        # 长用户消息折叠阈值（行数）
  userFoldChars: 1000      # 长用户消息折叠阈值（字符数）
  editorCommand: ''        # 外部编辑器命令（空 = 按 $VISUAL/$EDITOR 自动探测）
  pasteImageBackend: auto  # Linux 剪贴板后端：auto | wayland | x11
```

面板分两级：第一级按命名空间分组（`blue`、`shell`、`agent-loop`、`web-search-deepseek:` 等宿主段在内），Enter 进入第二级逐行调整，`Enter`/`Space` 步进预设值、每次改动即落盘；`blue.theme` 实时生效并成为启动默认（`/theme` 仍是会话级切换，见[主题](/guide/theme)），折叠默认与 transcript 数值项的改动同样立即作用于当前会话（Ctrl-O 的全局展开状态优先）。第一级末行可在 `$EDITOR` 里打开整份 settings.yaml。

### 改完怎么验证

```sh
dsh --profile blue --dump-config        # 打印实际组装的完整插件树
```

settings.yaml 的效果则直接在界面里看：`/model` 面板列出各路由的模型、`/status` 显示当前路由与模型。

## 主题

`/theme dark|light|auto` 一键切换，`/theme custom <path>` 挂载自定义 JSON 调色板——热切换不丢输入草稿。`/theme` 是会话级切换；持久默认主题用 `/settings` 面板或 settings.yaml 的 `blue.theme` 设置（启动时应用）。完整语义 token 表与 custom 文件格式见[主题](/guide/theme)。

## 更多配置面

- **权限与沙箱** —— 权限预设（workspace-write / danger-full-access）、审批策略，见[权限与模式](/dsh/modes)；会话内 `Shift+Tab` 循环 normal → plan → yolo，`/yolo` 开关。
- **Agent 预设** —— `/preset` 在 `standard` / `code` / `minimal` / `cordis` 间切换工具面与人格（仅空会话）。
- **Skills** —— 用户级技能放 `~/.dsh/skills/`，见 [Skills](/dsh/skills)。
- **MCP** —— MCP server 的接入配置见 [MCP 配置](/dsh/mcp)。

## 环境变量速查

| 变量 | 作用 | 默认行为 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 官方 API key（`llm-deepseek` 的 `apiKeyEnv` 默认引用名） | 未设置时首次请求报 `MISSING_CREDENTIAL` |
| `DEEPSEEK_BASE_URL` | DeepSeek 官方端点地址兜底 | `https://api.deepseek.com` |
| `DSH_HOME` | Harness home 目录 | `~/.dsh` |
| `DSH_PERMISSION_MODE` | 进程级权限回退：`read-only` / `workspace-write` / `danger-full-access`（后者连审批都跳过） | `workspace-write` |
| `DSH_TELEMETRY_DISABLED` | 任意非空值（含 `'0'`、`'false'`）即硬禁用会话遥测 | 遥测默认已关闭（`DISABLED`） |
| `DSH_BLUE_ATTACHMENT_DIR` | Blue 附件存储位置 | `$DSH_HOME/attachments/` |
| `DSH_AGENTS_HOME` | 共享 agent 配置根（技能发现的 `~/.agents` 层） | `~/.agents` |

::: warning 哪些变量不能写进 .env
`DEEPSEEK_API_KEY` 四层都认（含 `.env`），但 `DEEPSEEK_BASE_URL` 与**一切 `DSH_*` 前缀变量**属于 bootstrap 变量——`.env` 文件里出现会被直接拒绝（提示 export 它），只能在启动环境里设置。凭据类环境变量永远赢过文件层——想临时换 key，`DEEPSEEK_API_KEY=sk-… dsh --profile blue` 即可。
:::
