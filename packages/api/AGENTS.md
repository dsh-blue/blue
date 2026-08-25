# `@dsh-blue/blue-api`

The leaf package for Blue's stable, renderer-independent plugin contracts. It
must not import core, transcript, interaction, app, pi-tui, or a concrete dsh
service. Runtime code is limited to pure manifest validation and the stable
version constant; Cordis owns plugin activation and Fiber lifetime.

Stable contracts contain readonly Blue-owned data only. Agent, SessionEvent,
BlueComponent, BlueScreen, ANSI formatters, raw key sequences, and mutable
session references remain implementation or experimental surfaces.

`BlueResult` includes `BLUE_CAPABILITY_ABSENT` for adapters and features that
probe an optional Harness capability. Consumers should render that result as a
plain or read-only fallback and must not treat it as a thrown plugin failure.

`BluePluginHostService` validates each manifest before opening a capability-
scoped API. Registries and notification subscriptions are bound to the
consumer's Cordis effect: consumer unload disposes every returned registration,
while service unload also clears all remaining host-owned state.
