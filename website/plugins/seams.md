# Service seam 参考

## dsh 原生

插件直接 inject `commands`、`sessionProjections`、`tools`、`settings`、
`skills`、`sessionController` 等 dsh service。与 `planMode` 同 realm 的插件
也可以直接 inject；根级 UI 插件直接读取 `plan` projection、执行 `/plan`
command。方法签名与返回值不经过 Blue 改写。

## Blue UI

| Service | 写入 | 消费方 |
| --- | --- | --- |
| `bluePanes` | `register(BluePaneContribution)` | core surface renderer |
| `blueStatus` | `register(BlueStatusSource)` | transcript footer |
| `blueOverlays` | `open(BlueOverlayRequest)` | core overlay renderer |
| `blueEditorExtensions` | `register(BlueEditorExtensionContribution)` | interaction editor |

`@dsh-blue/blue-api` 提供 Context declaration merge 和 contract；
`@dsh-blue/blue-ui` 提供纯 builder。

## 当前 Agent

`blueCurrentAgent.current()` 返回 `Agent | null`；`subscribe(listener)`
立即 replay 当前 selection，并在 revision 变化时通知。插件把当前 Agent 或
`agent.session` 传给原生 dsh service。

## 生命周期

所有 registration 绑定 consumer Fiber。没有专用 admission 阶段、grant、
owner token 或跨 realm proxy。Renderer 暂时卸载时 registry 仍保留当前
definition；renderer 重挂后通过 `list()/subscribe()` 读取。

静态 UI 插件只 inject 它真正需要的 Blue service。依赖
`blueCurrentAgent` 的插件会在 app/core dependency unload 时按 Cordis
规则一起 unload。
