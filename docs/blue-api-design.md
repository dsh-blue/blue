# Blue API Foundation

> **目标架构迁移说明（2026-08）**：本文记录 PR 23/35 的 API foundation、host 和生命周期阶段，不再是后续前端重构的唯一目标。新的 Domain/Interaction/Renderer/Composition 边界见 [blue-frontend-architecture.md](./blue-frontend-architecture.md)，session runtime 见 [blue-session-runtime.md](./blue-session-runtime.md)。本文中的 host/contract 仍是现有实现和兼容迁移的参考。

This implementation starts the stable API work described by PR 23
(`0769e068`). `@dsh-blue/blue-api` is a leaf package: it owns readonly,
renderer-independent contracts and manifest validation, while Cordis remains
responsible for plugin Fiber activation and disposal.

The current phase is intentionally behavior-preserving. Existing
`blueScreen`, transcript items, and Agent-backed app contracts remain internal
compatibility surfaces. The app now publishes request lifecycle transitions
and session epochs through Cordis events; later phases will move transcript
and panel consumers onto the readonly projection and add the public host.

Stable API invariants:

- no pi-tui, ANSI, raw terminal, Agent, Session, or mutable component types;
- registrations belong to the caller's Fiber and are idempotently disposed;
- stale request/session epochs are rejected;
- plugin failures are represented by structured results;
- official effects must consume the same host seams as third-party effects.

The remaining migration is staged: host and consumer scopes, low-risk
registries, view/panel/dock compiler, editor actions, then provider and bundle
composition replacement. A surface enters Stable only after an official
consumer, replacement fixture, unload test, width tests, and real-terminal
dogfood exist.
