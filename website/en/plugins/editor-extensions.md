# Editor extensions

`blueEditorExtensions` adds passive UI, diagnostics, actions, completion, and
submit transforms around the one Blue-owned editor. It does not replace the
editor engine.

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

Callback context carries an AbortSignal, surface id, and revision.
Completions are bounded to 5 seconds and submit transforms to 30 seconds.
Late results after unload, generation change, or abort are discarded.

Extension nodes are a restricted tree without editor-control. Render, event,
diagnostic, and action content is admitted again. Registrations expose
`refresh()/dispose()` and follow the Fiber.
