# `@dsh-blue/blue-api`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md). Current public
seams are summarized in [docs/blue-seams.md](../../docs/blue-seams.md), while
[docs/blue-plugin-contract-v1.md](../../docs/blue-plugin-contract-v1.md)
describes the target contract.

## Boundary

This is the leaf package for Blue's Beta renderer-neutral plugin contract. It
must not import core, frontend, transcript, interaction, app, pi-tui, or a
concrete Harness service. Runtime code is limited to manifest/protocol
validation and the renderer-free host. Cordis owns activation and Fiber
lifetime.

Public data is readonly and Blue-owned. It never contains Agent, Session,
SessionEvent, BlueComponent, BlueScreen, ANSI, terminal width, raw keys, a
renderer object, or mutable domain state. `BlueUiNode` is the closed canonical
wire vocabulary; responsive behavior is data, not a renderer callback.

The canonical Beta capability root contains `commands`, `status`, `panes`,
`overlays`, `notifications.publish`, `session.read`, and
`session.projections.read`. Retained editor/provider facets are Experimental
reference surfaces and do not imply Stable admission. Removed legacy names,
including generic `session.act`, remain rejected with actionable results;
domain writes stay with their owning service.

## Ownership

`BluePluginHostService` validates a manifest before returning a
capability-scoped facade. Each consumer's registrations and callbacks are
bound to its Cordis effect. Consumer or host unload permanently fences retained
facades and late results. Duplicate ids, owner namespaces, quota overflow, and
owner rejection fail atomically without briefly shadowing an existing
contribution.

Definition-style commands, status, panes, editor extensions, and provider
candidates are durable host buffers. A frontend owner may disappear and later
replay their latest snapshots; transient overlay opens, notifications,
gestures, actions, and old callback results are never replayed. Registration
does not grant rendering, dispatch, selection, last-known-good, breaker, or
fallback ownership.

Owner attachment, aggregate observation, notification observation, gesture
minting, and semantic overlay close are available only through
`bluePluginControl`. The guarded public service never exposes that control;
the bundle isolates it with app backing services. Capturing overlays require
an owner-minted one-shot `BlueUserGesture`, fenced by abort and owner unload.

The app is the sole `session.read` and `session.projections.read` owner.
Snapshots/cuts are validated, detached, deeply frozen, restricted to exact
field/key grants, and fenced by session epoch plus revision/sequence. `null`
means an active owner has no current session; an owner gap is capability
absence. Same-position conflicts, stale callbacks, key unload, and owner
replacement must never expose retained data. Size, depth, key, quota, and rate
limits come from the canonical protocol/catalog and host constants; do not
duplicate another list in consumers.

## Change Rules

- Node/event/snapshot payloads remain JSON-shaped. Process-local callbacks,
  abort signals, gestures, and registration handles are the only opaque edge.
- Host admission clones/freeze-checks caller data but does not execute renderer
  callbacks. Active renderer/interaction owners validate and invoke them with
  their own abort, timeout, ordering, and stale-result rules.
- Capability-local revisions change only when their capability changes;
  unrelated host mutations must not rebuild status/provider/editor owners.
- Registration snapshots subscribe before replay and roll back listeners on a
  throwing replay. Reentrant consumer/owner cleanup must not leave effects.
- Host state is shared across compatible source/build copies in one Host realm,
  but ordinary consumers receive only the guarded `version/open` service.
- Root and `./invariant` retain the inline Beta transition contract.
  `./protocol/v1` plus `./capabilities/v1` own canonical generated types,
  validation, schema, catalog, and product/protocol mapping.

The JSON schema is the shape source. Run the generator rather than hand-editing
generated TypeScript or Website schema copies. Runtime entries are derived
from concrete package exports by `script/package-contract.mjs`; JSON
schema/corpus assets must also remain in the package `files` whitelist.

## Verification

Ordinary implementation edits use `pnpm run verify:changed`. Any public type,
manifest, schema, capability, host lifecycle, quota, or export change is
cross-cutting and requires `pnpm run verify:full`.

Keep focused coverage for validation, hostile values/realms, reentrant unload,
quota rollback, retained facades, owner gaps/reload, gestures, session epoch,
projection consistent cuts, and stale/late results. Protocol changes also run
`pnpm run check:plugin-contract`, `pnpm run check:plugin-authoring-docs`,
`pnpm run fixture:plugin-tutorial`, `pnpm run check:pack`, and the bundle e2e.
