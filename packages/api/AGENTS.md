# `@dsh-blue/blue-api`

The leaf package for Blue's stable, renderer-independent plugin contracts. It
must not import core, transcript, interaction, app, pi-tui, or a concrete dsh
service. Runtime code is limited to pure manifest validation and the stable
version constant; Cordis owns plugin activation and Fiber lifetime.

Stable contracts contain readonly Blue-owned data only. Agent, SessionEvent,
BlueComponent, BlueScreen, ANSI formatters, raw key sequences, and mutable
session references remain implementation or experimental surfaces.

`BlueView` remains the sanitized content leaf. `BlueUiNode` adds only the
closed layout/pattern vocabulary; responsive visibility is `BlueUiChild.when`,
not a renderer callback or node kind. `BlueStatusNode` is recursively narrowed
to text/rich-text/fields/progress/stack. `editor-control` exists only in the
provider shell union and runtime admission must count exactly one.

Node/event/snapshot data is JSON-shaped. Render callbacks, event handlers,
`AbortSignal`, opaque one-shot `BlueUserGesture`, and registration handles are
the process-local boundary. Change events are latest-wins per control;
activate/submit/dismiss are FIFO per surface. The host owns revision fencing,
abort, timeout, and coalesced refresh.

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

W1 compatibility exception: `host.ts` uses the non-root-exported
`validateBlueHostManifest` to admit the existing built-in `dock` bridge, and
`contracts.ts` retains deprecated dock/status adapter shapes. W2-C must remove
that validator, `BluePluginApi.dock`, `BlueDockContribution`, the host dock
registry/snapshot, and the compile-only legacy capability input when pane and
status owners migrate. No new plugin may depend on this transition.

## Distribution contract

The package publishes only `lib/*.js` and `lib/types/**/*.d.ts`. Runtime entries are derived from `exports` by `script/package-contract.mjs`; add a public entry by adding its manifest export and matching `src/<entry>.ts`, then run `pnpm check:pack`.

Distribution manifests may add `schemaVersion: 1`, `entry`, `blue`, `harness`,
`node`, and `integrity` to the inline `id`/`api`/`capabilities` contract. The
repository validator compares `blue.plugin.json`, package exports, and the
entry's literal `name`; legacy inline manifests remain accepted for built-in
rows.
