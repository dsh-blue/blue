# `@dsh-blue/blue-api`

The leaf package for Blue's Beta, renderer-independent plugin contracts. It
must not import core, transcript, interaction, app, pi-tui, or a concrete dsh
service. Runtime code is limited to manifest validation and the renderer-free
plugin host; Cordis owns plugin activation and Fiber lifetime.

Beta contracts contain readonly Blue-owned data only. Agent, SessionEvent,
BlueComponent, BlueScreen, ANSI formatters, raw key sequences, and mutable
session references remain implementation or experimental surfaces.

`BlueView` remains the sanitized content leaf. `BlueUiNode` adds only the
closed layout/pattern vocabulary; responsive visibility is `BlueUiChild.when`,
not a renderer callback or node kind. `BlueStatusNode` is recursively narrowed
to text/rich-text/fields/progress/stack. `BlueEditorExtensionNode` recursively
permits the passive text/rich-text/fields/code/diff/sections/progress/spacer/
divider leaves plus stack/surface; interactive controls remain outside it.
`editor-control` exists only in the provider shell union. Provider admission
checks callback shape only; the selected owner validates a rendered tree and
its single editor-control slot.
`BlueListItem.detail` remains the plain compatibility field;
`detailSpans` carries renderer-neutral tone/emphasis when a row needs semantic
inline detail without exposing ANSI.
`BlueActionItem.shortcut` is limited to the semantic `pageup | pagedown`
vocabulary and must be paired with `shortcutFor`, the id of one tabs, list, or
form control in the same admitted tree. The renderer emits the ordinary
`activate` event only while focus is inside that control scope; no raw input is
exposed. `focusable: false` keeps a paging affordance visible and
shortcut-addressable without adding it to roving focus. One tree cannot claim
the same shortcut twice for one scope.

Node/event/snapshot data is JSON-shaped. Render callbacks, event handlers,
`AbortSignal`, opaque one-shot `BlueUserGesture`, and registration handles are
the process-local boundary. Change events are latest-wins per control;
activate/submit/dismiss are FIFO per surface. The host owns revision fencing,
abort, timeout, and coalesced refresh.

Editor extensions are inert registrations. The host clones and freezes their
static UI/data fields, preserves callback identity, and never invokes
`complete`, `completeV2`, `onEvent`, or `transformSubmit`. `before` and `after`
retain their G1 `BlueUiNode` static type for source compatibility, while host
admission recursively rejects anything outside the recommended passive
`BlueEditorExtensionNode` subset. Extension actions use the separate `actions`
plus `onEvent` path. The compatibility `complete` callback receives only slash,
`@`, and manual requests; extensions explicitly opt into `#` through
`completeV2` and `BlueEditorCompletionRequestV2`, which takes precedence when
both callbacks exist. Submit transformers receive readonly attachment metadata
but return text only, so Blue retains attachment ownership across the async
submit barrier. The interaction owner supplies callback contexts and owns
abort, timeout, ordering, and stale-result rejection.

Owner snapshots carry one monotonic aggregate revision plus capability-local
`statusRevision`, `statusProvidersRevision`, and `editorExtensionsRevision`
and `editorProvidersRevision` fences; pane/overlay entries carry independent
render revisions. Register,
coalesced refresh, dispose, and admission rollback advance only the affected
capability fence, so unrelated host mutations do not rebuild the active
footer/provider/editor extensions. These owner fields are optional in the
TypeScript shape for source-compatible mocks, while every real host snapshot
supplies them. Snapshot subscriptions attach before their initial replay so a
reentrant admission cannot be missed; a throwing replay removes every
just-attached listener. `runBlueUserGesture` is the owner-only async dispatch
scope: commands, panes, overlays, editor extensions, and editor providers may
mint one-shot proofs; abort or owner unload revokes immediately, and normal
settlement revokes after the complete handler promise settles.

`BlueResult` includes `BLUE_CAPABILITY_ABSENT` for adapters and features that
probe an optional Harness capability. Consumers should render that result as a
plain or read-only fallback and must not treat it as a thrown plugin failure.

`BluePluginHostService` validates each manifest before opening a capability-
scoped API. Registries and notification subscriptions are bound to the
consumer's Cordis effect: consumer unload disposes every returned registration,
while service unload fences every open consumer before clearing all remaining
host-owned state. Consumer or service unload permanently fences a retained
facade before capability-owner checks:
later writes return `BLUE_ACTION_REJECTED`, notification subscriptions return
an already-disposed inert registration, lists remain frozen and empty, and a
capturing-overlay attempt cannot consume a retained user gesture. Admission
also rechecks the fence after synchronous owner notification so reentrant
consumer cleanup cannot leave a contribution behind. A live notification
subscription rolls its listener and handle back before propagating a rejected
Cordis effect registration.
The public consumer shape requires an effect callback that returns its disposer,
matching a real Cordis `Context` without downstream casts; `open()` always
installs exactly that cleanup.
The host keeps one aggregate registry per capability, rejects duplicate ids
across consumers, reserves Blue's owner namespace, and synchronously notifies
the Blue-owned adapters. An adapter admission failure rolls the registration
back before `register()` returns, so an existing slash-command name cannot be
shadowed temporarily.
The `blue-api-host` plugin Fiber holds host-scoped durable registration leases
for `commands`, `status`, `panes`, `editor.extensions`, `status.provider`, and
`editor.provider`, plus the canonical `overlays` capability definition, as soon
as it provides `bluePluginHost`. The registries admit inert contributions
independently of frontend sibling-row boot order; active adapters replay the
aggregate snapshot after an owner gap or reload. Overlay opens remain transient
and require the live renderer owner even through the legacy facade.
Registration does not grant renderer, dispatch,
gesture, provider-selection, LKG, breaker, or fallback authority: those remain
with the active frontend-tree owner Fiber. Consumer unload removes its
registrations and permanently fences retained facades; host unload clears the
buffers. Direct standalone `new BluePluginHostService()` construction does not
attach the durable leases and retains the capability-absent embedding contract.
`notifications.publish`, `session.read`, and `session.projections.read` require
their active owners; they are not durable registration buffers. Notification
consumers receive a publish-only facade; observation is available only through
the composition-private control. Session ownership uses that same closure-
bound control. App is the sole active reader/projection generation. Canonical
`session.read` contains result-bearing `current`/`subscribe`; every publication
has required `revision` and `sessionEpoch` fences, is validated, cloned, and
deeply frozen, and is scoped to the exact granted fields. `null` means the
owner is online without a current session. An owner gap returns
`BLUE_CAPABILITY_ABSENT`; unload permanently returns `BLUE_ACTION_REJECTED`.
Every owner string is limited to 16,384 UTF-8 bytes and the complete canonical
snapshot to 65,536 encoded bytes before it can enter host state.
The host retains the epoch/revision/id high-water and a canonical snapshot
fingerprint across owner gaps. A session id cannot change inside one epoch;
lower positions and conflicting data at an equal position are rejected, while
an exactly equal owner reload may restore visibility. Same-id/new-epoch
snapshots may restart at a lower revision. Publishing `null` clears the visible
session and replays projection subscriptions so their old session values do not
survive the transition.

Canonical `session.projections.read` contains result-bearing `current`,
consistent-cut `currentMany`, and key-set `subscribe`, all scoped to the exact
granted keys. A cut carries `sessionEpoch` and `asOfSeq`; each value is bounded
to 262,144 encoded bytes and the complete metadata-plus-values cut to 1,048,576
bytes. Values must be finite, acyclic JSON and are detached and deeply frozen.
Projection resource keys use canonical ASCII syntax and stop at 128 characters.
The pre-clone structural budget is shared by the complete requested cut: depth
64, 16,384 JSON values, 16,384 inspected own properties, 262,144 encoded bytes
per primitive, and 1,024 UTF-8 bytes per nested object key. Descriptor reads
start only after the own-key count fits; exact post-clone value/cut checks remain
authoritative for JSON syntax and escaping overhead.
Requested key-array length is rejected before entry traversal when it exceeds
the exact grant. The global epoch/sequence high-water and canonical per-key
fingerprints survive owner gaps; JSON object key order is not identity, while
conflicting values at one position return `BLUE_STALE`. Fingerprints retained
at one position stop at 256 distinct keys or 4,194,304 UTF-8 bytes and are
cleared when the epoch/sequence fence advances. Every valid source event
advances that global fence before interested subscriptions replay. When the
active session owner has published `null`, projection reads return `null`
without consulting the projection source.
Unhandled owner throws map to a fixed internal-failure message through a
non-reflective branded-error path; only host-owned session-data errors retain
their controlled detail. Key unload and missing backing data produce structured
absence without stale reuse. Owner reload first replays the current cut, and
owner identity plus epoch/sequence fences reject old or late callbacks. Reader
and projection source registrations require an own data `dispose` function;
synchronous owner cleanup prevents source subscription, and every fanout walks
a stable listener snapshot. A source subscription returned after reentrant
owner cleanup is disposed. The owner-only
`attachSessionProjections` seam is
separate from generic capability attachment and never enters the guarded host.
Its source type is composition-private and is not exported from the package
root; app wiring relies on `bluePluginControl` contextual typing.
Generic `session.act` and its requester types are absent from the public API;
domain writes continue through their owning Harness or Blue-internal action
service. Host state lives in a Host-realm `Symbol.for`-keyed WeakMap rather than
on the service object or in one module-local singleton: source/build or
link/store copies in the same lockstep profile share it (the D37 cross-store
lesson), while a dynamic VM sees only `version/open` on the guarded service.

The public Beta vocabulary is `commands`, `notifications.publish`, `status`,
`panes`, `overlays`, `session.read`, and `session.projections.read`. The retained
`editor.extensions`, `status.provider`, and `editor.provider` facets are
Experimental/reference runtime and are not part of the Stable v1 target. The
two provider registries contain inert candidates; user configuration, never
priority or installation, selects one. Public validation rejects
`dock/panels/editor/tools` with an actionable `BLUE_LEGACY_CAPABILITY` result
and rejects removed `notifications`/`session.act` names as incompatible.

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
Owner gaps retain and continue admitting definitions to the six durable
registration buffers; replacement owners replay them from their initial
snapshot. Overlay opens and notification publication remain unavailable without
their respective renderer and interaction owners; canonical session/projection
owner gaps return structured capability absence until the app owner reloads.
Aggregate snapshots, notification observation, gesture minting,
semantic close, and owner attachment are reachable only through
`bluePluginControl`, which the default bundle isolates with raw app services in
its private runtime realm. The package root exports no callable owner helper.
An overlays lease enters a non-admitting retirement state before its bounded
closer snapshot drains. It remains current long enough for the old renderer to
observe the final empty snapshot, but synchronous callbacks cannot reopen a
transient into that old generation and no drain loop is required.

The removed public `dock` transition has no host validator exception, API
facade, contribution type, registry, or snapshot field. Untyped legacy
manifests still pass through the public validator so `dock/panels/editor/tools`
receive their actionable migration diagnostics rather than an unknown-field
failure. `BluePluginApi.status` and its owner snapshot use only the final
recursively narrowed status contract.

## Distribution contract

The root and `./invariant` retain the executable `1.0.0-beta.1` inline-host
contract for the transition lane. Canonical manifests carrying the schema
marker are admitted by the same host through the independent `./protocol/v1`
contract. That subpath owns the `1.0.0-beta.1` distribution contract: seven generated
capability names, generated readonly manifest types, the semantic validator,
the deeply frozen Draft 2020-12 schema, and the exact Blue product/protocol
mapping. The hand-edited schema is the single shape source;
`script/generate-blue-plugin-contract.mjs --check` prevents generated TypeScript
drift. Formal semver parsing comes from `semver`, while Ajv owns schema
evaluation and custom package-name/export-subpath formats.

The canonical schema and its positive/negative corpus ship as JSON subpaths
under `./schema/`. The corpus covers identity, public export entry, API and
compatibility ranges, required/optional groups, capability-specific resources,
unknown fields, and same/cross-group duplicates. Successful runtime parses are
detached and deeply frozen. The repository validator consumes this same parser
before checking `package.json.blue.manifest`, package identity, selected export,
`files`, packed file list, and direct peer closure. It follows Node's active ESM
conditions, requires every relative runtime/declaration closure file to remain
inside the package and ship in the tarball, disables external pack lifecycle
scripts, and recursively verifies every installed Harness package on an exact
line. Cordis entry `name`, loader
row id, and npm package name remain separate namespaces; the selected entry
must export a literal name and `apply`, but its name need not equal the package.
The P1 validator and fixture accept an external package directory but remain
repository commands. `apply` is accepted only when statically callable, with
lifecycle evidence reachable from that function; opaque loader aliases and
unreachable markers fail closed. External packed-entry imports run in an
isolated probe so plugin stdout/stderr, early exit, or a hang cannot corrupt the
parent JSON report or skip fixture cleanup. A published no-clone author runner is still pending as an
R2 exit gate and must not be claimed by this package yet.

The generator also owns the copies under `website/public/schema/`, so the
canonical `$schema` URL and companion corpus resolve from `dsh-blue.dev`.
Those website files are generated artifacts and must not be hand-edited.

Runtime entries are derived from `exports` by `script/package-contract.mjs`;
add a public JavaScript entry by adding its manifest export and matching
`src/<entry>.ts`, then run `pnpm check:pack`. JSON schema/corpus exports point
at `schema/*.json`, which is explicitly included in the tarball whitelist.
Legacy inline manifests and the six PR #77 flat example manifests remain an
explicit transition lane while P3 UI owners converge; any manifest carrying
`$schema` is always validated and admitted as v1 and cannot fall back to that
lane. Canonical admission returns exact grants with immutable resources,
limits, quotas, availability, and owner generation. Required requests fail
atomically; optional requests may produce partial grants plus structured
unavailable records. The catalog supports `session.projections.read`; its app
bridge owns readiness, so admission during a bridge gap is unavailable rather
than unsupported.

P3 host enforcement mirrors the catalog at the public boundary: one consumer
may retain at most 64 command and 64 additive-status definitions; notification
views are limited to 32 KiB and publication to 20 notices per rolling second.
Before cloning a notification, the same grant enforces depth 64, 4,096
container nodes, 8,192 properties, and 32 KiB of primitive/key bytes; an exact
post-clone JSON UTF-8 byte check remains authoritative for escaping and syntax
overhead. The bounded walk reads own descriptors only and rejects before deep
recursion or complete hostile-payload allocation.
Command and status counters are keyed by Cordis consumer object, shared across
all canonical and legacy facades opened by that consumer, and released by
individual registration disposal or consumer unload.
Pane, capturing-overlay, and notification quota slots are reserved before
synchronous owner fan-out, so a reentrant owner callback observes the outer
admission in its consumer budget. Aggregate rejection, synchronous consumer
unload, and contribution disposal release exactly the reserved slot; an
accepted notification remains charged even when an observer throws.
Canonical `supported` state is persistent composition knowledge, distinct from
live `ownerReady`: durable command/status/pane/overlay buffers declare support
at host boot, while notification and session-read support begins only after
their owner has attached once and survives later owner gaps. Command callbacks
are wrapped with the consumer lifetime. Successful and rejected settlements
both recheck abort first and consumer unload second, so a late callback cannot
escape through a retained aggregate entry; an active callback rejection remains
the plugin's original rejection.
