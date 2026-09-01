# `@dsh-blue/blue-api`

[English](README.md) | 中文

Blue `0.2.0-alpha.1` 的 renderer-neutral contract 与直接 Cordis UI
service。

加载本包会注册：

- `ctx.bluePanes`
- `ctx.blueStatus`
- `ctx.blueOverlays`
- `ctx.blueEditorExtensions`

每次注册都属于调用方 Cordis Fiber，并在该 Fiber unload 时移除。Definition
使用 `BlueUiNode` 数据；校验与终端渲染由 core 持有。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'

export const inject = ['bluePanes']

export function apply(ctx: Context): void {
  ctx.bluePanes.register({
    id: 'acme.summary',
    placement: 'right',
    render: () => ({ kind: 'text', content: 'ready' }),
  })
}
```

本包不包装 dsh service。插件直接使用 `ctx.commands`、
`ctx.sessionProjections`、`ctx.tools` 与其他 Harness service。不存在 Blue
manifest、capability host、adapter 或兼容 facade。
