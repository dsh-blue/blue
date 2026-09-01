# Blue 插件开发

Blue 插件就是普通 Cordis 插件。它直接使用 dsh 原生 service，并在需要终端
界面时注入 Blue 的四个 UI service。

```text
dsh 原生 service
commands · sessionProjections · tools · settings · ...
                         │
                  普通 Cordis 插件
                         │
Blue UI service
bluePanes · blueStatus · blueOverlays · blueEditorExtensions
```

Blue 官方包和外部插件同构：相同的 `name / inject / apply(ctx)`，相同的
service graph，相同的 Fiber unload 行为。没有专用 manifest、能力申请、
adapter facade 或插件作者 CLI。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const name = '@acme/build-health'
export const inject = ['commands', 'bluePanes']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'health',
    description: 'Show build health',
    handler: () => ({ kind: 'success', text: 'healthy' }),
  })
  ctx.bluePanes.register({
    id: 'acme.build-health',
    placement: 'right',
    narrow: 'bottom',
    render: () => ui.text('healthy'),
  })
}
```

从[快速开始](/plugins/quickstart)创建第一个包；原生 dsh API 以
[Harness reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
为准，Blue UI 入口见 [Seam 参考](/plugins/seams)。
