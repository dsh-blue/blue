# Public UI kit

`@dsh-blue/blue-ui` is the pure renderer-neutral construction layer. It
exports `ui`, `defineBlueComponent()`, and the wire types from
`@dsh-blue/blue-api`. It has no Cordis plugin, service registration, or
terminal dependency.

```ts
import { ui } from '@dsh-blue/blue-ui'

const node = ui.surface({
  title: 'Build',
  child: ui.stack.column([
    ui.text('healthy', { tone: 'success' }),
    ui.progress({ value: 42, max: 100, label: 'Context' }),
  ]),
})
```

Builders clone caller data and deeply freeze their result. Cycles throw. Core
still owns final schema, quota, control-character, and width admission.

## Reusable components

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const summaryMetric = defineBlueComponent<{
  label: string
  value: string
}>({
  id: '@acme/summary-metric',
  render: props => ui.richText([
    { text: props.label, tone: 'muted' },
    { text: ` ${props.value}`, tone: 'accent', emphasis: 'strong' },
  ]),
})
```

`defineBlueComponent` validates only id and render, then deeply freezes each
rendered node. It does not register a node kind or bind a Fiber.

A component kit is an ordinary npm library and cannot change Blue by itself.
Consumer plugins place rendered output in `bluePanes`, `blueStatus`,
`blueOverlays`, or `blueEditorExtensions`.
