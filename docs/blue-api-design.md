# Blue API Foundation

This implementation starts the stable API work described by PR 23
(`0769e068`). `@dsh-blue/blue-api` is a leaf package: it owns readonly,
renderer-independent contracts and manifest validation, while Cordis remains
responsible for plugin Fiber activation and disposal.

The current phase establishes the API host and fixes the highest-risk TUI
coordination paths without pretending the migration is complete. Existing
`blueScreen`, transcript items, and Agent-backed app contracts remain internal
compatibility surfaces. The bundle now mounts `blue-api-host`; capability-
scoped command, status, dock, and notification registrations are Fiber-owned,
and the app publishes request lifecycle transitions and session epochs through
Cordis events.

Stable API invariants:

- no pi-tui, ANSI, raw terminal, Agent, Session, or mutable component types;
- registrations belong to the caller's Fiber and are idempotently disposed;
- stale request/session epochs are rejected;
- plugin failures are represented by structured results;
- official effects must consume the same host seams as third-party effects.

## Landed in this phase

- leaf `@dsh-blue/blue-api` contracts, manifest validation, invariants, and
  package/build/install integration;
- a Cordis-scoped public host with capability isolation, duplicate rejection,
  readonly contributions, structured failures, and effect-bound teardown;
- strict request/session epoch tracking and a terminal request-state machine;
- idempotent Interrupted projection, including rejection of buffered assistant
  events that arrive after an interrupted turn is closed;
- wheel normalization at core's input boundary before focus routing;
- a stable plan-review viewport budget that avoids token-by-token full-screen
  redraws in main-screen mode;
- full source coverage plus real-process happy-path and PTY smoke gates.

## Known compatibility gap

The Shift+Tab cycle currently degrades to `normal -> yolo -> normal` under the
thin-host preset composition. `planMode` is correctly isolated inside the
active Agent preset, while the legacy Blue mode helpers still probe the host
Context. Fixing this by republishing `planMode` globally would violate the
Cordis ownership model. The session projection phase must expose a scoped mode
reader/action instead; until then typed `/plan` remains the authoritative path.

## Remaining migration

1. Add the readonly session projection and scoped action façade, then move
   mode/status/session consumers off direct Agent and isolated-service reads.
2. Define focus and scroll ownership in the stable host, including explicit
   routing for transcript, dock, panel, and editor surfaces.
3. Implement the `BlueView` compiler and centralized row/viewport budgets;
   migrate official status and dock effects onto the same registrations third-
   party plugins use.
4. Migrate transcript renderers and error boundaries, preserving epoch and
   width contracts across replay, live streaming, interruption, and unload.
5. Split editor/provider composition behind stable actions and replacement
   providers, then remove the legacy mutable compatibility seams.

A surface enters Stable only after an official consumer, replacement fixture,
unload test, width tests, and real-terminal dogfood exist.
