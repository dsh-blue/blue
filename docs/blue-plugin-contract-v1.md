# Blue 插件协议 v1 目标态契约

> 状态：**Draft / Target State**
> 协议版本：`BLUE_API_VERSION 1.0.0`
> 适用对象：Blue 插件作者、Blue capability owner、安装器、验证器和插件市场
> 重要：本文描述 v1 发布时必须成立的目标态，不表示 `master` 或 PR #77 已全部实现。

本文使用 MUST、MUST NOT、SHOULD、SHOULD NOT、MAY 表示规范强度。Blue 产品可以继续使用 `0.x` prerelease 版本；插件协议 `1.0.0` 是独立的兼容承诺。

## 1. 目标与边界

Blue 插件协议只管理 **Blue 自己拥有的前端权力，以及 Blue 对当前绑定 session 的受限 mediation gateway**。后者只裁剪公开 Harness snapshot/projection，不取得 domain authority。Capability 不是插件功能分类，也不是对 Harness API 的通用代理。

```text
公开 Cordis service       -> 插件直接 inject
Harness projection        -> 受资源约束的 projections.read
Host command/tool         -> 优先使用 Harness 自己的 registry
仅存在于 HTTP/app 闭包    -> 上游先抽 renderer-neutral service
Blue 前端自身权力         -> Blue capability
```

因此：

- `cost.*`、`browser.*`、`rewind.*`、`market.*` 属于各 domain 插件，不是 Blue capability。
- 不提供 generic `host.invoke`、raw Agent/Session/SessionEvent 或通用 `session.act`。
- 插件配置和持久化直接使用公开的 `@deepseek-ai/dsh-settings` service；Blue 不再包装一套 storage 真相。
- Blue API 不暴露 pi-tui、ANSI、raw terminal、DOM/React、terminal width、focus handle 或 renderer object。
- Capability admission 是架构和最小权限边界，不是恶意代码沙箱。第三方 npm/GitHub 代码仍由用户决定是否信任。

一个新 capability 只有同时满足以下条件，才 MAY 进入 Stable：

1. 至少有两个独立消费者，其中至少一个是 Blue 官方/reference consumer，至少一个来自独立生态包；
2. 现有公开 Cordis/Harness service、projection、command 或 tool 无法表达；
3. authority 确实由 Blue frontend tree、当前 session binding 或 renderer 持有；若数据源属于 Harness，Blue 只提供受资源约束的当前绑定/projection adapter，不取得 domain authority；
4. API renderer-neutral、按最小权限和资源授权；
5. owner 缺失或 contribution 失败时存在可用 fallback；
6. 有 official consumer、独立 packed fixture、unload/late-result、abort/stale、provider swap 或 width 证据（按能力适用）。

## 2. 架构角色与三种分发形态

Domain、Interaction、Renderer、Composition 是代码职责；`integrated`、`adapter`、`pure-ui` 是 manifest 所声明 Blue entry 的集成形态。两组概念 MUST NOT 混为一谈。`form` 不给同仓的 Web、daemon 或其他 sibling entry 分类，只约束该 Blue entry 的依赖闭包和运行时行为。

| `form` | Blue entry 拥有或消费的内容 | 必须证明 | 禁止事项 |
| --- | --- | --- | --- |
| `integrated` | 同一分发包内的 headless domain 能力和 Blue interaction entry | Blue 不存在时 domain 仍可加载；domain 与 UI 有独立 scope/Fiber；UI 只消费公开 service/projection | domain import Blue；UI 成为业务真相；headless 因缺 renderer pending |
| `adapter` | 对另一个插件公开 service/projection/action 的 Blue 适配 | `inject` 明确上游服务；adapter 无第二套业务状态；记录上游原生前端契约可用后的删除条件 | 穿透 Agent/Session；import 上游 internal；把 HTTP route 当 API |
| `pure-ui` | 仅由 Blue 前端拥有的主题、导航、编辑辅助或静态 UI | 无 Harness domain 对象；缺 capability 时 inert/plain fallback；运行态限定在 frontend tree/provider Fiber，UI preference/history 只能经直接注入的公开持久化 service 保存 | 自建 domain 真相；依赖 renderer internal；绕过 host validation |

`form` MUST 写入 manifest 并参与 validator 与 packed fixture，但它本身不授予任何 capability。一个 npm 包只有一个 manifest/form；一个 monorepo MAY 通过多个发布包提供多种 form。若 sibling Web entry 含 domain/runtime 逻辑，pure-ui 判定只看 Blue entry 可达依赖仍不够，fixture 还必须证明该 entry 加载时不启动或依赖这些逻辑。

每个 Cordis entry 继续导出稳定 `name`、可选 `inject` 和 `apply(ctx)`。业务 service 依赖只在 `inject` 和 package peer/dependency 中声明，MUST NOT 在 Blue manifest 中复制第二份服务依赖表。

## 3. 身份、分发与 manifest

### 3.1 单一身份链

每个 Blue v1 分发包 MUST 在 `package.json` 中声明：

```json
{
  "name": "@scope/example-blue",
  "blue": {
    "manifest": "./blue.plugin.json"
  }
}
```

规则如下：

- 一个包只有一个 v1 manifest；`blue.manifest` 是发现入口。
- manifest `id` MUST 等于 npm `package.json.name`，用于安装去重、授权 namespace 和诊断。
- manifest `entry` MUST 是该包 `exports` 中的公开 subpath（如 `.` 或 `./blue`），不能是 `lib/index.js` 等内部文件路径。
- Cordis entry 导出的 `name` 是运行时插件名，profile patch row `id` 是 composition-local 名称；二者与 package id 是独立命名空间，不要求相等。
- validator MUST 验证 manifest、exports、`files` tarball whitelist 和实际 packed tarball 闭包一致。
- tarball integrity、来源 commit 和安装时间属于 installer lock/receipt，MUST NOT 由包作者写入 `blue.plugin.json`。

### 3.2 v1 manifest 形状

JSON Schema Draft 2020-12 是 manifest shape 的唯一机器真相；Schema 加版本化 semantic validator 构成完整机器契约。Semantic validator 只补跨字段、package/exports 和 semver 规则，不能重新定义 shape。下列 compatibility range 只演示字段和合法 semver，不替代发布时的受支持版本矩阵：

```json
{
  "$schema": "https://dsh-blue.github.io/blue/schema/blue.plugin.v1.schema.json",
  "schemaVersion": 1,
  "id": "@scope/example-blue",
  "entry": "./blue",
  "api": "^1.0.0",
  "compatibility": {
    "blue": ">=0.1.0-rc.10 <1",
    "harness": ">=0.1.1-rc.2 <0.2.0",
    "node": "^22.19.0 || >=24.0.0"
  },
  "form": "adapter",
  "capabilities": {
    "required": [
      { "name": "panes", "version": "^1.0.0" }
    ],
    "optional": [
      {
        "name": "projections.read",
        "version": "^1.0.0",
        "resources": { "keys": ["costUsage"] }
      }
    ]
  }
}
```

规范要求：

- `schemaVersion`、`id`、`entry`、`api`、`compatibility`、`form`、`capabilities` 全部 required。
- Schema 对未知字段使用 `additionalProperties: false`；扩展通过 schema/API 版本演进，不靠静默接受拼写错误。
- `api`、compatibility range 和 capability `version` MUST 由真实 semver 实现验证，不能只用正则近似。
- 同一 capability name 在 required、optional 两组内及跨组均 MUST 唯一。跨数组唯一性由共享 semantic validator 检查，不能假定标准 JSON Schema 能单独表达。
- `resources` 使用按 capability 判别的 schema；不接受任意对象。
- Experimental capability 只能出现在 `optional`，插件 MUST 在其缺失时继续加载。

插件入口 MUST 导入并解析发布的同一份 `blue.plugin.json`，再交给 host；禁止在 `open()` 旁手写第二份 manifest。目标入口流程为：

```ts
const parsed = parseBluePluginManifest(rawManifest)
if (!parsed.ok) return
const opened = ctx.bluePluginHost.open(ctx, parsed.value)
```

## 4. Capability 协商

目标公共形状：

```ts
interface BluePluginOpen {
  readonly api: BluePluginApi
  readonly grants: readonly BlueCapabilityGrant[]
  readonly unavailableOptional: readonly BlueCapabilityUnavailable[]
}

interface BluePluginHost {
  readonly version: string
  open(consumer: BlueEffectOwner, manifest: BluePluginManifest): BlueResult<BluePluginOpen>
}
```

协商 MUST 遵循：

1. required capability、版本或所声明资源有任意一项不能满足，`open()` 整体失败且不留下 registration。
2. optional capability 缺失、被 policy 拒绝或版本不兼容，不阻塞插件；原因进入 `unavailableOptional`，对应 API facet 不存在。
3. required 项的资源是 all-or-nothing；optional 项 MAY 获得请求集合的子集，插件以 `grants` 为准。
4. host 返回的 limits/quotas 是 grant 的一部分，不由插件自行宣称。
5. API object 只包含实际获准 facet。注册之后 owner 临时替换时，host MUST 按该 capability 的 retained/fallback 规则处理，并在每次写入时复查 owner generation。
6. capability version 独立于 Blue 产品版本；host 返回实际选择的精确版本。
7. 同一 plugin Fiber 重复 `open()`、重复 contribution id、越权资源和 stale write 必须返回结构化错误。

`BlueEffectOwner` 表示调用 entry 当前 Cordis Context/Fiber 的 effect ownership，不是普通插件可构造的权限 token。`open()` 成功后，host MUST 把该 Fiber 的 dispose 级联到所有注册、订阅和 in-flight action；插件 MAY 提前关闭自己的 handle，但不能关闭其他插件或 owner。

## 5. Stable v1 Capability Catalog

下表是 **v1 发布目标**；当前实现状态见 [PR #77 收敛矩阵](./blue-pr77-convergence-matrix.md)。

| Capability | Authority owner / scope | 插件获得的 API | Resource / fallback | 候选证据 |
| --- | --- | --- | --- | --- |
| `commands` | interaction owner / frontend tree | 注册 Blue-local command，带 AbortSignal 和 user gesture | 名称、数量与执行并发受 grant 限制；缺失时插件直接使用自己的 domain command 或隐藏入口 | Lark、dsh-context |
| `status` | status composition / frontend tree | 注册紧凑、非交互 `BlueStatusNode` | contribution 失败只隐藏自身；默认 status 永远保留 | Cost Meter、Peak Indicator、dsh-context |
| `panes` | surface manager / frontend tree | 注册 header/left/right/bottom managed pane | placement、数量、尺寸由 grant 限制；窄屏按声明降级或隐藏 | Cost Meter、dsh-context、Conversation Navigator |
| `overlays` | overlay manager / frontend tree | 在有效 user gesture 中打开 managed overlay | capturing overlay 数量受限；失败回到原 surface，不劫持 focus | Rewind、dsh-context |
| `notifications.publish` | notification model / frontend tree | 发布有界、可去重 transient notice | 不包含全局 observe；sink 缺失时丢弃并返回 availability | Lark、OpenPencil |
| `status.provider` | status provider composition / provider Fiber | 注册 inert provider candidate | 安装/priority 不自动激活；用户选择、dry render、LKG、breaker、default fallback | official default、dsh-status-bar minimal provider slice |
| `session.read` | Blue app mediation gateway / current session | readonly current snapshot 与 subscription | `fields` 只允许 `identity/cwd/status/mode/model`；无会话返回 `null`；不得含写方法 | dsh-context、Conversation Navigator |
| `projections.read` | Blue allowlisted gateway over Harness adapter / session | 从一致 cut 读取并订阅已授权 projection key | `keys` 必须精确 allowlist；值有大小上限；owner 缺失时该 key unavailable | dsh-context、Cost Meter |
| `conversation.read` | conversation model owner / session | 有界分页读取 normalized entries 和 revision | 当前 session、cursor、page size 和内容类别受限；不返回 raw event log | Conversation Navigator、Rewind（service 前置） |
| `conversation.navigate` | transcript/navigation owner / frontend tree | 按稳定 item ref 定位当前 conversation viewport | navigation 不修改 session；目标已淘汰时返回 stale | Conversation Navigator、Message Edit fixture |
| `conversation.itemActions` | conversation interaction owner / frontend tree | 为 item 贡献适用性、label 和 user-triggered handler | ref 含 `sessionEpoch/itemId/revision`；Blue 只调度，业务执行调用插件自己的 service | Rewind（service 前置）、Message Edit（service 前置）、Bookmark/Tag reference fixture |
| `theme.provider` | theme composition / provider Fiber | 注册 renderer-neutral semantic token candidate | 用户选择、token 完整性检查、default fallback；插件不能输出 ANSI/CSS | Catppuccin |
| `settings.sections` | settings UI owner / frontend tree | 向 Blue 设置界面贡献 section/form/action | 只拥有呈现；schema、读写与持久化仍由插件注入的 `dsh-settings` service 负责 | Catppuccin、Lark |

`commands` 只适用于需要 Blue UI result/gesture 语义的本地入口。能够由 Harness command registry 完整表达的 domain command SHOULD 直接注册到 Harness，避免双重发现源。

### 5.1 Session 与 projection 资源

`session.read` 的字段组含义固定如下：

| Field group | 允许数据 |
| --- | --- |
| `identity` | opaque session id、`sessionEpoch`、snapshot `revision` |
| `cwd` | 当前工作目录；没有申请时 provider 不应通过其他 Blue snapshot 获得 |
| `status` | idle/running/waiting/failed 等 renderer-neutral 状态 |
| `mode` | normal/plan/yolo 的只读有效值 |
| `model` | provider/model/effort 的只读显示事实 |

`status.provider` 固有 snapshot 只含 status composition 自己拥有的 busy、additive entries、viewport/theme facts。provider 若要 session id、cwd、mode 或 model，MUST 另行申请相应 `session.read` resource；不存在隐藏授权。

`projections.read` 每次读取 MUST 返回 `sessionEpoch`、一致 cut 的 `asOfSeq` 和 immutable value。key unload、session switch、duplicate/older sequence 和 late callback MUST 被区分；generic reader 不允许任意字符串越过 manifest allowlist。

### 5.2 Conversation item action

`conversation.itemActions` 是扩展点，不是 Rewind 特化：

```text
Blue 提供 item ref + 当前 revision + user gesture + AbortSignal
插件判断 isApplicable
用户选择 action
Blue 复查 epoch/revision 后调度
插件调用自己 inject 的 domain service
```

Blue MUST NOT 定义 `rewind.apply`、`message.edit` 等业务 action。相同扩展点由 Rewind、Message Edit 和无 domain mutation 的 Bookmark/Tag reference fixture 共同验证泛化性；Peak Indicator 属 additive status，不能拿来充当 item action 证据。

## 6. Experimental 与 Deferred

### 6.1 Editor Experimental

PR #77 证明 editor extension runtime 可以拥有 revision fencing、completion abort、submit transform 和 unload cleanup，但一个 `editor.extensions` 同时授予被动绘制、读取、写 draft 和改写提交的权力过宽。v1 将其拆为：

| Capability | 权力 |
| --- | --- |
| `editor.decorations` | hint、diagnostic、before/after passive node 和结构化 action |
| `editor.completions` | 接收有界 query/trigger，异步返回 completion；必须支持 abort/stale |
| `editor.draft.read` | 读取当前 draft 的 readonly、revisioned snapshot |
| `editor.draft.write` | 以 expected revision 提交 replace/insert 等结构化变更 |
| `editor.submit.transform` | 在有界流水线中转换提交值；顺序、timeout、abort 和 rollback 明确 |

以上在 v1 schema 中标为 Experimental，只能 optional。Composer History 是 draft read/write 压力 fixture；`@`/`#` completion 与 submit transformer 分别有独立 fixture，不能由一个“大而全”样例替代。公开 TypeScript 类型和 runtime admission MUST 接受同一 node 集合；PR #77 中 `before/after: BlueUiNode` 比 runtime passive subset 更宽的状态不能带入稳定声明。

### 6.2 Deferred

以下名字不进入 v1 public manifest：

- `editor.provider`：等待 capture -> abort -> dispose -> activate -> restore、第二个真实 provider 和完整 draft/history/mode/attachments/focus/IME fixture。
- `editor.keys` / contextual key interception：等待按 editor state、cursor edge 和 IME transaction 泛化；不得为 Composer History 单独开放 raw key handler。
- tool presentation：现阶段由 Blue 官方 renderer 和 Harness tool presenter seam 处理。
- conversation presentation policy：等待多个独立 renderer consumer。
- full frontend/composition provider：只允许受信 bundle composition，不能伪装成普通动态插件 capability。

以下名字被明确拒绝：`session.act`、`notifications.observe`（仅 owner/internal）、`storage`、`renderer.provider`、`host.invoke` 和任何 domain-specific capability。

## 7. 数据、action 与 renderer-neutral 约束

- 事件表示已发生事实，projection 表示当前状态，action 表示有结果的写请求。
- 公共 snapshot/model MUST readonly、有限、有 scope，并且不能包含 Promise。异步只存在于 action/provider callback 边界。
- UI node 是 renderer-neutral 的结构化数据。注册在同一进程内的 callback 和 AbortSignal 是 process-local handle；协议不宣称整个 contribution 可 JSON 序列化或跨进程传输。
- UI 不能折叠 raw Harness session event，也不能保存第二套 Agent 真相。
- 每个 session/action ref MUST 带 epoch/revision；same-id new epoch、session switch、provider generation 更替后，旧 callback 返回 `BLUE_STALE`。
- 危险 action、capturing overlay 和 item action MUST 由 Blue 在真实用户 dispatch 中铸造一次性 gesture；token 在 async handler settle/abort/unload 后失效。
- renderer failure 只隔离当前 contribution；不能拆 Agent loop、当前 provider 或其他插件 surface。

## 8. Scope、owner 与生命周期

| Scope | 允许持有的状态 | 不得泄漏到 |
| --- | --- | --- |
| host | capability catalog、安装 policy、跨 session registry | session snapshot、renderer object |
| agent | tool/persona/preset 等 Harness-owned state | Blue public DTO |
| session | projection、epoch、structured action fencing | frontend focus/draft |
| frontend tree | 当前 session binding、pane/overlay、draft、focus、active provider | durable domain truth |
| provider Fiber | candidate subscription、timer、cache、in-flight callback | 其他 provider generation |

所有 register/subscribe/timer/overlay/pending action MUST 绑定调用方 Cordis Fiber。dispose 必须幂等；unload 后的新写入、late callback 和 retained gesture MUST 被拒绝。

Provider host 持续存活；切换顺序为：

```text
capture -> abort -> dispose -> activate -> restore
```

candidate 在选择前 inert。激活失败保留旧 provider 或回退 default；运行失败触发 generation-scoped breaker。安装顺序、priority 或 provider 自己的请求永远不能改变用户选择。

公共 `bluePluginHost` 只能暴露版本、协商和已授予 API。owner attach、aggregate snapshot、notification observe、gesture mint 和强制 close 等 control-plane 操作 MUST 需要 bundle composition 创建的不可伪造 authority/lease；它们不得从 plugin-facing root 获得。Cordis `symbols.original` 不能成为权限升级路径。

## 9. 错误、限制与 fallback

所有公共失败返回 `BlueResult`，异常不得穿越插件边界。v1 runtime error taxonomy 至少包含：

| Code | 含义 |
| --- | --- |
| `BLUE_API_INCOMPATIBLE` | API/capability semver 不相交 |
| `BLUE_CAPABILITY_ABSENT` | required owner/surface 当前不存在 |
| `BLUE_CAPABILITY_DENIED` | host policy 拒绝 capability |
| `BLUE_RESOURCE_DENIED` | capability 存在但所需资源未获授权 |
| `BLUE_DUPLICATE_ID` | plugin/contribution identity 冲突 |
| `BLUE_INVALID_CONTRIBUTION` | schema、shape、node 或 callback 不合法 |
| `BLUE_LIMIT_EXCEEDED` | quota、大小、深度、速率或并发超限 |
| `BLUE_ABORTED` | caller、owner 或 unload 已中止操作 |
| `BLUE_TIMEOUT` | owner-defined 有界 deadline 到期 |
| `BLUE_STALE` | session/request/provider/item revision 已过期 |
| `BLUE_UNAVAILABLE` | 运行时依赖暂不可用 |
| `BLUE_ACTION_REJECTED` | 当前状态不允许该结构化 action |
| `BLUE_INTERNAL_ERROR` | owner 已隔离的非预期错误；不得泄漏敏感细节 |

Manifest/schema 错误有独立、稳定的 validation code。validator、installer 和 runtime parser MUST 使用同一 schema/semantic validator，不得各写一套字段规则。

字符数、node 深度、collection、pane/overlay 数、刷新率和并发限制由 host grant 返回。协议可在兼容范围内调整默认 quota，但不能低于已接受 contribution 的当前 grant；超限只影响调用方。

每个 capability MUST 在 catalog 中写明 absent、runtime failure、owner unload 和 provider failure fallback。没有 fallback 的 capability 不能 Stable。

## 10. 版本演进

- `schemaVersion` 只在 manifest 结构不兼容时递增。
- `BLUE_API_VERSION` 使用 semver；Stable public type 删除、含义改变或 grant 收窄需要 major。
- capability 自有 semver；新增 optional 字段、错误细分和新 optional capability 可以 minor。
- Experimental capability 不构成 1.x 稳定承诺；每次变更必须更新其 capability prerelease/minor、fixture 和迁移说明。
- Blue 产品版本由 release line 独立管理；`0.x` 产品可以承载稳定 `BLUE_API_VERSION 1.0.0`。
- PR #77 合并时只能声明 `1.0.0-beta.1`。只有本文全部 Stable 条款和路线门禁通过后，才可发布 `1.0.0`。

## 11. Conformance 与发布判定

一个 capability 标记 Stable 前必须同时具备：

1. schema request/resource 定义和生成的 TypeScript name/type；
2. public API facet 与不可由第三方获得的 owner control plane；
3. 默认 composition 中的真实 owner；
4. 至少两个独立消费者，其中一个是 Blue official/reference consumer，另一个来自独立生态包；
5. capability-absent/plain fallback；
6. unit/compile contract，以及适用的 replay、abort、stale、unload、late callback、swap、width fixture；
7. 从 `npm pack` tarball 在独立临时项目安装、只走 public exports 的 fixture；
8. 当前和上一受支持 Harness exact line 的一致结果；
9. package exports/files/tsdown、bundle composition、真实 profile 和人工验收证据；
10. 中英文开发者文档、迁移说明和已更新的开发/迁移/fixture/validation skills。

Fixture 报告的 `declared` 与 `executed` 必须完全相等，`skipped` 和 `failures` 必须为空。自动门禁不能替代需要真人判断的 profile 验收。

本文是长期协议真相；实现进度不写在这里。PR #77 的差异和 owner 状态由收敛矩阵维护，交付顺序由 v1 roadmap 维护。
