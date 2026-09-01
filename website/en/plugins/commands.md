# Native dsh commands

Blue defines no command adapter. Depend on `@deepseek-ai/dsh-commands` and use
`ctx.commands` directly.

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

For the current session, also inject `blueCurrentAgent`, obtain the Agent when
the handler runs, and pass `agent.session` to native services such as
`sessionProjections`. The
[Harness reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
is authoritative for command definitions, args/options, and results.

Registration follows the plugin Fiber. Do not create a second command protocol
through Blue UI actions.
