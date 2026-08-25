# Blue Session Runtime

> 目标职责文档。Harness 已有的原生 projection/action 优先消费；Blue 只在缺失时挂载独立兼容 adapter。

## 三个服务

### Projection Runtime

Domain plugin 注册纯同步 projection unit：`init`、`apply`、schema、stateVersion，以及可选的 client view。registry 统一订阅一次 `session/event`，按 session 保存 state，生成 whole-value snapshot 和带 seq 的 change feed。

不关心事件时返回同一 state reference；注册 Fiber 卸载时移除 key 和缓存。未注册 key 表示 capability absent，不是异常。

### Action Coordinator

统一承载 `followup`、`steer`、`interrupt`、`new`、`resume`、`fork` 和领域 action。每个 action 有 session scope、request/session epoch、AbortSignal、排队、结构化 `BlueResult` 和 stale-result 拒绝。

事件只通知已提交事实；action 不用无返回值 event 伪装。session switch 必须先成功创建、再提交 current binding、最后发布变更事件。

### Frontend Session Binding

TUI 选择一个 current session，Web 可以同时观察多个 session，headless 显式指定 session。binding 不拥有 Agent/Session，只引用 runtime 的 snapshot/action façade。

## 兼容 adapter

adapter 是 anti-corruption layer，只做三件事：把 Harness 官方 API 转成 Blue 最小事实、把 Blue action 转回官方 action、集中处理版本差异和 capability probing。

adapter 按能力拆成独立 Cordis plugin，例如 session bridge、model bridge、projection bridge、question bridge。每个 adapter 记录删除条件，不暴露 raw Agent/Session，不依赖 package-internal API。

## 生命周期

session attach 时先建立 snapshot watermark，再订阅增量；只接受 watermark 之后的事件。detach/switch 先 abort action、停止订阅和 timer，再移除 session-scoped cache。late event/result 只能被丢弃或转为诊断，不能重新挂载 UI。

