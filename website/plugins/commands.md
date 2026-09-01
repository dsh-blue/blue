# dsh 原生命令

Blue 不定义 command adapter。插件依赖
`@deepseek-ai/dsh-commands` 并直接使用 `ctx.commands`。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

export const inject = ['commands']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'health',
    description: 'Show build health',
    handler: (_args, _options) => ({
      kind: 'success',
      text: 'healthy',
    }),
  })
}
```

需要当前 session 时，同时 inject `blueCurrentAgent`，在 handler 执行时获取
Agent，再把 `agent.session` 传给原生 `sessionProjections` 等 service。
Command definition、args/options 和返回值以
[Harness reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
为准。

注册随插件 Fiber 卸载。不要把一个 Blue UI action 伪装成另一套 command
protocol。
