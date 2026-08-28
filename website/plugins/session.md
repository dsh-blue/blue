# 会话读取与动作

Blue 将公开会话 seam 拆为两个独立 capability。插件只读当前会话时申请 `session.read`；只有确实要提交 followup、steer 或 interrupt 时才额外申请 `session.act`。

| Capability | `open()` 返回字段 | 暴露方法 |
|---|---|---|
| `session.read` | `api.session` | `current()`、`subscribe()` |
| `session.act` | `api.sessionActions` | `request()` |

两个 facade 不会合并方法。只申请 `session.read` 的插件拿不到 `sessionActions`，只申请 `session.act` 的插件也拿不到 `session`。app 是唯一真实 owner；公开对象不会暴露 Harness Agent、Session、event log 或 app 的广义 action service。

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

host 会复制并深度冻结 snapshot，包括嵌套的 `model`。`revision` 在 app owner 发布新状态时单调递增；host 忽略同 owner generation 中重复或倒退的 revision，也丢弃旧 owner 卸载后的 late callback。

`subscribe(listener)` 先注册再同步 replay 当前值，因此订阅期间的重入发布不会漏掉更新。返回的 `BlueRegistration` 可以重复安全地 `dispose()`；consumer Fiber 卸载也会自动撤销订阅。owner 暂时卸载时，仍存活的 reader 会看到 `null`，新 owner 激活后继续收到新 generation 的 snapshot。

```ts
export const inject = ['bluePluginHost']

export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-badge',
    api: '^1.0.0',
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

## 结构化动作

`sessionActions.request()` 接受以下动作：

```ts
{ kind: 'followup', text: 'continue with tests' }
{ kind: 'steer', text: 'focus on the parser' }
{ kind: 'interrupt' }
```

动作在 app owner 处全局 FIFO 串行，包含来自不同 plugin consumer 的请求。每个请求捕获提交时的 session id 与 owner generation；排队期间发生 session switch，或运行结果在 switch/unload 后才返回，都会以 `BLUE_ACTION_REJECTED` 拒绝，late success 不会重新进入当前会话。

调用方可传入 `AbortSignal`。预先 abort、排队中 abort、运行中 abort 统一返回 `BLUE_ABORTED`，底层 owner work 也会收到已 abort 的 signal。没有活跃会话返回 `BLUE_SESSION_UNAVAILABLE`；live consumer 遇到 owner gap 返回 `BLUE_CAPABILITY_ABSENT`；consumer 已卸载则返回 `BLUE_ACTION_REJECTED`。

```ts
export function apply(ctx) {
  const opened = ctx.bluePluginHost.open(ctx, {
    id: 'com.example.session-action',
    api: '^1.0.0',
    capabilities: ['session.act'],
  })
  if (!opened.ok) throw new Error(`${opened.code}: ${opened.message}`)

  const controller = new AbortController()
  void opened.value.sessionActions
    .request({ kind: 'interrupt' }, { signal: controller.signal })
    .then(result => {
      if (!result.ok) console.error(result.code, result.message)
    })
}
```

如果 `open()` 时 session owner bridge 尚未激活，请求这两个 capability 都会返回 `BLUE_CAPABILITY_ABSENT`。这通常表示 Blue profile 版本不匹配或 owner row 未装配；插件不得转而读取 owner-only 的 `blueSessionReader`、`blueSessionActions` 或 Harness Session 对象。
