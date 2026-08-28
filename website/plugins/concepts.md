# 核心概念

本篇解释 Blue 插件模型的四个支柱：Cordis 树与 Fiber 生命周期、capability 裁剪、canonical node 词汇表、`BlueResult` 错误模型，以及 domain/adapter 拆分。读完你会理解每个能力页里契约表背后的"为什么"。

## Cordis 树与 Fiber 生命周期

dsh 进程里只有一棵 Cordis 插件树。Harness domain 插件（agents、sessions、tools、approval）、Blue 的 29 行、你的插件，都是这棵树上的兄弟行：

```text
dsh process 进程（one Cordis tree 一棵 Cordis 树）
├── dsh-base rows 行    — Harness domain: agents · sessions · tools · approval
├── Blue rows 行        — TUI: bluePluginHost serves here 在这里提供服务
└── your plugin row 你的插件行 — inserted via 经 cordis.patch.yml
```

行与行之间只通过 **Cordis 服务注入**（`inject` + `ctx.<service>`）和**请求事件**通信，不共享对象引用。你的插件 `inject: ['bluePluginHost']` 声明依赖后，Cordis 保证 host 就位才激活你的 `apply(ctx)`。

每个插件运行在自己的 **Fiber** 上。`open(ctx, manifest)` 返回的每一次注册都绑定调用方 Fiber：

- 插件被卸载（patch 行删除、profile 切换）时，所有贡献**自动回滚**，不留残骸；
- 反过来，如果你绕过 `open()` 直接改全局状态（模块级 singleton、直接注册到 Harness 服务），卸载语义就破了——这是[设计纪律](#设计纪律)禁止它们的原因。

## Capability 裁剪

manifest 是插件的静态兼容性声明：

```ts
interface BluePluginManifest {
  id: string                    // ^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$
  api: string                   // semver 范围；宿主当前是 1.x 线，写 '^1.0.0'
  capabilities: BlueCapability[] // 不可重复
}
```

`open()` 的行为分三层：

1. **静态校验**（`validateBlueManifest`，不执行插件代码）：id 格式、api 范围格式、capability 拼写与去重。失败返回 `BLUE_API_INCOMPATIBLE`（或 manifest 根本不是对象时的 `BLUE_INVALID_CONTRIBUTION`）；
2. **能力开放检查**：当前阶段开放 `commands`、`status`、`notifications`、`panes`、`overlays`、`editor.extensions`、`status.provider` 与 `editor.provider`。申请尚未实现的 `session.read` / `session.act` 会被整体拒绝（`BLUE_CAPABILITY_DENIED`）——不是降级，是拒绝；
3. **按能力裁剪返回**：`BluePluginApi` 上只有声明过的 capability 字段有值，其余是 `undefined`。所以访问时总是 `api.commands?.register(...)` 这样的可选链形态。

裁剪是双向契约：你只拿到你声明的，宿主也只暴露你声明的。插件升级时要新能力，就在 manifest 里加一行——宿主版本不够会在 `open()` 阶段明确失败，而不是运行时才出错。

## Canonical node 词汇表

Pane、overlay 与 provider 使用 `BlueUiNode`；status 使用它的非交互
`BlueStatusNode` 子集；notification 继续使用轻量 `BlueView` 子集。三者共享同一套
renderer-neutral 内容 leaf：

| kind | 形态 | 字段 |
| --- | --- | --- |
| `text` | 一段文本 | `content`，可选 `tone` |
| `fields` | 标签-值对列表 | `rows: BlueField[]`（`label` + `BlueInlineSpan[]`） |
| `code` | 代码块 | `code`，可选 `language` |
| `diff` | 前后对比 | `before` / `after` |
| `sections` | 分节组合 | `sections: BlueSection[]`（`title`、`collapsed` 可选，`body` 递归为 BlueView） |

完整 `BlueUiNode` 还包括 rich-text、stack、surface、scroll、tabs、list、form、
actions、loader、empty、progress、spacer 与 divider。用公开 builder 构造这些节点
见[公共 UI Kit](/plugins/ui-kit)。

样式只有两个维度：

- 语义色调 `BlueTone`：`default | muted | accent | success | warning | danger`——渲染器把它映射到当前主题色，你不选色号；
- 行内强调 `BlueInlineSpan.emphasis: 'strong'`。

**不要**在文本里嵌 ANSI 转义，也不要按终端宽度手工排版。宽度预算是渲染器的事：超宽内容会被统一截断，嵌了 ANSI 的文本反而会把宽度算错、把主题弄脏。

## BlueResult 错误模型

公共边界上的所有失败都是结构化 `BlueResult`，不以异常形式穿越：

```ts
type BlueResult<Value = void> =
  | { ok: true, value: Value }
  | { ok: false, code: BlueErrorCode, message: string }
```

| code | 在何处出现 |
| --- | --- |
| `BLUE_API_INCOMPATIBLE` | `open()`：manifest 字段非法或 `api` 范围与宿主版本不兼容 |
| `BLUE_CAPABILITY_DENIED` | `open()`：申请了当前阶段未开放的能力 |
| `BLUE_DUPLICATE_ID` | `register()`：贡献 id 已被注册（跨所有插件判定） |
| `BLUE_INVALID_CONTRIBUTION` | `register()` / `publish()`：贡献格式不合法（id 字符、缺函数字段等） |
| `BLUE_ACTION_REJECTED` | `register()`：id 占用 Blue 保留命名空间（`blue.` / `blue:` / `blue-` / `@dsh-blue/` 前缀） |
| `BLUE_LIMIT_EXCEEDED` | `register()` / `open()`：贡献超过节点、pane、overlay 或尺寸配额 |
| `BLUE_CAPABILITY_ABSENT` | 可选 Harness 能力探测的降级信号——按降级处理，不是插件失败 |
| `BLUE_ABORTED` / `BLUE_SESSION_UNAVAILABLE` | 动作被中止 / 会话不可用（后续阶段的 session 能力使用） |

对称地，你的 `execute()` 返回 `{ ok: false, code, message }` 时，`message` 会作为错误文本显示给用户；抛出的异常会被桥接层兜底为 `plugin command failed: ...`，但那是兜底，不是契约——主动返回结构化错误。

## Domain 与 adapter 的拆分

`session.read` 尚未开放，所以插件目前**不能**通过 Blue 读会话内容。需要 Harness 侧数据时，走 Cordis 服务注入——你的插件与 Harness domain 插件同处一棵树，可以 `inject` Harness 的官方服务。推荐按 renderer 拆成两个包：

```text
@scope/feature        Domain 包：headless/Web/TUI 共用，不 inject 任何 Blue 服务
@scope/feature-blue   Blue adapter 包：inject bluePluginHost，只做 UI 贡献
```

这样 headless profile（没有 Blue 的树）加载 domain 包也不会 pending 等一个不存在的服务。adapter 里探测到的可选能力缺失时按降级处理：不注册对应贡献，而不是让整棵树挂起。

Blue 自己的 validation-only 包（`blue-context`、`blue-remote`、`blue-openpencil`、`blue-lark`）就是这个形态的官方范例，见[内置插件](/plugins/builtins)。

## 设计纪律

这些底线由 validate 脚本和 code review 共同执行：

- 不 import Blue 包的内部文件——只用 `@dsh-blue/blue-api` 的公开契约；
- 不持有 Agent、Session 或 renderer 对象——数据走 Cordis 服务，UI 走贡献；
- 产品级可变状态不放模块级 singleton（多棵 frontend tree 会共享它）；
- 不在 view 文本里嵌 ANSI、不按终端宽度手工排版；
- 可选能力缺失时降级（不注册对应贡献），不阻塞整树。

## 下一步

- 公开能力的契约表与完整示例：[命令](/plugins/commands) · [状态栏与独占 provider](/plugins/status) · [编辑器扩展](/plugins/editor-extensions) · [编辑器 Provider](/plugins/editor-providers) · [Pane](/plugins/dock) · [通知](/plugins/notifications)；
- Blue 内部 projection/action 边界的完整清单见 [Seam 参考](/plugins/seams)。
