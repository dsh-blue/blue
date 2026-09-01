# `@dsh-blue/blue-ui`

This package is the pure construction layer for the `BlueUiNode` wire types
owned by `@dsh-blue/blue-api`. It may depend on API and re-export API types, but
its JavaScript must have no API root or Cordis import. It must not depend on
Harness, frontend, core, pi-tui, terminal objects, or mutable host state.

Builders must remain side-effect free and preserve the handwritten wire shape.
They recursively clone caller-owned wire data before freezing the result and
reject cycles. Stacks normalize plain nodes to `{ node }`; flex sizing and
viewport conditions still require explicit `ui.child(node, options)` wrappers.
List `detailSpans`, like all inline semantic content, pass through unchanged
and are cloned/frozen with their list item. Do not add hidden layout metadata
or renderer callbacks to nodes.

`defineBlueComponent` is a package-level composition factory. It validates
the component id and render function, then freezes render output.
It must not validate node schemas, register component kinds, capture a Fiber,
or create a runtime registry. Core owns schema admission, quotas, and compile.

Keep runtime source fully covered. Type fixtures must prove component prop
inference, the explicit child boundary, and rejection of custom node kinds.
