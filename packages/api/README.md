# `@dsh-blue/blue-api`

English | [中文](README.zh.md)

Beta, renderer-independent public contracts for Blue Cordis plugins. The package ships no renderer, terminal, or Harness service code. It defines manifests, structured results, the safe `BlueView` content leaf, the declarative `BlueUiNode` tree, semantic events, surface/reference-provider contracts, and the `bluePluginHost` admission service. It also owns the `BLUE_VERSION` constant every Blue release package locks to.

## Manifest and capabilities

A plugin declares `{ id, api, capabilities }`, which `validateBlueManifest` checks without executing plugin code. The current executable contract is `1.0.0-beta.1`, so manifests use `^1.0.0-beta.1`; it does not track the `0.1.x` product release and does not claim protocol v1 Stable.

The versioned distribution candidate is published separately from
`@dsh-blue/blue-api/protocol/v1`. It exports the generated seven-name target
catalog, readonly manifest types, the deeply frozen Draft 2020-12 schema,
`validateBluePluginManifestV1`, and the Blue product/protocol mapping for
`1.0.0-beta.1`. Packages discover it only through
`package.json.blue.manifest = "./blue.plugin.json"`; the manifest uses a public
package export subpath, required/optional capability groups, exact resources,
and full Blue/Harness/Node compatibility ranges. The same schema and corpus are
available from the two `./schema/blue.plugin.v1.*.json` exports. The beta host
now admits this shape directly: required capabilities are atomic, while
optional capabilities may be unavailable or receive a resource subset.
`BluePluginOpen.grants` reports exact version, resources, limits, quotas,
availability, and owner generation; `unavailableOptional` records stable
unsupported/version/resource/policy/owner-gap reasons. The P4 composition
installs `session.projections.read`; admission grants exactly the declared keys
and reports an owner gap while its app bridge is unavailable.
The canonical editor-facing schema resolves at
`https://dsh-blue.dev/schema/blue.plugin.v1.schema.json`; the shared corpus is
published beside it as `blue.plugin.v1.corpus.json`.

The public Beta vocabulary is `commands`, `notifications.publish`, `status`, `panes`, `overlays`, `session.read`, and `session.projections.read`. `editor.extensions`, `status.provider`, and `editor.provider` remain Experimental/reference facets and are not part of the Stable v1 target. Generic `session.act` and global notification observation are removed. Removed `dock`, `panels`, `editor`, and `tools` declarations return `BLUE_LEGACY_CAPABILITY` with a concrete migration; `tools` has no replacement because public tool presentation has no registry or owner.

`bluePluginHost.open(ctx, manifest)` accepts the plugin's real Cordis `Context`, validates the manifest, then returns a capability-scoped `BluePluginApi` exposing only the requested surfaces. Every registration is bound to that Cordis effect, whose callback returns its cleanup: unloading the plugin disposes each contribution and permanently fences retained API references. Host service teardown applies the same fence before clearing state. Later mutations return `BLUE_ACTION_REJECTED`, and retained lists stay empty. Duplicate contribution ids are rejected across consumers, and ids in Blue's owner namespace (`blue.`, `blue:`, `blue-`, `@dsh-blue/`) are reserved.

Canonical manifests additionally return `BluePluginOpen`: `api` is the
facet-only view, while `grants` and `unavailableOptional` are immutable
admission records. Command names are plugin-defined and resource-fenced;
pane registrations are fenced to their granted placements. Legacy inline
manifests keep their original return shape during the transition.

The executable P3 candidate enforces the catalog budgets: up to 64 command and
64 additive-status contributions per consumer, notification views up to 32
KiB, and up to 20 notifications per rolling second. Notification grants also
publish bounded-clone ceilings of depth 64, 4,096 containers, 8,192 properties,
and 32 KiB of primitive/key bytes before the final exact JSON UTF-8 check.
Panes are limited to eight
per consumer, the global overlay stack to four, and capturing overlays to one
per consumer. Status, pane, and overlay refresh handles each admit 20
successful calls per rolling second and coalesce accepted calls within one
microtask. Async command settlements, including callback rejection, are
discarded after abort, plugin unload, or command-owner replacement.

The host durably buffers inert registrations for `commands`, `status`, `panes`, and the three Experimental editor/provider facets; it also installs the canonical `overlays` definition without buffering overlay opens. A plugin may therefore register definitions while the corresponding frontend-tree owner is booting or reloading; the active owner restores only the latest definitions. Consumer unload still removes its registrations. Buffering does not grant render, dispatch, gesture, provider selection, last-known-good, breaker, or fallback authority. Overlay opens, `notifications.publish`, `session.read`, and `session.projections.read` require their live owner and report an absent/unavailable result while it is missing; notices, overlays, gestures, actions, and old callback results are never replayed.

Owner attachment, aggregate observation, notification observation, gesture minting, semantic overlay close, and the unscoped session/projection/action sources are not public plugin APIs. The projection-owner source type is likewise absent from the package root; composition-private code receives it only through contextual typing on `bluePluginControl`. The default bundle keeps those operations behind that closure-bound control in an isolated private runtime realm; ordinary siblings receive only the guarded `bluePluginHost` facade.

## UI contract

`BlueUiNode` retains `BlueView` as the sanitized text/fields/code/diff/sections leaf and adds rich text, stack, surface, scroll, tabs, list, form, actions, loader, empty, progress, spacer, and divider nodes. Responsive visibility exists only on `BlueUiChild.when` and is relative to the allocated surface viewport.

An action may declare the paired `shortcut` / `shortcutFor` fields to map `pageup` or `pagedown` to its ordinary `activate` event while focus is inside the named tabs, list, or form control. `focusable: false` leaves that paging affordance visible and shortcut-addressable without adding it to roving focus. Shortcut pairs must be complete and unique per target control.

Nodes, event payloads, and snapshots are readonly JSON-shaped data. `render`, `onEvent`, `AbortSignal`, and registration handles are process-local execution boundaries. Plugins receive semantic events, never raw keys. Value, selection, and tab changes are latest-wins per control; activate, submit, and dismiss are FIFO per surface. Blue owns revision checks, abort, timeout, and coalesced refresh.

`BlueStatusNode` recursively permits only text, rich text, fields, progress, and stack, and `BluePluginApi.status` is backed by its final additive registry. Panes, overlays, editor extensions, and status/editor provider candidates are also admitted by the host. Refresh is limited to 20 successful calls per contribution in a rolling second and same-tick calls coalesce their owner notification. Capturing overlays require a host-minted, owner-scoped `BlueUserGesture`; the host consumes the proof once and invalidates outstanding proofs when their owner unloads.

`BlueEditorShellNode` is a separate provider-only tree containing the `editor-control` slot; ordinary `BlueUiNode` cannot construct that slot. Provider registration validates callback shape without invoking `render`, inspecting its returned tree, or selecting a winner. Only Blue-owned user configuration activates one of the inert candidates.

The app attaches the sole active readonly session and projection sources through the private control. Canonical `session.read` exposes result-bearing `current` and `subscribe`, always includes `revision` and `sessionEpoch` as fencing metadata, and includes only the exactly granted `identity`/`cwd`/`status`/`mode`/`model` fields. The host validates, clones, and deeply freezes snapshots instead of trusting owner objects. Each string is limited to 16,384 UTF-8 bytes and the complete snapshot to 65,536 encoded bytes. `null` means the owner is online with no current session; an owner gap returns `BLUE_CAPABILITY_ABSENT`, and a disposed consumer returns `BLUE_ACTION_REJECTED` permanently. Same-id sessions may restart at a lower revision only after the epoch advances.

The session high-water survives owner gaps. A session id cannot change within an epoch, and an equal epoch/revision may be restored only when its complete canonical snapshot is unchanged. Publishing `null` immediately replays projection subscribers so old session data is cleared.

`session.projections.read` exposes result-bearing `current`, consistent-cut `currentMany`, and key-set `subscribe` for exactly granted projection keys. Resource keys use the canonical ASCII syntax and are limited to 128 characters. Every cut carries `sessionEpoch` and `asOfSeq`; values must be finite, acyclic JSON and are detached and deeply frozen. The bounded clone admits at most 64 levels, 16,384 JSON values, and 16,384 inspected own properties across a cut; one primitive is limited to 262,144 encoded bytes and one nested object key to 1,024 UTF-8 bytes. The authoritative post-clone limits remain 262,144 encoded bytes per value and 1,048,576 bytes per complete cut. Missing or unloaded keys return `BLUE_CAPABILITY_ABSENT` without reusing old values; owner reload replays the current cut, while old epochs, stale sequence values, and late owner callbacks are rejected. Writes use the owning Harness service or Blue-internal domain action, not a generic public session gateway.

Requested key count is bounded by the exact grant before key traversal. The projection high-water also survives owner gaps; equal-position values are compared canonically (independent of JSON object key order), and conflicting values return `BLUE_STALE`. At one epoch/sequence position the host retains at most 256 key fingerprints and 4,194,304 UTF-8 bytes, then clears that bounded set when the position advances. While the active session owner reports `null`, projection reads return `null` without consulting potentially stale projection backing data.

Editor extensions contribute static rows, hints, diagnostics, structured actions, completion, and asynchronous submit transforms. `before` and `after` retain the G1 `BlueUiNode` source type, while registration admits only the recursive passive `BlueEditorExtensionNode` subset: text/rich-text/fields/code/diff/sections/progress/spacer/divider plus stack/surface. Interactive controls are rejected with `BLUE_INVALID_CONTRIBUTION`; extension actions use the separate `actions` + `onEvent` path. The compatibility `complete` callback receives `/`, `@`, and manual requests. Plugins opt into `#` through `completeV2` and `BlueEditorCompletionRequestV2`; V2 takes precedence when both callbacks exist. Registration is inert: the host clones and freezes static data, preserves callback identity, and does not invoke callbacks. Submit transforms receive readonly attachment metadata and return text only, preserving Blue-owned attachments. The interaction owner supplies abortable, revision-fenced callback contexts and rejects stale asynchronous results.

Blue-owned adapters receive capability-local `statusRevision`, `statusProvidersRevision`, and `editorExtensionsRevision` snapshot fences. Each capability advances independently, so unrelated mutations do not rebuild the selected status provider or active editor extensions. The removed `dock` surface has no host registry or snapshot compatibility path; untyped legacy manifests receive the same actionable migration rejection as `validateBlueManifest`.
