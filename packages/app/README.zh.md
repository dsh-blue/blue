# `@dsh-blue/blue-app`

[English](README.md) | 中文

Blue 的 startup 与 current-Agent coordinator。它通过 dsh 原生服务解析或创建
Agent，并提供 `ctx.blueCurrentAgent`：

```ts
const agent = ctx.blueCurrentAgent.current()
const stop = ctx.blueCurrentAgent.subscribe((next, revision) => {
  // next 是 Blue 当前选择的精确 live Agent，或 null
})
```

本包还持有 session navigation request event、request lifecycle、retraction、
title cadence 与进程退出 epitaph。Command、projection、tool、setting 和其余
domain 行为都保留在 dsh 原生 service 上。
