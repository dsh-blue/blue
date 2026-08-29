# `@dsh-blue-example/overlay`

Interaction example scoped to one consumer Fiber. It requests `commands` and
`overlays`; the capturing overlay opens only from the command callback's
owner-minted `BlueUserGesture`. The gesture is one-shot, and the host-scoped
API facade rejects retained callbacks after consumer unload. There are no
timers or background tasks.

The request contributes body content only. Its title is request metadata, and
core owns the single closed overlay frame, border width, and inner padding;
the example must not return a second `chrome: 'overlay'` surface or assemble
terminal border/width output itself.

Command and overlay registrations are durable host buffers, so this sibling
row may register before the interaction/core owners and is replayed after an
owner gap or reload. Buffering grants no dispatch or gesture authority: a
capturing overlay still requires a gesture minted by the active frontend-tree
owner. Consumer unload removes both registrations.

Keep the package opt-in and outside the product bundle. Its manifest, entry
name, package name, and one-row Cordis patch id/name remain identical.
