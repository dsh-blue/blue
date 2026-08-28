# `@dsh-blue/blue-api`

The leaf package for Blue's stable, renderer-independent plugin contracts. It
must not import core, transcript, interaction, app, pi-tui, or a concrete dsh
service. Runtime code is limited to manifest validation and the renderer-free
plugin host; Cordis owns plugin activation and Fiber lifetime.

Stable contracts contain readonly Blue-owned data only. Agent, SessionEvent,
BlueComponent, BlueScreen, ANSI formatters, raw key sequences, and mutable
session references remain implementation or experimental surfaces.

`BlueView` remains the sanitized content leaf. `BlueUiNode` adds only the
closed layout/pattern vocabulary; responsive visibility is `BlueUiChild.when`,
not a renderer callback or node kind. `BlueStatusNode` is recursively narrowed
to text/rich-text/fields/progress/stack. `editor-control` exists only in the
provider shell union. Provider admission checks callback shape only; the
selected owner validates a rendered tree and its single editor-control slot.

Node/event/snapshot data is JSON-shaped. Render callbacks, event handlers,
`AbortSignal`, opaque one-shot `BlueUserGesture`, and registration handles are
the process-local boundary. Change events are latest-wins per control;
activate/submit/dismiss are FIFO per surface. The host owns revision fencing,
abort, timeout, and coalesced refresh.

Owner snapshots carry one monotonic aggregate revision, and pane/overlay
entries carry independent render revisions. A refresh tick increments only its
entry revision after coalescing. These owner fields are optional in the
TypeScript shape for source-compatible mocks, while every real host snapshot
supplies them. Snapshot subscriptions attach before their initial replay so a
reentrant admission cannot be missed; a throwing replay
removes every just-attached listener. `runBlueUserGesture` is the owner-only
async dispatch scope: commands, panes, and overlays may mint one-shot proofs;
abort or owner unload revokes immediately, and normal settlement revokes after
the complete handler promise settles.

`BlueResult` includes `BLUE_CAPABILITY_ABSENT` for adapters and features that
probe an optional Harness capability. Consumers should render that result as a
plain or read-only fallback and must not treat it as a thrown plugin failure.

`BluePluginHostService` validates each manifest before opening a capability-
scoped API. Registries and notification subscriptions are bound to the
consumer's Cordis effect: consumer unload disposes every returned registration,
while service unload also clears all remaining host-owned state.
The host keeps one aggregate registry per capability, rejects duplicate ids
across consumers, reserves Blue's owner namespace, and synchronously notifies
the Blue-owned adapters. An adapter admission failure rolls the registration
back before `register()` returns, so an existing slash-command name cannot be
shadowed temporarily.
Capability availability is owned by active adapter Fibers rather than the
hard-coded public capability list. View and interaction bridges attach their
exact capability sets through `attachBluePluginHostCapabilities`; reference
counts allow overlapping owner generations. `open()` returns
`BLUE_CAPABILITY_ABSENT` unless every requested capability has an active owner,
and existing registry/publish handles recheck before each write. Aggregate
contributions survive a bridge unload so a replacement bridge restores them
from its initial snapshot; consumer or host unload still deletes them.
Owner state lives in a Host-realm `Symbol.for`-keyed WeakMap rather than on the
service object or in one module-local singleton: source/build or link/store
copies in the same lockstep profile share it (the D37 cross-store lesson),
while a dynamic VM has a separate global and sees only `version/open` on the
guarded service.

The public capability vocabulary is `commands`, `notifications`, `status`,
`panes`, `overlays`, `editor.extensions`, `session.read`, `session.act`,
`status.provider`, and `editor.provider`. The two provider registries contain
inert candidates; user configuration, never priority or installation, selects
one. Public validation rejects `dock/panels/editor/tools` with an actionable
`BLUE_LEGACY_CAPABILITY` result.

The host implements `status`, `panes`, `overlays`, `editor.extensions`, and
both provider registries without rendering plugin callbacks. Pane state keeps
owner-only hidden metadata. Overlay snapshots preserve global stack order and
normalize `capturing=false` / `dismissible=true`; capturing admission consumes
an owner-minted `BlueUserGesture` by object identity. Overlay entries contain
no callable close authority: `closeBluePluginHostOverlay` requires the original
host, an active overlays owner, and the current entry identity to complete a
semantic dismiss. Snapshot and notification owner helpers likewise reject the
guarded public service. Refresh handles enforce 20 successful calls per rolling
second and cancel pending coalesced ticks when their contribution is disposed.
Owner gaps retain contributions but reject new writes with
`BLUE_CAPABILITY_ABSENT`; `session.read/session.act` remain
denied because no owner/API seam exists.

W2-C compatibility exception: `host.ts` uses the non-root-exported
`validateBlueHostManifest` to admit the existing built-in `dock` bridge, and
`contracts.ts` retains deprecated dock/status adapter shapes for owner
compatibility. `BluePluginApi.status` uses its final narrowed registry with no
cast; the deprecated status shape is snapshot compatibility only. Remove the
host transition validator, `BluePluginApi.dock`, `BlueDockContribution`, host
dock registry/snapshot, and `BlueHostManifest` when dock owners migrate. No new
plugin may depend on this transition.

## Distribution contract

The package publishes only `lib/*.js` and `lib/types/**/*.d.ts`. Runtime entries are derived from `exports` by `script/package-contract.mjs`; add a public entry by adding its manifest export and matching `src/<entry>.ts`, then run `pnpm check:pack`.

Distribution manifests may add `schemaVersion: 1`, `entry`, `blue`, `harness`,
`node`, and `integrity` to the inline `id`/`api`/`capabilities` contract. The
repository validator compares `blue.plugin.json`, package exports, and the
entry's literal `name`; legacy inline manifests remain accepted for built-in
rows.
