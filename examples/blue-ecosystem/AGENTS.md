# `@dsh-blue-example/blue-ecosystem`

Composition-only opt-in bundle for five runnable external plugins: header,
right-inspector, bottom-log, overlay, and ui-gallery. The user kit is a
dependency, not a row.

Rows are ordinary Cordis siblings of Blue. They inject native dsh services and
direct Blue UI services exactly as their source declares. Keep this package
outside Blue's release set and default bundle.

Tests must install publish-shaped packages, boot all five rows, observe their
direct contributions, and prove Fiber unload cleanup. Do not add manifests,
capability maps, host facades, provider examples, or compatibility paths.
