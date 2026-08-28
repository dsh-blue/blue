# `@dsh-blue-example/overlay`

Interaction example scoped to one consumer Fiber. It requests `commands` and
`overlays`; the capturing overlay opens only from the command callback's
owner-minted `BlueUserGesture`. The gesture is one-shot, and the host-scoped
API facade rejects retained callbacks after consumer unload. There are no
timers or background tasks.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
