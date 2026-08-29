# Blue 插件 API v1 设计规范

> 状态：**Draft / Design Source**
> 协议目标：`BLUE_API_VERSION 1.0.0`
> 读者：Blue API、host、validator、installer 与文档维护者
> 插件作者入口：website 的「开发手册」；本文不是入门教程，也不表示当前发布线已实现全部目标。

本文使用 MUST、MUST NOT、SHOULD、SHOULD NOT、MAY 表示规范强度。Blue 产品包可以继续使用 lockstep `0.x` 版本；插件协议 v1 是独立的兼容承诺。

## 1. 术语与职责

面向插件作者的术语跟随 DeepSeek Harness：

- **Harness plugin**：普通 Cordis 插件，导出稳定 `name`、可选 `inject` 和 `apply(ctx)`。
- **Host half / Host plugin**：拥有领域状态、Service Definition、projection、action、tool 或 Harness command 的宿主端插件。
- **Service Definition / Service Provider / 消费方**：Harness 的公开服务约定、实现方和使用方。
- **session projection**：从 session 事实重放得到的当前只读状态。
- **Blue frontend entry**：同一分发包中负责 Blue 呈现与交互的 Cordis entry。
- **composition bundle / profile**：安装、排序和启停插件 entry 的组合单位与运行配置。

Domain、Interaction、Renderer、Composition 是架构职责，不是 manifest 字段。`integrated`、`adapter`、`pure-ui` 只可在迁移指南中用于解释代码组织，不得成为运行时 `form` 或市场等级。

API 实现内部仍可使用 owner、admission、grant、generation 等术语；其权限与重载规则由 [Blue Plugin Host 生命周期规范](./blue-plugin-host-lifecycle.md) 定义，不进入插件作者的基础词汇表。

## 2. 协议边界

Blue 插件 API 只管理 Blue 自己拥有的前端能力，以及对当前绑定 session 的受限只读网关。它不是 Harness API 的通用代理。

```text
公开 Cordis Service        -> 插件直接 inject
Harness session projection -> session.projections.read
Harness command/tool       -> 优先使用 Harness 自己的 registry
只有 Web 私有 HTTP route    -> 先抽 renderer-neutral Service Definition
Blue 前端呈现与交互          -> Blue capability
```

因此：

- 费用、团队、市场、回滚等业务能力属于各自 Host plugin，不成为 `cost.*`、`team.*`、`market.*` 等 Blue capability。
- 不提供 generic `host.invoke`、raw Agent/Session/SessionEvent 或通用 `session.act`。
- UI 不得自行折叠 Harness session event，也不得保存第二套领域真相。
- Blue API 不暴露 pi-tui、ANSI、raw terminal、DOM/React、terminal width、focus handle 或 renderer object。
- 插件配置与持久化直接使用公开 Harness Service；Blue 不包装第二套 storage。
- capability admission 是架构和最小权限边界，不是恶意同进程代码的安全沙箱。

## 3. 分发与发现

每个可安装的 Blue frontend entry 所在包 MUST 在 `package.json` 中声明唯一发现入口：

```json
{
  "name": "@scope/example-plugin",
  "blue": {
    "manifest": "./blue.plugin.json"
  }
}
```

规则如下：

- 一个包只有一个 v1 manifest，且只支持上述发现方式。
- manifest `id` MUST 等于 `package.json.name`。
- manifest `entry` MUST 是该包 `exports` 中的公开 subpath，例如 `.` 或 `./blue`。
- Cordis entry `name`、profile patch row `id` 和 npm package name 是不同命名空间。
- validator MUST 检查 manifest、exports、`files` whitelist 与实际 `npm pack` tarball 一致。
- installer receipt、tarball integrity 和来源 commit 由安装器记录，不写进作者 manifest。

JSON Schema Draft 2020-12 是 manifest shape 的唯一机器真相；共享 semantic validator 负责跨字段、package、exports 和 semver 规则。目标形状为：

```json
{
  "$schema": "https://dsh-blue.dev/schema/blue.plugin.v1.schema.json",
  "schemaVersion": 1,
  "id": "@scope/example-plugin",
  "entry": "./blue",
  "api": "^1.0.0",
  "compatibility": {
    "blue": ">=0.1.0 <0.2.0",
    "harness": ">=0.1.1-rc.2 <0.2.0",
    "node": "^22.19.0 || >=24.0.0"
  },
  "capabilities": {
    "required": [
      { "name": "status", "version": "^1.0.0" }
    ],
    "optional": [
      {
        "name": "session.projections.read",
        "version": "^1.0.0",
        "resources": { "keys": ["costUsage"] }
      }
    ]
  }
}
```

`schemaVersion`、`id`、`entry`、`api`、`compatibility` 和 `capabilities` 全部 required。未知字段必须被拒绝；同一 capability 在 required/optional 内和跨组均唯一；resource 使用按 capability 判别的 schema。Experimental capability 只能出现在 optional。

持久化 entry MUST 导入并解析发布包中的同一份 `blue.plugin.json`，不能在 `open()` 旁手写第二份 manifest。创造模式的动态原型使用由同一 catalog 校验的临时 request；它没有 package identity、entry 或发布一致性声明，不能冒充 v1 conformance。

## 4. 协商与授权

```ts
interface BluePluginHost {
  readonly version: string
  open(owner: BlueEffectOwner, manifest: BluePluginManifest): BlueResult<BluePluginOpen>
}

interface BluePluginOpen {
  readonly api: BluePluginApi
  readonly grants: readonly BlueCapabilityGrant[]
  readonly unavailableOptional: readonly BlueCapabilityUnavailable[]
}
```

协商 MUST 遵循：

1. required capability 不受当前 build 支持、版本不相交、被 policy 拒绝或 resource 不能完整授权时，`open()` 原子失败且不留下注册。
2. optional capability 缺失或只获部分 resource 时不阻止插件加载；插件以 `grants` 和 `unavailableOptional` 为准。
3. host 返回实际选中的精确 capability version、resources、limits 与 quotas。
4. API object 只包含获准 facet；重复 open、重复 contribution id、越权 resource 和 stale write 返回结构化错误。
5. grant 在消费方 Fiber 生命周期内有效；owner 短暂重载不重新解释为“不支持”。可观察规则见第 6 节。

## 5. Stable v1 capability catalog

v1 只冻结七项能力：

| Capability | 用途 | 资源与边界 | 缺失/失败行为 |
| --- | --- | --- | --- |
| `commands` | 注册 Blue-local、带结构化结果的命令 | 名称、数量、并发和 user gesture 受 grant 限制 | 隐藏入口或使用插件自己的 Harness command |
| `status` | 注册紧凑、非交互状态节点 | frontend tree scope；不能接管整个 footer | 只隐藏失败 contribution，默认状态保留 |
| `panes` | 注册 header/left/right/bottom managed pane | placement、数量、尺寸受 grant 限制 | 按声明降级或隐藏，不破坏主界面 |
| `overlays` | 在有效 user gesture 中打开 managed overlay | capturing 数量、focus 与 timeout 由 host 管理 | 返回原 surface，不劫持 focus |
| `notifications.publish` | 发布有界、可去重的 transient notice | 只有 publish；没有全局 observe | sink 缺失时返回未呈现，不建立队列 |
| `session.read` | 读取当前绑定 session 的裁剪 snapshot | 只允许获准的 identity/cwd/status/mode/model 字段 | 无 session 返回 `null`；owner 不可用返回结构化错误 |
| `session.projections.read` | 读取/订阅获准的 Harness projection key | 精确 key allowlist、一致 cut、size bound、epoch/seq | key 或 owner 不可用时返回结构化错误，不复用旧值 |

`commands` 只用于需要 Blue UI result/gesture 的入口；能由 Harness command registry 完整表达的领域命令 SHOULD 直接注册到 Harness。

`session.read` 和 `session.projections.read` 只返回 readonly、可 clone/freeze 的值，不返回 Agent、Session、Promise、callback 或写方法。projection 的 schema 和业务含义仍由注册该 projection 的 Host plugin 所有。

以下能力不进入 Stable v1 root：provider、conversation extension、theme/settings、editor extension/provider、tool presentation 和 market operation。它们可以在后续 1.x 经过真实消费者共创后，以 Beta/Experimental subpath 提案；不得为了单一插件提前塞进 Stable catalog。

## 6. 生命周期与可观察行为

- 所有注册、订阅、timer 和 in-flight work 绑定消费方 Cordis Fiber；unload 后必须撤销并拒绝 late result。
- `commands`、`status`、`panes` 的最新注册可在官方 UI owner 短暂重载期间保留，恢复后重新挂载。
- overlay、notification、user gesture、action 和旧 callback result 不排队、不重放。
- `session.read` 与 projection subscription 恢复时先取得当前 epoch 的一致 snapshot，再恢复 live update；旧 session/epoch 值不得冒充当前状态。
- contribution failure 只隔离自身；不得扩大 grant、切换到 owner-only service 或让 Agent loop 失败。
- public API 只描述这些可观察结果；authority、generation 和内部 attach 机制由 host 生命周期规范约束。

## 7. 版本与兼容性

- Blue 产品包继续 lockstep `0.x`；插件协议独立使用 semver。
- schema、TypeScript API、runtime validator、capability catalog、模板、skills 和 website reference 共享同一 protocol version stamp。
- 发布不可变 schema/API subpath，并提供机器可读的 Blue product version -> protocol version 映射。
- 当前 Harness line 与上一条受支持 line 都必须通过 packed-install fixture；支持范围以映射和实际 fixture 为准，不以宽泛 range 推测。
- Stable API 的破坏性变更需要协议 major；新增 optional capability 或 resource 可走兼容的 1.x 演进。

基础错误分类至少包含：API 不兼容、capability 不支持、policy/resource 拒绝、重复 identity、当前不可用、stale/aborted、限额、timeout 和内部隔离。错误必须是 `BlueResult`，包含稳定 code 和可操作 message；插件不得解析 message 取代 code。

## 8. Stable 晋升与发布门

一项 capability 只有同时满足以下条件才可标 Stable：

1. Blue 有真实 owner 和官方/reference consumer；
2. 至少一个真实 Harness 插件通过公开 API 消费该能力；作者是否已经合并上游不改变技术证据；
3. 现有公开 Harness Service、projection、command 或 tool 无法完整替代该能力；
4. 有 capability-absent/plain fallback；
5. 独立 `npm pack` fixture 在当前/上一 Harness line 执行全部适用场景；
6. unload/reload、late result、abort/stale、width 或 replay/resume 证据按能力齐全；
7. website 开发手册、作者 skill 和 API reference 与机器 catalog 一致。

Conformance 报告必须记录 source commit、tarball digest、Blue product/protocol/Harness versions、declared/granted capabilities、declared/executed/skipped/failures、fallback、unload、width 和 cleanup。硬门为 `declared == executed`、`skipped == []`、`failures == []`、cleanup 成功。作者联系与认可状态单独记录，不混入 conformance 结论。

## 9. 作者文档边界

Public Beta 后，website「开发手册」按任务递进组织：开始开发、选择接入路径、架构、包与 manifest、UI capability、session 数据、生命周期、Web 迁移、创造模式、验证发布、案例和 API reference。Quickstart 不出现 control-plane、owner generation 或集成形态分类；内部实现文档不得成为作者完成第一个插件的前置阅读。PR #79 只冻结这项文档边界，不发布一套早于可执行 schema/catalog 的 v1 教程。
