# `@dsh-blue/blue-api`

English | [中文](README.zh.md)

Stable, renderer-independent public contracts for Blue Cordis plugins. The package ships no renderer, terminal, or Harness service code: it defines the plugin manifest format, the structured `BlueResult` error taxonomy, the renderer-neutral `BlueView` vocabulary, and the `bluePluginHost` service that admits third-party contributions. It also owns the `BLUE_VERSION` constant every Blue release package locks to.

## Manifest and capabilities

A plugin declares a static manifest — `{ id, api, capabilities }` — that `validateBlueManifest` checks without executing plugin code. `api` is a semver range against the host's `1.x` line. The manifest vocabulary declares nine capabilities: `commands`, `status`, `dock`, `notifications`, `tools`, `editor`, `panels`, `session.read`, and `session.act`.

`bluePluginHost.open(consumer, manifest)` validates the manifest, then returns a capability-scoped `BluePluginApi` exposing only the requested surfaces. Every registration is bound to the consumer's Cordis effect: unloading the plugin disposes each contribution. Duplicate contribution ids are rejected across consumers, and ids in Blue's owner namespace (`blue.`, `blue:`, `blue-`, `@dsh-blue/`) are reserved.

## Phase-one capabilities

Four capabilities are open today:

- `commands` — slash commands with a label and an async `execute` returning `BlueResult`.
- `status` — footer status items rendered from a `BlueView`.
- `dock` — dock pane views with optional priority and row budget.
- `notifications` — publish and subscribe to renderer-neutral notifications.

The remaining declared capabilities (`tools`, `editor`, `panels`, `session.read`, `session.act`) are phase-gated: requesting one fails `open()` with `BLUE_CAPABILITY_DENIED`. All failures arrive as structured `BlueResult` values — plugin errors never cross the boundary as thrown objects.
