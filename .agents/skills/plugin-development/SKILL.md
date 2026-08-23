---
name: plugin-development
description: Design or implement a new DeepSeek Harness plugin that contributes to Blue's frontend runtime. Use for package boundaries, Cordis scope, capability fallback, lifecycle ownership, bundle composition, and fixture planning; do not use for a generic Cordis plugin with no Blue integration.
---

# Develop A Blue Plugin

Before editing, read the root `AGENTS.md`, the owning package `AGENTS.md`, and
`docs/blue-frontend-architecture.md`.

1. Classify every contribution as Domain, Interaction, Renderer, or
   Composition. Record its host, agent, session, frontend-tree, and provider
   Fiber scopes.
2. Keep domain packages independent of Blue. Put renderer-neutral projections
   and structured actions in a narrow `-blue` adapter. Only core may import
   pi-tui or touch ANSI, raw terminal state, terminal width, or focus handles.
3. Consume documented Harness APIs. Centralize capability probing and version
   differences in a removable compatibility adapter; record its deletion
   condition.
4. Define absent-capability and plain fallback behavior before mounting a
   renderer. Models are readonly data and contain no Agent, Session, Promise,
   renderer object, or product-level mutable singleton.
5. Bind every registration, subscription, timer, provider, and asynchronous
   continuation to its Cordis Fiber. Test unload, reload, provider swap,
   abort, stale result, replay/resume, and late callback rejection as relevant.
6. Add the package export/files/tsdown triangle, bundle row and disable switch,
   headless fixture, width scan, bundle composition test, and package
   `AGENTS.md` update in the same change.

Before acceptance, run `node script/blue-plugin-validate.mjs <package>` and
`node script/blue-plugin-fixture.mjs <package> --install`, then the repository
gates required by `AGENTS.md`. Keep the old renderer as the named golden/plain
fallback until the dedicated profile receives human acceptance.
