# 会话只读数据

Canonical Beta 提供两个彼此独立的只读 capability：`session.read` 读取当前会话摘要，`session.projections.read` 读取 Host 插件拥有的 projection JSON。Blue plugin host 不提供通用写网关；generic `session.act` 已从 manifest、类型和 public facade 中删除。

| Capability | `open()` 返回字段 | 暴露方法 |
|---|---|---|
| `session.read` | `api.session` | `current()`、`subscribe()` |
| `session.projections.read` | `api.projections` | `current()`、`currentMany()`、`subscribe()` |

公开对象不会暴露 Harness Agent、Session、event log、未收窄的 projection reader 或 app 的广义 action service。请求已删除的 `session.act` 会在 manifest/open 校验期失败，不存在兼容 fallback。

## 精确 resource

Canonical manifest 必须明确声明所需字段和 key。Host 只返回实际 grant 的数据：

```json
{
  "capabilities": {
    "required": [
      {
        "name": "session.read",
        "version": "^1.0.0",
        "resources": { "fields": ["identity", "status", "model"] }
      },
      {
        "name": "session.projections.read",
        "version": "^1.0.0",
        "resources": { "keys": ["costUsage", "contextTimeline"] }
      }
    ],
    "optional": []
  }
}
```

`session.read` 可申请 `identity`、`cwd`、`status`、`mode`、`model`。`identity` 在 snapshot 中映射为 `id`。`revision` 与 `sessionEpoch` 是强制 fencing metadata，不需要也不能从 grant 中移除。projection key 由拥有该 projection 的 Host 插件定义；Blue 不重新定义它的 schema 或业务含义。

## 会话 snapshot

Canonical `current()` 返回 `BlueResult<BluePluginSessionSnapshot | null>`：

```ts
interface BluePluginSessionSnapshot {
  readonly revision: number
  readonly sessionEpoch: number
  readonly id?: string
  readonly cwd?: string
  readonly status?: 'idle' | 'running' | 'waiting' | 'failed'
  readonly mode?: 'normal' | 'plan' | 'yolo'
  readonly model?: {
    readonly id: string
    readonly provider?: string
    readonly effort?: string
  }
}
```

只有获准字段会成为 own property；即使获准了 `model`，当前没有模型时也会省略该字段。Host 会复制并深冻结 snapshot。每个字符串最多 16,384 UTF-8 bytes，完整 snapshot 最多 65,536 encoded bytes。`null` 只表示 owner 在线但当前没有 active session，不表示 capability 缺失。

同一个 session epoch 内，session id 不得改变，host 只接受递增的 `revision`。epoch/revision/id high-water 会跨 owner gap 保留；相同位置只有在完整 canonical snapshot 不变时才允许 owner reload 恢复可见性，冲突 snapshot 返回 `BLUE_STALE`。同 id session 切换到新 epoch 后可以从较低 revision 重新开始；旧 epoch 和旧 owner 卸载后的 late callback 都会被拒绝。

`subscribe(listener)` 返回 `BlueResult<BlueRegistration>`，并在 effect 注册成功后同步 replay 当前结果。listener 收到的也是 `BlueResult<BluePluginSessionSnapshot | null>`。owner gap 产生 `BLUE_CAPABILITY_ABSENT`；owner reload 后 replay 当前 generation。consumer Fiber 卸载后，保留的 facade 永久返回 `BLUE_ACTION_REJECTED`。

```ts
const opened = ctx.bluePluginHost.open(ctx, manifest)
if (!opened.ok || opened.value.session === undefined) return

const initial = opened.value.session.current()
if (initial.ok && initial.value !== null) {
  console.log(initial.value.sessionEpoch, initial.value.id, initial.value.status)
}

const subscribed = opened.value.session.subscribe(result => {
  if (!result.ok) return
  if (result.value !== null) console.log(result.value.revision, result.value.status)
})
if (!subscribed.ok) console.error(subscribed.code, subscribed.message)
```

## Projection cut

`current(key)` 返回单个获准 key 的 `BlueResult<BlueSessionProjectionSnapshot | null>`。`currentMany(keys)` 从 owner 的一次 snapshot 读取所有 key，返回一致 cut：

```ts
interface BlueSessionProjectionCut {
  readonly sessionEpoch: number
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, BlueJson>>
}
```

resource key 必须使用 canonical ASCII syntax，最长 128 字符。每个 value 必须是 finite、acyclic JSON；accessor、sparse array、`undefined`、symbol、非有限数字和循环引用都会被拒绝。Host 会分离并深冻结每个 value。bounded clone 对整份 cut 最多接纳 64 层、16,384 个 JSON value 和 16,384 个被检查的 own property；单 primitive 最多 262,144 encoded bytes，嵌套 object key 最多 1,024 UTF-8 bytes。clone 后仍以单 value 262,144 encoded bytes、整个 cut 1,048,576 bytes 为最终权威上限。

缺失或已卸载的 key 返回 `BLUE_CAPABILITY_ABSENT`，不会复用旧值。旧 epoch 或较小 `asOfSeq` 返回 `BLUE_STALE`。high-water 会跨 owner gap 保留；相同位置的值按 canonical JSON 比较，不受 object key 顺序影响，冲突值返回 `BLUE_STALE`。同一 epoch/sequence 位置最多保留 256 个 key fingerprint 和 4,194,304 UTF-8 bytes；位置前进时清空这组有界记录。请求 key 数在遍历前受 exact grant 上界约束。`subscribe(keys, listener)` 在注册后 replay 一次一致 cut，只在指定 key 变化时读取新 cut；完全重复、过期、非法或迟到的 owner 通知不会进入 listener。当前 session 变为 `null` 时，已有 projection subscription 会立即 replay `null`，后续 projection read 也直接返回 `null` 而不查询 backing source，因此不会保留旧 session 值。

```ts
const projections = opened.value.projections
if (projections !== undefined) {
  const cut = projections.currentMany(['costUsage', 'contextTimeline'])
  if (cut.ok && cut.value !== null) {
    console.log(cut.value.asOfSeq, cut.value.values.costUsage)
  }

  const subscribed = projections.subscribe(['costUsage'], result => {
    if (result.ok && result.value !== null) console.log(result.value.values.costUsage)
  })
  if (!subscribed.ok) console.error(subscribed.code, subscribed.message)
}
```

## 过渡期 inline manifest

旧 flat manifest 的 `capabilities: ['session.read']` 仍保留原来的 inline-host reader 形状，用于 PR #77 兼容 lane；它不提供 `session.projections.read`，也不代表 canonical v1 resource/epoch 语义。新插件和 R3 生态 adapter 应使用带 `$schema`、required/optional 分组和精确 resources 的 canonical manifest。

## 写操作归领域 owner

需要 followup、steer、interrupt 或其他领域 mutation 时：

- 优先使用拥有该语义的公开 Harness Cordis service、command 或 feature action；
- 在 domain 包中完成写入，把 renderer-neutral 结果投影给 Blue adapter；
- 没有公开领域边界时，停止并向能力 owner 提案，不要读取 package internal 或复制 Session 状态。

插件不得直接 inject owner-only 的 `blueSessionReader`、`blueSessionProjections`、`blueSessionActions` 或 `bluePluginControl`，也不得 unwrap `bluePluginHost` 获取它们。composition-private projection owner 类型也不从 `@dsh-blue/blue-api` package root 导出。默认 bundle 将这些未收窄服务隔离在 private runtime realm 中；公共插件只能使用 manifest-scoped facade。
