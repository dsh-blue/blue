# @dsh-blue/blue-ui

Pure, renderer-neutral builders for Blue's public UI wire format. The `ui`
namespace creates deeply frozen `BlueUiNode` objects with the same shape a
plugin can write by hand. It includes every content leaf, explicit flex and
viewport children, row/column stacks, surfaces, scrolling, controlled patterns,
progress, spacers, and dividers.

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const metric = defineBlueComponent<{ label: string, value: number }>({
  id: '@acme/metric',
  api: '^1.0.0',
  render: props => ui.surface({
    title: props.label,
    child: ui.stack.column([
      ui.child(ui.progress({ value: props.value, max: 100 }), {
        grow: 1,
        when: { minWidth: 40 },
      }),
    ]),
  }),
})
```

`defineBlueComponent` records a package-namespaced id and Blue API range, then
deeply freezes each rendered node. It is a pure package-level factory, not a
runtime registry. Core still validates node kinds, values, depth, quotas, and
renderer safety when a plugin contributes the expanded tree.

This package re-exports `@dsh-blue/blue-api` and has no dependency on Cordis,
Harness, frontend state, core, pi-tui, or a terminal runtime.
