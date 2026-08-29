# 会话只读数据

当前 Beta 只提供 `session.read`。插件可以读取和订阅当前会话的裁剪摘要，但不能通过 Blue plugin host 写会话；generic `session.act` 已从 manifest、类型和 public facade 中删除。领域写入继续使用所属 Harness Cordis service、Harness command 或 feature-owned action。

| Capability | `open()` 返回字段 | 暴露方法 |
|---|---|---|
| `session.read` | `api.session` | `current()`、`subscribe()` |

公开对象不会暴露 Harness Agent、Session、event log、raw projection reader 或 app 的广义 action service。请求已删除的 `session.act` 会在 manifest/open 校验期失败，不存在兼容 fallback。

## 只读 snapshot

`current()` 返回当前 `BlueSessionSnapshot`，没有活跃会话时返回 `null`：

```ts
interface BlueSessionSnapshot {
  readonly revision: number
  readonly id: string
  readonly cwd: string
  readonly status: 'idle' | 'running' | 'waiting' | 'failed'
  readonly mode: 'normal' | 'plan' | 'yolo'
  readonly model?: {
    readonly id: string
    readonly provider?: string
    readonly effort?: string
  }
}
```

host 会复制并深度冻结 snapshot，包括嵌套的 `model`。`revision` 在 app owner 发布新状态时单调递增；host 忽略同一 owner generation 中重复或倒退的 revision，也丢弃旧 owner 卸载后的 late callback。

`subscribe(listener)` 先注册再同步 replay 当前值，因此订阅期间的重入发布不会漏掉更新。返回的 `BlueRegistration` 可以重复安全地 `dispose()`；consumer Fiber 卸载也会自动撤销订阅。

owner bridge 在 `open()` 时尚未激活，`open()` 返回 `BLUE_CAPABILITY_ABSENT`。已经打开的 reader 遇到 owner reload 时先收到 `null`，新 generation 激活后再收到当前 snapshot；它不会复用旧 session 值。consumer 已卸载后，保留的 facade 永久失效。

```ts
export const inject = ['bluePluginHost']

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-badge',
    api: '^1.0.0-beta.1',
    capabilities: ['session.read'],
  })
  if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`)

  const reader = opened.value.session
  const registration = reader.subscribe(snapshot => {
    if (snapshot !== null) console.log(snapshot.revision, snapshot.id, snapshot.status)
  })
  // registration 随 ctx Fiber 自动释放；也可提前 registration.dispose()
}
```

## 写操作归领域 owner

Blue 不提供通用 session 写网关。需要 followup、steer、interrupt 或其他领域 mutation 时：

- 优先使用拥有该语义的公开 Harness Cordis service、command 或 feature action；
- 在 domain 包中完成写入，把 renderer-neutral 结果投影给 Blue adapter；
- 没有公开领域边界时，停止并向能力 owner 提案，不要读取 package internal 或复制 Session 状态。

插件不得直接 inject owner-only 的 `blueSessionReader`、`blueSessionProjections`、`blueSessionActions` 或 `bluePluginControl`，也不得 unwrap `bluePluginHost` 获取它们。默认 bundle 将这些服务隔离在 private runtime realm 中；公开 `session.read` 是唯一当前可执行的 session facade。
