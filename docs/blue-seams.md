# Blue service seams

Blue 2.0 不再定义 capability facade。插件依据 Harness reference 直接声明并
消费需要的 dsh service。

## dsh 原生服务

常见依赖包括：

| Service | 用途 |
| --- | --- |
| `commands` | 注册和执行 dsh command |
| `sessionProjections` | 注册 projection，或对一个 Agent 的 Session 读取 snapshot |
| `tools` | 使用 dsh tool registry |
| `agents`、`sessionController` | Agent/session 生命周期 |
| `settings`、`skills` | 对应 dsh feature 的原生能力 |
| `plan` projection、`/plan` command | 跨 Agent realm 读取和修改 plan 状态 |

Blue 不包装这些接口，也不把它们改写为另外一种 result/error taxonomy。
与 `planMode` 同 realm 组装的插件仍可直接 inject 该原生 service；根级 Blue
插件不穿透 Agent 私有 realm，而是直接使用 Harness 为此提供的 projection 与
command。

## Blue UI 服务

| Service | 注册形态 | Renderer |
| --- | --- | --- |
| `bluePanes` | `register({ id, placement, render, ... })` | core 的 header/left/right/bottom lanes |
| `blueStatus` | `register(entryOrSource)` | transcript footer |
| `blueOverlays` | `open({ id, render, ... })` | core overlay stack |
| `blueEditorExtensions` | `register({ id, before, after, complete, transformSubmit, ... })` | interaction editor |

这些服务由 `@dsh-blue/blue-api` 提供。贡献使用 renderer-neutral
`BlueUiNode`，可由 `@dsh-blue/blue-ui` 构造。core 在渲染前执行 schema、
quota、控制字符与宽度校验。

注册 handle 提供 `refresh()` 和 `dispose()`；pane 还提供
`setHidden()`，overlay 提供 `close()`。即使调用方不手动 dispose，
Cordis Fiber unload 也会清理 registration。

## 当前 Agent

`@dsh-blue/blue-app` 提供：

```ts
const agent = ctx.blueCurrentAgent.current()
if (agent !== null) {
  const cut = ctx.sessionProjections.snapshot(agent.session, ['myProjection'])
}
```

`current()` 返回 `Agent | null`，`subscribe()` replay 当前 selection 并
观察后续 revision。只有 registry 中仍存活的精确 Agent 能被选中；Agent dispose
会清空 selection。

需要 Agent identity 的插件 inject `blueCurrentAgent`。只贡献静态 UI 的插件
不应增加这一依赖，因为 app 或 core reload 时 Cordis 会按依赖关系卸载 consumer。

## 生命周期

所有 service 位于同一 Cordis graph。注册重复 id 或无效 definition 会直接抛出；
dsh command handler 保持 dsh 自己的返回类型。没有 grant、manifest admission、
gesture token、owner generation、buffer replay 或跨 realm proxy。

Renderer 暂时缺位时 registry definition 仍可存在；renderer 恢复后从
`list()/subscribe()` 重新取得当前值。外部插件卸载时它的定义立即消失。
