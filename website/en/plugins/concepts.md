# Core concepts

## One Cordis graph

Blue does not create a nested plugin system. External plugins, official Blue
rows, and native dsh services are members of one Cordis tree. `inject` is both
an activation dependency and a reload boundary.

## Fiber is lifecycle

Command, pane, status, overlay, and editor-extension registrations belong to
the caller's Fiber. They disappear on unload. Bind other subscriptions, timers,
and external listeners through `ctx.effect()` or an explicit disposer.

## Native domain, Blue UI

Reuse dsh behavior directly. Blue does not copy command, tool, projection,
setting, or Agent APIs. Blue seams exist only for terminal UI.

Inject `blueCurrentAgent` when native Agent-scoped behavior needs the current
selection:

```ts
const agent = ctx.blueCurrentAgent.current()
if (agent !== null) {
  const snapshot = ctx.sessionProjections.snapshot(agent.session, ['myProjection'])
}
```

Do not retain Agent or Session across selection revisions.

## Renderer-neutral

UI contributions return `BlueUiNode`. Plugins do not import pi-tui, assemble
ANSI, or read terminal width. Core owns validation, layout, theme, focus, and
terminal safety.

## Failure semantics

Native dsh services keep their own result and exception behavior. Blue
registries throw for invalid ids, missing callbacks, and duplicate ids.
Registration handles expose `refresh()/dispose()`; overlays also expose
`close()`.
