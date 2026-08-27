# `@dsh-blue/blue-ui`

This package is the pure construction layer for the `BlueUiNode` wire types
owned by `@dsh-blue/blue-api`. It may depend on and re-export API, but must not
depend on Cordis, Harness, frontend, core, pi-tui, terminal objects, or mutable
host state.

Builders must remain side-effect free and preserve the handwritten wire shape.
Every returned node is deeply frozen. Flex sizing and viewport conditions live
only in explicit `ui.child(node, options)` wrappers; do not add hidden layout
metadata or renderer callbacks to nodes.

`defineBlueComponent` is a package-level composition factory. It validates
component id/API metadata and the render function, then freezes render output.
It must not validate node schemas, register component kinds, capture a Fiber,
or create a runtime registry. Core owns schema admission, quotas, and compile.

Keep runtime source fully covered. Type fixtures must prove component prop
inference, the explicit child boundary, and rejection of custom node kinds.
