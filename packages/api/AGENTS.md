# `@dsh-blue/blue-api`

Repo-wide rules live in the root [AGENTS.md](../../AGENTS.md). Current service
boundaries are documented in [docs/blue-seams.md](../../docs/blue-seams.md).

This leaf package owns renderer-neutral Blue UI contracts and exactly four
direct Cordis services: `bluePanes`, `blueStatus`, `blueOverlays`, and
`blueEditorExtensions`. It must not import app, frontend, transcript,
interaction, core, pi-tui, or a concrete Harness service.

The services are ordinary Fiber-aware registries. Registration validates
identity and required callbacks, freezes a shallow definition copy, publishes
current snapshots, and removes the definition on caller Fiber unload.
Duplicate ids fail before replacing an existing contribution. Listener replay
and cleanup remain deterministic under reentrant disposal.

Public nodes and entries are renderer-neutral. They contain no ANSI, terminal
width, focus handle, pi-tui component, Agent, Session, or renderer object.
Callbacks are allowed only where the surface contract requires render/event,
completion, or submit behavior.

`document` and `chart` are data-only `BlueUiNode` variants for full pane and
overlay trees. They do not widen `BlueView`, `BlueStatusNode`, or
`BlueEditorExtensionNode`; renderer libraries, width behavior, and fallbacks
remain core-owned.

Do not add capability negotiation, manifests, grants, host facades, owner
attachments, private control planes, result wrappers, service mirrors, or
compatibility aliases. Native dsh services remain native dsh services.

Any contract or service lifecycle change requires focused API tests, a real
external consumer, bundle whole-tree coverage, `pnpm run verify:full`, and
dedicated-profile acceptance.
