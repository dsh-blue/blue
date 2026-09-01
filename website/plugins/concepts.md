# 核心概念

## 一张 Cordis graph

Blue 不创建子插件系统。外部插件、Blue 官方行与 dsh 原生 service 都是同一棵
Cordis tree 的成员。`inject` 是启动依赖，也是 reload 传播边界。

## Fiber 是生命周期

Command、pane、status、overlay 与 editor extension registration 都绑定调用方
Fiber。插件 unload 时贡献自动消失。其他 subscription、timer 或外部 listener
仍应通过 `ctx.effect()` 或返回 disposer 明确清理。

## 原生 domain，Blue UI

dsh 已有的能力直接复用；Blue 不复制 command、tool、projection、setting 或
Agent API。只有终端 UI 需要 Blue seam。

需要当前 Agent 时 inject `blueCurrentAgent`：

```ts
const agent = ctx.blueCurrentAgent.current()
if (agent !== null) {
  const snapshot = ctx.sessionProjections.snapshot(agent.session, ['myProjection'])
}
```

不要跨 selection revision 长期保留 Agent/Session。

## Renderer-neutral

UI contribution 返回 `BlueUiNode`。插件不 import pi-tui、不拼 ANSI、不读取
终端宽度。Core 统一校验、布局、theme、focus 与 terminal safety。

## 失败语义

Native dsh service 保留自己的返回值与异常语义。Blue registry 对无效 id、
缺失 callback 或 duplicate id 直接抛错；registration handle 提供
`refresh()/dispose()`，overlay 另有 `close()`。
