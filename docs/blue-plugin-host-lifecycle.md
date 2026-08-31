# Blue Plugin Host 生命周期规范

> 状态：**Draft / Internal**
> 读者：Blue host、capability owner、bundle composition 和 conformance kit 维护者
> 插件作者只需理解 website 开发手册中的可观察生命周期，不需要实现本文机制。

## 1. 目标

本规范把普通插件获得的数据/注册能力与 Blue 官方 owner 的管理能力分开，并冻结 owner 启停、重载和故障时的可观察结果。它约束权限和行为，不强制某个 TypeScript 类型或名为 `authority lease` 的实现。

## 2. 内部术语

- **消费方 Fiber**：调用 `bluePluginHost.open()` 并只获得 grant facets 的普通插件 Fiber。
- **capability owner**：消费 contribution 或执行 capability action 的 Blue 官方 Fiber。
- **control-plane authority**：attach owner、读取该 capability 的完整 contribution snapshot、观察内部 stream、mint gesture、semantic close 和推进 generation 的内部管理权限。
- **owner generation**：一次成功 attach 的实例代号；新 generation 使旧 handle、callback 和异步结果 stale。
- **owner gap**：capability 已由当前 composition 安装并获准，但 owner 尚未启动、正在 reload 或暂时失败。
- **registration restore**：host 在 owner gap 中保留最新 inert registration，新 owner attach 后收到完整当前 snapshot。

这些词不得成为 quickstart 的前置知识。对外只描述“注册是否保留、操作是否执行、返回什么结构化结果”。

## 3. 权限不变量

普通消费方 MUST NOT 通过以下受支持路径获得 control-plane authority：

- plugin-facing root exports；
- `bluePluginHost.open()` 返回值；
- 可枚举或可直接 inject 的普通 Cordis service；
- Cordis proxy unwrap / `symbols.original`；
- 复制某个 owner helper、构造公开 DTO 或复用其他 Fiber handle。

官方 owner 的权限必须由受信 composition 建立，绑定明确 capability 集合和 owner Fiber，并在 Fiber dispose 时撤销。实现 MAY 使用私有 closure、capability-scoped token、bundle-owned handle 或等价机制；只要 hostile sibling 无法取得、扩大、持久化或转交该权限。

完整 session/projection/action truth 不能作为普通 sibling 可 inject 的 backing service。普通插件只能看到 grant 裁剪的 facade。该约束是进程内架构边界，不声称防御任意恶意同进程 JavaScript。

## 4. Availability

Host 至少区分：

| 状态 | 含义 | Public 结果 |
| --- | --- | --- |
| unsupported | 当前 build/composition 没有 capability 或版本 | required admission 失败；optional unavailable |
| unavailable | capability 已获准，但 owner 当前处于 gap | grant 保持；新 operation 返回 capability-specific fallback/error |
| ready | 当前 generation 已 attach | 正常注册、读取和 action |
| degraded | owner 在线，但单个 contribution/provider 失败 | 隔离调用方并执行 fallback，不扩大 grant |

“代码包里存在 owner 实现”不等于 supported；当前 composition 必须实际安装 capability definition 和受保护的 attach path。App owner 在线但当前没有 session 是 ready 下的 `null`，不是 owner gap。

## 5. 七项 Stable 能力的 gap 行为

| Capability | Gap 中保留 | 新 operation |
| --- | --- | --- |
| `commands` | 最新 command definitions | 不 dispatch consumer handler |
| `status` | 最新 additive nodes | 不 render/call contribution |
| `panes` | 最新 pane definitions | 不 render/dispatch event |
| `overlays` | 不保留 capturing state、handle 或 gesture | `open()` 返回 unavailable，不排队 |
| `notifications.publish` | 不保留 notice queue | 返回未呈现结果，不补发 |
| `session.read` | 只保留 subscription identity | read 返回 unavailable；恢复后先发当前 epoch snapshot |
| `session.projections.read` | 只保留获准 key subscription identity | read 返回 unavailable；恢复后从当前 epoch 的一致 cut 开始 |

Registration restore只恢复最新定义或订阅关系，不伪造 gap 中的连续事件流。旧 session value、overlay、gesture、action、notification、provider failure state 和 callback result均不得跨 generation replay。

## 6. Generation 与 stale fencing

- 每次合法 owner attach 建立新 generation。
- dispatch、snapshot observe、gesture mint、semantic close 和 async completion 都检查当前 generation。
- owner detach、consumer unload、session epoch change 或 AbortSignal 触发后，旧操作返回 `BLUE_STALE` 或 `BLUE_ABORTED`，不得产生副作用。
- consumer registration 的 identity 可以跨 owner generation保留，但不能跨 consumer Fiber 生命周期保留。
- same-id 新 session 必须由 session epoch 区分，不能只比较字符串 id。

## 7. Failure isolation

- 一个 contribution 的 getter、render、handler 或 provider 失败只影响自身。
- owner 不得把缺失解释为授权扩大，也不得回退到 raw backing service。
- 默认状态、主 transcript、editor engine 和 Agent loop 在插件失败时保持可用。
- rate limit、size/depth/node count、timeout 和 concurrency limit 由 host grant/catalog 管理，而不是相信插件声明。

## 8. Acceptance evidence

内部 conformance 至少覆盖：

1. hostile sibling 对 root exports、service injection、proxy unwrap、self-attach、aggregate observe、gesture mint 和 semantic close 的负例；
2. owner boot ordering、reload、activation failure 和 dispose；
3. retained registration只恢复最新 snapshot；
4. overlay/action/notification/gesture/late callback不 replay；
5. consumer unload、owner generation、session epoch 和 abort 的 stale fencing；
6. contribution failure isolation 与默认 fallback；
7. 发布声明的每个 Harness line 的独立 packed composition；`0.1.2-alpha.1`
   仅声明 `0.1.2-alpha.2`，不包含 RC。

PR #77 的 Beta 合并只要求上述可观察边界成立，不要求最终 authority representation 已冻结。协议 `1.0.0` 发布前，具体 owner-only exports、mapping、error taxonomy 和 generation report必须进入机器 contract 与 API declaration gate。
