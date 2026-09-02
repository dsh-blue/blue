# `@dsh-blue/blue-api`

English | [中文](README.zh.md)

Renderer-neutral contracts and direct Cordis UI services for Blue
`0.2.0-alpha.1`.

Loading the package registers:

- `ctx.bluePanes`
- `ctx.blueStatus`
- `ctx.blueOverlays`
- `ctx.blueEditorExtensions`

Each registration belongs to the calling Cordis Fiber and disappears when
that Fiber unloads. Definitions use `BlueUiNode` data; core owns validation
and terminal rendering.

The full pane/overlay node union includes renderer-neutral `document` nodes
for Markdown or Mermaid source and structured `chart` nodes for line, point,
bar, sparkline, and heatmap data. These leaves are intentionally absent from
the narrower status, notification, editor-extension, and `BlueView` contracts.

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

This package does not wrap dsh services. Plugins use `ctx.commands`,
`ctx.sessionProjections`, `ctx.tools`, and other Harness services directly.
There is no Blue manifest, capability host, adapter, or compatibility facade.
