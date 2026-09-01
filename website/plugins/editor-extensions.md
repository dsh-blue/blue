# 编辑器扩展

`blueEditorExtensions` 在 Blue 持有的唯一 editor 周围增加被动 UI、诊断、
action、completion 与 submit transform；它不替换 editor engine。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@dsh-blue/blue-api'
import { ui } from '@dsh-blue/blue-ui'

export const inject = ['blueEditorExtensions']

export function apply(ctx: Context): void {
  ctx.blueEditorExtensions.register({
    id: 'acme.issue-links',
    priority: 20,
    hint: '#123 links an issue',
    before: ui.text('Issue helper', { tone: 'muted' }),
    complete: request => request.trigger === '#'
      ? [{ id: 'issue-123', label: '#123', insertText: '#123' }]
      : [],
    transformSubmit: request => ({ text: request.text.trim() }),
  })
}
```

Callback context 带 `AbortSignal`、surface id 与 revision。异步 completion
最长 5 秒，submit transform 最长 30 秒；unload、selection/renderer generation
变化或 abort 后的迟到结果会丢弃。

Extension node 是受限的非 editor-control tree。Render/event/diagnostic/action
内容会再次校验。Registration 提供 `refresh()/dispose()` 并随 Fiber 清理。
