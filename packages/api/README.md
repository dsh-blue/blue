# `@dsh-blue/blue-api`

English | [中文](README.zh.md)

Stable, renderer-independent public contracts for Blue Cordis plugins. The package ships no renderer, terminal, or Harness service code. It defines manifests, structured results, the safe `BlueView` content leaf, the declarative `BlueUiNode` tree, semantic events, surface/provider contracts, and the `bluePluginHost` admission service. It also owns the `BLUE_VERSION` constant every Blue release package locks to.

## Manifest and capabilities

A plugin declares `{ id, api, capabilities }`, which `validateBlueManifest` checks without executing plugin code. `api` targets the independent Blue API `1.x` protocol, normally `^1.0.0`; it does not track the `0.1.x` product release.

The target capability vocabulary is `commands`, `notifications`, `status`, `panes`, `overlays`, `editor.extensions`, `session.read`, `session.act`, `status.provider`, and `editor.provider`. Removed `dock`, `panels`, `editor`, and `tools` declarations return `BLUE_LEGACY_CAPABILITY` with a concrete migration. `tools` has no replacement because public tool presentation has no registry or owner.

`bluePluginHost.open(consumer, manifest)` validates the manifest, then returns a capability-scoped `BluePluginApi` exposing only the requested surfaces. Every registration is bound to the consumer's Cordis effect: unloading the plugin disposes each contribution. Duplicate contribution ids are rejected across consumers, and ids in Blue's owner namespace (`blue.`, `blue:`, `blue-`, `@dsh-blue/`) are reserved.

## UI contract

`BlueUiNode` retains `BlueView` as the sanitized text/fields/code/diff/sections leaf and adds rich text, stack, surface, scroll, tabs, list, form, actions, loader, empty, progress, spacer, and divider nodes. Responsive visibility exists only on `BlueUiChild.when` and is relative to the allocated surface viewport.

Nodes, event payloads, and snapshots are readonly JSON-shaped data. `render`, `onEvent`, `AbortSignal`, and registration handles are process-local execution boundaries. Plugins receive semantic events, never raw keys. Value, selection, and tab changes are latest-wins per control; activate, submit, and dismiss are FIFO per surface. Blue owns revision checks, abort, timeout, and coalesced refresh.

`BlueStatusNode` recursively permits only text, rich text, fields, progress, and stack, and `BluePluginApi.status` exposes that final additive contract now. The existing host implementation casts its deprecated `BlueView` registry behind this boundary only until W2-C replaces the runtime bridge. `BlueEditorShellNode` is a separate provider-only tree containing the `editor-control` slot; ordinary `BlueUiNode` cannot construct that slot, and host admission must require exactly one. Status and editor providers register inert candidates: only Blue-owned user configuration selects an active provider.

W1 declares the new registries but does not implement them. The current host keeps a deprecated built-in `dock` bridge solely so the repository remains runnable until W2-C migrates its owners to `panes`; published manifests already fail public validation for `dock`.
