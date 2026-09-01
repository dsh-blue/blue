# 状态栏

`ctx.blueStatus.register(source)` 接受固定 entry 或返回 entry/null 的同步函数。

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

Status node 只能使用非交互内容。Entry 按 priority 与 id 排序；`visible: false`
或 source 返回 `null` 时不显示。Source 抛错时 Blue 显示该 entry 的失败 fallback，
不会打断 Agent loop。

`refresh()` 通知 footer 重新读取 source，`dispose()` 提前移除；Fiber unload
也会自动移除。
