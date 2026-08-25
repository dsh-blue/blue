# `@dsh-blue/blue-api`

The leaf package for Blue's stable, renderer-independent plugin contracts. It
must not import core, transcript, interaction, app, pi-tui, or a concrete dsh
service. Runtime code is limited to pure manifest validation and the stable
version constant; Cordis owns plugin activation and Fiber lifetime.

Stable contracts contain readonly Blue-owned data only. Agent, SessionEvent,
BlueComponent, BlueScreen, ANSI formatters, raw key sequences, and mutable
session references remain implementation or experimental surfaces.

`BluePluginHostService` validates each manifest before opening a capability-
scoped API. Registries and notification subscriptions are bound to the
consumer's Cordis effect: consumer unload disposes every returned registration,
while service unload also clears all remaining host-owned state.
The host keeps one aggregate registry per capability, rejects duplicate ids
across consumers, reserves Blue's owner namespace, and synchronously notifies
the Blue-owned adapters. An adapter admission failure rolls the registration
back before `register()` returns, so an existing slash-command name cannot be
shadowed temporarily.
Owner state lives in a Host-realm `Symbol.for`-keyed WeakMap rather than on the
service object or in one module-local singleton: source/build or link/store
copies in the same lockstep profile share it (the D37 cross-store lesson),
while a dynamic VM has a separate global and sees only `version/open` on the
guarded service.

The first creative-mode surface is additive only: `dock`, `status`, `commands`,
and `notifications` are public capabilities. Duplicate contribution ids are
rejected; no API permits replacing an existing Blue feature or reaching the
root Loader, HMR, renderer, Agent, or Session objects. `session.read` remains a
declared contract until the app projection/runtime vertical slice supplies its
snapshot and stale-event guarantees.

## Distribution contract

The package publishes only `lib/*.js` and `lib/types/**/*.d.ts`. Runtime entries are derived from `exports` by `script/package-contract.mjs`; add a public entry by adding its manifest export and matching `src/<entry>.ts`, then run `pnpm check:pack`.
