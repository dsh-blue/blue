# Public UI kit

`@dsh-blue/blue-ui` is the pure renderer-neutral construction layer. It exports
the `ui` builders and `defineBlueComponent()`, and re-exports wire types from
`@dsh-blue/blue-api`. It has no Cordis plugin, capability, host service, or
terminal dependency.

## Builders

```ts
import { ui } from '@dsh-blue/blue-ui'

const node = ui.surface({
  title: 'Context',
  chrome: 'lane',
  child: ui.stack.column([
    ui.progress({ label: 'Tokens', value: 12_000, max: 28_000 }),
    ui.child(ui.text('deepseek-chat', { tone: 'muted' }), {
      when: { minWidth: 32 },
    }),
  ], { gap: 1 }),
})
```

![Rendered result of the builder example above](/shots/uikit-builder.svg)

Builder results have exactly the handwritten `BlueUiNode` wire shape. Caller
data is recursively cloned and deeply frozen. Plain nodes can enter a stack
directly; use `ui.child()` only for child layout metadata such as `grow`,
`basis`, `minSize`, or `when`.

Builders cover content leaves (text, rich text, fields, code, diff, sections),
stack/surface/scroll, tabs/list/form/actions, and
loader/empty/progress/spacer/divider. Nodes express semantics, never ANSI,
terminal columns, focus handles, or renderer key bindings.
For every builder's fields, defaults, constraints, event payloads, and surface
compatibility, see the [UI node reference](/en/plugins/ui-reference).

## Reusable components

A user kit is an ordinary npm library, not a plugin:

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const summaryMetric = defineBlueComponent<{
  label: string
  value: string
  detail: string
}>({
  id: '@acme/summary-metric',
  api: '^1.0.0-beta.1',
  render: props => ui.surface({
    chrome: 'lane',
    child: ui.stack.row([
      ui.richText([
        { text: props.label, tone: 'muted' },
        { text: ` ${props.value}`, tone: 'accent', emphasis: 'strong' },
      ]),
      ui.child(ui.text(props.detail, { tone: 'muted' }), {
        grow: 1,
        when: { minWidth: 32 },
      }),
    ], { gap: 1 }),
  }),
})
```

![Rendered result of the `summaryMetric` component above](/shots/uikit-component.svg)

`defineBlueComponent` validates only component id, API range, and render
function, then freezes each render result. It does not register custom node
kinds or bypass core's schema, quota, and width validation.

The kit's `package.json` needs only a peer on `@dsh-blue/blue-ui`; do not add a
`blue.plugin.json`, `cordis.patch.yml`, `inject`, or `apply()`. Installing a kit
cannot change Blue's UI. A consumer plugin that places a component in a pane,
overlay, or provider must request that capability in its own manifest and is
still subject to host rejection, Fiber unload, and quotas.

The repository's `@dsh-blue-example/user-kit` is shared by the header and
right-inspector plugins in the [example catalog](/en/plugins/examples).
