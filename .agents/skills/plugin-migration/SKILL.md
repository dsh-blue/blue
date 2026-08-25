---
name: plugin-migration
description: Audit and migrate an existing Harness or Blue plugin onto the renderer-neutral frontend runtime. Use when separating domain, interaction, renderer, and composition code or producing an adapter/deletion plan; do not use for greenfield plugin design.
---

# Migrate A Plugin

Read the root `AGENTS.md`, `docs/blue-frontend-architecture.md`, and the source
package's manifest, entrypoints, bundle rows, public exports, and lifecycle
tests before proposing edits.

Run `node script/blue-plugin-validate.mjs <package>` and preserve its JSON
report. Then inspect for facts a static scanner cannot prove:

- direct pi-tui, ANSI, DOM, React, raw-terminal, or width ownership outside the
  renderer adapter;
- Agent or Session objects crossing into public frontend models;
- UI code folding Harness session events or keeping a second business-state
  projection;
- product-level mutable module singletons and state crossing host, agent,
  session, frontend-tree, or provider Fiber scope;
- implicit bundle ordering, undeclared services, package-internal imports, and
  registrations or late async work without an unload path.

Produce a migration record with Domain, Projection, Action, Interaction Model,
Renderer UI, Composition Rows, Scope, Capabilities, Fallback, Fixtures, and
Deletion Condition. Extract domain/projection ownership first, add a narrow
capability adapter second, and add the Blue model/renderer consumer last.

Do not claim completion while the old renderer is still the only product
consumer. Keep it as the golden/plain fallback until replacement, independent
packed fixture, unload/swap, width, bundle, real-profile, and human acceptance
evidence all pass.
