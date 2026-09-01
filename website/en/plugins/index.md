# Blue plugin development

A Blue plugin is an ordinary Cordis plugin. It consumes native dsh services
directly and injects one of Blue's four UI services only when it needs terminal
UI.

```text
native dsh services
commands · sessionProjections · tools · settings · ...
                         │
                ordinary Cordis plugin
                         │
Blue UI services
bluePanes · blueStatus · blueOverlays · blueEditorExtensions
```

Official Blue packages and external plugins are structurally identical:
`name / inject / apply(ctx)`, one service graph, and the same Fiber unload
behavior. There is no special manifest, capability request, adapter facade, or
plugin-author CLI.

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

Use the [quickstart](/en/plugins/quickstart) to create a package. The
[Harness reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
defines native dsh APIs; [service seams](/en/plugins/seams) covers Blue UI.
