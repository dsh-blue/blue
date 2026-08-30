# 核心概念

本篇解释 Blue 插件模型的四个支柱：Cordis 树与 Fiber 生命周期、capability 裁剪、canonical node 词汇表、`BlueResult` 错误模型，以及 domain/adapter 拆分。读完你会理解每个能力页里契约表背后的"为什么"。

## Cordis 树与 Fiber 生命周期

dsh 进程里只有一棵 Cordis 插件树。Harness domain 插件（agents、sessions、tools、approval）、Blue 的 33 条自有行（含 private runtime group）、你的插件，都是这棵树上的组合行：

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

Canonical manifest 是插件的静态兼容性与最小权限声明：

```ts
interface BluePluginManifestV1 {
  $schema: 'https://dsh-blue.dev/schema/blue.plugin.v1.schema.json'
  schemaVersion: 1
  id: string
  entry: string
  api: string
  compatibility: { blue: string; harness: string; node: string }
  capabilities: {
    required: BluePluginCapabilityRequestV1[]
    optional: BluePluginCapabilityRequestV1[]
  }
}
```

`open()` 的行为分三层：

1. **P1 机器校验**：`validateBluePluginManifestV1` 按 Draft 2020-12 schema 和语义规则校验 identity、public export entry、API/product compatibility、required/optional 分组、resource 与重复能力，成功值会被分离并深冻结；
2. **P2 原子协商**：required 能力任一不可用则整体拒绝；optional 能力可部分获准，host 返回包含 version、exact resources、limits、quotas、availability 和 owner generation 的 grants，以及结构化 `unavailableOptional`；
3. **按 grant 裁剪返回**：`BluePluginOpen.api` 只在获准能力上提供 facade。访问时使用 `opened.value.api.commands?.register(...)`，并检查每个返回的 `BlueResult`。

裁剪是双向契约：你只拿到你声明的，宿主也只暴露你声明的。插件升级时要新能力，就向 required 或 optional 加一个精确 request；宿主版本、policy 或 owner 不满足时会在 `open()` 阶段明确失败/降级，而不是运行时才出错。

::: info 过渡期 lane
旧 flat `{ id, api, capabilities: string[] }` 仍仅为 PR #77 兼容示例保留。它没有 canonical resource/grant/denial 语义，新插件不应使用。任何带 `$schema` 的 manifest 都必须通过 canonical parser，不会回退。
:::

缓冲只保存 inert contribution，不代表插件获得了 renderer 或调度权。active frontend-tree owner 仍负责 provider selection、render、gesture、LKG/breaker 和 fallback。每次 owner attach 都获得私有 generation-bound lease；任何 capability 重叠会原子撤销旧 lease 的全部能力，迟到 callback/gesture/overlay close 都按 generation 拒绝。owner gap/reload 后只重放 definition snapshot，不重放 overlay、notification 或 action；consumer Fiber 卸载会立即删除它的 registration。

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
| `BLUE_CAPABILITY_DENIED` | 旧 inline `open()`：申请了 transition host 未开放的 facet |
| `BLUE_CAPABILITY_UNSUPPORTED` | canonical `open()`：required capability 不在当前 composition |
| `BLUE_CAPABILITY_VERSION_UNSUPPORTED` | canonical `open()`：required capability version range 不相交 |
| `BLUE_POLICY_DENIED` | canonical `open()`：required capability 被 Host policy 拒绝 |
| `BLUE_RESOURCE_DENIED` | canonical `open()` / facade：resource kind、数量或 exact grant 不满足 |
| `BLUE_DUPLICATE_ID` | `register()`：贡献 id 已被注册（跨所有插件判定） |
| `BLUE_INVALID_CONTRIBUTION` | `register()` / `publish()`：贡献格式不合法（id 字符、缺函数字段等） |
| `BLUE_ACTION_REJECTED` | `register()`：id 占用 Blue 保留命名空间（`blue.` / `blue:` / `blue-` / `@dsh-blue/` 前缀） |
| `BLUE_LIMIT_EXCEEDED` | `register()` / `open()` / `publish()` / `refresh()`：超过 contribution、pane/overlay、大小或滚动速率配额 |
| `BLUE_CAPABILITY_ABSENT` | notification/session/projection read 的 active owner 或 backing key 缺位，或当前 host/profile 未提供该 capability；按版本/profile 不匹配或可选降级处理 |
| `BLUE_STALE` | owner/session generation 已前进，旧 action、event、snapshot 或 callback 结果被拒绝 |
| `BLUE_ABORTED` | command/event work 已由 signal、unload、refresh 或 session change 中止 |
| `BLUE_INTERNAL_FAILURE` | owner read/adapter 失败且已被边界收容；记录诊断并降级，不要重试风暴 |

对称地，你的 `execute()` 返回 `{ ok: false, code, message }` 时，`message` 会作为错误文本显示给用户；抛出的异常会被桥接层兜底为 `plugin command failed: ...`，但那是兜底，不是契约——主动返回结构化错误。

## Domain 与 adapter 的拆分

`session.read` 提供 exact-field、epoch/revision-fenced 的当前会话摘要；`session.projections.read` 提供 exact-key、epoch/seq-fenced 的 JSON projection cut。Generic `session.act` 已移除；写操作必须使用拥有该语义的公开 Harness service、command 或 feature action。详见[会话只读数据](/plugins/session)。需要完整 Harness domain 数据时也应走官方 Cordis 服务，而不是读取 Blue owner-only backing service。推荐按 renderer 拆成两个包：

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

- 当前 Beta 能力的契约表与完整示例：[命令](/plugins/commands) · [状态栏](/plugins/status) · [Pane](/plugins/dock) · [通知](/plugins/notifications) · [会话只读数据](/plugins/session)；编辑器扩展、编辑器 Provider 与独占 status provider 仅为 Experimental/reference surface；
- Blue 内部 projection/action 边界的完整清单见 [Seam 参考](/plugins/seams)。
