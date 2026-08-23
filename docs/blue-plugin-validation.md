# Blue Plugin Validation

This is the repeatable F6 acceptance checklist for plugins that consume the
Blue frontend runtime.

## Development and migration

Classify each contribution as Domain, Interaction, Renderer, or Composition;
record its host/agent/session/frontend scope; and keep the renderer adapter in
its own package. Migration review must flag direct pi-tui/ANSI/DOM imports,
session-event folding, module singletons, implicit bundle dependencies, and
missing Fiber cleanup. The replacement must expose a plain model fallback and
an explicit capability check.

## Fixture contract

An independent-install fixture loads the published package through its bundle
entry, then verifies: headless projection, TUI rendering, provider swap,
unload/reload, stale-result rejection, abort, and width scans at 20, 40, 80,
and 120 columns. The fixture must not import `packages/*` source paths.

## Ecosystem audits

- `dsh-openpencil`: absent renderer capabilities keep the domain plugin active,
  while the Blue adapter exposes a plain fallback and unloads all providers.
- `dsh-lark`: actions are capability-gated and notifications are projected as
  renderer-neutral models; duplicate notification keys are collapsed and all
  subscriptions are disposed with the plugin Fiber.

The audit is complete only when `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test:coverage`, `pnpm run build`, `pnpm run check:lib`, and
`pnpm run smoke:happy` pass from a clean independent-install fixture.
