# @dsh-blue/blue-ui

Pure, renderer-neutral builders for Blue's public UI wire format. The `ui`
namespace recursively clones caller data, then creates deeply frozen
`BlueUiNode` objects with the same shape a plugin can write by hand. It includes
every content leaf, flex and viewport children, row/column stacks, surfaces,
scrolling, Markdown/Mermaid documents, structured charts, controlled patterns,
progress, spacers, and dividers. Plain nodes can
enter a stack directly; use `ui.child` only when child layout metadata is needed.

```ts
import { defineBlueComponent, ui } from '@dsh-blue/blue-ui'

export const metric = defineBlueComponent<{ label: string, value: number }>({
  id: '@acme/metric',
  api: '^1.0.0-beta.2',
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

This package re-exports `@dsh-blue/blue-api` types only. Its JavaScript has no
API host or Cordis import and has no dependency on Harness, frontend state,
core, pi-tui, or a terminal runtime.

`ui.document({ format, source })` and `ui.chart({ chart, ...data })` preserve
only renderer-neutral wire data. Mermaid and chart libraries are core-owned;
plugins do not install them or pass library-specific configuration.
