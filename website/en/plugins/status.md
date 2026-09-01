# Status bar

`ctx.blueStatus.register(source)` accepts a fixed entry or a synchronous
function returning an entry or null.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const inject = ['blueStatus']

export function apply(ctx: Context): void {
  let healthy = true
  const status = ctx.blueStatus.register(() => ({
    id: 'acme.health',
    priority: 30,
    band: 'right',
    row: 1,
    overflow: 'hide',
    visible: true,
    node: ui.text(healthy ? 'healthy' : 'failed', {
      tone: healthy ? 'success' : 'danger',
    }),
  }))

  ctx.on('acme/health-changed', value => {
    healthy = value
    status.refresh()
  })
}
```

Status nodes are non-interactive. Entries sort by priority and id;
`visible: false` or a null source result hides the entry. If a source throws,
Blue renders an entry-local failure fallback without blocking the Agent loop.

`refresh()` asks the footer to reread the source, `dispose()` removes it
early, and Fiber unload removes it automatically.
